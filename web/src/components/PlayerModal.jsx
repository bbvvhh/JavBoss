import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import SubtitlesRoundedIcon from '@mui/icons-material/SubtitlesRounded'
import videojs from 'video.js'
import 'video.js/dist/video-js.css'
import {
  clearVideoPlayback,
  createVideoScreenshot,
  fetchPlaybackInfo,
  fetchVideoPlayback,
  fetchVideoSubtitleVTT,
  fetchVideoSubtitles,
  reportVideoPlayback,
} from '@/api'
import { getVideoDisplayName } from '@/utils/display'
import {
  PLAYER_HOTKEY_ACTIONS,
  formatPlayerHotkeyKey,
  normalizePlayerHotkeyKey,
  parsePlayerHotkeys,
} from '@/utils/playerHotkeys'
import { PLAYBACK_REPORT_INTERVAL_MS, formatClock, resumeSecondsFrom } from '@/utils/playback'
import { zh } from '@/utils/i18n'
import AppModal from '@/components/AppModal'
import PlayerSubtitlePanel from '@/components/PlayerSubtitlePanel'
import { getErrorMessage } from '@/utils/errors'
import { selectPlaybackSource, startBrowserPlayback } from '@/utils/browserPlayback'

const VOLUME_STORAGE_KEY = 'javboss.player.volume'
const HOTKEY_HINT_DURATION_MS = 5000

function formatSignedAmount(amount) {
  return amount > 0 ? `+${amount}` : String(amount)
}

