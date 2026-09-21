import { create } from 'zustand'

import {
  fetchVideos,
  fetchTags,
  fetchConfig,
  fetchDirectories,
  fetchJavs,
  fetchJavFilterOptions,
  fetchJavFavoriteGroups,
  updateConfig,
} from '@/api'
import { normalizeVideoSort } from '@/constants/video'
import { normalizeJavSort, normalizeJavDensity } from '@/constants/jav'
import { initialViewMode } from '@/utils/javDisplay'
import {
  DEFAULT_DENSITY,
  readStoredDensity,
  writeStoredDensity,
  normalizeDensity,
} from '@/utils/density'

const PAGE_SIZE = 25
const SEARCH_HISTORY_KEY = 'javboss-mobile:search-history'
const MAX_SEARCH_HISTORY = 10
const JAV_DENSITY_KEY = 'javboss-mobile:jav-density'

function readStoredJavDensity() {
  try {
    return normalizeJavDensity(localStorage.getItem(JAV_DENSITY_KEY))
  } catch {
    return 'standard'
  }
}

function writeStoredJavDensity(value) {
  try {
    localStorage.setItem(JAV_DENSITY_KEY, normalizeJavDensity(value))
  } catch {
    /* 忽略隐私模式下的写入失败 */
  }
}

function readSearchHistory() {
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string' && v.trim()) : []
  } catch {
    return []
  }
}

function writeSearchHistory(list) {
  try {
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(list))
  } catch {
    /* 忽略隐私模式下的写入失败 */
  }
}

/** JAV 筛选的「空」状态，跳转与重置都用它，避免两份定义漂移。 */
export const EMPTY_JAV_FILTERS = {
  prefix: '',
  idolIds: [],
  tagIds: [],
  studioId: null,
  studioName: '',
  seriesId: null,
  seriesName: '',
  favoriteGroupId: null,
  favoriteGroupName: '',
  soloOnly: false,
  favoriteRatingEnabled: false,
  favoriteRatingMin: 0.5,
  favoriteRatingMax: 5,
}

// 每次列表请求递增，用于丢弃过期响应（快速改筛选条件时的竞态）。
let loadSeq = 0

