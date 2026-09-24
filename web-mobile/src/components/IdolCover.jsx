import { useState } from 'react'

import {
  IDOL_COVER_ASPECT,
  IDOL_COVER_DEFAULT_CROP_LEFT,
  IDOL_COVER_VISIBLE_RATIO,
  coverImageStyle,
} from '@/utils/idolCover'

/**
 * 女优封面。
 *
 * 源图是 800×538 的横版作品封面，人物通常在画面右侧，所以默认只展示**最右侧
 * 47%**（与 PC 端 `JavIdolGrid` 的 `IDOL_COVER_VISIBLE_RATIO = 0.47` 一致），
 * 纵横比 376:538。
 *
 * `cropLeft` 是库里存的 `cover_crop_left`（起点）。不传时用默认起点 0.53，
 * 等价于「贴右显示」；传了就按用户保存的取景展示。定位方式见 `coverImageStyle`。
 *
 * 列表与详情页共用本组件，避免两处裁切方式跑偏。
 */
export { IDOL_COVER_ASPECT, IDOL_COVER_VISIBLE_RATIO }

export default function IdolCover({
  code,
  alt,
  className = '',
  style,
  rounded = true,
  cropLeft = IDOL_COVER_DEFAULT_CROP_LEFT,
}) {
  const [failed, setFailed] = useState(false)
  const value = String(code || '').trim()

  return (
    <div
      className={`relative overflow-hidden bg-zinc-200 ${rounded ? 'rounded-card' : ''} ${className}`}
      style={{ aspectRatio: IDOL_COVER_ASPECT, ...style }}
    >
      {!value || failed ? (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-zinc-200 to-zinc-300 text-[11px] font-semibold text-white/80">
          {alt}
        </div>
      ) : (
        <img
          src={`/jav/${encodeURIComponent(value)}/cover`}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="absolute top-0 h-full object-cover"
          style={coverImageStyle(cropLeft)}
        />
      )}
    </div>
  )
}
