/**
 * JavBoss 移动端 API 层
 *
 * ⚠️ @api-safety-guard —— 修改本文件前必读（详见 design/DESIGN.md §0）
 *
 * 移动端只允许三类请求：
 *   1. 只读请求（GET）
 *   2. 只写数据库的请求（标签、收藏、刮削元数据、从媒体库移除）
 *   3. 只写 JavBoss 自有 data/ 目录的请求（缩略图、截图、封面）
 *
 * 绝对禁止（会让用户丢失视频文件，用户明确要求「任何时候不允许删除视频文件」）：
 *   - DELETE /videos/:id/locations/:locationId   在 Linux/macOS 上是 os.Remove，永久删除
 *   - POST   /directories/:id/process            目录整理，内部含 os.Remove / os.Rename
 *   - POST   /videos/open, /videos/reveal        桌面端能力，移动端无意义
 *
 * 唯一允许触碰用户媒体目录的接口是「重命名文件」：
 *   PATCH /videos/:id/locations/:locationId   → renameVideoLocation()
 * 它只允许在 components/RenamePage.jsx 里调用，且必须经过 diff 预览 + 显式确认。
 * api-safety.test.js 会断言除 RenamePage.jsx 外没有别的文件引用它。
 *
 * 关于 deleteVideoScreenshot()：它删的是 JavBoss 自己生成的截图。
 * 已核实 internal/server/video_api.go:1742-1798：路径被限制在
 * <dataDir>/video/<id>/screenshot/ 下，且文件名必须匹配 mpv_*.<jpg|jpeg|png|webp>，
 * 不可能碰到用户媒体目录里的任何文件。
 *
 * tests/api-safety.test.js 会扫描本文件强制执行以上约束。
 * 所有请求都必须写成 request('<METHOD>', `<path>`) 或 requestJSON('<METHOD>', `<path>`)
 * 的形式，否则安全测试无法扫描到。
 */
import { zh } from '@/utils/i18n'
import { getErrorMessage } from '@/utils/errors'

const jsonHeaders = { 'Content-Type': 'application/json' }
export const authExpiredEvent = 'javboss:auth-expired'

async function apiError(res) {
  const payload = await res.json().catch(() => ({}))
  return new Error(
    getErrorMessage(zh(String(payload.error_zh || ''), String(payload.error_en || '')))
  )
}

async function request(method, path, { body, signal, cache } = {}) {
  const init = { method }
  if (cache) init.cache = cache
  if (signal) init.signal = signal
  if (body !== undefined) {
    init.headers = jsonHeaders
    init.body = JSON.stringify(body)
  }
  const res = await fetch(path, init)
  if (res.status === 401 && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(authExpiredEvent))
  }
  return res
}

async function requestJSON(method, path, options) {
  const res = await request(method, path, options)
  if (!res.ok) throw await apiError(res)
  return res.json()
}

async function requestOK(method, path, options) {
  const res = await request(method, path, options)
  if (!res.ok) throw await apiError(res)
}

/* ---------------- 认证 ---------------- */

export async function fetchAuthStatus() {
  const res = await request('GET', `/auth/status`, { cache: 'no-store' })
  if (!res.ok) throw await apiError(res)
  return res.json()
}

export async function loginWithPassword(password) {
  return requestJSON('POST', `/auth/login`, { body: { password } })
}

export async function logoutSession() {
  const res = await request('POST', `/auth/logout`)
  if (!res.ok && res.status !== 401) throw await apiError(res)
}

/* ---------------- 配置 ---------------- */

export async function fetchConfig() {
  return requestJSON('GET', `/config`)
}

/* ---------------- 视频列表 ---------------- */

export async function fetchVideos({
  limit = 25,
  offset = 0,
  tags = [],
  search = '',
  sort = '',
  seed = null,
  hideJav = false,
  signal,
} = {}) {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  params.set('offset', String(offset))
  if (tags.length) params.set('tags', tags.join(','))
  if (search) params.set('search', search)
  if (sort) params.set('sort', sort)
  if (seed != null) params.set('seed', String(seed))
  params.set('hide_jav', hideJav ? '1' : '0')
  return requestJSON('GET', `/videos?${params.toString()}`, { signal })
}

