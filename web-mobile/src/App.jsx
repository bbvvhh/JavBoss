import { useEffect, useState } from 'react'

import ActionSheet from '@/components/ActionSheet'
import DensitySheet from '@/components/DensitySheet'
import FilterSheet from '@/components/FilterSheet'
import Icon from '@/components/Icons'
import IdolCoverEditorPage from '@/components/IdolCoverEditorPage'
import { JavDetailPage, JavIdolPage } from '@/components/JavDetailPage'
import JavDensitySheet from '@/components/JavDensitySheet'
import JavFavoriteSheet from '@/components/JavFavoriteSheet'
import JavFilterSheet from '@/components/JavFilterSheet'
import JavIdolFilterSheet from '@/components/JavIdolFilterSheet'
import JavIdolQuickChips from '@/components/JavIdolQuickChips'
import JavListPage from '@/components/JavListPage'
import JavQuickChips from '@/components/JavQuickChips'
import { JavBatchFavoriteSheet, JavBatchTagSheet } from '@/components/JavSelectionSheets'
import JavTagSheet from '@/components/JavTagSheet'
import PlaybackHistoryPage from '@/components/PlaybackHistoryPage'
import PlayerPage from '@/components/PlayerPage'
import QuickChips from '@/components/QuickChips'
import RenamePage from '@/components/RenamePage'
import ScrapeOnlinePage from '@/components/ScrapeOnlinePage'
import ScrapeSettingsPage from '@/components/ScrapeSettingsPage'
import ScreenshotsPage from '@/components/ScreenshotsPage'
import { SearchBar, SearchHints } from '@/components/SearchPanel'
import {
  JavSelectionActionBar,
  JavSelectionTopBar,
  SelectionActionBar,
  SelectionTopBar,
} from '@/components/SelectionBar'
import MePage from '@/components/settings/MePage'
import SettingsSubPage, { isSettingsPage } from '@/components/settings/registry'
import TagEditorSheet from '@/components/TagEditorSheet'
import Toast from '@/components/Toast'
import TopBar from '@/components/TopBar'
import VideoGrid from '@/components/VideoGrid'
import useInfiniteScroll from '@/hooks/useInfiniteScroll'
import useOverlayBack from '@/hooks/useOverlayBack'
import useScrollRestoration from '@/hooks/useScrollRestoration'
import useStackBack from '@/hooks/useStackBack'
import useUrlStateSync from '@/hooks/useUrlStateSync'
import { useStore } from '@/store'
import { zh } from '@/utils/i18n'
import { applyUrlState, parseUrlState } from '@/utils/urlState'

