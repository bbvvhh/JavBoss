import { useState } from 'react'

import Icon from '@/components/Icons'
import useLongPress from '@/hooks/useLongPress'
import { DENSITY_SHOWS_DETAIL } from '@/utils/density'
import { getVideoDisplayName, parseVideoFingerprint, formatBytes } from '@/utils/display'
import { formatDuration, formatReleaseDate } from '@/utils/format'
import { zh } from '@/utils/i18n'

function pickJav(video) {
  return video?.jav || video?.locations?.[0]?.jav || null
}

export default function VideoCard({
  video,
  density,
  onOpen,
  onLongPress,
  selectionMode = false,
  selected = false,
  onToggle,
}) {
  const [imageFailed, setImageFailed] = useState(false)

  const displayName = getVideoDisplayName(video)
  const fingerprint = parseVideoFingerprint(video?.fingerprint)
  const sizeText = formatBytes(fingerprint.size || video?.size)
  const duration = formatDuration(video?.duration_sec)
  const resolution =
    fingerprint.width && fingerprint.height ? `${fingerprint.width}×${fingerprint.height}` : ''

  const jav = pickJav(video)
  const code = String(jav?.code || '').trim()
  const idols = (jav?.idols || []).map((idol) => idol?.name).filter(Boolean)
  const tags = (video?.tags || []).map((tag) => tag?.name).filter(Boolean)
  const released = formatReleaseDate(jav?.release_unix)
  const playCount = Number(video?.play_count) || 0

  const version = encodeURIComponent(
    [video?.cover_screenshot_name || '', video?.updated_at || ''].join('|')
  )
  const thumbnailSrc = `/videos/${video?.id}/thumbnail${version ? `?v=${version}` : ''}`

  const showDetail = DENSITY_SHOWS_DETAIL[density]
  const compact = density === 'compact'

  // 长按 = 操作菜单；多选态下长按等同于点选，避免误弹菜单。
  const gesture = useLongPress({
    onTap: () => (selectionMode ? onToggle?.(video) : onOpen?.(video)),
    onLongPress: () => (selectionMode ? onToggle?.(video) : onLongPress?.(video)),
  })

  // pointer 事件负责真实触摸；click 只兜底键盘/读屏/程序化触发（detail === 0），
  // 避免同一次触摸被处理两次。
  const activate = () => (selectionMode ? onToggle?.(video) : onOpen?.(video))

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
      className={`block w-full select-none overflow-hidden rounded-card border bg-white text-left shadow-[0_1px_2px_rgba(15,23,42,0.05)] ${
        selected ? 'border-sky-400 ring-2 ring-sky-200' : 'border-[#e6e8ec]'
      }`}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-zinc-200">
        {imageFailed ? (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-zinc-300 to-zinc-400 text-[11px] font-semibold text-white/85">
            {code || zh('无缩略图', 'No thumbnail')}
          </div>
        ) : (
          <img
            src={thumbnailSrc}
            alt={displayName}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
            onError={() => setImageFailed(true)}
          />
        )}

        {selectionMode ? (
          <span
            className={`absolute left-1.5 top-1.5 z-10 grid h-5 w-5 place-items-center rounded-full border-2 border-white shadow ${
              selected ? 'bg-sky-500' : 'bg-black/25'
            }`}
            aria-hidden="true"
          >
            {selected ? <Icon name="check" size={12} className="text-white" /> : null}
          </span>
        ) : code ? (
          <span
            className="absolute left-1.5 top-1.5 max-w-[calc(100%-3rem)] truncate rounded bg-black/70 px-1.5 py-[1px] text-[10px] font-bold text-white"
            title={code}
          >
            {code}
          </span>
        ) : (
          <span className="absolute left-1.5 top-1.5 rounded bg-white/85 px-1.5 py-[1px] text-[10px] font-semibold text-zinc-600">
            {zh('未刮削', 'Unscraped')}
          </span>
        )}

        {!compact && playCount > 0 ? (
          <span className="absolute right-1.5 top-1.5 inline-flex items-center gap-0.5 rounded bg-black/70 px-1.5 py-[1px] text-[10px] font-bold tabular-nums text-white">
            <Icon name="play" size={9} />
            {playCount}
          </span>
        ) : null}

        {duration ? (
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-[1px] text-[10px] font-bold tabular-nums text-white">
            {duration}
          </span>
        ) : null}
      </div>

      <div className={compact ? 'px-1.5 py-1.5' : 'px-2 pb-2.5 pt-2'}>
        <div className="flex items-start gap-1">
          <h3
            className={
              compact
                ? 'line-clamp-2 min-w-0 flex-1 text-[10.5px] font-semibold leading-[1.35] text-zinc-800'
                : density === 'large'
                  ? 'min-w-0 flex-1 text-[13.5px] font-semibold leading-[1.45] text-zinc-800 [overflow-wrap:anywhere]'
                  : 'line-clamp-2 min-w-0 flex-1 text-xs font-semibold leading-[1.35] text-zinc-800'
            }
          >
            {displayName}
          </h3>
          {!selectionMode ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onLongPress?.(video)
              }}
              onPointerDown={(event) => event.stopPropagation()}
              aria-label={zh('更多操作', 'More actions')}
              className="-mr-1 -mt-1 grid h-7 w-7 flex-none place-items-center rounded-lg text-zinc-300 active:bg-zinc-100"
            >
              <Icon name="more" size={15} />
            </button>
          ) : null}
        </div>

        <div
          className={`mt-1.5 flex items-center gap-1.5 text-zinc-400 ${compact ? 'text-[9.5px]' : 'text-[10.5px]'}`}
        >
          {resolution ? <span>{resolution}</span> : null}
          {resolution && sizeText ? <span className="text-zinc-300">·</span> : null}
          {sizeText ? <span>{sizeText}</span> : null}
          {showDetail && released ? <span className="text-zinc-300">·</span> : null}
          {showDetail && released ? <span>{released}</span> : null}
        </div>

        {showDetail && idols.length ? (
          <div className="fade-clip mt-1.5 flex items-center gap-1.5 text-[11.5px] text-zinc-600">
            <span className="flex-none rounded bg-zinc-100 px-[5px] text-[10px] font-bold leading-[15px] text-zinc-400">
              {zh('演员', 'Cast')}
            </span>
            <span className="truncate">{idols.join(' · ')}</span>
          </div>
        ) : null}

        {showDetail && tags.length ? (
          <div className="fade-clip mt-1.5 flex h-[17px] items-center gap-1.5 overflow-hidden">
            <span className="flex-none rounded bg-zinc-100 px-[5px] text-[10px] font-bold leading-[15px] text-zinc-400">
              {zh('标签', 'Tags')}
            </span>
            {tags.map((tag) => (
              <span
                key={tag}
                className="h-[15px] flex-none rounded bg-[#fdba74] px-[5px] text-[10px] font-bold leading-[15px] text-zinc-900"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}

        {density === 'standard' && tags.length ? (
          <div className="mt-1.5 flex h-[15px] gap-1 overflow-hidden">
            {tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="h-[15px] flex-none rounded bg-[#fdba74] px-[5px] text-[10px] font-bold leading-[15px] text-zinc-900"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
