/**
 * 筛选状态 ⇄ 地址栏（点 5）。
 *
 * 移动端没有路由，页面栈是 `useStackBack` 用 pushState 自己维护的，所以这里只做
 * 两件事：进页面时按 URL 复原筛选条件、之后把筛选条件写回地址栏。刷新 / 从收藏夹
 * 打开同一个链接就能回到同样的列表，而不是每次都被打回默认状态。
 *
 * 约定：
 *   - **只写当前视图的参数**（和 PC 端 `buildUrlFromState` 一致）。切视图时另一个
 *     视图的条件本来也留在 store 里，URL 不必替它记一份，键名也就不会打架。
 *   - 排序 / 喜爱度 / 随机种子这些值都要先归一化再落地：URL 是可以手改的，
 *     非法值一律当作「没写」，由设置里的默认值兜底。
 */

import {
  IDOL_PROFILE_FILTER_DEFINITIONS,
  normalizeIdolProfileFilters,
  normalizeIdolRatingFilter,
  normalizeIdolSort,
  normalizeJavSort,
} from '@/constants/jav'
import { normalizeVideoSort } from '@/constants/video'
import { EMPTY_JAV_FILTERS } from '@/store'

const RANDOM_SEED_MAX = 2147483646

export const JAV_TAB_VALUES = ['works', 'idols', 'studios', 'series']

/** 随机模式的种子：与 store 里 `nextRandomSeed` 同一套取值，URL 里缺种子时现摇一个。 */
export function generateRandomSeed() {
  return Math.floor(Math.random() * RANDOM_SEED_MAX) + 1
}

function clampSeed(raw) {
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.min(Math.floor(value), RANDOM_SEED_MAX)
}

/** 字符串或数组 → 去重后的正整数 id 列表。 */
function toIdList(value) {
  const list = Array.isArray(value) ? value : String(value ?? '').split(',')
  const ids = list
    .map((item) => Number.parseInt(String(item).trim(), 10))
    .filter((id) => Number.isFinite(id) && id > 0)
  return Array.from(new Set(ids))
}

/** 视频标签在移动端是按**名字**筛选的（store.selectedTags），所以 URL 里也存名字。 */
function toTagNames(value) {
  const list = Array.isArray(value) ? value : []
  const names = list.map((item) => String(item ?? '').trim()).filter(Boolean)
  return Array.from(new Set(names))
}

function parseText(raw) {
  return String(raw ?? '').trim()
}

/** 三态：没写 → null，写了 → true / false。没写时保留设置里的值。 */
function parseFlag(raw) {
  if (raw === '1') return true
  if (raw === '0') return false
  return null
}

function parsePositiveInt(raw) {
  const value = Number.parseInt(String(raw ?? '').trim(), 10)
  return Number.isFinite(value) && value > 0 ? value : null
}

function parseJavPrefix(raw) {
  const value = parseText(raw).toUpperCase()
  return /^[A-Z0-9]+$/.test(value) ? value : ''
}

/** 喜爱度只有 0.5 一档，与后端 `favorite_rating` 的取值保持一致。 */
function parseFavoriteRating(raw) {
  const value = Number(parseText(raw))
  if (!Number.isFinite(value) || value < 0.5 || value > 5 || !Number.isInteger(value * 2)) {
    return null
  }
  return value
}

/** 作品筛选：只收集「写了且合法」的键，剩下的交给 `EMPTY_JAV_FILTERS` 补齐。 */
function parseJavFilters(sp) {
  const filters = {}
  const prefix = parseJavPrefix(sp.get('prefix'))
  if (prefix) filters.prefix = prefix

  const idolIds = toIdList(sp.get('idol_ids'))
  if (idolIds.length) filters.idolIds = idolIds

  const tagIds = toIdList(sp.get('tag_ids'))
  if (tagIds.length) filters.tagIds = tagIds

  const studioId = parsePositiveInt(sp.get('studio_id'))
  if (studioId) {
    filters.studioId = studioId
    filters.studioName = parseText(sp.get('studio_name'))
  }

  const seriesId = parsePositiveInt(sp.get('series_id'))
  if (seriesId) {
    filters.seriesId = seriesId
    filters.seriesName = parseText(sp.get('series_name'))
  }

  const groupId = parsePositiveInt(sp.get('fav_group_id'))
  if (groupId) {
    filters.favoriteGroupId = groupId
    filters.favoriteGroupName = parseText(sp.get('fav_group_name'))
  }

  if (sp.get('solo') === '1') filters.soloOnly = true

  // 只给一边的区间请求会被后端整单 400，所以两端都合法才启用。
  const min = parseFavoriteRating(sp.get('fav_min'))
  const max = parseFavoriteRating(sp.get('fav_max'))
  if (min !== null && max !== null && min <= max) {
    filters.favoriteRatingEnabled = true
    filters.favoriteRatingMin = min
    filters.favoriteRatingMax = max
  }

  return filters
}

