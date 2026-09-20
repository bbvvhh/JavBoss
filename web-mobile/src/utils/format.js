/** 移动端专用的展示格式化（PC 端的 display.js 保持原样复制，不混入新逻辑）。 */

export function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  if (!total) return ''
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** 把秒数说成人话，用于「上次看到 49:32」。 */
export function formatClock(seconds) {
  return formatDuration(seconds) || '00:00'
}

export function formatDurationMinutes(seconds) {
  const total = Number(seconds)
  if (!Number.isFinite(total) || total <= 0) return ''
  return String(Math.max(1, Math.round(total / 60)))
}

export function formatReleaseDate(unixSeconds) {
  const value = Number(unixSeconds)
  if (!Number.isFinite(value) || value <= 0) return ''
  const date = new Date(value * 1000)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function formatCount(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return '0'
  return n.toLocaleString('en-US')
}
