import { useEffect, useMemo, useState } from 'react'

import {
  createDirectory,
  fetchDirectories,
  fetchStorageConnections,
  scanDirectory,
  updateDirectory,
} from '@/api'
import BottomSheet from '@/components/BottomSheet'
import ConfirmDialog from '@/components/ConfirmDialog'
import Icon from '@/components/Icons'
import SettingsPage from '@/components/settings/SettingsPage'
import DirectoryPicker from '@/components/settings/DirectoryPicker'
import PickerField from '@/components/form/PickerField'
import Switch from '@/components/form/Switch'
import { buttonClass } from '@/components/form/Field'
import useAsyncData from '@/hooks/useAsyncData'
import { useStore } from '@/store'
import { getErrorMessage } from '@/utils/errors'
import { zh } from '@/utils/i18n'

/** 扫描间隔预设（分钟）。后端允许 1-525600，但手机上没人会去逐格调。 */
const INTERVAL_CHOICES = [1, 5, 15, 30, 60, 120, 360, 720, 1440].map((value) => ({
  value,
  label:
    value < 60 ? zh(`${value} 分钟`, `${value} min`) : zh(`${value / 60} 小时`, `${value / 60} h`),
}))

const WORK_STATUS_LABELS = {
  idle: zh('空闲', 'Idle'),
  scanning: zh('扫描中', 'Scanning'),
  organizing: zh('整理中', 'Organizing'),
  generating_sidecar: zh('生成附属文件', 'Writing sidecars'),
  organizing_with_sidecar: zh('整理并生成附属文件', 'Organizing + sidecars'),
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
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

function workStatusOf(directory) {
  if (directory?.work_status) return String(directory.work_status)
  return directory?.is_scanning ? 'scanning' : 'idle'
}

function isScanning(directory) {
  return workStatusOf(directory) === 'scanning'
}

/**
 * 目录管理。
 *
 * ⚠️ 这里**没有**「目录整理」，也不会有。`POST /directories/:id/process` 会
 * `os.Rename` 用户的视频文件、`os.Remove` 清空后的源目录，并在用户目录里写
 * .nfo / poster / 整理报告 —— 这是移动端唯一真正危险的能力，永久不提供入口。
 *
 * 「删除目录」是安全的：后端根本没有 DELETE 路由，它等价于
 * `PATCH {is_delete:true}`，handler 里只有一次 `tx.Save`，不碰文件系统。
 * 目录下的视频文件与 Video 记录都会保留，重新添加同一路径即可恢复。
 */
export default function DirectoryManagerPage({ onClose }) {
  const showToast = useStore((state) => state.showToast)

  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [target, setTarget] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addKind, setAddKind] = useState('local')
  const [addConnection, setAddConnection] = useState(null)
  const [picker, setPicker] = useState(null)
  const [removeTarget, setRemoveTarget] = useState(null)

  const { data, loading, error, reload } = useAsyncData(
    () => Promise.all([fetchDirectories(), fetchStorageConnections().catch(() => [])]),
    []
  )

  const all = useMemo(() => (Array.isArray(data?.[0]) ? data[0] : []), [data])
  const connections = useMemo(() => (Array.isArray(data?.[1]) ? data[1] : []), [data])

  const active = useMemo(() => all.filter((item) => !item?.is_delete), [all])
  const scanning = active.some(isScanning)

  /**
   * 扫描进度只能靠轮询 `GET /directories`（没有 WebSocket，也没有单独的进度接口）。
   * PC 端是 1 秒一次，这里保持一致；全部空闲时立刻停掉，不给服务端白刷请求。
   */
  useEffect(() => {
    if (!scanning) return undefined
    const timer = window.setInterval(() => reload(), 1000)
    return () => window.clearInterval(timer)
  }, [scanning, reload])

  // 抽屉里的对象要跟着轮询刷新，否则进度会停在打开抽屉那一刻。
  const current = useMemo(
    () => (target ? active.find((item) => item.id === target.id) || target : null),
    [active, target]
  )

  const connectionName = (id) =>
    connections.find((item) => Number(item.id) === Number(id))?.name ||
    zh('已删除的连接', 'Deleted connection')

  const displayPath = (directory) =>
    directory?.kind === 'webdav'
      ? `${connectionName(directory.connection_id)} · ${directory.remote_path || '/'}`
      : String(directory?.path || '')

  const run = async (task, message) => {
    setBusy(true)
    setActionError('')
    try {
      await task()
      if (message) showToast(message)
      reload()
      return true
    } catch (err) {
      setActionError(getErrorMessage(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  const patch = (directory, payload, message) =>
    run(() => updateDirectory(directory.id, payload), message)

  const startScan = (directory) =>
    run(() => scanDirectory(directory.id), zh('已开始扫描', 'Scan started'))

  const addDirectoryWithPath = async (path) => {
    const ok = await run(
      () =>
        addKind === 'webdav'
          ? createDirectory({
              kind: 'webdav',
              connectionId: Number(addConnection),
              remotePath: path,
            })
          : createDirectory({ path }),
      zh('目录已添加，正在开始首次扫描', 'Directory added; first scan starting')
    )
    if (ok) {
      setPicker(null)
      setAddOpen(false)
      setAddConnection(null)
      setAddKind('local')
    }
  }

  const changeSource = async (directory, path) => {
    const ok = await patch(
      directory,
      // 来源变更必须显式带上 kind：只发 path 会被后端理解成「远程路径」。
      directory.kind === 'webdav'
        ? { kind: 'webdav', connection_id: directory.connection_id, remote_path: path }
        : { kind: 'local', path },
      zh('来源路径已更新，正在重新扫描', 'Source updated; rescanning')
    )
    if (ok) setPicker(null)
  }

  return (
    <SettingsPage
      title={zh('目录管理', 'Directories')}
      subtitle={
        active.length ? zh(`${active.length} 个目录`, `${active.length} directories`) : undefined
      }
      onBack={onClose}
      loading={loading}
      error={error}
      onRetry={reload}
      footer={
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className={buttonClass('primary', 'h-11 w-full')}
        >
          {zh('添加目录', 'Add directory')}
        </button>
      }
    >
      {actionError ? (
        <p className="mx-3 mt-3 rounded-card border border-red-200 bg-red-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-red-700">
          {actionError}
        </p>
      ) : null}

      {active.length === 0 ? (
        <div className="px-5 py-14 text-center">
          <Icon name="folder" size={26} className="mx-auto text-zinc-300" />
          <p className="mt-3 text-[13px] text-zinc-400">
            {zh('还没有添加任何媒体目录', 'No media directories yet')}
          </p>
        </div>
      ) : (
        <div className="mx-3 mt-3 space-y-2.5">
          {active.map((directory) => {
            const status = workStatusOf(directory)
            const busyScan = isScanning(directory)
            const summary = directory.last_scan_summary || {}
            return (
              <button
                key={directory.id}
                type="button"
                onClick={() => setTarget(directory)}
                className="block w-full rounded-card bg-white px-3.5 py-3 text-left shadow-[0_1px_2px_rgba(16,24,40,0.05)] active:bg-zinc-50"
              >
                <div className="flex items-start gap-2">
                  <Icon
                    name={directory.kind === 'webdav' ? 'layers' : 'folder'}
                    size={16}
                    className="mt-[2px] flex-none text-amber-500"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block break-all text-[13px] leading-snug text-zinc-800">
                      {displayPath(directory)}
                    </span>
                  </span>
                  {!directory.enabled ? (
                    <span className="flex-none rounded bg-zinc-100 px-1.5 py-[1px] text-[10px] text-zinc-500">
                      {zh('已停用', 'Disabled')}
                    </span>
                  ) : null}
                  {directory.missing ? (
                    <span className="flex-none rounded bg-amber-50 px-1.5 py-[1px] text-[10px] text-amber-700">
                      {zh('路径不存在', 'Missing')}
                    </span>
                  ) : null}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-zinc-400">
                  <span
                    className={busyScan ? 'flex items-center gap-1 font-semibold text-brand' : ''}
                  >
                    {busyScan ? <Icon name="refresh" size={11} className="spin" /> : null}
                    {WORK_STATUS_LABELS[status] || status}
                    {busyScan && directory.scan_elapsed_ms
                      ? ` · ${formatElapsed(directory.scan_elapsed_ms)}`
                      : ''}
                  </span>
                  <span className="tabular-nums">
                    {zh(
                      `${directory.scanned_video_count || 0} 部视频 · 已刮削 ${
                        directory.scraped_video_count || 0
                      }`,
                      `${directory.scanned_video_count || 0} videos · ${
                        directory.scraped_video_count || 0
                      } scraped`
                    )}
                  </span>
                  <span className="tabular-nums">
                    {formatFinishedAt(summary.finished_at_unix_ms)}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}

      <div className="mx-3 mt-4 rounded-card bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
        <p className="flex items-start gap-2 text-[12px] leading-relaxed text-zinc-500">
          <Icon name="shield" size={14} className="mt-[2px] flex-none text-emerald-600" />
          <span>
            {zh(
              'JavBoss 只读取这些目录，不会改动里面的任何文件。「移除目录」只是让 JavBoss 不再扫描它，视频文件会原样保留，路径重新添加即可恢复。',
              'JavBoss only reads these directories and never modifies their files. Removing a directory just stops scanning it — the files stay put and re-adding the path restores it.'
            )}
          </span>
        </p>
        <p className="mt-2.5 flex items-start gap-2 text-[12px] leading-relaxed text-zinc-500">
          <Icon name="ban" size={14} className="mt-[2px] flex-none text-red-500" />
          <span>
            {zh(
              '「目录整理」会移动和重命名真实文件，属于电脑端能力，移动端不提供入口。',
              'Directory organising moves and renames real files. It is desktop-only and is not offered here.'
            )}
          </span>
        </p>
      </div>

      {/* 单个目录的设置抽屉 */}
      <BottomSheet
        open={Boolean(current)}
        title={current ? displayPath(current) : ''}
        onClose={() => setTarget(null)}
      >
        {current ? (
          <div className="pb-3">
            {actionError ? (
              <p className="mb-3 rounded-[10px] bg-red-50 px-3 py-2.5 text-[12px] leading-relaxed text-red-700">
                {actionError}
              </p>
            ) : null}

            <SheetToggle
              label={zh('启用这个目录', 'Enable this directory')}
              hint={zh(
                '停用后不参与扫描，已有的视频仍可浏览',
                'Disabled directories are not scanned; existing videos remain browsable'
              )}
              checked={Boolean(current.enabled)}
              disabled={busy}
              onChange={(value) =>
                patch(
                  current,
                  { enabled: value },
                  value ? zh('已启用', 'Enabled') : zh('已停用', 'Disabled')
                )
              }
            />

            <SheetToggle
              label={zh('自动扫描', 'Auto scan')}
              hint={zh('按下面的间隔定期重新扫描', 'Rescan periodically at the interval below')}
              checked={Boolean(current.auto_scan_enabled)}
              disabled={busy}
              onChange={(value) =>
                patch(
                  current,
                  { auto_scan_enabled: value },
                  value
                    ? zh('已开启自动扫描', 'Auto scan on')
                    : zh('已关闭自动扫描', 'Auto scan off')
                )
              }
            />

            <div className="mt-3 rounded-[10px] bg-[#f7f8fa] px-3 py-3">
              <p className="mb-2 text-[12.5px] font-medium text-zinc-600">
                {zh('扫描间隔', 'Scan interval')}
              </p>
              <PickerField
                label={zh('扫描间隔', 'Scan interval')}
                value={Number(current.auto_scan_interval_minutes || 1)}
                options={INTERVAL_CHOICES}
                onChange={(value) =>
                  patch(
                    current,
                    { auto_scan_interval_minutes: Number(value) },
                    zh('扫描间隔已更新', 'Interval updated')
                  )
                }
              />
              <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400">
                {zh(
                  '自动扫描不会检查「启用」开关，停用目录请用上面的开关。',
                  'Auto scan ignores the enable switch — use the switch above to pause a directory.'
                )}
              </p>
            </div>

            <div className="mt-3 space-y-2">
              <button
                type="button"
                disabled={busy || isScanning(current)}
                onClick={() => startScan(current)}
                className={buttonClass('primary', 'h-11 w-full')}
              >
                {isScanning(current)
                  ? zh('正在扫描…', 'Scanning…')
                  : current.missing
                    ? zh('路径不存在，无法扫描', 'Path missing')
                    : zh('立即扫描', 'Scan now')}
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  setPicker({
                    mode: current.kind === 'webdav' ? 'remote' : 'local',
                    connectionId: current.connection_id,
                    forEdit: current,
                  })
                }
                className={buttonClass('secondary', 'h-11 w-full')}
              >
                {zh('修改来源路径', 'Change source path')}
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  const directory = current
                  setTarget(null)
                  setRemoveTarget(directory)
                }}
                className={buttonClass('danger', 'h-11 w-full')}
              >
                {zh('移除目录', 'Remove directory')}
              </button>
            </div>

            {current.last_scan_summary?.files_seen ? (
              <div className="mt-3 rounded-[10px] bg-[#f7f8fa] px-3 py-2.5 text-[11.5px] leading-relaxed text-zinc-500">
                {zh(
                  `上次扫描：发现 ${current.last_scan_summary.files_seen} 个文件，新增 ${
                    current.last_scan_summary.inserted || 0
                  }，更新 ${current.last_scan_summary.updated || 0}，移除 ${
                    current.last_scan_summary.removed || 0
                  }，耗时 ${Math.round((current.last_scan_summary.duration_ms || 0) / 1000)} 秒`,
                  `Last scan: ${current.last_scan_summary.files_seen} files seen, ${
                    current.last_scan_summary.inserted || 0
                  } added, ${current.last_scan_summary.updated || 0} updated, ${
                    current.last_scan_summary.removed || 0
                  } removed in ${Math.round((current.last_scan_summary.duration_ms || 0) / 1000)}s`
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </BottomSheet>

      {/* 添加目录：先选类型 */}
      <BottomSheet
        open={addOpen}
        title={zh('添加目录', 'Add directory')}
        onClose={() => setAddOpen(false)}
      >
        <div className="space-y-3 pb-3">
          <div className="flex gap-1 rounded-[10px] bg-zinc-100 p-1">
            {[
              { value: 'local', label: zh('本地文件夹', 'Local folder') },
              { value: 'webdav', label: zh('WebDAV 远程', 'WebDAV remote') },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setAddKind(option.value)
                  setAddConnection(null)
                }}
                className={`min-w-0 flex-1 truncate rounded-[8px] px-2 py-1.5 text-[12.5px] ${
                  option.value === addKind
                    ? 'bg-white font-semibold text-brand-ink shadow-sm'
                    : 'text-zinc-600'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {addKind === 'webdav' ? (
            connections.length === 0 ? (
              <p className="rounded-[10px] bg-amber-50 px-3 py-2.5 text-[12px] leading-relaxed text-amber-800">
                {zh(
                  '还没有 WebDAV 连接。请先到「设置 → 存储连接」里添加一个。',
                  'No WebDAV connections yet. Add one under Settings → Storage connections first.'
                )}
              </p>
            ) : (
              <PickerField
                label={zh('选择连接', 'Connection')}
                value={addConnection}
                options={connections.map((item) => ({
                  value: Number(item.id),
                  label: String(item.name || ''),
                  hint: String(item.url || ''),
                }))}
                onChange={setAddConnection}
              />
            )
          ) : (
            <p className="rounded-[10px] bg-[#f7f8fa] px-3 py-2.5 text-[12px] leading-relaxed text-zinc-500">
              {zh(
                '浏览的是**服务端电脑**上的文件夹，不是这台手机的。',
                'You are browsing folders on the **server computer**, not this phone.'
              )}
            </p>
          )}

          <button
            type="button"
            disabled={addKind === 'webdav' && !addConnection}
            onClick={() =>
              setPicker({
                mode: addKind === 'webdav' ? 'remote' : 'local',
                connectionId: addConnection,
                forCreate: true,
              })
            }
            className={buttonClass('primary', 'h-11 w-full')}
          >
            {zh('浏览并选择文件夹', 'Browse and choose')}
          </button>

          <p className="text-[11px] leading-relaxed text-zinc-400">
            {zh(
              '添加后会立即开始一次完整扫描，可能需要一些时间。',
              'A full scan starts immediately after adding and may take a while.'
            )}
          </p>
        </div>
      </BottomSheet>

      <DirectoryPicker
        open={Boolean(picker)}
        mode={picker?.mode || 'local'}
        connectionId={picker?.connectionId}
        title={
          picker?.forEdit
            ? zh('修改来源路径', 'Change source path')
            : zh('选择要添加的文件夹', 'Choose a folder')
        }
        onClose={() => setPicker(null)}
        onSelect={(path) => {
          if (picker?.forEdit) {
            changeSource(picker.forEdit, path)
            return
          }
          addDirectoryWithPath(path)
        }}
      />

      <ConfirmDialog
        open={Boolean(removeTarget)}
        title={zh('移除这个目录？', 'Remove this directory?')}
        description={zh(
          '只会让 JavBoss 不再扫描它，磁盘上的视频文件一个都不会删除。之后重新添加同一个路径即可恢复。',
          'JavBoss simply stops scanning it. No files on disk are deleted. Re-adding the same path restores it.'
        )}
        items={removeTarget ? [displayPath(removeTarget)] : []}
        confirmText={zh('移除', 'Remove')}
        danger
        busy={busy}
        onClose={() => setRemoveTarget(null)}
        onConfirm={() =>
          patch(removeTarget, { is_delete: true }, zh('目录已移除', 'Directory removed')).then(
            (ok) => {
              if (ok) setRemoveTarget(null)
            }
          )
        }
      />
    </SettingsPage>
  )
}

function SheetToggle({ label, hint, checked, onChange, disabled }) {
  return (
    <div className="mt-2 flex items-start gap-3 rounded-[10px] bg-[#f7f8fa] px-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] text-zinc-800">{label}</div>
        {hint ? <p className="mt-1 text-[11.5px] leading-relaxed text-zinc-400">{hint}</p> : null}
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} label={label} />
    </div>
  )
}
