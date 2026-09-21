import { useEffect, useRef, useState } from 'react'

import Icon from '@/components/Icons'

/**
 * 数值步进器：− [值] ＋。
 *
 * 长按「＋ / −」会连续步进（400ms 后开始，每 90ms 一步）——分页大小、扫描间隔
 * 这类字段跨度到几百，只靠点击会让用户点到手酸。
 *
 * 直接用数字键盘输入会触发移动端键盘弹出、挤掉半个屏幕，所以这里不提供输入框；
 * 需要精确大跨度时用长按。
 */
export default function Stepper({
  value,
  onChange,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  step = 1,
  disabled = false,
  suffix = '',
  label,
}) {
  const current = Number.isFinite(Number(value)) ? Number(value) : min
  const [local, setLocal] = useState(current)
  const holdRef = useRef(null)
  const localRef = useRef(current)

  // 外部（例如「恢复默认」）改了值要同步回来，但不要覆盖用户正在长按的值。
  useEffect(() => {
    if (!holdRef.current) {
      localRef.current = current
      setLocal(current)
    }
  }, [current])

  useEffect(() => () => window.clearInterval(holdRef.current), [])

  const clamp = (next) => Math.min(max, Math.max(min, next))

  const commit = (next) => {
    const clamped = clamp(next)
    localRef.current = clamped
    setLocal(clamped)
    onChange?.(clamped)
  }

  const stopHold = () => {
    window.clearInterval(holdRef.current)
    holdRef.current = null
  }

  const startHold = (delta) => {
    if (disabled) return
    stopHold()
    holdRef.current = window.setInterval(() => {
      const next = clamp(localRef.current + delta)
      if (next === localRef.current) {
        stopHold()
        return
      }
      commit(next)
    }, 90)
  }

  const button = (delta, icon, ariaLabel) => {
    const next = current + delta
    const blocked = disabled || next < min || next > max
    return (
      <button
        type="button"
        aria-label={ariaLabel}
        disabled={blocked}
        onClick={() => commit(localRef.current + delta)}
        onPointerDown={() => {
          // 首次点击由 onClick 处理；长按由这里启动的定时器接管。
          const timer = window.setTimeout(() => startHold(delta), 400)
          holdRef.current = timer
          const cancel = () => {
            window.clearTimeout(timer)
            stopHold()
            window.removeEventListener('pointerup', cancel)
            window.removeEventListener('pointercancel', cancel)
          }
          window.addEventListener('pointerup', cancel)
          window.addEventListener('pointercancel', cancel)
        }}
        className={`grid h-8 w-8 flex-none place-items-center rounded-[9px] text-zinc-600 ${
          blocked ? 'opacity-30' : 'active:bg-zinc-200'
        }`}
      >
        <Icon name={icon} size={15} strokeWidth={2.4} />
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1.5" role="group" aria-label={label}>
      {button(-step, 'minus', '−')}
      <span className="min-w-[64px] text-center text-[14px] tabular-nums text-zinc-900">
        {local}
        {suffix ? <span className="ml-0.5 text-[11.5px] text-zinc-400">{suffix}</span> : null}
      </span>
      {button(step, 'plus', '＋')}
    </div>
  )
}