/** 女优资料范围：同样只在两端都合法时才收集，返回 null 表示「URL 里没有」。 */
function parseIdolProfileFilters(sp) {
  const filters = {}
  for (const definition of IDOL_PROFILE_FILTER_DEFINITIONS) {
    const min = Number.parseInt(parseText(sp.get(`idol_${definition.key}_min`)), 10)
    const max = Number.parseInt(parseText(sp.get(`idol_${definition.key}_max`)), 10)
    if (!Number.isInteger(min) || !Number.isInteger(max)) continue
    if (min < definition.min || max > definition.max || min > max) continue
    filters[definition.key] = { enabled: true, min, max }
  }
  return Object.keys(filters).length ? filters : null
}

/**
 * 女优喜爱度区间：与作品 `fav_min/fav_max` 同一套校验（0.5~5、0.5 一档、闭区间），
 * 键名是 `idol_rating_min/max`。两端都合法才启用，否则返回 null。
 */
function parseIdolRatingFilter(sp) {
  const min = parseFavoriteRating(sp.get('idol_rating_min'))
  const max = parseFavoriteRating(sp.get('idol_rating_max'))
  if (min === null || max === null || min > max) return null
  return { enabled: true, min, max }
}

/**
 * 解析地址栏。空字符串 / 缺省一律视为「没写」，调用方据此保留设置里的默认值，
 * 而不是拿 `''` 去覆盖（否则刷新一次排序就被打回默认）。
 */
export function parseUrlState(searchString = '') {
  const sp = new URLSearchParams(String(searchString ?? ''))
  const rawView = sp.get('view')
  const view = rawView === 'jav' || rawView === 'video' ? rawView : null
  const rawTab = String(sp.get('tab') ?? '').trim()
  // `sort` / `random` / `seed` 是**共用键名**，但只属于 URL 里那个视图：视频的
  // `play_count_asc` 恰好也是合法的 JAV 排序值，两边都读会让切到 JAV 后排序串味
  // （随机种子同理会把视频的随机带到作品页）。
  const isJav = view === 'jav'
  const rawSort = parseText(sp.get('sort'))
  const random = sp.get('random') === '1'
  const seed = clampSeed(sp.get('seed'))

  return {
    view,
    search: parseText(sp.get('search')),
    video: {
      tags: toTagNames(sp.getAll('tags')),
      sort: isJav ? '' : normalizeVideoSort(rawSort, ''),
      hideJav: parseFlag(sp.get('hide_jav')),
      random: isJav ? false : random,
      seed: isJav ? null : seed,
    },
    jav: {
      tab: JAV_TAB_VALUES.includes(rawTab) ? rawTab : null,
      sort: isJav ? normalizeJavSort(rawSort, '') : '',
      idolSort: normalizeIdolSort(parseText(sp.get('idol_sort')), ''),
      random: isJav ? random : false,
      seed: isJav ? seed : null,
      filters: parseJavFilters(sp),
      idolProfileFilters: parseIdolProfileFilters(sp),
      idolRatingFilter: parseIdolRatingFilter(sp),
    },
  }
}

function appendJavFilters(sp, filters) {
  const f = filters && typeof filters === 'object' ? filters : {}
  const prefix = parseJavPrefix(f.prefix)
  if (prefix) sp.set('prefix', prefix)

  const idolIds = toIdList(f.idolIds)
  if (idolIds.length) sp.set('idol_ids', idolIds.join(','))

  const tagIds = toIdList(f.tagIds)
  if (tagIds.length) sp.set('tag_ids', tagIds.join(','))

  if (f.studioId) {
    sp.set('studio_id', String(f.studioId))
    if (f.studioName) sp.set('studio_name', parseText(f.studioName))
  }
  if (f.seriesId) {
    sp.set('series_id', String(f.seriesId))
    if (f.seriesName) sp.set('series_name', parseText(f.seriesName))
  }
  if (f.favoriteGroupId) {
    sp.set('fav_group_id', String(f.favoriteGroupId))
    if (f.favoriteGroupName) sp.set('fav_group_name', parseText(f.favoriteGroupName))
  }
  if (f.soloOnly) sp.set('solo', '1')
  if (f.favoriteRatingEnabled) {
    sp.set('fav_min', String(f.favoriteRatingMin))
    sp.set('fav_max', String(f.favoriteRatingMax))
  }
}

