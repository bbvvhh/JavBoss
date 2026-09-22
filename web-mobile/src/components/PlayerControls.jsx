import { useCallback, useEffect, useRef, useState } from 'react'

import Icon from '@/components/Icons'
import {
  FINE_HOLD_MS,
  FINE_MOVE_TOLERANCE_PX,
  SEEK_STEP_SECONDS,
  applyFineDrag,
  formatSeekClock,
  formatSeekDelta,
  pointerTime,
  ratioForTime,
  stepTime,
  timeForRatio,
} from '@/utils/seekMath'
import { zh } from '@/utils/i18n'

/** 刷新间隔。5Hz 足够让进度条看起来是连续的，也不至于一直重渲染。 */
const SYNC_INTERVAL_MS = 200

/** 步进 / 换档提示停留时长。 */
const HINT_MS = 900

/** 常驻倍速档位。原来是 video.js 控制条上的倍速菜单，现在由这个按钮循环切换。 */
const RATE_OPTIONS = [1, 1.25, 1.5, 2, 0.5]

const BUTTON_CLASS =
  'grid h-8 w-9 flex-none place-items-center rounded-[8px] text-zinc-200 active:bg-white/15 disabled:opacity-40'

/**
 * 自绘播放控制条：进度 + 播放控制。
 *
 * video.js 自带控制条在移动端被整体隐藏了（见 index.css），所以这里要把它原有的
 * 功能都接过来：进度条、当前/总时长、±10s、播放暂停、静音、常驻倍速、画中画、
 * 全屏。视频播放本身仍然由 video.js 驱动，这里只是换了一层皮。
 *
 * 进度部分的两条设计约束（都是真机反馈换来的）：
 * - 拖动时**不做实时 seek**，只在松手时定位一次。边拖边 seek 会让浏览器/转码流
 *   反复重新加载，出现多个 loading 叠加，而且没松手视频就不正常播放了。
 * - 拖动中手指停住 0.5 秒进入精细模式（位移放大 10 倍），补上手机屏上
 *   「1 像素十几秒」的精度问题。
 *
 * `overlay`：全屏时由 PlayerPage portal 进 `.video-js` 内部（全屏元素外面的内容
 * 浏览器不渲染），这时压在最底部，并跟随控制条自动隐藏。
 */
