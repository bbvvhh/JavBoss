import { useState } from 'react'

/**
 * 女优封面。
 *
 * JavBoss 的女优封面源图是 800×538 的横版作品封面，人物通常在画面右侧，
 * 所以默认只展示**最右侧 47%**（与 PC 端 `JavIdolGrid` 的
 * `IDOL_COVER_VISIBLE_RATIO = 0.47` 保持一致），纵横比 376:538。
 *
 * 实现方式：容器是可见窗口，img 用 `right: 0` + 放大到 100/0.47 ≈ 213% 宽，
 * 于是只有源图最右侧的那一段落在窗口里 —— 不是居中裁切。
 *
 * 列表与详情页共用本组件，避免两处裁切方式跑偏。
 */
export const IDOL_COVER_VISIBLE_RATIO = 0.47
export const IDOL_COVER_ASPECT = '376 / 538'

export default function IdolCover({ code, alt, className = '', style, rounded = true }) {
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
          className="absolute right-0 top-0 h-full object-cover"
          // ⚠️ maxWidth 必须显式覆盖：Tailwind preflight 给所有 img 设了
          // `max-width: 100%`，会把这里的 213% 宽压回 100%，裁切方向就退化成居中。
          style={{ width: `${100 / IDOL_COVER_VISIBLE_RATIO}%`, maxWidth: 'none' }}
        />
      )}
    </div>
  )
}
