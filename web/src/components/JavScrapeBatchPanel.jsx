import { useCallback, useEffect, useRef, useState } from 'react'
import AutoFixHighRoundedIcon from '@mui/icons-material/AutoFixHighRounded'

import { cancelJavScrapeBatch, fetchJavScrapeBatchStatus, startJavScrapeBatch } from '@/api'
import { getErrorMessage } from '@/utils/errors'
import { zh } from '@/utils/i18n'

const STATUS_POLL_MS = 1500

function ProgressBar({ value, total }) {
  const percent = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100">
      <div
        className="h-full rounded-full bg-blue-600 transition-all"
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}

/**
 * 设置里的「一键刮削」面板：对媒体库里尚未关联番号的视频手动批量重试刮削。
 *
 * 任务跑在服务端后台，这里只轮询状态；关闭弹窗不会中断任务。
 */
export default function JavScrapeBatchPanel({ onToast }) {
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState(null)
  const pollRef = useRef(null)

  const refreshStatus = useCallback(async () => {
    try {
      const next = await fetchJavScrapeBatchStatus()
      setStatus(next)
      return next
    } catch (err) {
      setError(getErrorMessage(err))
      return null
    }
  }, [])

  useEffect(() => {
    refreshStatus()
  }, [refreshStatus])

  const running = Boolean(status?.running)

  useEffect(() => {
    if (!running) {
      if (pollRef.current) {
        window.clearInterval(pollRef.current)
        pollRef.current = null
      }
      return undefined
    }
    if (pollRef.current) return undefined
    pollRef.current = window.setInterval(() => {
      refreshStatus()
    }, STATUS_POLL_MS)
    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [refreshStatus, running])

  const handleStart = useCallback(async () => {
    setStarting(true)
    setError('')
    try {
      const next = await startJavScrapeBatch()
      setStatus(next)
      onToast?.(zh('已开始一键刮削', 'Batch scrape started'))
    } catch (err) {
      setError(getErrorMessage(err))
      refreshStatus()
    } finally {
      setStarting(false)
    }
  }, [onToast, refreshStatus])

  const handleCancel = useCallback(async () => {
    setError('')
    try {
      const next = await cancelJavScrapeBatch()
      setStatus(next)
      onToast?.(zh('已请求停止', 'Stop requested'))
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }, [onToast])

  const target = [status?.current_code, status?.current_file].filter(Boolean).join(' · ')

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="mb-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
          <AutoFixHighRoundedIcon sx={{ fontSize: 18 }} className="text-zinc-400" />
          {zh('一键刮削未刮削视频', 'Scrape all unscraped videos')}
        </h3>
        <p className="mt-1 text-xs leading-5 text-zinc-500">
          {zh(
            '对媒体库里尚未关联番号的视频，按文件名或番号重新匹配一次元数据。任务在后台逐个执行，关闭弹窗不会中断；已标记「跳过刮削」的视频不会被处理。',
            'Re-matches metadata for every video in the library that is not linked to a JAV code yet. The job runs in the background one by one and keeps going after this dialog closes. Videos marked "skip scraping" are left untouched.'
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleStart}
          disabled={running || starting}
          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700 disabled:opacity-60"
        >
          {running
            ? zh('刮削中…', 'Running…')
            : starting
              ? zh('启动中…', 'Starting…')
              : zh('一键刮削', 'Scrape now')}
        </button>
        <button
          type="button"
          onClick={running ? handleCancel : refreshStatus}
          className="rounded border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 transition hover:bg-zinc-50"
        >
          {running ? zh('停止', 'Stop') : zh('刷新进度', 'Refresh progress')}
        </button>
      </div>
      {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}

      {status ? (
        <div className="mt-4 space-y-2">
          <ProgressBar value={status.processed} total={status.total} />
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600">
            <span>
              {zh('进度', 'Progress')}: {status.processed}/{status.total}
            </span>
            <span className="text-emerald-600">
              {zh('已刮削', 'Scraped')} {status.linked}
            </span>
            <span className={status.failed > 0 ? 'text-amber-600' : ''}>
              {zh('未匹配', 'Unmatched')} {status.failed}
            </span>
            <span className="text-zinc-400">
              {running
                ? zh('进行中', 'Running')
                : status.message === 'canceled'
                  ? zh('已停止', 'Stopped')
                  : status.total > 0
                    ? zh('已完成', 'Finished')
                    : zh('空闲', 'Idle')}
            </span>
          </div>
          {target ? <p className="truncate text-[11px] text-zinc-500">{target}</p> : null}
          {status.errors?.length ? (
            <details className="text-[11px] text-zinc-500">
              <summary className="cursor-pointer">
                {zh(`失败详情（${status.errors.length}）`, `Failures (${status.errors.length})`)}
              </summary>
              <ul className="mt-1 space-y-1">
                {status.errors.map((item, index) => (
                  <li key={`${index}-${item}`} className="truncate" title={item}>
                    {item}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
