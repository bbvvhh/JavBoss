import { useEffect, useMemo, useRef, useState } from 'react'

import {
  acknowledgeUpdate,
  applyUpdate,
  fetchDirectories,
  fetchStorageConnections,
  getUpdateOverview,
  updateUpdateSettings,
} from '@/api'
import ConfirmDialog from '@/components/ConfirmDialog'
import Icon from '@/components/Icons'
import DirectoryPicker from '@/components/settings/DirectoryPicker'
import SettingsPage from '@/components/settings/SettingsPage'
import TextField from '@/components/form/TextField'
import PickerField from '@/components/form/PickerField'
import { FormCard, FormRow, InfoRow, SectionTitle, buttonClass } from '@/components/form/Field'
import useAsyncData from '@/hooks/useAsyncData'
import { useStore } from '@/store'
import { backupLocationCandidates } from '@/utils/backup'
import { getErrorMessage } from '@/utils/errors'
import { zh } from '@/utils/i18n'
import {
  describeUpdatePackage,
  describeUpdatePlatform,
  lastUpdateNotice,
  pendingUpdateText,
  updateLocationFromOverview,
} from '@/utils/update'

const LOCATION_LOCAL = 'local'
const LOCATION_WEBDAV = 'webdav'

/**
 * 程序更新。
 *
 * 语义要点（文案必须与之保持一致）：
 *  - 发布包由用户手动上传到一个**只读**位置（服务端电脑上的目录，或某条 WebDAV 连接的远程目录），
 *    页面只负责列出这个位置里的发布包并发起更新。
 *  - 更新会立刻用包里的文件覆盖**程序目录**，但 data 目录坚决不动、config.toml 保留本机版本。
 *  - 覆盖只改磁盘上的文件，必须重启 JavBoss 才会加载新版本，所以结果提示要强调重启。
 */
