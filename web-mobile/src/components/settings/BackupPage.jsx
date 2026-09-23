import { useEffect, useMemo, useRef, useState } from 'react'

import {
  acknowledgeBackupRestore,
  deleteBackupFile,
  fetchDirectories,
  fetchStorageConnections,
  getBackupOverview,
  restoreBackup,
  runBackup,
  updateBackupSettings,
} from '@/api'
import BottomSheet from '@/components/BottomSheet'
import ConfirmDialog from '@/components/ConfirmDialog'
import Icon from '@/components/Icons'
import DirectoryPicker from '@/components/settings/DirectoryPicker'
import SettingsPage from '@/components/settings/SettingsPage'
import TextField from '@/components/form/TextField'
import PickerField from '@/components/form/PickerField'
import { FormCard, FormRow, InfoRow, SectionTitle, buttonClass } from '@/components/form/Field'
import useAsyncData from '@/hooks/useAsyncData'
import { useStore } from '@/store'
import {
  backupLocationCandidates,
  backupLocationFromOverview,
  formatBackupSize,
  formatBackupTime,
  lastRestoreNotice,
  pendingRestoreText,
} from '@/utils/backup'
import { getErrorMessage } from '@/utils/errors'
import { zh } from '@/utils/i18n'

const LOCATION_LOCAL = 'local'
const LOCATION_WEBDAV = 'webdav'

/**
 * 备份与恢复。
 *
 * 语义要点（文案必须与之保持一致）：
 *  - 备份 = 把服务端的 **data 目录**打成加密 zip，写到「备份保存位置」。
 *  - 备份位置可以是服务端电脑上的目录，也可以是某条 WebDAV 连接的远程目录，
 *    后者等于把备份直接存到网盘上；所以允许直接挑一个扫描目录（备份和视频放一起）。
 *  - 恢复**不会立刻覆盖数据**：只是解压到暂存目录，必须重启 JavBoss 才生效，
 *    所以 pending_restore 非空时要醒目提示。
 *  - 恢复 / 删除只作用于「备份保存位置」里的文件，绝不会碰 data 目录里的
 *    数据，更不会删除任何视频文件。
 */
