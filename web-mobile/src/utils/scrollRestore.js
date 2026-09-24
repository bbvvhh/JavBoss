/**
 * 列表滚动位置的存取（点 4）。
 *
 * 用 sessionStorage 而不是 localStorage：位置属于「这一次浏览」，关掉标签页就该忘掉；
 * 同时它又能扛住刷新 —— 刷新后列表一开始是空的，浏览器的自动恢复根本够不到目标
 * 位置，只能靠我们自己等列表长起来再滚过去。
 *
 * 这里只放纯函数，真正的等待 / 监听在 `hooks/useScrollRestoration.js`。
 */

export const SCROLL_STORAGE_PREFIX = 'javboss:scroll:'
/** 等到列表长够高再滚过去，最多等这么久。 */
export const RESTORE_DEADLINE_MS = 3000
/** 差几个像素就不必再等加载了。 */
export const RESTORE_TOLERANCE = 24

export function scrollStorageKey(key) {
  return `${SCROLL_STORAGE_PREFIX}${key}`
}

/** sessionStorage 在隐私模式 / 沙箱 iframe 里可能直接取不到。 */
export function safeSessionStorage() {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

/** 取回保存的位置；没有 / 非法 / 非正数都算 0（= 从头开始）。 */
export function readScrollPosition(storage, key) {
  if (!storage || !key) return 0
  try {
    const value = Number(storage.getItem(scrollStorageKey(key)))
    return Number.isFinite(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

/** 保存位置；存不下（配额、隐私模式）时静默跳过，不能因此打断滚动。 */
export function writeScrollPosition(storage, key, y) {
  if (!storage || !key) return
  const value = Number(y)
  if (!Number.isFinite(value) || value < 0) return
  try {
    storage.setItem(scrollStorageKey(key), String(value))
  } catch {
    /* 存不下就算了，位置丢了不影响使用 */
  }
}

/** 目标位置不能超过当前能滚到的最大值，否则会「滚不到那么远」。 */
export function clampScrollTarget(target, maxY) {
  const value = Number(target)
  const limit = Number(maxY)
  if (!Number.isFinite(value) || value <= 0) return 0
  if (!Number.isFinite(limit) || limit <= 0) return 0
  return Math.min(value, limit)
}

/**
 * 还要不要继续等列表长高？
 *   - 已经够高（差在容差内）→ 不用等，直接滚
 *   - 等超时 → 不等了，能滚多远算多远
 *   - 否则继续等（并请调用方再拉一页）
 */
export function shouldWaitForMore({
  saved,
  maxY,
  elapsedMs,
  deadlineMs = RESTORE_DEADLINE_MS,
  tolerance = RESTORE_TOLERANCE,
}) {
  const target = Number(saved)
  const height = Number(maxY)
  if (!Number.isFinite(target) || target <= 0) return false
  if (!Number.isFinite(height)) return false
  if (target <= height + tolerance) return false
  const elapsed = Number(elapsedMs)
  if (!Number.isFinite(elapsed)) return false
  return elapsed < deadlineMs
}
