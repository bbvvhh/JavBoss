import { useEffect, useMemo, useState } from 'react'

import { fetchDirectories, scanDirectory } from '@/api'
import Icon from '@/components/Icons'
import SettingsPage from '@/components/settings/SettingsPage'
import { buttonClass } from '@/components/form/Field'
import useAsyncData from '@/hooks/useAsyncData'
import { useStore } from '@/store'
import { getErrorMessage } from '@/utils/errors'
import { zh } from '@/utils/i18n'

function workStatusOf(directory) {
  if (directory?.work_status) return String(directory.work_status)
  return directory?.is_scanning ? 'scanning' : 'idle'
}

function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(Number(ms) / 1000))
  const h = String(Math.floor(total / 3600)).padStart(2, '0')
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const s = String(total % 60).padStart(2, '0')
  return `${h}:${m}:${s}`
}

function formatFinishedAt(unixMs) {
  const value = Number(unixMs)
  if (!Number.isFinite(value) || value <= 0) return zh('从未扫描', 'Never scanned')
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return zh('从未扫描', 'Never scanned')
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`
}

/**
 * 扫描任务。
 *
 * 进度没有推送通道，只能轮询 `GET /directories`（PC 端 1000ms，这里保持一致）。
 * 扫描全部结束时**立刻停掉定时器** —— 常驻轮询会让服务端一直有请求。
 */
export default function ScanTaskPage({ onClose }) {
  const showToast = useStore((state) => state.showToast)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  const { data, loading, error, reload } = useAsyncData(() => fetchDirectories(), [])

  const directories = useMemo(
    () => (Array.isArray(data) ? data.filter((item) => !item?.is_delete) : []),
    [data]
  )
  const scanning = directories.some((item) => workStatusOf(item) === 'scanning')

  useEffect(() => {
    if (!scanning) return undefined
    const timer = window.setInterval(() => reload(), 1000)
    return () => window.clearInterval(timer)
  }, [scanning, reload])

  const run = async (task, message) => {
    setBusy(true)
    setActionError('')
    try {
      await task()
      if (message) showToast(message)
      reload()
    } catch (err) {
      setActionError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const scanAll = () =>
    run(
      async () => {
        // 顺序触发，避免同时开一堆扫描会话把磁盘打满。
        for (const directory of directories) {
          if (workStatusOf(directory) !== 'idle') continue
          await scanDirectory(directory.id)
        }
      },
      zh('已开始扫描', 'Scan started')
    )

  const scannable = directories.filter(
    (directory) => workStatusOf(directory) === 'idle' && !directory.missing
  )

  return (
    <SettingsPage
      title={zh('扫描任务', 'Scan tasks')}
      subtitle={
        scanning
          ? zh('正在扫描…', 'Scanning…')
          : directories.length
            ? zh(`${directories.length} 个目录`, `${directories.length} directories`)
            : undefined
      }
      onBack={onClose}
      loading={loading}
      error={error}
      onRetry={reload}
      footer={
        <button
          type="button"
          disabled={busy || scannable.length === 0}
          onClick={scanAll}
          className={buttonClass('primary', 'h-11 w-full')}
        >
          {busy
            ? zh('处理中…', 'Working…')
            : zh(`扫描全部（${scannable.length}）`, `Scan all (${scannable.length})`)}
        </button>
      }
    >
      {actionError ? (
        <p className="mx-3 mt-3 rounded-card border border-red-200 bg-red-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-red-700">
          {actionError}
        </p>
      ) : null}

      {directories.length === 0 ? (
        <p className="py-14 text-center text-[13px] text-zinc-400">
          {zh('还没有媒体目录', 'No media directories yet')}
        </p>
      ) : (
        <div className="mx-3 mt-3 space-y-2.5">
          {directories.map((directory) => {
            const status = workStatusOf(directory)
            const active = status === 'scanning'
            const summary = directory.last_scan_summary || {}
            return (
              <div
                key={directory.id}
                className="rounded-card bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.05)]"
              >
                <div className="flex items-start gap-2">
                  <Icon
                    name={directory.kind === 'webdav' ? 'layers' : 'folder'}
                    size={16}
                    className="mt-[2px] flex-none text-amber-500"
                  />
                  <span className="min-w-0 flex-1 break-all text-[12.5px] leading-snug text-zinc-700">
                    {directory.kind === 'webdav'
                      ? `${zh('远程', 'Remote')} · ${directory.remote_path || '/'}`
                      : String(directory.path || '')}
                  </span>
                </div>

                {active ? (
                  <div className="mt-2 flex items-center gap-2 text-[12px] font-semibold text-brand">
                    <Icon name="refresh" size={13} className="spin" />
                    {zh('扫描中', 'Scanning')} · {formatElapsed(directory.scan_elapsed_ms)}
                    {directory.scanned_file_count
                      ? zh(
                          ` · 已发现 ${directory.scanned_file_count} 个文件`,
                          ` · ${directory.scanned_file_count} files seen`
                        )
                      : ''}
                  </div>
                ) : (
                  <p className="mt-1.5 text-[11.5px] text-zinc-400">
                    {directory.missing
                      ? zh('路径不存在，无法扫描', 'Path missing')
                      : formatFinishedAt(summary.finished_at_unix_ms)}
                  </p>
                )}

                <div className="mt-2 flex items-center gap-3 text-[11.5px] text-zinc-400">
                  <span className="tabular-nums">
                    {zh(
                      `${directory.scanned_video_count || 0} 部 · 已刮削 ${
                        directory.scraped_video_count || 0
                      }`,
                      `${directory.scanned_video_count || 0} · ${
                        directory.scraped_video_count || 0
                      } scraped`
                    )}
                  </span>
                  <button
                    type="button"
                    disabled={busy || active || directory.missing}
                    onClick={() =>
                      run(() => scanDirectory(directory.id), zh('已开始扫描', 'Scan started'))
                    }
                    className="ml-auto flex-none rounded-full bg-brand-soft px-3 py-1 text-[12px] font-medium text-brand-ink active:opacity-80 disabled:opacity-40"
                  >
                    {active ? zh('扫描中', 'Scanning') : zh('扫描', 'Scan')}
                  </button>
                </div>

                {!active && summary.files_seen ? (
                  <p className="mt-2 rounded-[8px] bg-[#f7f8fa] px-2.5 py-2 text-[11px] leading-relaxed text-zinc-500">
                    {zh(
                      `发现 ${summary.files_seen} · 新增 ${summary.inserted || 0} · 更新 ${
                        summary.updated || 0
                      } · 移除 ${summary.removed || 0} · ${Math.round(
                        (summary.duration_ms || 0) / 1000
                      )} 秒`,
                      `${summary.files_seen} seen · ${summary.inserted || 0} added · ${
                        summary.updated || 0
                      } updated · ${summary.removed || 0} removed · ${Math.round(
                        (summary.duration_ms || 0) / 1000
                      )}s`
                    )}
                  </p>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      <div className="mx-3 mt-4 rounded-card bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
        <p className="flex items-start gap-2 text-[12px] leading-relaxed text-zinc-500">
          <Icon name="info" size={14} className="mt-[2px] flex-none text-zinc-400" />
          <span>
            {zh(
              '扫描只读取文件并写入 JavBoss 自己的数据库，不会改动你的视频文件。同一目录同时只能有一个扫描会话。',
              'Scanning only reads files and writes JavBoss’s own database. It never modifies your video files. One directory can only run one scan at a time.'
            )}
          </span>
        </p>
      </div>
    </SettingsPage>
  )
}
