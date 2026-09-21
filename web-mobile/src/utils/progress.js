/**
 * 播放进度记忆与播放偏好。只写 localStorage，不碰任何文件。
 */
const PREFIX = 'javboss-mobile:progress:'
const RESUME_KEY = 'javboss-mobile:resume-enabled'
// 少于这个秒数不记（片头），避免「续播」跳到开头。
const MIN_RESUME_SECONDS = 15

function key(videoId) {
  return `${PREFIX}${videoId}`
}

function storage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** 续播开关（设备本地偏好，不影响服务端配置）。默认开启。 */
export function isResumeEnabled() {
  const store = storage()
  if (!store) return true
  try {
    return store.getItem(RESUME_KEY) !== 'false'
  } catch {
    return true
  }
}

export function setResumeEnabled(enabled) {
  const store = storage()
  if (!store) return
  try {
    store.setItem(RESUME_KEY, enabled ? 'true' : 'false')
  } catch {
    /* 忽略隐私模式下的写入失败 */
  }
}

export function readProgress(videoId) {
  if (!videoId || !isResumeEnabled()) return 0
  const store = storage()
  if (!store) return 0
  try {
    const raw = store.getItem(key(videoId))
    const value = Number(raw)
    return Number.isFinite(value) && value > MIN_RESUME_SECONDS ? value : 0
  } catch {
    return 0
  }
}

export function writeProgress(videoId, seconds) {
  if (!videoId || !isResumeEnabled()) return
  const value = Math.floor(Number(seconds) || 0)
  if (value < MIN_RESUME_SECONDS) return
  const store = storage()
  if (!store) return
  try {
    store.setItem(key(videoId), String(value))
  } catch {
    /* 忽略隐私模式下的写入失败 */
  }
}

export function clearProgress(videoId) {
  if (!videoId) return
  const store = storage()
  if (!store) return
  try {
    store.removeItem(key(videoId))
  } catch {
    /* 忽略 */
  }
}

/** 已记录进度的视频条数（设置页用来显示「共 N 部有观看记录」）。 */
export function countProgress() {
  const store = storage()
  if (!store) return 0
  try {
    let total = 0
    for (let i = 0; i < store.length; i += 1) {
      if (String(store.key(i) || '').startsWith(PREFIX)) total += 1
    }
    return total
  } catch {
    return 0
  }
}

/**
 * 清空全部本机观看进度。
 * 只删 localStorage 里自己写的前缀，不碰其它任何键。
 */
export function clearAllProgress() {
  const store = storage()
  if (!store) return 0
  try {
    const doomed = []
    for (let i = 0; i < store.length; i += 1) {
      const name = String(store.key(i) || '')
      if (name.startsWith(PREFIX)) doomed.push(name)
    }
    for (const name of doomed) store.removeItem(name)
    return doomed.length
  } catch {
    return 0
  }
}

export const __progressInternals = { MIN_RESUME_SECONDS, PREFIX, RESUME_KEY }
