import { useEffect, useRef, useState } from 'react'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'

import AppModal from '@/components/AppModal'
import DirectoryPickerModal from '@/components/DirectoryPickerModal'
import {
  acknowledgeUpdate,
  applyUpdate,
  downloadUpdate,
  fetchDirectories,
  fetchStorageConnections,
  fetchUpdateOverview,
  updateUpdateSettings,
} from '@/api'
import { useStore } from '@/store'
import { backupLocationCandidates } from '@/utils/backup'
import { getErrorMessage } from '@/utils/errors'
import { apiHostPath, displayHostPath, hostPathsEnabled } from '@/utils/hostPath'
import { zh } from '@/utils/i18n'
import {
  buildUpdateSettingsPayload,
  describeUpdatePackage,
  describeUpdatePlatform,
  lastUpdateNotice,
  pendingUpdateNotice,
  updateLocationFromOverview,
} from '@/utils/update'

const LOCATION_LOCAL = 'local'
const LOCATION_WEBDAV = 'webdav'

/**
 * 设置里的「程序更新」面板。
 *
 * 发布包由用户手动上传到一个位置（本机目录或 WebDAV 远程目录），这里只做三件事：
 * 列出发布包、选定位置、执行更新。更新会用发布包里的文件覆盖程序目录，
 * 但 data 目录坚决不动、config.toml 保留本机版本，且必须重启 JavBoss 才生效。
 */
