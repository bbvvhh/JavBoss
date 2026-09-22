/**
 * 播放页手势的状态机常量与判定。
 *
 * 规则（用户真机验证后定的，两个手势刻意用不同的轴，避免互相干扰）：
 * - 在画面上按住不动满 BOOST_HOLD_MS → 进入倍速；此后**上下**滑动换档，
 *   横向滑动在加速期间不做任何事。
 * - 不到 BOOST_HOLD_MS 就横向滑动 → 调进度（拖画面 seek）。
 * - 竖向大幅度滑动（还没进入倍速时）→ 整个手势作废，什么都不做，
 *   把画面让给浏览器 / 系统的亮度、音量手势。
 *
 * 也就是「谁先发生谁说了算」：一旦某一方成立，这一次触摸就锁定在那个模式里，
 * 中途不会互相切换 —— 这是为了避免「滑动既改了倍速又跳了进度」。
 *
 * 保持零依赖纯函数，方便用 node:test 覆盖（tests/playerGesture.test.js）。
 */

/** 长按多久算「按住不放」，进入倍速。 */
export const BOOST_HOLD_MS = 1000

/** 横向抖动阈值：超过就转成「拖动调进度」。 */
export const GESTURE_MOVE_TOLERANCE_PX = 14

/**
 * 竖向抖动阈值：比横向宽松一些。
 * 长按的 1 秒里手会自然上下晃，卡太紧会导致长按经常不成立；
 * 但真的用力竖滑（想调亮度 / 音量）时又能被识别出来并放弃手势。
 */
export const GESTURE_VERTICAL_TOLERANCE_PX = 30

/** 手势可能的阶段。 */
export const GESTURE_PENDING = 'pending'
export const GESTURE_BOOST = 'boost'
export const GESTURE_SEEK = 'seek'

/**
 * 长按计时还没到时收到移动事件，判定这一步该怎么走。
 *
 * @param {number} dx 相对按下点的横向位移
 * @param {number} dy 相对按下点的纵向位移
 * @param {object} [options]
 * @param {number} [options.horizontal] 横向阈值
 * @param {number} [options.vertical] 竖向阈值
 * @returns {'pending'|'seek'|'cancel'} pending = 继续等长按；seek = 转成调进度；cancel = 手势作废
 */
export function resolvePendingGesture(dx, dy, options = {}) {
  const horizontal =
    Number(options.horizontal) > 0 ? Number(options.horizontal) : GESTURE_MOVE_TOLERANCE_PX
  const vertical =
    Number(options.vertical) > 0 ? Number(options.vertical) : GESTURE_VERTICAL_TOLERANCE_PX
  const x = Number(dx)
  const y = Number(dy)
  // 横向优先：斜着滑时按「想调进度」处理，这符合直觉，也让 seek 更容易触发。
  if (Math.abs(Number.isFinite(x) ? x : 0) > horizontal) return 'seek'
  if (Math.abs(Number.isFinite(y) ? y : 0) > vertical) return 'cancel'
  return 'pending'
}
