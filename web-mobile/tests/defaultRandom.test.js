import assert from 'node:assert/strict'
import test from 'node:test'
import { register } from 'node:module'

// src/ 里用 `@/...` 绝对导入，node 需要这个钩子才能解析（见 aliasLoader.mjs）。
register('./aliasLoader.mjs', import.meta.url)

const { useStore } = await import('../src/store.js')

/** 用一份假的 /config 响应驱动 loadConfig，避免真发请求。 */
function withConfig(payload, run) {
  const previous = globalThis.fetch
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => payload,
  })
  useStore.setState({ config: null, randomSeed: null, javRandomSeed: null })
  try {
    return run()
  } finally {
    globalThis.fetch = previous
    useStore.setState({ config: null, randomSeed: null, javRandomSeed: null })
  }
}

test('首次加载配置时视频与 JAV 列表都进入随机', async () => {
  await withConfig({ default_random: 'true' }, async () => {
    await useStore.getState().loadConfig()
    const state = useStore.getState()
    assert.ok(Number.isFinite(state.randomSeed), '视频随机种子应当已生成')
    assert.ok(Number.isFinite(state.javRandomSeed), 'JAV 随机种子应当已生成')
  })
})

test('配置键缺失时按缺省开启处理', async () => {
  await withConfig({}, async () => {
    await useStore.getState().loadConfig()
    const state = useStore.getState()
    assert.ok(Number.isFinite(state.randomSeed), '缺省应开启视频随机')
    assert.ok(Number.isFinite(state.javRandomSeed), '缺省应开启 JAV 随机')
  })
})

test('显式关闭时保持普通排序', async () => {
  await withConfig({ default_random: 'false' }, async () => {
    await useStore.getState().loadConfig()
    const state = useStore.getState()
    assert.equal(state.randomSeed, null)
    assert.equal(state.javRandomSeed, null)
  })
})
