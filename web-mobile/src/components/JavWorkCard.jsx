import { useState } from 'react'

import { formatReleaseDate } from '@/utils/format'
import { zh } from '@/utils/i18n'

/**
 * JAV 作品卡。列表页与女优详情页共用，`density` 控制排版：
 *   large    —— 单列，标题完整 + 元信息 chips + 演员行 + 标签行
 *   standard —— 2 列，标题 2 行 + 演员 · 片商
 *   compact  —— 3 列，只留标题
 *
 * 卡片整体只做一件事：打开作品详情。「跳转到某位女优/片商/系列的影片」
 * 这类动作放在详情页里，避免可交互元素嵌套。
 */
export default function JavWorkCard({ item, density = 'standard', onOpen }) {
  const [failed, setFailed] = useState(false)

  const compact = density === 'compact'
  const large = density === 'large'
  const code = String(item?.code || '').trim()
  const idols = (item?.idols || []).map((idol) => idol?.name).filter(Boolean)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(item)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen?.(item)
        }
      }}
      className="overflow-hidden rounded-card border border-[#e6e8ec] bg-white text-left shadow-[0_1px_2px_rgba(15,23,42,0.05)]"
    >
      <div className="relative aspect-[800/538] w-full overflow-hidden bg-zinc-200">
        {!code || failed ? (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-200 to-zinc-300 text-[11px] font-semibold text-white/80">
            {code || zh('无封面', 'No cover')}
          </div>
        ) : (
          <img
            src={`/jav/${encodeURIComponent(code)}/cover`}
            alt={item?.title || code}
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        <span
          className={`absolute left-1.5 top-1.5 max-w-[calc(100%-0.75rem)] truncate rounded bg-black/70 px-1.5 py-[1px] font-bold text-white ${
            compact ? 'text-[9px]' : 'text-[10px]'
          }`}
        >
          {code}
        </span>
        {!compact && item?.favorite_rating > 0 ? (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1.5 py-[1px] text-[10px] font-bold text-white">
            ★ {Number(item.favorite_rating).toFixed(1)}
          </span>
        ) : null}
      </div>

      <div className={compact ? 'px-1.5 py-1.5' : 'px-2 pb-2.5 pt-2'}>
        <h3
          className={
            large
              ? 'text-[14px] font-semibold leading-[1.45] text-zinc-800 [overflow-wrap:anywhere]'
              : `line-clamp-2 font-semibold leading-[1.35] text-zinc-800 ${
                  compact ? 'text-[10.5px]' : 'text-xs'
                }`
          }
        >
          {item?.title || code}
        </h3>

        {large ? (
          <>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
              {[
                formatReleaseDate(item?.release_unix),
                item?.duration_min ? `${item.duration_min} ${zh('分钟', 'min')}` : '',
                item?.studio?.name,
                item?.series?.name,
                item?.is_uncensored === true ? zh('无码', 'Uncensored') : '',
              ]
                .filter(Boolean)
                .map((value) => (
                  <span key={value} className="rounded bg-[#f1f2f5] px-[7px] py-[2px]">
                    {value}
                  </span>
                ))}
            </div>

            {idols.length ? (
              <div className="fade-clip mt-1.5 flex items-center gap-1.5 text-[11.5px] text-zinc-600">
                <span className="flex-none rounded bg-zinc-100 px-[5px] text-[10px] font-bold leading-[15px] text-zinc-400">
                  {zh('演员', 'Cast')}
                </span>
                <span className="truncate">{idols.join(' · ')}</span>
              </div>
            ) : null}

            {(item?.tags || []).length ? (
              <div className="fade-clip mt-1.5 flex h-[17px] items-center gap-1.5 overflow-hidden">
                <span className="flex-none rounded bg-zinc-100 px-[5px] text-[10px] font-bold leading-[15px] text-zinc-400">
                  {zh('标签', 'Tags')}
                </span>
                {item.tags.map((tag) => (
                  <span
                    key={tag.id ?? tag.name}
                    className="h-[15px] flex-none rounded bg-[#fdba74] px-[5px] text-[10px] font-bold leading-[15px] text-zinc-900"
                  >
                    {tag.name}
                  </span>
                ))}
              </div>
            ) : null}
          </>
        ) : null}

        {!compact && !large ? (
          <p className="mt-1 truncate text-[10.5px] text-zinc-400">
            {[idols.join(' · '), item?.studio?.name].filter(Boolean).join(' · ') || '—'}
          </p>
        ) : null}
      </div>
    </div>
  )
}
