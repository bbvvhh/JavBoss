import { useEffect, useRef, useState } from 'react'

import { fetchOtherDirectories } from '@/api'
import Icon from '@/components/Icons'
import SubPage from '@/components/SubPage'
import VideoGrid from '@/components/VideoGrid'
import useAsyncData from '@/hooks/useAsyncData'
import useInfiniteScroll from '@/hooks/useInfiniteScroll'
import { useStore } from '@/store'
import { getVideoDisplayName } from '@/utils/display'
import { zh } from '@/utils/i18n'

/**
 * 目录没有 `name` 字段，显示名沿用视频模式那套「由 path 推导」的方式。
 */
function directoryLabel(directory) {
  return (
    getVideoDisplayName({
      path: directory?.path || directory?.remote_path || '',
      id: null,
    }) || zh('目录', 'Directory')
  )
}

function FolderRow({ label, count, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-card border border-[#e6e8ec] bg-white px-3 py-3 text-left shadow-[0_1px_2px_rgba(16,24,40,0.05)] active:bg-zinc-50"
    >
      <Icon name="folder" size={18} className="flex-none text-amber-500" />
      <span className="min-w-0 flex-1 truncate text-[13px] leading-snug text-zinc-800">
        {label}
      </span>
      <span className="flex-none text-[11.5px] tabular-nums text-zinc-400">{count}</span>
      <Icon name="right" size={14} className="flex-none text-zinc-300" />
    </button>
  )
}

function EmptyState({ icon = 'folder', title, hint }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-white text-zinc-300 shadow-sm">
        <Icon name={icon} size={26} />
      </div>
      <p className="text-sm font-medium text-zinc-500">{title}</p>
      {hint ? <p className="mt-1 text-xs text-zinc-400">{hint}</p> : null}
    </div>
  )
}

/**
 * 顶层搜索：不带目录时后端递归搜索所有其它模式目录，结果直接平铺成视频列表。
 */
function OtherSearchResults({ searchTerm }) {
  const loadOtherContents = useStore((state) => state.loadOtherContents)
  const loadMoreOtherContents = useStore((state) => state.loadMoreOtherContents)
  const resetOtherNav = useStore((state) => state.resetOtherNav)
  const density = useStore((state) => state.density)
  const videos = useStore((state) => state.otherItems)
  const folders = useStore((state) => state.otherFolders)
  const total = useStore((state) => state.otherTotal)
  const loading = useStore((state) => state.otherLoading)
  const loadingMore = useStore((state) => state.otherLoadingMore)
  const hasNext = useStore((state) => state.otherHasNext)
  const error = useStore((state) => state.otherError)
  const pushPage = useStore((state) => state.pushPage)

  useEffect(() => {
    useStore.getState().setOtherNav(null, '')
    loadOtherContents({ search: searchTerm })
    return () => resetOtherNav()
  }, [searchTerm, loadOtherContents, resetOtherNav])

  const sentinelRef = useInfiniteScroll({
    onLoadMore: () => loadMoreOtherContents(),
    enabled: hasNext && !loading && !loadingMore,
  })

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-2 px-2.5 pb-6 pt-2.5">
      {error ? (
        <div className="flex items-start gap-2 rounded-card border border-red-200 bg-red-50 px-3 py-2.5 text-[12.5px] text-red-700">
          <Icon name="ban" size={15} className="mt-[1px] flex-none" />
          <span className="min-w-0 flex-1">{error}</span>
          <button
            type="button"
            onClick={() => loadOtherContents()}
            className="flex-none font-semibold underline"
          >
            {zh('重试', 'Retry')}
          </button>
        </div>
      ) : null}

      {loading || videos.length > 0 || folders.length > 0 ? (
        <>
          {folders.length > 0 ? (
            <div className="flex flex-col gap-2">
              {folders.map((folder) => (
                <FolderRow
                  key={`${folder.directory_id ?? ''}:${folder.path}`}
                  label={folder.name || folder.path}
                  count={Number(folder.video_count) || 0}
                  onClick={() => {
                    // 关键词保留在 store 里，返回上一层时能恢复搜索结果；
                    // 本层通过 ignoreSearch 忽略关键词，展示文件夹内全部视频。
                    pushPage('other-folder', {
                      directoryId: folder.directory_id,
                      path: folder.path,
                      ignoreSearch: true,
                    })
                  }}
                />
              ))}
            </div>
          ) : null}

          <VideoGrid
            videos={videos}
            density={density}
            loading={loading}
            loadingMore={loadingMore}
            hasNext={hasNext}
            total={total}
            sentinelRef={sentinelRef}
            onOpen={(video) => useStore.getState().openOtherVideo(video)}
            onLongPress={(video) =>
              useStore.getState().openActionSheet(video, {
                hideScrape: true,
                hideSelection: true,
                playList: videos,
              })
            }
          />
        </>
      ) : !loading && !error ? (
        <EmptyState
          icon="search"
          title={zh('没有匹配的视频或文件夹', 'No matching videos or folders')}
          hint={zh('换个关键词试试', 'Try another keyword')}
        />
      ) : null}
    </main>
  )
}