export async function fetchTags() {
  return requestJSON('GET', `/tags`)
}

/* ---------------- 播放 ---------------- */

export async function fetchPlaybackInfo(id, { locationId } = {}) {
  const params = new URLSearchParams()
  if (locationId) params.set('location_id', String(locationId))
  return requestJSON('GET', `/videos/${id}/streams?${params.toString()}`)
}

export async function incrementVideoPlayCount(id) {
  await requestOK('POST', `/videos/${id}/play`)
}

/* ---------------- 标签（只写数据库） ---------------- */

export async function createTag(name) {
  return requestJSON('POST', `/tags`, { body: { name } })
}

export async function addTagToVideos(tagId, videoIds) {
  await requestOK('POST', `/videos/tags/add`, {
    body: { tag_id: tagId, video_ids: videoIds },
  })
}

export async function removeTagFromVideos(tagId, videoIds) {
  await requestOK('POST', `/videos/tags/remove`, {
    body: { tag_id: tagId, video_ids: videoIds },
  })
}

export async function replaceTagsForVideos(videoIds, tagIds) {
  await requestOK('POST', `/videos/tags/replace`, {
    body: { video_ids: videoIds, tag_ids: tagIds },
  })
}

/* ---------------- 截图与封面（只动 JavBoss 自有 data/ 目录） ---------------- */

export async function fetchVideoScreenshots(id) {
  const data = await requestJSON('GET', `/videos/${id}/screenshots`, { cache: 'no-store' })
  return Array.isArray(data?.items) ? data.items : []
}

export async function createVideoScreenshot(id, { second = 0, locationId } = {}) {
  const params = new URLSearchParams()
  if (locationId) params.set('location_id', String(locationId))
  return requestJSON('POST', `/videos/${id}/screenshots?${params.toString()}`, {
    body: { second },
  })
}

export async function deleteVideoScreenshot(videoId, name) {
  await requestOK('DELETE', `/videos/${videoId}/screenshots/${encodeURIComponent(name)}`)
}

export async function updateVideoCover(videoId, screenshotName) {
  return requestJSON('PUT', `/videos/${videoId}/cover`, {
    body: { screenshot_name: screenshotName },
  })
}

export async function resetVideoCover(videoId) {
  return requestJSON('DELETE', `/videos/${videoId}/cover`)
}

/* ---------------- 刮削设置（只写数据库） ---------------- */

export async function updateVideoJavScrapeSettings(videoId, { mode = 'auto', code = '' } = {}) {
  return requestJSON('PATCH', `/videos/${videoId}/jav-scrape`, { body: { mode, code } })
}

export async function fetchVideoJavScrapePossibleCodes(videoId) {
  return requestJSON('GET', `/videos/${videoId}/jav-scrape/possible-codes`)
}

export async function manualVideoJavScrape(videoId, locationId, info) {
  return requestJSON('POST', `/videos/${videoId}/jav-scrape/manual`, {
    body: { ...(info || {}), location_id: locationId },
  })
}

export async function linkVideoToExistingJav(videoId, locationId, code) {
  return requestJSON('POST', `/videos/${videoId}/jav-scrape/link`, {
    body: { location_id: locationId, code },
  })
}

/* ---------------- 从媒体库移除（仅改数据库，绝不动文件） ---------------- */

// 需要后端新增 POST /videos/locations/hide（P3 落地）。
// 在此之前调用会得到 404，UI 会把错误如实展示，不会误以为已删除。
export async function hideVideoLocations(locationIds) {
  return requestJSON('POST', `/videos/locations/hide`, {
    body: { location_ids: locationIds },
  })
}

/* ---------------- 重命名文件（唯一会写媒体目录的接口） ----------------
 *
 * ⚠️ 只允许在 components/RenamePage.jsx 中调用。
 * 调用前必须让用户看到「旧名 → 新名」diff 并显式确认；不提供任何批量入口。
 *
 * 后端已有三重防护（internal/server/video_api.go:676-800）：
 *   1. 文件名非法（含路径分隔符）→ 400
 *   2. 目标路径已在数据库 → 409
 *   3. 目标文件已存在 → 409（绝不覆盖）
 *   4. 数据库写入失败 → 自动把文件改回原名
 */
