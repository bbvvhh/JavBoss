import { zh } from '@/utils/i18n'
import { formatBackupSize, formatBackupTime } from '@/utils/backup'

const LOCATION_LOCAL = 'local'
const LOCATION_WEBDAV = 'webdav'

/** 从 GET /update 的返回推导「发布包位置」的编辑状态。 */
export function updateLocationFromOverview(overview) {
  const connectionId = Number(overview?.update_connection_id)
  const remote = Number.isFinite(connectionId) && connectionId > 0
  return {
    kind: remote ? LOCATION_WEBDAV : LOCATION_LOCAL,
    connectionId: remote ? String(connectionId) : '',
    path: String(overview?.update_path ?? ''),
  }
}

/**
 * 组装 PUT /update/settings 的请求体。
 *
 * 与备份设置同构：路径传了就必须下发，空字符串表示「取消已设置的目录」；
 * `connection_id` 与路径成对下发，正数表示发布包在该 WebDAV 连接的远程目录，0 表示本机目录，
 * 否则从远程切回本地时后端会把本机路径当成远程路径。
 */
export function buildUpdateSettingsPayload({ updatePath, connectionId } = {}) {
  const payload = {}
  if (updatePath !== undefined) payload.update_path = String(updatePath ?? '').trim()
  if (connectionId !== undefined) {
    const id = Number(connectionId)
    payload.connection_id = Number.isFinite(id) && id > 0 ? id : 0
  }
  return payload
}

/** 发布包列表项（GET /update 的 packages 元素）的展示文案。 */
export function describeUpdatePackage(pkg) {
  const name = String(pkg?.name ?? '')
  const timeText = formatBackupTime(pkg?.modified_at)
  const sizeText = formatBackupSize(pkg?.size)
  return {
    name,
    timeText,
    sizeText,
    // Platform 是文件名里的平台串；认不出来时为空，界面上要提示无法判断。
    platform: String(pkg?.platform ?? '').trim(),
    compatible: pkg?.compatible === true,
    metaText: [timeText, sizeText].filter(Boolean).join(' · ') || '—',
  }
}

/** 平台串 → 人类可读名称；认不出来时原样返回（空串就是空串）。 */
export function describeUpdatePlatform(platform) {
  const raw = String(platform ?? '').trim()
  switch (raw) {
    case 'windows-x86_64':
      return zh('Windows 64 位', 'Windows 64-bit')
    case 'linux-x86_64':
      return zh('Linux 64 位', 'Linux 64-bit')
    case 'linux-arm64':
      return zh('Linux ARM64', 'Linux ARM64')
    case 'linux-arm64-proot':
      return zh('Linux ARM64（Termux/proot）', 'Linux ARM64 (Termux/proot)')
    case 'macos-x86_64':
      return zh('macOS Intel', 'macOS Intel')
    case 'macos-arm64':
      return zh('macOS Apple 芯片', 'macOS Apple silicon')
    default:
      return raw
  }
}

/**
 * 待落地更新的提示；没有时返回 null。
 *
 * 正常情况下解压与替换在同一次请求里完成，只有替换交给外部 helper 接手
 * （Windows 上进程退出后替换，或者进程在替换中途被杀）时才会短暂或异常地停在这个状态。
 */
export function pendingUpdateNotice(pending) {
  const fileName = String(pending?.file_name ?? '').trim()
  if (!fileName) return null
  const fileCount = Number(pending?.file_count) || 0
  const sizeText = formatBackupSize(pending?.total_size)
  return {
    fileName,
    fileCount,
    sizeText,
    title: zh('正在覆盖程序文件', 'Replacing program files'),
    detail: zh(
      `发布包 ${fileName} 已解压（${fileCount} 个文件，${sizeText}），正在写到程序目录。如果长时间停在这里，重启 JavBoss 会自动回滚到原版本并给出结论。`,
      `Package ${fileName} has been unpacked (${fileCount} file(s), ${sizeText}) and is being written into the program directory. If this state persists, restarting JavBoss rolls the program back and reports the outcome.`
    ),
  }
}

/**
 * 最近一次更新的结果提示。error 非空表示这次更新没完成（已经回滚到原版本）；
 * 否则是成功提示，并强调必须重启 JavBoss 才会生效。
 */
export function lastUpdateNotice(lastUpdate) {
  const fileName = String(lastUpdate?.file_name ?? '').trim()
  if (!fileName) return null
  const error = String(lastUpdate?.error ?? '').trim()
  const fileCount = Number(lastUpdate?.file_count) || 0
  const timeText = formatBackupTime(lastUpdate?.applied_at)
  if (error) {
    return {
      fileName,
      fileCount,
      timeText,
      failed: true,
      restartNeeded: false,
      title: zh('上次更新没有完成', 'The last update did not finish'),
      detail: zh(
        `发布包 ${fileName} 的更新没有完成：${error}`,
        `Updating from ${fileName} did not finish: ${error}`
      ),
    }
  }
  return {
    fileName,
    fileCount,
    timeText,
    failed: false,
    restartNeeded: lastUpdate?.restart_required !== false,
    title: zh('更新已应用，重启 JavBoss 后生效', 'Update applied — restart JavBoss to apply it'),
    detail: zh(
      `已用发布包 ${fileName} 覆盖 ${fileCount} 个程序文件${
        timeText ? `（${timeText}）` : ''
      }。data 目录与 config.toml 保持本机原样。`,
      `Replaced ${fileCount} program file(s) from ${fileName}${
        timeText ? ` at ${timeText}` : ''
      }. The data directory and config.toml were left untouched.`
    ),
  }
}
