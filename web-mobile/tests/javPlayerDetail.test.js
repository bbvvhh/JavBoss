import assert from 'node:assert/strict'
import test from 'node:test'
import { register } from 'node:module'

// src/ 里用 `@/...` 绝对导入，node 需要这个钩子才能解析（见 aliasLoader.mjs）。
register('./aliasLoader.mjs', import.meta.url)

const { useStore } = await import('../src/store.js')

/** 用假的 fetch 收集请求，避免真发网络请求。 */
async function withFetch(run, { items = [], fail = false } = {}) {
  const previous = globalThis.fetch
  const calls = []
  globalThis.fetch = async (path, init) => {
    calls.push({ path, init })
    if (fail) throw new Error('network down')
    return { ok: true, status: 200, json: async () => ({ items, total: items.length }) }
  }
  try {
    await run()
  } finally {
    globalThis.fetch = previous
  }
  return calls
}

test('openJavDetail：按 code 搜到完整作品后压入 jav-detail 详情页', async () => {
  useStore.setState({ pages: [] })
  const full = { id: 9, code: 'ABC-009', videos: [{ id: 1 }], tags: [{ name: '剧情' }] }
  const calls = await withFetch(
    () => useStore.getState().openJavDetail({ id: 9, code: 'abc-009' }),
    { items: [full] }
  )
  assert.equal(calls.length, 1)
  assert.match(calls[0].path, /search=abc-009/)
  const pages = useStore.getState().pages
  assert.equal(pages.length, 1)
  assert.equal(pages[0].type, 'jav-detail')
  assert.equal(pages[0].payload, full, '命中时应使用完整作品，而不是播放页快照')
})

test('openJavDetail：搜不到时退回传入的快照，仍能进页', async () => {
  useStore.setState({ pages: [] })
  const snapshot = { id: 9, code: 'ABC-009' }
  await withFetch(() => useStore.getState().openJavDetail(snapshot), { items: [] })
  const pages = useStore.getState().pages
  assert.equal(pages.length, 1)
  assert.equal(pages[0].payload, snapshot)
})

test('openJavDetail：请求失败时退回快照', async () => {
  useStore.setState({ pages: [] })
  const snapshot = { id: 9, code: 'ABC-009' }
  await withFetch(() => useStore.getState().openJavDetail(snapshot), { fail: true })
  assert.equal(useStore.getState().pages[0].payload, snapshot)
})

test('openJavDetail：栈顶已是同一作品详情页时不再压栈', async () => {
  const top = { type: 'jav-detail', payload: { id: 9, code: 'ABC-009' } }
  useStore.setState({ pages: [top] })
  const calls = await withFetch(
    () => useStore.getState().openJavDetail({ id: 9, code: 'ABC-009' }),
    { items: [{ id: 9, code: 'ABC-009' }] }
  )
  assert.equal(calls.length, 0, '同一个作品不应再发一次搜索请求')
  assert.deepEqual(useStore.getState().pages, [top])
})

test('openJavDetail：既没有 id 也没有 code 时忽略', async () => {
  useStore.setState({ pages: [] })
  const calls = await withFetch(() => useStore.getState().openJavDetail({ title: '无番号' }), {
    items: [],
  })
  assert.equal(calls.length, 0)
  assert.equal(useStore.getState().pages.length, 0)
})
