import { useEffect, useRef } from 'react'

/**
 * 滚动到底部前 rootMargin 像素时触发 onLoadMore。
 */
export default function useInfiniteScroll({ onLoadMore, enabled = true, rootMargin = '400px' }) {
  const sentinelRef = useRef(null)
  const callbackRef = useRef(onLoadMore)
  callbackRef.current = onLoadMore

  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !enabled) return undefined
    if (typeof IntersectionObserver !== 'function') return undefined

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) callbackRef.current?.()
      },
      { rootMargin }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [enabled, rootMargin])

  return sentinelRef
}
