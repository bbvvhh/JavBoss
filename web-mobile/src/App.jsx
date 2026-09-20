import { useEffect, useState } from 'react'

import ActionSheet from '@/components/ActionSheet'
import DensitySheet from '@/components/DensitySheet'
import FilterSheet from '@/components/FilterSheet'
import Icon from '@/components/Icons'
import { JavDetailPage, JavIdolPage } from '@/components/JavDetailPage'
import JavDensitySheet from '@/components/JavDensitySheet'
import JavFavoriteSheet from '@/components/JavFavoriteSheet'
import JavFilterSheet from '@/components/JavFilterSheet'
import JavListPage from '@/components/JavListPage'
import JavQuickChips from '@/components/JavQuickChips'
import JavTagSheet from '@/components/JavTagSheet'
import PlaceholderPage from '@/components/PlaceholderPage'
import PlayerPage from '@/components/PlayerPage'
import QuickChips from '@/components/QuickChips'
import RenamePage from '@/components/RenamePage'
import ScrapeSettingsPage from '@/components/ScrapeSettingsPage'
import ScreenshotsPage from '@/components/ScreenshotsPage'
import { SearchBar, SearchHints } from '@/components/SearchPanel'
import { SelectionActionBar, SelectionTopBar } from '@/components/SelectionBar'
import TagEditorSheet from '@/components/TagEditorSheet'
import Toast from '@/components/Toast'
import TopBar from '@/components/TopBar'
import VideoGrid from '@/components/VideoGrid'
import useInfiniteScroll from '@/hooks/useInfiniteScroll'
import useOverlayBack from '@/hooks/useOverlayBack'
import { useStore } from '@/store'
import { zh } from '@/utils/i18n'

