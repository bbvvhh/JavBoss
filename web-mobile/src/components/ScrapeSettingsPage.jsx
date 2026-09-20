import { useEffect, useMemo, useState } from 'react'

import {
  fetchVideoJavScrapePossibleCodes,
  linkVideoToExistingJav,
  manualVideoJavScrape,
  updateVideoJavScrapeSettings,
} from '@/api'
import Icon from '@/components/Icons'
import SubPage from '@/components/SubPage'
import { useStore, videoKey } from '@/store'
import { getErrorMessage } from '@/utils/errors'
import { zh } from '@/utils/i18n'

const OVERRIDE_SKIP = ':skip'
const OVERRIDE_MANUAL_PREFIX = ':manual:'
const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

const EMPTY_MANUAL = {
  code: '',
  title: '',
  studio: '',
  series: '',
  release_date: '',
  duration_min: '',
  tags_text: '',
  actors_text: '',
  cover_url: '',
  is_uncensored: '',
}

function textToList(value) {
  return String(value || '')
    .split(/[,，、\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

/** 把 video.jav_scrape_override 解析成界面状态（与 PC 端语义一致）。 */
function parseOverride(video) {
  const raw = String(video?.jav_scrape_override || '').trim()
  if (raw === OVERRIDE_SKIP) return { mode: 'skip', autoSource: 'filename', code: '' }
  if (raw.startsWith(OVERRIDE_MANUAL_PREFIX)) {
    return {
      mode: 'manual',
      autoSource: 'code',
      code: raw.slice(OVERRIDE_MANUAL_PREFIX.length).trim(),
    }
  }
  if (raw) return { mode: 'auto', autoSource: 'code', code: raw }
  return { mode: 'auto', autoSource: 'filename', code: '' }
}

function manualPayload(info) {
  const duration = String(info.duration_min || '').trim()
  const isUncensored = String(info.is_uncensored || '')
  const payload = {
    code: String(info.code || '')
      .trim()
      .toUpperCase(),
    title: String(info.title || '').trim(),
    studio: String(info.studio || '').trim(),
    series: String(info.series || '').trim(),
    release_date: String(info.release_date || '').trim(),
    duration_min: duration === '' ? null : Number.parseInt(duration, 10),
    tags: textToList(info.tags_text),
    actors: textToList(info.actors_text),
    cover_url: String(info.cover_url || '').trim(),
  }
  if (isUncensored === 'true') payload.is_uncensored = true
  if (isUncensored === 'false') payload.is_uncensored = false
  return payload
}

function ModeCard({ active, title, description, onSelect }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-start gap-3 rounded-card border px-3.5 py-3 text-left ${
        active ? 'border-brand bg-brand-soft' : 'border-[#e6e8ec] bg-white'
      }`}
    >
      <span
        className={`mt-[2px] grid h-[18px] w-[18px] flex-none place-items-center rounded-full border-2 ${
          active ? 'border-brand' : 'border-zinc-300'
        }`}
      >
        {active ? <span className="h-2 w-2 rounded-full bg-brand" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`block text-[13.5px] font-semibold ${active ? 'text-brand-ink' : 'text-zinc-800'}`}
        >
          {title}
        </span>
        <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">{description}</span>
      </span>
    </button>
  )
}

function Field({ label, value, onChange, placeholder, inputMode, hint, invalid }) {
  return (
    <label className="block border-b border-[#f1f2f5] bg-white px-3.5 py-3 last:border-b-0">
      <span className="mb-1.5 block text-[11.5px] font-semibold text-zinc-500">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        className={`w-full rounded-lg border bg-white px-2.5 py-2 text-[13px] outline-none ${
          invalid ? 'border-red-400' : 'border-[#d8dbe1] focus:border-brand'
        }`}
      />
      {hint ? <span className="mt-1 block text-[10.5px] text-zinc-400">{hint}</span> : null}
    </label>
  )
}

export default function ScrapeSettingsPage({ video, onClose }) {
  const patchVideo = useStore((state) => state.patchVideo)
  const showToast = useStore((state) => state.showToast)
  const loadVideos = useStore((state) => state.loadVideos)

  const initial = useMemo(() => parseOverride(video), [video])
  const [mode, setMode] = useState(initial.mode)
  const [autoSource, setAutoSource] = useState(initial.autoSource)
  const [code, setCode] = useState(initial.code)
  const [manual, setManual] = useState(() => ({ ...EMPTY_MANUAL, code: initial.code }))
  const [possible, setPossible] = useState(null)
  const [checking, setChecking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [linking, setLinking] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setMode(initial.mode)
    setAutoSource(initial.autoSource)
    setCode(initial.code)
    setManual({ ...EMPTY_MANUAL, code: initial.code })
    setPossible(null)
    setError('')
  }, [initial, video?.id])

  const normalizedCode = code.trim().toUpperCase()
  const codeValid = CODE_PATTERN.test(normalizedCode)

  const runCheck = async () => {
    if (!video?.id || checking) return
    setChecking(true)
    setError('')
    try {
      setPossible(await fetchVideoJavScrapePossibleCodes(video.id))
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setChecking(false)
    }
  }

  const linkExisting = async () => {
    const locationId = Number(video?.location_id)
    if (!video?.id || !Number.isFinite(locationId) || !codeValid || linking) return
    setLinking(true)
    setError('')
    try {
      const updated = await linkVideoToExistingJav(video.id, locationId, normalizedCode)
      patchVideo(videoKey(video), updated || {})
      await loadVideos()
      showToast(zh('已关联到已有 JAV', 'Linked to existing JAV'))
      onClose?.()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLinking(false)
    }
  }

  const save = async () => {
    if (!video?.id || saving) return
    const locationId = Number(video?.location_id)
    if (mode === 'manual' && (!Number.isFinite(locationId) || locationId <= 0)) {
      setError(zh('缺少文件位置，无法保存', 'Missing file location'))
      return
    }
    setSaving(true)
    setError('')
    try {
      let updated
      if (mode === 'manual') {
        updated = await manualVideoJavScrape(
          video.id,
          locationId,
          manualPayload({ ...manual, code: manual.code || code })
        )
      } else if (mode === 'skip') {
        updated = await updateVideoJavScrapeSettings(video.id, { mode: 'skip', code: '' })
      } else if (autoSource === 'code') {
        updated = await updateVideoJavScrapeSettings(video.id, {
          mode: 'code',
          code: normalizedCode,
        })
      } else {
        updated = await updateVideoJavScrapeSettings(video.id, { mode: 'auto', code: '' })
      }
      patchVideo(videoKey(video), updated || {})
      await loadVideos()
      showToast(zh('刮削设置已保存', 'Scrape settings saved'))
      onClose?.()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const disabled = saving || (mode === 'auto' && autoSource === 'code' && !codeValid)

  return (
    <SubPage
      title={zh('刮削设置', 'Scrape settings')}
      subtitle={String(video?.filename || '')}
      onBack={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="h-11 w-20 flex-none rounded-card bg-[#f1f2f5] text-sm font-bold text-zinc-700"
          >
            {zh('取消', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={disabled}
            className="h-11 flex-1 rounded-card bg-brand text-[14.5px] font-bold text-white disabled:opacity-45"
          >
            {saving ? zh('保存中…', 'Saving...') : zh('保存', 'Save')}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2 px-3.5 pt-3.5">
        <ModeCard
          active={mode === 'auto'}
          title={zh('自动刮削', 'Scrape automatically')}
          description={zh(
            '扫描时按文件名或指定番号自动抓取元数据',
            'Fetch metadata during scans by filename or a fixed code'
          )}
          onSelect={() => setMode('auto')}
        />
        {mode === 'auto' ? (
          <div className="rounded-card border border-[#e6e8ec] bg-white px-3.5 py-3">
            <div className="mb-2.5 flex gap-0.5 rounded-lg bg-[#eceef2] p-[3px]">
              {[
                ['filename', zh('按文件名', 'By filename')],
                ['code', zh('指定番号', 'Fixed code')],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setAutoSource(value)}
                  className={`flex-1 rounded-md py-1.5 text-xs font-semibold ${
                    autoSource === value ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {autoSource === 'code' ? (
              <>
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                  placeholder="SSIS-698"
                  aria-label={zh('指定番号', 'Fixed code')}
                  className={`w-full rounded-lg border px-2.5 py-2 text-[13px] uppercase outline-none ${
                    normalizedCode && !codeValid ? 'border-red-400' : 'border-[#d8dbe1]'
                  }`}
                />
                {normalizedCode && !codeValid ? (
                  <p className="mt-1 text-[11px] text-red-600">
                    {zh('番号只能包含字母、数字、- 和 _', 'Only letters, digits, - and _')}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-[11.5px] leading-relaxed text-zinc-500">
                {zh(
                  '将从文件名里提取番号。如果一直刮错，可以改成「指定番号」或先重命名文件。',
                  'Codes are extracted from the filename. Rename the file or use a fixed code if it keeps mismatching.'
                )}
              </p>
            )}

            <button
              type="button"
              onClick={runCheck}
              disabled={checking}
              className="mt-2.5 inline-flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-[#d8dbe1] px-3 text-[12px] font-semibold text-zinc-700 disabled:opacity-50"
            >
              <Icon name="wand" size={13} />
              {checking ? zh('提取中…', 'Checking...') : zh('测试番号提取', 'Test extraction')}
            </button>

            {possible ? (
              <div className="mt-2.5 rounded-lg bg-[#f7f8fa] px-3 py-2.5">
                <p className="mb-1.5 truncate text-[11px] text-zinc-500">{possible.filename}</p>
                {Array.isArray(possible.possible_codes) && possible.possible_codes.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {possible.possible_codes.map((item) => (
                      <button
                        key={item.code || item}
                        type="button"
                        onClick={() => {
                          setAutoSource('code')
                          setCode(String(item.code || item))
                        }}
                        className="rounded-md bg-white px-2 py-1 text-[11.5px] font-semibold text-zinc-700 shadow-sm"
                      >
                        {item.code || item}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11.5px] text-zinc-400">
                    {zh('没有提取到番号', 'No codes extracted')}
                  </p>
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        <ModeCard
          active={mode === 'manual'}
          title={zh('手动填写', 'Fill in manually')}
          description={zh(
            '自己录入元数据；也可以直接关联到库里已有的 JAV',
            'Enter metadata yourself'
          )}
          onSelect={() => setMode('manual')}
        />
        {mode === 'manual' ? (
          <div className="overflow-hidden rounded-card border border-[#e6e8ec]">
            <div className="border-b border-[#f1f2f5] bg-white px-3.5 py-3">
              <span className="mb-1.5 block text-[11.5px] font-semibold text-zinc-500">
                {zh('番号', 'Code')}
              </span>
              <div className="flex gap-2">
                <input
                  value={manual.code || code}
                  onChange={(event) =>
                    setManual((current) => ({ ...current, code: event.target.value.toUpperCase() }))
                  }
                  placeholder="SSIS-698"
                  aria-label={zh('番号', 'Code')}
                  className="min-w-0 flex-1 rounded-lg border border-[#d8dbe1] px-2.5 py-2 text-[13px] uppercase outline-none focus:border-brand"
                />
                <button
                  type="button"
                  onClick={linkExisting}
                  disabled={
                    linking || !CODE_PATTERN.test(String(manual.code || code).toUpperCase())
                  }
                  className="flex-none rounded-lg bg-[#f1f2f5] px-3 text-[12px] font-bold text-zinc-700 disabled:opacity-45"
                >
                  {linking ? zh('关联中…', 'Linking...') : zh('关联已有', 'Link existing')}
                </button>
              </div>
              <p className="mt-1 text-[10.5px] text-zinc-400">
                {zh(
                  '番号已在库中时，直接关联即可，无需重复录入',
                  'If the code exists, just link it'
                )}
              </p>
            </div>

            <Field
              label={zh('标题', 'Title')}
              value={manual.title}
              onChange={(value) => setManual((current) => ({ ...current, title: value }))}
            />
            <Field
              label={zh('片商', 'Studio')}
              value={manual.studio}
              onChange={(value) => setManual((current) => ({ ...current, studio: value }))}
            />
            <Field
              label={zh('系列', 'Series')}
              value={manual.series}
              onChange={(value) => setManual((current) => ({ ...current, series: value }))}
            />
            <Field
              label={zh('发行日期', 'Release date')}
              value={manual.release_date}
              onChange={(value) => setManual((current) => ({ ...current, release_date: value }))}
              placeholder="2024-11-08"
              hint={zh('格式 YYYY-MM-DD', 'Format YYYY-MM-DD')}
            />
            <Field
              label={zh('时长（分钟）', 'Duration (min)')}
              value={manual.duration_min}
              onChange={(value) => setManual((current) => ({ ...current, duration_min: value }))}
              inputMode="numeric"
            />
            <Field
              label={zh('标签', 'Tags')}
              value={manual.tags_text}
              onChange={(value) => setManual((current) => ({ ...current, tags_text: value }))}
              hint={zh('逗号分隔', 'Comma separated')}
            />
            <Field
              label={zh('演员', 'Cast')}
              value={manual.actors_text}
              onChange={(value) => setManual((current) => ({ ...current, actors_text: value }))}
              hint={zh('逗号分隔', 'Comma separated')}
            />
            <Field
              label={zh('封面图 URL', 'Cover URL')}
              value={manual.cover_url}
              onChange={(value) => setManual((current) => ({ ...current, cover_url: value }))}
              hint={zh('保存时会下载到本地', 'Downloaded locally on save')}
            />

            <div className="border-t border-[#f1f2f5] bg-white px-3.5 py-3">
              <span className="mb-1.5 block text-[11.5px] font-semibold text-zinc-500">
                {zh('无码', 'Uncensored')}
              </span>
              <div className="flex gap-0.5 rounded-lg bg-[#eceef2] p-[3px]">
                {[
                  ['', zh('未指定', 'Unset')],
                  ['true', zh('是', 'Yes')],
                  ['false', zh('否', 'No')],
                ].map(([value, label]) => (
                  <button
                    key={value || 'unset'}
                    type="button"
                    onClick={() => setManual((current) => ({ ...current, is_uncensored: value }))}
                    className={`flex-1 rounded-md py-1.5 text-xs font-semibold ${
                      manual.is_uncensored === value
                        ? 'bg-white text-zinc-900 shadow-sm'
                        : 'text-zinc-500'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        <ModeCard
          active={mode === 'skip'}
          title={zh('不刮削', 'Do not scrape')}
          description={zh('跳过这个视频，不再尝试自动抓取', 'Skip this video entirely')}
          onSelect={() => setMode('skip')}
        />

        {error ? (
          <div className="flex items-start gap-2 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] leading-relaxed text-red-700">
            <Icon name="ban" size={15} className="mt-[1px] flex-none" />
            <span>{error}</span>
          </div>
        ) : null}

        <p className="px-1 pb-8 pt-1 text-[11px] leading-relaxed text-zinc-400">
          {zh(
            '刮削只修改数据库里的元数据与 JavBoss 自己的 data/ 目录，不会改动你的视频文件。',
            'Scraping only writes metadata and files under JavBoss’s own data folder.'
          )}
        </p>
      </div>
    </SubPage>
  )
}
