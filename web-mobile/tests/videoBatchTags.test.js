import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { register } from 'node:module'
import { fileURLToPath } from 'node:url'

// src/ 里用 `@/...` 绝对导入，node 需要这个钩子才能解析（见 aliasLoader.mjs）。
register('./aliasLoader.mjs', import.meta.url)

const { useStore } = await import('../src/store.js')

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'components')
const readSource = (name) => readFileSync(join(srcDir, name), 'utf8')

/** 构造一份「已选中若干视频」的最小状态。 */
function withSelected(videos, selectedIds, run) {
  const selectedKeys = new Set()
  const selectedMeta = {}
  for (const video of videos) {
    const key = video.location_id ? `loc:${video.location_id}` : `vid:${video.id}`
    if (!selectedIds.includes(video.id)) continue
    selectedKeys.add(key)
    selectedMeta[key] = { videoId: video.id, locationId: video.location_id || null, label: '' }
  }
  useStore.setState({ videos, selectedKeys, selectedMeta, selectionMode: true })
  try {
    return run()
  } finally {
    useStore.setState({
      videos: [],
      selectedKeys: new Set(),
      selectedMeta: {},
      selectionMode: false,
    })
  }
}

test('selectedJavIds 取所选视频关联的作品 id，并按 id 去重', () => {
  const videos = [
    { id: 1, jav: { id: 11 } },
    // 同一部作品的两个文件（jav 挂在 location 上）只应算一个。
    { id: 2, location_id: 20, locations: [{ jav: { id: 11 } }] },
    { id: 3, jav: { id: 12 } },
    { id: 4, jav: { id: 99 } },
  ]
  withSelected(videos, [1, 2, 3], () => {
    assert.deepEqual(useStore.getState().selectedJavIds().sort(), [11, 12])
  })
})

test('selectedJavIds 跳过未关联 JAV 的视频', () => {
  const videos = [{ id: 1, jav: { id: 11 } }, { id: 2 }, { id: 3, jav: {} }]
  withSelected(videos, [1, 2, 3], () => {
    assert.deepEqual(useStore.getState().selectedJavIds(), [11])
  })
})

test('selectedJavIds 在没选中任何视频时返回空数组', () => {
  const videos = [{ id: 1, jav: { id: 11 } }]
  withSelected(videos, [], () => {
    assert.deepEqual(useStore.getState().selectedJavIds(), [], '未选中时不该凭空取到作品')
  })
})

test('selectedJavIds 一个都没关联时返回空数组，调用方据此拦住抽屉', () => {
  const videos = [{ id: 1 }, { id: 2 }]
  withSelected(videos, [1, 2], () => {
    assert.deepEqual(useStore.getState().selectedJavIds(), [])
  })
})

test('视频多选操作栏：三个可用动作，且「删除文件」仍是禁用占位', () => {
  const source = readSource('SelectionBar.jsx')
  assert.ok(source.includes('onOpenRemoveTags'), '应有「移除标签」入口')
  assert.ok(source.includes('onOpenJavTags'), '应有「JAV 标签」入口')

  // 移动端任何时候都不删除视频文件：这个占位块里不允许出现任何点击回调。
  // 注意用 JSX 里的 `zh('删除文件'` 定位，文件顶部注释里也提到了「删除文件」。
  const deleteIndex = source.indexOf("zh('删除文件'")
  assert.ok(deleteIndex > 0, '「删除文件」占位应当保留，用来表达移动端的约束')
  // 从它所在的 <div 开始截，避免把前一个按钮的 onClick 也算进来。
  const deleteDivStart = source.lastIndexOf('<div', deleteIndex)
  assert.ok(deleteDivStart > 0, '「删除文件」应当是纯展示块')
  assert.ok(
    !source.slice(deleteDivStart, deleteIndex).includes('onClick'),
    '「删除文件」不得变成可点按钮'
  )
})

test('TagEditorSheet 的「移除标签」入口强制批量语义（防止单视频走替换把标签删光）', () => {
  const source = readSource('TagEditorSheet.jsx')
  assert.ok(source.includes("initialMode = 'add'"), '默认仍是追加模式')
  assert.ok(source.includes("initialMode === 'remove'"), '必须识别移除入口')
  assert.ok(
    source.includes('!forceBatch && videos?.length === 1'),
    '移除入口不能落进单视频（替换）分支'
  )
  assert.ok(source.includes('initialMode'), '打开时要重置为入口指定的模式')
})
