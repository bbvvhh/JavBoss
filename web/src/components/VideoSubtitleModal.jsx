import { useCallback, useEffect, useMemo, useState } from 'react'

import { controlVideoSubtitleInMPV, fetchVideoSubtitles } from '@/api'
import AppModal from '@/components/AppModal'
import PlayerSubtitlePanel from '@/components/PlayerSubtitlePanel'
import { getVideoDisplayName } from '@/utils/display'
import { getErrorMessage } from '@/utils/errors'
import { zh } from '@/utils/i18n'

/**
 * 「字幕」弹窗（视频卡片 / JAV 作品详情页共用）。
 *
 * 浏览器播放器的字幕面板挂在 PlayerModal 里，用 MPV 播放时（或还没播放时）没有那个
 * 弹窗，所以这里复用同一个面板：列表 / 搜索 / 下载 / 删除完全一致，只有「选择」的语义
 * 不同 —— 选中后立刻通过 IPC 把字幕挂到正在播放的 MPV 窗口上（关闭则关掉 MPV 字幕）。
 * 已下载的字幕也会在下次用 MPV 播放时自动带上。
 *
 * 传入多个视频（JAV 作品通常关联多个文件）时，顶部给出视频切换器。
 */
export default function VideoSubtitleModal({ videos, onClose, onToast }) {
  const list = useMemo(() => (Array.isArray(videos) ? videos.filter(Boolean) : []), [videos])
  const [selectedVideoId, setSelectedVideoId] = useState(0)
  const [subtitles, setSubtitles] = useState([])
  const [loading, setLoading] = useState(false)
  const [javCode, setJavCode] = useState('')
  const [activeSubtitleId, setActiveSubtitleId] = useState(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  // 打开时选中第一个视频；切换作品时重置。
  useEffect(() => {
    setSelectedVideoId(list[0]?.id || 0)
  }, [list])

  const currentVideo = useMemo(
    () => list.find((item) => item.id === selectedVideoId) || list[0] || null,
    [list, selectedVideoId]
  )
  const videoId = currentVideo?.id || 0

  useEffect(() => {
    if (!videoId) {
      setSubtitles([])
      setJavCode('')
      setActiveSubtitleId(null)
      return undefined
    }
    let cancelled = false
    setLoading(true)
    setActiveSubtitleId(null)
    setActionError('')
    fetchVideoSubtitles(videoId)
      .then((data) => {
        if (cancelled) return
        setSubtitles(data.items)
        setJavCode(data.javCode || '')
      })
      .catch((error) => {
        if (cancelled) return
        setSubtitles([])
        setActionError(getErrorMessage(error))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [videoId])

  const defaultKeyword = useMemo(() => {
    const fromServer = String(javCode || '').trim()
    if (fromServer) return fromServer
    return String(currentVideo?.jav?.code || currentVideo?.locations?.[0]?.jav?.code || '').trim()
  }, [currentVideo, javCode])

  const handleSelectSubtitle = useCallback(
    async (subtitleId) => {
      if (!videoId || busy) return
      setBusy(true)
      setActionError('')
      try {
        await controlVideoSubtitleInMPV(videoId, subtitleId || 0)
        setActiveSubtitleId(subtitleId || null)
        onToast?.(
          subtitleId
            ? zh('已在 MPV 中加载该字幕', 'Subtitle loaded in MPV')
            : zh('已关闭 MPV 字幕', 'MPV subtitles turned off')
        )
      } catch (error) {
        setActionError(getErrorMessage(error))
      } finally {
        setBusy(false)
      }
    },
    [busy, onToast, videoId]
  )

  if (!currentVideo) return null

  return (
    <AppModal
      ariaLabel={zh('字幕', 'Subtitles')}
      className="px-4"
      contentClassName="w-full max-w-md rounded-lg bg-white shadow-xl"
      onClose={onClose}
      zIndex={1600}
    >
      <div className="flex h-[70vh] max-h-[560px] flex-col">
        {list.length > 1 ? (
          <label className="flex flex-none items-center gap-2 border-b border-zinc-200 px-3 py-2 text-[11px] text-zinc-500">
            <span className="flex-none">{zh('视频文件', 'Video file')}</span>
            <select
              value={selectedVideoId}
              onChange={(event) => setSelectedVideoId(Number(event.target.value))}
              className="min-w-0 flex-1 rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {list.map((item) => (
                <option key={item.id} value={item.id}>
                  {getVideoDisplayName(item)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <p className="flex-none border-b border-zinc-200 px-3 py-2 text-[11px] leading-5 text-zinc-500">
          {zh(
            '选择字幕后会立即加载到正在播放的 MPV 窗口；下次用 MPV 播放这个视频时，已下载的字幕会自动带上（可用 mpv 的 j / J 键切换轨道）。',
            'Picking a subtitle loads it into the running MPV window right away. Downloaded subtitles also load automatically the next time MPV plays this video (switch tracks with j / J).'
          )}
        </p>
        {actionError ? (
          <p className="flex-none border-b border-red-100 bg-red-50 px-3 py-2 text-[11px] leading-5 text-red-700">
            {actionError}
          </p>
        ) : null}
        <div className="min-h-0 flex-1">
          <PlayerSubtitlePanel
            key={videoId}
            video={currentVideo}
            defaultKeyword={defaultKeyword}
            subtitles={subtitles}
            loading={loading || busy}
            activeSubtitleId={activeSubtitleId}
            onSelectSubtitle={handleSelectSubtitle}
            onSubtitlesChange={setSubtitles}
            onClose={onClose}
          />
        </div>
      </div>
    </AppModal>
  )
}
