import { useEffect, useMemo, useState } from 'react'

import { fetchDirectories, organizeJavTags, updateDirectory } from '@/api'
import ConfirmDialog from '@/components/ConfirmDialog'
import Icon from '@/components/Icons'
import SettingsPage from '@/components/settings/SettingsPage'
import Switch from '@/components/form/Switch'
import { buttonClass } from '@/components/form/Field'
import useAsyncData from '@/hooks/useAsyncData'
import { useStore } from '@/store'
import { getErrorMessage } from '@/utils/errors'
import { zh } from '@/utils/i18n'

/**
 * 刮削设置（全局视角）。
 *
 * 后端**没有**「全局刮削开关」这种配置键 —— 刮削的开关粒度是「每个目录的自动扫描」
 * 和「每个视频的覆盖设置」。所以这一页不伪造开关，而是：
 *   1. 汇总当前库里的刮削进度；
 *   2. 把各目录的自动刮削开关集中在一处（等价于 PC 端目录里的自动扫描设置）；
 *   3. 提供 JAV 标签分类整理（唯一一个真正"全局"的刮削相关动作）。
 * 单个视频的刮削模式在视频长按菜单 →「刮削设置」里。
 */
export default function ScrapeSettingsPage({ onClose }) {
  const showToast = useStore((state) => state.showToast)

  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [organizeOpen, setOrganizeOpen] = useState(false)

  const { data, loading, error, reload } = useAsyncData(() => fetchDirectories(), [])

  const directories = useMemo(
    () => (Array.isArray(data) ? data.filter((item) => !item?.is_delete) : []),
    [data]
  )

  const totals = useMemo(() => {
    let videos = 0
    let scraped = 0
    for (const directory of directories) {
      videos += Number(directory.scanned_video_count || 0)
      scraped += Number(directory.scraped_video_count || 0)
    }
    return { videos, scraped, pending: Math.max(0, videos - scraped) }
  }, [directories])

  const autoScanning = directories.some((directory) => directory.auto_scan_enabled)

  // 有目录在扫描时，刮削进度也在变，跟着刷新。
  const anyScanning = directories.some(
    (directory) =>
      (directory.work_status || (directory.is_scanning ? 'scanning' : 'idle')) === 'scanning'
  )
  useEffect(() => {
    if (!anyScanning) return undefined
    const timer = window.setInterval(() => reload(), 1500)
    return () => window.clearInterval(timer)
  }, [anyScanning, reload])

  const run = async (task, message) => {
    setBusy(true)
    setActionError('')
    try {
      await task()
      if (message) showToast(message)
      setOrganizeOpen(false)
      reload()
    } catch (err) {
      setActionError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsPage
      title={zh('刮削设置', 'Scraping')}
      subtitle={zh('进度与自动刮削', 'Progress & auto scraping')}
      onBack={onClose}
      loading={loading}
      error={error}
      onRetry={reload}
    >
      {actionError ? (
        <p className="mx-3 mt-3 rounded-card border border-red-200 bg-red-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-red-700">
          <Icon name="ban" size={13} className="mr-1 inline align-[-2px]" />
          {actionError}
        </p>
      ) : null}

      <div className="mx-3 mt-3 grid grid-cols-3 gap-2">
        {[
          { label: zh('视频', 'Videos'), value: totals.videos, tone: 'text-zinc-900' },
          { label: zh('已刮削', 'Scraped'), value: totals.scraped, tone: 'text-emerald-600' },
          { label: zh('待刮削', 'Pending'), value: totals.pending, tone: 'text-amber-600' },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-card bg-white px-3 py-3 text-center shadow-[0_1px_2px_rgba(16,24,40,0.05)]"
          >
            <b className={`block text-[19px] leading-tight tabular-nums ${item.tone}`}>
              {item.value}
            </b>
            <span className="mt-0.5 block text-[11px] text-zinc-400">{item.label}</span>
          </div>
        ))}
      </div>

      <div className="mx-3 mt-3 rounded-card bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
        <p className="text-[12.5px] leading-relaxed text-zinc-600">
          {zh(
            '刮削是「逐个视频」进行的：扫描时按文件名或番号匹配元数据，之后由后台周期任务补齐缺失的标题、演员、标签与封面。每一次只尝试一轮，网络波动导致的失败会留到下一轮。',
            'Scraping works video by video: metadata is matched by filename or code during a scan, and background jobs fill in missing titles, actors, tags and covers. Each pass tries once; failures caused by network hiccups wait for the next round.'
          )}
        </p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-zinc-600">
          {zh(
            '这里没有「一键全部刮削」—— 后端不提供这个接口。要立刻刮某个视频，请回到列表长按它 →「刮削设置」。',
            'There is no “scrape everything” button because the backend offers no such endpoint. To scrape one video right now, long-press it in the list → “Scrape settings”.'
          )}
        </p>
      </div>

      <h3 className="flex items-center gap-2 px-4 pb-1.5 pt-4 text-[12px] font-semibold text-zinc-500">
        {zh('自动刮削', 'Auto scraping')}
        <span className="font-normal text-zinc-400">
          {autoScanning ? zh('已开启', 'On') : zh('全部关闭', 'All off')}
        </span>
      </h3>

      <div className="mx-3 overflow-hidden rounded-card bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
        {directories.length === 0 ? (
          <p className="px-4 py-5 text-center text-[12.5px] text-zinc-400">
            {zh('还没有媒体目录', 'No media directories yet')}
          </p>
        ) : (
          directories.map((directory) => (
            <div
              key={directory.id}
              className="flex items-center gap-3 border-t border-[#f1f2f5] px-4 py-3 first:border-t-0"
            >
              <div className="min-w-0 flex-1">
                <span className="block break-all text-[12.5px] leading-snug text-zinc-800">
                  {directory.kind === 'webdav'
                    ? `${zh('远程', 'Remote')} · ${directory.remote_path || '/'}`
                    : String(directory.path || '')}
                </span>
                <span className="mt-0.5 block text-[11px] text-zinc-400">
                  {zh(
                    `间隔 ${directory.auto_scan_interval_minutes || 1} 分钟 · 已刮削 ${
                      directory.scraped_video_count || 0
                    }`,
                    `Every ${directory.auto_scan_interval_minutes || 1} min · ${
                      directory.scraped_video_count || 0
                    } scraped`
                  )}
                </span>
              </div>
              <Switch
                checked={Boolean(directory.auto_scan_enabled)}
                disabled={busy}
                label={zh('自动扫描', 'Auto scan')}
                onChange={(value) =>
                  run(
                    () => updateDirectory(directory.id, { auto_scan_enabled: value }),
                    value
                      ? zh('已开启自动扫描', 'Auto scan on')
                      : zh('已关闭自动扫描', 'Auto scan off')
                  )
                }
              />
            </div>
          ))
        )}
      </div>
      <p className="px-5 pt-2 text-[11px] leading-relaxed text-zinc-400">
        {zh(
          '关闭自动扫描不会清除已经刮削到的数据。间隔请在「目录管理」里逐个调整。',
          'Turning auto scan off keeps everything already scraped. Adjust intervals per directory under Directories.'
        )}
      </p>

      <h3 className="px-4 pb-1.5 pt-4 text-[12px] font-semibold text-zinc-500">
        {zh('标签整理', 'Tag housekeeping')}
      </h3>
      <div className="mx-3 rounded-card bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
        <p className="text-[12px] leading-relaxed text-zinc-500">
          {zh(
            '从 JavBus 读取官方标签分类，把能匹配上的 JAV 标签归入对应分类。需要联网，最长可能等待 45 秒，没有匹配到的标签保持原样。',
            'Reads official tag categories from JavBus and files matching JAV tags into them. Needs internet access, can take up to 45 seconds, and leaves unmatched tags untouched.'
          )}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => setOrganizeOpen(true)}
          className={buttonClass('secondary', 'mt-3 h-10 w-full')}
        >
          {zh('整理 JAV 标签分类', 'Organize JAV tag categories')}
        </button>
      </div>

      <p className="px-5 pt-5 text-center text-[11px] leading-relaxed text-zinc-400">
        {zh(
          '刮削只写入 JavBoss 自己的数据库与 data/ 目录（封面、缩略图），不会改动视频文件。',
          'Scraping only writes to JavBoss’s own database and data/ directory (covers, thumbnails). Video files are never modified.'
        )}
      </p>

      <ConfirmDialog
        open={organizeOpen}
        title={zh('自动整理 JAV 标签分类？', 'Auto-organize JAV tag categories?')}
        description={zh(
          '会从 JavBus 读取标签分类并套用到能匹配上的标签。这是一个只改数据库的操作。',
          'This reads tag categories from JavBus and applies them to matching tags. It only changes the database.'
        )}
        confirmText={zh('开始整理', 'Organize')}
        busy={busy}
        onClose={() => setOrganizeOpen(false)}
        onConfirm={() =>
          run(async () => {
            const result = await organizeJavTags()
            showToast(
              zh(
                `匹配 ${result?.matched_tag_count ?? 0} / ${result?.remote_tag_count ?? 0}，更新 ${result?.updated_tag_count ?? 0} 个`,
                `Matched ${result?.matched_tag_count ?? 0} of ${result?.remote_tag_count ?? 0}, updated ${result?.updated_tag_count ?? 0}`
              )
            )
          })
        }
      />
    </SettingsPage>
  )
}