/** 顶层：其它模式目录列表，每行当作一个文件夹入口。 */
function OtherDirectoryList() {
  const { data, loading, error, reload } = useAsyncData(() => fetchOtherDirectories(), [])
  const pushPage = useStore((state) => state.pushPage)
  const searchTerm = useStore((state) => state.searchTerm)
  const directories = data || []

  // 顶层输入关键词后，目录列表让位给全局（其它模式范围内）的搜索结果。
  if (searchTerm) {
    return <OtherSearchResults searchTerm={searchTerm} />
  }

  if (loading) {
    return (
      <p className="px-4 py-16 text-center text-[12.5px] text-zinc-400">
        {zh('正在加载…', 'Loading...')}
      </p>
    )
  }

  if (error) {
    return (
      <div className="mx-2.5 mt-2.5 flex items-start gap-2 rounded-card border border-red-200 bg-red-50 px-3 py-2.5 text-[12.5px] text-red-700">
        <Icon name="ban" size={15} className="mt-[1px] flex-none" />
        <span className="min-w-0 flex-1">{error.message}</span>
        <button type="button" onClick={reload} className="flex-none font-semibold underline">
          {zh('重试', 'Retry')}
        </button>
      </div>
    )
  }

  if (directories.length === 0) {
    return (
      <EmptyState
        title={zh('还没有「其它模式」目录', 'No “Other mode” directories yet')}
        hint={zh(
          '到「设置 → 目录管理」把目录设为其它模式',
          'Set a directory to Other mode in Settings → Directories'
        )}
      />
    )
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-2 px-2.5 pb-6 pt-2.5">
      {directories.map((directory) => (
        <FolderRow
          key={directory.id}
          label={directoryLabel(directory)}
          count={Number(directory.scanned_video_count) || 0}
          onClick={() => pushPage('other-folder', { directoryId: directory.id, path: '' })}
        />
      ))}
    </main>
  )
}

/**
 * 下钻页：某个其它模式目录 / 文件夹下的「直接子文件夹 + 直接子视频」，带面包屑。
 *
 * 每一级下钻都压在页面栈上，所以返回键 / Android 物理返回键天然就是「上钻一层」；
 * 面包屑点击则一次弹掉多级，直接跳回某个祖先层级。
 */