function appendIdolProfileFilters(sp, filters) {
  const normalized = normalizeIdolProfileFilters(filters)
  for (const definition of IDOL_PROFILE_FILTER_DEFINITIONS) {
    const value = normalized[definition.key]
    if (!value.enabled) continue
    sp.set(`idol_${definition.key}_min`, String(value.min))
    sp.set(`idol_${definition.key}_max`, String(value.max))
  }
}

function appendIdolRatingFilter(sp, filter) {
  const normalized = normalizeIdolRatingFilter(filter)
  if (!normalized.enabled) return
  sp.set('idol_rating_min', String(normalized.min))
  sp.set('idol_rating_max', String(normalized.max))
}

/**
 * store 状态 → 地址。随机模式下不写排序：那时排序由 seed 决定，写了反而误导。
 */
export function buildUrlFromState(state, basePath = '') {
  const sp = new URLSearchParams()
  const view = state?.view === 'jav' ? 'jav' : 'video'
  sp.set('view', view)

  const search = parseText(state?.searchTerm)
  if (search) sp.set('search', search)

  if (view === 'jav') {
    const tab = JAV_TAB_VALUES.includes(state?.javTab) ? state.javTab : 'works'
    if (tab !== 'works') sp.set('tab', tab)
    if (tab === 'works') {
      appendJavFilters(sp, state?.javFilters)
      const javSeed = clampSeed(state?.javRandomSeed)
      if (javSeed) {
        sp.set('random', '1')
        sp.set('seed', String(javSeed))
      } else {
        sp.set('sort', normalizeJavSort(state?.javSort, 'recent'))
      }
    } else if (tab === 'idols') {
      if (state?.idolSort) sp.set('idol_sort', normalizeIdolSort(state.idolSort, ''))
      appendIdolProfileFilters(sp, state?.idolProfileFilters)
      appendIdolRatingFilter(sp, state?.idolRatingFilter)
    }
  } else {
    for (const tag of toTagNames(state?.selectedTags)) sp.append('tags', tag)
    sp.set('hide_jav', state?.hideJav ? '1' : '0')
    const seed = clampSeed(state?.randomSeed)
    if (seed) {
      sp.set('random', '1')
      sp.set('seed', String(seed))
    } else {
      sp.set('sort', normalizeVideoSort(state?.sort, 'recent'))
    }
  }

  const query = sp.toString()
  return `${basePath ?? ''}${query ? `?${query}` : ''}`
}

/**
 * 解析结果 → 可直接 `setState` 的补丁。
 *
 * 只有 URL 真的写了某项才会出现在补丁里：设置里的默认值（排序、初始视图、默认随机）
 * 不能被「URL 没写」顺手清掉。
 */
export function urlStatePatch(parsed) {
  const patch = {}
  const video = parsed?.video || {}
  const jav = parsed?.jav || {}

  if (parsed?.view) patch.view = parsed.view
  if (parsed?.search) {
    patch.searchTerm = parsed.search
    patch.searchInput = parsed.search
  }

  if (video.tags?.length) patch.selectedTags = video.tags
  if (video.sort) patch.sort = video.sort
  if (video.hideJav !== null && video.hideJav !== undefined) patch.hideJav = video.hideJav
  if (video.random) patch.randomSeed = video.seed || generateRandomSeed()

  if (jav.tab) patch.javTab = jav.tab
  if (jav.sort) patch.javSort = jav.sort
  if (jav.random) patch.javRandomSeed = jav.seed || generateRandomSeed()
  if (jav.idolSort) patch.idolSort = jav.idolSort
  if (jav.filters && Object.keys(jav.filters).length) {
    patch.javFilters = { ...EMPTY_JAV_FILTERS, ...jav.filters }
  }
  if (jav.idolProfileFilters) {
    patch.idolProfileFilters = normalizeIdolProfileFilters(jav.idolProfileFilters)
  }
  if (jav.idolRatingFilter) {
    patch.idolRatingFilter = normalizeIdolRatingFilter(jav.idolRatingFilter)
  }

  return patch
}

/** 按 URL 复原 store（一次性，进页面时在拉列表之前调用）。 */
export function applyUrlState(store, parsed) {
  const patch = urlStatePatch(parsed)
  if (Object.keys(patch).length) store.setState(patch)
  return patch
}
