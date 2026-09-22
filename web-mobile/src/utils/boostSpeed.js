/**
 * 长按倍速的档位换算。
 *
 * 轴的选择（真机反馈后定的）：换档用**上下**滑动，加速期间横向滑动不做任何事。
 * 横向一直和「拖动画面调进度」互相干扰（全屏下尤其明显，两个手势都在跑），
 * 干脆让两个手势占用不同的轴，从物理上就不可能重叠。
 *
 * 单独抽成零依赖的纯函数，方便用 node:test 覆盖（tests/boostSpeed.test.js）。
 *
 * 下限 1x（不做慢放），上限 3x：iOS Safari 对 >2x 的支持历来不稳，真机验证过再放宽。
 */

/** 长按可选的倍速档位，0.25x 一档，从低到高。 */
export const BOOST_LADDER = [1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3]

/** 长按不动时的默认倍速。 */
export const DEFAULT_BOOST_SPEED = 2

/**
 * 上下滑动换档的灵敏度：每 20px 一档（0.25x）。
 * 刻意调得敏感 —— 真机上手势幅度很小，一档要滑几十像素的话会觉得「没反应」。
 */
export const BOOST_VERTICAL_STEP_PX = 20

/** 设置页可选的默认长按倍速（粗档位：Segmented 最多放 4 项）。 */
export const BOOST_SPEED_CHOICES = [1.5, 2, 2.5, 3]

/** 把任意值夹到合法档位下标。 */
export function clampSpeedIndex(index, ladder = BOOST_LADDER) {
  const values = Array.isArray(ladder) && ladder.length ? ladder : BOOST_LADDER
  const value = Number.isFinite(Number(index)) ? Math.round(Number(index)) : 0
  return Math.min(values.length - 1, Math.max(0, value))
}

/**
 * 对称取整。
 *
 * 直接用 Math.round 会有个坑：`Math.round(-0.5)` 得到 `-0`，于是「往上滑半档」
 * 换档、「往下滑半档」不换档。上下两个方向必须对称，否则用户会觉得往下滑迟钝。
 */
function roundOffset(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return number < 0 ? -Math.round(-number) : Math.round(number)
}

/**
 * 位移 → 倍速。`offsetPx` 为正表示「往快了调」，为负表示「往慢了调」。
 *
 * 原点固定为默认倍速（不是 1x）：长按不动就已经在加速，往上滑提档、往下滑降档，
 * 降到底就是原速。
 */
export function boostSpeedForDrag(offsetPx, options = {}) {
  const ladder =
    Array.isArray(options.ladder) && options.ladder.length ? options.ladder : BOOST_LADDER
  const stepPx = Number(options.stepPx) > 0 ? Number(options.stepPx) : BOOST_VERTICAL_STEP_PX
  const speed = Number(options.speed)
  const requested = ladder.indexOf(speed)
  const fallback = ladder.indexOf(DEFAULT_BOOST_SPEED)
  const anchor = requested >= 0 ? requested : fallback >= 0 ? fallback : 0
  const offset = roundOffset((Number(offsetPx) || 0) / stepPx)
  return ladder[clampSpeedIndex(anchor + offset, ladder)]
}

/**
 * 上下滑动 → 倍速。
 *
 * 屏幕坐标里向下是正数，所以取反：**向上滑 = 加速**（符合「往上 = 更多」的直觉）。
 */
export function boostSpeedForVerticalDrag(dy, options = {}) {
  return boostSpeedForDrag(-(Number(dy) || 0), options)
}

/** HUD / 设置页里的档位文案。 */
export function formatBoostSpeed(speed) {
  const value = Number(speed)
  return Number.isFinite(value) ? `${value}x` : ''
}
