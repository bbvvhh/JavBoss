import test from 'node:test'
import assert from 'node:assert/strict'

import {
  FINE_DRAG_FACTOR,
  SEEK_DRAG_MIN_SECONDS_PER_PIXEL,
  SEEK_STEP_SECONDS,
  applyFineDrag,
  clampTime,
  formatSeekClock,
  formatSeekDelta,
  pointerTime,
  ratioForTime,
  secondsPerPixel,
  seekDragSecondsPerPixel,
  seekTimeForDrag,
  stepTime,
  timeForRatio,
} from '../src/utils/seekMath.js'

const DURATION = 7200 // 两小时，就是「一点就是一截」最典型的场景

test('clampTime 夹在 [0, duration]，时长未知时退化成 0', () => {
  assert.equal(clampTime(-5, 100), 0)
  assert.equal(clampTime(150, 100), 100)
  assert.equal(clampTime(30, 100), 30)
  assert.equal(clampTime(NaN, 100), 0)
  assert.equal(clampTime(30, NaN), 0)
  assert.equal(clampTime(30, 0), 0)
})

test('比例与秒数互转，并且夹住两端', () => {
  assert.equal(timeForRatio(0.5, DURATION), 3600)
  assert.equal(timeForRatio(-1, DURATION), 0)
  assert.equal(timeForRatio(3, DURATION), DURATION)
  assert.equal(timeForRatio(NaN, DURATION), 0)
  assert.equal(timeForRatio(0.5, NaN), 0)

  assert.equal(ratioForTime(3600, DURATION), 0.5)
  assert.equal(ratioForTime(-10, DURATION), 0)
  assert.equal(ratioForTime(99999, DURATION), 1)
  assert.equal(ratioForTime(100, 0), 0, '时长未知时不能除出 Infinity')
})

test('比例 → 秒 → 比例 可以来回', () => {
  for (const ratio of [0, 0.01, 0.25, 0.5, 0.99, 1]) {
    assert.ok(Math.abs(ratioForTime(timeForRatio(ratio, DURATION), DURATION) - ratio) < 1e-9)
  }
})

test('每像素秒数：这就是「精度太低」的量化来源', () => {
  // 390px 手机屏，轨道去掉左右各 10px 内边距 → 370px，2 小时的片子
  const perPixel = secondsPerPixel(DURATION, 370)
  assert.ok(perPixel > 19 && perPixel < 20, `期望约 19.5 秒/像素，实际 ${perPixel}`)

  // 精细模式把它放大 FINE_DRAG_FACTOR 倍：精细下 10 像素 = 普通下 1 像素
  const fineDelta = applyFineDrag(3600, FINE_DRAG_FACTOR, DURATION, 370) - 3600
  assert.ok(Math.abs(fineDelta - perPixel) < 1e-9, '精细模式应把位移缩小 10 倍')

  assert.equal(secondsPerPixel(DURATION, 0), 0)
  assert.equal(secondsPerPixel(0, 370), 0)
})

test('pointerTime 用轨道矩形换算，越界夹住', () => {
  const track = { left: 10, width: 370 }
  assert.equal(pointerTime(10, track, DURATION), 0)
  assert.equal(pointerTime(380, track, DURATION), DURATION)
  assert.equal(pointerTime(195, track, DURATION), 3600)
  // 拖出轨道外也不会跳飞
  assert.equal(pointerTime(-500, track, DURATION), 0)
  assert.equal(pointerTime(5000, track, DURATION), DURATION)
  assert.equal(pointerTime(100, { left: 0, width: 0 }, DURATION), 0)
})

