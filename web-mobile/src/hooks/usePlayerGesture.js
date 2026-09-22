import { useCallback, useEffect, useRef, useState } from 'react'

import { DEFAULT_BOOST_SPEED, boostSpeedForVerticalDrag } from '@/utils/boostSpeed'
import {
  BOOST_HOLD_MS,
  GESTURE_BOOST,
  GESTURE_PENDING,
  GESTURE_SEEK,
  resolvePendingGesture,
} from '@/utils/playerGesture'
import { seekTimeForDrag } from '@/utils/seekMath'

/**
 * 「吞掉这次 click」标记的有效期。
 *
 * 手势结束后浏览器一般会紧接着派发一次 click（video.js 把 click 挂在 <video> 上，
 * 默认行为是播放 / 暂停），必须拦掉。但有些情况（iOS 在 contextmenu 被
 * preventDefault 之后）根本不会派发 click —— 标记必须自己过期，否则会吞掉用户
 * 之后的一次正常点击，表现为「点播放按钮没反应」。
 */
const CLICK_SUPPRESS_MS = 400

/**
 * 落在这些元素上的按下不参与画面手势：控制条、大播放按钮、自绘进度条，
 * 以及任何真按钮。video.js 的播放/暂停是挂在内层 <video> 上的 click，
 * 所以画面区域本身不在排除范围里。
 */
const SKIP_SELECTOR =
  '.vjs-control-bar, .vjs-big-play-button, .jb-controls, button, a, input, [role="slider"]'

/** 这些位置上的 click 永远放行：它们是真按钮，不是我们要拦的画面点击。 */
const CLICK_PASS_SELECTOR = '.jb-controls, .vjs-control-bar, button, a, input, [role="slider"]'

/**
 * 画面手势：一次触摸只会进入一种模式，中途不切换。两个手势占用不同的轴，
 * 从物理上就不可能互相干扰。
 *
 * - 按住不动满 `BOOST_HOLD_MS`（1 秒）→ 倍速模式：继续**上下**滑动换档
 *   （向上加速、向下减速），横向滑动不做任何事，松手还原原速。
 * - 不到 1 秒就横向滑动 → 进度模式：拖动画面调进度，HUD 显示目标时间，松手定位。
 * - 竖向大幅度滑动（还没进入倍速时）→ 手势作废，什么都不做。
 *
 * 为什么必须「锁定模式 + 分轴」：真机上反复出现过同一次滑动既改了倍速、
 * 又把进度条拖走（全屏下尤其明显）。现在横向和竖向各归各，即使有系统 /
 * 浏览器手势插进来也不会串味。
 *
 * 几个必须做的事：
 * 1. **不用 `setPointerCapture`**：pointerdown 就抓指针会让浏览器把
 *    mousedown / mouseup / click 一起改派到舞台，普通单击的 click 就不再落在
 *    <video> 上，video.js 的播放 / 暂停会失效；而手势成立后再抓也不可靠 ——
 *    全屏时全屏元素是 .video-js，舞台在它后面（不在渲染树里），真机上捕获会失效，
 *    于是「长按加速时滑动」的事件又漏给了 video.js 的进度控制。
 *    改为手势期间把 pointermove / pointerup 挂在 window 捕获阶段：
 *    手指在哪、是不是全屏都收得到，且不干扰 compat 鼠标事件的原有走向。
 * 2. 手势成立后吞掉紧随其后的 `click`，否则松手会触发播放 / 暂停。
 * 3. `contextmenu` preventDefault：iOS 长按会弹系统菜单。
 */
