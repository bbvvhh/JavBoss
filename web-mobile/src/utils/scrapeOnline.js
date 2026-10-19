/**
 * 「在线刮削」纯工具函数。
 *
 * 单个视频的即时刮削：从元数据网站按番号抓取元数据（GET /videos/:id/jav-scrape/lookup），
 * 抓到的结果可以再走「手动刮削」接口落库。这里只放不依赖 React 的纯逻辑，便于单测。
 */

/** 后端 lookup 支持的来源（internal/server/video_api.go 的 parseVideoJavScrapeLookupProvider）。 */
export const SCRAPE_PROVIDERS = [
  { value: 'javbus', label: 'JavBus' },
  { value: 'avmoo', label: 'AvMoo' },
  { value: 'avsox', label: 'AVSOX' },
]

/** 与 PC 端一致的番号形状：字母/数字开头，只含字母、数字、- 和 _。 */
export const SCRAPE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]*$/

export function normalizeScrapeCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
}

export function isScrapeCodeValid(value) {
  return SCRAPE_CODE_PATTERN.test(normalizeScrapeCode(value))
}

/** 从「提取番号」结果里挑第一个可用番号（用于预填输入框）。 */
export function pickFirstPossibleCode(possible) {
  const list = Array.isArray(possible?.possible_codes) ? possible.possible_codes : []
  for (const item of list) {
    const code = normalizeScrapeCode(typeof item === 'string' ? item : item?.code)
    if (code) return code
  }
  return ''
}

function toTextList(values) {
  if (!Array.isArray(values)) return []
  const seen = new Set()
  const out = []
  for (const value of values) {
    const text = String(value?.name || value || '').trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push(text)
  }
  return out
}

/**
 * 把刮削结果转成「手动刮削」保存所需 payload（与 PC 端 manualPayload 语义一致）。
 * lookup 与 manual 的字段形状相同，所以可以直接复用。
 */
export function scrapeResultToManualPayload(result) {
  const durationRaw = result?.duration_min
  const parsedDuration =
    durationRaw === null || durationRaw === undefined || durationRaw === ''
      ? null
      : Number.parseInt(durationRaw, 10)
  const payload = {
    code: normalizeScrapeCode(result?.code),
    title: String(result?.title || '').trim(),
    studio: String(result?.studio || '').trim(),
    series: String(result?.series || '').trim(),
    release_date: String(result?.release_date || '').trim(),
    duration_min: Number.isFinite(parsedDuration) ? parsedDuration : null,
    tags: toTextList(result?.tags),
    actors: toTextList(result?.actors),
    cover_url: String(result?.cover_url || '').trim(),
  }
  if (typeof result?.is_uncensored === 'boolean') payload.is_uncensored = result.is_uncensored
  return payload
}

/**
 * 后端「手动刮削」对番号、标题、发行日期、时长、有码状态都有必填校验；
 * 这里提前算出缺哪些字段，避免用户点了保存才吃到 400。
 */
export function scrapeResultMissingFields(result) {
  const payload = scrapeResultToManualPayload(result)
  const missing = []
  if (!payload.code) missing.push('code')
  if (!payload.title) missing.push('title')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.release_date)) missing.push('release_date')
  if (payload.duration_min === null || payload.duration_min < 0) missing.push('duration_min')
  if (typeof payload.is_uncensored !== 'boolean') missing.push('is_uncensored')
  return missing
}
