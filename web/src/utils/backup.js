import { zh } from '@/utils/i18n'

const SIZE_UNITS = ['KB', 'MB', 'GB', 'TB']

/** 备份体积（字节）→ 便于阅读的文本，例如 12.3 MB。 */
export function formatBackupSize(bytes) {
  if (bytes === null || bytes === undefined || bytes === '') return '—'
  const value = Number(bytes)
  if (!Number.isFinite(value) || value < 0) return '—'
  if (value < 1024) return `${Math.round(value)} B`
  let size = value / 1024
  let unit = 0
  while (size >= 1024 && unit < SIZE_UNITS.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size.toFixed(1)} ${SIZE_UNITS[unit]}`
}

/** 备份时间戳（RFC3339）→ 本地化文本；缺失或非法时返回空字符串。 */
export function formatBackupTime(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString()
}

/** 备份列表项（GET /backup 的 files 元素）的展示文案。 */
export function describeBackupFile(file) {
  const name = String(file?.name ?? '')
  const timeText = formatBackupTime(file?.modified_at)
  const sizeText = formatBackupSize(file?.size)
  return {
    name,
    timeText,
    sizeText,
    metaText: [timeText, sizeText].filter(Boolean).join(' · '),
  }
}

const LOCATION_LOCAL = 'local'
const LOCATION_WEBDAV = 'webdav'

const normalizeRemotePath = (value) => {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  return raw.startsWith('/') ? raw : `/${raw}`
}

/** 从 GET /backup 的返回推导「备份保存位置」的编辑状态。 */
export function backupLocationFromOverview(overview) {
  const connectionId = Number(overview?.backup_connection_id)
  const remote = Number.isFinite(connectionId) && connectionId > 0
  return {
    kind: remote ? LOCATION_WEBDAV : LOCATION_LOCAL,
    connectionId: remote ? String(connectionId) : '',
    path: String(overview?.backup_path ?? ''),
  }
}

/**
 * 已添加的扫描目录 → 备份保存位置的候选项。
 *
 * 备份允许和视频放在同一个目录里，WebDAV 扫描目录就等于把备份存到了网盘上，
 * 所以这里只把来源整理成可点的候选，不做「必须另选一个目录」的限制。
 * 返回 `{ key, kind, connectionId, path, label, detail }`，远程项带上连接名。
 */
export function backupLocationCandidates(directories, connections = []) {
  const nameById = new Map()
  for (const connection of Array.isArray(connections) ? connections : []) {
    const id = Number(connection?.id)
    if (Number.isFinite(id)) nameById.set(id, String(connection?.name ?? '').trim())
  }
  const options = []
  const seen = new Set()
  for (const directory of Array.isArray(directories) ? directories : []) {
    if (!directory || directory.is_delete) continue
    const remote =
      String(directory.kind ?? '')
        .trim()
        .toLowerCase() === LOCATION_WEBDAV
    const connectionId = Number(directory.connection_id)
    if (remote && !(Number.isFinite(connectionId) && connectionId > 0)) continue
    const path = remote
      ? normalizeRemotePath(directory.remote_path)
      : String(directory.path ?? '').trim()
    if (!path) continue
    const key = remote ? `${connectionId}|${path}` : path
    if (seen.has(key)) continue
    seen.add(key)
    options.push({
      key,
      kind: remote ? LOCATION_WEBDAV : LOCATION_LOCAL,
      connectionId: remote ? String(connectionId) : '',
      path,
      label: remote ? nameById.get(connectionId) || `WebDAV #${connectionId}` : path,
      detail: remote ? path : '',
    })
  }
  return options
}

/**
 * 组装 PUT /backup/settings 的请求体。
 *
 * 路径只要传了就一定下发：空字符串表示「取消已设置的备份路径」（后端按同样的语义处理），
 * 否则用户清空输入框再保存会变成一个静默无效的操作。
 * `connection_id` 同理：正数表示写到该 WebDAV 连接的远程目录，0 表示本机目录；
 * 两者必须一起下发，否则从远程切回本地时后端会把本机路径当成远程路径。
 * 密码字段留空表示「不修改」；要清空密码只能走 clear_password，
 * 所以 clear_password 优先于 password。
 */
export function buildBackupSettingsPayload({
  backupPath,
  connectionId,
  password,
  clearPassword = false,
} = {}) {
  const payload = {}
  if (backupPath !== undefined) payload.backup_path = String(backupPath ?? '').trim()
  if (connectionId !== undefined) {
    const id = Number(connectionId)
    payload.connection_id = Number.isFinite(id) && id > 0 ? id : 0
  }
  if (clearPassword) {
    payload.clear_password = true
  } else if (String(password ?? '') !== '') {
    payload.password = String(password)
  }
  return payload
}

/** 待生效恢复的提示文案；没有暂存的恢复时返回 null。 */
export function pendingRestoreNotice(pending) {
  const fileName = String(pending?.file_name ?? '').trim()
  if (!fileName) return null
  const fileCount = Number(pending?.file_count) || 0
  const sizeText = formatBackupSize(pending?.total_size)
  const timeText = formatBackupTime(pending?.staged_at)
  return {
    fileName,
    fileCount,
    sizeText,
    timeText,
    title: zh('恢复已就绪，重启 JavBoss 后生效', 'Restore ready — restart JavBoss to apply it'),
    detail: zh(
      `已从备份 ${fileName} 暂存 ${fileCount} 个文件（${sizeText}）${
        timeText ? `，暂存时间 ${timeText}` : ''
      }。只有重启 JavBoss 才会把这些数据覆盖到当前目录。`,
      `Staged ${fileCount} file(s) (${sizeText}) from ${fileName}${
        timeText ? ` at ${timeText}` : ''
      }. The current data is replaced only after JavBoss restarts.`
    ),
  }
}

/**
 * 最近一次恢复的结果提示。error 非空表示恢复失败；否则列出本机缺失的视频目录，
 * 提示这些路径不会被恢复过程改写。
 */
export function lastRestoreNotice(lastRestore) {
  const fileName = String(lastRestore?.file_name ?? '').trim()
  if (!fileName) return null
  const error = String(lastRestore?.error ?? '').trim()
  const missingDirectories = Array.isArray(lastRestore?.missing_directories)
    ? lastRestore.missing_directories.map((dir) => String(dir || '').trim()).filter(Boolean)
    : []
  if (error) {
    return {
      fileName,
      failed: true,
      title: zh('上次恢复失败', 'Last restore failed'),
      detail: zh(`备份 ${fileName} 恢复失败：${error}`, `Restoring ${fileName} failed: ${error}`),
      missingDirectories: [],
      missingNote: '',
    }
  }
  return {
    fileName,
    failed: false,
    title: zh('上次恢复已完成', 'Last restore finished'),
    detail: zh(`备份 ${fileName} 已应用。`, `Backup ${fileName} was applied.`),
    missingDirectories,
    missingNote: missingDirectories.length
      ? zh(
          '这些视频目录在本机不存在，恢复只覆盖数据、不会改写路径，请在本机重新添加或修正这些目录：',
          'These video directories do not exist on this machine. The restore only replaced data and did not rewrite paths, so add or fix them here:'
        )
      : '',
  }
}
