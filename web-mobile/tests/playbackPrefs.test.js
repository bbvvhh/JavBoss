import assert from 'node:assert/strict'
import test from 'node:test'
import { register } from 'node:module'

// src/ 里用 `@/...` 绝对导入，node 需要这个钩子才能解析（见 aliasLoader.mjs）。
register('./aliasLoader.mjs', import.meta.url)

const { isBoostEnabled, readBoostSpeed, setBoostEnabled, setBoostSpeed, __playbackPrefsInternals } =
  await import('../src/utils/playbackPrefs.js')
const { DEFAULT_BOOST_SPEED } = await import('../src/utils/boostSpeed.js')

/** 最小 localStorage 实现：只实现 playbackPrefs 用到的那几个方法。 */
function makeStorage() {
  const map = new Map()
  return {
    get length() {
      return map.size
    },
    key: (index) => Array.from(map.keys())[index] ?? null,
    getItem: (name) => (map.has(name) ? map.get(name) : null),
    setItem: (name, value) => map.set(String(name), String(value)),
    removeItem: (name) => map.delete(name),
  }
}

function withStorage(run) {
  const previous = globalThis.localStorage
  globalThis.localStorage = makeStorage()
  try {
    return run(globalThis.localStorage)
  } finally {
    if (previous === undefined) delete globalThis.localStorage
    else globalThis.localStorage = previous
  }
}

const { BOOST_ENABLED_KEY, BOOST_SPEED_KEY } = __playbackPrefsInternals

test('默认开启长按倍速，倍速为默认档', () => {
  withStorage(() => {
    assert.equal(isBoostEnabled(), true)
    assert.equal(readBoostSpeed(), DEFAULT_BOOST_SPEED)
  })
})

test('开关与档位都能持久化', () => {
  withStorage(() => {
    setBoostEnabled(false)
    assert.equal(isBoostEnabled(), false)
    setBoostEnabled(true)
    assert.equal(isBoostEnabled(), true)

    setBoostSpeed(2.5)
    assert.equal(readBoostSpeed(), 2.5)
  })
})

test('倍速只接受档位表里的值，非法值不写入', () => {
  withStorage((store) => {
    setBoostSpeed(7)
    assert.equal(store.getItem(BOOST_SPEED_KEY), null, '非法值不应该落盘')
    assert.equal(readBoostSpeed(), DEFAULT_BOOST_SPEED)

    setBoostSpeed('abc')
    assert.equal(readBoostSpeed(), DEFAULT_BOOST_SPEED)
  })
})

test('存了脏数据也回落到默认档，而不是抛错', () => {
  withStorage((store) => {
    store.setItem(BOOST_SPEED_KEY, '9')
    assert.equal(readBoostSpeed(), DEFAULT_BOOST_SPEED)
    store.setItem(BOOST_SPEED_KEY, 'null')
    assert.equal(readBoostSpeed(), DEFAULT_BOOST_SPEED)
  })
})

test('localStorage 不可用时全部退化为默认值而不是抛错', () => {
  const previous = globalThis.localStorage
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('SecurityError')
    },
  })
  try {
    assert.equal(isBoostEnabled(), true)
    assert.equal(readBoostSpeed(), DEFAULT_BOOST_SPEED)
    assert.doesNotThrow(() => setBoostEnabled(false))
    assert.doesNotThrow(() => setBoostSpeed(3))
  } finally {
    delete globalThis.localStorage
    if (previous !== undefined) globalThis.localStorage = previous
  }
})

test('key 使用固定前缀，避免和其它模块冲突', () => {
  withStorage((store) => {
    setBoostEnabled(false)
    assert.equal(store.getItem(BOOST_ENABLED_KEY), 'false')
    setBoostSpeed(3)
    assert.equal(store.getItem(BOOST_SPEED_KEY), '3')
    assert.ok(BOOST_ENABLED_KEY.startsWith('javboss-mobile:'))
    assert.ok(BOOST_SPEED_KEY.startsWith('javboss-mobile:'))
  })
})