function OtherFolderPage({ directoryId, path, onClose, ignoreSearch = false }) {
  const setOtherNav = useStore((state) => state.setOtherNav)
  const resetOtherNav = useStore((state) => state.resetOtherNav)
  const loadOtherContents = useStore((state) => state.loadOtherContents)
  const loadMoreOtherContents = useStore((state) => state.loadMoreOtherContents)
  const pushPage = useStore((state) => state.pushPage)
  const density = useStore((state) => state.density)
  const searchTerm = useStore((state) => state.searchTerm)
  const directory = useStore((state) => state.otherDirectory)
  const folders = useStore((state) => state.otherFolders)
  const videos = useStore((state) => state.otherItems)
  const total = useStore((state) => state.otherTotal)
  const loading = useStore((state) => state.otherLoading)
  const loadingMore = useStore((state) => state.otherLoadingMore)
  const hasNext = useStore((state) => state.otherHasNext)
  const error = useStore((state) => state.otherError)

  // 从搜索结果进入的文件夹先忽略关键词，展示文件夹内全部视频；返回时关键词仍在，
  // 上一层会恢复搜索结果。用户在文件夹内主动改了关键词则恢复正常过滤。
  const initialSearchRef = useRef(searchTerm)
  const [bypassSearch, setBypassSearch] = useState(ignoreSearch)
  useEffect(() => {
    if (searchTerm !== initialSearchRef.current) setBypassSearch(false)
  }, [searchTerm])

  // 页面把自己所在层级写进 store（地址栏据此写 dir / path），返回或换层时复位。
  // 搜索词一并传入：其它模式没有筛选栏，搜索是顶栏那个全局入口，词一改就重拉。
  useEffect(() => {
    setOtherNav(directoryId, path)
    loadOtherContents({ search: bypassSearch ? '' : searchTerm })
    return () => resetOtherNav()
  }, [directoryId, path, searchTerm, bypassSearch, setOtherNav, loadOtherContents, resetOtherNav])

  const sentinelRef = useInfiniteScroll({
    onLoadMore: () => loadMoreOtherContents({ search: bypassSearch ? '' : undefined }),
    enabled: hasNext && !loading && !loadingMore,
  })

  const segments = String(path ?? '')
    .split('/')
    .filter(Boolean)
  const baseLabel = directoryLabel(directory)
  const crumbs = [{ label: baseLabel, pops: segments.length }]
  segments.forEach((segment, index) => {
    crumbs.push({ label: segment, pops: segments.length - 1 - index })
  })

  // 面包屑「往上」= 按页面栈深度弹若干层；链上全是 other-folder，弹到非本类型即停。
  const goUp = (pops) => {
    for (let i = 0; i < pops; i += 1) {
      const stack = useStore.getState().pages
      const top = stack[stack.length - 1]
      if (!top || top.type !== 'other-folder') break
      useStore.getState().popPage()
    }
  }

  const currentLabel = segments.length ? segments[segments.length - 1] : baseLabel

  return (
    <SubPage title={currentLabel} subtitle={path || ''} onBack={onClose}>
      <div className="no-scrollbar sticky top-0 z-10 flex items-center gap-1 overflow-x-auto border-b border-[#e6e8ec] bg-[#eff1f4]/95 px-3 py-2 backdrop-blur-md">
        {crumbs.map((crumb, index) => (
          <span key={`${index}-${crumb.pops}`} className="flex flex-none items-center gap-1">
            {index > 0 ? <Icon name="right" size={12} className="flex-none text-zinc-300" /> : null}
            <button
              type="button"
              disabled={crumb.pops === 0}
              onClick={() => goUp(crumb.pops)}
              className={`max-w-[46vw] truncate text-[12.5px] ${
                crumb.pops === 0 ? 'font-semibold text-zinc-900' : 'text-brand-ink'
              }`}
            >
              {crumb.label}
            </button>
          </span>
        ))}
      </div>

      {error ? (
        <div className="mx-2.5 mt-2.5 flex items-start gap-2 rounded-card border border-red-200 bg-red-50 px-3 py-2.5 text-[12.5px] text-red-700">
          <Icon name="ban" size={15} className="mt-[1px] flex-none" />
          <span className="min-w-0 flex-1">{error}</span>
          <button
            type="button"
            onClick={() => loadOtherContents()}
            className="flex-none font-semibold underline"
          >
            {zh('重试', 'Retry')}
          </button>
        </div>
      ) : null}

      {folders.length ? (
        <div className="flex flex-col gap-2 px-2.5 pt-2.5">
          {folders.map((folder) => (
            <FolderRow
              key={`${folder.directory_id ?? ''}:${folder.path}`}
              label={folder.name || folder.path}
              count={Number(folder.video_count) || 0}
              onClick={() => {
                // 命中搜索结果的文件夹可能来自更深层级：连同目录一起进入，
                // 关键词保留在 store 里供返回恢复，本层打开时忽略它。
                pushPage('other-folder', {
                  directoryId: folder.directory_id || directoryId,
                  path: folder.path,
                  ignoreSearch: Boolean(searchTerm),
                })
              }}
            />
          ))}
        </div>
      ) : null}

      {loading || videos.length > 0 ? (
        <VideoGrid
          videos={videos}
          density={density}
          loading={loading}
          loadingMore={loadingMore}
          hasNext={hasNext}
          total={total}
          sentinelRef={sentinelRef}
          onOpen={(video) => useStore.getState().openOtherVideo(video)}
          onLongPress={(video) =>
            useStore.getState().openActionSheet(video, {
              hideScrape: true,
              hideSelection: true,
              playList: videos,
            })
          }
        />
      ) : !loading && !error && folders.length === 0 ? (
        <EmptyState
          title={
            searchTerm
              ? zh('没有匹配的内容', 'Nothing matched')
              : zh('这个文件夹是空的', 'This folder is empty')
          }
          hint={zh('换个文件夹或到其它目录看看', 'Try another folder or directory')}
        />
      ) : null}
    </SubPage>
  )
}

/**
 * 其它模式浏览页。
 *
 * - 顶层（不带 `directoryId`）：列出所有「其它模式」目录；
 * - 下钻页（带 `directoryId` / `path`）：展示该层级的内容，由页面栈承载。
 *
 * 两种形态共用一个组件，是因为下钻时 `pushPage('other-folder', {directoryId, path})`
 * 之后 App 会用同一份 payload 重新渲染它 —— 页面栈的深度就是下钻的深度。
 */
export default function OtherBrowserPage({
  directoryId = null,
  path = '',
  onClose = null,
  ignoreSearch = false,
}) {
  if (directoryId) {
    return (
      <OtherFolderPage
        directoryId={directoryId}
        path={path}
        ignoreSearch={ignoreSearch}
        onClose={onClose}
      />
    )
  }
  return <OtherDirectoryList />
}