export default function BackupPage({ onClose }) {
  const showToast = useStore((state) => state.showToast)
  const { data, loading, error, reload, setData } = useAsyncData(() => getBackupOverview(), [])
  // 备份位置的候选项：已添加的扫描目录 + WebDAV 连接名。
  const { data: sources } = useAsyncData(
    () =>
      Promise.all([fetchDirectories().catch(() => []), fetchStorageConnections().catch(() => [])]),
    []
  )

  const [pathDraft, setPathDraft] = useState('')
  const [passwordDraft, setPasswordDraft] = useState('')
  const [locationKind, setLocationKind] = useState(LOCATION_LOCAL)
  const [connectionDraft, setConnectionDraft] = useState(null)
  // busy 是「正在进行的动作」的键：backup / save / ack / restore:<name> / delete:<name>。
  const [busy, setBusy] = useState('')
  const [actionError, setActionError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [restoreTarget, setRestoreTarget] = useState(null)
  const [restorePassword, setRestorePassword] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)

  // 只在服务端保存的位置真的变了的时候回填表单，避免每次动作回来
  // 都把用户正在手输的路径或刚切换的位置覆盖掉。
  const syncedPath = useRef(null)
  useEffect(() => {
    if (!data) return
    const location = backupLocationFromOverview(data)
    const key = `${location.kind}|${location.connectionId}|${location.path}`
    if (syncedPath.current === key) return
    syncedPath.current = key
    setLocationKind(location.kind)
    setConnectionDraft(location.connectionId ? Number(location.connectionId) : null)
    setPathDraft(location.path)
  }, [data])

  const files = Array.isArray(data?.files) ? data.files : []
  const filesError = String(data?.files_error || '')
  const pending = data?.pending_restore || null
  const notice = lastRestoreNotice(data?.last_restore)
  const canBackup = Boolean(data?.backup_path)
  const remoteLocation = locationKind === LOCATION_WEBDAV
  const connections = useMemo(() => (Array.isArray(sources?.[1]) ? sources[1] : []), [sources])
  // 已添加的扫描目录（含 WebDAV 远程目录）都是可选的备份落点。
  const candidates = useMemo(
    () =>
      backupLocationCandidates(
        Array.isArray(sources?.[0]) ? sources[0] : [],
        Array.isArray(sources?.[1]) ? sources[1] : []
      ),
    [sources]
  )

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
        zh('请选择备份要写入的 WebDAV 连接', 'Choose the WebDAV connection to store backups in')
      )
      return
    }
    const ok = await runAction(
      'save',
      () =>
        updateBackupSettings({
          backupPath: pathDraft.trim(),
          connectionId,
          password: passwordDraft.trim(),
        }),
      zh('备份设置已保存', 'Backup settings saved')
    )
    if (ok) setPasswordDraft('')
  }

  const clearPassword = () =>
    runAction(
      'save',
      () => updateBackupSettings({ clearPassword: true }),
      zh('已清除压缩密码', 'Compression password cleared')
    )

  const startBackup = () =>
    runAction(
      'backup',
      () => runBackup(passwordDraft.trim()),
      zh('备份已完成，文件已保存到备份目录', 'Backup complete; saved to the backup directory')
    )

  const dismissNotice = () =>
    runAction('ack', () => acknowledgeBackupRestore(), zh('已清除提示', 'Notice dismissed'))

  const doRestore = (name, password) => {
    setRestoreTarget(null)
    return runAction(
      `restore:${name}`,
      () => restoreBackup(name, password),
      zh('恢复已就绪，重启 JavBoss 后生效', 'Restore staged; restart JavBoss to apply')
    )
  }

  const beginRestore = (file) => {
    // 已经保存了压缩密码：直接用它；密码不对时后端会返回明确错误。
    if (data?.password_set) {
      doRestore(file.name, '')
      return
    }
    // 没有保存密码：备份可能是加密的，先让用户填本次恢复用的密码（可留空）。
    setRestorePassword('')
    setRestoreTarget(file)
  }

  const confirmDelete = () =>
    runAction(
      `delete:${deleteTarget?.name}`,
      () => deleteBackupFile(deleteTarget.name),
      zh('备份文件已删除', 'Backup file deleted')
    ).then((ok) => {
      if (ok) setDeleteTarget(null)
    })

  return (
    <SettingsPage
      title={zh('备份与恢复', 'Backup & restore')}
      subtitle={
        data
          ? Number(data.backup_connection_id) > 0
            ? `${
                String(data.backup_connection_name || '').trim() ||
                `WebDAV #${data.backup_connection_id}`
              } · ${data.backup_path}`
            : data.backup_path || zh('未设置保存位置', 'No backup location set')
          : zh('data 目录备份', 'data directory backup')
      }
      onBack={onClose}
      loading={loading}
      error={error}
      onRetry={reload}
      footer={
        <button
          type="button"
          disabled={Boolean(busy) || !canBackup}
          onClick={startBackup}
          className={buttonClass('primary', 'h-11 w-full')}
        >
          {busy === 'backup'
            ? zh('正在备份…', 'Backing up…')
            : canBackup
              ? zh('开始备份', 'Back up now')
              : zh('请先设置备份保存位置', 'Set the backup location first')}
        </button>
      }
    >
      {pending ? (
        <Notice
          tone="warn"
          icon="refresh"
          title={zh(
            '恢复已就绪，重启 JavBoss 后生效',
            'Restore is staged — restart JavBoss to apply'
          )}
          detail={pendingRestoreText(pending)}
        />
      ) : null}

      {notice ? (
        <Notice
          tone={notice.tone}
          icon={notice.tone === 'error' ? 'ban' : 'info'}
          title={notice.title}
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
          {notice.missing.length ? (
            <>
              <ul className="mt-2 space-y-1 pl-[22px]">
                {notice.missing.map((item) => (
                  <li key={item} className="break-all font-mono text-[11.5px] opacity-90">
                    {item}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 pl-[22px] text-[11.5px] leading-relaxed opacity-80">
                {zh(
                  '恢复只覆盖 data 目录里的数据，不会改写这些路径，请重新添加或修正目录。',
                  'The restore only overwrites data in the data directory and never rewrites these paths; re-add or fix the directories yourself.'
                )}
              </p>
            </>
          ) : null}
        </Notice>
      ) : null}

      {actionError ? (
        <p className="mx-3 mt-3 rounded-card border border-red-200 bg-red-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-red-700">
          {actionError}
        </p>
      ) : null}

      <SectionTitle hint={zh('在服务端电脑上', 'On the server computer')}>
        {zh('备份设置', 'Backup settings')}
      </SectionTitle>

      <FormCard>
        <FormRow
          label={zh('备份保存位置', 'Backup location')}
          hint={zh(
            '备份 zip 会写到这个位置。可以选服务端电脑上的目录，也可以选 WebDAV 连接的远程目录（等于把备份存到网盘上）。',
            'Backup zips are written here. It can be a folder on the server computer or a folder on a WebDAV connection (which stores the backup on your cloud drive).'
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
                      placeholder={zh('例如 /JAV/HD', 'e.g. /JAV/HD')}
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
                          '远程目录必须是已存在且可写的目录，否则保存会被拒绝（很多网盘的 WebDAV 是只读挂载）。',
                          'The remote folder must already exist and be writable, otherwise saving is rejected (many cloud drives mount WebDAV read-only).'
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
                      placeholder={zh('例如 D:\\javboss-backups', 'e.g. /data/backups')}
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
                    '上面是已添加的扫描目录，点一下即可把备份直接写到视频旁边。',
                    'These are your added scan directories; tap one to write backups right next to the videos.'
                  )}
                </p>
              ) : null}
            </>
          }
        />

        <FormRow
          label={zh('压缩密码', 'Compression password')}
          hint={zh(
            '用于加密备份 zip。留空表示不修改当前密码；加密过的备份在恢复时需要用到它。',
            'Encrypts the backup zip. Leave blank to keep the current password; encrypted backups need it when restoring.'
          )}
          control={
            <TextField
              value={passwordDraft}
              onChange={setPasswordDraft}
              secret
              autoComplete="new-password"
              placeholder={
                data?.password_set
                  ? zh('已设置，留空则不修改', 'Password set — leave blank to keep it')
                  : zh('未设置', 'Not set')
              }
            />
          }
        />

        <InfoRow
          label={zh('当前密码状态', 'Password status')}
          value={data?.password_set ? zh('已设置', 'Set') : zh('未设置', 'Not set')}
        />
        {data?.backup_path ? (
          <InfoRow
            label={zh('当前保存位置', 'Current location')}
            value={
              Number(data.backup_connection_id) > 0
                ? `${
                    String(data.backup_connection_name || '').trim() ||
                    `WebDAV #${data.backup_connection_id}`
                  } · ${data.backup_path}`
                : data.backup_path
            }
            mono
          />
        ) : null}
      </FormCard>

      <div className="mx-3 mt-3 flex gap-2.5">
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={saveSettings}
          className={buttonClass('primary', 'h-11 flex-1')}
        >
          {busy === 'save' ? zh('保存中…', 'Saving…') : zh('保存设置', 'Save')}
        </button>
        {data?.password_set ? (
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={clearPassword}
            className={buttonClass('danger', 'h-11 flex-1')}
          >
            {zh('清除密码', 'Clear password')}
          </button>
        ) : null}
      </div>

      <div className="mx-3 mt-3 rounded-card bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
        <p className="flex items-start gap-2 text-[12px] leading-relaxed text-zinc-500">
          <Icon name="info" size={14} className="mt-[2px] flex-none text-zinc-400" />
          <span>
            {zh(
              '备份范围是服务端的 data 目录（数据库、缩略图、封面、截图、字幕等），不含缓存与已下载的工具。备份是一个加密 zip，文件名形如 javboss-backup-20260923-201500.zip。',
              'A backup covers the server-side data directory (database, thumbnails, covers, screenshots, subtitles) but not caches or downloaded tools. It is an encrypted zip named like javboss-backup-20260923-201500.zip.'
            )}
            <br />
            {zh(
              '恢复不会立刻覆盖数据：解压到暂存目录后，必须重启 JavBoss 才会生效。',
              'A restore does not overwrite data immediately: it is unpacked into a staging area and only takes effect after JavBoss restarts.'
            )}
          </span>
        </p>
      </div>

      <SectionTitle
        hint={files.length ? zh(`${files.length} 个文件`, `${files.length} files`) : undefined}
      >
        {zh('备份文件', 'Backup files')}
      </SectionTitle>

      {files.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <Icon name="inbox" size={26} className="mx-auto text-zinc-300" />
          <p className="mt-3 text-[13px] text-zinc-400">
            {filesError
              ? zh('读取备份文件列表失败', 'Failed to read the backup file list')
              : zh('还没有备份文件', 'No backup files yet')}
          </p>
          {filesError ? (
            <p className="mt-2 break-all px-4 text-[11.5px] leading-relaxed text-amber-700">
              {filesError}
            </p>
          ) : null}
          {filesError ? (
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
          {files.map((file) => (
            <div
              key={file.name}
              className="rounded-card bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.05)]"
            >
              <div className="flex items-start gap-2">
                <Icon name="inbox" size={16} className="mt-[2px] flex-none text-brand" />
                <span className="min-w-0 flex-1">
                  <span className="block break-all text-[13px] leading-snug text-zinc-800">
                    {file.name}
                  </span>
                  <span className="mt-1 block text-[11.5px] tabular-nums text-zinc-400">
                    {[formatBackupTime(file.modified_at), formatBackupSize(file.size)]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
              </div>

              <div className="mt-2.5 flex gap-2">
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => beginRestore(file)}
                  className={buttonClass('secondary', 'h-9 flex-1')}
                >
                  {busy === `restore:${file.name}`
                    ? zh('正在恢复…', 'Restoring…')
                    : zh('恢复', 'Restore')}
                </button>
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => setDeleteTarget(file)}
                  className={buttonClass('danger', 'h-9 flex-1')}
                >
                  {busy === `delete:${file.name}`
                    ? zh('正在删除…', 'Deleting…')
                    : zh('删除', 'Delete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <DirectoryPicker
        open={pickerOpen}
        mode={remoteLocation ? 'remote' : 'local'}
        connectionId={connectionDraft}
        title={
          remoteLocation
            ? zh('选择备份保存目录（远程）', 'Choose backup folder (remote)')
            : zh('选择备份保存目录', 'Choose backup folder')
        }
        remoteHint={
          remoteLocation
            ? zh(
                '备份会写到这个 WebDAV 目录里，请选择可写的目录。',
                'Backups are written into this WebDAV folder, so pick a writable one.'
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
        open={Boolean(deleteTarget)}
        title={zh('删除这个备份文件？', 'Delete this backup file?')}
        description={zh(
          '只会删除「备份保存位置」里的这个 zip 文件，不会碰 data 目录，也不会删除任何视频文件。',
          'Only this zip inside the backup location is removed. The data directory and your video files are untouched.'
        )}
        items={deleteTarget ? [deleteTarget.name] : []}
        confirmText={zh('删除', 'Delete')}
        danger
        busy={busy.startsWith('delete')}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />

      <BottomSheet
        open={Boolean(restoreTarget)}
        title={zh('输入恢复密码', 'Enter restore password')}
        onClose={() => setRestoreTarget(null)}
        footer={
          <>
            <button
              type="button"
              onClick={() => setRestoreTarget(null)}
              className={buttonClass('secondary', 'h-11 flex-1')}
            >
              {zh('取消', 'Cancel')}
            </button>
            <button
              type="button"
              disabled={busy.startsWith('restore')}
              onClick={() => doRestore(restoreTarget?.name, restorePassword.trim())}
              className={buttonClass('primary', 'h-11 flex-1')}
            >
              {zh('开始恢复', 'Restore')}
            </button>
          </>
        }
      >
        <div className="pb-3">
          <p className="mb-2.5 text-[12px] leading-relaxed text-zinc-500">
            {zh(
              '设置里没有保存压缩密码。如果这个备份是加密的，请输入备份时使用的密码；如果没有加密，留空直接点「开始恢复」即可。',
              'No compression password is saved. If this backup is encrypted, enter the password used when it was created; otherwise leave it blank and tap Restore.'
            )}
          </p>
          <TextField
            label={zh('备份密码（可留空）', 'Backup password (optional)')}
            value={restorePassword}
            onChange={setRestorePassword}
            secret
            autoComplete="off"
            placeholder={zh('留空表示备份未加密', 'Leave blank if the backup is not encrypted')}
          />
          <p className="mt-2 text-[11.5px] leading-relaxed text-zinc-400">
            {zh(
              '恢复只是解压到暂存目录，重启 JavBoss 后才会生效。',
              'Restoring only unpacks into a staging area; it takes effect after JavBoss restarts.'
            )}
          </p>
        </div>
      </BottomSheet>
    </SettingsPage>
  )
}

const NOTICE_TONES = {
  error: 'border-red-200 bg-red-50 text-red-700',
  warn: 'border-amber-200 bg-amber-50 text-amber-800',
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-700',
}

/** 顶部状态提示条（待生效的恢复 / 上次恢复结果）。 */
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