export default function UpdateSettingsPanel({ onToast, directoryPickerEnabled = true }) {
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
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsError, setSettingsError] = useState('')
  const [settingsMessage, setSettingsMessage] = useState('')
  const [applyingName, setApplyingName] = useState('')
  const [downloadingName, setDownloadingName] = useState('')
  const [acknowledging, setAcknowledging] = useState(false)
  const [actionError, setActionError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [confirmTarget, setConfirmTarget] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError('')
    fetchUpdateOverview()
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

  // 扫描目录用来一键填位置：发布包和视频放在一起、或者放在同一个网盘上都很常见。
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

  // 只在服务端保存的位置真的变了的时候回填表单，避免每次动作回来都覆盖用户正在输入的内容。
  const savedLocation = overview
    ? updateLocationFromOverview(overview)
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

  const packages = Array.isArray(overview?.packages) ? overview.packages : []
  const pending = pendingUpdateNotice(overview?.pending)
  const lastUpdate = lastUpdateNotice(overview?.last_update)
  const packagesError = String(overview?.packages_error || '')
  const currentUpdatePath = String(overview?.update_path || '')
  const currentConnectionId = Number(overview?.update_connection_id) || 0
  const remoteLocation = locationKind === LOCATION_WEBDAV
  const nextConnectionId = remoteLocation ? Number(connectionId) || 0 : 0
  const nextUpdatePath = remoteLocation ? pathInput.trim() : apiHostPath(pathInput, useHostPaths)
  const settingsUnchanged =
    nextUpdatePath === currentUpdatePath && nextConnectionId === currentConnectionId
  const platformText =
    describeUpdatePlatform(overview?.platform) || String(overview?.platform || '')
  const programDir = String(overview?.program_dir || '')
  const working = applyingName !== '' || downloadingName !== ''
  const candidates = backupLocationCandidates(directories, connections)
  const currentLocationText =
    currentConnectionId > 0
      ? `${
          String(overview?.update_connection_name || '').trim() || `WebDAV #${currentConnectionId}`
        } · ${currentUpdatePath}`
      : displayHostPath(currentUpdatePath, useHostPaths) || zh('未设置', 'Not set')

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
        zh('请选择发布包所在的 WebDAV 连接', 'Choose the WebDAV connection holding the packages')
      )
      return
    }
    setSavingSettings(true)
    try {
      const data = await updateUpdateSettings(
        buildUpdateSettingsPayload({
          updatePath: nextUpdatePath,
          connectionId: nextConnectionId,
        })
      )
      syncOverview(data)
      setSettingsMessage(zh('更新设置已保存', 'Update settings saved'))
    } catch (err) {
      setSettingsError(getErrorMessage(err))
    } finally {
      setSavingSettings(false)
    }
  }

  const performApply = async (name) => {
    setActionError('')
    setActionMessage('')
    setApplyingName(name)
    try {
      const data = await applyUpdate(name)
      syncOverview(data)
      // Windows 上替换由 helper 在程序退出后进行，此时暂存标记还在，程序马上会自己退出。
      const deferred = Boolean(data?.pending) || Boolean(data?.last_update?.deferred)
      setActionMessage(
        deferred
          ? zh(
              '更新已交给后台完成，JavBoss 即将退出，请稍后重新启动。',
              'The update continues in the background. JavBoss will exit shortly — start it again in a moment.'
            )
          : zh(
              '更新已应用到程序目录，请重启 JavBoss 生效。',
              'The update was written to the program directory. Restart JavBoss to apply it.'
            )
      )
      onToast?.(
        zh('更新已应用，请重启 JavBoss', 'Update applied — restart JavBoss'),
        deferred ? 8000 : 5000
      )
      return false
    } catch (err) {
      setActionError(getErrorMessage(err))
      return true
    } finally {
      setApplyingName('')
    }
  }

  const handleApply = (name) => {
    setActionError('')
    setActionMessage('')
    setConfirmTarget(name)
  }

  const handleSubmitApply = async (event) => {
    event.preventDefault()
    if (!confirmTarget) return
    const keepOpen = await performApply(confirmTarget)
    if (!keepOpen) setConfirmTarget(null)
  }

  const closeConfirm = () => {
    if (applyingName !== '') return
    setConfirmTarget(null)
  }

  // 只把发布包取到服务器本机，方便更新失败时手动解压覆盖。
  const handleDownload = async (name) => {
    setActionError('')
    setActionMessage('')
    setDownloadingName(name)
    try {
      const data = await downloadUpdate(name)
      setActionMessage(
        zh(
          `发布包已保存到服务器：${data.path}\n可以手动解压这个文件，把里面的文件覆盖到程序目录（不要动 data 目录与 config.toml）。`,
          `Package saved on the server: ${data.path}\nUnpack it and copy the files into the program directory (leave the data directory and config.toml alone).`
        )
      )
      onToast?.(zh('发布包已下载到服务器', 'Package downloaded on the server'))
    } catch (err) {
      setActionError(getErrorMessage(err))
    } finally {
      setDownloadingName('')
    }
  }

  const handleAcknowledge = async () => {
    setActionError('')
    setAcknowledging(true)
    try {
      const data = await acknowledgeUpdate()
      syncOverview(data)
    } catch (err) {
      setActionError(getErrorMessage(err))
    } finally {
      setAcknowledging(false)
    }
  }

  return (
    <div className="space-y-5">
      {pending ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-semibold">{pending.title}</p>
          <p className="mt-1 break-all">{pending.detail}</p>
        </div>
      ) : null}

      {lastUpdate ? (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            lastUpdate.failed
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold">{lastUpdate.title}</p>
              <p className="mt-1 break-all">{lastUpdate.detail}</p>
              {lastUpdate.restartNeeded ? (
                <p className="mt-1">
                  {zh(
                    '重启 JavBoss 之后新的程序文件才会被加载。',
                    'The new program files are loaded only after JavBoss restarts.'
                  )}
                </p>
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
              {zh('发布包位置', 'Update Package Location')}
            </h4>
            <p className="mt-1 text-sm text-zinc-500">
              {zh(
                '把发布包（javboss-<版本>-<平台>.zip / .tar.gz）上传到一个目录，这里只读这个目录并列出可用的发布包。可以选本机目录，也可以选 WebDAV 连接的远程目录。',
                'Upload release packages (javboss-<version>-<platform>.zip / .tar.gz) to a folder; this reads the folder and lists the available packages. It can be a local folder or a folder on a WebDAV connection.'
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
                  name="update-location-kind"
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
                <label htmlFor="update-connection" className="sr-only">
                  {zh('WebDAV 连接', 'WebDAV connection')}
                </label>
                <select
                  id="update-connection"
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
                    '输入远程目录路径，例如 /javboss/releases',
                    'Enter a remote folder path, e.g. /javboss/releases'
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
                    '远程目录必须是已存在且可读的目录。发布包位置只读，网盘的只读挂载也可以。',
                    'The remote folder must already exist and be readable. The location is read-only, so read-only cloud drive mounts work too.'
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

          <div className="space-y-0.5 text-xs text-zinc-500">
            <div>
              {zh('当前发布包位置：', 'Current location: ')}
              {currentLocationText}
            </div>
            <div>
              {zh('当前程序平台：', 'Current platform: ')}
              {platformText || '—'}
            </div>
            <div className="break-all">
              {zh('更新会覆盖的程序目录：', 'Program directory that updates replace: ')}
              {displayHostPath(programDir, useHostPaths) || '—'}
            </div>
            <div>
              {zh(
                '更新不会改动 data 目录，也不会用包里的 config.toml 覆盖本机配置。',
                'Updates never touch the data directory, and the packaged config.toml never replaces your local one.'
              )}
            </div>
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

      {actionError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </div>
      ) : null}

      {actionMessage ? (
        <div className="whitespace-pre-line break-all rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {actionMessage}
        </div>
      ) : null}

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="space-y-3">
          <div>
            <h4 className="text-sm font-semibold text-zinc-800">{zh('发布包', 'Packages')}</h4>
            <p className="mt-1 text-sm text-zinc-500">
              {zh(
                '更新会立刻用包里的文件覆盖程序目录（data 目录与 config.toml 除外）。Windows 上 JavBoss 会在替换完成后自动退出，需要重新启动；Linux/Termux 需要手动重启。',
                'Updating immediately replaces the program files with the ones inside the package (except the data directory and config.toml). On Windows JavBoss exits after the replacement and must be started again; on Linux/Termux restart it manually.'
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

          {!loading && !loadError && packagesError ? (
            <div className="space-y-2">
              <div className="text-sm text-amber-600">
                {zh('读取发布包列表失败：', 'Failed to read the package list: ')}
                {packagesError}
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

          {!loading && !loadError && !packagesError && packages.length === 0 ? (
            <div className="text-sm text-zinc-500">
              {zh(
                '这个位置里还没有可用的发布包',
                'No usable release packages in this location yet'
              )}
            </div>
          ) : null}

          {packages.length ? (
            <ul className="divide-y divide-zinc-100">
              {packages.map((pkg) => {
                const item = describeUpdatePackage(pkg)
                const applying = applyingName === item.name
                const platformName = describeUpdatePlatform(item.platform)
                const unknownPlatform = item.platform === ''
                return (
                  <li
                    key={item.name}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-zinc-800" title={item.name}>
                        {item.name}
                      </div>
                      <div className="mt-0.5 text-xs text-zinc-500">
                        {[platformName, item.metaText].filter(Boolean).join(' · ')}
                      </div>
                      {unknownPlatform ? (
                        <div className="mt-0.5 text-xs text-amber-600">
                          {zh(
                            '文件名里没有平台标识，无法判断能否在本机运行。',
                            'The file name has no platform tag, so compatibility cannot be verified.'
                          )}
                        </div>
                      ) : null}
                      {!item.compatible && !unknownPlatform ? (
                        <div className="mt-0.5 text-xs text-amber-600">
                          {zh(
                            '这个包不是给当前平台用的，不能用本机更新。',
                            'This package targets another platform and cannot update this machine.'
                          )}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleDownload(item.name)}
                        disabled={working || savingSettings}
                        title={zh(
                          '只下载到服务器，不覆盖程序目录',
                          'Download to the server without replacing anything'
                        )}
                        className="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
                      >
                        {downloadingName === item.name
                          ? zh('下载中…', 'Downloading...')
                          : zh('下载', 'Download')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApply(item.name)}
                        disabled={working || savingSettings || !item.compatible}
                        className="rounded-xl bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-60"
                      >
                        {applying
                          ? zh('更新中…', 'Updating...')
                          : zh('更新到该版本', 'Update to this build')}
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
          initialPath={remoteLocation ? pathInput.trim() : currentUpdatePath}
          remoteHint={
            remoteLocation
              ? zh(
                  '请选择存放发布包的 WebDAV 目录，只读挂载也可以。',
                  'Pick the WebDAV folder holding the release packages; a read-only mount is fine.'
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

      {confirmTarget ? (
        <AppModal
          ariaLabelledby="update-confirm-title"
          className="px-4"
          closeDisabled={applyingName !== ''}
          contentClassName="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl"
          contentComponent="form"
          contentProps={{ onSubmit: handleSubmitApply }}
          onClose={closeConfirm}
          zIndex={1400}
        >
          <h3 id="update-confirm-title" className="text-lg font-semibold text-zinc-900">
            {zh('确认更新到该发布包？', 'Update to this package?')}
          </h3>
          <p className="mt-2 text-sm text-zinc-500">
            {zh(
              '会立刻用发布包里的文件覆盖程序目录，正在运行的 JavBoss 需要重启才会加载新版本。data 目录与 config.toml 不会被改动。',
              'The program directory is immediately overwritten with the files inside the package, and the running JavBoss must be restarted to load the new version. The data directory and config.toml are left untouched.'
            )}
          </p>
          <p className="mt-2 break-all text-xs text-zinc-500">{confirmTarget}</p>

          {actionError ? <div className="mt-3 text-sm text-red-600">{actionError}</div> : null}

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={closeConfirm}
              disabled={applyingName !== ''}
              className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
            >
              {zh('取消', 'Cancel')}
            </button>
            <button
              type="submit"
              disabled={applyingName !== ''}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {applyingName !== '' ? zh('更新中…', 'Updating...') : zh('确认更新', 'Update')}
            </button>
          </div>
        </AppModal>
      ) : null}
    </div>
  )
}
