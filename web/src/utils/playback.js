import { zh } from '@/utils/i18n'

// 播放进度短于这个秒数不提示续播（片头），移动端 localStorage 也是同一阈值。
export const MIN_RESUME_SECONDS = 15
// 播放记录浮层每页条数。
export const PLAYBACK_HISTORY_PAGE_SIZE = 50
// 浏览器播放器上报进度的节流间隔。
export const PLAYBACK_REPORT_INTERVAL_MS = 5000

/** 秒数格式化为 12:34 / 1:02:03；非法或负数按 0 处理。 */
export function formatClock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const pad = (value) => String(value).padStart(2, '0')
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(total % 60)}`
  return `${minutes}:${pad(total % 60)}`
}

/** 播放时间：今天/昨天用相对日期，同年用「月 日」，跨年带年份。 */
export function formatPlayedAt(value, now = new Date()) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (number) => String(number).padStart(2, '0')
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const startOfDay = (target) =>
    new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime()
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86400000)
  if (days === 0) return zh(`今天 ${clock}`, `Today ${clock}`)
  if (days === 1) return zh(`昨天 ${clock}`, `Yesterday ${clock}`)
  if (date.getFullYear() === now.getFullYear()) {
    return zh(
      `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${clock}`,
      `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${clock}`
    )
  }
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${clock}`
}

/** 播放记录是否值得提示续播：只看已记录的进度是否越过片头阈值。 */
export function resumeSecondsFrom(record) {
  const position = Number(record?.position_sec)
  if (!Number.isFinite(position) || position < MIN_RESUME_SECONDS) return 0
  return position
}
