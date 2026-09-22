import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BOOST_HOLD_MS,
  GESTURE_MOVE_TOLERANCE_PX,
  GESTURE_VERTICAL_TOLERANCE_PX,
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
