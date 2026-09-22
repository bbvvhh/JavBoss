import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import videojs from 'video.js'
import 'video.js/dist/video-js.css'

import {
  fetchPlaybackInfo,
  fetchVideoSubtitleVTT,
  fetchVideoSubtitles,
  incrementVideoPlayCount,
} from '@/api'
import BottomSheet from '@/components/BottomSheet'
import Icon from '@/components/Icons'
import PlayerControls from '@/components/PlayerControls'
import SubtitleSheet from '@/components/SubtitleSheet'
import usePlayerGesture from '@/hooks/usePlayerGesture'
import { formatBoostSpeed } from '@/utils/boostSpeed'
import { selectPlaybackSource, startBrowserPlayback } from '@/utils/browserPlayback'
import { getVideoDisplayName, parseVideoFingerprint, formatBytes } from '@/utils/display'
import { formatDuration, formatReleaseDate } from '@/utils/format'
import { isBoostEnabled, readBoostSpeed } from '@/utils/playbackPrefs'
import { clearProgress, readProgress, writeProgress } from '@/utils/progress'
import { formatSeekClock, formatSeekDelta } from '@/utils/seekMath'
import { getErrorMessage } from '@/utils/errors'
import { zh } from '@/utils/i18n'

const SAVE_INTERVAL_MS = 5000

