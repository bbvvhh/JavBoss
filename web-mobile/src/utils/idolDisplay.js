/**
 * 女优资料的展示格式化。
 *
 * 关键点：**罩杯在数据库里存的是 1–11 的序号，不是字母**（见 internal/models/jav.go
 * 的 `Cup *int` 与 PC 端 `JavIdolGrid.formatCup`）。移动端早期直接把序号打在
 * 详情页上，于是「E 罩杯」显示成了「5」——这个模块把两端的算法统一到一处。
 */
import { zh } from '@/utils/i18n'

/** 罩杯序号 → 「E罩杯」/「E cup」。非法 / 缺省值返回空串。 */
export function formatCup(value) {
  const index = Number(value)
  if (!Number.isFinite(index) || index <= 0) return ''
  const letter = String.fromCharCode(64 + Math.min(26, Math.round(index)))
  return zh(`${letter}罩杯`, `${letter} cup`)
}

/** 只要日期部分，兼容 RFC3339 字符串（后端 time.Time 的 JSON 形式）与 Date。 */
export function formatBirthDate(value) {
  if (!value) return ''
  if (typeof value === 'string') {
    const raw = value.trim()
    return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : ''
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }
  return ''
}

/** 按「生日当天才算长一岁」算年龄，生日非法时返回 null。 */
export function calculateAge(birthDate, now = new Date()) {
  const date = new Date(`${birthDate}T00:00:00`)
  if (Number.isNaN(date.getTime())) return null
  let age = now.getFullYear() - date.getFullYear()
  const monthDiff = now.getMonth() - date.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < date.getDate())) {
    age -= 1
  }
  return age
}

/** 「1995-01-01（30岁）」；算不出年龄时退化成出生日期。 */
export function formatBirthDateWithAge(value, now = new Date()) {
  const birthDate = formatBirthDate(value)
  if (!birthDate) return ''
  const age = calculateAge(birthDate, now)
  if (!Number.isFinite(age) || age < 0) return birthDate
  return zh(`${birthDate}（${age}岁）`, `${birthDate} (${age})`)
}

/** 三围「88-58-88」（B-W-H）。三项齐全才显示，避免半截数字误导。 */
export function formatBwh(item) {
  const bust = Number(item?.bust)
  const waist = Number(item?.waist)
  const hips = Number(item?.hips)
  const ok = (value) => Number.isFinite(value) && value > 0
  if (!ok(bust) || !ok(waist) || !ok(hips)) return ''
  return `${bust}-${waist}-${hips}`
}

/**
 * 女优名的主 / 次显示。
 *
 * 与 PC 端 `web/src/utils/javIdol.js` 的 `getIdolDisplayNames` 保持一致：
 * 默认主名是 `name`、次名是翻译出来的 `chinese_name`；打开「优先显示中文名」
 * 之后两者互换。两者相同时不重复显示。
 */
export function idolDisplayNames(item, preferChineseName = false) {
  const name = String(item?.name || '').trim()
  const chineseName = String(item?.chinese_name || '').trim()
  if (preferChineseName && chineseName) {
    return { primary: chineseName, secondary: name === chineseName ? '' : name }
  }
  const primary = name || chineseName
  return { primary, secondary: chineseName && chineseName !== primary ? chineseName : '' }
}

/**
 * 列表卡片上的一行资料：年龄 / 三围 / 罩杯，缺失的项自动跳过。
 * 全部缺失时返回空数组，调用方据此少渲染一行。
 */
export function idolMetaParts(item, now = new Date()) {
  const age = calculateAge(formatBirthDate(item?.birth_date), now)
  const parts = []
  if (Number.isFinite(age) && age >= 0) {
    parts.push(zh(`${age}岁`, `${age} y/o`))
  }
  const bwh = formatBwh(item)
  if (bwh) parts.push(bwh)
  const cup = formatCup(item?.cup)
  if (cup) parts.push(cup)
  return parts
}
