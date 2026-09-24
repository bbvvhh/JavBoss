/**
 * 程序更新的共享纯函数。
 *
 * 只放「可以脱离组件单独验证」的格式化 / 文案组装，网络与状态留在页面里。
 */
import { zh } from '@/utils/i18n'
import { formatBackupSize, formatBackupTime } from '@/utils/backup'

const LOCATION_LOCAL = 'local'
const LOCATION_WEBDAV = 'webdav'

/** 从 `GET /update` 的返回推导「发布包位置」的编辑状态。 */
export function updateLocationFromOverview(overview) {
  const connectionId = Number(overview?.update_connection_id)
  const remote = Number.isFinite(connectionId) && connectionId > 0
  return {
    kind: remote ? LOCATION_WEBDAV : LOCATION_LOCAL,
    connectionId: remote ? String(connectionId) : '',
    path: String(overview?.update_path ?? ''),
  }
}

/** 发布包内容的摘要，如 `12 个文件 · 976 KB`；两项都缺失时返回空字符串。 */
export function summarizePackageContents({ fileCount, totalSize } = {}) {
  const parts = []
  const count = Number(fileCount)
  if (Number.isFinite(count) && count > 0) {
    parts.push(zh(`${count} 个文件`, `${count} files`))
  }
  const size = formatBackupSize(totalSize)
  if (size) parts.push(size)
  return parts.join(' · ')
}

/** 待落地更新的提示文案。没有暂存更新时返回空字符串。 */
export function pendingUpdateText(pending) {
  if (!pending) return ''
  const fileName = String(pending.file_name || '')
  const contents = summarizePackageContents({
    fileCount: pending.file_count,
    totalSize: pending.total_size,
  })
  return [fileName, contents].filter(Boolean).join(' · ')
}

/**
 * 发布包列表项的展示文案。
 *
 * `platform` 是文件名里的平台串；`compatible` 只认布尔 true —— 缺字段时不能
 * 把包显示成「可更新」，否则用户点下去只会拿到一个后端错误。
 */
export function describeUpdatePackage(pkg) {
  const name = String(pkg?.name ?? '')
  const timeText = formatBackupTime(pkg?.modified_at)
  const sizeText = formatBackupSize(pkg?.size)
  return {
    name,
    timeText,
    sizeText,
    platform: String(pkg?.platform ?? '').trim(),
    compatible: pkg?.compatible === true,
    metaText: [timeText, sizeText].filter(Boolean).join(' · '),
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
 * `last_update` 的提示条内容。
 *
 * 返回 `{ tone, title, detail, restartNeeded }`：`tone` 决定配色（error / ok）；
 * `restartNeeded` 为真时页面要额外提示「重启 JavBoss 后生效」。没有结果时返回 null。
 */
export function lastUpdateNotice(lastUpdate) {
  if (!lastUpdate) return null

  const error = String(lastUpdate.error || '').trim()
  if (error) {
    return {
      tone: 'error',
      title: zh(`上次更新未完成：${error}`, `Last update did not finish: ${error}`),
      detail: '',
      restartNeeded: false,
    }
  }

  const name = String(lastUpdate.file_name || '')
  const count = Number(lastUpdate.file_count)
  const suffix =
    Number.isFinite(count) && count > 0 ? zh(`（${count} 个文件）`, ` (${count} files)`) : ''
  return {
    tone: 'ok',
    title: zh(`更新已写入程序目录${suffix}`, `Update written to the program directory${suffix}`),
    detail: zh(
      `已用发布包 ${name} 覆盖程序文件，data 目录与 config.toml 保持本机原样。`,
      `Program files were replaced from ${name}; the data directory and config.toml were left untouched.`
    ),
    // 字段缺失时按「需要重启」处理，不能少提示一句。
    restartNeeded: lastUpdate.restart_required !== false,
  }
}
