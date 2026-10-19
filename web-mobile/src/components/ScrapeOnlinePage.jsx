import { useEffect, useState } from 'react'

import { fetchVideoJavScrapePossibleCodes, lookupVideoJavScrape, manualVideoJavScrape } from '@/api'
import Icon from '@/components/Icons'
import SubPage from '@/components/SubPage'
import { useStore, videoKey } from '@/store'
import { getErrorMessage } from '@/utils/errors'
import { zh } from '@/utils/i18n'
import {
  SCRAPE_PROVIDERS,
  isScrapeCodeValid,
  normalizeScrapeCode,
  pickFirstPossibleCode,
  scrapeResultMissingFields,
  scrapeResultToManualPayload,
} from '@/utils/scrapeOnline'

/**
 * 视频模式：对单个视频「立即刮削」并展示刮削结果。
 *
 * 流程：选来源 + 确认番号 → 调 GET /videos/:id/jav-scrape/lookup 抓取元数据 →
 * 页面展示结果 → 用户确认后走「手动刮削」接口把结果落库。
 */
function InfoRow({ label, value }) {
  if (!value) return null
  return (
    <div className="flex gap-3 border-b border-[#f1f2f5] px-3.5 py-2.5 last:border-b-0">
      <span className="w-16 flex-none text-[11.5px] font-semibold text-zinc-500">{label}</span>
      <span className="min-w-0 flex-1 break-words text-[13px] leading-snug text-zinc-800">
        {value}
      </span>
    </div>
  )
}

function ResultRow({ label, values }) {
  if (!Array.isArray(values) || values.length === 0) return null
  return (
    <div className="flex gap-3 border-b border-[#f1f2f5] px-3.5 py-2.5 last:border-b-0">
      <span className="w-16 flex-none text-[11.5px] font-semibold text-zinc-500">{label}</span>
      <span className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {values.map((item) => (
          <span
            key={item}
            className="rounded-md bg-[#f1f2f5] px-2 py-0.5 text-[11.5px] font-medium text-zinc-700"
          >
            {item}
          </span>
        ))}
      </span>
    </div>
  )
}