export default function UpdatePage({ onClose }) {
  const showToast = useStore((state) => state.showToast)
  const { data, loading, error, reload, setData } = useAsyncData(() => getUpdateOverview(), [])
  // 发布包位置的候选项：已添加的扫描目录 + WebDAV 连接名。
  const { data: sources } = useAsyncData(
    () =>
      Promise.all([fetchDirectories().catch(() => []), fetchStorageConnections().catch(() => [])]),
    []
  )

  const [pathDraft, setPathDraft] = useState('')
  const [locationKind, setLocationKind] = useState(LOCATION_LOCAL)
  const [connectionDraft, setConnectionDraft] = useState(null)
  // busy 是「正在进行的动作」的键：save / ack / apply:<name>。
  const [busy, setBusy] = useState('')
  const [actionError, setActionError] = useState('')
  const [applyTarget, setApplyTarget] = useState(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  // 只在服务端保存的位置真的变了的时候回填表单，避免每次动作回来都覆盖用户正在输入的内容。
  const syncedPath = useRef(null)
  useEffect(() => {
    if (!data) return
    const location = updateLocationFromOverview(data)
    const key = `${location.kind}|${location.connectionId}|${location.path}`
    if (syncedPath.current === key) return
    syncedPath.current = key
    setLocationKind(location.kind)
    setConnectionDraft(location.connectionId ? Number(location.connectionId) : null)
    setPathDraft(location.path)
  }, [data])

  const packages = Array.isArray(data?.packages) ? data.packages : []
  const packagesError = String(data?.packages_error || '')
  const pending = data?.pending || null
  const notice = lastUpdateNotice(data?.last_update)
  const remoteLocation = locationKind === LOCATION_WEBDAV
  const connections = useMemo(() => (Array.isArray(sources?.[1]) ? sources[1] : []), [sources])
  // 已添加的扫描目录都是可选的发布包落点（发布包和视频放一起、或放在同一个网盘上）。
  const candidates = useMemo(
    () =>
      backupLocationCandidates(
        Array.isArray(sources?.[0]) ? sources[0] : [],
        Array.isArray(sources?.[1]) ? sources[1] : []
      ),
    [sources]
  )
  const platformText = describeUpdatePlatform(data?.platform)
  const programDir = String(data?.program_dir || '')
  const currentLocationText = data
    ? Number(data.update_connection_id) > 0
      ? `${
          String(data.update_connection_name || '').trim() || `WebDAV #${data.update_connection_id}`
        } · ${data.update_path}`
      : data.update_path || zh('未设置', 'Not set')
    : ''

  const runAction = async (key, task, message) => {
    setBusy(key)
    setActionError('')
    try {
      const next = await task()
      // 所有写接口都返回同一份 overview，直接替换即可，不必再拉一次。
      if (next && typeof next === 'object') setData(next)
      if (message) showToast(message)
      return true
    } catch (err) {
      setActionError(getErrorMessage(err))
      return false
    } finally {
      setBusy('')
    }
  }

  const saveSettings = async () => {
    const connectionId = remoteLocation ? Number(connectionDraft) || 0 : 0
    if (remoteLocation && connectionId <= 0) {
      setActionError(
        zh('请选择发布包所在的 WebDAV 连接', 'Choose the WebDAV connection holding the packages')
      )
      return
    }
    await runAction(
      'save',
      () => updateUpdateSettings({ updatePath: pathDraft.trim(), connectionId }),
      zh('更新设置已保存', 'Update settings saved')
    )
  }

  const dismissNotice = () =>
    runAction('ack', () => acknowledgeUpdate(), zh('已清除提示', 'Notice dismissed'))

  const confirmApply = () =>
    runAction(
      `apply:${applyTarget?.name}`,
      () => applyUpdate(applyTarget?.name),
      zh('更新已应用，请重启 JavBoss', 'Update applied — restart JavBoss')
    ).then((ok) => {
      if (ok) setApplyTarget(null)
    })

  return (
    <SettingsPage
      title={zh('程序更新', 'Program update')}
      subtitle={currentLocationText || zh('用发布包覆盖程序文件', 'Replace program files')}
      onBack={onClose}
      loading={loading}
      error={error}
      onRetry={reload}
      footer={
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={saveSettings}
          className={buttonClass('primary', 'h-11 w-full')}
        >
          {busy === 'save' ? zh('保存中…', 'Saving…') : zh('保存更新设置', 'Save')}
        </button>
      }
    >
      {pending ? (
        <Notice
          tone="warn"
          icon="refresh"
          title={zh('正在覆盖程序文件', 'Replacing program files')}
          detail={`${pendingUpdateText(pending)} · ${zh(
            '如果长时间停在这里，重启 JavBoss 会自动回滚到原版本。',
            'If this state persists, restarting JavBoss rolls the program back.'
          )}`}
        />
      ) : null}

      {notice ? (
        <Notice
          tone={notice.tone}
          icon={notice.tone === 'error' ? 'ban' : 'info'}
          title={notice.title}
          detail={notice.detail}
          action={
            <button
              type="button"
              disabled={busy === 'ack'}
              onClick={dismissNotice}
              className={buttonClass('secondary', 'h-8 px-3 text-[12.5px]')}
            >
              {zh('知道了', 'Got it')}
            </button>
          }
        >
          {notice.restartNeeded ? (
            <p className="mt-1.5 pl-[22px] text-[11.5px] leading-relaxed opacity-80">
              {zh(
                '只有重启 JavBoss 之后，新的程序文件才会被加载。',
                'The new program files are loaded only after JavBoss restarts.'
              )}
            </p>
          ) : null}
        </Notice>
      ) : null}

      {actionError ? (
        <p className="mx-3 mt-3 rounded-card border border-red-200 bg-red-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-red-700">
          {actionError}
        </p>
      ) : null}

      <SectionTitle hint={zh('在服务端电脑上', 'On the server computer')}>
        {zh('更新设置', 'Update settings')}
      </SectionTitle>

      <FormCard>
        <FormRow
          label={zh('发布包位置', 'Package location')}
          hint={zh(
            '把发布包（javboss-<版本>-<平台>.zip / .tar.gz）上传到这个位置，页面只读取它。可以选服务端电脑上的目录，也可以选 WebDAV 连接的远程目录。',
            'Upload release packages (javboss-<version>-<platform>.zip / .tar.gz) here; this page only reads the location. It can be a folder on the server computer or a folder on a WebDAV connection.'
          )}
          control={
            <>
              <div className="flex gap-1 rounded-[10px] bg-zinc-100 p-1">
                {[
                  { value: LOCATION_LOCAL, label: zh('本机目录', 'Local folder') },
                  { value: LOCATION_WEBDAV, label: zh('WebDAV 远程', 'WebDAV remote') },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => {
                      setLocationKind(option.value)
                      setActionError('')
                    }}
                    className={`min-w-0 flex-1 truncate rounded-[8px] px-2 py-1.5 text-[12.5px] ${
                      option.value === locationKind
                        ? 'bg-white font-semibold text-brand-ink shadow-sm'
                        : 'text-zinc-600'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              {remoteLocation ? (
                <>
                  <div className="mt-2.5">
                    <PickerField
                      label={zh('WebDAV 连接', 'WebDAV connection')}
                      value={connectionDraft}
                      options={connections.map((item) => ({
                        value: Number(item.id),
                        label: String(item.name || '') || `WebDAV #${item.id}`,
                        hint: String(item.url || ''),
                      }))}
                      onChange={(value) => {
                        setConnectionDraft(value)
                        setActionError('')
                      }}
                      sheetTitle={zh('选择 WebDAV 连接', 'Choose a WebDAV connection')}
                      emptyText={zh('还没有 WebDAV 连接', 'No WebDAV connections yet')}
                    />
                  </div>
                  <div className="mt-2.5">
                    <TextField
                      value={pathDraft}
                      onChange={setPathDraft}
                      placeholder={zh('例如 /javboss/releases', 'e.g. /javboss/releases')}
                      mono
                      autoComplete="off"
                    />
                  </div>
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-zinc-400">
                    {connections.length === 0
                      ? zh(
                          '请先到「设置 → 存储连接」里添加一个 WebDAV 连接。',
                          'Add a WebDAV connection under Settings → Storage connections first.'
                        )
                      : zh(
                          '这个位置只读，网盘的只读挂载也可以；目录必须已存在。',
                          'This location is read-only, so a read-only cloud drive mount is fine; the folder must already exist.'
                        )}
                  </p>
                  <button
                    type="button"
                    disabled={Boolean(busy) || !connectionDraft}
                    onClick={() => setPickerOpen(true)}
                    className={buttonClass('secondary', 'mt-2 h-10 w-full')}
                  >
                    <Icon name="folder" size={15} />
                    {zh('选择远程目录', 'Choose remote folder')}
                  </button>
                </>
              ) : (
                <>
                  <div className="mt-2.5">
                    <TextField
                      value={pathDraft}
                      onChange={setPathDraft}
                      placeholder={zh('例如 D:\\javboss-releases', 'e.g. /opt/javboss-releases')}
                      mono
                      autoComplete="off"
                    />
                  </div>
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-zinc-400">
                    {zh(
                      '必须是服务端电脑上已存在的绝对目录，否则保存会被拒绝。',
                      'The folder must already exist on the server computer, otherwise saving is rejected.'
                    )}
                  </p>
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => setPickerOpen(true)}
                    className={buttonClass('secondary', 'mt-2 h-10 w-full')}
                  >
                    <Icon name="folder" size={15} />
                    {zh('选择服务端目录', 'Choose server folder')}
                  </button>
                </>
              )}

              {candidates.length ? (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {candidates.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => {
                        setLocationKind(option.kind)
                        setConnectionDraft(option.connectionId ? Number(option.connectionId) : null)
                        setPathDraft(option.path)
                        setActionError('')
                      }}
                      className="max-w-full truncate rounded-full border border-[#e3e5ea] bg-white px-2.5 py-1 text-[11.5px] text-zinc-600 active:bg-zinc-100"
                    >
                      {option.detail ? `${option.label} · ${option.detail}` : option.label}
                    </button>
                  ))}
                </div>
              ) : null}
              {candidates.length ? (
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-zinc-400">
                  {zh(
                    '上面是已添加的扫描目录，点一下即可把发布包放在同一处。',
                    'These are your added scan directories; tap one to keep packages in the same place.'
                  )}
                </p>
              ) : null}
            </>
          }
        />

        <InfoRow
          label={zh('当前发布包位置', 'Current location')}
          value={currentLocationText || zh('未设置', 'Not set')}
          mono
        />
        <InfoRow
          label={zh('当前程序平台', 'Current platform')}
          value={platformText || data?.platform || zh('未知', 'Unknown')}
        />
        <InfoRow
          label={zh('更新覆盖的目录', 'Program directory')}
          value={programDir || zh('未知', 'Unknown')}
          mono
        />
      </FormCard>

      <div className="mx-3 mt-3 rounded-card bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
        <p className="flex items-start gap-2 text-[12px] leading-relaxed text-zinc-500">
          <Icon name="info" size={14} className="mt-[2px] flex-none text-zinc-400" />
          <span>
            {zh(
              '更新会立刻用发布包里的文件覆盖程序目录，但 data 目录坚决不动，也不会用包里的 config.toml 覆盖本机配置。覆盖只改磁盘上的文件，必须重启 JavBoss 才会加载新版本。',
              'Updating immediately replaces the program directory with the files inside the package, but the data directory is never touched and the packaged config.toml never replaces your local one. Only disk files change, so JavBoss must be restarted to load the new version.'
            )}
          </span>
        </p>
      </div>

      <SectionTitle
        hint={
          packages.length ? zh(`${packages.length} 个包`, `${packages.length} packages`) : undefined
        }
      >
        {zh('发布包', 'Packages')}
      </SectionTitle>

      {packages.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <Icon name="inbox" size={26} className="mx-auto text-zinc-300" />
          <p className="mt-3 text-[13px] text-zinc-400">
            {packagesError
              ? zh('读取发布包列表失败', 'Failed to read the package list')
              : zh(
                  '这个位置里还没有可用的发布包',
                  'No usable release packages in this location yet'
                )}
          </p>
          {packagesError ? (
            <p className="mt-2 break-all px-4 text-[11.5px] leading-relaxed text-amber-700">
              {packagesError}
            </p>
          ) : null}
          {packagesError ? (
            <button
              type="button"
              onClick={reload}
              className={buttonClass('secondary', 'mt-3 h-9 px-4')}
            >
              {zh('重试', 'Retry')}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="mx-3 space-y-2.5">
          {packages.map((pkg) => {
            const item = describeUpdatePackage(pkg)
            const platformName = describeUpdatePlatform(item.platform)
            const unknownPlatform = item.platform === ''
            return (
              <div
                key={item.name}
                className="rounded-card bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.05)]"
              >
                <div className="flex items-start gap-2">
                  <Icon name="inbox" size={16} className="mt-[2px] flex-none text-brand" />
                  <span className="min-w-0 flex-1">
                    <span className="block break-all text-[13px] leading-snug text-zinc-800">
                      {item.name}
                    </span>
                    <span className="mt-1 block text-[11.5px] tabular-nums text-zinc-400">
                      {[platformName, item.metaText].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </div>

                {unknownPlatform ? (
                  <p className="mt-2 text-[11.5px] leading-relaxed text-amber-700">
                    {zh(
                      '文件名里没有平台标识，无法判断能否在本机运行。',
                      'The file name has no platform tag, so compatibility cannot be verified.'
                    )}
                  </p>
                ) : null}
                {!item.compatible && !unknownPlatform ? (
                  <p className="mt-2 text-[11.5px] leading-relaxed text-amber-700">
                    {zh(
                      '这个包不是给当前平台用的，不能用本机更新。',
                      'This package targets another platform and cannot update this machine.'
                    )}
                  </p>
                ) : null}

                <button
                  type="button"
                  disabled={Boolean(busy) || !item.compatible}
                  onClick={() => {
                    setActionError('')
                    setApplyTarget(pkg)
                  }}
                  className={buttonClass('primary', 'mt-2.5 h-9 w-full')}
                >
                  {busy === `apply:${item.name}`
                    ? zh('正在更新…', 'Updating…')
                    : zh('更新到该版本', 'Update to this build')}
                </button>
              </div>
            )
          })}
        </div>
      )}

      <DirectoryPicker
        open={pickerOpen}
        mode={remoteLocation ? 'remote' : 'local'}
        connectionId={connectionDraft}
        title={
          remoteLocation
            ? zh('选择发布包目录（远程）', 'Choose package folder (remote)')
            : zh('选择发布包目录', 'Choose package folder')
        }
        remoteHint={
          remoteLocation
            ? zh(
                '请选择存放发布包的 WebDAV 目录，只读挂载也可以。',
                'Pick the WebDAV folder holding the release packages; a read-only mount is fine.'
              )
            : ''
        }
        onClose={() => setPickerOpen(false)}
        onSelect={(path) => {
          setPathDraft(String(path || ''))
          setPickerOpen(false)
        }}
      />

      <ConfirmDialog
        open={Boolean(applyTarget)}
        title={zh('确认更新到该发布包？', 'Update to this package?')}
        description={zh(
          '会立刻用发布包里的文件覆盖程序目录，需要重启 JavBoss 才会加载新版本。data 目录与 config.toml 不会被改动。',
          'The program directory is immediately overwritten with the files inside the package, and JavBoss must be restarted to load the new version. The data directory and config.toml are left untouched.'
        )}
        items={applyTarget ? [applyTarget.name] : []}
        confirmText={zh('确认更新', 'Update')}
        busy={busy.startsWith('apply')}
        onClose={() => setApplyTarget(null)}
        onConfirm={confirmApply}
      />
    </SettingsPage>
  )
}

const NOTICE_TONES = {
  error: 'border-red-200 bg-red-50 text-red-700',
  warn: 'border-amber-200 bg-amber-50 text-amber-800',
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-700',
}

/** 顶部状态提示条（正在覆盖 / 上次更新结果）。 */
function Notice({ tone = 'warn', icon = 'info', title, detail, action, children }) {
  return (
    <div
      className={`mx-3 mt-3 rounded-card border px-3.5 py-2.5 ${NOTICE_TONES[tone] || NOTICE_TONES.warn}`}
    >
      <p className="flex items-start gap-2 text-[12.5px] font-medium leading-relaxed">
        <Icon name={icon} size={14} className="mt-[2px] flex-none" />
        <span>{title}</span>
      </p>
      {detail ? (
        <p className="mt-1 break-all pl-[22px] text-[11.5px] leading-relaxed opacity-80">
          {detail}
        </p>
      ) : null}
      {children}
      {action ? <div className="mt-2 pl-[22px]">{action}</div> : null}
    </div>
  )
}
