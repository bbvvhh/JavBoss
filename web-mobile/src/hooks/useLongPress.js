import { useCallback, useEffect, useRef } from 'react'

const MOVE_TOLERANCE = 10

/**
 * 长按手势。滚动或手指移动超过阈值就取消，避免误触。
 * 返回 pointer 事件处理器，直接展开到元素上即可。
 */
export default function useLongPress({ onLongPress, onTap, delay = 450, disabled = false }) {
  const timerRef = useRef(null)
  const originRef = useRef({ x: 0, y: 0 })
  const longPressFiredRef = useRef(false)

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  useEffect(() => clear, [clear])

  const onPointerDown = useCallback(
    (event) => {
      if (disabled) return
      if (event.pointerType === 'mouse' && event.button !== 0) return
      longPressFiredRef.current = false
      originRef.current = { x: event.clientX, y: event.clientY }
      clear()
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        longPressFiredRef.current = true
        onLongPress?.(event)
      }, delay)
    },
    [clear, delay, disabled, onLongPress]
  )

  const onPointerMove = useCallback(
    (event) => {
      if (timerRef.current === null) return
      const dx = Math.abs(event.clientX - originRef.current.x)
      const dy = Math.abs(event.clientY - originRef.current.y)
      if (dx > MOVE_TOLERANCE || dy > MOVE_TOLERANCE) clear()
    },
    [clear]
  )

  const onPointerUp = useCallback(
    (event) => {
      const wasPending = timerRef.current !== null
      clear()
      if (disabled) return
      // 只有短按（长按未触发）才算点击。
      if (wasPending && !longPressFiredRef.current) onTap?.(event)
      longPressFiredRef.current = false
    },
    [clear, disabled, onTap]
  )

  const onPointerCancel = useCallback(() => {
    clear()
    longPressFiredRef.current = false
  }, [clear])

  const onContextMenu = useCallback((event) => {
    // 移动端长按会弹出系统菜单，屏蔽掉。
    event.preventDefault()
  }, [])

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onContextMenu }
}
