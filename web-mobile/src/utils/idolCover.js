/**
 * 女优封面的裁切计算。
 *
 * 封面源图是 800×538 的横版作品封面，人物通常在画面右侧，所以默认只展示
 * **最右侧 47%**（与 PC 端 `JavIdolGrid` / `JavIdolCoverModal` 的常数一致），
 * 窗口纵横比 376:538。用户可以在封面编辑页改「起点」(`cover_crop_left`)。
 *
 * 与 PC 的差别：PC 会按源图真实纵横比反算可见比例，移动端只用固定的 47% ——
 * 列表、详情、编辑页三处都走这个固定值，保证「编辑时看到的框」和「列表里的
 * 裁切」永远一致；源图不是 800×538 时手机上的取景会和 PC 略有出入，这是刻意
 * 的取舍（宁可一致，也不要三处各算各的）。
 *
 * 约定：
 *   - `cropLeft` = 窗口左边缘落在源图上的横向比例，取值 [0, 1 - visibleRatio]
 *   - 窗口宽 = 源图显示宽的 `visibleRatio` 倍
 *   - 图片用 `width: 100/visibleRatio %` + 负的 `left` 偏移定位到窗口里
 */

export const IDOL_COVER_VISIBLE_RATIO = 0.47
export const IDOL_COVER_DEFAULT_CROP_LEFT = 1 - IDOL_COVER_VISIBLE_RATIO
export const IDOL_COVER_SOURCE_WIDTH = 800
export const IDOL_COVER_SOURCE_HEIGHT = 538
export const IDOL_COVER_FRAME_ASPECT =
  (IDOL_COVER_SOURCE_WIDTH * IDOL_COVER_VISIBLE_RATIO) / IDOL_COVER_SOURCE_HEIGHT
/** 封面窗口的纵横比，列表 / 详情 / 编辑页共用，避免三处跑偏。 */
export const IDOL_COVER_ASPECT = '376 / 538'

/** 落库值：非法回落默认起点，合法值夹到 [0, 1]（与后端 normalizeCoverCropLeft 对齐）。 */
export function normalizeIdolCoverCropLeft(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return IDOL_COVER_DEFAULT_CROP_LEFT
  return Math.min(Math.max(parsed, 0), 1)
}

/**
 * 按源图真实纵横比反算「可见比例」。
 *
 * 只在能拿到真实尺寸时才有意义；拿不到（未加载 / 加载失败）就退回默认 47%，
 * 免得窗口宽度瞬间跳一下。
 */
export function getCoverVisibleRatio(size) {
  const imageWidth = Number(size?.width)
  const imageHeight = Number(size?.height)
  if (
    !Number.isFinite(imageWidth) ||
    !Number.isFinite(imageHeight) ||
    imageWidth <= 0 ||
    imageHeight <= 0
  ) {
    return IDOL_COVER_VISIBLE_RATIO
  }
  const imageAspect = imageWidth / imageHeight
  if (imageAspect <= 0) return IDOL_COVER_VISIBLE_RATIO
  return Math.min(1, IDOL_COVER_FRAME_ASPECT / imageAspect)
}

/** 拖动中的起点：夹在 [0, maxCropLeft]，上限非法时按 0（不留可拖动余量）。 */
export function normalizeDynamicCropLeft(value, maxCropLeft) {
  const parsed = Number(value)
  const max = Number(maxCropLeft)
  if (!Number.isFinite(parsed)) return 0
  if (!Number.isFinite(max) || max <= 0) return 0
  return Math.min(Math.max(parsed, 0), max)
}

/** 可见比例兜底 + 夹紧，避免调用方传进来的脏值算出 0 宽或反向偏移。 */
function safeVisibleRatio(visibleRatio) {
  const ratio = Number(visibleRatio)
  if (!Number.isFinite(ratio) || ratio <= 0) return IDOL_COVER_VISIBLE_RATIO
  return Math.min(ratio, 1)
}

/**
 * 源图在窗口里的定位样式。
 *
 * 默认起点 0.53 + 默认比例 0.47 时得到 `width: 212.77%; left: -112.77%`，
 * 也就是「只有源图最右侧 47% 落在窗口里」—— 与改动前的 `right: 0` 写法等价。
 */
export function coverImageStyle(
  cropLeft = IDOL_COVER_DEFAULT_CROP_LEFT,
  visibleRatio = IDOL_COVER_VISIBLE_RATIO
) {
  const visible = safeVisibleRatio(visibleRatio)
  const left = normalizeDynamicCropLeft(cropLeft, 1 - visible)
  return {
    width: `${100 / visible}%`,
    left: `${(-left * 100) / visible}%`,
    // ⚠️ maxWidth 必须显式覆盖：Tailwind preflight 给所有 img 设了
    // `max-width: 100%`，会把这里的放大宽度压回 100%，裁切方向就退化成居中。
    maxWidth: 'none',
  }
}

/** 候选项（自动 / 指定作品）在预览里对应的番号。 */
export function idolCoverPreviewCode(option, fallbackCode) {
  return String(option?.code || fallbackCode || '').trim()
}
