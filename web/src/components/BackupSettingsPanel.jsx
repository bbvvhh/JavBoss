import { useEffect, useRef, useState } from 'react'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'

import AppModal from '@/components/AppModal'
import DirectoryPickerModal from '@/components/DirectoryPickerModal'
import {
  acknowledgeBackupRestore,
  deleteBackupFile,
  fetchBackupOverview,
  fetchDirectories,
  fetchStorageConnections,
  restoreBackup,
  runBackup,
  updateBackupSettings,
} from '@/api'
import { useStore } from '@/store'
import { apiHostPath, displayHostPath, hostPathsEnabled } from '@/utils/hostPath'
import { getErrorMessage } from '@/utils/errors'
import { zh } from '@/utils/i18n'
import {
  backupLocationCandidates,
  backupLocationFromOverview,
  buildBackupSettingsPayload,
  describeBackupFile,
  lastRestoreNotice,
  pendingRestoreNotice,
} from '@/utils/backup'

const LOCATION_LOCAL = 'local'
const LOCATION_WEBDAV = 'webdav'

/**
 * 设置里的「备份与恢复」面板。
 *
 * 备份 = 把服务器 data 目录打包成加密 zip 存到备份路径；恢复只解压到暂存目录，
 * 必须重启 JavBoss 才生效。恢复与删除都只作用于备份路径里的文件。
 *
 * 备份保存位置可以是本机目录，也可以是某条 WebDAV 连接的远程目录——后者等于把
 * 备份直接存到网盘上，所以允许挑一个扫描目录（备份 zip 和视频放在一起）。
 */
