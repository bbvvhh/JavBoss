// JAV 排序选项（与 PC 端 web/src/constants/jav.js 的 JAV_SORT_OPTIONS 对齐，
// 移动端只保留列表页需要的部分）。
export const JAV_SORT_OPTIONS = [
  {
    base: 'recent',
    ascValue: 'recent_asc',
    descValue: 'recent',
    label: ['加入时间', 'Added'],
    asc: ['远→近', 'old→new'],
    desc: ['近→远', 'new→old'],
  },
  {
    base: 'code',
    ascValue: 'code',
    descValue: 'code_desc',
    label: ['番号', 'Code'],
    asc: ['A→Z', 'A→Z'],
    desc: ['Z→A', 'Z→A'],
  },
  {
    base: 'release',
    ascValue: 'release_asc',
    descValue: 'release',
    label: ['发行时间', 'Release'],
    asc: ['旧→新', 'old→new'],
    desc: ['新→旧', 'new→old'],
  },
  {
    base: 'duration',
    ascValue: 'duration_asc',
    descValue: 'duration',
    label: ['时长', 'Duration'],
    asc: ['短→长', 'short→long'],
    desc: ['长→短', 'long→short'],
  },
  {
    base: 'favorite_rating',
    ascValue: 'favorite_rating_asc',
    descValue: 'favorite_rating',
    label: ['喜爱度', 'Rating'],
    asc: ['低→高', 'low→high'],
    desc: ['高→低', 'high→low'],
  },
  {
    base: 'play_count',
    ascValue: 'play_count_asc',
    descValue: 'play_count',
    label: ['播放次数', 'Plays'],
    asc: ['少→多', 'low→high'],
    desc: ['多→少', 'high→low'],
  },
]

const allValues = new Set(JAV_SORT_OPTIONS.flatMap((option) => [option.ascValue, option.descValue]))

export function normalizeJavSort(sort, fallback = 'recent') {
  const key = String(sort || '')
    .trim()
    .toLowerCase()
  return allValues.has(key) ? key : fallback
}

export function findJavSortOption(sort) {
  const key = String(sort || '')
    .trim()
    .toLowerCase()
  return JAV_SORT_OPTIONS.find((option) => option.ascValue === key || option.descValue === key)
}

export function isJavSortAscending(sort) {
  const option = findJavSortOption(sort)
  if (!option) return false
  return String(sort || '').toLowerCase() === option.ascValue
}

export function javSortLabel(option) {
  return option ? option.label : JAV_SORT_OPTIONS[0].label
}

/**
 * 方向切换按钮的文案。
 * 直接用该排序项自己的方向描述，不做通用化改写 ——
 * 否则「加入时间」的降序会显示成毫无意义的「大→小」。
 */
export function javSortDirections(option) {
  const source = option || JAV_SORT_OPTIONS[0]
  return { asc: source.asc, desc: source.desc }
}

/** 网格密度：大图 → 作品 1 列 / 女优 2 列；标准 → 2 / 3；紧凑 → 3 / 4。 */
export const JAV_DENSITIES = ['large', 'standard', 'compact']

export const DEFAULT_JAV_DENSITY = 'standard'

export const JAV_DENSITY_LABELS = {
  large: ['大图', 'Large'],
  standard: ['标准', 'Standard'],
  compact: ['紧凑', 'Compact'],
}

export const JAV_DENSITY_COLUMNS = {
  large: { works: 1, idols: 2 },
  standard: { works: 2, idols: 3 },
  compact: { works: 3, idols: 4 },
}

export function normalizeJavDensity(value) {
  const key = String(value || '').trim()
  return JAV_DENSITIES.includes(key) ? key : DEFAULT_JAV_DENSITY
}

// 女优排序选项（从 web/src/constants/jav.js 复制，设置页的默认排序与女优页的排序都用它）。
export const IDOL_SORT_OPTIONS = [
  {
    base: 'work',
    defaultValue: 'work',
    ascValue: 'work_asc',
    descValue: 'work',
    label: ['作品数量', 'Work count'],
    asc: ['少→多', 'low→high'],
    desc: ['多→少', 'high→low'],
  },
  {
    base: 'recent',
    defaultValue: 'recent',
    ascValue: 'recent_asc',
    descValue: 'recent',
    label: ['加入时间', 'Added time'],
    asc: ['远→近', 'old→new'],
    desc: ['近→远', 'new→old'],
  },
  {
    base: 'birth',
    defaultValue: 'birth',
    ascValue: 'birth',
    descValue: 'birth_asc',
    label: ['年龄', 'Age'],
    asc: ['小→大', 'young→old'],
    desc: ['大→小', 'old→young'],
  },
  {
    base: 'height',
    defaultValue: 'height',
    ascValue: 'height',
    descValue: 'height_desc',
    label: ['身高', 'Height'],
    asc: ['低→高', 'short→tall'],
    desc: ['高→低', 'tall→short'],
  },
  {
    base: 'bust',
    defaultValue: 'bust',
    ascValue: 'bust_asc',
    descValue: 'bust',
    label: ['胸围', 'Bust'],
    asc: ['小→大', 'small→large'],
    desc: ['大→小', 'large→small'],
  },
  {
    base: 'hips',
    defaultValue: 'hips',
    ascValue: 'hips_asc',
    descValue: 'hips',
    label: ['臀围', 'Hips'],
    asc: ['小→大', 'small→large'],
    desc: ['大→小', 'large→small'],
  },
  {
    base: 'waist',
    defaultValue: 'waist',
    ascValue: 'waist',
    descValue: 'waist_desc',
    label: ['腰围', 'Waist'],
    asc: ['小→大', 'small→large'],
    desc: ['大→小', 'large→small'],
  },
  {
    base: 'cup',
    defaultValue: 'cup',
    ascValue: 'cup_asc',
    descValue: 'cup',
    label: ['罩杯', 'Cup'],
    asc: ['小→大', 'small→large'],
    desc: ['大→小', 'large→small'],
  },
]

