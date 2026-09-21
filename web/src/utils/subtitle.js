import { zh } from '@/utils/i18n'

/** 内置的迅雷字幕搜索接口。{keyword} 会替换成番号或用户输入的关键词。 */
export const DEFAULT_SUBTITLE_API_URL =
  'https://api-shoulei-ssl.xunlei.com/oracle/subtitle?name={keyword}'

/**
 * 把毫秒格式的字幕时长格式化成 H:MM:SS / M:SS。
 * 接口返回的 duration 单位是毫秒，0 表示未知。
 */
export function formatSubtitleDuration(durationMs) {
  const ms = Number(durationMs)
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const totalSeconds = Math.round(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (value) => String(value).padStart(2, '0')
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`
  return `${minutes}:${pad(seconds)}`
}

/** 时长差（毫秒）→ 便于阅读的秒数差值，未知时返回空字符串。 */
export function formatDurationDelta(deltaMs) {
  const delta = Number(deltaMs)
  if (!Number.isFinite(delta) || delta < 0) return ''
  if (delta < 1000) return zh('时长一致', 'Same length')
  const seconds = Math.round(delta / 1000)
  if (seconds < 60) return zh(`差 ${seconds} 秒`, `${seconds}s off`)
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (rest === 0) return zh(`差 ${minutes} 分`, `${minutes}m off`)
  return zh(`差 ${minutes} 分 ${rest} 秒`, `${minutes}m ${rest}s off`)
}

/** 搜索结果与视频的匹配说明，用于列表里的次要说明文字。 */
export function describeSubtitleMatch(item) {
  if (!item) return ''
  const parts = []
  if (item.match_tier === 0) parts.push(zh('文件名完全匹配', 'Exact file name'))
  else if (item.match_tier === 1) parts.push(zh('文件名相近', 'Similar file name'))
  const delta = formatDurationDelta(item.duration_delta_ms)
  if (delta) parts.push(delta)
  if (item.extra_name) parts.push(String(item.extra_name))
  return parts.join(' · ')
}

/** 字幕条目的标题：优先展示字幕名，缺失时回退到文件名。 */
export function subtitleDisplayName(item) {
  if (!item) return ''
  return String(item.title || item.filename || '').trim() || zh('未命名字幕', 'Untitled subtitle')
}

/** 搜索结果的主标题，接口偶尔只给 hash 文件名。 */
export function searchResultTitle(item) {
  if (!item) return ''
  return String(item.name || '').trim() || zh('未命名字幕', 'Untitled subtitle')
}

/** 结果里语言为空时的占位文案。 */
export function subtitleLanguageLabel(item) {
  const language = String(item?.language || item?.languages || '').trim()
  return language || zh('未知语言', 'Unknown language')
}
