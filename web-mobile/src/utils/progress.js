/**
 * 播放进度记忆。只写 localStorage，不碰任何文件。
 */
const PREFIX = 'javboss-mobile:progress:'
// 少于这个秒数不记（片头），避免「续播」跳到开头。
const MIN_RESUME_SECONDS = 15

function key(videoId) {
  return `${PREFIX}${videoId}`
}

export function readProgress(videoId) {
  if (!videoId) return 0
  try {
    const raw = localStorage.getItem(key(videoId))
    const value = Number(raw)
    return Number.isFinite(value) && value > MIN_RESUME_SECONDS ? value : 0
  } catch {
    return 0
  }
}

export function writeProgress(videoId, seconds) {
  if (!videoId) return
  const value = Math.floor(Number(seconds) || 0)
  if (value < MIN_RESUME_SECONDS) return
  try {
    localStorage.setItem(key(videoId), String(value))
  } catch {
    /* 忽略隐私模式下的写入失败 */
  }
}

export function clearProgress(videoId) {
  if (!videoId) return
  try {
    localStorage.removeItem(key(videoId))
  } catch {
    /* 忽略 */
  }
}

export const __progressInternals = { MIN_RESUME_SECONDS }
