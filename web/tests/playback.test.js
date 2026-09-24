import assert from 'node:assert/strict'
import test from 'node:test'
import { register } from 'node:module'

// src/ 里用 `@/...` 绝对导入，node 需要这个钩子才能解析（见 aliasLoader.mjs）。
register('./aliasLoader.mjs', import.meta.url)

const { MIN_RESUME_SECONDS, formatClock, formatPlayedAt, resumeSecondsFrom } = await import(
  '../src/utils/playback.js'
)

test('formatClock 输出 M:SS 与 H:MM:SS', () => {
  assert.equal(formatClock(0), '0:00')
  assert.equal(formatClock(9), '0:09')
  assert.equal(formatClock(754), '12:34')
  assert.equal(formatClock(3600), '1:00:00')
  assert.equal(formatClock(3723), '1:02:03')
})

test('formatClock 对非法值按 0 处理', () => {
  for (const value of [undefined, null, '', 'abc', Number.NaN, -5]) {
    assert.equal(formatClock(value), '0:00')
  }
})

test('formatPlayedAt 用今天/昨天描述最近的记录', () => {
  const now = new Date(2026, 8, 23, 20, 30, 0)
  assert.equal(formatPlayedAt(new Date(2026, 8, 23, 9, 5, 0).toISOString(), now), '今天 09:05')
  assert.equal(formatPlayedAt(new Date(2026, 8, 22, 23, 59, 0).toISOString(), now), '昨天 23:59')
})

test('formatPlayedAt 同年用月日、跨年带年份', () => {
  const now = new Date(2026, 8, 23, 20, 30, 0)
  assert.equal(formatPlayedAt(new Date(2026, 2, 7, 8, 0, 0).toISOString(), now), '3 月 7 日 08:00')
  assert.equal(
    formatPlayedAt(new Date(2025, 11, 31, 23, 0, 0).toISOString(), now),
    '2025/12/31 23:00'
  )
})

test('formatPlayedAt 遇到无法解析的时间返回空串', () => {
  assert.equal(formatPlayedAt(''), '')
  assert.equal(formatPlayedAt('not-a-date'), '')
})

test('resumeSecondsFrom 只对越过片头阈值的记录返回进度', () => {
  assert.equal(resumeSecondsFrom({ position_sec: MIN_RESUME_SECONDS }), MIN_RESUME_SECONDS)
  assert.equal(resumeSecondsFrom({ position_sec: MIN_RESUME_SECONDS - 0.5 }), 0)
  assert.equal(resumeSecondsFrom({ position_sec: 600 }), 600)
  assert.equal(resumeSecondsFrom(null), 0)
  assert.equal(resumeSecondsFrom({}), 0)
  assert.equal(resumeSecondsFrom({ position_sec: '750.5' }), 750.5)
})
