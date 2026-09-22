/**
 * 自绘进度条的换算。
 *
 * 为什么不用 video.js 自带的进度条：它「点哪跳哪」（Slider.handleMouseDown 里
 * 直接 handleMouseMove(event, true) → userSeek_），手机上 1 像素就是十几秒；
 * 而且 ≤320px 宽时 CSS 会把整个 .vjs-progress-control 隐藏掉，小屏手机根本
 * 没有进度条。自绘一条以后，精度、随动时间、步进按钮都能自己定。
 *
 * 这个模块刻意保持零依赖：测试可以像 progress.test.js 一样直接 import，
 * 不用注册 `@/` 别名钩子，也不用为了格式化去引 utils/format.js。
 */

/** 快进 / 快退按钮的步长（秒）。 */
export const SEEK_STEP_SECONDS = 10

/** 精细模式：进入后位移按 1/FINE_DRAG_FACTOR 生效。 */
export const FINE_DRAG_FACTOR = 10

/** 拖动中手指停住这么久就进入精细模式。 */
export const FINE_HOLD_MS = 500

/** 拖动中手指抖动超过这么多像素就重新计时。 */
export const FINE_MOVE_TOLERANCE_PX = 6

function pad2(value) {
  return String(value).padStart(2, '0')
}

/** 把秒数夹进 [0, duration]；duration 未知（NaN）时退化成 0。 */
export function clampTime(seconds, duration) {
  const total = Number(duration)
  const limit = Number.isFinite(total) && total > 0 ? total : 0
  const value = Number(seconds)
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(value, 0), limit)
}

/** 进度条比例（0~1）→ 秒。 */
export function timeForRatio(ratio, duration) {
  const value = Number(ratio)
  if (!Number.isFinite(value)) return 0
  const clamped = Math.min(Math.max(value, 0), 1)
  const total = Number(duration)
  return clampTime(clamped * (Number.isFinite(total) && total > 0 ? total : 0), duration)
}

/** 秒 → 进度条比例（0~1）。 */
export function ratioForTime(seconds, duration) {
  const total = Number(duration)
  if (!Number.isFinite(total) || total <= 0) return 0
  const value = Number(seconds)
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(value / total, 0), 1)
}

/** 每像素多少秒。整条轨道有多宽，决定「一点就是一截」有多严重。 */
export function secondsPerPixel(duration, width) {
  const total = Number(duration)
  const pixels = Number(width)
  if (!Number.isFinite(total) || total <= 0) return 0
  if (!Number.isFinite(pixels) || pixels <= 0) return 0
  return total / pixels
}

/** 触点横坐标 → 目标时间。track 传 getBoundingClientRect() 的结果。 */
export function pointerTime(clientX, track, duration) {
  const left = Number(track?.left)
  const width = Number(track?.width)
  if (!Number.isFinite(width) || width <= 0) return 0
  return timeForRatio(
    ((Number(clientX) || 0) - (Number.isFinite(left) ? left : 0)) / width,
    duration
  )
}

/**
 * 精细拖动：以进入精细模式那一刻的锚点为基准，位移按 1/factor 生效。
 * 手感是「滑动范围被放大 10 倍」，所以整条轨道上 1 像素 ≈ 0.05 秒，
 * 而不是十几秒。
 */
export function applyFineDrag(
  anchorSeconds,
  dxSinceAnchor,
  duration,
  width,
  factor = FINE_DRAG_FACTOR
) {
  const scale = secondsPerPixel(duration, width) / (Number(factor) > 0 ? Number(factor) : 1)
  const anchor = Number(anchorSeconds)
  const dx = Number(dxSinceAnchor)
  return clampTime(
    (Number.isFinite(anchor) ? anchor : 0) + (Number.isFinite(dx) ? dx : 0) * scale,
    duration
  )
}

/** 画面拖动调进度的灵敏度下限 / 上限（秒 / 像素）。 */
export const SEEK_DRAG_MIN_SECONDS_PER_PIXEL = 1
export const SEEK_DRAG_MAX_SECONDS_PER_PIXEL = 3

/**
 * 拖动画面时「1 像素 = 多少秒」。
 *
 * 刻意**不**用「滑过整屏 = 整段时长」的换算：手机上屏宽只有 370 多像素，
 * 2 小时的片子就是 1 像素 ≈ 19 秒，随手一滑就是好几分钟（真机反馈）。
 * 改成固定量级：一次顺手的滑动大约跨过片长的 1%~2%，片越长每像素给得越多，
 * 但始终夹在 1~3 秒之间；而且**与屏幕尺寸无关** —— 窄屏和全屏的手感才一致。
 */
export function seekDragSecondsPerPixel(duration) {
  const total = Number(duration)
  if (!Number.isFinite(total) || total <= 0) return SEEK_DRAG_MIN_SECONDS_PER_PIXEL
  const value = SEEK_DRAG_MIN_SECONDS_PER_PIXEL + total / 7200
  return Math.min(Math.max(value, SEEK_DRAG_MIN_SECONDS_PER_PIXEL), SEEK_DRAG_MAX_SECONDS_PER_PIXEL)
}

/**
 * 直接在画面上拖动调进度（不是拖进度条本身）。
 *
 * 相对位移，锚点固定在开始拖动那一刻的时间上，中途的实时预览不改变映射基准，
 * 所以手指来回移动时不会「漂」。
 */
export function seekTimeForDrag(anchorSeconds, dx, duration, secondsPerPixel) {
  const perPixel =
    Number(secondsPerPixel) > 0 ? Number(secondsPerPixel) : seekDragSecondsPerPixel(duration)
  const anchor = Number(anchorSeconds)
  const delta = Number(dx)
  return clampTime(
    (Number.isFinite(anchor) ? anchor : 0) + (Number.isFinite(delta) ? delta : 0) * perPixel,
    duration
  )
}

/** 相对当前时间加减一个步长。 */
export function stepTime(current, delta, duration) {
  const value = Number(current)
  const offset = Number(delta)
  return clampTime(
    (Number.isFinite(value) ? value : 0) + (Number.isFinite(offset) ? offset : 0),
    duration
  )
}

/** 秒 → `hh:mm:ss` / `mm:ss`；0 也给 `00:00`（进度条上不能是空白）。 */
export function formatSeekClock(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${pad2(h)}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`
}

/** HUD 里的增量文本：`+00:12` / `-01:30` / `00:00`。 */
export function formatSeekDelta(seconds) {
  const value = Math.round(Number(seconds) || 0)
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${sign}${formatSeekClock(Math.abs(value))}`
}
