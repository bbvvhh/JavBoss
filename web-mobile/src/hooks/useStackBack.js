import { useEffect, useRef } from 'react'

/**
 * 页面栈的浏览器/Android 返回键支持。
 *
 * 为什么不能直接用 `useOverlayBack`：
 *   `useOverlayBack` 只处理「开 / 关」两态，而页面栈是 0→1→2→3 的深度。
 *   如果在深度变化时复用它的清理逻辑，`history.back()` 会在**新**监听器挂上之后
 *   才派发 popstate，于是刚压入的页面立刻被弹掉 —— 表现就是「点子页面的入口没反应」。
 *
 * 这里的做法是自己在 ref 里记「我为这个栈压了几条历史记录」：
 *   - 深度增加 → 补齐 pushState；
 *   - 深度减少 → 用 `ignoreRef` 标记接下来几次 popstate 是自己触发的，直接吞掉；
 *   - 用户按返回 → 消费一条记录并回调一次 onPop（只弹一层）。
 */
export default function useStackBack(depth, onPop) {
  const onPopRef = useRef(onPop)
  onPopRef.current = onPop

  const pushedRef = useRef(0)
  const ignoreRef = useRef(0)

  useEffect(() => {
    const handlePop = () => {
      if (ignoreRef.current > 0) {
        // 这是我们为了收缩历史而主动触发的返回，不算用户操作。
        // pushedRef 已经在收缩循环里减过了，这里只清标记。
        ignoreRef.current -= 1
        return
      }
      pushedRef.current = Math.max(0, pushedRef.current - 1)
      onPopRef.current?.()
    }

    window.addEventListener('popstate', handlePop)

    while (pushedRef.current < depth) {
      window.history.pushState({ javbossOverlay: true }, '')
      pushedRef.current += 1
    }
    while (pushedRef.current > depth) {
      ignoreRef.current += 1
      pushedRef.current -= 1
      window.history.back()
    }

    return () => window.removeEventListener('popstate', handlePop)
  }, [depth])
}
