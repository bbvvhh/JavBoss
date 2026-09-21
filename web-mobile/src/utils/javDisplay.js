import { configFlag, configInt, configString } from '@/utils/config'

/**
 * 把 PC 全局设置里**真正对移动端有意义**的显示项映射成移动端的显示偏好。
 *
 * 这里刻意只覆盖「在手机上确实会改变画面」的键。像 `jav_grid_columns`、
 * `jav_title_max_rows`、瀑布流默认值这些是桌面网格的概念 —— 移动端用顶部的
 * 密度切换（大图/标准/紧凑）表达同一件事，把它们的数值搬过来只会打架，
 * 所以设置页会把它们列在「桌面端专属」里说明，而不是假装生效。
 */
export function javDisplayPrefs(config) {
  return {
    hideIdols: configFlag(config, 'jav_hide_idols', false),
    hideTags: configFlag(config, 'jav_hide_tags', false),
    hideSeries: configFlag(config, 'jav_hide_series', false),
    preferChineseName: configFlag(config, 'jav_idol_prefer_chinese_name', false),
    simplifiedTags: configFlag(config, 'jav_tag_show_simplified', false),
  }
}

/** 女优名：开启「优先显示中文名」时用中文名，缺失则回退。 */
export function idolDisplayName(idol, preferChineseName) {
  if (!idol) return ''
  const name = String(idol.name || '').trim()
  const chinese = String(idol.chinese_name || '').trim()
  if (!preferChineseName) return name || chinese
  return chinese || name
}

/**
 * 标签名：开启「刮削标签显示简体」时优先用后端给的 `simplified_name`。
 * 该字段只在刮削标签上有（用户标签没有），缺失时自然回退原名。
 */
export function javTagDisplayName(tag, simplifiedTags) {
  if (!tag) return ''
  const name = String(tag.name || '').trim()
  if (!simplifiedTags) return name
  return String(tag.simplified_name || '').trim() || name
}

/** 列表每页数量：按 tab 取对应配置键，缺省与 PC 端一致。 */
export const JAV_PAGE_SIZE_KEYS = {
  works: 'jav_page_size',
  idols: 'idol_page_size',
  studios: 'studio_page_size',
  series: 'series_page_size',
}

export const JAV_PAGE_SIZE_DEFAULTS = {
  works: 24,
  idols: 24,
  studios: 25,
  series: 25,
}

export function javPageSize(config, tab) {
  const key = JAV_PAGE_SIZE_KEYS[tab] || JAV_PAGE_SIZE_KEYS.works
  const fallback = JAV_PAGE_SIZE_DEFAULTS[tab] ?? JAV_PAGE_SIZE_DEFAULTS.works
  const value = configInt(config, key, fallback)
  // 后端 clampSize 的上限是 500，超出的值一律按 500 处理，避免请求被静默忽略。
  return Math.max(1, Math.min(500, value))
}

/** 初次进入时的模式：由服务端 `initial_view_mode` 决定。 */
export function initialViewMode(config) {
  return configString(config, 'initial_view_mode', 'video') === 'jav' ? 'jav' : 'video'
}

/** 服务端配置里的 JAV / 女优默认排序，非法值交给各自的 normalize 兜底。 */
export function configuredJavSort(config) {
  return configString(config, 'jav_sort', '')
}

export function configuredIdolSort(config) {
  return configString(config, 'idol_sort', '')
}