export default function App() {
  const [searchOpen, setSearchOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [javFilterOpen, setJavFilterOpen] = useState(false)
  const [javTagOpen, setJavTagOpen] = useState(false)
  const [javFavoriteOpen, setJavFavoriteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tagTargets, setTagTargets] = useState(null)
  const [ready, setReady] = useState(false)

  const view = useStore((state) => state.view)
  const videos = useStore((state) => state.videos)
  const total = useStore((state) => state.total)
  const density = useStore((state) => state.density)
  const loading = useStore((state) => state.loading)
  const loadingMore = useStore((state) => state.loadingMore)
  const hasNext = useStore((state) => state.hasNext)
  const error = useStore((state) => state.error)
  const searchTerm = useStore((state) => state.searchTerm)
  const searchInput = useStore((state) => state.searchInput)
  const selectedTags = useStore((state) => state.selectedTags)
  const sort = useStore((state) => state.sort)
  const hideJav = useStore((state) => state.hideJav)
  const pageSize = useStore((state) => state.pageSize)
  const randomSeed = useStore((state) => state.randomSeed)
  const player = useStore((state) => state.player)
  const selectionMode = useStore((state) => state.selectionMode)
  const selectedKeys = useStore((state) => state.selectedKeys)
  const pages = useStore((state) => state.pages)

  // 首次进入：先拿配置（分页大小 / 默认排序）与标签，再加载列表。
  useEffect(() => {
    let cancelled = false
    Promise.all([useStore.getState().loadConfig(), useStore.getState().loadTags()]).then(() => {
      if (!cancelled) setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const tagsKey = selectedTags.join(',')
  useEffect(() => {
    if (!ready) return
    useStore.getState().loadVideos()
  }, [ready, searchTerm, tagsKey, sort, hideJav, pageSize, randomSeed])

  const sentinelRef = useInfiniteScroll({
    onLoadMore: () => useStore.getState().loadMoreVideos(),
    enabled: hasNext && !loading && !loadingMore && !randomSeed,
  })

  const topPage = pages[pages.length - 1] || null
  const showingSearchHints = searchOpen && !selectionMode && !searchInput

  return (
    <div className="flex min-h-screen flex-col bg-[#eff1f4]">
      {/* 外壳：视频与 JAV 两个模式共用同一套顶栏，保证随时能互相切换 */}
      {selectionMode && view === 'video' ? (
        <SelectionTopBar />
      ) : searchOpen ? (
        <SearchBar onClose={() => setSearchOpen(false)} />
      ) : (
        <TopBar
          onOpenSearch={() => setSearchOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}

      {!selectionMode && !searchOpen ? (
        view === 'jav' ? (
          <JavQuickChips
            onOpenFilter={() => setJavFilterOpen(true)}
            onOpenTags={() => setJavTagOpen(true)}
            onOpenFavorites={() => setJavFavoriteOpen(true)}
          />
        ) : (
          <QuickChips onOpenFilter={() => setFilterOpen(true)} />
        )
      ) : null}

      {view === 'video' ? (
        <>
          {showingSearchHints ? <SearchHints /> : null}

          {!searchOpen && searchTerm && !selectionMode ? (
            <div className="flex items-center gap-2 border-b border-[#e6e8ec] bg-white px-3 py-2 text-[12px] text-zinc-500">
              <Icon name="search" size={13} />
              <span className="truncate">
                {zh(`搜索「${searchTerm}」`, `Searching “${searchTerm}”`)}
              </span>
              <span className="ml-auto flex-none tabular-nums">{total}</span>
            </div>
          ) : null}

          {randomSeed && !searchOpen && !selectionMode ? (
            <div className="flex items-center gap-2 border-b border-[#e6e8ec] bg-brand-soft px-3 py-2 text-[12px] text-brand-ink">
              <Icon name="shuffle" size={13} />
              <span>{zh('随机模式：不支持分页', 'Random mode: no pagination')}</span>
              <button
                type="button"
                onClick={() => useStore.getState().clearRandom()}
                className="ml-auto flex-none font-semibold underline"
              >
                {zh('退出随机', 'Exit')}
              </button>
            </div>
          ) : null}

          {error ? (
            <div className="mx-2.5 mt-2.5 flex items-start gap-2 rounded-card border border-red-200 bg-red-50 px-3 py-2.5 text-[12.5px] text-red-700">
              <Icon name="ban" size={15} className="mt-[1px] flex-none" />
              <span>{error}</span>
            </div>
          ) : null}

          <main
            className="min-h-0 flex-1"
            style={selectionMode ? { paddingBottom: 76 } : undefined}
          >
            {showingSearchHints ? null : (
              <VideoGrid
                videos={videos}
                density={density}
                loading={loading || !ready}
                loadingMore={loadingMore}
                hasNext={hasNext && !randomSeed}
                total={total}
                sentinelRef={sentinelRef}
                onOpen={(video) => useStore.getState().openPlayer(video, videos)}
                onLongPress={(video) => useStore.getState().openActionSheet(video)}
                selectionMode={selectionMode}
                selectedKeys={selectedKeys}
                onToggle={(video) => useStore.getState().toggleSelection(video)}
              />
            )}
          </main>
        </>
      ) : (
        <JavListPage />
      )}

      {selectionMode && view === 'video' ? (
        <SelectionActionBar onOpenTags={(list) => setTagTargets(list)} />
      ) : null}

      <FilterSheet open={filterOpen} onClose={() => setFilterOpen(false)} />
      <DensitySheet />
      <JavFilterSheet open={javFilterOpen} onClose={() => setJavFilterOpen(false)} />
      <JavTagSheet open={javTagOpen} onClose={() => setJavTagOpen(false)} />
      <JavFavoriteSheet open={javFavoriteOpen} onClose={() => setJavFavoriteOpen(false)} />
      <JavDensitySheet />
      <ActionSheet />

      {tagTargets ? (
        <TagEditorSheet
          open
          videos={tagTargets}
          onClose={() => {
            setTagTargets(null)
            useStore.getState().exitSelection()
          }}
        />
      ) : null}

      <OverlayBack open={searchOpen} onClose={() => setSearchOpen(false)} />
      <OverlayBack open={filterOpen} onClose={() => setFilterOpen(false)} />
      <OverlayBack open={javFilterOpen} onClose={() => setJavFilterOpen(false)} />
      <OverlayBack open={javTagOpen} onClose={() => setJavTagOpen(false)} />
      <OverlayBack open={javFavoriteOpen} onClose={() => setJavFavoriteOpen(false)} />
      <OverlayBack open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <OverlayBack open={Boolean(player)} onClose={() => useStore.getState().closePlayer()} />
      <OverlayBack open={selectionMode} onClose={() => useStore.getState().exitSelection()} />
      <OverlayBack open={Boolean(topPage)} onClose={() => useStore.getState().popPage()} />

      {settingsOpen ? (
        <PlaceholderPage
          icon="gear"
          title={zh('我的', 'Settings')}
          description={zh(
            '设置页（14 个入口）在 P2 阶段实现；首屏刻意不常显设置，只保留右上角这一个入口。',
            'The settings area (14 entries) lands in P2.'
          )}
          items={[
            zh(
              '媒体库：目录管理 / 扫描 / 视频标签 / JAV 标签 / 收藏夹',
              'Library: directories, scan, tags, favourites'
            ),
            zh('播放与刮削：播放设置 / 刮削设置 / 下载器', 'Playback & scraping settings'),
            zh(
              '系统与集成：全局设置 / 存储连接 / 扩展令牌',
              'System: global settings, storage, tokens'
            ),
            zh(
              '账号：修改密码 / 切换到电脑版 / 退出登录',
              'Account: password, switch to desktop, sign out'
            ),
          ]}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}

      {topPage?.type === 'rename' ? (
        <RenamePage video={topPage.payload} onClose={() => useStore.getState().popPage()} />
      ) : null}
      {topPage?.type === 'screenshots' ? (
        <ScreenshotsPage video={topPage.payload} onClose={() => useStore.getState().popPage()} />
      ) : null}
      {topPage?.type === 'scrape' ? (
        <ScrapeSettingsPage video={topPage.payload} onClose={() => useStore.getState().popPage()} />
      ) : null}
      {topPage?.type === 'tags' ? (
        <TagEditorSheet
          open
          videos={[topPage.payload]}
          onClose={() => useStore.getState().popPage()}
        />
      ) : null}
      {topPage?.type === 'jav-detail' ? (
        <JavDetailPage jav={topPage.payload} onClose={() => useStore.getState().popPage()} />
      ) : null}
      {topPage?.type === 'jav-idol' ? (
        <JavIdolPage idol={topPage.payload} onClose={() => useStore.getState().popPage()} />
      ) : null}

      {player ? (
        <PlayerPage
          key={`${player.video?.id}-${player.video?.location_id || 0}`}
          video={player.video}
          onClose={() => useStore.getState().closePlayer()}
        />
      ) : null}

      <Toast />
    </div>
  )
}

/** 让浮层响应 Android 物理返回键；本身不渲染任何东西。 */
function OverlayBack({ open, onClose }) {
  useOverlayBack(open, onClose)
  return null
}
