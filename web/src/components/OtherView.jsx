import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import VideoGrid from '@/components/VideoGrid'
import { zh } from '@/utils/i18n'

const pathBaseName = (value) => {
  const segments = String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
  return segments.length ? segments[segments.length - 1] : String(value || '')
}

function FolderTile({ name, count, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 text-left shadow-sm transition hover:border-gray-300 hover:shadow"
    >
      <FolderOutlinedIcon className="text-amber-500" fontSize="large" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-gray-800">{name}</span>
        <span className="block text-xs text-gray-500">
          {zh(`${count ?? 0} 个视频`, `${count ?? 0} videos`)}
        </span>
      </span>
    </button>
  )
}

export default function OtherView({
  directories = [],
  directoryId = null,
  path = '',
  folders = [],
  videos = [],
  total = 0,
  loading = false,
  loadingMore = false,
  error = null,
  selectedVideoIds,
  toggleSelectVideo,
  onSelectDirectory,
  onSelectPath,
  onLoadMore,
  searchActive = false,
  openPlayer,
  openAlternatePlayer,
  revealFile,
  alternatePlayerLabel,
  setTagPickerFor,
  onOpenScreenshots,
  onRenameVideo,
  onDeleteVideo,
  onTagClick,
}) {
  const directory = directories.find((item) => Number(item?.id) === Number(directoryId)) || null
  const segments = String(path || '')
    .split('/')
    .filter(Boolean)
  const crumbs = segments.map((name, index) => ({
    name,
    path: segments.slice(0, index + 1).join('/'),
  }))
  // 未选择目录时，输入关键字直接展示全库（其它模式目录内递归）的搜索结果。
  const showResults = directoryId != null || searchActive

  return (
    <div className="flex flex-col gap-4">
      <nav
        className="flex flex-wrap items-center gap-1 text-sm text-gray-600"
        aria-label={zh('面包屑', 'Breadcrumb')}
      >
        <button
          type="button"
          onClick={() => onSelectDirectory?.(null)}
          className="rounded px-2 py-1 hover:bg-gray-100"
        >
          {zh('其它模式目录', 'Other directories')}
        </button>
        {directory ? (
          <span className="flex items-center gap-1">
            <span className="text-gray-400">/</span>
            <button
              type="button"
              onClick={() => onSelectPath?.('')}
              className="rounded px-2 py-1 hover:bg-gray-100"
            >
              {pathBaseName(directory.path)}
            </button>
          </span>
        ) : null}
        {crumbs.map((crumb) => (
          <span key={crumb.path} className="flex items-center gap-1">
            <span className="text-gray-400">/</span>
            <button
              type="button"
              onClick={() => onSelectPath?.(crumb.path)}
              className="rounded px-2 py-1 hover:bg-gray-100"
            >
              {crumb.name}
            </button>
          </span>
        ))}
      </nav>

      {error ? (
        <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-red-700">
          {String(error)}
        </div>
      ) : null}

      {!showResults ? (
        directories.length === 0 ? (
          <div className="rounded border border-dashed border-gray-200 p-6 text-center text-gray-500">
            {zh(
              '暂无其它模式目录，请在设置 > 目录管理中把目录模式设为「其它模式」。',
              'No other-mode directories yet. Set a directory to "Other" in Settings › Directory Management.'
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {directories.map((item) => (
              <FolderTile
                key={item.id}
                name={pathBaseName(item.path)}
                count={item.scanned_video_count}
                onClick={() => onSelectDirectory?.(item.id)}
              />
            ))}
          </div>
        )
      ) : loading ? (
        <div className="flex min-h-[200px] items-center justify-center rounded border border-dashed border-gray-200 text-gray-500">
          {zh('加载中…', 'Loading...')}
        </div>
      ) : (
        <>
          {folders.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {folders.map((folder) => (
                <FolderTile
                  key={folder.path}
                  name={folder.name}
                  count={folder.video_count}
                  onClick={() => onSelectPath?.(folder.path)}
                />
              ))}
            </div>
          ) : null}

          <VideoGrid
            videos={videos}
            selectedIds={selectedVideoIds}
            onToggleSelect={toggleSelectVideo}
            onPlay={(video) => openPlayer?.(video)}
            onOpenFile={(video) => openAlternatePlayer?.(video)}
            onRevealFile={(video) => revealFile?.(video)}
            openFileLabel={alternatePlayerLabel}
            onOpenTagPicker={(vid) => setTagPickerFor?.(vid)}
            onOpenScreenshots={onOpenScreenshots}
            showScrapeSettings={false}
            onRenameVideo={onRenameVideo}
            onDeleteVideo={onDeleteVideo}
            onTagClick={onTagClick}
          />

          {folders.length === 0 && videos.length === 0 ? (
            <div className="rounded border border-dashed border-gray-200 p-6 text-center text-gray-500">
              {searchActive
                ? zh('没有匹配的视频。', 'No matching videos.')
                : zh('这里没有视频或文件夹。', 'No videos or folders here.')}
            </div>
          ) : null}

          {total > videos.length ? (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={onLoadMore}
                disabled={loadingMore}
                className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              >
                {loadingMore ? zh('加载中…', 'Loading...') : zh('加载更多', 'Load more')}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