export default function BackupSettingsPanel({ onToast, directoryPickerEnabled = true }) {
  const useHostPaths = useStore((state) => hostPathsEnabled(state.config))
  const [overview, setOverview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const [locationKind, setLocationKind] = useState(LOCATION_LOCAL)
  const [connectionId, setConnectionId] = useState('')
  const [connections, setConnections] = useState([])
  const [directories, setDirectories] = useState([])
  const [pathInput, setPathInput] = useState('')
  const [passwordInput, setPasswordInput] = useState('')
  const [clearPassword, setClearPassword] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsError, setSettingsError] = useState('')
  const [settingsMessage, setSettingsMessage] = useState('')
  const [backingUp, setBackingUp] = useState(false)
  const [restoringName, setRestoringName] = useState('')
  const [deletingName, setDeletingName] = useState('')
  const [acknowledging, setAcknowledging] = useState(false)
  const [actionError, setActionError] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState(null)
  const [restorePassword, setRestorePassword] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError('')
    fetchBackupOverview()
      .then((data) => {
        if (!cancelled) setOverview(data)
      })
      .catch((err) => {
        if (!cancelled) setLoadError(getErrorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reloadToken, useHostPaths])

  // 候选的「扫描目录」用来一键把备份写到视频旁边（WebDAV 目录就等于存到网盘）。
  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetchStorageConnections().catch(() => []),
      fetchDirectories().catch(() => []),
    ]).then(([connectionList, directoryList]) => {
      if (cancelled) return
      setConnections(Array.isArray(connectionList) ? connectionList : [])
      setDirectories(Array.isArray(directoryList) ? directoryList : [])
    })
    return () => {
      cancelled = true
    }
  }, [])

  // 只在服务端保存的位置真的变了的时候回填表单，避免每次动作回来
  // 都把用户正在手输的路径或刚切换的位置覆盖掉。
  const savedLocation = overview
    ? backupLocationFromOverview(overview)
    : { kind: LOCATION_LOCAL, connectionId: '', path: '' }
  const savedLocationDisplay =
    savedLocation.kind === LOCATION_WEBDAV
      ? savedLocation.path
      : displayHostPath(savedLocation.path, useHostPaths)
  const savedLocationKey = `${savedLocation.kind}|${savedLocation.connectionId}|${savedLocationDisplay}`
  const syncedLocation = useRef('')
  useEffect(() => {
    if (!overview) return
    if (syncedLocation.current === savedLocationKey) return
    syncedLocation.current = savedLocationKey
    setLocationKind(savedLocation.kind)
    setConnectionId(savedLocation.connectionId)
    setPathInput(savedLocationDisplay)
  }, [
    overview,
    savedLocation.kind,
    savedLocation.connectionId,
    savedLocationDisplay,
    savedLocationKey,
  ])

  const passwordSet = Boolean(overview?.password_set)
  const files = Array.isArray(overview?.files) ? overview.files : []
  const pending = pendingRestoreNotice(overview?.pending_restore)
  const lastRestore = lastRestoreNotice(overview?.last_restore)
  const filesError = String(overview?.files_error || '')
  const currentBackupPath = String(overview?.backup_path || '')
  const currentConnectionId = Number(overview?.backup_connection_id) || 0
  const remoteLocation = locationKind === LOCATION_WEBDAV
  const nextConnectionId = remoteLocation ? Number(connectionId) || 0 : 0
  const nextBackupPath = remoteLocation ? pathInput.trim() : apiHostPath(pathInput, useHostPaths)
  const settingsUnchanged =
    nextBackupPath === currentBackupPath &&
    nextConnectionId === currentConnectionId &&
    !passwordInput &&
    !clearPassword
  const working = backingUp || restoringName !== '' || deletingName !== ''
  const candidates = backupLocationCandidates(directories, connections)

  const syncOverview = (data) => {
    setOverview(data)
  }

  const selectLocation = (kind) => {
    setLocationKind(kind)
    setSettingsError('')
    setSettingsMessage('')
  }

  const applyCandidate = (option) => {
    setLocationKind(option.kind)
    setConnectionId(option.connectionId)
    setPathInput(
      option.kind === LOCATION_WEBDAV ? option.path : displayHostPath(option.path, useHostPaths)
    )
    setSettingsError('')
    setSettingsMessage('')
  }

  const handleSaveSettings = async () => {
    setSettingsError('')
    setSettingsMessage('')
    if (remoteLocation && nextConnectionId <= 0) {
      setSettingsError(
        zh('请选择备份要写入的 WebDAV 连接', 'Choose the WebDAV connection to store backups in')
      )
      return
    }
    setSavingSettings(true)
    try {
      const data = await updateBackupSettings(
        buildBackupSettingsPayload({
          backupPath: nextBackupPath,
          connectionId: nextConnectionId,
          password: passwordInput,
          clearPassword,
        })
      )
      syncOverview(data)
      setPasswordInput('')
      setClearPassword(false)
      setSettingsMessage(zh('备份设置已保存', 'Backup settings saved'))
    } catch (err) {
      setSettingsError(getErrorMessage(err))
    } finally {
      setSavingSettings(false)
    }
  }

  const handleClearPassword = () => {
    const message = zh(
      '确定清除压缩密码吗？之后新建的备份将不再加密，已加密的旧备份仍然需要原来的密码。',
      'Clear the archive password? New backups will not be encrypted, and existing encrypted backups still need the old password.'
    )
    if (!window.confirm(message)) return
    setPasswordInput('')
    setClearPassword(true)
    setSettingsError('')
    setSettingsMessage('')
  }

  const handleRunBackup = async () => {
    setActionError('')
    setSettingsMessage('')
    setBackingUp(true)
    try {
      const data = await runBackup()
      syncOverview(data)
      onToast?.(zh('备份已完成', 'Backup finished'))
    } catch (err) {
      setActionError(getErrorMessage(err))
    } finally {
      setBackingUp(false)
    }
  }

  const performRestore = async (name, password) => {
    setActionError('')
    setRestoringName(name)
    try {
      const data = await restoreBackup(name, password)
      syncOverview(data)
      onToast?.(
        zh('恢复已就绪，重启 JavBoss 后生效', 'Restore staged — restart JavBoss to apply it'),
        4000
      )
      return true
    } catch (err) {
      setActionError(getErrorMessage(err))
      return false
    } finally {
      setRestoringName('')
    }
  }

  const handleRestore = (name) => {
    // 没保存密码时备份文件可能是加密的，先问一次本次使用的密码，避免死路。
    if (!passwordSet) {
      setActionError('')
      setRestorePassword('')
      setRestoreTarget(name)
      return
    }
    performRestore(name, '')
  }

  const handleSubmitRestore = async (event) => {
    event.preventDefault()
    if (!restoreTarget) return
    const ok = await performRestore(restoreTarget, restorePassword)
    if (ok) {
      setRestoreTarget(null)
      setRestorePassword('')
    }
  }

  const closeRestoreDialog = () => {
    if (restoringName !== '') return
    setRestoreTarget(null)
    setRestorePassword('')
  }

  const handleDelete = async (name) => {
    const message = zh(
      `确定删除备份文件“${name}”吗？只会删除备份保存路径里的这个文件，不会影响当前数据。`,
      `Delete the backup file "${name}"? Only this file inside the backup directory is removed; current data is untouched.`
    )
    if (!window.confirm(message)) return
    setActionError('')
    setDeletingName(name)
    try {
      const data = await deleteBackupFile(name)
      syncOverview(data)
      onToast?.(zh('已删除备份文件', 'Backup file deleted'))
    } catch (err) {
      setActionError(getErrorMessage(err))
    } finally {
      setDeletingName('')
    }
  }

  const handleAcknowledge = async () => {
    setActionError('')
    setAcknowledging(true)
    try {
      const data = await acknowledgeBackupRestore()
      syncOverview(data)
    } catch (err) {
      setActionError(getErrorMessage(err))
    } finally {
      setAcknowledging(false)
    }
  }

  const pathMissing = currentConnectionId <= 0 && currentBackupPath.trim() === ''

  return (
    <div className="space-y-5">
      {pending ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-semibold">{pending.title}</p>
          <p className="mt-1 break-all">{pending.detail}</p>
        </div>
      ) : null}

      {lastRestore ? (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            lastRestore.failed
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold">{lastRestore.title}</p>
              <p className="mt-1 break-all">{lastRestore.detail}</p>
              {lastRestore.missingDirectories.length ? (
                <div className="mt-2">
                  <p>{lastRestore.missingNote}</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 font-mono text-xs">
                    {lastRestore.missingDirectories.map((dir) => (
                      <li key={dir} className="break-all">
                        {dir}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={handleAcknowledge}
              disabled={acknowledging}
              className="shrink-0 rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
            >
              {acknowledging ? zh('处理中…', 'Working...') : zh('知道了', 'Got it')}
            </button>
          </div>
        </div>
      ) : null}

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-semibold text-zinc-800">
              {zh('备份保存位置', 'Backup Location')}
            </h4>
            <p className="mt-1 text-sm text-zinc-500">
              {zh(
                '备份会把服务器上的 data 目录（数据库、封面、截图、字幕等）打包成加密 zip，保存到这个位置。可以选本机目录，也可以选 WebDAV 连接的远程目录（等于把备份存到网盘上）。',
                'A backup packs the server data directory (database, covers, screenshots, subtitles) into an encrypted zip at this location. It can be a local folder or a folder on a WebDAV connection (which stores the backup on your cloud drive).'
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            {[
              { kind: LOCATION_LOCAL, label: zh('本机目录', 'Local folder') },
              { kind: LOCATION_WEBDAV, label: zh('WebDAV 远程目录', 'WebDAV folder') },
            ].map((option) => (
              <label
                key={option.kind}
                className={`flex cursor-pointer items-center gap-2 rounded border px-3 py-1.5 ${
                  locationKind === option.kind
                    ? 'border-blue-400 bg-blue-50 text-blue-800'
                    : 'text-zinc-600 hover:bg-zinc-50'
                }`}
              >
                <input
                  type="radio"
                  name="backup-location-kind"
                  value={option.kind}
                  checked={locationKind === option.kind}
                  onChange={() => selectLocation(option.kind)}
                  disabled={working || savingSettings}
                />
                {option.label}
              </label>
            ))}
          </div>

          {remoteLocation ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <label htmlFor="backup-connection" className="sr-only">
                  {zh('WebDAV 连接', 'WebDAV connection')}
                </label>
                <select
                  id="backup-connection"
                  value={connectionId}
                  onChange={(event) => {
                    setConnectionId(event.target.value)
                    setSettingsError('')
                    setSettingsMessage('')
                  }}
                  disabled={working || savingSettings}
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm sm:min-w-[240px] sm:flex-none"
                >
                  <option value="">{zh('请选择 WebDAV 连接', 'Choose a WebDAV connection')}</option>
                  {connections.map((connection) => (
                    <option key={connection.id} value={String(connection.id)}>
                      {String(connection.name || '').trim() || `WebDAV #${connection.id}`}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  value={pathInput}
                  onChange={(event) => {
                    setPathInput(event.target.value)
                    setSettingsError('')
                    setSettingsMessage('')
                  }}
                  placeholder={zh(
                    '输入远程目录路径，例如 /JAV/HD',
                    'Enter a remote folder path, e.g. /JAV/HD'
                  )}
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm sm:flex-1"
                />
                {directoryPickerEnabled ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSettingsError('')
                      setSettingsMessage('')
                      setPickerOpen(true)
                    }}
                    disabled={working || savingSettings || nextConnectionId <= 0}
                    className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
                  >
                    {zh('选择远程目录', 'Choose remote folder')}
                  </button>
                ) : null}
              </div>
              {connections.length === 0 ? (
                <div className="text-xs text-amber-600">
                  {zh(
                    '还没有 WebDAV 连接，请先到「目录管理」里新建连接。',
                    'No WebDAV connections yet. Create one under Directories first.'
                  )}
                </div>
              ) : (
                <div className="text-xs text-zinc-500">
                  {zh(
                    '远程目录必须是已存在且可写的目录，否则保存会被拒绝（很多网盘的 WebDAV 是只读挂载）。',
                    'The remote folder must already exist and be writable, otherwise saving is rejected (many cloud drives mount WebDAV read-only).'
                  )}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  value={pathInput}
                  onChange={(event) => {
                    setPathInput(event.target.value)
                    setSettingsError('')
                    setSettingsMessage('')
                  }}
                  placeholder={zh(
                    '输入服务器上的完整目录路径',
                    'Enter the full folder path on the server'
                  )}
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm sm:flex-1"
                />
                {directoryPickerEnabled ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSettingsError('')
                      setSettingsMessage('')
                      setPickerOpen(true)
                    }}
                    disabled={working || savingSettings}
                    className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
                  >
                    {zh('选择目录', 'Choose directory')}
                  </button>
                ) : null}
              </div>
              <div className="flex items-start gap-1.5 text-xs text-zinc-500">
                <InfoOutlinedIcon
                  fontSize="inherit"
                  className="mt-0.5 text-[13px]"
                  aria-hidden="true"
                />
                <span>
                  {directoryPickerEnabled
                    ? zh(
                        '必须是服务器上已存在的目录，否则保存会被拒绝。',
                        'The folder must already exist on the server, otherwise saving is rejected.'
                      )
                    : zh(
                        '当前环境不支持浏览目录，请输入服务器上已存在的绝对路径。',
                        'Browsing folders is unavailable here. Enter an absolute path that exists on the server.'
                      )}
                </span>
              </div>
            </>
          )}

          {candidates.length ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-zinc-500">
                {zh('已添加的扫描目录：', 'Added scan directories:')}
              </span>
              {candidates.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => applyCandidate(option)}
                  disabled={working || savingSettings}
                  title={option.detail ? `${option.label} · ${option.detail}` : option.label}
                  className="max-w-full truncate rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
                >
                  {option.detail ? `${option.label} · ${option.detail}` : option.label}
                </button>
              ))}
            </div>
          ) : null}

          <div className="text-xs text-zinc-500">
            {zh('当前保存位置：', 'Current location: ')}
            {currentConnectionId > 0
              ? `${
                  String(overview?.backup_connection_name || '').trim() ||
                  `WebDAV #${currentConnectionId}`
                } · ${currentBackupPath}`
              : displayHostPath(currentBackupPath, useHostPaths) || zh('未设置', 'Not set')}
          </div>

          <div className="border-t border-zinc-100 pt-4">
            <h4 className="text-sm font-semibold text-zinc-800">
              {zh('压缩密码', 'Archive Password')}
            </h4>
            <p className="mt-1 text-sm text-zinc-500">
              {zh(
                '设置后，备份文件会加密保存，恢复时需要同一个密码。留空表示不修改现有密码。',
                'When set, backups are encrypted and restoring needs the same password. Leave it empty to keep the current password.'
              )}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                type="password"
                autoComplete="new-password"
                value={passwordInput}
                onChange={(event) => {
                  setPasswordInput(event.target.value)
                  setClearPassword(false)
                  setSettingsError('')
                  setSettingsMessage('')
                }}
                placeholder={
                  passwordSet
                    ? zh('留空表示不修改', 'Leave empty to keep it')
                    : zh('留空表示不设置密码', 'Leave empty for no password')
                }
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm sm:w-64"
              />
              <span className="text-xs text-zinc-500">
                {passwordSet
                  ? zh('当前已设置压缩密码', 'A password is currently set')
                  : zh('当前未设置压缩密码', 'No password is set')}
              </span>
              <button
                type="button"
                onClick={handleClearPassword}
                disabled={!passwordSet || clearPassword || savingSettings}
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
              >
                {zh('清除密码', 'Clear password')}
              </button>
            </div>
            {clearPassword ? (
              <div className="mt-2 text-xs text-amber-600">
                {zh('保存后将清除压缩密码。', 'Saving now clears the archive password.')}
              </div>
            ) : null}
          </div>

          {settingsError ? <div className="text-sm text-red-600">{settingsError}</div> : null}
          {settingsMessage ? (
            <div className="text-sm text-emerald-600">{settingsMessage}</div>
          ) : null}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleSaveSettings}
              disabled={savingSettings || settingsUnchanged}
              className="rounded-xl bg-blue-600 px-3 py-1.5 text-sm text-white disabled:opacity-60"
            >
              {savingSettings ? zh('保存中…', 'Saving...') : zh('保存', 'Save')}
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-zinc-800">{zh('立即备份', 'Back Up Now')}</h4>
            <p className="mt-1 max-w-2xl text-sm text-zinc-500">
              {zh(
                '压缩整个 data 目录并保存到备份位置，文件名形如 javboss-backup-20260923-201500.zip。',
                'Packs the whole data directory into the backup location, named like javboss-backup-20260923-201500.zip.'
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={handleRunBackup}
            disabled={working || savingSettings || pathMissing}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {backingUp ? zh('备份中…', 'Backing up...') : zh('备份', 'Back up')}
          </button>
        </div>
        {pathMissing ? (
          <div className="mt-3 text-xs text-amber-600">
            {zh('请先设置并保存备份保存位置。', 'Set and save the backup location first.')}
          </div>
        ) : null}
      </section>

      {actionError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </div>
      ) : null}

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="space-y-3">
          <div>
            <h4 className="text-sm font-semibold text-zinc-800">
              {zh('备份文件', 'Backup Files')}
            </h4>
            <p className="mt-1 text-sm text-zinc-500">
              {zh(
                '恢复只是把备份解压到暂存目录，必须重启 JavBoss 才会覆盖当前数据。列表里的恢复与删除只作用于备份保存路径里的文件。',
                'Restoring only unpacks the backup into a staging folder; the current data is replaced after JavBoss restarts. Restore and delete here only touch files inside the backup directory.'
              )}
            </p>
          </div>

          {loading ? (
            <div className="text-sm text-zinc-500">{zh('读取中…', 'Loading...')}</div>
          ) : null}

          {loadError ? (
            <div className="space-y-2">
              <div className="text-sm text-red-600">{loadError}</div>
              <button
                type="button"
                onClick={() => setReloadToken((token) => token + 1)}
                className="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
              >
                {zh('重试', 'Retry')}
              </button>
            </div>
          ) : null}

          {!loading && !loadError && filesError ? (
            <div className="space-y-2">
              <div className="text-sm text-amber-600">
                {zh('读取备份文件列表失败：', 'Failed to read the backup file list: ')}
                {filesError}
              </div>
              <button
                type="button"
                onClick={() => setReloadToken((token) => token + 1)}
                className="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
              >
                {zh('重试', 'Retry')}
              </button>
            </div>
          ) : null}

          {!loading && !loadError && !filesError && files.length === 0 ? (
            <div className="text-sm text-zinc-500">
              {zh('还没有备份文件', 'No backup files yet')}
            </div>
          ) : null}

          {files.length ? (
            <ul className="divide-y divide-zinc-100">
              {files.map((file) => {
                const item = describeBackupFile(file)
                const restoring = restoringName === item.name
                const deleting = deletingName === item.name
                return (
                  <li
                    key={item.name}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-zinc-800" title={item.name}>
                        {item.name}
                      </div>
                      <div className="mt-0.5 text-xs text-zinc-500">{item.metaText || '—'}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleRestore(item.name)}
                        disabled={working || savingSettings}
                        className="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
                      >
                        {restoring ? zh('恢复中…', 'Restoring...') : zh('恢复', 'Restore')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(item.name)}
                        disabled={working || savingSettings}
                        className="rounded-xl border border-red-200 bg-white px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-60"
                      >
                        {deleting ? zh('删除中…', 'Deleting...') : zh('删除', 'Delete')}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      </section>

      {pickerOpen ? (
        <DirectoryPickerModal
          initialPath={remoteLocation ? pathInput.trim() : currentBackupPath}
          remoteHint={
            remoteLocation
              ? zh(
                  '备份会写到这个 WebDAV 目录里，请选择可写的目录。',
                  'Backups are written into this WebDAV folder, so pick a writable one.'
                )
              : ''
          }
          storageConnectionId={remoteLocation ? connectionId : null}
          onClose={() => setPickerOpen(false)}
          onSelect={(selectedPath) => {
            setPathInput(
              remoteLocation
                ? String(selectedPath || '')
                : displayHostPath(selectedPath, useHostPaths)
            )
            setSettingsError('')
            setSettingsMessage('')
            setPickerOpen(false)
          }}
        />
      ) : null}

      {restoreTarget ? (
        <AppModal
          ariaLabelledby="backup-restore-title"
          className="px-4"
          closeDisabled={restoringName !== ''}
          contentClassName="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl"
          contentComponent="form"
          contentProps={{ onSubmit: handleSubmitRestore }}
          onClose={closeRestoreDialog}
          zIndex={1400}
        >
          <h3 id="backup-restore-title" className="text-lg font-semibold text-zinc-900">
            {zh('输入本次恢复的密码', 'Enter the password for this restore')}
          </h3>
          <p className="mt-2 text-sm text-zinc-500">
            {zh(
              '当前没有保存压缩密码。如果这个备份文件是加密的，请输入当初备份时使用的密码；未加密的备份可以留空。',
              'No archive password is saved. If this backup file is encrypted, enter the password used when it was created; leave it empty for unencrypted backups.'
            )}
          </p>
          <p className="mt-2 break-all text-xs text-zinc-500">{restoreTarget}</p>

          <label
            htmlFor="backup-restore-password"
            className="mt-4 block text-sm font-medium text-zinc-700"
          >
            {zh('压缩密码', 'Archive password')}
          </label>
          <input
            id="backup-restore-password"
            type="password"
            autoComplete="off"
            value={restorePassword}
            onChange={(event) => setRestorePassword(event.target.value)}
            className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />

          {actionError ? <div className="mt-3 text-sm text-red-600">{actionError}</div> : null}

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={closeRestoreDialog}
              disabled={restoringName !== ''}
              className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            >
              {zh('取消', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={restoringName !== ''}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {restoringName !== '' ? zh('恢复中…', 'Restoring...') : zh('确认恢复', 'Restore')}
            </button>
          </div>
        </AppModal>
      ) : null}
    </div>
  )
}