export default function usePlayerGesture({
  boostEnabled = true,
  speed = DEFAULT_BOOST_SPEED,
  getSeekContext,
  onBoostStart,
  onBoostSpeed,
  onBoostEnd,
  onSeekCommit,
} = {}) {
  const [boost, setBoost] = useState(null)
  const [seek, setSeek] = useState(null)
  const [active, setActive] = useState(false)
  const stateRef = useRef(null)
  const timerRef = useRef(null)
  const suppressClickRef = useRef(false)
  const suppressTimerRef = useRef(null)
  // 已经下发给播放器的倍速。pointermove 一帧可能来好几次，用 ref 同步去重，
  // 不能依赖 state（React 还没重渲染时 boost 还是旧值）。
  const appliedRef = useRef(null)
  // 父层传进来的回调每次渲染都是新函数。存进 ref 里，手势里的回调就不必进
  // useCallback 依赖 —— 否则拖动中每帧 state 变化都会重建回调，
  // 挂在 window 上的监听会被反复摘挂。
  const latest = useRef({})
  useEffect(() => {
    latest.current = {
      getSeekContext,
      onBoostStart,
      onBoostSpeed,
      onBoostEnd,
      onSeekCommit,
    }
  })

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const clearClickSuppression = useCallback(() => {
    suppressClickRef.current = false
    if (suppressTimerRef.current !== null) {
      window.clearTimeout(suppressTimerRef.current)
      suppressTimerRef.current = null
    }
  }, [])

  useEffect(
    () => () => {
      clearTimer()
      if (suppressTimerRef.current !== null) window.clearTimeout(suppressTimerRef.current)
    },
    [clearTimer]
  )

  const armClickSuppression = useCallback(() => {
    suppressClickRef.current = true
    if (suppressTimerRef.current !== null) window.clearTimeout(suppressTimerRef.current)
    suppressTimerRef.current = window.setTimeout(() => {
      suppressTimerRef.current = null
      suppressClickRef.current = false
    }, CLICK_SUPPRESS_MS)
  }, [])

  /** 结束手势：倍速还原 / 进度定位，并清掉状态。 */
  const finishGesture = useCallback(
    (event, commit) => {
      const state = stateRef.current
      // 先判 id：多指时另一根手指抬起不能把这次手势的计时器 / 状态清掉。
      if (!state || state.id !== event.pointerId) return
      clearTimer()
      stateRef.current = null
      setActive(false)

      if (state.mode === GESTURE_BOOST) {
        appliedRef.current = null
        setBoost(null)
        armClickSuppression()
        latest.current.onBoostEnd?.()
        return
      }
      if (state.mode === GESTURE_SEEK) {
        setSeek(null)
        // 拖动（>14px）通常不会生成 click，但真机上有例外；定位完再被当成
        // 「点了一下」而暂停播放，体验会很差，所以一并拦掉。
        armClickSuppression()
        if (commit && Number.isFinite(state.target)) latest.current.onSeekCommit?.(state.target)
      }
    },
    [armClickSuppression, clearTimer]
  )

  /**
   * 把位移换算成目标时间并刷新 HUD。
   *
   * 刻意**不做实时 seek**：边拖边定位会让浏览器 / 转码流反复重新加载
   *（真机上出现多个 loading 叠加，而且没松手视频就不正常播放了）。
   * 拖动期间视频照常播放，松手时才 onSeekCommit 定位一次。
   */
  const applySeekMove = useCallback((state, dx) => {
    const context = state.seek
    if (!context) return
    const target = seekTimeForDrag(context.anchorTime, dx, context.duration)
    state.target = target
    setSeek({ time: target, delta: target - context.anchorTime })
  }, [])

  const onPointerDown = useCallback(
    (event) => {
      // 任何一次新的按下都让上一次的抑制标记失效，并清掉可能残留的进度提示
      //（多指等边界情况下漏掉 pointerup 时，提示不会一直挂在画面上）。
      clearClickSuppression()
      setSeek(null)
      if (event.pointerType === 'mouse' && event.button !== 0) return
      if (event.target?.closest?.(SKIP_SELECTOR)) return
      if (stateRef.current) return

      stateRef.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        // 长按成立那一刻的纵坐标，作为换档的原点（避免把长按期间的晃动算进去）
        boostOriginY: event.clientY,
        mode: GESTURE_PENDING,
        seek: null,
        target: null,
      }

      // 长按倍速被关掉时不开计时器：这时任何横向滑动都直接调进度。
      if (!boostEnabled) return
      clearTimer()
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        const state = stateRef.current
        if (!state || state.mode !== GESTURE_PENDING) return
        state.mode = GESTURE_BOOST
        // 以「长按成立这一刻」的手指位置为换档原点：长按那 1 秒里的自然晃动
        // 不应该被算成滑动。
        state.boostOriginY = state.lastY
        setActive(true)
        // 倍速提示优先：清掉可能残留的进度提示，画面上一次只出现一种提示。
        setSeek(null)
        appliedRef.current = speed
        setBoost(speed)
        latest.current.onBoostStart?.(speed)
        latest.current.onBoostSpeed?.(speed)
      }, BOOST_HOLD_MS)
    },
    [boostEnabled, clearClickSuppression, clearTimer, speed]
  )

  const handlePointerMove = useCallback(
    (event) => {
      const state = stateRef.current
      if (!state || state.id !== event.pointerId) return
      // 记下最近一次位置：长按成立那一刻用它当换档的纵坐标原点，
      // 这样长按期间的自然晃动不会被算进「滑了多少」。
      state.lastX = event.clientX
      state.lastY = event.clientY
      const dx = event.clientX - state.x
      const dy = event.clientY - state.y

      if (state.mode === GESTURE_PENDING) {
        const decision = resolvePendingGesture(dx, dy)
        if (decision === 'pending') return
        clearTimer()
        if (decision === 'cancel') {
          // 竖向大幅度滑动：这次触摸彻底作废，把画面让给系统 / 浏览器手势。
          stateRef.current = null
          return
        }
        // 横向先动 → 整个手势改为调进度，不再可能变成倍速。
        const context = latest.current.getSeekContext?.()
        if (!context) {
          stateRef.current = null
          return
        }
        state.mode = GESTURE_SEEK
        state.seek = {
          duration: context.duration,
          anchorTime: context.currentTime,
        }
        setActive(true)
        applySeekMove(state, dx)
        return
      }

      if (state.mode === GESTURE_SEEK) {
        applySeekMove(state, dx)
        return
      }

      if (state.mode === GESTURE_BOOST) {
        // 加速期间只认竖向位移：横向滑动什么都不做 —— 这样「滑动换档」和
        // 「拖动调进度」用的是两个轴，不可能再互相干扰。
        const next = boostSpeedForVerticalDrag(event.clientY - state.boostOriginY, { speed })
        if (next === appliedRef.current) return
        appliedRef.current = next
        setBoost(next)
        latest.current.onBoostSpeed?.(next)
      }
    },
    [applySeekMove, clearTimer, speed]
  )

  /**
   * 移动 / 抬起统一挂在 window 的捕获阶段：
   *
   * - pointermove 不依赖 setPointerCapture。全屏时全屏元素是 .video-js，
   *   舞台在它后面，捕获目标不在渲染树里，真机上会失效 —— 那正是
   *   「全屏下长按加速滑动时进度条也跟着动」的成因：事件漏给了 video.js。
   *   挂 window 后无论手指在哪、窄屏还是全屏都收得到。
   * - 「手指快速甩出画面后在画面外抬起」也能收到，手势状态不会卡死。
   */
  useEffect(() => {
    const handler = (event) => finishGesture(event, event.type === 'pointerup')
    window.addEventListener('pointermove', handlePointerMove, true)
    window.addEventListener('pointerup', handler, true)
    window.addEventListener('pointercancel', handler, true)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove, true)
      window.removeEventListener('pointerup', handler, true)
      window.removeEventListener('pointercancel', handler, true)
    }
  }, [finishGesture, handlePointerMove])

  const onClickCapture = useCallback(
    (event) => {
      if (!suppressClickRef.current) return
      clearClickSuppression()
      // 控制条上的按钮是真按钮，永远不能被吞。
      if (event.target?.closest?.(CLICK_PASS_SELECTOR)) return
      event.stopPropagation()
      event.preventDefault()
    },
    [clearClickSuppression]
  )

  const onContextMenu = useCallback((event) => {
    // 移动端长按会弹出系统菜单（复制 / 分享），屏蔽掉。
    event.preventDefault()
  }, [])

  return {
    boost,
    seek,
    active,
    handlers: { onPointerDown, onClickCapture, onContextMenu },
  }
}