export default function PlayerControls({
  player,
  disabled = false,
  overlay = false,
  blocked = false,
  fullscreen = false,
}) {
  const trackRef = useRef(null)
  const dragRef = useRef(null)
  const holdTimerRef = useRef(null)
  const hintTimerRef = useRef(null)

  const [duration, setDuration] = useState(0)
  const [position, setPosition] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [drag, setDrag] = useState(null)
  const [hint, setHint] = useState('')
  const [paused, setPaused] = useState(true)
  const [muted, setMuted] = useState(false)
  const [rate, setRate] = useState(1)
  const [pip, setPip] = useState(false)

  useEffect(() => {
    if (!player) return undefined
    const sync = () => {
      const total = player.duration()
      setDuration(Number.isFinite(total) && total > 0 ? total : 0)
      const bufferedValue = Number(player.bufferedPercent?.())
      setBuffered(Number.isFinite(bufferedValue) ? Math.min(Math.max(bufferedValue, 0), 1) : 0)
      setPaused(Boolean(player.paused()))
      setMuted(Boolean(player.muted()))
      const currentRate = Number(player.playbackRate())
      setRate(Number.isFinite(currentRate) ? currentRate : 1)
      setPip(Boolean(player.isInPictureInPicture?.()))
      // 拖动中位置由手指决定，不能被 timeupdate 抢回去。
      if (dragRef.current) return
      const current = Number(player.currentTime())
      setPosition(Number.isFinite(current) ? current : 0)
    }
    const events = [
      'timeupdate',
      'seeking',
      'seeked',
      'durationchange',
      'loadedmetadata',
      'progress',
      'ended',
      'play',
      'pause',
      'volumechange',
      'ratechange',
      'enterpictureinpicture',
      'leavepictureinpicture',
    ]
    player.on(events, sync)
    const timer = window.setInterval(sync, SYNC_INTERVAL_MS)
    sync()
    return () => {
      player.off(events, sync)
      window.clearInterval(timer)
    }
  }, [player])

  useEffect(
    () => () => {
      if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current)
      if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current)
    },
    []
  )

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }, [])

  /** 手指停住不动 FINE_HOLD_MS 后进入精细模式，把位移放大 FINE_DRAG_FACTOR 倍。 */
  const scheduleFineMode = useCallback(() => {
    clearHoldTimer()
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null
      const state = dragRef.current
      if (!state || state.fine) return
      state.fine = true
      state.anchorX = state.lastX
      state.anchorTime = state.time
      setDrag({ time: state.time, delta: state.time - state.origin, fine: true })
    }, FINE_HOLD_MS)
  }, [clearHoldTimer])

  const showHint = useCallback((text) => {
    if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current)
    setHint(text)
    hintTimerRef.current = window.setTimeout(() => {
      hintTimerRef.current = null
      setHint('')
    }, HINT_MS)
  }, [])

  const onPointerDown = useCallback(
    (event) => {
      // blocked：画面上正在跑手势（长按加速 / 拖画面调进度），这一条不参与，
      // 否则一次滑动会同时被两处处理 —— 真机上出现过「滑动既改倍速又动进度」。
      if (disabled || blocked || !player) return
      if (dragRef.current) return
      const track = trackRef.current
      if (!track) return
      const rect = track.getBoundingClientRect()
      if (!rect.width) return
      const total = Number(player.duration())
      if (!Number.isFinite(total) || total <= 0) return

      const origin = Number(player.currentTime())
      const time = pointerTime(event.clientX, rect, total)
      const safeOrigin = Number.isFinite(origin) ? origin : 0
      dragRef.current = {
        id: event.pointerId,
        el: event.currentTarget,
        rect,
        lastX: event.clientX,
        anchorX: event.clientX,
        anchorTime: time,
        time,
        origin: safeOrigin,
        fine: false,
      }
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId)
      } catch {
        /* 指针已被释放，忽略 */
      }
      setDrag({ time, delta: time - safeOrigin, fine: false })
      scheduleFineMode()
    },
    [blocked, disabled, player, scheduleFineMode]
  )

  const onPointerMove = useCallback(
    (event) => {
      const state = dragRef.current
      if (!state || state.id !== event.pointerId || !player) return
      const total = Number(player.duration())
      const previousX = state.lastX
      state.lastX = event.clientX
      if (state.fine) {
        state.time = applyFineDrag(
          state.anchorTime,
          event.clientX - state.anchorX,
          total,
          state.rect.width
        )
      } else {
        state.time = timeForRatio((event.clientX - state.rect.left) / state.rect.width, total)
        // 手指真的动了就重新计时：精细模式只在「拖动后停住」时才出现。
        if (Math.abs(event.clientX - previousX) > FINE_MOVE_TOLERANCE_PX) scheduleFineMode()
      }
      setDrag({ time: state.time, delta: state.time - state.origin, fine: state.fine })
    },
    [player, scheduleFineMode]
  )

  const finishDrag = useCallback(
    (event, commit) => {
      const state = dragRef.current
      // 只有抬起的是拖动的那个手指才算数（多指时别误提交）。
      if (!state || state.id !== event.pointerId) return
      clearHoldTimer()
      dragRef.current = null
      setDrag(null)
      if (state.el?.hasPointerCapture?.(state.id)) {
        try {
          state.el.releasePointerCapture(state.id)
        } catch {
          /* 忽略 */
        }
      }
      // 松手才定位：拖动过程中视频保持正常播放，不做实时 seek。
      if (!commit || !player) return
      player.currentTime(state.time)
      setPosition(state.time)
    },
    [clearHoldTimer, player]
  )

  const step = useCallback(
    (delta) => {
      if (disabled || !player) return
      const next = stepTime(Number(player.currentTime()), delta, Number(player.duration()))
      player.currentTime(next)
      setPosition(next)
      showHint(
        `${delta > 0 ? zh('快进', 'Forward') : zh('快退', 'Rewind')} ${formatSeekDelta(delta)}`
      )
    },
    [disabled, player, showHint]
  )

  const togglePlay = useCallback(() => {
    if (!player) return
    if (player.paused()) player.play()?.catch?.(() => {})
    else player.pause()
  }, [player])

  const toggleMute = useCallback(() => {
    if (!player) return
    player.muted(!player.muted())
  }, [player])

  const cycleRate = useCallback(() => {
    if (!player) return
    const current = Number(player.playbackRate()) || 1
    const index = RATE_OPTIONS.indexOf(current)
    const next = RATE_OPTIONS[(index + 1) % RATE_OPTIONS.length]
    player.playbackRate(next)
    showHint(`${zh('倍速', 'Speed')} ${next}x`)
  }, [player, showHint])

  const togglePip = useCallback(() => {
    if (!player) return
    const result = player.isInPictureInPicture?.()
      ? player.exitPictureInPicture?.()
      : player.requestPictureInPicture?.()
    result?.catch?.(() => {})
  }, [player])

  const toggleFullscreen = useCallback(() => {
    if (!player) return
    const result = player.isFullscreen() ? player.exitFullscreen?.() : player.requestFullscreen?.()
    result?.catch?.(() => {})
  }, [player])

  const ready = Boolean(player) && duration > 0
  const playedPercent = ratioForTime(drag ? drag.time : position, duration) * 100
  const bufferedPercent = Math.min(100, Math.max(buffered * 100, playedPercent))

  const hud = drag
    ? `${formatSeekClock(drag.time)} · ${formatSeekDelta(drag.delta)}${drag.fine ? ` · ${zh('精细', 'Fine')}` : ''}`
    : hint

  const pipSupported = typeof document !== 'undefined' && Boolean(document.pictureInPictureEnabled)

  return (
    <div
      className={
        overlay
          ? // 全屏：portal 进 .video-js 内部，压在最底部
            'jb-controls absolute inset-x-0 bottom-0 z-20 bg-black/70 px-2.5 pb-2'
          : 'jb-controls relative flex-none bg-[#0b0f16] px-2.5 pb-2'
      }
    >
      {hud ? (
        <div className="pointer-events-none absolute -top-8 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/80 px-3 py-1 text-[12px] font-semibold tabular-nums text-white">
          {hud}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <span className="w-[54px] flex-none text-[11px] tabular-nums text-zinc-300">
          {formatSeekClock(position)}
        </span>

        <div
          ref={trackRef}
          role="slider"
          aria-label={zh('播放进度', 'Playback progress')}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(position)}
          aria-valuetext={formatSeekClock(position)}
          tabIndex={-1}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => finishDrag(event, true)}
          onPointerCancel={(event) => finishDrag(event, false)}
          className={`relative flex h-7 min-w-0 flex-1 touch-none items-center outline-none ${
            ready && !disabled ? '' : 'opacity-50'
          }`}
        >
          <div className="absolute top-1/2 h-[3px] w-full -translate-y-1/2 rounded-full bg-white/20" />
          <div
            className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white/25"
            style={{ width: `${bufferedPercent}%` }}
          />
          <div
            className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-brand"
            style={{ width: `${playedPercent}%` }}
          />
          <span
            className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.5)] ${
              drag ? 'scale-110' : ''
            }`}
            style={{ left: `${playedPercent}%` }}
          />
        </div>

        <span className="w-[54px] flex-none text-right text-[11px] tabular-nums text-zinc-400">
          {duration > 0 ? formatSeekClock(duration) : '--:--'}
        </span>
      </div>

      <div className="mt-0.5 flex items-center justify-center gap-1">
        <button
          type="button"
          onClick={togglePlay}
          disabled={!player}
          aria-label={paused ? zh('播放', 'Play') : zh('暂停', 'Pause')}
          className={BUTTON_CLASS}
        >
          <Icon name={paused ? 'play' : 'pause'} size={18} />
        </button>

        <button
          type="button"
          disabled={!ready || disabled}
          onClick={() => step(-SEEK_STEP_SECONDS)}
          className="h-8 flex-none rounded-[8px] bg-white/10 px-2.5 text-[11.5px] font-medium tabular-nums text-zinc-200 active:bg-white/20 disabled:opacity-40"
        >
          −{SEEK_STEP_SECONDS}s
        </button>
        <button
          type="button"
          disabled={!ready || disabled}
          onClick={() => step(SEEK_STEP_SECONDS)}
          className="h-8 flex-none rounded-[8px] bg-white/10 px-2.5 text-[11.5px] font-medium tabular-nums text-zinc-200 active:bg-white/20 disabled:opacity-40"
        >
          +{SEEK_STEP_SECONDS}s
        </button>

        <button
          type="button"
          onClick={toggleMute}
          disabled={!player}
          aria-label={muted ? zh('取消静音', 'Unmute') : zh('静音', 'Mute')}
          className={BUTTON_CLASS}
        >
          <Icon name={muted ? 'volumeMute' : 'volume'} size={18} />
        </button>

        <button
          type="button"
          onClick={cycleRate}
          disabled={!player}
          aria-label={zh('切换倍速', 'Playback speed')}
          className="h-8 min-w-[40px] flex-none rounded-[8px] px-1.5 text-[11.5px] font-semibold tabular-nums text-zinc-200 active:bg-white/15"
        >
          {rate}x
        </button>

        {pipSupported ? (
          <button
            type="button"
            onClick={togglePip}
            disabled={!player}
            aria-label={zh('画中画', 'Picture in picture')}
            aria-pressed={pip}
            className={`${BUTTON_CLASS} ${pip ? 'text-brand-ink' : ''}`}
          >
            <Icon name="pip" size={18} />
          </button>
        ) : null}

        <button
          type="button"
          onClick={toggleFullscreen}
          disabled={!player}
          aria-label={fullscreen ? zh('退出全屏', 'Exit fullscreen') : zh('全屏', 'Fullscreen')}
          className={BUTTON_CLASS}
        >
          <Icon name={fullscreen ? 'compress' : 'expand'} size={18} />
        </button>
      </div>
    </div>
  )
}