test('精细拖动以锚点为基准，位移按 1/10 生效', () => {
  const track = { left: 0, width: 370 }
  const perPixel = secondsPerPixel(DURATION, track.width)
  // 进入精细模式时在 01:00:00
  const anchor = 3600
  assert.equal(applyFineDrag(anchor, 0, DURATION, track.width), anchor)
  assert.ok(
    Math.abs(applyFineDrag(anchor, 10, DURATION, track.width) - (anchor + perPixel)) < 1e-9,
    '10 像素 ≈ 2 秒'
  )
  assert.equal(applyFineDrag(anchor, -1e6, DURATION, track.width), 0, '向前夹到 0')
  assert.equal(applyFineDrag(anchor, 1e6, DURATION, track.width), DURATION, '向后夹到片尾')
  assert.equal(applyFineDrag(NaN, NaN, DURATION, track.width), 0)
})

test('步进按钮：精确到秒，且不会越过两端', () => {
  assert.equal(stepTime(100, SEEK_STEP_SECONDS, DURATION), 110)
  assert.equal(stepTime(100, -SEEK_STEP_SECONDS, DURATION), 90)
  assert.equal(stepTime(5, -SEEK_STEP_SECONDS, DURATION), 0)
  assert.equal(stepTime(DURATION - 3, SEEK_STEP_SECONDS, DURATION), DURATION)
  assert.equal(stepTime(NaN, SEEK_STEP_SECONDS, DURATION), 10)
})

test('画面拖动灵敏度：1~3 秒/像素，且与屏幕宽度无关', () => {
  assert.equal(seekDragSecondsPerPixel(600), 1.0833333333333333)
  assert.equal(seekDragSecondsPerPixel(3600), 1.5)
  assert.equal(seekDragSecondsPerPixel(DURATION), 2, '2 小时 → 2 秒/像素')
  assert.equal(seekDragSecondsPerPixel(36000), 3, '超长片夹在上限')
  assert.equal(seekDragSecondsPerPixel(0), SEEK_DRAG_MIN_SECONDS_PER_PIXEL)
  assert.equal(seekDragSecondsPerPixel(NaN), SEEK_DRAG_MIN_SECONDS_PER_PIXEL)
})

test('画面拖动调进度：位移 × 每像素秒数，跟屏幕宽度无关', () => {
  assert.equal(seekTimeForDrag(1000, 0, DURATION), 1000, '不动就不跳')
  assert.equal(seekTimeForDrag(1000, 30, DURATION, 2), 1060, '按默认 2 秒/像素')
  assert.equal(seekTimeForDrag(1000, -30, DURATION, 2), 940)
  // 一次顺手滑动（100px）在 2 小时的片子上只走 200 秒，而不是原来的十几分钟
  assert.equal(seekTimeForDrag(0, 100, DURATION), 200)
})

test('画面拖动两端夹住，锚点稳定不漂移', () => {
  const anchor = 1800
  assert.equal(seekTimeForDrag(100, -1000, DURATION, 2), 0, '往前夹到片头')
  assert.equal(seekTimeForDrag(DURATION - 10, 1000, DURATION, 2), DURATION, '往后夹到片尾')
  // 滑过去再回到起点，目标时间必须回到锚点
  assert.ok(seekTimeForDrag(anchor, 50, DURATION) > anchor)
  assert.equal(seekTimeForDrag(anchor, 0, DURATION), anchor)
  assert.equal(seekTimeForDrag(NaN, NaN, DURATION), 0)
})

test('时间文本：0 也要给 00:00，不能是空白', () => {
  assert.equal(formatSeekClock(0), '00:00')
  assert.equal(formatSeekClock(59), '00:59')
  assert.equal(formatSeekClock(60), '01:00')
  assert.equal(formatSeekClock(3599), '59:59')
  assert.equal(formatSeekClock(3600), '01:00:00')
  assert.equal(formatSeekClock(DURATION), '02:00:00')
  assert.equal(formatSeekClock(-5), '00:00')
  assert.equal(formatSeekClock(NaN), '00:00')
})

test('增量文本带符号，0 不带符号', () => {
  assert.equal(formatSeekDelta(10), '+00:10')
  assert.equal(formatSeekDelta(-90), '-01:30')
  assert.equal(formatSeekDelta(0), '00:00')
  assert.equal(formatSeekDelta(3600), '+01:00:00')
})