export async function renameVideoLocation(videoId, locationId, filename) {
  return requestJSON('PATCH', `/videos/${videoId}/locations/${locationId}`, {
    body: { filename },
  })
}

/* ---------------- JAV ---------------- */

export async function fetchJavs({
  limit = 24,
  offset = 0,
  search = '',
  idolIds = [],
  tagIds = [],
  studioId = null,
  seriesId = null,
  prefix = '',
  soloOnly = false,
  favoriteRatingEnabled = false,
  favoriteRatingMin = 0.5,
  favoriteRatingMax = 5,
  favoriteGroupId = null,
  sort = '',
  seed = null,
} = {}) {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  params.set('offset', String(offset))
  if (search) params.set('search', search)
  if (idolIds.length) params.set('idol_ids', idolIds.join(','))
  if (tagIds.length) params.set('tag_ids', tagIds.join(','))
  if (studioId !== null && studioId !== undefined) params.set('studio_id', String(studioId))
  if (seriesId) params.set('series_id', String(seriesId))
  if (prefix) params.set('prefix', prefix)
  if (soloOnly) params.set('solo', '1')
  if (favoriteGroupId) params.set('favorite_group_id', String(favoriteGroupId))
  if (favoriteRatingEnabled) {
    params.set('favorite_rating_min', String(favoriteRatingMin))
    params.set('favorite_rating_max', String(favoriteRatingMax))
  }
  if (sort) params.set('sort', sort)
  if (seed != null) params.set('seed', String(seed))
  return requestJSON('GET', `/jav?${params.toString()}`)
}

/** 筛选候选（前缀 / 女优 / 标签 / 片商 / 系列），count 是叠加后的命中数。 */
export async function fetchJavFilterOptions({
  search = '',
  idolIds = [],
  tagIds = [],
  studioId = null,
  seriesId = null,
  prefix = '',
  soloOnly = false,
  optionLimit = 80,
} = {}) {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (idolIds.length) params.set('idol_ids', idolIds.join(','))
  if (tagIds.length) params.set('tag_ids', tagIds.join(','))
  if (studioId !== null && studioId !== undefined) params.set('studio_id', String(studioId))
  if (seriesId) params.set('series_id', String(seriesId))
  if (prefix) params.set('prefix', prefix)
  if (soloOnly) params.set('solo', '1')
  params.set('option_limit', String(optionLimit))
  return requestJSON('GET', `/jav/filter-options?${params.toString()}`)
}

export async function fetchJavTags() {
  return requestJSON('GET', `/jav/tags`)
}

export async function fetchJavIdols({ limit = 24, offset = 0, search = '', sort = '' } = {}) {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  params.set('offset', String(offset))
  if (search) params.set('search', search)
  if (sort) params.set('sort', sort)
  return requestJSON('GET', `/jav/idols?${params.toString()}`)
}

export async function fetchJavStudios({ limit = 24, offset = 0, search = '' } = {}) {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  params.set('offset', String(offset))
  if (search) params.set('search', search)
  return requestJSON('GET', `/jav/studios?${params.toString()}`)
}

export async function fetchJavSeries({ limit = 24, offset = 0, search = '' } = {}) {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  params.set('offset', String(offset))
  if (search) params.set('search', search)
  return requestJSON('GET', `/jav/series?${params.toString()}`)
}

export async function fetchJavFavoriteGroups(entityType = 'jav') {
  const data = await requestJSON('GET', `/jav/${entityType}-favorite-groups`)
  return Array.isArray(data?.items) ? data.items : []
}

export async function addJavsToFavoriteGroups(javIds, groupIds) {
  return requestJSON('POST', `/jav/items/favorite-groups/add`, {
    body: { jav_ids: javIds, group_ids: groupIds },
  })
}

export async function updateJavItem(id, payload) {
  return requestJSON('PUT', `/jav/items/${encodeURIComponent(id)}`, { body: payload || {} })
}

export async function resolveJavSampleImages(id) {
  const data = await requestJSON('POST', `/jav/items/${encodeURIComponent(id)}/sample-images`, {
    cache: 'no-store',
  })
  return Array.isArray(data?.sample_images) ? data.sample_images : []
}
