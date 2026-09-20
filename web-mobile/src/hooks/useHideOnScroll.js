import { useEffect, useRef, useState } from 'react'

const TOP_SAFE_ZONE = 48

/**
 * 滚动方向检测：下滑时隐藏、上滑时显示。
 * 用于「列表分类行」这类需要吸顶但不必常显的次级导航。
 *
 * @param {object} options
 * @param {boolean} options.enabled 关闭时永远返回 false
 * @param {number}  options.threshold 触发切换的最小位移，避免抖动
 */
export default function useHideOnScroll({ enabled = true, threshold = 12 } = {}) {
  const [hidden, setHidden] = useState(false)
  const lastYRef = useRef(0)
  const tickingRef = useRef(false)

  useEffect(() => {
    if (!enabled) {
      setHidden(false)
      return undefined
    }

    lastYRef.current = window.scrollY || 0

    const handleScroll = () => {
      if (tickingRef.current) return
      tickingRef.current = true
      window.requestAnimationFrame(() => {
        tickingRef.current = false
        const y = window.scrollY || document.documentElement.scrollTop || 0
        const delta = y - lastYRef.current

        // 接近顶部时永远显示，避免刚进页面就藏起来。
        if (y <= TOP_SAFE_ZONE) {
          setHidden(false)
        } else if (delta > threshold) {
          setHidden(true)
        } else if (delta < -threshold) {
          setHidden(false)
        }

        lastYRef.current = y
      })
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [enabled, threshold])

  return hidden
}