export const useStore = create((set, get) => ({
  /* ---------------- 视图密度（默认大图 1 列） ---------------- */
  density: readStoredDensity() || DEFAULT_DENSITY,
  densitySheetOpen: false,
  setDensity: (value) => {
    const next = normalizeDensity(value)
    writeStoredDensity(next)
    set({ density: next, densitySheetOpen: false })
  },
  openDensitySheet: () => set({ densitySheetOpen: true }),
  closeDensitySheet: () => set({ densitySheetOpen: false }),

  /* ---------------- 内容视图 ---------------- */
  view: 'video', // video | jav （jav 在 P1 实现）
  setView: (view) => {
    if (view !== 'video' && view !== 'jav') return
    set({ view })
  },

  /* ---------------- 列表状态 ---------------- */
  videos: [],
  total: 0,
  hasNext: false,
  loading: false,
  loadingMore: false,
  error: null,

  /* ---------------- 筛选条件 ---------------- */
  searchInput: '', // 输入框里的即时值
  searchTerm: '', // 防抖后真正生效的值
  setSearchInput: (value) => set({ searchInput: String(value ?? '') }),
  applySearch: (value) => set({ searchTerm: String(value ?? '').trim() }),

  selectedTags: [],
  sort: 'recent',
  hideJav: false,
  pageSize: PAGE_SIZE,
  config: {},

  /** 随机模式：后端用 sort=random&seed=N 做「随机但分页稳定」的排序。 */
  randomSeed: null,
  rollRandom: () => {
    const seed = Math.floor(Math.random() * 2147483646) + 1
    set({ randomSeed: seed })
  },
  clearRandom: () => set({ randomSeed: null }),

  tags: [],
  searchHistory: readSearchHistory(),

  rememberSearch: (term) => {
    const value = String(term || '').trim()
    if (!value) return
    const next = [value, ...get().searchHistory.filter((v) => v !== value)].slice(
      0,
      MAX_SEARCH_HISTORY
    )
    writeSearchHistory(next)
    set({ searchHistory: next })
  },
  clearSearchHistory: () => {
    writeSearchHistory([])
    set({ searchHistory: [] })
  },

  setSelectedTags: (names) => {
    const clean = Array.from(
      new Set((names || []).map((n) => String(n || '').trim()).filter(Boolean))
    )
    set({ selectedTags: clean })
  },
  toggleTag: (name) => {
    const tag = String(name || '').trim()
    if (!tag) return
    const current = get().selectedTags
    const next = current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]
    set({ selectedTags: next })
  },
  setSort: (value) => set({ sort: normalizeVideoSort(value), randomSeed: null }),
  setHideJav: (value) => set({ hideJav: Boolean(value) }),
  clearFilters: () => set({ selectedTags: [], hideJav: false, sort: 'recent', randomSeed: null }),
  resetSearch: () => set({ searchInput: '', searchTerm: '' }),

  /* ---------------- 标签与配置 ---------------- */
  loadTags: async () => {
    try {
      const tags = await fetchTags()
      set({ tags: Array.isArray(tags) ? tags : [] })
      return tags
    } catch (e) {
      set({ error: e.message })
      return null
    }
  },

  loadConfig: async () => {
    try {
      const cfg = await fetchConfig()
      const size = parseInt(cfg?.video_page_size, 10)
      const sort = normalizeVideoSort(String(cfg?.video_sort || '').toLowerCase(), '')
      const patch = { config: cfg }
      if (Number.isFinite(size) && size > 0) patch.pageSize = Math.min(size, 500)
      if (sort) patch.sort = sort
      patch.hideJav = String(cfg?.video_hide_jav || '').toLowerCase() === 'true'
      // 首次进入才套用服务端配置的初始模式与 JAV 默认排序 ——
      // 之后用户手动切过模式，不该被后台配置拽回去。
      patch.view = initialViewMode(cfg)
      const javSort = normalizeJavSort(String(cfg?.jav_sort || '').toLowerCase(), '')
      if (javSort) patch.javSort = javSort
      set(patch)
      return cfg
    } catch {
      // 配置拉取失败不阻塞浏览，继续用默认值。
      return null
    }
  },

  /* ---------------- 加载 ---------------- */
  loadVideos: async () => {
    const { pageSize, searchTerm, selectedTags, sort, hideJav, randomSeed } = get()
    const reqId = (loadSeq += 1)
    set({ loading: true, loadingMore: false, error: null })
    try {
      const resp = await fetchVideos({
        limit: pageSize,
        offset: 0,
        tags: selectedTags,
        search: searchTerm,
        sort: randomSeed ? 'random' : sort,
        seed: randomSeed || null,
        hideJav,
      })
      if (reqId !== loadSeq) return
      const items = resp.items || []
      const total = resp.total ?? 0
      set({ videos: items, total, hasNext: randomSeed ? false : items.length < total })
    } catch (e) {
      if (reqId !== loadSeq) return
      set({ error: e.message, videos: [], total: 0, hasNext: false })
    } finally {
      if (reqId === loadSeq) set({ loading: false })
    }
  },

  loadMoreVideos: async () => {
    const state = get()
    if (state.loading || state.loadingMore || !state.hasNext || state.randomSeed) return
    const offset = state.videos.length
    const reqId = loadSeq
    set({ loadingMore: true })
    try {
      const resp = await fetchVideos({
        limit: state.pageSize,
        offset,
        tags: state.selectedTags,
        search: state.searchTerm,
        sort: state.sort,
        hideJav: state.hideJav,
      })
      if (reqId !== loadSeq) return
      const items = resp.items || []
      const total = resp.total ?? state.total
      const merged = [...state.videos, ...items]
      set({ videos: merged, total, hasNext: merged.length < total && items.length > 0 })
    } catch (e) {
      if (reqId !== loadSeq) return
      set({ error: e.message })
    } finally {
      if (reqId === loadSeq) set({ loadingMore: false })
    }
  },

  /* ---------------- 播放器 ---------------- */
  player: null, // { video, list }
  openPlayer: (video, list) => set({ player: { video, list: list || get().videos } }),
  closePlayer: () => set({ player: null }),

  /* ---------------- 轻提示 ---------------- */
  toast: null,
  showToast: (message) => {
    const text = String(message || '')
    set({ toast: { message: text, id: Date.now() } })
    window.setTimeout(() => {
      if (get().toast?.message === text) set({ toast: null })
    }, 2600)
  },
  dismissToast: () => set({ toast: null }),

  /* ---------------- JAV 列表状态 ---------------- */
  javTab: 'works', // works | idols | studios | series
  setJavTab: (tab) => {
    if (!['works', 'idols', 'studios', 'series'].includes(tab)) return
    set({ javTab: tab })
  },

  javSort: 'recent',
  setJavSort: (value) => set({ javSort: normalizeJavSort(value), javRandomSeed: null }),

  javRandomSeed: null,
  rollJavRandom: () => set({ javRandomSeed: Math.floor(Math.random() * 2147483646) + 1 }),
  clearJavRandom: () => set({ javRandomSeed: null }),

  javDensity: readStoredJavDensity(),
  setJavDensity: (value) => {
    const next = normalizeJavDensity(value)
    writeStoredJavDensity(next)
    set({ javDensity: next, javDensitySheetOpen: false })
  },
  javDensitySheetOpen: false,
  openJavDensitySheet: () => set({ javDensitySheetOpen: true }),
  closeJavDensitySheet: () => set({ javDensitySheetOpen: false }),

  javFilters: { ...EMPTY_JAV_FILTERS },
  setJavFilters: (patch) => set({ javFilters: { ...get().javFilters, ...(patch || {}) } }),
  toggleJavTagId: (id) =>
    set((state) => {
      const list = state.javFilters.tagIds || []
      return {
        javFilters: {
          ...state.javFilters,
          tagIds: list.includes(id) ? list.filter((value) => value !== id) : [...list, id],
        },
      }
    }),
  setJavTagIds: (ids) =>
    set((state) => ({
      javFilters: {
        ...state.javFilters,
        tagIds: Array.from(new Set((ids || []).filter((id) => Number.isFinite(id) && id > 0))),
      },
    })),
  setJavFavoriteGroup: (id, name) =>
    set((state) => ({
      javFilters: {
        ...state.javFilters,
        favoriteGroupId: id || null,
        favoriteGroupName: id ? String(name || '') : '',
      },
    })),
  clearJavFilters: () => set({ javFilters: { ...EMPTY_JAV_FILTERS } }),

  /**
   * 从女优 / 片商 / 系列跳转到「对应的影片」。
   * 行为刻意做成可预测的：切到作品 tab、用传入的条件**替换**整套筛选、退出随机、
   * 关掉所有二级页并回到顶部。用户随后可以在「筛选」抽屉里看到并清掉这些条件。
   */
  jumpToJavWorks: (patch = {}) => {
    set({
      javTab: 'works',
      javFilters: { ...EMPTY_JAV_FILTERS, ...patch },
      javRandomSeed: null,
      pages: [],
    })
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'auto' })
  },
  javFilterCount: () => {
    const f = get().javFilters
    return (
      (f.prefix ? 1 : 0) +
      (f.idolIds.length ? 1 : 0) +
      (f.tagIds.length ? 1 : 0) +
      (f.studioId ? 1 : 0) +
      (f.seriesId ? 1 : 0) +
      (f.favoriteGroupId ? 1 : 0) +
      (f.soloOnly ? 1 : 0) +
      (f.favoriteRatingEnabled ? 1 : 0)
    )
  },

  /* JAV 标签 / 收藏夹候选（功能栏上的两个独立入口用） */
  javTagOptions: [],
  loadJavTagOptions: async () => {
    try {
      const data = await fetchJavFilterOptions({ optionLimit: 200 })
      const tags = Array.isArray(data?.tags) ? data.tags : []
      set({ javTagOptions: tags })
      return tags
    } catch {
      set({ javTagOptions: [] })
      return []
    }
  },
  javFavoriteGroups: [],
  javFavoriteGroupsLoading: false,
  loadJavFavoriteGroups: async (options = {}) => {
    if (get().javFavoriteGroupsLoading) return get().javFavoriteGroups
    if (!options.force && get().javFavoriteGroups.length) return get().javFavoriteGroups
    set({ javFavoriteGroupsLoading: true })
    try {
      const groups = await fetchJavFavoriteGroups('jav')
      set({ javFavoriteGroups: groups })
      return groups
    } catch {
      set({ javFavoriteGroups: [] })
      return []
    } finally {
      set({ javFavoriteGroupsLoading: false })
    }
  },

  /* ---------------- 长按 / ⋮ 操作菜单 ---------------- */
  actionSheetVideo: null,
  openActionSheet: (video) => set({ actionSheetVideo: video }),
  closeActionSheet: () => set({ actionSheetVideo: null }),

  /* ---------------- 多选 ---------------- */
  selectionMode: false,
  selectedKeys: new Set(),
  selectedMeta: {},

  enterSelection: (video) => {
    const key = videoKey(video)
    if (!key) return
    set({
      selectionMode: true,
      selectedKeys: new Set([key]),
      selectedMeta: { [key]: videoMeta(video) },
    })
  },
  exitSelection: () => set({ selectionMode: false, selectedKeys: new Set(), selectedMeta: {} }),
  toggleSelection: (video) => {
    const key = videoKey(video)
    if (!key) return
    const keys = new Set(get().selectedKeys)
    const meta = { ...get().selectedMeta }
    if (keys.has(key)) {
      keys.delete(key)
      delete meta[key]
    } else {
      keys.add(key)
      meta[key] = videoMeta(video)
    }
    set({ selectedKeys: keys, selectedMeta: meta })
  },
  selectAll: (videos) => {
    const keys = new Set()
    const meta = {}
    for (const video of videos || []) {
      const key = videoKey(video)
      if (!key) continue
      keys.add(key)
      meta[key] = videoMeta(video)
    }
    set({ selectedKeys: keys, selectedMeta: meta })
  },
  clearSelection: () => set({ selectedKeys: new Set(), selectedMeta: {} }),
  selectedVideoIds: () => {
    const ids = new Set()
    for (const item of Object.values(get().selectedMeta || {})) {
      const id = Number(item?.videoId)
      if (Number.isFinite(id) && id > 0) ids.add(id)
    }
    return Array.from(ids)
  },

  /* ---------------- 列表就地更新（改动单个视频后无需整页重拉） ---------------- */
  patchVideo: (key, patch) => {
    if (!key) return
    set((state) => ({
      videos: state.videos.map((item) =>
        videoKey(item) === key ? { ...item, ...(patch || {}) } : item
      ),
    }))
  },
  dropVideos: (keys) => {
    const drop = new Set(keys || [])
    if (drop.size === 0) return
    set((state) => {
      const videos = state.videos.filter((item) => !drop.has(videoKey(item)))
      return {
        videos,
        total: Math.max(0, Number(state.total || 0) - (state.videos.length - videos.length)),
      }
    })
  },

  /* ---------------- 二级页导航栈（P1 起步，P2 的设置页复用） ---------------- */
  pages: [],
  pushPage: (type, payload = null) => set({ pages: [...get().pages, { type, payload }] }),
  popPage: () => set({ pages: get().pages.slice(0, -1) }),
  closeAllPages: () => set({ pages: [] }),

  /* ---------------- 设置区（P2） ---------------- */

  /**
   * 「我的」顶部概览卡的数字。
   *
   * 三个请求都只取 limit=1，用返回的 total 而不是把整页数据拉下来；
   * 任何一个失败都只让那一格显示「—」，不影响另外两格。
   */
  loadOverviewStats: async () => {
    const [videos, javs, directories] = await Promise.all([
      fetchVideos({ limit: 1, offset: 0 })
        .then((r) => r?.total ?? 0)
        .catch(() => null),
      fetchJavs({ limit: 1, offset: 0 })
        .then((r) => r?.total ?? 0)
        .catch(() => null),
      fetchDirectories()
        .then((list) => list.filter((d) => !d?.is_delete).length)
        .catch(() => null),
    ])
    return { videos, javs, directories }
  },

  /**
   * 保存全局设置。
   *
   * `PATCH /config` 是**部分更新**：只写请求体里出现的键。
   * 但注意后端的校验是「整个请求一起失败」—— 只要有一个键非法就 400，
   * 一个都不会写入。所以调用方必须保证每个值都经过范围校验。
   */
  saveConfig: async (patch) => {
    const cfg = await updateConfig(patch)
    const state = {}
    const size = parseInt(cfg?.video_page_size, 10)
    const sort = normalizeVideoSort(String(cfg?.video_sort || '').toLowerCase(), '')
    if (Number.isFinite(size) && size > 0) state.pageSize = Math.min(size, 500)
    if (sort) state.sort = sort
    state.hideJav = String(cfg?.video_hide_jav || '').toLowerCase() === 'true'
    state.config = cfg
    set(state)
    return cfg
  },
}))

export function videoKey(video) {
  if (!video) return ''
  if (video.location_id) return `loc:${video.location_id}`
  if (video.id) return `vid:${video.id}`
  return ''
}

export function videoMeta(video) {
  return {
    videoId: video?.id || null,
    locationId: video?.location_id || null,
    label: video?.filename || video?.path || `#${video?.id ?? ''}`,
  }
}
