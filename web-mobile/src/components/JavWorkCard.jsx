import { useState } from 'react'

import Icon from '@/components/Icons'
import useLongPress from '@/hooks/useLongPress'
import { useStore } from '@/store'
import { formatReleaseDate } from '@/utils/format'
import { idolDisplayName, javDisplayPrefs, javTagDisplayName } from '@/utils/javDisplay'
import { zh } from '@/utils/i18n'

/**
 * JAV 作品卡。列表页与女优详情页共用，`density` 控制排版：
 *   large    —— 单列，标题完整 + 元信息 chips + 演员行 + 标签行
 *   standard —— 2 列，标题 2 行 + 演员 · 片商
 *   compact  —— 3 列，只留标题
 *
 * 卡片整体只做一件事：打开作品详情。「跳转到某位女优/片商/系列的影片」
 * 这类动作放在详情页里，避免可交互元素嵌套。
 *
 * 显示哪些行由全局设置决定（不显示演员 / 标签 / 系列、优先中文名、简体标签），
 * 与 PC 端共用同一批配置键。
 *
 * 多选态由作品列表页下发：点选 = 勾选/取消，长按 = 进入多选（与视频卡一致）。
 */
export default function JavWorkCard({
  item,
  density = 'standard',
  onOpen,
  selectionMode = false,
  selected = false,
  onToggle,
  onLongPress,
}) {
  const [failed, setFailed] = useState(false)
  const config = useStore((state) => state.config)
  const prefs = javDisplayPrefs(config)

  const compact = density === 'compact'
  const large = density === 'large'
  const code = String(item?.code || '').trim()
  const idols = prefs.hideIdols
    ? []
    : (item?.idols || [])
        .map((idol) => idolDisplayName(idol, prefs.preferChineseName))
        .filter(Boolean)
  const tags = prefs.hideTags ? [] : item?.tags || []

  // 多选态下长按等同于点选，避免误触（此时没有别的长按动作）。
  const gesture = useLongPress({
    onTap: () => (selectionMode ? onToggle?.(item) : onOpen?.(item)),
    onLongPress: () => (selectionMode ? onToggle?.(item) : onLongPress?.(item)),
  })

  // click 只兜底键盘/读屏/程序化触发（detail === 0），避免同一次触摸被处理两次。
  const activate = () => (selectionMode ? onToggle?.(item) : onOpen?.(item))

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selectionMode ? selected : undefined}
      {...gesture}
      onClick={(event) => {
        if (event.detail === 0) activate()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          activate()
        }
      }}
      className={`select-none overflow-hidden rounded-card border bg-white text-left shadow-[0_1px_2px_rgba(15,23,42,0.05)] ${
        selected ? 'border-sky-400 ring-2 ring-sky-200' : 'border-[#e6e8ec]'
      }`}
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
        {/* 番号是 JAV 卡片的主标识，不能像视频卡那样被勾选圈顶掉，
            所以多选态的勾选圈放在右上角（那里本来就是空的）。 */}
        {selectionMode ? (
          <span
            className={`absolute right-1.5 top-1.5 z-10 grid h-5 w-5 place-items-center rounded-full border-2 border-white shadow ${
              selected ? 'bg-sky-500' : 'bg-black/25'
            }`}
            aria-hidden="true"
          >
            {selected ? <Icon name="check" size={12} className="text-white" /> : null}
          </span>
        ) : null}
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
                prefs.hideSeries ? '' : item?.series?.name,
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

            {tags.length ? (
              <div className="fade-clip mt-1.5 flex h-[17px] items-center gap-1.5 overflow-hidden">
                <span className="flex-none rounded bg-zinc-100 px-[5px] text-[10px] font-bold leading-[15px] text-zinc-400">
                  {zh('标签', 'Tags')}
                </span>
                {tags.map((tag) => (
                  <span
                    key={tag.id ?? tag.name}
                    className="h-[15px] flex-none rounded bg-[#fdba74] px-[5px] text-[10px] font-bold leading-[15px] text-zinc-900"
                  >
                    {javTagDisplayName(tag, prefs.simplifiedTags)}
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
