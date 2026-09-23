/**
 * 截图文件名 → 播放进度。
 *
 * 截图（PC 的 MPV 与移动端播放页的相机按钮）都由后端命名成
 * `mpv_HH-MM-SS[.mmm].jpg`（见 internal/server/video_api.go playbackScreenshotName），
 * 所以「点预览图跳到截图所在进度」只能从文件名反解。解不出来的（历史文件、
 * 手工放进目录的图片）返回 null —— 界面据此把播放按钮置灰、不响应播放。
 */
export function screenshotStartTime(name) {
  const stem = String(name || '')
    .replace(/\.[^.]+$/, '')
    .replace(/^mpv_/, '')
  const match = stem.match(/^(\d{2})-(\d{2})-(\d{2})(\.\d+)?$/)
  if (!match) return null
  return (
    Number.parseInt(match[1], 10) * 3600 +
    Number.parseInt(match[2], 10) * 60 +
    Number.parseInt(match[3], 10) +
    Number.parseFloat(match[4] || '0')
  )
}
