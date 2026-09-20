import { useEffect, useRef, useState } from 'react'
import videojs from 'video.js'
import 'video.js/dist/video-js.css'

import { fetchPlaybackInfo, incrementVideoPlayCount } from '@/api'
import Icon from '@/components/Icons'
import { selectPlaybackSource, startBrowserPlayback } from '@/utils/browserPlayback'
import { getVideoDisplayName, parseVideoFingerprint, formatBytes } from '@/utils/display'
import { formatDuration, formatReleaseDate } from '@/utils/format'
import { clearProgress, readProgress, writeProgress } from '@/utils/progress'
import { getErrorMessage } from '@/utils/errors'
import { zh } from '@/utils/i18n'

const SAVE_INTERVAL_MS = 5000

export default function PlayerPage({ video, onClose }) {
  const stageRef = useRef(null)
  const [status, setStatus] = useState('loading')
  const [errorText, setErrorText] = useState('')
  const [resumeAt, setResumeAt] = useState(() => readProgress(video?.id))

  useEffect(() => {
    const stage = stageRef.current
    if (!video || !stage) return undefined

    let disposed = false
    let stopPlayback = null
    let saveTimer = null

    const element = document.createElement('video-js')
    element.classList.add('vjs-big-play-centered')
    element.setAttribute('playsinline', 'true')
    stage.appendChild(element)

    const player = videojs(element, {
      controls: true,
      autoplay: true,
      preload: 'auto',
      fill: true,
      playsinline: true,
      playbackRates: [0.5, 1, 1.25, 1.5, 2],
    })

    const persist = () => {
      const current = player.currentTime()
      if (Number.isFinite(current)) writeProgress(video.id, current)
    }
    const onTimeUpdate = () => {
      if (saveTimer !== null) return
      saveTimer = window.setTimeout(() => {
        saveTimer = null
        persist()
      }, SAVE_INTERVAL_MS)
    }
    const onPause = () => persist()
    const onEnded = () => clearProgress(video.id)

    player.on('timeupdate', onTimeUpdate)
    player.on('pause', onPause)
    player.on('ended', onEnded)

    ;(async () => {
      try {
        const info = await fetchPlaybackInfo(video.id, { locationId: video.location_id })
        if (disposed) return
        const probe = document.createElement('video')
        const source = selectPlaybackSource(info, probe)
        const fallback = (info.sources || []).find((item) => item.kind === 'hls') || null
        if (!source) {
          setStatus('error')
          setErrorText(zh('没有可用的播放源', 'No playable source is available'))
          return
        }
        stopPlayback = startBrowserPlayback(player, source, fallback, resumeAt, () => {
          setStatus('error')
          setErrorText(
            zh(
              '浏览器无法解码这个文件，可尝试在电脑端用 MPV 播放',
              'The browser cannot decode this file. Try MPV on desktop.'
            )
          )
        })
        setStatus('ready')
        incrementVideoPlayCount(video.id).catch(() => {})
      } catch (error) {
        if (disposed) return
        setStatus('error')
        setErrorText(getErrorMessage(error))
      }
    })()

    return () => {
      disposed = true
      persist()
      if (saveTimer !== null) window.clearTimeout(saveTimer)
      stopPlayback?.()
      player.off('timeupdate', onTimeUpdate)
      player.off('pause', onPause)
      player.off('ended', onEnded)
      try {
        player.dispose()
      } catch {
        /* 卸载竞态，忽略 */
      }
    }
  }, [video, resumeAt])

  if (!video) return null

  const displayName = getVideoDisplayName(video)
  const fingerprint = parseVideoFingerprint(video?.fingerprint)
  const sizeText = formatBytes(fingerprint.size || video?.size)
  const duration = formatDuration(video?.duration_sec)
  const resolution =
    fingerprint.width && fingerprint.height ? `${fingerprint.width}×${fingerprint.height}` : ''
  const jav = video?.jav || video?.locations?.[0]?.jav || null
  const code = String(jav?.code || '').trim()
  const idols = (jav?.idols || []).map((idol) => idol?.name).filter(Boolean)
  const tags = (video?.tags || []).map((tag) => tag?.name).filter(Boolean)
  const released = formatReleaseDate(jav?.release_unix)

  const metaItems = [resolution, sizeText, duration, released].filter(Boolean)

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0b0f16]">
      <header className="flex h-[46px] flex-none items-center gap-2 px-1.5 text-zinc-100">
        <button
          type="button"
          onClick={onClose}
          aria-label={zh('返回', 'Back')}
          className="grid h-9 w-9 place-items-center rounded-[10px] active:bg-white/10"
        >
          <Icon name="back" size={20} />
        </button>
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold">{displayName}</h2>
      </header>

      <div ref={stageRef} className="stage relative aspect-video w-full flex-none bg-black" />

      <div className="min-h-0 flex-1 overflow-y-auto bg-[#eff1f4]">
        <section className="border-b border-[#e6e8ec] bg-white px-3.5 py-3.5">
          <h3 className="text-[14.5px] font-semibold leading-snug text-zinc-900">{displayName}</h3>

          {metaItems.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-zinc-500">
              {metaItems.map((item) => (
                <span key={item} className="rounded bg-[#f1f2f5] px-[7px] py-[2px]">
                  {item}
                </span>
              ))}
            </div>
          ) : null}

          {status === 'error' ? (
            <div className="mt-3 flex items-start gap-2 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] leading-relaxed text-red-700">
              <Icon name="ban" size={15} className="mt-[1px] flex-none" />
              <span>{errorText}</span>
            </div>
          ) : null}

          {status === 'loading' ? (
            <div className="mt-3 flex items-center gap-2 text-[12px] text-zinc-500">
              <span className="spin h-3.5 w-3.5 rounded-full border-2 border-zinc-300 border-t-zinc-500" />
              {zh('正在准备播放…', 'Preparing playback...')}
            </div>
          ) : null}

          {resumeAt > 0 ? (
            <div className="mt-3 flex items-center gap-2 rounded-[10px] border border-orange-200 bg-orange-50 px-3 py-2.5 text-[12px] text-orange-800">
              <Icon name="clock" size={15} className="flex-none" />
              <span className="flex-1">
                {zh(
                  `已从上次位置 ${formatDuration(resumeAt)} 续播`,
                  `Resumed at ${formatDuration(resumeAt)}`
                )}
              </span>
              <button
                type="button"
                onClick={() => {
                  clearProgress(video.id)
                  setResumeAt(0)
                }}
                className="flex-none font-semibold underline"
              >
                {zh('从头播放', 'Restart')}
              </button>
            </div>
          ) : null}
        </section>

        {code || idols.length || tags.length ? (
          <section className="border-b border-[#e6e8ec] bg-white px-3.5 py-3.5">
            {code ? (
              <div className="mb-2 flex items-center gap-2 text-[12px] text-zinc-600">
                <span className="rounded bg-zinc-100 px-[5px] text-[10px] font-bold leading-[15px] text-zinc-400">
                  {zh('番号', 'Code')}
                </span>
                <span className="font-semibold text-zinc-800">{code}</span>
              </div>
            ) : null}
            {idols.length ? (
              <div className="mb-2 flex items-center gap-2 text-[12px] text-zinc-600">
                <span className="rounded bg-zinc-100 px-[5px] text-[10px] font-bold leading-[15px] text-zinc-400">
                  {zh('演员', 'Cast')}
                </span>
                <span className="truncate">{idols.join(' · ')}</span>
              </div>
            ) : null}
            {tags.length ? (
              <div className="flex items-start gap-2 text-[12px] text-zinc-600">
                <span className="rounded bg-zinc-100 px-[5px] text-[10px] font-bold leading-[15px] text-zinc-400">
                  {zh('标签', 'Tags')}
                </span>
                <span className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded bg-[#fdba74] px-[5px] text-[10px] font-bold leading-[15px] text-zinc-900"
                    >
                      {tag}
                    </span>
                  ))}
                </span>
              </div>
            ) : null}
          </section>
        ) : null}

        <p className="px-3.5 py-4 text-[11px] leading-relaxed text-zinc-400">
          {zh(
            '移动端使用浏览器播放。JavBoss 只读取视频文件，不会修改或删除它们。',
            'Playback runs in your browser. JavBoss only reads your video files; it never modifies or deletes them.'
          )}
        </p>
      </div>
    </div>
  )
}
