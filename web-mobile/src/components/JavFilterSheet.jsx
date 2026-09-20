import { useEffect, useMemo, useState } from 'react'

import { fetchJavFilterOptions, fetchJavs } from '@/api'
import BottomSheet from '@/components/BottomSheet'
import Icon from '@/components/Icons'
import {
  JAV_SORT_OPTIONS,
  findJavSortOption,
  isJavSortAscending,
  javSortDirections,
  javSortLabel,
} from '@/constants/jav'
import { useStore } from '@/store'
import { getErrorMessage } from '@/utils/errors'
import { formatCount } from '@/utils/format'
import { zh } from '@/utils/i18n'

const EMPTY_FILTERS = {
  prefix: '',
  idolIds: [],
  tagIds: [],
  studioId: null,
  studioName: '',
  seriesId: null,
  seriesName: '',
  soloOnly: false,
  favoriteRatingEnabled: false,
  favoriteRatingMin: 0.5,
  favoriteRatingMax: 5,
}

function SectionTitle({ children, extra }) {
  return (
    <h4 className="mb-2.5 flex items-center text-xs font-bold text-zinc-500">
      <span>{children}</span>
      {extra ? <span className="ml-auto font-medium text-zinc-400">{extra}</span> : null}
    </h4>
  )
}

function OptionChip({ active, onClick, children, sub }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-semibold ${
        active ? 'border-brand bg-brand text-white' : 'border-[#d8dbe1] bg-white text-zinc-700'
      }`}
    >
      <span className="max-w-[10rem] truncate">{children}</span>
      {sub ? (
        <span className={`text-[10px] tabular-nums ${active ? 'text-white/70' : 'text-zinc-400'}`}>
          {sub}
        </span>
      ) : null}
    </button>
  )
}

function SearchRow({ value, onChange, placeholder }) {
  return (
    <div className="mb-2.5 flex h-8 items-center gap-1.5 rounded-lg border border-[#d8dbe1] bg-white px-2.5">
      <Icon name="search" size={14} className="flex-none text-zinc-400" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full bg-transparent text-[13px] outline-none placeholder:text-zinc-400"
      />
      {value ? (
        <button type="button" onClick={() => onChange('')} aria-label={zh('清除', 'Clear')}>
          <Icon name="x" size={13} className="text-zinc-400" />
        </button>
      ) : null}
    </div>
  )
}

export default function JavFilterSheet({ open, onClose }) {
  const javSort = useStore((state) => state.javSort)
  const storedFilters = useStore((state) => state.javFilters)
  const searchTerm = useStore((state) => state.searchTerm)

  const [draft, setDraft] = useState(storedFilters)
  const [draftSort, setDraftSort] = useState(javSort)
  const [options, setOptions] = useState(null)
  const [loadingOptions, setLoadingOptions] = useState(false)
  const [count, setCount] = useState(null)
  const [counting, setCounting] = useState(false)
  const [error, setError] = useState('')
  const [queries, setQueries] = useState({ prefix: '', idol: '', tag: '', studio: '', series: '' })

  useEffect(() => {
    if (!open) return
    setDraft(storedFilters)
    setDraftSort(javSort)
    setQueries({ prefix: '', idol: '', tag: '', studio: '', series: '' })
    setError('')
  }, [open, storedFilters, javSort])

  // 候选列表随已选条件收窄（后端返回的是叠加后的命中数）。
  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    setLoadingOptions(true)
    fetchJavFilterOptions({
      search: searchTerm,
      idolIds: draft.idolIds,
      tagIds: draft.tagIds,
      studioId: draft.studioId,
      seriesId: draft.seriesId,
      soloOnly: draft.soloOnly,
      optionLimit: 60,
    })
      .then((data) => {
        if (!cancelled) setOptions(data)
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setLoadingOptions(false)
      })
    return () => {
      cancelled = true
    }
  }, [
    open,
    searchTerm,
    draft.idolIds,
    draft.tagIds,
    draft.studioId,
    draft.seriesId,
    draft.soloOnly,
  ])

  // 实时命中数
  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    setCounting(true)
    const timer = window.setTimeout(async () => {
      try {
        const resp = await fetchJavs({
          limit: 1,
          offset: 0,
          search: searchTerm,
          idolIds: draft.idolIds,
          tagIds: draft.tagIds,
          studioId: draft.studioId,
          seriesId: draft.seriesId,
          prefix: draft.prefix,
          favoriteGroupId: draft.favoriteGroupId,
          soloOnly: draft.soloOnly,
          favoriteRatingEnabled: draft.favoriteRatingEnabled,
          favoriteRatingMin: draft.favoriteRatingMin,
          favoriteRatingMax: draft.favoriteRatingMax,
          sort: draftSort,
        })
        if (!cancelled) setCount(resp?.total ?? 0)
      } catch {
        if (!cancelled) setCount(null)
      } finally {
        if (!cancelled) setCounting(false)
      }
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, searchTerm, draft, draftSort])

  const patch = (values) => setDraft((current) => ({ ...current, ...values }))

  const toggleId = (key, id) =>
    setDraft((current) => {
      const list = current[key] || []
      return {
        ...current,
        [key]: list.includes(id) ? list.filter((value) => value !== id) : [...list, id],
      }
    })

  const sortOption = findJavSortOption(draftSort)
  const ascending = isJavSortAscending(draftSort)
  const directions = javSortDirections(sortOption)

  const filterList = (items, key, query, toChip) => {
    const q = query.trim().toLowerCase()
    const list = q
      ? items.filter((item) =>
          String(toChip(item).label || '')
            .toLowerCase()
            .includes(q)
        )
      : items
    return list.slice(0, 60)
  }

  const prefixes = options?.prefixes || []
  const idols = options?.idols || []
  const studios = options?.studios || []
  const seriesList = options?.series || []

  const activeChips = useMemo(() => {
    const chips = []
    if (draft.prefix) {
      chips.push({ key: 'prefix', label: draft.prefix, clear: () => patch({ prefix: '' }) })
    }
    if (draft.idolIds.length) {
      // 女优可能来自「从作品/女优页跳转过来」，用候选项名字回显；拿不到就显示数量。
      const names = draft.idolIds
        .map((id) => (options?.idols || []).find((item) => Number(item.id) === Number(id))?.name)
        .filter(Boolean)
      chips.push({
        key: 'idols',
        label: names.length ? names.join(' · ') : zh(`女优 ${draft.idolIds.length} 位`, 'Idols'),
        clear: () => patch({ idolIds: [] }),
      })
    }
    if (draft.studioId) {
      chips.push({
        key: 'studio',
        label: draft.studioName || zh('片商', 'Studio'),
        clear: () => patch({ studioId: null, studioName: '' }),
      })
    }
    if (draft.seriesId) {
      chips.push({
        key: 'series',
        label: draft.seriesName || zh('系列', 'Series'),
        clear: () => patch({ seriesId: null, seriesName: '' }),
      })
    }
    return chips
  }, [
    draft.prefix,
    draft.idolIds,
    draft.studioId,
    draft.studioName,
    draft.seriesId,
    draft.seriesName,
    options,
  ])

  const apply = () => {
    const store = useStore.getState()
    store.setJavSort(draftSort)
    store.setJavFilters(draft)
    onClose?.()
  }

  return (
    <BottomSheet
      open={open}
      title={zh('JAV 筛选与排序', 'JAV filter & sort')}
      onClose={onClose}
      height="84vh"
      footer={
        <>
          <button
            type="button"
            onClick={() => {
              setDraft(EMPTY_FILTERS)
              setDraftSort('recent')
            }}
            className="h-11 w-20 flex-none rounded-card bg-[#f1f2f5] text-sm font-bold text-zinc-700"
          >
            {zh('重置', 'Reset')}
          </button>
          <button
            type="button"
            onClick={apply}
            className="h-11 flex-1 rounded-card bg-brand text-[14.5px] font-bold text-white"
          >
            {count === null
              ? zh('应用筛选', 'Apply')
              : zh(`查看 ${formatCount(count)} 项`, `Show ${formatCount(count)}`)}
          </button>
        </>
      }
    >
      <div className="mb-5">
        <SectionTitle extra={counting ? zh('统计中…', 'Counting...') : null}>
          {zh('排序方式', 'Sort by')}
        </SectionTitle>
        <div className="flex flex-wrap gap-2">
          {JAV_SORT_OPTIONS.map((option) => (
            <OptionChip
              key={option.base}
              active={sortOption?.base === option.base}
              onClick={() => setDraftSort(option.descValue)}
            >
              {zh(...javSortLabel(option))}
            </OptionChip>
          ))}
        </div>
        <div className="mt-3 flex gap-0.5 rounded-lg bg-[#eceef2] p-[3px]">
          {[
            ['desc', directions.desc],
            ['asc', directions.asc],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() =>
                sortOption &&
                setDraftSort(value === 'asc' ? sortOption.ascValue : sortOption.descValue)
              }
              className={`flex-1 rounded-md py-1.5 text-xs font-semibold ${
                (value === 'asc') === ascending
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-500'
              }`}
            >
              {zh(...label)}
            </button>
          ))}
        </div>
      </div>

      {activeChips.length ? (
        <div className="mb-5">
          <SectionTitle>{zh('已选条件', 'Active filters')}</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {activeChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={chip.clear}
                className="inline-flex h-7 items-center gap-1.5 rounded-full border border-brand-line bg-brand-soft px-2.5 text-[12px] font-semibold text-brand-ink"
              >
                {chip.label}
                <Icon name="x" size={12} />
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {prefixes.length ? (
        <div className="mb-5">
          <SectionTitle extra={loadingOptions ? zh('加载中…', 'Loading...') : null}>
            {zh('番号前缀', 'Code prefix')}
          </SectionTitle>
          <SearchRow
            value={queries.prefix}
            onChange={(value) => setQueries((q) => ({ ...q, prefix: value }))}
            placeholder={zh('搜索前缀', 'Search prefix')}
          />
          <div className="flex flex-wrap gap-2">
            {filterList(prefixes, 'prefix', queries.prefix, (item) => ({ label: item.prefix })).map(
              (item) => (
                <OptionChip
                  key={item.prefix}
                  active={draft.prefix === item.prefix}
                  sub={formatCount(item.work_count)}
                  onClick={() => patch({ prefix: draft.prefix === item.prefix ? '' : item.prefix })}
                >
                  {item.prefix}
                </OptionChip>
              )
            )}
          </div>
        </div>
      ) : null}

      {idols.length ? (
        <div className="mb-5">
          <SectionTitle
            extra={
              draft.idolIds.length
                ? zh(`已选 ${draft.idolIds.length}`, `${draft.idolIds.length} selected`)
                : null
            }
          >
            {zh('女优（可多选）', 'Idols')}
          </SectionTitle>
          <SearchRow
            value={queries.idol}
            onChange={(value) => setQueries((q) => ({ ...q, idol: value }))}
            placeholder={zh('搜索女优', 'Search idol')}
          />
          <div className="flex flex-wrap gap-2">
            {filterList(idols, 'idolIds', queries.idol, (item) => ({ label: item.name })).map(
              (item) => (
                <OptionChip
                  key={item.id}
                  active={draft.idolIds.includes(item.id)}
                  sub={formatCount(item.work_count)}
                  onClick={() => toggleId('idolIds', item.id)}
                >
                  {item.name}
                </OptionChip>
              )
            )}
          </div>
        </div>
      ) : null}

      {studios.length ? (
        <div className="mb-5">
          <SectionTitle>{zh('片商', 'Studio')}</SectionTitle>
          <SearchRow
            value={queries.studio}
            onChange={(value) => setQueries((q) => ({ ...q, studio: value }))}
            placeholder={zh('搜索片商', 'Search studio')}
          />
          <div className="flex flex-wrap gap-2">
            {filterList(studios, 'studioId', queries.studio, (item) => ({ label: item.name })).map(
              (item) => (
                <OptionChip
                  key={item.id}
                  active={draft.studioId === item.id}
                  sub={formatCount(item.work_count)}
                  onClick={() =>
                    patch({
                      studioId: draft.studioId === item.id ? null : item.id,
                      studioName: draft.studioId === item.id ? '' : item.name,
                    })
                  }
                >
                  {item.name}
                </OptionChip>
              )
            )}
          </div>
        </div>
      ) : null}

      {seriesList.length ? (
        <div className="mb-5">
          <SectionTitle>{zh('系列', 'Series')}</SectionTitle>
          <SearchRow
            value={queries.series}
            onChange={(value) => setQueries((q) => ({ ...q, series: value }))}
            placeholder={zh('搜索系列', 'Search series')}
          />
          <div className="flex flex-wrap gap-2">
            {filterList(seriesList, 'seriesId', queries.series, (item) => ({
              label: item.name,
            })).map((item) => (
              <OptionChip
                key={item.id}
                active={draft.seriesId === item.id}
                sub={formatCount(item.work_count)}
                onClick={() =>
                  patch({
                    seriesId: draft.seriesId === item.id ? null : item.id,
                    seriesName: draft.seriesId === item.id ? '' : item.name,
                  })
                }
              >
                {item.name}
              </OptionChip>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mb-2">
        <SectionTitle>{zh('其它', 'More')}</SectionTitle>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-3 rounded-card border border-[#e6e8ec] bg-white px-3.5 py-3">
            <span className="flex-1 text-[13.5px] text-zinc-800">
              {zh('只看单体作品', 'Solo works only')}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={draft.soloOnly}
              aria-label={zh('只看单体作品', 'Solo works only')}
              onClick={() => patch({ soloOnly: !draft.soloOnly })}
              className={`relative h-[25px] w-[42px] flex-none rounded-full ${draft.soloOnly ? 'bg-brand' : 'bg-[#d8dbe1]'}`}
            >
              <span
                className={`absolute top-[2.5px] h-5 w-5 rounded-full bg-white shadow transition-all ${
                  draft.soloOnly ? 'right-[2.5px]' : 'left-[2.5px]'
                }`}
              />
            </button>
          </label>

          <div className="rounded-card border border-[#e6e8ec] bg-white px-3.5 py-3">
            <div className="flex items-center gap-3">
              <span className="flex-1">
                <span className="block text-[13.5px] text-zinc-800">
                  {zh('按喜爱度筛选', 'Filter by rating')}
                </span>
                <span className="mt-0.5 block text-[11px] text-zinc-400">
                  {draft.favoriteRatingMin} – {draft.favoriteRatingMax}
                </span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={draft.favoriteRatingEnabled}
                aria-label={zh('按喜爱度筛选', 'Filter by rating')}
                onClick={() => patch({ favoriteRatingEnabled: !draft.favoriteRatingEnabled })}
                className={`relative h-[25px] w-[42px] flex-none rounded-full ${
                  draft.favoriteRatingEnabled ? 'bg-brand' : 'bg-[#d8dbe1]'
                }`}
              >
                <span
                  className={`absolute top-[2.5px] h-5 w-5 rounded-full bg-white shadow transition-all ${
                    draft.favoriteRatingEnabled ? 'right-[2.5px]' : 'left-[2.5px]'
                  }`}
                />
              </button>
            </div>
            {draft.favoriteRatingEnabled ? (
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="range"
                  min={0.5}
                  max={5}
                  step={0.5}
                  value={draft.favoriteRatingMin}
                  onChange={(event) =>
                    patch({
                      favoriteRatingMin: Math.min(
                        Number(event.target.value),
                        draft.favoriteRatingMax
                      ),
                    })
                  }
                  aria-label={zh('最低喜爱度', 'Minimum rating')}
                  className="flex-1 accent-blue-600"
                />
                <input
                  type="range"
                  min={0.5}
                  max={5}
                  step={0.5}
                  value={draft.favoriteRatingMax}
                  onChange={(event) =>
                    patch({
                      favoriteRatingMax: Math.max(
                        Number(event.target.value),
                        draft.favoriteRatingMin
                      ),
                    })
                  }
                  aria-label={zh('最高喜爱度', 'Maximum rating')}
                  className="flex-1 accent-blue-600"
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {error ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
          <Icon name="ban" size={14} className="mt-[1px] flex-none" />
          <span>{error}</span>
        </div>
      ) : null}
    </BottomSheet>
  )
}