export default function PlayerModal({
  video,
  startTime = 0,
  onClose,
  hotkeys = null,
  showHotkeyHint = true,
  onPlaybackError,
}) {
  const videoContainerRef = useRef(null)
  const playerRef = useRef(null)
  const onCloseRef = useRef(onClose)
  const onPlaybackErrorRef = useRef(onPlaybackError)
  const hotkeyMapRef = useRef(new Map())
  const screenshotInFlightRef = useRef(false)
  const screenshotNoticeTimerRef = useRef(null)
  // 已挂到 video.js 上的字幕轨（含 blob URL，销毁时必须回收）。
  const subtitleTracksRef = useRef([])
  const activeSubtitleRef = useRef(null)
  const applySubtitleRef = useRef(null)
  const [playbackInfo, setPlaybackInfo] = useState(null)
  const [playbackError, setPlaybackError] = useState('')
  const [loadingPlayback, setLoadingPlayback] = useState(false)
  // 续播：startTime 为 0（不是从截图等明确时间点进来）时查服务端播放记录。
  const [resumeAt, setResumeAt] = useState(0)
  const [resumeNotice, setResumeNotice] = useState(false)
  const [resumeReady, setResumeReady] = useState(false)
  const [screenshotNotice, setScreenshotNotice] = useState(false)
  const [hotkeyHintVisible, setHotkeyHintVisible] = useState(false)
  const [subtitles, setSubtitles] = useState([])
  const [subtitlesLoading, setSubtitlesLoading] = useState(false)
  const [subtitleJavCode, setSubtitleJavCode] = useState('')
  const [activeSubtitleId, setActiveSubtitleId] = useState(null)
  const [subtitlePanelOpen, setSubtitlePanelOpen] = useState(false)
  const [subtitleError, setSubtitleError] = useState('')
  const normalizedHotkeys = useMemo(() => parsePlayerHotkeys(hotkeys), [hotkeys])
  const hotkeyHintLines = useMemo(() => {
    const lines = normalizedHotkeys.map((item) => {
      const key = formatPlayerHotkeyKey(item.key)
      const amount = formatSignedAmount(item.amount)
      if (item.action === PLAYER_HOTKEY_ACTIONS.SEEK) {
        return zh(`${key}：进度 ${amount} 秒`, `${key}: Seek ${amount} seconds`)
      }
      if (item.action === PLAYER_HOTKEY_ACTIONS.VOLUME) {
        return zh(`${key}：音量 ${amount}%`, `${key}: Volume ${amount}%`)
      }
      return zh(`${key}：截图`, `${key}: Screenshot`)
    })
    lines.push(zh('空格：暂停/继续', 'Space: Pause/Resume'))
    lines.push(zh('ESC：退出播放器', 'ESC: Close player'))
    lines.push(
      zh(
        '你可在「设置 → 播放器 → 浏览器播放器」里关闭此信息显示',
        'You can hide this message under Settings → Player → Browser Player.'
      )
    )
    return lines
  }, [normalizedHotkeys])
  const selectedSource = useMemo(() => {
    return selectPlaybackSource(playbackInfo, document.createElement('video'))
  }, [playbackInfo])

  // 默认搜索关键词永远是 jav 表的 code（番号），本地文件名只用于「哪份字幕更合适」的匹配。
  // 优先级：服务端解析出的 jav_code > video 对象上带的 jav 关联。
  const defaultSubtitleKeyword = useMemo(() => {
    const fromServer = String(subtitleJavCode || '').trim()
    if (fromServer) return fromServer
    return String(video?.jav?.code || video?.locations?.[0]?.jav?.code || '').trim()
  }, [subtitleJavCode, video])

  const removeSubtitleTracks = useCallback(() => {
    const player = playerRef.current
    for (const entry of subtitleTracksRef.current) {
      try {
        if (player && !player.isDisposed()) player.removeRemoteTextTrack(entry.element)
      } catch {
        // 播放器可能已经销毁，忽略。
      }
      if (entry.blobUrl) URL.revokeObjectURL(entry.blobUrl)
    }
    subtitleTracksRef.current = []
  }, [])

  // 字幕文本由前端取回后做成 blob URL 再交给 video.js：这样即使 <track> 的
  // 请求不带 Cookie（跨源模式），也不会因为 401 而静默失败。
  const applyActiveSubtitle = useCallback(async () => {
    const player = playerRef.current
    if (!player || player.isDisposed()) return
    removeSubtitleTracks()
    const target = activeSubtitleRef.current
    if (!target || !video?.id) return
    try {
      const text = await fetchVideoSubtitleVTT(video.id, target.id)
      if (player.isDisposed() || activeSubtitleRef.current?.id !== target.id) return
      const blobUrl = URL.createObjectURL(new Blob([text], { type: 'text/vtt' }))
      const element = player.addRemoteTextTrack(
        {
          kind: 'subtitles',
          label: String(target.title || target.filename || zh('字幕', 'Subtitles')),
          srclang: 'zh',
          src: blobUrl,
          default: true,
        },
        // manualCleanup 必须是 true：播放源是稍后才 player.src() 设置的，而
        // video.js 的 setSource → disposeSourceHandler 会调用 cleanupAutoTextTracks()，
        // 把 manualCleanup=false 的远程字幕轨全部摘掉（界面显示已加载、画面却没有字幕）。
        // 字幕轨的生命周期由 removeSubtitleTracks() 自己管。
        true
      )
      subtitleTracksRef.current.push({ element, blobUrl })
      if (element?.track) element.track.mode = 'showing'
      setSubtitleError('')
    } catch (error) {
      // 切换视频时旧请求可能晚到，只有它仍是当前选中项时才报错。
      if (player.isDisposed() || activeSubtitleRef.current?.id !== target.id) return
      setSubtitleError(getErrorMessage(error))
    }
  }, [removeSubtitleTracks, video?.id])

  useEffect(() => {
    applySubtitleRef.current = applyActiveSubtitle
  }, [applyActiveSubtitle])

  useEffect(() => {
    activeSubtitleRef.current = subtitles.find((item) => item.id === activeSubtitleId) || null
    applyActiveSubtitle()
  }, [activeSubtitleId, subtitles, applyActiveSubtitle])

  // 打开视频时读取本地字幕：有就直接挂上最新的一条，用户可在面板里切换或关闭。
  useEffect(() => {
    if (!video?.id) {
      setSubtitles([])
      setActiveSubtitleId(null)
      setSubtitlePanelOpen(false)
      setSubtitleError('')
      setSubtitleJavCode('')
      return undefined
    }
    let cancelled = false
    setSubtitlesLoading(true)
    setSubtitleError('')
    setSubtitleJavCode('')
    fetchVideoSubtitles(video.id)
      .then((data) => {
        if (cancelled) return
        setSubtitles(data.items)
        setSubtitleJavCode(data.javCode || '')
        const latest = data.items[data.items.length - 1]
        setActiveSubtitleId(latest ? latest.id : null)
      })
      .catch((error) => {
        if (cancelled) return
        setSubtitleError(getErrorMessage(error))
      })
      .finally(() => {
        if (cancelled) return
        setSubtitlesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [video?.id])

  useEffect(() => {
    setHotkeyHintVisible(false)
    if (!showHotkeyHint || !video?.id || !selectedSource?.src) return undefined

    setHotkeyHintVisible(true)
    const timer = window.setTimeout(() => setHotkeyHintVisible(false), HOTKEY_HINT_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [selectedSource?.src, showHotkeyHint, video?.id])

  useEffect(() => {
    hotkeyMapRef.current = new Map(normalizedHotkeys.map((item) => [item.key, item]))
  }, [normalizedHotkeys])

  useEffect(() => {
    onCloseRef.current = onClose
    onPlaybackErrorRef.current = onPlaybackError
  }, [onClose, onPlaybackError])

  useEffect(() => {
    return () => {
      if (screenshotNoticeTimerRef.current !== null) {
        window.clearTimeout(screenshotNoticeTimerRef.current)
        screenshotNoticeTimerRef.current = null
      }
    }
  }, [video?.id, video?.location_id])

  useEffect(() => {
    if (!video?.id) {
      setPlaybackInfo(null)
      setPlaybackError('')
      setLoadingPlayback(false)
      setScreenshotNotice(false)
      return
    }

    let cancelled = false
    setLoadingPlayback(true)
    setPlaybackError('')
    setPlaybackInfo(null)
    setScreenshotNotice(false)

    fetchPlaybackInfo(video.id, { locationId: video.location_id })
      .then((info) => {
        if (cancelled) return
        setPlaybackInfo(info)
      })
      .catch((err) => {
        if (cancelled) return
        const message = getErrorMessage(err)
        setPlaybackError(message)
        onPlaybackErrorRef.current?.(message)
      })
      .finally(() => {
        if (cancelled) return
        setLoadingPlayback(false)
      })

    return () => {
      cancelled = true
    }
  }, [video])

  // 续播位置：只有在没有明确起播时间（startTime<=0）时才读服务端播放记录。
  // 读记录期间不创建播放器，避免「先从 0 播、再跳回上次位置」的闪动。
  const requestedStart = Math.max(0, Number(startTime) || 0)
  useEffect(() => {
    setResumeAt(0)
    setResumeNotice(false)
    if (!video?.id) {
      setResumeReady(false)
      return undefined
    }
    if (requestedStart > 0) {
      setResumeReady(true)
      return undefined
    }

    let cancelled = false
    setResumeReady(false)
    fetchVideoPlayback(video.id)
      .then((record) => {
        if (cancelled) return
        const seconds = resumeSecondsFrom(record)
        if (seconds > 0) {
          setResumeAt(seconds)
          setResumeNotice(true)
        }
      })
      // 读不到记录不影响播放（例如记录被清掉），直接从头发起。
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setResumeReady(true)
      })

    return () => {
      cancelled = true
    }
  }, [video?.id, requestedStart])

  useEffect(() => {
    if (
      loadingPlayback ||
      !resumeReady ||
      !video ||
      !videoContainerRef.current ||
      !selectedSource?.src
    )
      return

    // Video.js removes its element on dispose; let React own only the container.
    const videoElement = document.createElement('video-js')
    videoElement.classList.add('video-js', 'vjs-big-play-centered', 'h-full', 'w-full')
    videoElement.setAttribute('playsinline', '')
    videoContainerRef.current.appendChild(videoElement)
    const player = videojs(videoElement, {
      controls: true,
      autoplay: true,
      preload: 'auto',
    })

    playerRef.current = player

    const playerEl = player.el()
    const savedVolume = (() => {
      try {
        const raw = localStorage.getItem(VOLUME_STORAGE_KEY)
        if (raw == null) return null
        const value = Number.parseFloat(raw)
        return Number.isFinite(value) ? value : null
      } catch {
        return null
      }
    })()

    if (savedVolume != null) {
      player.volume(Math.min(1, Math.max(0, savedVolume)))
    }

    const seekBy = (offsetSeconds) => {
      const current = player.currentTime() || 0
      const duration = player.duration()
      let next = current + offsetSeconds
      if (Number.isFinite(duration)) {
        next = Math.min(Math.max(0, next), duration)
      } else {
        next = Math.max(0, next)
      }
      player.currentTime(next)
    }

    const adjustVolume = (delta) => {
      const current = player.volume()
      const next = Math.min(1, Math.max(0, current + delta))
      player.volume(next)
    }

    const captureScreenshot = () => {
      if (!video?.id || screenshotInFlightRef.current) return
      const second = Math.max(0, Number(player.currentTime()) || 0)
      screenshotInFlightRef.current = true
      createVideoScreenshot(video.id, { second, locationId: video.location_id })
        .then(() => {
          // A response from a closed player must not recreate its notice timer.
          if (player.isDisposed()) return
          if (screenshotNoticeTimerRef.current) {
            window.clearTimeout(screenshotNoticeTimerRef.current)
          }
          setScreenshotNotice(true)
          screenshotNoticeTimerRef.current = window.setTimeout(() => {
            setScreenshotNotice(false)
            screenshotNoticeTimerRef.current = null
          }, 1600)
        })
        .catch((err) => {
          console.error(zh('截图失败', 'Failed to capture screenshot'), err)
        })
        .finally(() => {
          screenshotInFlightRef.current = false
        })
    }

    const handleKeyDown = (event) => {
      const target = event.target
      if (
        target instanceof Element &&
        (target.isContentEditable ||
          target.closest('input, textarea, select, [contenteditable="true"]'))
      ) {
        return
      }
      const key = normalizePlayerHotkeyKey(event.key || '')
      const configured = hotkeyMapRef.current.get(key)
      const markHandled = () => {
        event.preventDefault()
        event.stopPropagation()
      }
      if (
        configured &&
        (configured.action === PLAYER_HOTKEY_ACTIONS.SEEK ||
          configured.action === PLAYER_HOTKEY_ACTIONS.VOLUME ||
          configured.action === PLAYER_HOTKEY_ACTIONS.SCREENSHOT)
      ) {
        markHandled()
        if (configured.action === PLAYER_HOTKEY_ACTIONS.SEEK) {
          seekBy(configured.amount)
        } else if (configured.action === PLAYER_HOTKEY_ACTIONS.VOLUME) {
          adjustVolume(configured.amount / 100)
        } else if (configured.action === PLAYER_HOTKEY_ACTIONS.SCREENSHOT) {
          captureScreenshot()
        }
        return
      }
      switch (key) {
        case ' ':
        case 'Spacebar': {
          markHandled()
          if (player.paused()) {
            player.play()
          } else {
            player.pause()
          }
          break
        }
        case 'Escape':
          markHandled()
          onCloseRef.current?.()
          break
        default:
          return
      }
    }

    const focusPlayer = () => {
      playerEl?.focus({ preventScroll: true })
    }

    if (playerEl && !playerEl.hasAttribute('tabindex')) {
      playerEl.setAttribute('tabindex', '-1')
    }

    window.addEventListener('keydown', handleKeyDown, true)

    const handleVolumeChange = () => {
      try {
        localStorage.setItem(VOLUME_STORAGE_KEY, String(player.volume()))
      } catch {
        return
      }
    }

    // 上报进度：每 5 秒一次、暂停时一次、关闭播放器时一次。
    // 服务端按 video_id 只保留一条最新记录，所以频繁上报不会让数据无限增长。
    // 失败只在控制台提示一次：以前静默吞掉异常，接口一旦不匹配就很难发现。
    let reportFailureNotified = false
    const reportProgress = () => {
      const current = Number(player.currentTime())
      if (!Number.isFinite(current) || current < 1) return
      const duration = Number(player.duration())
      reportVideoPlayback(video.id, {
        positionSec: current,
        durationSec: Number.isFinite(duration) ? duration : 0,
        locationId: Number(video.location_id) || 0,
      }).catch((error) => {
        if (reportFailureNotified) return
        reportFailureNotified = true
        console.warn(zh('播放进度上报失败', 'Failed to report playback position'), error)
      })
    }
    let reportTimer = null
    let finished = false
    const handleTimeUpdate = () => {
      if (reportTimer !== null) return
      reportTimer = window.setTimeout(() => {
        reportTimer = null
        reportProgress()
      }, PLAYBACK_REPORT_INTERVAL_MS)
    }
    const handlePause = () => reportProgress()
    // 看完了就清掉记录，下次进来从头播（与移动端一致）。
    const handleEnded = () => {
      finished = true
      setResumeNotice(false)
      clearVideoPlayback(video.id).catch(() => {})
    }

    const stopPlayback = startBrowserPlayback(
      player,
      selectedSource,
      playbackInfo.sources.find((source) => source.kind === 'hls'),
      requestedStart || resumeAt,
      (error) => {
        const message = error.message || zh('视频播放失败', 'Video playback failed')
        setPlaybackError(message)
        onPlaybackErrorRef.current?.(message)
      }
    )
    player.ready(() => {
      focusPlayer()
      applySubtitleRef.current?.()
    })
    player.on('fullscreenchange', focusPlayer)
    player.on('volumechange', handleVolumeChange)
    player.on('timeupdate', handleTimeUpdate)
    player.on('pause', handlePause)
    player.on('ended', handleEnded)

    return () => {
      if (reportTimer !== null) window.clearTimeout(reportTimer)
      if (!finished) reportProgress()
      stopPlayback()
      window.removeEventListener('keydown', handleKeyDown, true)
      player.off('fullscreenchange', focusPlayer)
      player.off('volumechange', handleVolumeChange)
      player.off('timeupdate', handleTimeUpdate)
      player.off('pause', handlePause)
      player.off('ended', handleEnded)
      removeSubtitleTracks()
      player.dispose()
      playerRef.current = null
    }
  }, [
    video,
    requestedStart,
    resumeAt,
    resumeReady,
    selectedSource,
    playbackInfo,
    loadingPlayback,
    removeSubtitleTracks,
  ])

  // 「从头播放」：清掉服务端记录并回到开头，不重建播放器。
  const handleRestartFromBeginning = useCallback(() => {
    setResumeNotice(false)
    setResumeAt(0)
    if (video?.id) clearVideoPlayback(video.id).catch(() => {})
    const player = playerRef.current
    if (player && !player.isDisposed()) player.currentTime(0)
  }, [video?.id])

  if (!video) return null

  const displayName = getVideoDisplayName(video)

  return (
    <AppModal
      ariaLabel={displayName || zh('视频播放', 'Video playback')}
      backdropColor="rgba(0, 0, 0, 0.7)"
      className="px-4"
      contentClassName="relative w-full max-w-6xl rounded-lg bg-white shadow-lg"
      onClose={onClose}
      zIndex={1700}
    >
      <div className="flex flex-col gap-1.5 p-2">
        <header className="flex min-w-0 items-center gap-2">
          <h2
            className="min-w-0 flex-1 truncate text-xs font-semibold leading-4"
            title={displayName}
          >
            {displayName}
          </h2>
          <button
            type="button"
            aria-label={zh('在线字幕', 'Online subtitles')}
            title={zh('在线字幕', 'Online subtitles')}
            aria-pressed={subtitlePanelOpen}
            onClick={() => setSubtitlePanelOpen((open) => !open)}
            className={`inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-1.5 text-[10px] font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              subtitlePanelOpen
                ? 'bg-blue-600 text-white'
                : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800'
            }`}
          >
            <SubtitlesRoundedIcon sx={{ fontSize: 14 }} />
            {subtitles.length > 0 ? <span>{subtitles.length}</span> : null}
          </button>
          <button
            type="button"
            aria-label={zh('关闭', 'Close')}
            title={zh('关闭', 'Close')}
            onClick={onClose}
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <CloseRoundedIcon sx={{ fontSize: 16 }} />
          </button>
        </header>
        <div className="player-shell relative w-full bg-black">
          {screenshotNotice || hotkeyHintVisible || subtitleError ? (
            <div className="pointer-events-none absolute left-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-col items-start gap-2">
              {screenshotNotice ? (
                <div className="rounded bg-black/75 px-3 py-1.5 text-sm font-medium text-white shadow">
                  {zh('截图成功', 'Screenshot saved')}
                </div>
              ) : null}
              {subtitleError ? (
                <div className="max-w-full rounded bg-red-600/90 px-3 py-1.5 text-xs text-white shadow">
                  {subtitleError}
                </div>
              ) : null}
              {hotkeyHintVisible ? (
                <div className="max-h-[calc(100vh-12rem)] overflow-hidden rounded bg-black/75 px-3 py-2 text-xs leading-5 text-white shadow">
                  {hotkeyHintLines.map((line, index) => (
                    <div key={`${index}-${line}`}>{line}</div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {/* 续播提示：仅在自动续播（而不是点了截图等指定时间点）时出现。 */}
          {resumeNotice && requestedStart <= 0 ? (
            <div className="absolute bottom-12 left-3 z-10 flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded bg-black/75 px-3 py-1.5 text-xs text-white shadow">
              <span className="min-w-0 flex-1">
                {zh(
                  `已从上次位置 ${formatClock(resumeAt)} 续播`,
                  `Resumed at ${formatClock(resumeAt)}`
                )}
              </span>
              <button
                type="button"
                onClick={handleRestartFromBeginning}
                className="flex-none font-semibold underline hover:text-blue-300"
              >
                {zh('从头播放', 'Restart')}
              </button>
            </div>
          ) : null}
          {loadingPlayback ? (
            <div className="flex aspect-video items-center justify-center text-sm text-white">
              {zh('加载播放信息中…', 'Loading playback info...')}
            </div>
          ) : (
            <>
              <div ref={videoContainerRef} data-vjs-player className="h-full w-full" />
              {playbackError ? (
                <div role="alert" className="px-6 py-4 text-center text-sm text-red-200">
                  {playbackError}
                </div>
              ) : null}
            </>
          )}
          {subtitlePanelOpen ? (
            <div className="absolute right-0 top-0 z-20 h-full w-[330px] max-w-full overflow-hidden rounded-l-md border-l border-zinc-200 shadow-2xl">
              <PlayerSubtitlePanel
                key={video.id}
                video={video}
                defaultKeyword={defaultSubtitleKeyword}
                subtitles={subtitles}
                loading={subtitlesLoading}
                activeSubtitleId={activeSubtitleId}
                onSelectSubtitle={setActiveSubtitleId}
                onSubtitlesChange={setSubtitles}
                onClose={() => setSubtitlePanelOpen(false)}
              />
            </div>
          ) : null}
        </div>
      </div>
    </AppModal>
  )
}
