import { useEffect, useMemo, useState } from 'react'

import {
  cancelDownloadJob,
  createDownloadJob,
  deleteDownloadJob,
  fetchCloudDrive2Token,
  fetchDownloadJobs,
  fetchDownloaderSettings,
  retryDownloadJob,
  testCloudDrive2,
  updateCloudDrive2Settings,
  updateDownloaderSettings,
} from '@/api'
import BottomSheet from '@/components/BottomSheet'
import ConfirmDialog from '@/components/ConfirmDialog'
import Icon from '@/components/Icons'
import SettingsPage from '@/components/settings/SettingsPage'
import DirectoryPicker from '@/components/settings/DirectoryPicker'
import Segmented from '@/components/form/Segmented'
import Stepper from '@/components/form/Stepper'
import TextField from '@/components/form/TextField'
import { FormCard, FormRow, SectionTitle, buttonClass } from '@/components/form/Field'
import useAsyncData from '@/hooks/useAsyncData'
import { useStore } from '@/store'
import { getErrorMessage } from '@/utils/errors'
import { zh } from '@/utils/i18n'

const PAGE_SIZE = 20

const ACTIVE_STATUSES = [
  'queued',
  'offline_downloading',
  'resolving_files',
  'waiting_local_download',
  'local_downloading',
]

const STATUS_LABELS = {
  queued: [zh('排队中', 'Queued'), 'bg-zinc-100 text-zinc-600'],
  offline_downloading: [zh('云端离线下载中', 'Cloud offline download'), 'bg-blue-50 text-blue-700'],
  resolving_files: [zh('解析文件中', 'Resolving files'), 'bg-blue-50 text-blue-700'],
  waiting_local_download: [zh('等待本地下载', 'Waiting for local'), 'bg-blue-50 text-blue-700'],
  local_downloading: [zh('下载中', 'Downloading'), 'bg-blue-50 text-blue-700'],
  completed: [zh('已完成', 'Completed'), 'bg-emerald-50 text-emerald-700'],
  failed: [zh('失败', 'Failed'), 'bg-red-50 text-red-700'],
  canceled: [zh('已取消', 'Canceled'), 'bg-zinc-100 text-zinc-500'],
}

function formatBytes(value) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = bytes
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

function formatTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getMonth() + 1}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`
}

/** 下载器设置 + 任务列表。 */
export default function DownloaderPage({ onClose }) {
  const showToast = useStore((state) => state.showToast)

  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [page, setPage] = useState(1)
  const [basic, setBasic] = useState(null)
  const [cloud, setCloud] = useState(null)
  const [tokenLoaded, setTokenLoaded] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [magnet, setMagnet] = useState('')
  const [confirmTarget, setConfirmTarget] = useState(null)

  const {
    data: settings,
    loading,
    error,
    reload,
  } = useAsyncData(() => fetchDownloaderSettings(), [])

  const {
    data: jobsData,
    loading: jobsLoading,
    error: jobsError,
    reload: reloadJobs,
  } = useAsyncData(
    () => fetchDownloadJobs({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    [page]
  )

  const jobs = useMemo(() => (Array.isArray(jobsData?.items) ? jobsData.items : []), [jobsData])
  const total = Number(jobsData?.total || 0)
  const counts = jobsData?.counts || {}
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // 设置加载完成后填充表单（只做一次，之后由用户编辑）。
  useEffect(() => {
    if (!settings || basic) return
    setBasic({
      download_directory: String(settings.download_directory || ''),
      local_concurrency: Number(settings.local_concurrency) || 2,
      min_video_size_mb: Number(settings.min_video_size_mb) || 50,
    })
    setCloud({
      address: String(settings.address || ''),
      remote_folder: String(settings.remote_folder || ''),
      api_token: '',
      token_configured: Boolean(settings.token_configured),
    })
  }, [settings, basic])

  // 有进行中的任务才轮询，全部结束就停 —— PC 端是固定 3 秒轮询，这里更克制。
  const hasActive = ACTIVE_STATUSES.includes(
    jobs.find((job) => ACTIVE_STATUSES.includes(job.status))?.status
  )
  useEffect(() => {
    if (!hasActive) return undefined
    const timer = window.setTimeout(() => reloadJobs(), 3000)
    return () => window.clearTimeout(timer)
  }, [hasActive, jobs, reloadJobs])

  const run = async (task, message) => {
    setBusy(true)
    setActionError('')
    try {
      await task()
      if (message) showToast(message)
      reload()
      reloadJobs()
      return true
    } catch (err) {
      setActionError(getErrorMessage(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  const loadToken = async () => {
    setBusy(true)
    setActionError('')
    try {
      const data = await fetchCloudDrive2Token()
      setCloud((prev) => ({ ...prev, api_token: String(data?.api_token || '') }))
      setTokenLoaded(true)
    } catch (err) {
      setActionError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const testConnection = async () => {
    setBusy(true)
    setActionError('')
    setTestResult(null)
    try {
      const result = await testCloudDrive2()
      setTestResult({ ok: true, name: result?.user_name || result?.folder || '' })
    } catch (err) {
      setTestResult({ ok: false, message: getErrorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  const saveBasic = () => {
    const directory = String(basic?.download_directory || '').trim()
    if (!directory) {
      setActionError(zh('请选择本地下载目录', 'Choose a local download directory'))
      return
    }
    return run(
      () =>
        updateDownloaderSettings({
          download_directory: directory,
          local_concurrency: Number(basic.local_concurrency),
          min_video_size_mb: Number(basic.min_video_size_mb),
        }),
      zh('下载设置已保存', 'Download settings saved')
    )
  }

  const saveCloud = () => {
    // api_token 是「指针语义」：不带这个键 = 保留已存的 token。
    // 所以只有用户真的填了内容才把 api_token 放进请求体。
    const payload = {
      address: String(cloud?.address || '').trim(),
      remote_folder: String(cloud?.remote_folder || '').trim(),
    }
    const token = String(cloud?.api_token || '').trim()
    if (token && !tokenLoaded) payload.api_token = token
    return run(
      () => updateCloudDrive2Settings(payload),
      zh('CloudDrive2 设置已保存', 'CloudDrive2 saved')
    )
  }

  const submitMagnet = () => {
    const value = magnet.trim()
    if (!value) return
    return run(
      async () => {
        await createDownloadJob({ magnetUrl: value })
        setMagnet('')
        setCreateOpen(false)
        setPage(1)
      },
      zh('已加入下载队列', 'Added to the download queue')
    )
  }

  return (
    <SettingsPage
      title={zh('下载器与任务', 'Downloader')}
      subtitle={
        counts.active
          ? zh(`进行中 ${counts.active}`, `${counts.active} active`)
          : zh(`${total} 个任务`, `${total} jobs`)
      }
      onBack={onClose}
      loading={loading}
      error={error}
      onRetry={reload}
    >
      {actionError ? (
        <p className="mx-3 mt-3 rounded-card border border-red-200 bg-red-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-red-700">
          {actionError}
        </p>
      ) : null}

      <SectionTitle hint={zh('服务端下载目录', 'Server-side download folder')}>
        {zh('基本设置', 'Basic settings')}
      </SectionTitle>
      <FormCard>
        <FormRow
          label={zh('下载目录', 'Download directory')}
          hint={zh(
            '必须是服务端电脑上已存在的绝对路径',
            'Must be an existing absolute path on the server'
          )}
          control={
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="w-full rounded-[10px] border border-[#e3e5ea] bg-white px-3 py-2.5 text-left active:bg-zinc-50"
            >
              <span
                className={`block break-all text-[13px] ${
                  basic?.download_directory ? 'text-zinc-900' : 'text-zinc-400'
                }`}
              >
                {basic?.download_directory || zh('点此选择文件夹', 'Tap to choose a folder')}
              </span>
            </button>
          }
        />
        <FormRow
          label={zh('同时下载数', 'Concurrent downloads')}
          hint={zh('后端只允许 1-3', 'The server only accepts 1-3')}
          control={
            <Segmented
              label={zh('同时下载数', 'Concurrent downloads')}
              value={Number(basic?.local_concurrency) || 2}
              onChange={(value) =>
                setBasic((prev) => ({ ...prev, local_concurrency: Number(value) }))
              }
              options={[
                { value: 1, label: '1' },
                { value: 2, label: '2' },
                { value: 3, label: '3' },
              ]}
            />
          }
        />
        <FormRow
          label={zh('最小视频大小', 'Minimum video size')}
          hint={zh(
            '小于这个大小的文件会被跳过，单位 MB',
            'Files smaller than this are skipped, in MB'
          )}
          control={
            <Stepper
              value={Number(basic?.min_video_size_mb) || 50}
              onChange={(value) =>
                setBasic((prev) => ({ ...prev, min_video_size_mb: Number(value) }))
              }
              min={1}
              max={102400}
              step={10}
              suffix="MB"
              label={zh('最小视频大小', 'Minimum video size')}
            />
          }
        />
        <FormRow
          label=""
          control={
            <button
              type="button"
              disabled={busy || !basic}
              onClick={saveBasic}
              className={buttonClass('primary', 'h-10 w-full')}
            >
              {zh('保存基本设置', 'Save basic settings')}
            </button>
          }
        />
      </FormCard>

      <SectionTitle hint={zh('云端离线下载', 'Cloud offline download')}>
        {zh('CloudDrive2', 'CloudDrive2')}
      </SectionTitle>
      <FormCard>
        <FormRow
          label={zh('服务地址', 'Address')}
          control={
            <TextField
              value={cloud?.address || ''}
              onChange={(value) => setCloud((prev) => ({ ...prev, address: value }))}
              placeholder="http://127.0.0.1:19798"
              autoComplete="off"
            />
          }
        />
        <FormRow
          label={zh('云端离线目录', 'Remote offline folder')}
          control={
            <TextField
              value={cloud?.remote_folder || ''}
              onChange={(value) => setCloud((prev) => ({ ...prev, remote_folder: value }))}
              placeholder="/115open/..."
              autoComplete="off"
            />
          }
        />
        <FormRow
          label={zh('API Token', 'API token')}
          hint={
            cloud?.token_configured
              ? zh(
                  '已配置。留空则保持不变，填入新值会覆盖。',
                  'Configured. Leave blank to keep it; enter a new value to replace.'
                )
              : zh('还没有配置 Token', 'No token configured yet')
          }
          control={
            <div className="space-y-2">
              <TextField
                value={cloud?.api_token || ''}
                onChange={(value) => setCloud((prev) => ({ ...prev, api_token: value }))}
                secret
                autoComplete="off"
                placeholder={cloud?.token_configured ? '••••••••' : ''}
              />
              {!tokenLoaded ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={loadToken}
                  className={buttonClass('secondary', 'h-9 w-full text-[12.5px]')}
                >
                  {zh('读取已保存的 Token', 'Load saved token')}
                </button>
              ) : null}
            </div>
          }
        />
        <FormRow
          label=""
          control={
            <div className="flex gap-2.5">
              <button
                type="button"
                disabled={busy}
                onClick={saveCloud}
                className={buttonClass('primary', 'h-10 flex-1')}
              >
                {zh('保存', 'Save')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={testConnection}
                className={buttonClass('secondary', 'h-10 flex-1')}
              >
                {zh('测试连接', 'Test')}
              </button>
            </div>
          }
        />
      </FormCard>

      {testResult ? (
        <p
          className={`mx-3 mt-3 rounded-card px-3.5 py-2.5 text-[12px] leading-relaxed ${
            testResult.ok
              ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {testResult.ok
            ? zh(
                `连接正常${testResult.name ? ` · ${testResult.name}` : ''}`,
                `Connected${testResult.name ? ` · ${testResult.name}` : ''}`
              )
            : testResult.message}
        </p>
      ) : null}

      <SectionTitle
        hint={
          counts.active || counts.completed || counts.failed
            ? zh(
                `进行中 ${counts.active || 0} · 已完成 ${counts.completed || 0} · 失败 ${
                  counts.failed || 0
                }`,
                `${counts.active || 0} active · ${counts.completed || 0} done · ${counts.failed || 0} failed`
              )
            : undefined
        }
      >
        {zh('下载任务', 'Download jobs')}
      </SectionTitle>

      <div className="mx-3">
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className={buttonClass('primary', 'h-11 w-full')}
        >
          {zh('新建下载任务', 'New download job')}
        </button>
      </div>

      {jobsError ? (
        <p className="mx-3 mt-3 rounded-card border border-red-200 bg-red-50 px-3.5 py-2.5 text-[12px] text-red-700">
          {jobsError.message}
        </p>
      ) : jobsLoading && jobs.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-zinc-400">
          {zh('加载任务中…', 'Loading jobs…')}
        </p>
      ) : jobs.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-zinc-400">
          {zh('还没有下载任务', 'No download jobs yet')}
        </p>
      ) : (
        <div className="mx-3 mt-3 space-y-2.5">
          {jobs.map((job) => {
            const [label, tone] = STATUS_LABELS[job.status] || [
              job.status,
              'bg-zinc-100 text-zinc-600',
            ]
            const active = ACTIVE_STATUSES.includes(job.status)
            const percent =
              job.status === 'completed'
                ? 100
                : job.bytes_total > 0
                  ? Math.max(
                      0,
                      Math.min(100, Math.round((job.bytes_downloaded / job.bytes_total) * 100))
                    )
                  : 0
            return (
              <div
                key={job.id}
                className="rounded-card bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.05)]"
              >
                <div className="flex items-start gap-2">
                  <span className="min-w-0 flex-1 text-[13px] leading-snug text-zinc-800">
                    {job.magnet_name || zh(`任务 #${job.id}`, `Job #${job.id}`)}
                  </span>
                  <span
                    className={`flex-none rounded px-1.5 py-[1px] text-[10.5px] font-semibold ${tone}`}
                  >
                    {label}
                  </span>
                </div>

                {job.status === 'local_downloading' || job.status === 'completed' ? (
                  <div className="mt-2">
                    <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100">
                      <div
                        className={`h-full rounded-full ${job.status === 'completed' ? 'bg-emerald-500' : 'bg-brand'}`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <p className="mt-1 text-[11px] tabular-nums text-zinc-400">
                      {formatBytes(job.bytes_downloaded)} / {formatBytes(job.bytes_total)}
                    </p>
                  </div>
                ) : null}

                {job.error_message ? (
                  <p className="mt-2 rounded-[8px] bg-amber-50 px-2.5 py-1.5 text-[11.5px] leading-relaxed text-amber-800">
                    {job.error_message}
                  </p>
                ) : null}

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-400">
                  <span>{formatTime(job.created_at)}</span>
                  {Array.isArray(job.local_files) && job.local_files.length ? (
                    <span className="tabular-nums">
                      {zh(`${job.local_files.length} 个文件`, `${job.local_files.length} files`)}
                    </span>
                  ) : null}
                </div>

                <div className="mt-2.5 flex flex-wrap gap-2">
                  {job.status === 'failed' || job.status === 'canceled' ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        run(() => retryDownloadJob(job.id), zh('已重新加入队列', 'Requeued'))
                      }
                      className={buttonClass('secondary', 'h-8 px-3 text-[12px]')}
                    >
                      {zh('重试', 'Retry')}
                    </button>
                  ) : null}
                  {active ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(() => cancelDownloadJob(job.id), zh('已取消', 'Canceled'))}
                      className={buttonClass('secondary', 'h-8 px-3 text-[12px]')}
                    >
                      {zh('取消', 'Cancel')}
                    </button>
                  ) : null}
                  {!active ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirmTarget(job)}
                      className={buttonClass('danger', 'h-8 px-3 text-[12px]')}
                    >
                      {zh('删除记录', 'Remove record')}
                    </button>
                  ) : null}
                  {job.magnet_url ? (
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard
                          ?.writeText(job.magnet_url)
                          .then(() => showToast(zh('磁力链接已复制', 'Magnet link copied')))
                          .catch(() => showToast(zh('复制失败，请长按选择', 'Copy failed')))
                      }}
                      className={buttonClass('secondary', 'h-8 px-3 text-[12px]')}
                    >
                      {zh('复制磁力', 'Copy magnet')}
                    </button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {pages > 1 ? (
        <div className="mx-3 mt-4 flex items-center justify-between">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            className={buttonClass('secondary', 'h-9 px-4 text-[12.5px]')}
          >
            {zh('上一页', 'Previous')}
          </button>
          <span className="text-[12px] tabular-nums text-zinc-500">
            {page} / {pages}
          </span>
          <button
            type="button"
            disabled={page >= pages}
            onClick={() => setPage((value) => Math.min(pages, value + 1))}
            className={buttonClass('secondary', 'h-9 px-4 text-[12.5px]')}
          >
            {zh('下一页', 'Next')}
          </button>
        </div>
      ) : null}

      <div className="mx-3 mt-4 rounded-card bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
        <p className="flex items-start gap-2 text-[12px] leading-relaxed text-zinc-500">
          <Icon name="info" size={14} className="mt-[2px] flex-none text-zinc-400" />
          <span>
            {zh(
              '「删除记录」只删掉这条任务记录，已经下载到磁盘的视频会原样保留。取消进行中的任务也不会删除文件，但可能留下一个未完成的 .part 临时文件。',
              '“Remove record” deletes only the job entry — downloaded videos stay on disk. Cancelling an active job also deletes no files, but may leave an unfinished .part file behind.'
            )}
          </span>
        </p>
      </div>

      <DirectoryPicker
        open={pickerOpen}
        mode="local"
        title={zh('选择下载目录', 'Choose download directory')}
        onClose={() => setPickerOpen(false)}
        onSelect={(path) => {
          setBasic((prev) => ({ ...prev, download_directory: path }))
          setPickerOpen(false)
        }}
      />

      <BottomSheet
        open={createOpen}
        title={zh('新建下载任务', 'New download job')}
        onClose={() => setCreateOpen(false)}
        footer={
          <button
            type="button"
            disabled={busy || !magnet.trim()}
            onClick={submitMagnet}
            className={buttonClass('primary', 'h-11 w-full')}
          >
            {busy ? zh('提交中…', 'Submitting…') : zh('开始下载', 'Start download')}
          </button>
        }
      >
        <div className="pb-3">
          <TextField
            label={zh('磁力链接', 'Magnet link')}
            value={magnet}
            onChange={setMagnet}
            multiline
            rows={4}
            mono
            placeholder="magnet:?xt=urn:btih:..."
            hint={zh(
              '必须包含合法的 btih 哈希；目录来自上面的「下载目录」设置。',
              'Must contain a valid btih hash. Files go to the download directory set above.'
            )}
          />
        </div>
      </BottomSheet>

      <ConfirmDialog
        open={Boolean(confirmTarget)}
        title={zh('删除这条下载记录？', 'Remove this download record?')}
        description={zh(
          '只会删除任务记录。已经下载到磁盘上的视频文件不会被删除，仍然留在下载目录里。',
          'Only the job entry is removed. Videos already downloaded to disk are not deleted and stay in the download directory.'
        )}
        items={confirmTarget ? [confirmTarget.magnet_name || `#${confirmTarget.id}`] : []}
        confirmText={zh('删除记录', 'Remove record')}
        danger
        busy={busy}
        onClose={() => setConfirmTarget(null)}
        onConfirm={() =>
          run(() => deleteDownloadJob(confirmTarget.id), zh('记录已删除', 'Record removed')).then(
            (ok) => {
              if (ok) setConfirmTarget(null)
            }
          )
        }
      />
    </SettingsPage>
  )
}
