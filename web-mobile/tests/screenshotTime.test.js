import test from 'node:test'
import assert from 'node:assert/strict'

import { screenshotStartTime } from '../src/utils/screenshotTime.js'

test('screenshotStartTime 解析 MPV / 移动端统一的 mpv_HH-MM-SS 命名', () => {
  assert.equal(screenshotStartTime('mpv_00-05-12.jpg'), 312)
  assert.equal(screenshotStartTime('mpv_01-02-03.jpg'), 3723)
  assert.equal(screenshotStartTime('mpv_00-00-00.png'), 0)
})

test('screenshotStartTime 保留毫秒小数', () => {
  assert.equal(screenshotStartTime('mpv_00-00-01.500.jpg'), 1.5)
})

test('screenshotStartTime 对非截图命名返回 null', () => {
  assert.equal(screenshotStartTime('cover.jpg'), null)
  assert.equal(screenshotStartTime('mpv_5-12.jpg'), null)
  assert.equal(screenshotStartTime(''), null)
  assert.equal(screenshotStartTime(null), null)
  assert.equal(screenshotStartTime(undefined), null)
})
