import { useCallback, useEffect, useRef, useState } from 'react'

import { fetchPlaybackHistory } from '@/api'
import Icon from '@/components/Icons'
import SubPage from '@/components/SubPage'
import { useStore } from '@/store'
import { getVideoDisplayName } from '@/utils/display'
import { getErrorMessage } from '@/utils/errors'
import { formatClock } from '@/utils/format'
import { zh } from '@/utils/i18n'

const PAGE_SIZE = 50

/** 播放时间：今天/昨天用相对日期，同年用「月 日 时:分」，跨年带年份。 */
function formatPlayedAt(value, now = new Date()) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (number) => String(number).padStart(2, '0')
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const startOfDay = (target) =>
    new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime()
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86400000)
  if (days === 0) return zh(`今天 ${clock}`, `Today ${clock}`)
  if (days === 1) return zh(`昨天 ${clock}`, `Yesterday ${clock}`)
  if (date.getFullYear() === now.getFullYear()) {
    return zh(
      `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${clock}`,
      `${date.getMonth() + 1}/${date.getDate()} ${clock}`
    )
  }
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${clock}`
}

function HistoryRow({ item, onPlay }) {
  const video = item?.video || {}
  const jav = video?.jav || video?.locations?.[0]?.jav || null
  const code = String(jav?.code || '').trim()
  // 未刮削的视频没有 jav，用文件名兜底（与列表页的显示名一致）。
  const title = String(jav?.title || '').trim() || getVideoDisplayName(video)
  const idols = (jav?.idols || []).map((idol) => String(idol?.name || '').trim()).filter(Boolean)
  const rating = Number(jav?.favorite_rating) || 0
  const duration = Number(item?.duration_sec) || Number(video?.duration_sec) || 0
  const position = Number(item?.position_sec) || 0
  const version = encodeURIComponent(
    [video?.cover_screenshot_name || '', video?.updated_at || ''].join('|')
  )
  const thumbnailSrc = `/videos/${video.id}/thumbnail${version ? `?v=${version}` : ''}`

  return (
    <button
      type="button"
      onClick={() => onPlay?.(item)}
      className="flex w-full items-start gap-2.5 border-b border-[#e6e8ec] bg-white px-3 py-2.5 text-left active:bg-zinc-50"
    >
      <span className="relative block h-[54px] w-[96px] flex-none overflow-hidden rounded-[8px] bg-zinc-200">
        <img
          src={thumbnailSrc}
          alt={title}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          {code ? (
            <span className="flex-none rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold text-white">
              {code}
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-tight text-zinc-800">
            {title}
          </span>
        </span>
        <span className="mt-1 flex items-center gap-1.5 text-[11px] text-sky-700">
          <Icon name="play" size={11} className="flex-none" />
          <span className="tabular-nums">
            {`${formatClock(position)} / ${duration > 0 ? formatClock(duration) : '--:--'}`}
          </span>
          <span className="text-zinc-400">{formatPlayedAt(item?.played_at)}</span>
        </span>
        {idols.length > 0 ? (
          <span className="mt-0.5 block truncate text-[11px] text-zinc-500">
            {idols.join(' · ')}
          </span>
        ) : null}
        {rating > 0 ? (
          <span className="mt-0.5 inline-flex items-center gap-0.5 text-amber-500">
            <Icon name="starFilled" size={11} className="flex-none" />
            <span className="text-[11px] font-medium tabular-nums">{rating.toFixed(1)}</span>
          </span>
        ) : null}
      </span>
      <Icon name="right" size={16} className="mt-4 flex-none text-zinc-300" />
    </button>
  )
}

/**
 * 移动端「播放记录」页：走页面栈（pushPage），与 PC 端浮层同源
 * （GET /playback/history），视频模块与 JAV 模块的记录混排。
 *
 * 点一条记录直接开播放器：续播位置由服务端记录决定（见 PlayerPage），
 * 这里不传 startTime，也不关掉本页 —— 退出播放器后还要接着翻列表。
 */
export default function PlaybackHistoryPage({ onClose }) {
  const openPlayer = useStore((state) => state.openPlayer)
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
      const data = await fetchPlaybackHistory({ limit: PAGE_SIZE, offset })
      // 重新进入本页会发起新请求，旧响应不能覆盖新结果。
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
    <SubPage
      title={zh('播放记录', 'Playback history')}
      subtitle={loading ? zh('加载中…', 'Loading...') : zh(`${total} 条记录`, `${total} records`)}
      onBack={onClose}
    >
      {error ? (
        <div className="mx-3 mt-3 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
          {error}
        </div>
      ) : null}

      {!loading && items.length === 0 ? (
        <div className="px-4 py-16 text-center text-[13px] text-zinc-400">
          {zh('还没有播放记录', 'No playback history yet')}
        </div>
      ) : null}

      {items.map((item) => (
        <HistoryRow
          key={item.video_id}
          item={item}
          onPlay={(record) => {
            if (record?.video?.id) openPlayer(record.video)
          }}
        />
      ))}

      {items.length < total ? (
        <div className="flex justify-center py-4">
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => load(items.length)}
            className="rounded-full border border-[#e6e8ec] bg-white px-4 py-1.5 text-[12px] text-zinc-600 active:bg-zinc-100 disabled:opacity-60"
          >
            {loadingMore ? zh('加载中…', 'Loading...') : zh('加载更多', 'Load more')}
          </button>
        </div>
      ) : null}
    </SubPage>
  )
}
