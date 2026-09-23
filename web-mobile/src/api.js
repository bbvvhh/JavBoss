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

/* ---------------- 在线字幕（只写 JavBoss 自有 data/subtitle 目录） ----------------
 *
 * 后端把字幕下载到 <dataDir>/subtitle/<video_id>/，并把关联记录写进 javboss.db；
 * DELETE /videos/:id/subtitles/:subtitleId 只删这个目录下的文件和那一行记录，
 * 已核实 internal/service/subtitle_service.go 的路径来源是 dataDir，
 * 不会碰到用户媒体目录里的任何文件。
 */

export async function fetchVideoSubtitles(videoId) {
  const data = await requestJSON('GET', `/videos/${videoId}/subtitles`, { cache: 'no-store' })
  return {
    apiUrl: typeof data?.api_url === 'string' ? data.api_url : '',
    // 番号由服务端从 jav 表读出：前端的 video 对象不一定带 jav 关联。
    javCode: typeof data?.jav_code === 'string' ? data.jav_code : '',
    items: Array.isArray(data?.subtitles) ? data.subtitles : [],
  }
}

export async function searchVideoSubtitles(videoId, keyword = '') {
  return requestJSON('POST', `/videos/${videoId}/subtitles/search`, {
    body: { keyword: keyword || '' },
  })
}

export async function downloadVideoSubtitle(videoId, payload) {
  return requestJSON('POST', `/videos/${videoId}/subtitles/download`, { body: payload || {} })
}

export async function deleteVideoSubtitle(videoId, subtitleId) {
  await requestOK('DELETE', `/videos/${videoId}/subtitles/${subtitleId}`)
}

/** 取回已经转成 WebVTT 的字幕文本，交给 video.js 作为远程字幕轨加载。 */
export async function fetchVideoSubtitleVTT(videoId, subtitleId) {
  const res = await request('GET', `/videos/${videoId}/subtitles/${subtitleId}/file`, {
    cache: 'no-store',
  })
  if (!res.ok) throw await apiError(res)
  return res.text()
}

export async function testSubtitleEndpoint({ keyword, apiUrl = '' } = {}) {
  return requestJSON('POST', `/subtitles/search`, { body: { keyword, api_url: apiUrl } })
}

export async function startSubtitleBatchDownload({ overwrite = false, limit = 0 } = {}) {
  const data = await requestJSON('POST', `/subtitles/batch-download`, {
    body: { overwrite, limit },
  })
  return data?.status || null
}

export async function fetchSubtitleBatchStatus() {
  const data = await requestJSON('GET', `/subtitles/batch-download`, { cache: 'no-store' })
  return data?.status || null
}