export default function App() {
  const [searchOpen, setSearchOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [javFilterOpen, setJavFilterOpen] = useState(false)
  const [javIdolFilterOpen, setJavIdolFilterOpen] = useState(false)
  const [javTagOpen, setJavTagOpen] = useState(false)
  const [javFavoriteOpen, setJavFavoriteOpen] = useState(false)
  const [javBatchTagOpen, setJavBatchTagOpen] = useState(false)
  const [javBatchFavoriteOpen, setJavBatchFavoriteOpen] = useState(false)
  const [tagTargets, setTagTargets] = useState(null)
  const [tagRemoveTargets, setTagRemoveTargets] = useState(null)
  const [videoJavTagOpen, setVideoJavTagOpen] = useState(false)
  const [videoJavTagIds, setVideoJavTagIds] = useState([])
  const [ready, setReady] = useState(false)

  const view = useStore((state) => state.view)
  const javTab = useStore((state) => state.javTab)
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
  const javSelectionMode = useStore((state) => state.javSelectionMode)
  const javSelectedIds = useStore((state) => state.javSelectedIds)
  const pages = useStore((state) => state.pages)

  // 首次进入：先拿配置（分页大小 / 默认排序）与标签，再按地址栏复原筛选条件，
  // 最后才加载列表 —— 顺序反了会先按默认条件白拉一次请求。
  useEffect(() => {
    let cancelled = false
    Promise.all([useStore.getState().loadConfig(), useStore.getState().loadTags()]).then(() => {
      if (cancelled) return
      applyUrlState(useStore, parseUrlState(window.location.search))
      setReady(true)
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

  // 切到 JAV 模式再切回来（或刷新页面）时，视频列表还停在原来那一屏。
  useScrollRestoration('video', {
    enabled: view === 'video',
    requestMore: () => {
      const state = useStore.getState()
      if (!state.hasNext || state.loading || state.loadingMore || state.randomSeed) return false
      state.loadMoreVideos()
      return true
    },
  })

  // 配置与地址栏都就位之后，再把之后的每次筛选变化写回地址栏。
  useUrlStateSync(ready)

  const topPage = pages[pages.length - 1] || null
  const showingSearchHints = searchOpen && !selectionMode && !searchInput
  // JAV 作品多选只在「作品」子分类下成立：女优 / 片商 / 系列没有批量操作。
  const javSelectionAlive = javSelectionMode && view === 'jav' && javTab === 'works'
  const javSelectedIdList = Array.from(javSelectedIds)
  // 第二行功能栏是否渲染：多选态由选择栏接管，搜索态由搜索栏接管，两者都不渲染功能栏。
  const quickChipsVisible = !selectionMode && !javSelectionAlive && !searchOpen
  // 子分类行的吸顶偏移要看功能栏到底占没占位置，差 46px 就会在顶上留一条空档。
  const javChipsVisible =
    quickChipsVisible && view === 'jav' && (javTab === 'works' || javTab === 'idols')

  /**
   * 「JAV 标签」：标签最终打在作品上，所以要先把所选视频关联的作品 id 取出来。
   * 一个都没关联时直接提示，不打开一个「选了标签也没用」的抽屉。
   */
  const openVideoJavTags = () => {
    const ids = useStore.getState().selectedJavIds()
    if (ids.length === 0) {
      useStore
        .getState()
        .showToast(
          zh(
            '所选视频都没有关联 JAV，无法加 JAV 标签',
            'None of the selected videos is linked to a JAV item'
          )
        )
      return
    }
    setVideoJavTagIds(ids)
    setVideoJavTagOpen(true)
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#eff1f4]">
      {/* 外壳：视频与 JAV 两个模式共用同一套顶栏，保证随时能互相切换 */}
      {selectionMode && view === 'video' ? (
        <SelectionTopBar />
      ) : javSelectionAlive ? (
        <JavSelectionTopBar />
      ) : searchOpen ? (
        <SearchBar onClose={() => setSearchOpen(false)} />
      ) : (
        <TopBar
          onOpenSearch={() => setSearchOpen(true)}
          onOpenSettings={() => useStore.getState().pushPage('me')}
          onOpenHistory={() => useStore.getState().pushPage('playback-history')}
        />
      )}

      {quickChipsVisible ? (
        view === 'jav' ? (
          javTab === 'works' ? (
            <JavQuickChips
              onOpenFilter={() => setJavFilterOpen(true)}
              onOpenTags={() => setJavTagOpen(true)}
              onOpenFavorites={() => setJavFavoriteOpen(true)}
            />
          ) : javTab === 'idols' ? (
            // 女优页的排序 / 资料筛选与作品页完全无关，走独立控件。
            <JavIdolQuickChips onOpenIdolSheet={() => setJavIdolFilterOpen(true)} />
          ) : null
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
        <JavListPage chipsVisible={javChipsVisible} />
      )}

      {selectionMode && view === 'video' ? (
        <SelectionActionBar
          onOpenTags={(list) => setTagTargets(list)}
          onOpenRemoveTags={(list) => setTagRemoveTargets(list)}
          onOpenJavTags={openVideoJavTags}
        />
      ) : javSelectionAlive ? (
        <JavSelectionActionBar
          onOpenTags={() => setJavBatchTagOpen(true)}
          onOpenFavorites={() => setJavBatchFavoriteOpen(true)}
        />
      ) : null}

      <FilterSheet open={filterOpen} onClose={() => setFilterOpen(false)} />
      <DensitySheet />
      <JavFilterSheet open={javFilterOpen} onClose={() => setJavFilterOpen(false)} />
      <JavIdolFilterSheet open={javIdolFilterOpen} onClose={() => setJavIdolFilterOpen(false)} />
      <JavTagSheet open={javTagOpen} onClose={() => setJavTagOpen(false)} />
      <JavFavoriteSheet open={javFavoriteOpen} onClose={() => setJavFavoriteOpen(false)} />
      <JavBatchTagSheet
        open={javBatchTagOpen}
        javIds={javSelectedIdList}
        onClose={() => setJavBatchTagOpen(false)}
        onApplied={() => {
          setJavBatchTagOpen(false)
          useStore.getState().exitJavSelection()
        }}
      />
      <JavBatchFavoriteSheet
        open={javBatchFavoriteOpen}
        javIds={javSelectedIdList}
        onClose={() => setJavBatchFavoriteOpen(false)}
        onApplied={() => {
          setJavBatchFavoriteOpen(false)
          useStore.getState().exitJavSelection()
        }}
      />
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

      {tagRemoveTargets ? (
        <TagEditorSheet
          open
          videos={tagRemoveTargets}
          initialMode="remove"
          onClose={() => {
            setTagRemoveTargets(null)
            useStore.getState().exitSelection()
          }}
        />
      ) : null}

      {/* 视频多选 → JAV 标签：javIds 是所选视频关联的作品 id */}
      <JavBatchTagSheet
        open={videoJavTagOpen}
        javIds={videoJavTagIds}
        onClose={() => setVideoJavTagOpen(false)}
        onApplied={() => {
          setVideoJavTagOpen(false)
          useStore.getState().exitSelection()
        }}
      />

      <OverlayBack open={searchOpen} onClose={() => setSearchOpen(false)} />
      <OverlayBack open={filterOpen} onClose={() => setFilterOpen(false)} />
      <OverlayBack open={javFilterOpen} onClose={() => setJavFilterOpen(false)} />
      <OverlayBack open={javIdolFilterOpen} onClose={() => setJavIdolFilterOpen(false)} />
      <OverlayBack open={javTagOpen} onClose={() => setJavTagOpen(false)} />
      <OverlayBack open={javFavoriteOpen} onClose={() => setJavFavoriteOpen(false)} />
      <OverlayBack open={javBatchTagOpen} onClose={() => setJavBatchTagOpen(false)} />
      <OverlayBack open={javBatchFavoriteOpen} onClose={() => setJavBatchFavoriteOpen(false)} />
      <OverlayBack open={videoJavTagOpen} onClose={() => setVideoJavTagOpen(false)} />
      <OverlayBack open={Boolean(player)} onClose={() => useStore.getState().closePlayer()} />
      <OverlayBack open={selectionMode} onClose={() => useStore.getState().exitSelection()} />
      <OverlayBack
        open={javSelectionAlive}
        onClose={() => useStore.getState().exitJavSelection()}
      />
      <StackBack depth={pages.length} onPop={() => useStore.getState().popPage()} />

      {topPage?.type === 'me' ? <MePage onClose={() => useStore.getState().popPage()} /> : null}

      {topPage?.type === 'rename' ? (
        <RenamePage video={topPage.payload} onClose={() => useStore.getState().popPage()} />
      ) : null}
      {topPage?.type === 'screenshots' ? (
        <ScreenshotsPage video={topPage.payload} onClose={() => useStore.getState().popPage()} />
      ) : null}
      {topPage?.type === 'scrape' ? (
        <ScrapeSettingsPage video={topPage.payload} onClose={() => useStore.getState().popPage()} />
      ) : null}
      {topPage?.type === 'scrape-online' ? (
        <ScrapeOnlinePage video={topPage.payload} onClose={() => useStore.getState().popPage()} />
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
      {topPage?.type === 'jav-idol-cover' ? (
        <IdolCoverEditorPage idol={topPage.payload} onClose={() => useStore.getState().popPage()} />
      ) : null}
      {topPage?.type === 'playback-history' ? (
        <PlaybackHistoryPage onClose={() => useStore.getState().popPage()} />
      ) : null}

      {topPage && isSettingsPage(topPage.type) ? (
        <SettingsSubPage page={topPage} onClose={() => useStore.getState().popPage()} />
      ) : null}

      {player ? (
        <PlayerPage
          key={`${player.video?.id}-${player.video?.location_id || 0}`}
          video={player.video}
          startTime={player.startTime || 0}
          jav={player.jav || null}
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

/**
 * 页面栈的返回键支持。
 *
 * 深度必须交给 `useStackBack` 而不是 `useOverlayBack`：后者只处理开 / 关两态，
 * 深度变化时它的 `history.back()` 会在**新**监听器挂上之后才派发 popstate，
 * 于是刚压入的页面立刻被弹掉 —— 症状是「点子页面的入口没反应」。
 *
 * 也不能给每个子页单独注册一个 OverlayBack —— 父层（「我的」）的历史记录会
 * 被内层的 `history.back()` 一起弹掉，表现就是「从任意子页返回，设置区直接消失」。
 */
function StackBack({ depth, onPop }) {
  useStackBack(depth, onPop)
  return null
}
