import { useEffect, useRef } from 'react'

/**
 * 把浮层接到浏览器/Android 物理返回键上。
 * 打开时压入一条历史记录，返回键触发 popstate → 关闭浮层；
 * 用户点 UI 关闭时把压入的记录弹掉，避免污染历史。
 */
export default function useOverlayBack(open, onClose) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return undefined
    let popped = false
    window.history.pushState({ javbossOverlay: true }, '')

    const handlePop = () => {
      popped = true
      closeRef.current?.()
    }
    window.addEventListener('popstate', handlePop)

    return () => {
      window.removeEventListener('popstate', handlePop)
      if (!popped && window.history.state?.javbossOverlay) {
        window.history.back()
      }
    }
  }, [open])
}
