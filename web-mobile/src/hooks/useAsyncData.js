import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 设置页统一的「加载 + 重试 + 卸载取消」封装。
 *
 * 把 deps 序列化成 key 而不是直接展开进依赖数组：展开会让
 * react-hooks/exhaustive-deps 无法静态校验（本仓库 lint 是
 * --max-warnings=0，任何警告都会让构建失败）。
 */
export default function useAsyncData(loader, deps = []) {
  const loaderRef = useRef(loader)
  loaderRef.current = loader

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [token, setToken] = useState(0)

  const depsKey = JSON.stringify(deps)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    Promise.resolve(loaderRef.current(controller.signal))
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((err) => {
        if (!cancelled && err?.name !== 'AbortError') setError(err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [depsKey, token])

  const reload = useCallback(() => setToken((value) => value + 1), [])

  return { data, loading, error, reload, setData }
}
