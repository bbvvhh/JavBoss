import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { register } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// src/ 里用 `@/...` 绝对导入，node 需要这个钩子才能解析（见 aliasLoader.mjs）。
register('./aliasLoader.mjs', import.meta.url)

const {
  RESTORE_DEADLINE_MS,
  RESTORE_TOLERANCE,
  SCROLL_STORAGE_PREFIX,
  clampScrollTarget,
  readScrollPosition,
  safeSessionStorage,
  scrollStorageKey,
  shouldWaitForMore,
  writeScrollPosition,
} = await import('../src/utils/scrollRestore.js')

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
const readSource = (...parts) => readFileSync(join(srcDir, ...parts), 'utf8')

/** 只实现用到的那几个方法的假 storage。 */
function fakeStorage({ throwing = false } = {}) {
  const map = new Map()
  return {
    map,
    getItem(key) {
      if (throwing) throw new Error('denied')
      return map.has(key) ? map.get(key) : null
    },
    setItem(key, value) {
      if (throwing) throw new Error('denied')
      map.set(key, String(value))
    },
  }
}

test('key 带前缀，两个列表互不串味', () => {
  assert.equal(SCROLL_STORAGE_PREFIX, 'javboss:scroll:')
  assert.equal(scrollStorageKey('video'), 'javboss:scroll:video')
  assert.equal(scrollStorageKey('jav:works'), 'javboss:scroll:jav:works')
})

test('readScrollPosition：没有 / 非法 / 非正数都当 0，不是「记了个位置」', () => {
  const storage = fakeStorage()
  assert.equal(readScrollPosition(storage, 'video'), 0, '没存过就是从头开始')
  assert.equal(readScrollPosition(storage, ''), 0)
  assert.equal(readScrollPosition(null, 'video'), 0, '隐私模式取不到 storage 时不能抛错')

  storage.map.set(scrollStorageKey('video'), 'abc')
  assert.equal(readScrollPosition(storage, 'video'), 0)
  storage.map.set(scrollStorageKey('video'), '-120')
  assert.equal(readScrollPosition(storage, 'video'), 0, '负位置没有意义')
  storage.map.set(scrollStorageKey('video'), '0')
  assert.equal(readScrollPosition(storage, 'video'), 0)
  storage.map.set(scrollStorageKey('video'), '840')
  assert.equal(readScrollPosition(storage, 'video'), 840)

  assert.equal(readScrollPosition(fakeStorage({ throwing: true }), 'video'), 0, '读失败要静默回落')
})

test('writeScrollPosition：写入后能读回来，非法值与写入失败都不打断滚动', () => {
  const storage = fakeStorage()
  writeScrollPosition(storage, 'video', 640)
  assert.equal(readScrollPosition(storage, 'video'), 640)
  assert.equal(storage.map.get(scrollStorageKey('video')), '640')

  writeScrollPosition(storage, 'video', -1)
  assert.equal(readScrollPosition(storage, 'video'), 640, '负值不覆盖已有位置')
  writeScrollPosition(storage, 'video', Number.NaN)
  assert.equal(readScrollPosition(storage, 'video'), 640)
  writeScrollPosition(storage, 'video', 'x')
  assert.equal(readScrollPosition(storage, 'video'), 640)

  assert.doesNotThrow(() => writeScrollPosition(fakeStorage({ throwing: true }), 'video', 100))
  assert.doesNotThrow(() => writeScrollPosition(null, 'video', 100))
  assert.doesNotThrow(() => writeScrollPosition(storage, '', 100))
})

test('clampScrollTarget：目标超过当前最大滚动量时只能滚到能滚到的最远处', () => {
  assert.equal(clampScrollTarget(1200, 600), 600, '列表还没长够高，先滚到底')
  assert.equal(clampScrollTarget(300, 600), 300, '够得到就按存的位置')
  assert.equal(clampScrollTarget(300, 300), 300)
  assert.equal(clampScrollTarget(300, 0), 0, '完全没得滚')
  assert.equal(clampScrollTarget(0, 600), 0, '没记过位置就停在顶部')
  assert.equal(clampScrollTarget(Number.NaN, 600), 0)
  assert.equal(clampScrollTarget(300, Number.NaN), 0)
})

