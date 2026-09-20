/**
 * 网格密度。默认是「大图 1 列」—— 用户明确要求，标题完整显示并带演员、标签。
 */
export const DENSITIES = ['large', 'standard', 'compact']
export const DEFAULT_DENSITY = 'large'

export const DENSITY_LABELS = {
  large: ['大图', 'Large'],
  standard: ['标准', 'Standard'],
  compact: ['紧凑', 'Compact'],
}

export const DENSITY_COLUMNS = {
  large: 1,
  standard: 2,
  compact: 3,
}

/** 需要显示演员行与标签行的密度（仅大图）。 */
export const DENSITY_SHOWS_DETAIL = {
  large: true,
  standard: false,
  compact: false,
}

const STORAGE_KEY = 'javboss-mobile:density'

export function normalizeDensity(value) {
  const key = String(value || '').trim()
  return DENSITIES.includes(key) ? key : DEFAULT_DENSITY
}

export function readStoredDensity(storage) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null)
  if (!store) return DEFAULT_DENSITY
  try {
    return normalizeDensity(store.getItem(STORAGE_KEY))
  } catch {
    return DEFAULT_DENSITY
  }
}

export function writeStoredDensity(value, storage) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null)
  if (!store) return
  try {
    store.setItem(STORAGE_KEY, normalizeDensity(value))
  } catch {
    /* 隐私模式下 localStorage 可能不可写，忽略即可 */
  }
}

/**
 * 屏幕够宽时自动升一档（横屏 / 折叠屏）。用户手动选过的密度优先。
 */
export function densityForWidth(width, chosen) {
  const picked = normalizeDensity(chosen)
  const w = Number(width)
  if (!Number.isFinite(w) || w <= 0) return picked
  if (w >= 820 && picked === 'compact') return 'compact'
  if (w >= 480) {
    if (picked === 'large') return 'standard'
    return picked
  }
  return picked
}
