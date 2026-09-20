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
