import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BOOST_LADDER,
  BOOST_SPEED_CHOICES,
  BOOST_VERTICAL_STEP_PX,
  DEFAULT_BOOST_SPEED,
  boostSpeedForDrag,
  boostSpeedForVerticalDrag,
  clampSpeedIndex,
  formatBoostSpeed,
} from '../src/utils/boostSpeed.js'

test('倍速档位是 0.25x 一档，从原速到 3x，不做慢放', () => {
  assert.deepEqual(BOOST_LADDER, [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3])
  assert.equal(BOOST_LADDER[0], 1)
  assert.ok(BOOST_LADDER.includes(DEFAULT_BOOST_SPEED))
})

test('不滑动时保持默认倍速，而不是回到 1x', () => {
  assert.equal(boostSpeedForDrag(0), DEFAULT_BOOST_SPEED)
  assert.equal(boostSpeedForDrag(0), 2)
})

test('灵敏度：每 BOOST_VERTICAL_STEP_PX 换 0.25x', () => {
  assert.equal(BOOST_VERTICAL_STEP_PX, 20)
  assert.equal(boostSpeedForDrag(20), 2.25)
  assert.equal(boostSpeedForDrag(40), 2.5)
  assert.equal(boostSpeedForDrag(-20), 1.75)
  assert.equal(boostSpeedForDrag(-40), 1.5)
  // 半步（10px）就该换档 —— 真机上轻轻一动也要有反应
  assert.equal(boostSpeedForDrag(10), 2.25)
  assert.equal(boostSpeedForDrag(-10), 1.75)
})

test('上下滑动：向上加速、向下减速（屏幕坐标向下为正）', () => {
  assert.equal(boostSpeedForVerticalDrag(0), DEFAULT_BOOST_SPEED)
  assert.equal(boostSpeedForVerticalDrag(-20), 2.25, '向上滑 = 更快')
  assert.equal(boostSpeedForVerticalDrag(-40), 2.5)
  assert.equal(boostSpeedForVerticalDrag(20), 1.75, '向下滑 = 更慢')
  assert.equal(boostSpeedForVerticalDrag(40), 1.5)
})

test('两个方向对称：正负同样的位移换同样的档数', () => {
  for (const distance of [10, 20, 30, 50, 70]) {
    const up = BOOST_LADDER.indexOf(boostSpeedForDrag(distance))
    const down = BOOST_LADDER.indexOf(boostSpeedForDrag(-distance))
    const anchor = BOOST_LADDER.indexOf(DEFAULT_BOOST_SPEED)
    assert.equal(up - anchor, anchor - down, `${distance}px 两个方向档数不对称`)
  }
})

test('两端都夹住，不会滑出档位表', () => {
  assert.equal(boostSpeedForDrag(10000), 3)
  assert.equal(boostSpeedForVerticalDrag(-10000), 3)
  assert.equal(boostSpeedForDrag(-10000), 1, '最下面就是原速，不做慢放')
  assert.equal(boostSpeedForVerticalDrag(10000), 1)
})

test('可以从设置里的非默认档位起步', () => {
  assert.equal(boostSpeedForDrag(0, { speed: 1.5 }), 1.5)
  assert.equal(boostSpeedForDrag(20, { speed: 1.5 }), 1.75)
  assert.equal(boostSpeedForDrag(-20, { speed: 1.5 }), 1.25)
})

test('非法 / 未知倍速回落到默认档，而不是返回 undefined', () => {
  assert.equal(boostSpeedForDrag(0, { speed: 99 }), DEFAULT_BOOST_SPEED)
  assert.equal(boostSpeedForDrag(0, { speed: NaN }), DEFAULT_BOOST_SPEED)
  assert.equal(boostSpeedForDrag(NaN), DEFAULT_BOOST_SPEED)
  assert.equal(boostSpeedForVerticalDrag(NaN), DEFAULT_BOOST_SPEED)
})

test('单调不减：来回滑动不会出现倍速回退', () => {
  let previous = -Infinity
  for (let offset = -300; offset <= 300; offset += 5) {
    const speed = boostSpeedForDrag(offset)
    assert.ok(speed >= previous, `offset=${offset} 时倍速回退了`)
    previous = speed
  }
})

test('自定义档位与步长', () => {
  const ladder = [1, 2, 4]
  assert.equal(boostSpeedForDrag(0, { ladder, speed: 2, stepPx: 10 }), 2)
  assert.equal(boostSpeedForDrag(10, { ladder, speed: 2, stepPx: 10 }), 4)
  assert.equal(boostSpeedForDrag(-10, { ladder, speed: 2, stepPx: 10 }), 1)
  assert.equal(boostSpeedForDrag(0, { ladder: [], speed: 2 }), DEFAULT_BOOST_SPEED)
})

test('clampSpeedIndex 两边都夹住，非数字当 0', () => {
  assert.equal(clampSpeedIndex(-5), 0)
  assert.equal(clampSpeedIndex(999), BOOST_LADDER.length - 1)
  assert.equal(clampSpeedIndex(NaN), 0)
  assert.equal(clampSpeedIndex('3'), 3)
})

test('设置页档位是梯子的粗档子集，Segmented 放得下', () => {
  assert.deepEqual(BOOST_SPEED_CHOICES, [1.5, 2, 2.5, 3])
  assert.ok(BOOST_SPEED_CHOICES.length <= 4)
  for (const speed of BOOST_SPEED_CHOICES) {
    assert.ok(BOOST_LADDER.includes(speed), '设置里能选的档位必须在梯子上')
  }
  assert.ok(BOOST_SPEED_CHOICES.includes(DEFAULT_BOOST_SPEED))
})

test('formatBoostSpeed 输出倍速文案', () => {
  assert.equal(formatBoostSpeed(2), '2x')
  assert.equal(formatBoostSpeed(1.25), '1.25x')
  assert.equal(formatBoostSpeed(undefined), '')
})