const idolSortValues = new Set(
  IDOL_SORT_OPTIONS.flatMap((option) => [option.ascValue, option.descValue])
)

export function normalizeIdolSort(sort, fallback = 'work') {
  const key = String(sort || '')
    .trim()
    .toLowerCase()
  return idolSortValues.has(key) ? key : fallback
}

export function findIdolSortOption(sort) {
  const key = String(sort || '')
    .trim()
    .toLowerCase()
  return IDOL_SORT_OPTIONS.find((option) => option.ascValue === key || option.descValue === key)
}

export function idolSortLabel(option) {
  return option ? option.label : IDOL_SORT_OPTIONS[0].label
}

export function isIdolSortAscending(sort) {
  const option = findIdolSortOption(sort)
  if (!option) return false
  return String(sort || '').toLowerCase() === option.ascValue
}

/** 方向按钮的文案：用排序项自己的方向描述，不做通用化改写（与 JAV 排序同因）。 */
export function idolSortDirections(option) {
  const source = option || IDOL_SORT_OPTIONS[0]
  return { asc: source.asc, desc: source.desc }
}

export function reverseIdolSortValue(sort) {
  const option = findIdolSortOption(sort)
  if (!option) return IDOL_SORT_OPTIONS[0].defaultValue
  return isIdolSortAscending(sort) ? option.descValue : option.ascValue
}

/**
 * 女优「资料范围筛选」的定义（与 PC 端 IDOL_PROFILE_FILTER_DEFINITIONS 一致）。
 * 区间上下限就是后端 parseJavIdolIntRange 的合法范围，超出会被整单 400，
 * 所以归一化时必须 clamp 到这两个值之间。
 */
export const IDOL_PROFILE_FILTER_DEFINITIONS = [
  { key: 'height', label: ['身高', 'Height'], min: 130, max: 190, unit: 'cm' },
  { key: 'age', label: ['年龄', 'Age'], min: 18, max: 60, unit: ['岁', 'y'] },
  { key: 'cup', label: ['罩杯', 'Cup'], min: 1, max: 11, format: 'cup' },
  { key: 'bust', label: ['胸围', 'Bust'], min: 60, max: 130, unit: 'cm' },
  { key: 'waist', label: ['腰围', 'Waist'], min: 45, max: 100, unit: 'cm' },
  { key: 'hips', label: ['臀围', 'Hips'], min: 65, max: 130, unit: 'cm' },
]

export function createDefaultIdolProfileFilters() {
  return Object.fromEntries(
    IDOL_PROFILE_FILTER_DEFINITIONS.map((definition) => [
      definition.key,
      { enabled: false, min: definition.min, max: definition.max },
    ])
  )
}

export function normalizeIdolProfileFilters(value) {
  const source = value && typeof value === 'object' ? value : {}
  return Object.fromEntries(
    IDOL_PROFILE_FILTER_DEFINITIONS.map((definition) => {
      const candidate = source[definition.key] || {}
      const rawMin = Number(candidate.min)
      const rawMax = Number(candidate.max)
      const min = Math.max(
        definition.min,
        Math.min(definition.max, Number.isFinite(rawMin) ? Math.round(rawMin) : definition.min)
      )
      const max = Math.max(
        min,
        Math.min(definition.max, Number.isFinite(rawMax) ? Math.round(rawMax) : definition.max)
      )
      return [definition.key, { enabled: Boolean(candidate.enabled), min, max }]
    })
  )
}

/** 单个边界值 → 展示文案（罩杯转成 A–K 字母，其它带单位）。 */
export function formatIdolProfileValue(definition, value, translate = (cn) => cn) {
  if (definition.format === 'cup') return String.fromCharCode(64 + value)
  const unit = Array.isArray(definition.unit)
    ? translate(definition.unit[0], definition.unit[1])
    : definition.unit || ''
  return `${value}${unit}`
}

export function formatIdolProfileRange(definition, value, translate = (cn) => cn) {
  const normalized = normalizeIdolProfileFilters({ [definition.key]: value })[definition.key]
  return `${formatIdolProfileValue(definition, normalized.min, translate)}–${formatIdolProfileValue(
    definition,
    normalized.max,
    translate
  )}`
}

/** 已启用的资料筛选数量（功能栏 chip 上的角标）。 */
export function idolProfileFilterCount(filters) {
  const normalized = normalizeIdolProfileFilters(filters)
  return IDOL_PROFILE_FILTER_DEFINITIONS.filter((definition) => normalized[definition.key].enabled)
    .length
}

/**
 * 已启用的资料筛选 → 请求参数列表（`fetchJavIdols` 的 profileRanges）。
 * 只保留启用的项：后端对「只给了一边」的区间直接 400。
 */
export function idolProfileRangeParams(filters) {
  const normalized = normalizeIdolProfileFilters(filters)
  return IDOL_PROFILE_FILTER_DEFINITIONS.filter(
    (definition) => normalized[definition.key].enabled
  ).map((definition) => ({ key: definition.key, ...normalized[definition.key] }))
}

export function buildSortChoices(options) {
  return options.flatMap((option) => [
    { value: option.descValue, label: `${option.label[0]}（${option.desc[0]}）` },
    { value: option.ascValue, label: `${option.label[0]}（${option.asc[0]}）` },
  ])
}
