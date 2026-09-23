/**
 * 备份与恢复的共享纯函数。
 *
 * 只放「可以脱离组件单独验证」的格式化 / 文案组装，网络与状态留在页面里。
 */
import { zh } from '@/utils/i18n'

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

/**
 * 人类可读体积，如 `12.3 MB`。
 *
 * 与「工具与日志」页的字节数格式保持一致：小于 10 保留 1 位小数，
 * 其余取整，避免出现 `1.177 MB` 这种读不出来的数字。
 */
export function formatBackupSize(bytes) {
  if (bytes === null || bytes === undefined || bytes === '') return ''
  const value = Number(bytes)
  if (!Number.isFinite(value) || value < 0) return ''
  let size = value
  let unit = 0
  while (size >= 1024 && unit < SIZE_UNITS.length - 1) {
    size /= 1024
    unit += 1
  }
  const digits = size >= 10 || unit === 0 ? 0 : 1
  return `${size.toFixed(digits)} ${SIZE_UNITS[unit]}`
}

/** 备份文件的时间戳，如 `2026-09-23 20:15`；无法解析时返回空字符串。 */
export function formatBackupTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

/** 恢复内容的摘要，如 `137 个文件 · 976 KB`；两项都缺失时返回空字符串。 */
export function summarizeRestoreContents({ fileCount, totalSize } = {}) {
  const parts = []
  const count = Number(fileCount)
  if (Number.isFinite(count) && count > 0) {
    parts.push(zh(`${count} 个文件`, `${count} files`))
  }
  const size = formatBackupSize(totalSize)
  if (size) parts.push(size)
  return parts.join(' · ')
}

const LOCATION_LOCAL = 'local'
const LOCATION_WEBDAV = 'webdav'

const normalizeRemotePath = (value) => {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  return raw.startsWith('/') ? raw : `/${raw}`
}

/** 从 `GET /backup` 的返回推导「备份保存位置」的编辑状态。 */
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
 * `pending_restore` 的提示文案（不含「重启后生效」那句，由页面补充）。
 * 没有待生效的恢复时返回空字符串。
 */
export function pendingRestoreText(pending) {
  if (!pending) return ''
  const stagedAt = formatBackupTime(pending.staged_at)
  return [
    String(pending.file_name || ''),
    summarizeRestoreContents({ fileCount: pending.file_count, totalSize: pending.total_size }),
    stagedAt ? zh(`暂存于 ${stagedAt}`, `Staged ${stagedAt}`) : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * `last_restore` 的提示条内容。
 *
 * 返回 `{ tone, title, missing }`：`tone` 决定提示条配色（error / warn / ok），
 * `missing` 是要逐条列出的、在本机不存在的视频目录。没有 `last_restore` 时返回 null。
 */
export function lastRestoreNotice(lastRestore) {
  if (!lastRestore) return null

  const error = String(lastRestore.error || '').trim()
  if (error) {
    return {
      tone: 'error',
      title: zh(`上次恢复失败：${error}`, `Last restore failed: ${error}`),
      missing: [],
    }
  }

  const missing = Array.isArray(lastRestore.missing_directories)
    ? lastRestore.missing_directories.map((item) => String(item)).filter(Boolean)
    : []
  if (missing.length) {
    return {
      tone: 'warn',
      title: zh(
        '上次恢复已完成，但下列视频目录在本机不存在；请重新添加或修正这些目录。',
        'Last restore finished, but these video directories are missing on this machine. Re-add or fix them.'
      ),
      missing,
    }
  }

  const name = String(lastRestore.file_name || '')
  const count = Number(lastRestore.file_count)
  const suffix =
    Number.isFinite(count) && count > 0 ? zh(`（${count} 个文件）`, ` (${count} files)`) : ''
  return {
    tone: 'ok',
    title: zh(`上次恢复已完成：${name}${suffix}`, `Last restore finished: ${name}${suffix}`),
    missing: [],
  }
}