test('shouldWaitForMore：够高就滚、不够高就边等边拉下一页、超时就不等了', () => {
  assert.equal(RESTORE_DEADLINE_MS, 3000)
  assert.equal(RESTORE_TOLERANCE, 24)

  const base = { saved: 2000, maxY: 1000, elapsedMs: 0 }
  assert.equal(shouldWaitForMore(base), true, '差得还远，继续等')

  // 差在容差内就算了，没必要为了 24px 再拉一页。
  assert.equal(shouldWaitForMore({ saved: 2000, maxY: 1980, elapsedMs: 0 }), false)
  assert.equal(
    shouldWaitForMore({ saved: 2000, maxY: 2000 - RESTORE_TOLERANCE, elapsedMs: 0 }),
    false
  )
  assert.equal(
    shouldWaitForMore({ saved: 2000, maxY: 2000 - RESTORE_TOLERANCE - 1, elapsedMs: 0 }),
    true,
    '超出容差 1px 就还要等'
  )

  // 等超时：列表可能就到这儿了（比如筛选后总页数变少），再等下去只会一直转圈。
  assert.equal(
    shouldWaitForMore({ saved: 5000, maxY: 1000, elapsedMs: RESTORE_DEADLINE_MS }),
    false
  )
  assert.equal(
    shouldWaitForMore({ saved: 5000, maxY: 1000, elapsedMs: RESTORE_DEADLINE_MS - 1 }),
    true
  )

  // 没记过位置 / 高度未知：不该为了「恢复」去多拉数据。
  assert.equal(shouldWaitForMore({ saved: 0, maxY: 100, elapsedMs: 0 }), false)
  assert.equal(shouldWaitForMore({ saved: Number.NaN, maxY: 100, elapsedMs: 0 }), false)
  assert.equal(shouldWaitForMore({ saved: 900, maxY: Number.NaN, elapsedMs: 0 }), false)
  assert.equal(shouldWaitForMore({ saved: 900, maxY: 100, elapsedMs: Number.NaN }), false)
})

test('safeSessionStorage：取不到 sessionStorage 时返回 null 而不是抛错', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      get() {
        throw new Error('sandboxed')
      },
    })
    assert.equal(safeSessionStorage(), null)
  } finally {
    if (original) Object.defineProperty(globalThis, 'window', original)
    else delete globalThis.window
  }
})

test('hook 用 sessionStorage 存位置，并且在滚动 / 离开页面 / 卸载时都写回', () => {
  const hook = readSource('hooks', 'useScrollRestoration.js')
  assert.ok(hook.includes('safeSessionStorage()'), '必须走兜底的 sessionStorage')
  assert.ok(hook.includes("addEventListener('scroll'"), '滚动时要节流保存')
  assert.ok(hook.includes("addEventListener('pagehide'"), '刷新 / 切后台前也要保存')
  assert.ok(hook.includes('requestAnimationFrame'), '恢复与保存都要按帧节流')
  assert.ok(hook.includes('cancelAnimationFrame'), '卸载要停掉等待循环')
  assert.ok(hook.includes('save()'), '卸载时再存一次')

  const util = readSource('utils', 'scrollRestore.js')
  assert.ok(!util.includes('fetch('), '存取位置是本地行为，不该碰网络')
})

test('视频列表按视图启用「video」这一份位置', () => {
  const app = readSource('App.jsx')
  assert.ok(app.includes("useScrollRestoration('video'"), '视频列表要恢复自己的位置')
  assert.ok(app.includes("enabled: view === 'video'"), '切到 JAV 模式时应停止跟踪')
  assert.ok(
    app.includes('state.loadMoreVideos()'),
    '列表还没长够高时要能请 store 再拉一页，否则恢复不到原处'
  )
})

test('JAV 每个子分类各记一份位置，切子分类不会互相覆盖', () => {
  const list = readSource('components', 'JavListPage.jsx')
  assert.ok(
    list.includes('useScrollRestoration(`jav:${tab}`'),
    '作品 / 女优 / 片商 / 系列各自一份位置，数据本来就是分开加载的'
  )
  assert.ok(list.includes('if (!hasNext || loading || loadingMore || randomSeed) return false'))
  assert.ok(list.includes('load(items.length)'), '要继续拉就得带上已加载数量作为 offset')
})
