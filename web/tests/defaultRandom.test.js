import assert from 'node:assert/strict'
import test from 'node:test'

import { shouldApplyDefaultRandom } from '../src/utils/defaultRandom.js'

test('applies random on a clean entry when enabled', () => {
  assert.equal(shouldApplyDefaultRandom({ random: false, tempSort: '', page: 1 }, true), true)
  // 没有 page（URL 里没写）同样算第一页。
  assert.equal(shouldApplyDefaultRandom({ random: false, tempSort: '' }, true), true)
})

test('does not apply when the setting is off', () => {
  assert.equal(shouldApplyDefaultRandom({ random: false, tempSort: '', page: 1 }, false), false)
})

test('keeps URL-provided random or temp sort', () => {
  assert.equal(shouldApplyDefaultRandom({ random: true, tempSort: '', page: 1 }, true), false)
  assert.equal(shouldApplyDefaultRandom({ random: false, tempSort: 'duration', page: 1 }, true), false)
})

test('does not override a deep-linked page', () => {
  assert.equal(shouldApplyDefaultRandom({ random: false, tempSort: '', page: 3 }, true), false)
  // 非法 page 视为第一页。
  assert.equal(shouldApplyDefaultRandom({ random: false, tempSort: '', page: 'x' }, true), true)
})

test('ignores a missing entry', () => {
  assert.equal(shouldApplyDefaultRandom(null, true), false)
})