import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BOOST_HOLD_MS,
  DOUBLE_TAP_MAX_MS,
  GESTURE_MOVE_TOLERANCE_PX,
  GESTURE_VERTICAL_TOLERANCE_PX,
  TAP_MAX_MS,
  isDoubleTap,
  isTapGesture,
  resolvePendingGesture,
} from '../src/utils/playerGesture.js'

test('长按阈值是 1 秒', () => {
  assert.equal(BOOST_HOLD_MS, 1000)
})

test('竖向阈值比横向宽松：长按那 1 秒的手抖不该把倍速弄没', () => {
  assert.ok(GESTURE_VERTICAL_TOLERANCE_PX > GESTURE_MOVE_TOLERANCE_PX)
  assert.equal(GESTURE_MOVE_TOLERANCE_PX, 14)
  assert.equal(GESTURE_VERTICAL_TOLERANCE_PX, 30)
})

test('手不动 → 继续等长按', () => {
  assert.equal(resolvePendingGesture(0, 0), 'pending')
  assert.equal(resolvePendingGesture(3, -4), 'pending')
  assert.equal(
    resolvePendingGesture(-GESTURE_MOVE_TOLERANCE_PX, 0),
    'pending',
    '刚好到横向阈值不算动'
  )
  assert.equal(
    resolvePendingGesture(0, GESTURE_VERTICAL_TOLERANCE_PX - 1),
    'pending',
    '竖向小晃动仍然等长按'
  )
})

test('横向先动 → 调进度', () => {
  assert.equal(resolvePendingGesture(GESTURE_MOVE_TOLERANCE_PX + 1, 0), 'seek')
  assert.equal(resolvePendingGesture(-GESTURE_MOVE_TOLERANCE_PX - 1, 5), 'seek')
})

test('竖向大幅度滑动 → 整个手势作废（让给系统亮度 / 音量手势）', () => {
  assert.equal(resolvePendingGesture(0, GESTURE_VERTICAL_TOLERANCE_PX + 1), 'cancel')
  assert.equal(resolvePendingGesture(2, -GESTURE_VERTICAL_TOLERANCE_PX - 1), 'cancel')
})

test('斜着滑时横向优先，按「想调进度」处理', () => {
  assert.equal(resolvePendingGesture(60, 40), 'seek')
})

test('自定义阈值与非数字输入', () => {
  assert.equal(resolvePendingGesture(11, 0, { horizontal: 10 }), 'seek')
  assert.equal(resolvePendingGesture(9, 0, { horizontal: 10 }), 'pending')
  assert.equal(resolvePendingGesture(0, 11, { vertical: 10 }), 'cancel')
  assert.equal(resolvePendingGesture(NaN, NaN), 'pending')
  assert.equal(resolvePendingGesture(undefined, undefined), 'pending')
  assert.equal(resolvePendingGesture(5, 0, { horizontal: 0 }), 'pending', '非法阈值回落到默认值')
})

test('双击参数：点击够短，双击间隔上限小于长按阈值', () => {
  assert.equal(TAP_MAX_MS, 250)
  assert.equal(DOUBLE_TAP_MAX_MS, 300)
  assert.ok(DOUBLE_TAP_MAX_MS < BOOST_HOLD_MS, '双击必须明显快于长按，否则会被倍速抢走')
})

test('点击判定：够快够稳才算点击', () => {
  const down = { x: 100, y: 200, time: 0 }
  assert.equal(isTapGesture(down, { x: 100, y: 200, time: 120 }), true, '原地快速抬起')
  assert.equal(isTapGesture(down, { x: 105, y: 203, time: 120 }), true, '几像素抖动仍是点击')
  assert.equal(
    isTapGesture(down, { x: 100, y: 200, time: TAP_MAX_MS + 1 }),
    false,
    '按太久不算点击'
  )
  assert.equal(isTapGesture(down, { x: 140, y: 200, time: 120 }), false, '位移太大不算点击')
  assert.equal(isTapGesture(null, { x: 0, y: 0, time: 1 }), false)
  assert.equal(isTapGesture(down, { x: 100, y: 200, time: -1 }), false, '时间倒退不算点击')
})

test('双击判定：两次点击够近够快才成立', () => {
  const first = { x: 100, y: 200, time: 0 }
  assert.equal(isDoubleTap(first, { x: 104, y: 203, time: 180 }), true)
  assert.equal(
    isDoubleTap(first, { x: 100, y: 200, time: DOUBLE_TAP_MAX_MS + 1 }),
    false,
    '间隔太久不算双击'
  )
  assert.equal(isDoubleTap(first, { x: 200, y: 200, time: 180 }), false, '落点差太远不算双击')
  assert.equal(isDoubleTap(null, first), false)
  assert.equal(isDoubleTap(first, null), false)
})
