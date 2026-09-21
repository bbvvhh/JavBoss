import { useEffect, useState } from 'react'

import { downloadFFmpeg, fetchTools } from '@/api'
import Icon from '@/components/Icons'
import SettingsPage from '@/components/settings/SettingsPage'
import { InfoRow, SectionTitle, buttonClass } from '@/components/form/Field'
import useAsyncData from '@/hooks/useAsyncData'
import { useStore } from '@/store'
import { getErrorMessage } from '@/utils/errors'
import { zh } from '@/utils/i18n'

const SOURCE_LABELS = {
  downloaded: zh('已下载（由 JavBoss 管理）', 'Downloaded (managed by JavBoss)'),
  builtin: zh('随程序内置', 'Bundled with the app'),
}

function formatBytes(value) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

/**
 * 「工具与日志」。
 *
 * 后端只有 `ffmpeg` 一项（mpv / ffprobe 没有状态接口），而且这只是**服务端**的
 * 二进制 —— 手机不能也不应该上传可执行文件。所以这一页的定位是「告诉你服务端
 * 依赖是否就绪」，而不是「安装到你手机上」。
 */
export default function ToolsPage({ onClose }) {
  const showToast = useStore((state) => state.showToast)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  const { data, loading, error, reload, setData } = useAsyncData(() => fetchTools(), [])

  const ffmpeg = data?.ffmpeg || null
  const downloading = Boolean(ffmpeg?.downloading)
  const progress = Number(ffmpeg?.progress) || 0

  // 下载中才轮询：结束后自动停，不会一直打服务端。
  useEffect(() => {
    if (!downloading) return undefined
    const timer = window.setTimeout(() => reload(), 800)
    return () => window.clearTimeout(timer)
  }, [downloading, progress, reload])

  const startDownload = async () => {
    setBusy(true)
    setActionError('')
    try {
      // 202=已开始，200=无需下载（已装好或已在下载）。两者都是成功，不能只看状态码。
      const next = await downloadFFmpeg()
      if (next?.ffmpeg) setData(next)
      else reload()
      showToast(zh('已开始下载 FFmpeg', 'FFmpeg download started'))
    } catch (err) {
      setActionError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsPage
      title={zh('工具与日志', 'Tools & logs')}
      subtitle={zh('服务端依赖状态', 'Server-side dependencies')}
      onBack={onClose}
      loading={loading}
      error={error}
      onRetry={reload}
    >
      <SectionTitle hint={zh('运行在服务端，不是你的手机', 'Runs on the server, not your phone')}>
        {zh('FFmpeg', 'FFmpeg')}
      </SectionTitle>

      <div className="mx-3 overflow-hidden rounded-card bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
        <InfoRow
          label={zh('状态', 'Status')}
          value={
            ffmpeg?.installed
              ? zh('已安装', 'Installed')
              : ffmpeg?.supported
                ? zh('未安装', 'Not installed')
                : zh('不可用', 'Unavailable')
          }
        />
        <InfoRow label={zh('版本', 'Version')} value={ffmpeg?.version || '—'} />
        <InfoRow label={zh('来源', 'Source')} value={SOURCE_LABELS[ffmpeg?.source] || '—'} />
        <InfoRow
          label={zh('本平台支持自动下载', 'Auto-download supported')}
          value={ffmpeg?.supported ? zh('是', 'Yes') : zh('否', 'No')}
        />
        {ffmpeg?.path ? <InfoRow label={zh('路径', 'Path')} value={ffmpeg.path} mono /> : null}
      </div>

      <div className="mx-3 mt-3">
        {downloading ? (
          <div className="rounded-card bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
            <div className="flex items-center gap-2 text-[13px] text-zinc-700">
              <Icon name="refresh" size={15} className="spin text-brand" />
              {zh(`正在下载… ${progress}%`, `Downloading… ${progress}%`)}
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100">
              <div
                className="h-full rounded-full bg-brand transition-all"
                style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
              />
            </div>
            {ffmpeg?.total_bytes ? (
              <p className="mt-1.5 text-[11px] tabular-nums text-zinc-400">
                {formatBytes(ffmpeg.downloaded_bytes)} / {formatBytes(ffmpeg.total_bytes)}
              </p>
            ) : null}
          </div>
        ) : (
          <button
            type="button"
            disabled={
              busy || !ffmpeg?.supported || (ffmpeg?.installed && !ffmpeg?.upgrade_available)
            }
            onClick={startDownload}
            className={buttonClass('primary', 'h-11 w-full')}
          >
            {ffmpeg?.upgrade_available
              ? zh('更新 FFmpeg', 'Update FFmpeg')
              : ffmpeg?.installed
                ? zh('已是最新版本', 'Already up to date')
                : zh('下载 FFmpeg', 'Download FFmpeg')}
          </button>
        )}
      </div>

      {ffmpeg?.error ? (
        <p className="mx-3 mt-3 flex items-start gap-2 rounded-card border border-red-200 bg-red-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-red-700">
          <Icon name="ban" size={14} className="mt-[2px] flex-none" />
          <span>{ffmpeg.error}</span>
        </p>
      ) : null}

      {actionError ? (
        <p className="mx-3 mt-3 rounded-card border border-red-200 bg-red-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-red-700">
          {actionError}
        </p>
      ) : null}

      <div className="mx-3 mt-3 rounded-card bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
        <p className="flex items-start gap-2 text-[12px] leading-relaxed text-zinc-500">
          <Icon name="info" size={14} className="mt-[2px] flex-none text-zinc-400" />
          <span>
            {ffmpeg?.supported
              ? zh(
                  'FFmpeg 由服务端下载并安装到 JavBoss 自己的 data/ 目录，用于生成缩略图与截图。手机端只负责触发和查看进度。',
                  'FFmpeg is downloaded into JavBoss’s own data/ directory on the server and is used to generate thumbnails and screenshots. Your phone only triggers it and watches progress.'
                )
              : zh(
                  '当前部署方式下 FFmpeg 不通过下载提供（容器部署需要镜像内自带，或平台不受支持），所以这一项是只读的。',
                  'In this deployment FFmpeg cannot be downloaded (containers must ship it in the image, or the platform is unsupported), so this item is read-only.'
                )}
          </span>
        </p>
      </div>

      <SectionTitle>{zh('日志', 'Logs')}</SectionTitle>
      <div className="mx-3 rounded-card bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
        <p className="text-[12px] leading-relaxed text-zinc-500">
          {zh(
            '后端没有日志接口，日志文件写在服务端的 logs/ 目录，需要在电脑上查看。',
            'There is no log API. Log files live in the server’s logs/ directory and must be read on the computer.'
          )}
        </p>
      </div>
    </SettingsPage>
  )
}
