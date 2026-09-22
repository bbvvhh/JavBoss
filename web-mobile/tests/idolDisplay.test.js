import assert from 'node:assert/strict'
import test from 'node:test'
import { register } from 'node:module'

// src/ 里用 `@/...` 绝对导入，node 需要这个钩子才能解析（见 aliasLoader.mjs）。
register('./aliasLoader.mjs', import.meta.url)

const {
  calculateAge,
  formatBirthDate,
  formatBirthDateWithAge,
  formatBwh,
  formatCup,
  idolDisplayNames,
  idolMetaParts,
} = await import('../src/utils/idolDisplay.js')

test('formatCup 把 1–11 的序号换算成罩杯字母', () => {
  // 回归：详情页曾经直接打印序号，把「E 罩杯」显示成「5」。
  assert.match(formatCup(5), /^E/)
  assert.match(formatCup(1), /^A/)
  assert.match(formatCup(11), /^K/)
})

test('formatCup 对空值 / 非法值返回空串', () => {
  assert.equal(formatCup(null), '')
  assert.equal(formatCup(undefined), '')
  assert.equal(formatCup(0), '')
  assert.equal(formatCup(-3), '')
  assert.equal(formatCup('abc'), '')
})

test('formatBirthDate 兼容 RFC3339 字符串与 Date', () => {
  assert.equal(formatBirthDate('1995-01-02T00:00:00Z'), '1995-01-02')
  assert.equal(formatBirthDate('1995-01-02'), '1995-01-02')
  assert.equal(formatBirthDate(new Date('1995-01-02T00:00:00Z')), '1995-01-02')
  assert.equal(formatBirthDate(''), '')
  assert.equal(formatBirthDate(null), '')
  assert.equal(formatBirthDate('不是日期'), '')
})

test('calculateAge 只有在生日当天才长一岁', () => {
  const now = new Date('2025-06-15T12:00:00')
  assert.equal(calculateAge('2000-06-15', now), 25)
  assert.equal(calculateAge('2000-06-16', now), 24)
  assert.equal(calculateAge('2000-06-14', now), 25)
  assert.equal(calculateAge('bad-date', now), null)
})

test('formatBirthDateWithAge 带上年龄，算不出年龄时退化成日期', () => {
  const now = new Date('2025-06-15T12:00:00')
  assert.ok(formatBirthDateWithAge('2000-06-15', now).includes('2000-06-15'))
  assert.ok(formatBirthDateWithAge('2000-06-15', now).includes('25'))
  assert.equal(formatBirthDateWithAge('', now), '')
})

test('formatBwh 三项齐全才输出 B-W-H 三围', () => {
  assert.equal(formatBwh({ bust: 88, waist: 58, hips: 90 }), '88-58-90')
  // 缺任何一项都不显示，避免半截数字被当成三围。
  assert.equal(formatBwh({ bust: 88, waist: 58 }), '')
  assert.equal(formatBwh({}), '')
  assert.equal(formatBwh(null), '')
})

test('idolDisplayNames 默认主名是 name、次名是中文名', () => {
  const idol = { name: 'Yui Hatano', chinese_name: '波多野结衣' }
  assert.deepEqual(idolDisplayNames(idol, false), {
    primary: 'Yui Hatano',
    secondary: '波多野结衣',
  })
  assert.deepEqual(idolDisplayNames(idol, true), {
    primary: '波多野结衣',
    secondary: 'Yui Hatano',
  })
})

test('idolDisplayNames 只有中文名 / 两个名字相同时不重复展示', () => {
  assert.deepEqual(idolDisplayNames({ chinese_name: '波多野结衣' }, false), {
    primary: '波多野结衣',
    secondary: '',
  })
  assert.deepEqual(idolDisplayNames({ name: '同名', chinese_name: '同名' }, true), {
    primary: '同名',
    secondary: '',
  })
  assert.deepEqual(idolDisplayNames(null, false), { primary: '', secondary: '' })
})

test('idolMetaParts 汇总年龄 / 三围 / 罩杯，缺失项自动跳过', () => {
  const now = new Date('2025-06-15T12:00:00')
  const parts = idolMetaParts(
    { birth_date: '2000-06-15T00:00:00Z', bust: 88, waist: 58, hips: 90, cup: 5 },
    now
  )
  assert.equal(parts.length, 3)
  assert.match(parts[0], /25/)
  assert.equal(parts[1], '88-58-90')
  assert.match(parts[2], /^E/)

  assert.deepEqual(idolMetaParts({}, now), [])
  // 只有罩杯时也要能显示出来。
  assert.deepEqual(idolMetaParts({ cup: 2 }, now), [formatCup(2)])
})
