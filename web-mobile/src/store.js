import { create } from 'zustand'

import {
  fetchVideos,
  fetchTags,
  fetchConfig,
  fetchDirectories,
  fetchJavs,
  fetchJavIdol,
  fetchJavFilterOptions,
  fetchJavFavoriteGroups,
  updateConfig,
} from '@/api'
import { normalizeVideoSort } from '@/constants/video'
import {
  createDefaultIdolProfileFilters,
  createDefaultIdolRatingFilter,
  normalizeIdolProfileFilters,
  normalizeIdolRatingFilter,
  normalizeIdolSort,
  normalizeJavDensity,
  normalizeJavSort,
} from '@/constants/jav'
import { initialViewMode } from '@/utils/javDisplay'
import { configFlag } from '@/utils/config'
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
const RANDOM_SEED_MAX = 2147483646

/** 随机模式用 `sort=random&seed=N` 让「随机但分页稳定」；每次进入随机都要换一个新种子。 */
function nextRandomSeed() {
  return Math.floor(Math.random() * RANDOM_SEED_MAX) + 1
}

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
    set({ randomSeed: nextRandomSeed() })
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
      // 「默认随机展示」（缺省开启）：首次进入视频 / JAV 作品列表就按随机顺序展示，
      // 用户随时可以点随机 chip 退出，退出后不会在本次会话里被重新打开。
      if (configFlag(cfg, 'default_random', true)) {
        patch.randomSeed = nextRandomSeed()
        patch.javRandomSeed = nextRandomSeed()
      }
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
  player: null, // { video, list, startTime, jav }
  // startTime：从预览图（截图）跳进来时的起始进度；0 表示续播本机记录的上次进度。
  // jav：当前视频关联的 JAV 作品（播放页「查看详情」入口用）。JAV 模式从作品卡直接
  // 播放时，视频对象取自作品的 videos，并不带 video.jav，所以这里显式把它传进来。
  openPlayer: (video, list, startTime = 0, jav = null) =>
    set({ player: { video, list: list || get().videos, startTime, jav } }),
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
  rollJavRandom: () => set({ javRandomSeed: nextRandomSeed() }),
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

  /**
   * 女优页的排序与资料筛选。
   *
   * `idolSort` 是**临时排序**：空字符串表示沿用全局设置里的 `idol_sort`（与 PC 端
   * 的 idolTempSort 同义），所以这里不能用 normalizeIdolSort 的 'work' 兜底。
   * 作品页那一整套排序 / 筛选（javSort、javFilters）只对作品生效，两者互不干扰。
   */
  idolSort: '',
  setIdolSort: (value) => set({ idolSort: normalizeIdolSort(value, '') }),
  idolProfileFilters: createDefaultIdolProfileFilters(),
  setIdolProfileFilters: (filters) =>
    set({ idolProfileFilters: normalizeIdolProfileFilters(filters) }),
  // 女优喜爱度区间：与作品的 favoriteRating 同构（0.5 一档、闭区间），
  // 对应后端 `idol_rating_min` / `idol_rating_max`。
  idolRatingFilter: createDefaultIdolRatingFilter(),
  setIdolRatingFilter: (value) => set({ idolRatingFilter: normalizeIdolRatingFilter(value) }),
  resetIdolControls: () =>
    set({
      idolSort: '',
      idolProfileFilters: createDefaultIdolProfileFilters(),
      idolRatingFilter: createDefaultIdolRatingFilter(),
    }),

  /**
   * 作品 / 女优列表的「就地补丁」。
   *
   * 列表数据由 JavListPage 自己持有（无限滚动），详情页拿到的是压栈时的那份
   * 拷贝 —— 在详情页改喜爱度 / 收藏夹之后，返回列表必须能看到新值，否则用户
   * 会以为没保存。这里按 `类型:id` 记增量，列表渲染时合并即可。
   *
   * 键必须带类型前缀：作品与女优是两张表，各自的 id 会撞车。
   */
  javItemPatches: {},
  patchJavItem: (id, patch) => {
    const key = javPatchKey(id)
    if (!key || !patch) return
    set((state) => ({
      javItemPatches: {
        ...state.javItemPatches,
        [key]: { ...state.javItemPatches[key], ...patch },
      },
    }))
  },
  patchJavIdol: (id, patch) => {
    const key = idolPatchKey(id)
    if (!key || !patch) return
    set((state) => ({
      javItemPatches: {
        ...state.javItemPatches,
        [key]: { ...state.javItemPatches[key], ...patch },
      },
    }))
  },

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
   * 列表重拉信号。
   *
   * JavListPage 的列表数据是自己的本地状态（无限滚动），批量改完标签后
   * 需要它主动重拉一次才能看到新标签，但又没法从外部直接调它的 load()，
   * 于是用一个自增计数当作 effect 依赖。
   */
  javListVersion: 0,
  bumpJavListVersion: () => set((state) => ({ javListVersion: state.javListVersion + 1 })),

  /**
   * 从女优 / 片商 / 系列跳转到「对应的影片」。
   * 行为刻意做成可预测的：切到作品 tab、用传入的条件**替换**整套筛选、退出随机、
   * 露出作品列表并回到顶部。用户随后可以在「筛选」抽屉里看到并清掉这些条件。
   *
   * 从二级页（作品 / 女优详情）跳进来时，不能直接把页面栈清空：清空会让
   * `useStackBack` 去收缩浏览器历史，正好把「返回」该回去的那条记录消耗掉 ——
   * 手势返回于是越过详情页直接退出到浏览器上一页。这里改成在栈顶压一个
   * `jav-works` 占位页（不渲染任何内容，列表露在它下面），把跳转前的列表状态
   * 存在它身上，返回时由 popPage 弹掉并还原，详情页就回来了。
   */
  jumpToJavWorks: (patch = {}) => {
    const state = get()
    const pages = state.pages.length
      ? [
          ...state.pages,
          {
            type: 'jav-works',
            payload: {
              restore: {
                javTab: state.javTab,
                javFilters: state.javFilters,
                javRandomSeed: state.javRandomSeed,
              },
            },
          },
        ]
      : state.pages
    set({
      javTab: 'works',
      javFilters: { ...EMPTY_JAV_FILTERS, ...patch },
      javRandomSeed: null,
      pages,
    })
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'auto' })
  },

  /**
   * 打开女优详情页。
   *
   * 作品卡 / 作品详情里的演员来自 `/jav` 列表，只有 `{ id, name, ... }`，缺封面、
   * 作品数、三围等详情页要用的 enrich 字段，直接压栈会得到一张没有封面的详情页。
   * 这里先按 id 取一次完整资料再合并；取不到就沿用列表里的快照，至少保证能进页。
   */
  openJavIdol: async (idol) => {
    const id = Number(idol?.id)
    if (!Number.isFinite(id) || id <= 0) return
    let payload = idol
    try {
      const full = await fetchJavIdol(id)
      if (full && typeof full === 'object') payload = { ...idol, ...full }
    } catch {
      /* 拉取失败仍用列表里的快照进页 */
    }
    set({ pages: [...get().pages, { type: 'jav-idol', payload }] })
  },

  /**
   * 打开 JAV 作品详情页（播放页「查看详情」入口用）。
   *
   * 播放页上的作品信息（`video.jav`）只是列表里的快照：有 id / code / 片商 / 演员，
   * 缺详情页要展示的「库内文件」「标签」「收藏夹数」，而 JAV 模式从作品卡播放时连
   * 快照都没有。后端又没有「按 id 取单条作品」的接口，所以用 code 搜一次、按 id 精确
   * 命中后再压栈；搜不到就退回快照，至少能进页，只是库内文件 / 标签为空。
   *
   * 若栈顶已经是同一部作品的详情页（例如播放器就是从详情页开起来的），就不再压一层：
   * 关掉播放器，底下那页正好露出来，返回一次即可回到它。
   */
  openJavDetail: async (jav) => {
    const id = Number(jav?.id) || 0
    const code = String(jav?.code || '').trim()
    if (!id && !code) return
    const top = get().pages[get().pages.length - 1] || null
    if (id > 0 && top?.type === 'jav-detail' && Number(top.payload?.id) === id) return
    let payload = jav
    if (code) {
      try {
        const resp = await fetchJavs({ search: code, limit: 20 })
        const items = Array.isArray(resp?.items) ? resp.items : []
        const match =
          (id > 0 ? items.find((item) => Number(item?.id) === id) : null) ||
          items.find(
            (item) =>
              String(item?.code || '')
                .trim()
                .toLowerCase() === code.toLowerCase()
          )
        if (match) payload = match
      } catch {
        /* 拉取失败仍用快照进页 */
      }
    }
    set({ pages: [...get().pages, { type: 'jav-detail', payload }] })
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
  actionSheetOptions: {},
  openActionSheet: (video, options = {}) =>
    set({ actionSheetVideo: video, actionSheetOptions: options || {} }),
  closeActionSheet: () => set({ actionSheetVideo: null, actionSheetOptions: {} }),

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

  /**
   * 所选视频关联的 JAV 作品 id（去重）。
   *
   * 「批量加 JAV 标签」实际是打在作品的 JAV 记录上，而未刮削 / 未关联的视频
   * 没有 JAV 可打，只能跳过 —— 调用方用返回值为空来判断「一个都打不了」。
   */
  selectedJavIds: () => {
    const meta = get().selectedMeta || {}
    const ids = new Set()
    for (const video of get().videos || []) {
      if (!meta[videoKey(video)]) continue
      const jav = video?.jav || video?.locations?.[0]?.jav || null
      const id = Number(jav?.id)
      if (Number.isFinite(id) && id > 0) ids.add(id)
    }
    return Array.from(ids)
  },

  /* ---------------- JAV 作品多选 ---------------- */

  /**
   * JAV 作品的多选与视频多选**分开存放**：两边的 id 空间不同（作品表 vs 视频表），
   * 而且用户可能先在视频模式选中若干项、再切到 JAV 模式，共用一份状态会串数据。
   *
   * 这里只存作品 id：批量加标签 / 加收藏夹接口要的就是 id 数组，不需要额外元信息。
   */
  javSelectionMode: false,
  javSelectedIds: new Set(),
  /** 当前已加载的作品 id，由 JavListPage 同步，供「全选」使用（对应视频模式的 videos）。 */
  javSelectableIds: [],

  setJavSelectable: (items) => {
    const ids = (items || [])
      .map((item) => Number(item?.id))
      .filter((id) => Number.isFinite(id) && id > 0)
    const current = get().javSelectableIds
    // 无限滚动每加载一页都会重跑这个同步；逐项比较没必要，首尾 + 长度一致就认为没变。
    // 少了这层短路，set → 重渲染 → effect → set 会转成死循环。
    if (
      current.length === ids.length &&
      current[0] === ids[0] &&
      current[current.length - 1] === ids[ids.length - 1]
    ) {
      return
    }
    set({ javSelectableIds: ids })
  },

  enterJavSelection: (item) => {
    const id = javSelectionId(item)
    if (!id) return
    set({ javSelectionMode: true, javSelectedIds: new Set([id]) })
  },
  exitJavSelection: () => set({ javSelectionMode: false, javSelectedIds: new Set() }),
  toggleJavSelection: (item) => {
    const id = javSelectionId(item)
    if (!id) return
    const ids = new Set(get().javSelectedIds)
    if (ids.has(id)) ids.delete(id)
    else ids.add(id)
    set({ javSelectedIds: ids })
  },
  selectAllJavs: () => set({ javSelectedIds: new Set(get().javSelectableIds) }),
  clearJavSelection: () => set({ javSelectedIds: new Set() }),
  javSelectedIdList: () => Array.from(get().javSelectedIds),

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

  /**
   * 出栈。`jav-works` 是「筛选结果」占位页（见 jumpToJavWorks）：它本身不渲染
   * 任何东西，返回时除了弹栈还要还原跳转前的列表状态，否则详情页回来时底下的
   * 筛选条件会停留在女优条件上。
   */
  popPage: () => {
    const { pages } = get()
    const top = pages[pages.length - 1]
    const rest = pages.slice(0, -1)
    if (top?.type === 'jav-works' && top.payload?.restore) {
      set({ ...top.payload.restore, pages: rest })
      return
    }
    set({ pages: rest })
  },
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

/** `javItemPatches` 的键：作品。 */
export function javPatchKey(id) {
  const value = Number(id)
  return Number.isFinite(value) && value > 0 ? `jav:${value}` : ''
}

/** JAV 作品多选用的一元键：作品主键，非法值返回空串（调用方据此忽略）。 */
export function javSelectionId(item) {
  const value = Number(item?.id)
  return Number.isFinite(value) && value > 0 ? value : ''
}

/** `javItemPatches` 的键：女优。 */
export function idolPatchKey(id) {
  const value = Number(id)
  return Number.isFinite(value) && value > 0 ? `idol:${value}` : ''
}

export function videoMeta(video) {
  return {
    videoId: video?.id || null,
    locationId: video?.location_id || null,
    label: video?.filename || video?.path || `#${video?.id ?? ''}`,
  }
}
