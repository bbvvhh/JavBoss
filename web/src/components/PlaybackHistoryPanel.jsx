import { useCallback, useEffect, useRef, useState } from 'react'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded'
import StarRoundedIcon from '@mui/icons-material/StarRounded'
import { fetchPlaybackHistory } from '@/api'
import { getVideoDisplayName } from '@/utils/display'
import { getErrorMessage } from '@/utils/errors'
import { zh } from '@/utils/i18n'
import { PLAYBACK_HISTORY_PAGE_SIZE, formatClock, formatPlayedAt } from '@/utils/playback'

function PlaybackHistoryRow({ item, onPlay }) {
  const video = item?.video || {}
  const jav = video?.jav || video?.locations?.[0]?.jav || null
  const code = String(jav?.code || '').trim()
  // 未刮削的视频没有 jav，用文件名兜底（与视频列表的显示名一致）。
  const title = String(jav?.title || '').trim() || getVideoDisplayName(video)
  const idols = (jav?.idols || []).map((idol) => String(idol?.name || '').trim()).filter(Boolean)
  const rating = Number(jav?.favorite_rating) || 0
  const duration = Number(item?.duration_sec) || Number(video?.duration_sec) || 0
  const position = Number(item?.position_sec) || 0
  const thumbnailSrc = `/videos/${video.id}/thumbnail?v=${encodeURIComponent(
    [video?.cover_screenshot_name || '', video?.updated_at || ''].join('|')
  )}`

  return (
    <button
      type="button"
      onClick={() => onPlay?.(item)}
      title={title}
      className="flex w-full items-start gap-3 rounded border border-transparent bg-white p-2 text-left transition hover:border-sky-200 hover:bg-sky-50/60"
    >
      <span className="block h-[3.75rem] w-[6.25rem] flex-none overflow-hidden rounded bg-gray-200">
        <img
          src={thumbnailSrc}
          alt={title}
          loading="lazy"
          className="h-full w-full object-cover"
          onError={(event) => {
            event.currentTarget.style.display = 'none'
          }}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          {code ? (
            <span className="flex-none rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold text-white">
              {code}
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-gray-800">{title}</span>
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-500">
          <span className="inline-flex items-center gap-1 text-sky-700">
            <PlayArrowRoundedIcon sx={{ fontSize: 14 }} />
            {`${formatClock(position)} / ${duration > 0 ? formatClock(duration) : '--:--'}`}
          </span>
          <span>{formatPlayedAt(item?.played_at)}</span>
          {idols.length > 0 ? <span className="min-w-0 truncate">{idols.join(' · ')}</span> : null}
        </span>
        {rating > 0 ? (
          <span className="mt-1 inline-flex items-center gap-0.5 text-amber-500">
            <StarRoundedIcon sx={{ fontSize: 14 }} />
            <span className="text-[11px] font-medium">{rating.toFixed(1)}</span>
          </span>
        ) : null}
      </span>
    </button>
  )
}

/**
 * PC 端「播放记录」浮层，挂在顶部入口按钮下方，不跳转新页面。
 * 数据与移动端播放记录页同源（GET /playback/history），视频与 JAV 记录混排。
 */
export default function PlaybackHistoryPanel({ onClose, onPlay }) {
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const requestSeqRef = useRef(0)

  const load = useCallback(async (offset) => {
    const seq = requestSeqRef.current + 1
    requestSeqRef.current = seq
    if (offset === 0) setLoading(true)
    else setLoadingMore(true)
    try {
      const data = await fetchPlaybackHistory({ limit: PLAYBACK_HISTORY_PAGE_SIZE, offset })
      // 浮层重新打开会发起新请求，旧响应不能覆盖新结果。
      if (requestSeqRef.current !== seq) return
      setItems((previous) => (offset === 0 ? data.items : [...previous, ...data.items]))
      setTotal(data.total)
      setError('')
    } catch (err) {
      if (requestSeqRef.current !== seq) return
      setError(getErrorMessage(err))
    } finally {
      if (requestSeqRef.current === seq) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [])

  useEffect(() => {
    load(0)
  }, [load])

  return (
    <div
      role="dialog"
      aria-label={zh('播放记录', 'Playback history')}
      className="absolute right-0 top-full z-50 mt-2.5 flex max-h-[70vh] w-[32rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded border border-gray-200 bg-white text-left shadow-xl"
    >
      <div className="flex items-center justify-between gap-2 border-b bg-gray-50 px-3 py-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-gray-700">
            {zh('播放记录', 'Playback history')}
          </div>
          <div className="truncate text-xs text-gray-500">
            {loading ? zh('加载中…', 'Loading...') : zh(`${total} 条记录`, `${total} records`)}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 w-7 flex-none items-center justify-center rounded text-gray-500 transition hover:bg-gray-100 hover:text-gray-800"
          title={zh('关闭', 'Close')}
          aria-label={zh('关闭', 'Close')}
        >
          <CloseRoundedIcon sx={{ fontSize: 18 }} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/80 p-2">
        {error ? (
          <div className="mb-2 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">
            {error}
          </div>
        ) : null}
        {!loading && items.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs text-gray-500">
            {zh('还没有播放记录', 'No playback history yet')}
          </div>
        ) : null}
        <div className="flex flex-col gap-1">
          {items.map((item) => (
            <PlaybackHistoryRow key={item.video_id} item={item} onPlay={onPlay} />
          ))}
        </div>
        {items.length < total ? (
          <div className="mt-2 flex justify-center">
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => load(items.length)}
              className="rounded border border-gray-300 bg-white px-3 py-1 text-xs text-gray-700 transition hover:border-gray-400 hover:bg-gray-50 disabled:opacity-60"
            >
              {loadingMore ? zh('加载中…', 'Loading...') : zh('加载更多', 'Load more')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
