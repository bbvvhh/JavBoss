import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { register } from 'node:module'
import { fileURLToPath } from 'node:url'

// src/ 里用 `@/...` 绝对导入，node 需要这个钩子才能解析（见 aliasLoader.mjs）。
register('./aliasLoader.mjs', import.meta.url)

const { useStore, javSelectionId } = await import('../src/store.js')
const { addJavTagToJavs } = await import('../src/api.js')

const sheetsPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'components',
  'JavSelectionSheets.jsx'
)
const sheetsSource = readFileSync(sheetsPath, 'utf8')

/** 每个用例都从干净的多选状态开始，避免用例之间互相串。 */
function resetJavSelection(patch = {}) {
  useStore.setState({
    javSelectionMode: false,
    javSelectedIds: new Set(),
    javSelectableIds: [],
    ...patch,
  })
}

test('javSelectionId 只接受正整数作品 id', () => {
  assert.equal(javSelectionId({ id: 12 }), 12)
  assert.equal(javSelectionId({ id: '12' }), 12)
  assert.equal(javSelectionId({ id: 0 }), '')
  assert.equal(javSelectionId({ id: -1 }), '')
  assert.equal(javSelectionId({ id: 'abc' }), '')
  assert.equal(javSelectionId(null), '')
})

test('enterJavSelection 进入多选并选中首项，非法项直接忽略', () => {
  resetJavSelection()
  useStore.getState().enterJavSelection({ id: 5 })
  let state = useStore.getState()
  assert.equal(state.javSelectionMode, true)
  assert.deepEqual(state.javSelectedIdList(), [5])

  // id 非法时不能把 UI 带进一个「已选 0 项」的多选态。
  resetJavSelection()
  useStore.getState().enterJavSelection({ code: 'ABC-001' })
  state = useStore.getState()
  assert.equal(state.javSelectionMode, false)
  assert.equal(state.javSelectedIds.size, 0)
})

test('toggleJavSelection 可以反复勾选 / 取消', () => {
  resetJavSelection({ javSelectionMode: true })
  useStore.getState().toggleJavSelection({ id: 1 })
  useStore.getState().toggleJavSelection({ id: 2 })
  assert.deepEqual(useStore.getState().javSelectedIdList().sort(), [1, 2])

  useStore.getState().toggleJavSelection({ id: 1 })
  assert.deepEqual(useStore.getState().javSelectedIdList(), [2])
})

test('setJavSelectable 只收合法 id，重复同步不产生新引用', () => {
  resetJavSelection()
  useStore.getState().setJavSelectable([{ id: 3 }, { id: 0 }, { id: 'x' }, { id: 4 }])
  const first = useStore.getState().javSelectableIds
  assert.deepEqual(first, [3, 4])

  // 同样的名单再来一次必须短路，否则 effect → set → 重渲染会转成死循环。
  useStore.getState().setJavSelectable([{ id: 3 }, { id: 4 }])
  assert.equal(useStore.getState().javSelectableIds, first, '名单没变时不应写入新的数组引用')
})

test('selectAllJavs 选中已加载的全部作品，clearJavSelection 只清勾选', () => {
  resetJavSelection({ javSelectionMode: true })
  useStore.getState().setJavSelectable([{ id: 7 }, { id: 8 }, { id: 9 }])
  useStore.getState().selectAllJavs()
  assert.deepEqual(useStore.getState().javSelectedIdList().sort(), [7, 8, 9])

  useStore.getState().clearJavSelection()
  const state = useStore.getState()
  assert.equal(state.javSelectedIds.size, 0)
  assert.equal(state.javSelectionMode, true, '取消全选不应退出多选态')
})

test('exitJavSelection 把多选态与勾选一起清空', () => {
  resetJavSelection({ javSelectionMode: true })
  useStore.getState().toggleJavSelection({ id: 1 })
  useStore.getState().exitJavSelection()
  const state = useStore.getState()
  assert.equal(state.javSelectionMode, false)
  assert.equal(state.javSelectedIds.size, 0)
})

test('JAV 多选与视频多选互不干扰', () => {
  resetJavSelection()
  useStore.setState({ selectionMode: false, selectedKeys: new Set(), selectedMeta: {} })
  useStore.getState().enterJavSelection({ id: 11 })
  const state = useStore.getState()
  assert.equal(state.selectionMode, false, '不应顺带打开视频多选')
  assert.equal(state.selectedKeys.size, 0)
})

test('bumpJavListVersion 自增，供列表重拉使用', () => {
  const before = useStore.getState().javListVersion
  useStore.getState().bumpJavListVersion()
  assert.equal(useStore.getState().javListVersion, before + 1)
})

test('addJavTagToJavs 走追加语义的 /jav/tags/add', async () => {
  const calls = []
  const previous = globalThis.fetch
  globalThis.fetch = async (path, init) => {
    calls.push({ path, init })
    return { ok: true, status: 200, json: async () => ({}) }
  }
  try {
    await addJavTagToJavs(7, [1, 2, 3])
  } finally {
    globalThis.fetch = previous
  }

  assert.equal(calls.length, 1)
  assert.equal(calls[0].path, '/jav/tags/add')
  assert.equal(calls[0].init.method, 'POST')
  assert.deepEqual(JSON.parse(calls[0].init.body), { tag_id: 7, jav_ids: [1, 2, 3] })
})

test('批量抽屉只从 api.js 引入追加式的两个接口', () => {
  // 白名单而不是黑名单：一旦有人引入覆盖式替换或删除类接口，这里立刻失败。
  const imports = Array.from(sheetsSource.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@\/api'/g))
  assert.equal(imports.length, 1, '批量抽屉应当只从 @/api 引入一次')
  const names = imports[0][1]
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
    .sort()
  assert.deepEqual(names, ['addJavTagToJavs', 'addJavsToFavoriteGroups'])

  // 覆盖式接口会把作品已刮削的其它标签一并抹掉，批量加标签绝不能用它。
  assert.ok(!sheetsSource.includes('replaceJavTagsForItems'), '不得使用覆盖式标签替换')
  assert.ok(!sheetsSource.includes('replaceJavFavoriteGroups'), '收藏夹也不允许覆盖式写入')
})

test('作品多选时收起子分类行，吸顶偏移按功能栏在不在算', () => {
  const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
  const readSource = (...parts) => readFileSync(join(srcDir, ...parts), 'utf8')

  // 多选态里功能栏已经不渲染了，子分类行还留着会在顶上留一条空档，而且它本来就是
  // 多选态里唯一还能切走分类的入口（切走多选态就悬空了）。
  const list = readSource('components', 'JavListPage.jsx')
  assert.ok(list.includes('javSelectionMode ? null : ('), '多选态不渲染子分类行')
  assert.ok(list.includes("belowChips ? 'top-[96px]' : 'top-[50px]'"), '吸顶偏移要按功能栏算')
  assert.ok(list.includes('belowChips={chipsVisible}'), '子分类行要拿到功能栏的实际状态')

  // 打开搜索框时功能栏同样不渲染，偏移也得跟着变成 50px，所以以 App 的判断为准。
  const app = readSource('App.jsx')
  assert.ok(app.includes('const quickChipsVisible ='), '功能栏是否渲染要有唯一来源')
  assert.ok(app.includes('chipsVisible={javChipsVisible}'), 'App 要把功能栏的状态传给列表页')
})
