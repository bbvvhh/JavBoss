import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { register } from 'node:module'
import { fileURLToPath } from 'node:url'

// src/ 里用 `@/...` 绝对导入，node 需要这个钩子才能解析（见 aliasLoader.mjs）。
register('./aliasLoader.mjs', import.meta.url)

const {
  addJavDuplicateWhitelist,
  fetchJavDuplicateWhitelist,
  fetchJavDuplicates,
  removeJavDuplicateWhitelist,
} = await import('../src/api.js')

/** 用一个临时 fetch 捕获请求；调用方负责 restore()。 */
function captureFetch(payload) {
  const calls = []
  const previous = globalThis.fetch
  globalThis.fetch = async (path, init) => {
    calls.push({ path, init })
    return { ok: true, status: 200, json: async () => payload }
  }
  return {
    calls,
    restore() {
      globalThis.fetch = previous
    },
  }
}

test('fetchJavDuplicates 走只读的 GET /jav/duplicates', async () => {
  const mock = captureFetch({ items: [{ id: 1 }], total: 1 })
  let result
  try {
    result = await fetchJavDuplicates({ limit: 24, offset: 48, search: 'ABC' })
  } finally {
    mock.restore()
  }

  assert.equal(mock.calls.length, 1)
  assert.equal(mock.calls[0].init.method, 'GET')
  assert.match(mock.calls[0].path, /^\/jav\/duplicates\?/)
  assert.ok(mock.calls[0].path.includes('limit=24'), 'limit 应下发')
  assert.ok(mock.calls[0].path.includes('offset=48'), 'offset 应下发')
  assert.ok(mock.calls[0].path.includes('search=ABC'), 'search 应下发')
  assert.deepEqual(result.items, [{ id: 1 }])
  assert.equal(result.total, 1)
})

test('fetchJavDuplicateWhitelist 返回白名单数组', async () => {
  const mock = captureFetch({ items: [{ jav_id: 1, code: 'ABC-001' }] })
  let list
  try {
    list = await fetchJavDuplicateWhitelist()
  } finally {
    mock.restore()
  }

  assert.equal(mock.calls[0].path, '/jav/duplicate-whitelist')
  assert.equal(mock.calls[0].init.method, 'GET')
  assert.deepEqual(list, [{ jav_id: 1, code: 'ABC-001' }])
})

test('fetchJavDuplicateWhitelist 在缺 items 时返回空数组', async () => {
  const mock = captureFetch({})
  let list
  try {
    list = await fetchJavDuplicateWhitelist()
  } finally {
    mock.restore()
  }
  assert.deepEqual(list, [])
})

test('addJavDuplicateWhitelist 以 jav_ids 提交到 /jav/duplicate-whitelist', async () => {
  const mock = captureFetch({ status: 'ok', added: 2 })
  try {
    await addJavDuplicateWhitelist([1, 2])
  } finally {
    mock.restore()
  }

  assert.equal(mock.calls[0].path, '/jav/duplicate-whitelist')
  assert.equal(mock.calls[0].init.method, 'POST')
  assert.deepEqual(JSON.parse(mock.calls[0].init.body), { jav_ids: [1, 2] })
})

test('removeJavDuplicateWhitelist 走 /jav/duplicate-whitelist/remove', async () => {
  const mock = captureFetch({ status: 'ok', removed: 1 })
  try {
    await removeJavDuplicateWhitelist([3])
  } finally {
    mock.restore()
  }

  assert.equal(mock.calls[0].path, '/jav/duplicate-whitelist/remove')
  assert.equal(mock.calls[0].init.method, 'POST')
  assert.deepEqual(JSON.parse(mock.calls[0].init.body), { jav_ids: [3] })
})

function readDuplicatePageSource() {
  return readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      'src',
      'components',
      'JavDuplicatePage.jsx'
    ),
    'utf8'
  )
}

test('查重列表默认是普通浏览态，不硬编码多选', () => {
  const source = readDuplicatePageSource()

  // 回归：曾经把 selectionMode 直接写死成多选，导致点封面 / 标题全被拦掉。
  assert.ok(
    source.includes('const [selectionMode, setSelectionMode] = useState(false)'),
    '多选态必须是默认关闭的 state'
  )
  assert.ok(source.includes('selectionMode={selectionMode}'), '卡片的多选态要跟随 state')
  // 普通态下点封面播放、点标题进详情，与 JAV 作品列表一致。
  assert.ok(source.includes("pushPage('jav-detail', value)"), '普通态要能打开作品详情')
  assert.ok(!/<JavWorkCard[\s\S]*?\n\s+selectionMode\n/.test(source), '不得裸写 selectionMode prop')
})

test('「全选」按钮在浏览态 / 多选态下承担不同功能且文案随之变化', () => {
  const source = readDuplicatePageSource()

  assert.ok(!source.includes('全选本页'), '按钮文案不应再是「全选本页」')
  // 浏览态：点击进入多选。
  assert.ok(/onClick=\{\(\) => setSelectionMode\(true\)\}/.test(source), '浏览态点击应进入多选')
  // 多选态：全选 / 取消全选，文案跟着走。
  assert.ok(source.includes("allSelected ? zh('取消全选'"), '已全选时文案应变为「取消全选」')
  assert.ok(source.includes("zh('全选', 'All')"), '未全选时文案应为「全选」')
})

test('查重页只从 @/api 引入查重接口，不碰任何文件删除能力', () => {
  const source = readDuplicatePageSource()

  // 白名单而不是黑名单：一旦引入删除 / 重命名类接口，这里立刻失败。
  const imports = Array.from(source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@\/api'/g))
  assert.equal(imports.length, 1, '查重页应当只从 @/api 引入一次')
  const names = imports[0][1]
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
    .sort()
  assert.deepEqual(names, [
    'addJavDuplicateWhitelist',
    'fetchJavDuplicateWhitelist',
    'fetchJavDuplicates',
    'removeJavDuplicateWhitelist',
  ])

  for (const banned of ['deleteVideoLocation', 'renameVideoLocation', 'hideVideoLocations']) {
    assert.ok(!source.includes(banned), `查重页不得引用 ${banned}`)
  }
})
