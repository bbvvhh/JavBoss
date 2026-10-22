/**
 * 视频在目录内的相对路径里，所在文件夹的前缀（根目录返回空串）。
 * 其它模式的播放列表按这个前缀把「同一层」的视频归到一起。
 * 从 web/src/utils/videoPath.js 复制而来。
 */
export const getVideoFolderPath = (video) => {
  const relative = String(video?.path || '')
    .replace(/\\/g, '/')
    .trim()
  const index = relative.lastIndexOf('/')
  return index >= 0 ? relative.slice(0, index) : ''
}