export default function PlayerPage({ video, onClose }) {
  const stageRef = useRef(null)
  const playerRef = useRef(null)
  // 已挂到 video.js 上的字幕轨（含 blob URL，销毁时必须回收）。
  const subtitleTracksRef = useRef([])
  const activeSubtitleRef = useRef(null)
  const applySubtitleRef = useRef(null)
  // 长按加速前的常驻倍速，松手时还原（长按是临时加速，不写任何持久设置）。
  const baseRateRef = useRef(1)
  const [player, setPlayer] = useState(null)
  const [status, setStatus] = useState('loading')
  const [errorText, setErrorText] = useState('')
  const [resumeAt, setResumeAt] = useState(() => readProgress(video?.id))
  const [subtitles, setSubtitles] = useState([])
  const [subtitlesLoading, setSubtitlesLoading] = useState(false)
  const [activeSubtitleId, setActiveSubtitleId] = useState(null)
  const [subtitleSheetOpen, setSubtitleSheetOpen] = useState(false)
  const [subtitleError, setSubtitleError] = useState('')
  const [subtitleJavCode, setSubtitleJavCode] = useState('')

  // 默认搜索关键词永远是 jav 表的 code（番号），本地文件名只用于
  // 「哪份字幕更合适」的匹配。优先用服务端解析出的 jav_code。
  const defaultSubtitleKeyword = useMemo(() => {
    const fromServer = String(subtitleJavCode || '').trim()
    if (fromServer) return fromServer
    const jav = video?.jav || video?.locations?.[0]?.jav || null
    return String(jav?.code || '').trim()
  }, [subtitleJavCode, video])

  const removeSubtitleTracks = useCallback(() => {
    const player = playerRef.current
    for (const entry of subtitleTracksRef.current) {
      try {
        if (player && !player.isDisposed()) player.removeRemoteTextTrack(entry.element)
      } catch {
        /* 播放器已销毁，忽略 */
      }
      if (entry.blobUrl) URL.revokeObjectURL(entry.blobUrl)
    }
    subtitleTracksRef.current = []
  }, [])

  // 字幕文本先由前端取回、再做成 blob URL 交给 video.js：这样即使 <track>
  // 的请求不带 Cookie，也不会因为 401 而静默失败。
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
        // 把 manualCleanup=false 的远程字幕轨全部摘掉。真机症状正是「界面显示已加载
        // 字幕、画面上却什么都没有，先关掉再选一次才正常」——第二次挂载发生在
        // src() 之后，所以侥幸生效。字幕轨的生命周期由 removeSubtitleTracks() 自己管。
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

  // 打开视频时读取本地字幕：有就直接挂上最新的一条，可在字幕抽屉里切换或关闭。
  useEffect(() => {
    if (!video?.id) {
      setSubtitles([])
      setActiveSubtitleId(null)
      setSubtitleJavCode('')
      return undefined
    }
    let cancelled = false
    setSubtitlesLoading(true)
    setSubtitleJavCode('')
    fetchVideoSubtitles(video.id)
      .then((data) => {
        if (cancelled) return
        setSubtitles(data.items)
        setSubtitleJavCode(data.javCode || '')
        const latest = data.items[data.items.length - 1]
        setActiveSubtitleId(latest ? latest.id : null)
      })
      .catch(() => {
        if (cancelled) return
        setSubtitles([])
      })
      .finally(() => {
        if (!cancelled) setSubtitlesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [video?.id])

  // 长按加速的本机偏好读一次就够：播放页是全屏浮层，要改设置必须先关掉它。
  const [boostEnabled] = useState(() => isBoostEnabled())
  const [boostSpeed] = useState(() => readBoostSpeed())
  const {
    boost,
    seek,
    active: gestureActive,
    handlers: stageGestures,
  } = usePlayerGesture({
    boostEnabled,
    speed: boostSpeed,
    // 拖动画面调进度只需要当前时长和当前位置：换算跟屏幕宽度无关
    // （见 seekMath.seekDragSecondsPerPixel）。时长还没出来时返回 null，
    // 手势会被放弃，否则会把 NaN 塞进 currentTime。
    getSeekContext: () => {
      const current = playerRef.current
      const duration = Number(current?.duration())
      if (!Number.isFinite(duration) || duration <= 0) return null
      return { duration, currentTime: Number(current.currentTime()) || 0 }
    },
    onBoostStart: () => {
      const current = playerRef.current
      if (!current) return
      baseRateRef.current = current.playbackRate()
      // 刻意不调 userActive(true)：长按加速只弹右上角那个小胶囊，
      // 控制条（含进度条）必须保持隐藏（见下面 jb-boost 的说明）。
    },
    onBoostSpeed: (value) => playerRef.current?.playbackRate(value),
    // 松手即还原：长按只做临时加速，常驻倍速仍然由控制条上的倍速按钮管。
    onBoostEnd: () => playerRef.current?.playbackRate(baseRateRef.current),
    // 拖画面调进度：拖动期间不动视频，松手才定位一次（避免反复重新加载）。
    onSeekCommit: (time) => playerRef.current?.currentTime(time),
  })

  // 全屏状态：全屏时所有浮层都要搬进播放器元素里。
  // 全屏元素是 .video-js，它外面的内容浏览器一律不渲染 —— 不搬进去，
  // 全屏下就既没有自绘进度条，也没有倍速 / 进度提示（真机反馈）。
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    if (!player) return undefined
    const sync = () => {
      const value = Boolean(player.isFullscreen())
      setFullscreen(value)
      // 给 .video-js 打个标记，CSS 用来把 video.js 自己的控制条抬起来给
      // 自绘进度条让位、并让自绘条跟随控制条自动隐藏（见 index.css）。
      if (value) player.addClass('jb-seek-overlay')
      else player.removeClass('jb-seek-overlay')
    }
    player.on('fullscreenchange', sync)
    sync()
    return () => player.off('fullscreenchange', sync)
  }, [player])

  // 手势进行中时强制显示自绘控制条：全屏下它会跟随控制条一起自动隐藏，
  // 但拖动调进度的时候必须能看到目标位置。
  //
  // 只有「拖动调进度」才需要它 —— 长按加速是另一回事：那时候控制条（进度条）
  // 必须保持隐藏，只留右上角的倍速胶囊当提示（真机反馈：长按加速时进度条
  // 会跟着弹出来，看着很乱）。所以这个类由 seek 驱动，不能用 active。
  useEffect(() => {
    if (!player) return undefined
    if (seek) player.addClass('jb-gesture')
    else player.removeClass('jb-gesture')
    return undefined
  }, [player, seek])

  // 长按加速期间强制隐藏自绘控制条。
  //
  // 光靠「不加 jb-gesture」还不够：长按是触摸事件，video.js 自己会把
  // 「有触摸」判成用户活跃，于是 .vjs-user-inactive 被摘掉，全屏下那条进度
  // 控制条就露出来了。jb-boost 用一条更高优先级的规则把它按住（见 index.css）。
  useEffect(() => {
    if (!player) return undefined
    if (boost) player.addClass('jb-boost')
    else player.removeClass('jb-boost')
    return undefined
  }, [player, boost])

  // 画面手势进行中（或长按计时中）时，尽量别让浏览器把竖向滑动识别成
  // 「亮度 / 音量」这类内置手势。
  //
  // 必须用原生监听 + passive: false：React 的合成事件对 touchmove 是 passive 的，
  // 在 onTouchMove 里 preventDefault 不生效。舞台本身不可滚动（touch-action: none
  // 已经关掉了滚动 / 缩放），所以这里 preventDefault 没有副作用。
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return undefined
    const block = (event) => {
      if (event.cancelable) event.preventDefault()
    }
    stage.addEventListener('touchmove', block, { passive: false })
    return () => stage.removeEventListener('touchmove', block)
  }, [])

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
      // 不要「原生视频全屏」。
      //
      // iPhone / 部分 iOS 浏览器上不支持元素全屏，video.js 会把 <video> 交给
      // 系统播放器全屏（requestFullscreenHelper_ 的第 2 条分支）。那时是系统
      // 控制条在接管：自定义控制条、自绘进度条、画面手势全部收不到事件 ——
      // 真机表现就是「全屏下长按不出倍速提示，滑动却在拖系统进度条」。
      // 置 true 后这类设备改用 full-window 模式（CSS 铺满视口 + 锁页面滚动），
      // 自定义控制条与手势全部保留；支持元素全屏的浏览器不受影响，
      // 依旧走真正的全屏。
      preferFullWindow: true,
    })
    playerRef.current = player
    setPlayer(player)
    applySubtitleRef.current?.()

    // video.js 自带控制条整个被 CSS 藏掉了（见 index.css），这里再把它里面的
    // 进度控制 disable + 摘掉，属于双保险：
    // - disable() 会摘掉它自己的 mousedown / touchstart / touchmove 监听，
    //   包括上一次交互残留在 document 上的 touchmove ——「滑动顺手把进度条
    //   拖走」的其中一条路径就是从那儿来的；
    // - removeChild（而不是 dispose，dispose 之后 video.js 内部 reset 会在
    //   已销毁实例上调 update() 抛错）确保它不会因为任何原因重新出现。
    const controlBar = player.getChild('controlBar')
    const progressControl = controlBar?.getChild('progressControl')
    if (progressControl && controlBar) {
      progressControl.disable()
      controlBar.removeChild(progressControl)
    }

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
      removeSubtitleTracks()
      playerRef.current = null
      setPlayer(null)
      try {
        player.dispose()
      } catch {
        /* 卸载竞态，忽略 */
      }
    }
  }, [video, resumeAt, removeSubtitleTracks])

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

  const overlayPills = (
    <>
      {/* 提示互斥：一次只出现一种。倍速优先 —— 万一有多指等边界情况留下过进度
          提示，也不会出现「长按加速时还挂着进度提示」。 */}
      {boost ? (
        // 长按加速的倍速指示：只放右上角一个小胶囊。
        // 不做居中面板、不写操作文案 —— 画面本身就那么点大，提示越少越好，
        // 手势说明放在「播放设置」页里。
        <div className="pointer-events-none absolute right-2 top-2 z-10 rounded-full bg-black/60 px-2.5 py-1 text-[12px] font-semibold tabular-nums text-white">
          {formatBoostSpeed(boost)}
        </div>
      ) : seek ? (
        // 拖动画面调进度：左上角显示目标时间与增量
        <div className="pointer-events-none absolute left-2 top-2 z-10 rounded-full bg-black/60 px-2.5 py-1 text-[12px] font-semibold tabular-nums text-white">
          {formatSeekClock(seek.time)} · {formatSeekDelta(seek.delta)}
        </div>
      ) : null}
    </>
  )

  // 全屏时浮层必须搬进播放器元素内部，否则不在渲染树里、一律不显示
  //（全屏元素是 .video-js，它外面的内容浏览器不渲染）。
  const portalTarget = fullscreen ? player?.el?.() : null

  const controls = (
    <PlayerControls
      player={player}
      disabled={status === 'error'}
      overlay={Boolean(portalTarget)}
      blocked={gestureActive}
      fullscreen={fullscreen}
    />
  )

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
        <button
          type="button"
          onClick={() => setSubtitleSheetOpen(true)}
          aria-label={zh('在线字幕', 'Online subtitles')}
          className={`flex h-9 flex-none items-center gap-1 rounded-[10px] px-2 text-[12px] active:bg-white/10 ${
            subtitles.length ? 'text-brand-ink' : 'text-zinc-300'
          }`}
        >
          <Icon name="subtitles" size={18} />
          {subtitles.length ? <span>{subtitles.length}</span> : null}
        </button>
      </header>

      <div className="relative flex-none">
        {/* video.js 实例由上面的 effect 直接 append 进这个 div，所以它自己不能有
            React 子节点，否则两边会争同一个父节点。手势 HUD 因此放在兄弟层。

            `gesture-active`：手势一旦成立（长按加速 / 拖动调进度），控制条整体
            禁用交互。这样同一次滑动不可能既被我们处理、又碰到控制条上的
            进度条或音量 —— 真机上出现过「滑动既改倍速又跳进度」。 */}
        <div
          ref={stageRef}
          className={`stage aspect-video w-full bg-black ${gestureActive ? 'gesture-active' : ''}`}
          {...stageGestures}
        />

        {/* 非全屏时浮层挂在舞台上的兄弟层（video.js 元素自己不能有 React 子节点） */}
        {portalTarget ? null : overlayPills}
      </div>

      {/* 全屏时把浮层（提示 + 自绘控制条）整体搬进播放器元素内部：
          全屏元素是 .video-js，它外面的内容浏览器一律不渲染 —— 不搬进去，
          全屏下既看不到倍速 / 进度提示，也没有控制条（真机反馈的
          「全屏下没有倍速提示、滑动却在动进度条」就是这个原因）。 */}
      {portalTarget
        ? createPortal(
            <>
              {overlayPills}
              {controls}
            </>,
            portalTarget
          )
        : controls}

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

          {subtitleError ? (
            <div className="mt-3 flex items-start gap-2 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] leading-relaxed text-amber-800">
              <Icon name="subtitles" size={15} className="mt-[1px] flex-none" />
              <span className="flex-1">{subtitleError}</span>
              <button
                type="button"
                onClick={() => setSubtitleSheetOpen(true)}
                className="flex-none font-semibold underline"
              >
                {zh('字幕', 'Subtitles')}
              </button>
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
            '移动端使用浏览器播放。JavBoss 只读取视频文件，不会修改或删除它们。字幕文件保存在 JavBoss 自己的 data/subtitle 目录里。',
            'Playback runs in your browser. JavBoss only reads your video files; it never modifies or deletes them. Subtitles are stored inside JavBoss’ own data/subtitle directory.'
          )}
        </p>
      </div>

      <BottomSheet
        open={subtitleSheetOpen}
        title={zh('在线字幕', 'Online subtitles')}
        height="78vh"
        onClose={() => setSubtitleSheetOpen(false)}
      >
        <SubtitleSheet
          video={video}
          defaultKeyword={defaultSubtitleKeyword}
          subtitles={subtitles}
          loading={subtitlesLoading}
          activeSubtitleId={activeSubtitleId}
          onSelectSubtitle={setActiveSubtitleId}
          onSubtitlesChange={setSubtitles}
        />
      </BottomSheet>
    </div>
  )
}
