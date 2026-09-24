import { useEffect, useRef } from 'react'

import {
  clampScrollTarget,
  readScrollPosition,
  safeSessionStorage,
  shouldWaitForMore,
  writeScrollPosition,
} from '@/utils/scrollRestore'

/**
 * 记住并恢复列表的滚动位置。
 *
 * 移动端的列表滚的是 window（见 `useHideOnScroll`），而列表数据往往是组件自己的
 * 本地状态：切到另一个模式再切回来、或者刷新页面，列表会重新从第一页开始，滚动
 * 位置就丢了 —— 之前只能从头再翻一次。
 *
 * `key` 用调用方给的名字区分列表（如 `video`、`jav:works`），每个 key 各存一份位置：
 *   - 挂载 / key 变化时：取回该 key 的位置滚过去；没有记录就滚到顶部
 *   - 目标位置比当前内容还靠下时：一边等一边请调用方再拉一页（`requestMore`）
 *   - 滚动时（rAF 节流）、离开页面时、卸载时：把当前位置写回去
 *
 * sessionStorage 让位置能扛住刷新，又不会跨标签页串味。
 */
export default function useScrollRestoration(key, { enabled = true, requestMore } = {}) {
  // 用 ref 拿最新回调：调用方每次渲染都会造新函数，放进依赖会变成死循环。
  const requestMoreRef = useRef(requestMore)
  requestMoreRef.current = requestMore

  useEffect(() => {
    if (!enabled || !key || typeof window === 'undefined') return undefined

    const storage = safeSessionStorage()
    const saved = readScrollPosition(storage, key)
    const startedAt = Date.now()
    let rafId = 0
    let cancelled = false

    const maxScrollY = () =>
      Math.max(
        0,
        Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) -
          window.innerHeight
      )

    /**
     * 恢复分两跳：先看看能不能直接滚过去，不够高就边等边拉下一页。
     * 每帧重算高度 —— 列表是流式渲染的，只在 effect 里量一次会量到半成品。
     */
    const step = () => {
      if (cancelled) return
      const maxY = maxScrollY()
      if (
        shouldWaitForMore({
          saved,
          maxY,
          elapsedMs: Date.now() - startedAt,
        })
      ) {
        // 重复调用是安全的：两边的 loadMore 自己就带「正在加载 / 没有下一页」的守卫。
        requestMoreRef.current?.()
        rafId = window.requestAnimationFrame(step)
        return
      }
      window.scrollTo({ top: clampScrollTarget(saved, maxY), behavior: 'auto' })
    }
    step()

    let ticking = false
    const save = () => writeScrollPosition(storage, key, window.scrollY || 0)
    const handleScroll = () => {
      if (ticking) return
      ticking = true
      window.requestAnimationFrame(() => {
        ticking = false
        save()
      })
    }
    const handlePageHide = () => save()

    window.addEventListener('scroll', handleScroll, { passive: true })
    // 刷新 / 切后台前再存一次：光靠 scroll 事件，浏览器恢复出来的位置可能一次都没报过。
    window.addEventListener('pagehide', handlePageHide)
    return () => {
      cancelled = true
      if (rafId) window.cancelAnimationFrame(rafId)
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('pagehide', handlePageHide)
      save()
    }
  }, [key, enabled])
}
