import { useEffect } from 'react'

import { useStore } from '@/store'
import { buildUrlFromState } from '@/utils/urlState'

/**
 * 把筛选状态写回地址栏（点 5）。
 *
 * 用 `replaceState` 而不是 `pushState`：浏览器的前进 / 后退在移动端属于页面栈
 * （见 `useStackBack`），每改一次筛选就压一条历史记录会让「返回」变成连续撤销筛选，
 * 而「返回上一页」再也回不去。写进当前这一条记录，刷新后才能复原，且不干扰返回键。
 *
 * 同理也不监听 popstate：返回时 URL 会回到上一条记录的旧值，但页面栈正在处理这次
 * 返回，此时再拿旧 URL 去覆盖当前筛选条件只会打架 —— 地址栏是「分享 / 刷新」用的，
 * 不当作导航来源。
 */
export default function useUrlStateSync(enabled = true) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return undefined

    const sync = () => {
      const { pathname, search, hash } = window.location
      const next = `${buildUrlFromState(useStore.getState(), pathname)}${hash}`
      if (`${pathname}${search}${hash}` === next) return
      // 必须原样带回 history.state：页面栈的标记就在里面，丢掉它返回键会失灵。
      window.history.replaceState(window.history.state, '', next)
    }

    sync()
    return useStore.subscribe(sync)
  }, [enabled])
}
