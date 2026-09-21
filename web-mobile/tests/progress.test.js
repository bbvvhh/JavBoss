import test from 'node:test'
import assert from 'node:assert/strict'

import {
  clearAllProgress,
  clearProgress,
  countProgress,
  isResumeEnabled,
  readProgress,
  setResumeEnabled,
  writeProgress,
  __progressInternals,
} from '../src/utils/progress.js'

/** 最小 localStorage 实现：只实现 progress.js 用到的那几个方法。 */
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

const { MIN_RESUME_SECONDS, PREFIX } = __progressInternals

test('短于阈值不记录，长于阈值才记录', () => {
  withStorage(() => {
    writeProgress(1, MIN_RESUME_SECONDS - 1)
    assert.equal(readProgress(1), 0)
    writeProgress(2, MIN_RESUME_SECONDS + 5)
    assert.equal(readProgress(2), MIN_RESUME_SECONDS + 5)
  })
})

test('关闭续播后不再读取、也不再写入进度', () => {
  withStorage(() => {
    writeProgress(7, 600)
    assert.equal(readProgress(7), 600)

    setResumeEnabled(false)
    assert.equal(isResumeEnabled(), false)
    assert.equal(readProgress(7), 0, '关闭后已存的进度也必须读不到')

    writeProgress(8, 600)
    assert.equal(countProgress(), 1, '关闭后不应新增记录')

    setResumeEnabled(true)
    assert.equal(readProgress(8), 0, '关闭期间没写进去')
    assert.equal(readProgress(7), 600, '重新打开后旧进度恢复')
  })
})

test('clearAllProgress 只删自己的前缀', () => {
  withStorage((store) => {
    writeProgress(11, 100)
    writeProgress(12, 200)
    store.setItem('javboss-mobile:jav-density', 'large')
    store.setItem('unrelated', 'keep-me')

    assert.equal(countProgress(), 2)
    assert.equal(clearAllProgress(), 2)
    assert.equal(countProgress(), 0)
    assert.equal(store.getItem('unrelated'), 'keep-me')
    assert.equal(store.getItem('javboss-mobile:jav-density'), 'large')
  })
})

test('clearProgress 只清一部', () => {
  withStorage(() => {
    writeProgress(21, 100)
    writeProgress(22, 100)
    clearProgress(21)
    assert.equal(countProgress(), 1)
    assert.equal(readProgress(21), 0)
    assert.equal(readProgress(22), 100)
  })
})

test('localStorage 不可用时全部退化为默认值而不是抛错', () => {
  const previous = globalThis.localStorage
  // 模拟 Safari 隐私模式下访问 localStorage 就抛异常
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('SecurityError')
    },
  })
  try {
    assert.equal(isResumeEnabled(), true)
    assert.equal(readProgress(1), 0)
    assert.doesNotThrow(() => writeProgress(1, 999))
    assert.equal(countProgress(), 0)
    assert.equal(clearAllProgress(), 0)
  } finally {
    delete globalThis.localStorage
    if (previous !== undefined) globalThis.localStorage = previous
  }
})

test('进度 key 使用固定前缀，避免和其它模块冲突', () => {
  withStorage((store) => {
    writeProgress(31, 100)
    assert.equal(store.getItem(`${PREFIX}31`), '100')
  })
})