export async function cancelSubtitleBatchDownload() {
  const data = await requestJSON('POST', `/subtitles/batch-download/cancel`)
  return data?.status || null
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

/**
 * 女优列表。
 *
 * `profileRanges` 是「资料范围筛选」，键名就是后端 parseJavIdolIntRange 认的
 * `idol_<key>_min` / `idol_<key>_max`（如 `idol_height_min`）。**两端必须成对
 * 出现**，只给一边后端直接 400，所以由调用方只传已启用、且 min ≤ max 的项。
 */
export async function fetchJavIdols({
  limit = 24,
  offset = 0,
  search = '',
  sort = '',
  profileRanges = [],
} = {}) {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  params.set('offset', String(offset))
  if (search) params.set('search', search)
  if (sort) params.set('sort', sort)
  for (const range of profileRanges) {
    params.set(`idol_${range.key}_min`, String(range.min))
    params.set(`idol_${range.key}_max`, String(range.max))
  }
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

/**
 * 后端把四类实体（jav / idol / studio / series）的「单个实体 ↔ 收藏夹」路由
 * 拆成了不同的路径（见 internal/server/api.go 的 registerJavFavoriteRoutes）：
 * 只有作品走 `/jav/items/:id`，系列是 `/jav/series/:id`，其余是 `/<type>s/:id`。
 *
 * 分支写成字面量模板串是**故意的**：api-safety 测试靠源码里的
 * `requestJSON('GET', \`...\`)` 形状扫描路由（见文件头注释），把路径塞进
 * 一个动态拼接的 helper 会让这两条路由脱离白名单检查。
 */
export async function fetchJavFavoriteGroupIDs(entityType, id) {
  const key = encodeURIComponent(id)
  const type = favoriteEntity(entityType)
  let data
  if (type === 'jav') {
    data = await requestJSON('GET', `/jav/items/${key}/favorite-groups`)
  } else if (type === 'series') {
    data = await requestJSON('GET', `/jav/series/${key}/favorite-groups`)
  } else {
    data = await requestJSON('GET', `/jav/${type}s/${key}/favorite-groups`)
  }
  return Array.isArray(data?.selected_group_ids)
    ? data.selected_group_ids.map((value) => Number(value)).filter((value) => value > 0)
    : []
}

/** 覆盖式保存该实体的收藏夹归属（取消勾选 = 移出）。 */
export async function replaceJavFavoriteGroups(entityType, id, groupIds) {
  const key = encodeURIComponent(id)
  const type = favoriteEntity(entityType)
  const body = {
    group_ids: (groupIds || []).map((value) => Number(value)).filter((value) => value > 0),
  }
  if (type === 'jav') {
    await requestOK('PUT', `/jav/items/${key}/favorite-groups`, { body })
  } else if (type === 'series') {
    await requestOK('PUT', `/jav/series/${key}/favorite-groups`, { body })
  } else {
    await requestOK('PUT', `/jav/${type}s/${key}/favorite-groups`, { body })
  }
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

/* ======================================================================
 * 设置区（P2）
 * ======================================================================
 *
 * 本节新增的接口全部满足 §0 的安全分类：
 *   - GET                 → 只读
 *   - PATCH/PUT/POST 到 /config、/directories、/tags、/jav、/storage、
 *     /downloader/settings、/auth/extension-tokens
 *                         → 只写 javboss.db 或 JavBoss 自己的 data/ 目录
 *
 * 以下接口**刻意不提供**，即使它们存在于 PC 端：
 *   - 目录整理（/directories/:id/process）→ 内部 os.Remove / os.Rename 用户文件
 *   - 删除视频文件位置（DELETE /videos/:id/locations/:id）→ 物理删除
 *   - 在文件管理器里打开 / 定位（/videos/open、/videos/reveal）→ 桌面端能力
 *   - 在系统文件管理器里定位下载目录（/downloads/:id/reveal）→ 桌面端能力
 *
 * 「删除目录」在 PC 端就是 `PATCH /directories/:id {is_delete:true}`（软删记录），
 * 不是物理删除，所以可以安全复用 —— 见 deleteDirectory()。
 */

/* ---------------- 配置（PATCH 是部分更新，只提交改动的字段） ---------------- */

export async function updateConfig(payload) {
  return requestJSON('PATCH', `/config`, { body: payload || {} })
}

/* ---------------- 认证 ---------------- */

export async function changePassword(currentPassword, newPassword) {
  await requestOK('PUT', `/auth/password`, {
    body: { current_password: currentPassword, new_password: newPassword },
  })
}

/* ---------------- 工具（只读 + 下载到 JavBoss 自己的 bin/ 目录） ---------------- */

export async function fetchTools() {
  return requestJSON('GET', `/tools`, { cache: 'no-store' })
}

export async function downloadFFmpeg() {
  return requestJSON('POST', `/tools/ffmpeg/download`)
}

/* ---------------- 目录管理 ---------------- */

export async function fetchDirectories() {
  const data = await requestJSON('GET', `/directories`, { cache: 'no-store' })
  return Array.isArray(data) ? data : []
}

export async function createDirectory({ path, kind = 'local', connectionId, remotePath } = {}) {
  return requestJSON('POST', `/directories`, {
    body: { path, kind, connection_id: connectionId, remote_path: remotePath },
  })
}

export async function browseDirectories(path = '', { showHidden = false, signal } = {}) {
  const params = new URLSearchParams({ path: String(path || ''), show_hidden: String(showHidden) })
  return requestJSON('GET', `/directories/browse?${params.toString()}`, {
    cache: 'no-store',
    signal,
  })
}

export async function updateDirectory(id, payload) {
  return requestJSON('PATCH', `/directories/${id}`, { body: payload || {} })
}

/** 软删除：只把目录记录标记为已删除，磁盘上的视频文件一个都不会动。 */
export async function deleteDirectory(id) {
  return updateDirectory(id, { is_delete: true })
}

export async function scanDirectory(id) {
  return requestJSON('POST', `/directories/${id}/scan`)
}

/* ---------------- 远程存储连接（WebDAV 等） ---------------- */

export async function fetchStorageConnections() {
  const data = await requestJSON('GET', `/storage/connections`, { cache: 'no-store' })
  return Array.isArray(data) ? data : (data?.items ?? [])
}

export async function createStorageConnection(payload) {
  return requestJSON('POST', `/storage/connections`, { body: payload || {} })
}

export async function updateStorageConnection(id, payload) {
  return requestJSON('PATCH', `/storage/connections/${id}`, { body: payload || {} })
}

export async function deleteStorageConnection(id) {
  return requestJSON('DELETE', `/storage/connections/${id}`)
}

export async function testStorageConnection({ connectionId, url, username, password, path } = {}) {
  return requestJSON('POST', `/storage/connections/test`, {
    body: { connection_id: connectionId, url, username, password, path },
  })
}

export async function browseStorageDirectories(
  connectionId,
  path = '',
  { showHidden = false, signal } = {}
) {
  const params = new URLSearchParams({
    connection_id: String(connectionId),
    path: String(path || ''),
    show_hidden: String(showHidden),
  })
  return requestJSON('GET', `/storage/browse?${params.toString()}`, { cache: 'no-store', signal })
}

/* ---------------- 下载器与任务 ---------------- */

export async function fetchDownloaderSettings() {
  return requestJSON('GET', `/downloader/settings`, { cache: 'no-store' })
}

export async function updateDownloaderSettings(payload) {
  return requestJSON('PUT', `/downloader/settings`, { body: payload || {} })
}

export async function updateCloudDrive2Settings(payload) {
  return requestJSON('PUT', `/downloader/clouddrive2`, { body: payload || {} })
}

export async function fetchCloudDrive2Token() {
  return requestJSON('GET', `/downloader/clouddrive2/token`, { cache: 'no-store' })
}

export async function testCloudDrive2(payload) {
  return requestJSON('POST', `/downloader/clouddrive2/test`, { body: payload || {} })
}

export async function fetchDownloadJobs({ limit = 20, offset = 0, signal } = {}) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  return requestJSON('GET', `/downloads?${params.toString()}`, { cache: 'no-store', signal })
}

export async function createDownloadJob({ magnetUrl } = {}) {
  return requestJSON('POST', `/downloads`, { body: { magnet_url: magnetUrl } })
}

export async function retryDownloadJob(id) {
  await requestOK('POST', `/downloads/${encodeURIComponent(id)}/retry`)
}

export async function cancelDownloadJob(id) {
  await requestOK('POST', `/downloads/${encodeURIComponent(id)}/cancel`)
}

/**
 * 删除下载任务**记录**。
 *
 * 已核实 internal/server/downloader_api.go:405-415 与 internal/db/download.go:313-325：
 * 这是一条带状态条件的 GORM Delete，只删 download_job 一行，
 * 不碰磁盘上任何文件 —— 下载完成的视频仍然留在下载目录里。
 * 所以移动端的文案必须写「删除记录」，不能写「删除文件」。
 */
export async function deleteDownloadJob(id) {
  // 204 No Content，不能用 requestJSON。
  await requestOK('DELETE', `/downloads/${encodeURIComponent(id)}`)
}

/* ---------------- 扩展令牌 ---------------- */

export async function fetchExtensionTokens() {
  const data = await requestJSON('GET', `/auth/extension-tokens`, { cache: 'no-store' })
  return Array.isArray(data) ? data : (data?.items ?? [])
}

export async function createExtensionToken(name, expiresInDays) {
  return requestJSON('POST', `/auth/extension-tokens`, {
    body: { name, expires_in_days: expiresInDays },
  })
}

export async function rotateExtensionToken(id, expiresInDays) {
  return requestJSON('POST', `/auth/extension-tokens/${id}/rotate`, {
    body: { expires_in_days: expiresInDays },
  })
}

export async function deleteExtensionToken(id) {
  // 后端返回 204 No Content（空 body），不能用 requestJSON —— res.json() 会抛。
  await requestOK('DELETE', `/auth/extension-tokens/${id}`)
}

/* ---------------- 视频标签与分类（只写数据库） ---------------- */

export async function fetchTagCategories() {
  const data = await requestJSON('GET', `/tags/categories`)
  return Array.isArray(data) ? data : (data?.items ?? [])
}

export async function createTagCategory(name) {
  return requestJSON('POST', `/tags/categories`, { body: { name } })
}

export async function renameTagCategory(id, name) {
  await requestOK('PATCH', `/tags/categories/${id}`, { body: { name } })
}

export async function deleteTagCategory(id) {
  await requestOK('DELETE', `/tags/categories/${id}`)
}

/** 顺序就是数组顺序；移动端用上/下移按钮整体提交，不做拖拽。 */
export async function reorderTagCategories(categoryIds) {
  await requestOK('PUT', `/tags/categories/order`, { body: { category_ids: categoryIds } })
}

export async function assignTagsCategory(tagIds, categoryId) {
  await requestOK('POST', `/tags/category`, { body: { tag_ids: tagIds, category_id: categoryId } })
}

export async function renameTag(id, name) {
  await requestOK('PATCH', `/tags/${id}`, { body: { name } })
}

export async function deleteTag(id) {
  await requestOK('DELETE', `/tags/${id}`)
}

export async function deleteTagsBatch(tagIds) {
  await requestOK('POST', `/tags/batch_delete`, { body: { tag_ids: tagIds } })
}

/* ---------------- JAV 标签与分类（只写数据库） ---------------- */

export async function fetchJavTagCategories() {
  const data = await requestJSON('GET', `/jav/tag-categories`)
  return Array.isArray(data) ? data : (data?.items ?? [])
}

export async function createJavTagCategory(name) {
  return requestJSON('POST', `/jav/tag-categories`, { body: { name } })
}

export async function renameJavTagCategory(id, name) {
  await requestOK('PATCH', `/jav/tag-categories/${id}`, { body: { name } })
}

export async function deleteJavTagCategory(id) {
  await requestOK('DELETE', `/jav/tag-categories/${id}`)
}

export async function reorderJavTagCategories(categoryIds) {
  await requestOK('PUT', `/jav/tag-categories/order`, { body: { category_ids: categoryIds } })
}

export async function createJavTag(name) {
  return requestJSON('POST', `/jav/tags`, { body: { name } })
}

export async function renameJavTag(id, name) {
  await requestOK('PATCH', `/jav/tags/${id}`, { body: { name } })
}

export async function deleteJavTag(id) {
  await requestOK('DELETE', `/jav/tags/${id}`)
}

export async function deleteJavTagsBatch(tagIds) {
  await requestOK('POST', `/jav/tags/batch_delete`, { body: { tag_ids: tagIds } })
}

export async function assignJavTagsCategory(tagIds, categoryId) {
  await requestOK('POST', `/jav/tags/category`, {
    body: { tag_ids: tagIds, category_id: categoryId },
  })
}

/** 按现有分类规则把无分类的 JAV 标签归类；只动数据库。 */
export async function organizeJavTags() {
  return requestJSON('POST', `/jav/tags/organize`)
}

/* ---------------- JAV 收藏夹（4 类实体：jav / idol / studio / series） ---------------- */

const FAVORITE_ENTITIES = ['jav', 'idol', 'studio', 'series']

function favoriteEntity(entityType) {
  const value = String(entityType || '').trim()
  return FAVORITE_ENTITIES.includes(value) ? value : 'jav'
}

export async function createJavFavoriteGroup(entityType, name) {
  return requestJSON('POST', `/jav/${favoriteEntity(entityType)}-favorite-groups`, {
    body: { name },
  })
}

export async function renameJavFavoriteGroup(entityType, id, name) {
  await requestOK('PATCH', `/jav/${favoriteEntity(entityType)}-favorite-groups/${id}`, {
    body: { name },
  })
}

export async function deleteJavFavoriteGroup(entityType, id) {
  await requestOK('DELETE', `/jav/${favoriteEntity(entityType)}-favorite-groups/${id}`)
}

export async function reorderJavFavoriteGroups(entityType, groupIds) {
  await requestOK('PUT', `/jav/${favoriteEntity(entityType)}-favorite-groups/order`, {
    body: { group_ids: groupIds },
  })
}

export async function fetchJavFavoriteGroupItems(entityType, id) {
  const data = await requestJSON(
    'GET',
    `/jav/${favoriteEntity(entityType)}-favorite-groups/${id}/items`
  )
  return Array.isArray(data) ? data : (data?.items ?? [])
}

export async function reorderJavFavoriteGroupItems(entityType, id, entityIds) {
  await requestOK('PUT', `/jav/${favoriteEntity(entityType)}-favorite-groups/${id}/item-order`, {
    body: { entity_ids: entityIds },
  })
}

export async function removeJavFavoriteGroupItems(entityType, id, entityIds) {
  await requestOK('POST', `/jav/${favoriteEntity(entityType)}-favorite-groups/${id}/items/remove`, {
    body: { entity_ids: entityIds },
  })
}
