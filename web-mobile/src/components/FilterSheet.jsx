import { useEffect, useMemo, useState } from 'react'

import { fetchVideos } from '@/api'
import BottomSheet from '@/components/BottomSheet'
import Icon from '@/components/Icons'
import { VIDEO_SORT_OPTIONS, findVideoSortOption, normalizeVideoSort } from '@/constants/video'
import { useStore } from '@/store'
import { zh } from '@/utils/i18n'

function OptionPill({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-8 items-center rounded-[9px] border px-3 text-[12.5px] font-semibold ${
        active ? 'border-brand bg-brand text-white' : 'border-[#d8dbe1] bg-white text-zinc-700'
      }`}
    >
      {children}
    </button>
  )
}

export default function FilterSheet({ open, onClose }) {
  const sort = useStore((state) => state.sort)
  const selectedTags = useStore((state) => state.selectedTags)
  const hideJav = useStore((state) => state.hideJav)
  const searchTerm = useStore((state) => state.searchTerm)
  const allTags = useStore((state) => state.tags)
  const loadTags = useStore((state) => state.loadTags)

  const [draftSort, setDraftSort] = useState(sort)
  const [draftTags, setDraftTags] = useState(selectedTags)
  const [draftHideJav, setDraftHideJav] = useState(hideJav)
  const [tagQuery, setTagQuery] = useState('')
  const [count, setCount] = useState(null)
  const [counting, setCounting] = useState(false)

  useEffect(() => {
    if (!open) return
    setDraftSort(sort)
    setDraftTags(selectedTags)
    setDraftHideJav(hideJav)
    setTagQuery('')
  }, [open, sort, selectedTags, hideJav])

  useEffect(() => {
    if (!open) return undefined
    if (allTags.length === 0) loadTags()
    return undefined
  }, [open, allTags.length, loadTags])

  // 实时命中数：limit=1 的轻量查询，只取 total。
  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    setCounting(true)
    const timer = window.setTimeout(async () => {
      try {
        const resp = await fetchVideos({
          limit: 1,
          offset: 0,
          tags: draftTags,
          search: searchTerm,
          sort: draftSort,
          hideJav: draftHideJav,
        })
        if (!cancelled) setCount(resp.total ?? 0)
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
  }, [open, draftTags, draftSort, draftHideJav, searchTerm])

  const sortOption = findVideoSortOption(draftSort)
  const direction = sortOption && draftSort === sortOption.ascValue ? 'asc' : 'desc'

  const visibleTags = useMemo(() => {
    const query = tagQuery.trim().toLowerCase()
    const list = query
      ? allTags.filter((tag) =>
          String(tag?.name || '')
            .toLowerCase()
            .includes(query)
        )
      : allTags
    return list.slice(0, 80)
  }, [allTags, tagQuery])

  const apply = () => {
    const store = useStore.getState()
    store.setSort(draftSort)
    store.setSelectedTags(draftTags)
    store.setHideJav(draftHideJav)
    onClose?.()
  }

  const reset = () => {
    setDraftSort('recent')
    setDraftTags([])
    setDraftHideJav(false)
  }

  return (
    <BottomSheet
      open={open}
      title={zh('筛选与排序', 'Filter & sort')}
      onClose={onClose}
      height="78vh"
      footer={
        <>
          <button
            type="button"
            onClick={reset}
            className="h-11 w-24 flex-none rounded-card bg-[#f1f2f5] text-sm font-bold text-zinc-700"
          >
            {zh('重置', 'Reset')}
          </button>
          <button
            type="button"
            onClick={apply}
            className="h-11 flex-1 rounded-card bg-brand text-[14.5px] font-bold text-white shadow-[0_6px_16px_-6px_rgba(37,99,235,0.9)]"
          >
            {count === null
              ? zh('应用筛选', 'Apply')
              : zh(`查看 ${count} 个结果`, `Show ${count} results`)}
          </button>
        </>
      }
    >
      <div className="mb-5">
        <h4 className="mb-2.5 text-xs font-bold text-zinc-500">{zh('排序方式', 'Sort by')}</h4>
        <div className="flex flex-wrap gap-2">
          {VIDEO_SORT_OPTIONS.map((option) => (
            <OptionPill
              key={option.base}
              active={sortOption?.base === option.base}
              onClick={() => setDraftSort(normalizeVideoSort(option.descValue))}
            >
              {zh(option.label[0], option.label[1])}
            </OptionPill>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <div className="flex gap-0.5 rounded-lg bg-[#eceef2] p-[3px]">
            <button
              type="button"
              onClick={() => sortOption && setDraftSort(normalizeVideoSort(sortOption.descValue))}
              className={`rounded-md px-3 py-1 text-xs font-semibold ${
                direction === 'desc' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'
              }`}
            >
              {sortOption ? zh(sortOption.desc[0], sortOption.desc[1]) : zh('降序', 'Desc')}
            </button>
            <button
              type="button"
              onClick={() => sortOption && setDraftSort(normalizeVideoSort(sortOption.ascValue))}
              className={`rounded-md px-3 py-1 text-xs font-semibold ${
                direction === 'asc' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'
              }`}
            >
              {sortOption ? zh(sortOption.asc[0], sortOption.asc[1]) : zh('升序', 'Asc')}
            </button>
          </div>
          <span className="ml-auto text-xs text-zinc-400">
            {counting
              ? zh('统计中…', 'Counting...')
              : count === null
                ? ''
                : zh(`共 ${count} 部`, `${count} videos`)}
          </span>
        </div>
      </div>

      <div className="mb-5">
        <h4 className="mb-2.5 text-xs font-bold text-zinc-500">
          {zh('标签（可多选）', 'Tags (multi-select)')}
        </h4>
        <div className="mb-2.5 flex h-8 items-center gap-1.5 rounded-lg border border-[#d8dbe1] bg-white px-2.5">
          <Icon name="search" size={14} className="text-zinc-400" />
          <input
            value={tagQuery}
            onChange={(event) => setTagQuery(event.target.value)}
            placeholder={zh('搜索标签', 'Search tags')}
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-zinc-400"
          />
          {tagQuery ? (
            <button type="button" onClick={() => setTagQuery('')} aria-label="清除">
              <Icon name="x" size={13} className="text-zinc-400" />
            </button>
          ) : null}
        </div>
        {visibleTags.length === 0 ? (
          <p className="text-xs text-zinc-400">{zh('没有匹配的标签', 'No matching tags')}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {visibleTags.map((tag) => {
              const name = String(tag?.name || '')
              const active = draftTags.includes(name)
              return (
                <button
                  key={tag?.id ?? name}
                  type="button"
                  onClick={() =>
                    setDraftTags((current) =>
                      current.includes(name)
                        ? current.filter((value) => value !== name)
                        : [...current, name]
                    )
                  }
                  className={`inline-flex h-7 items-center rounded-lg border px-2.5 text-xs font-semibold ${
                    active
                      ? 'border-brand bg-brand text-white'
                      : 'border-[#d8dbe1] bg-white text-zinc-700'
                  }`}
                >
                  {name}
                </button>
              )
            })}
          </div>
        )}
        {allTags.length > 80 && !tagQuery ? (
          <p className="mt-2 text-[11px] text-zinc-400">
            {zh(
              `仅显示前 80 个标签（共 ${allTags.length} 个），可用上方搜索`,
              `Showing first 80 of ${allTags.length}`
            )}
          </p>
        ) : null}
      </div>

      <div className="mb-2">
        <h4 className="mb-2.5 text-xs font-bold text-zinc-500">{zh('列表内容', 'List content')}</h4>
        <div className="flex items-center gap-3 rounded-card border border-[#e6e8ec] bg-white px-3.5 py-3">
          <span className="flex-1">
            <span className="block text-[13.5px] text-zinc-800">
              {zh('隐藏已刮削视频', 'Hide scraped videos')}
            </span>
            <span className="mt-0.5 block text-[11px] text-zinc-400">
              {zh('列表中不显示已关联 JAV 的视频', 'Videos already linked to a JAV entry')}
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={draftHideJav}
            aria-label={zh('隐藏已刮削视频', 'Hide scraped videos')}
            onClick={() => setDraftHideJav((value) => !value)}
            className={`relative h-[25px] w-[42px] flex-none rounded-full transition ${
              draftHideJav ? 'bg-brand' : 'bg-[#d8dbe1]'
            }`}
          >
            <span
              className={`absolute top-[2.5px] h-5 w-5 rounded-full bg-white shadow transition-all ${
                draftHideJav ? 'right-[2.5px]' : 'left-[2.5px]'
              }`}
            />
          </button>
        </div>
      </div>
    </BottomSheet>
  )
}