export default function ScrapeOnlinePage({ video, onClose }) {
  const patchVideo = useStore((state) => state.patchVideo)
  const showToast = useStore((state) => state.showToast)
  const loadVideos = useStore((state) => state.loadVideos)

  const [provider, setProvider] = useState(SCRAPE_PROVIDERS[0].value)
  const [code, setCode] = useState('')
  const [possible, setPossible] = useState(null)
  const [extracting, setExtracting] = useState(false)
  const [scraping, setScraping] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const normalizedCode = normalizeScrapeCode(code)
  const codeValid = isScrapeCodeValid(code)

  const extractCodes = async ({ silent = false } = {}) => {
    if (!video?.id || extracting) return
    setExtracting(true)
    if (!silent) setError('')
    try {
      const data = await fetchVideoJavScrapePossibleCodes(video.id)
      setPossible(data)
      const first = pickFirstPossibleCode(data)
      if (first) setCode((current) => (current ? current : first))
    } catch (err) {
      // 进页面预填失败不打扰用户，手动输入番号即可。
      if (!silent) setError(getErrorMessage(err))
    } finally {
      setExtracting(false)
    }
  }

  // 进页面先把文件名里能提取到的番号填上，用户确认后再刮。
  useEffect(() => {
    if (!video?.id) return
    extractCodes({ silent: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video?.id])

  const runScrape = async () => {
    if (!video?.id || scraping || saving) return
    if (!codeValid) {
      setError(zh('请输入有效番号', 'Enter a valid code'))
      return
    }
    setScraping(true)
    setError('')
    setResult(null)
    try {
      const data = await lookupVideoJavScrape(video.id, provider, normalizedCode)
      setResult(data || null)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setScraping(false)
    }
  }

  const save = async () => {
    if (!result || saving) return
    const locationId = Number(video?.location_id)
    if (!Number.isFinite(locationId) || locationId <= 0) {
      setError(zh('缺少文件位置，无法保存', 'Missing file location'))
      return
    }
    if (scrapeResultMissingFields(result).length > 0) {
      setError(
        zh(
          '刮削结果缺少必填字段（番号/标题/发行日期/时长/有码状态），请改用「刮削设置 → 手动填写」',
          'The scrape result is missing required fields; use “Scrape settings → Fill in manually” instead'
        )
      )
      return
    }
    setSaving(true)
    setError('')
    try {
      const updated = await manualVideoJavScrape(
        video.id,
        locationId,
        scrapeResultToManualPayload(result)
      )
      patchVideo(videoKey(video), updated || {})
      await loadVideos()
      showToast(zh('刮削结果已保存', 'Scrape result saved'))
      onClose?.()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const busy = scraping || saving
  const missing = result ? scrapeResultMissingFields(result) : []

  return (
    <SubPage
      title={zh('在线刮削', 'Scrape now')}
      subtitle={String(video?.filename || '')}
      onBack={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="h-11 w-20 flex-none rounded-card bg-[#f1f2f5] text-sm font-bold text-zinc-700"
          >
            {zh('关闭', 'Close')}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!result || busy || missing.length > 0}
            className="h-11 flex-1 rounded-card bg-brand text-[14.5px] font-bold text-white disabled:opacity-45"
          >
            {saving ? zh('保存中…', 'Saving...') : zh('保存到媒体库', 'Save to library')}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5 px-3.5 pt-3.5">
        <div className="rounded-card border border-[#e6e8ec] bg-white px-3.5 py-3">
          <span className="mb-1.5 block text-[11.5px] font-semibold text-zinc-500">
            {zh('刮削来源', 'Provider')}
          </span>
          <div className="flex gap-0.5 rounded-lg bg-[#eceef2] p-[3px]">
            {SCRAPE_PROVIDERS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setProvider(item.value)}
                className={`flex-1 rounded-md py-1.5 text-xs font-semibold ${
                  provider === item.value ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-card border border-[#e6e8ec] bg-white px-3.5 py-3">
          <span className="mb-1.5 block text-[11.5px] font-semibold text-zinc-500">
            {zh('番号', 'Code')}
          </span>
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="SSIS-698"
              aria-label={zh('番号', 'Code')}
              className={`min-w-0 flex-1 rounded-lg border px-2.5 py-2 text-[13px] uppercase outline-none ${
                normalizedCode && !codeValid
                  ? 'border-red-400'
                  : 'border-[#d8dbe1] focus:border-brand'
              }`}
            />
            <button
              type="button"
              onClick={extractCodes}
              disabled={extracting || busy}
              className="inline-flex flex-none items-center gap-1.5 rounded-lg border border-[#d8dbe1] px-3 text-[12px] font-semibold text-zinc-700 disabled:opacity-50"
            >
              <Icon name="wand" size={13} />
              {extracting ? zh('提取中…', 'Checking...') : zh('提取番号', 'Extract')}
            </button>
          </div>
          {normalizedCode && !codeValid ? (
            <p className="mt-1 text-[11px] text-red-600">
              {zh('番号只能包含字母、数字、- 和 _', 'Only letters, digits, - and _')}
            </p>
          ) : null}

          {Array.isArray(possible?.possible_codes) && possible.possible_codes.length > 0 ? (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {possible.possible_codes.map((item) => {
                const value = normalizeScrapeCode(typeof item === 'string' ? item : item?.code)
                if (!value) return null
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setCode(value)}
                    className={`rounded-md px-2 py-1 text-[11.5px] font-semibold shadow-sm ${
                      value === normalizedCode
                        ? 'bg-brand-soft text-brand-ink'
                        : 'bg-[#f1f2f5] text-zinc-700'
                    }`}
                  >
                    {value}
                  </button>
                )
              })}
            </div>
          ) : null}

          <button
            type="button"
            onClick={runScrape}
            disabled={busy || !codeValid}
            className="mt-3 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-brand text-[13px] font-bold text-white disabled:opacity-45"
          >
            <Icon name="download" size={15} />
            {scraping ? zh('刮削中…', 'Scraping...') : zh('开始刮削', 'Scrape now')}
          </button>
        </div>

        {error ? (
          <div className="flex items-start gap-2 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] leading-relaxed text-red-700">
            <Icon name="ban" size={15} className="mt-[1px] flex-none" />
            <span>{error}</span>
          </div>
        ) : null}

        {result ? (
          <div className="overflow-hidden rounded-card border border-[#e6e8ec] bg-white">
            <div className="border-b border-[#f1f2f5] px-3.5 py-3">
              <span className="text-[12px] font-semibold text-zinc-800">
                {zh('刮削结果', 'Scrape result')}
              </span>
              <span className="ml-1.5 text-[11px] text-zinc-400">
                {SCRAPE_PROVIDERS.find((item) => item.value === provider)?.label}
              </span>
            </div>
            {result.cover_url ? (
              <div className="border-b border-[#f1f2f5] bg-[#f7f8fa] px-3.5 py-3">
                <img
                  src={result.cover_url}
                  alt={zh('封面', 'Cover')}
                  className="mx-auto max-h-56 rounded-lg object-contain"
                  referrerPolicy="no-referrer"
                />
              </div>
            ) : null}
            <InfoRow label={zh('番号', 'Code')} value={normalizeScrapeCode(result.code)} />
            <InfoRow label={zh('标题', 'Title')} value={String(result.title || '').trim()} />
            <InfoRow label={zh('片商', 'Studio')} value={String(result.studio || '').trim()} />
            <InfoRow label={zh('系列', 'Series')} value={String(result.series || '').trim()} />
            <InfoRow
              label={zh('发行日期', 'Release')}
              value={String(result.release_date || '').trim()}
            />
            <InfoRow
              label={zh('时长', 'Duration')}
              value={
                result.duration_min === null || result.duration_min === undefined
                  ? ''
                  : zh(`${result.duration_min} 分钟`, `${result.duration_min} min`)
              }
            />
            <InfoRow
              label={zh('无码', 'Uncensored')}
              value={
                typeof result.is_uncensored === 'boolean'
                  ? result.is_uncensored
                    ? zh('是', 'Yes')
                    : zh('否', 'No')
                  : ''
              }
            />
            <ResultRow label={zh('标签', 'Tags')} values={result.tags} />
            <ResultRow label={zh('演员', 'Cast')} values={result.actors} />
          </div>
        ) : null}

        {result && missing.length > 0 ? (
          <p className="px-1 text-[11px] leading-relaxed text-amber-600">
            {zh(
              '该来源返回的结果缺少必填字段，无法直接落库；可改用「刮削设置 → 手动填写」。',
              'This provider returned an incomplete result, so it cannot be saved directly; use “Scrape settings → Fill in manually” instead.'
            )}
          </p>
        ) : null}

        <p className="px-1 pb-6 pt-1 text-[11px] leading-relaxed text-zinc-400">
          {zh(
            '在线刮削只是从元数据网站抓取，点击「保存到媒体库」才会写入数据库；不会改动你的视频文件。',
            'Scraping only fetches metadata; nothing is written until you tap “Save to library”. Video files are never touched.'
          )}
        </p>
      </div>
    </SubPage>
  )
}
