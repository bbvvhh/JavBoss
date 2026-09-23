import { useEffect, useState } from 'react'

import { fetchJavIdols } from '@/api'
import BottomSheet from '@/components/BottomSheet'
import Icon from '@/components/Icons'
import {
  IDOL_PROFILE_FILTER_DEFINITIONS,
  IDOL_SORT_OPTIONS,
  createDefaultIdolProfileFilters,
  findIdolSortOption,
  formatIdolProfileRange,
  formatIdolProfileValue,
  idolProfileRangeParams,
  idolSortDirections,
  idolSortLabel,
  isIdolSortAscending,
  normalizeIdolProfileFilters,
  normalizeIdolSort,
} from '@/constants/jav'
import { useStore } from '@/store'
import { configString } from '@/utils/config'
import { formatCount } from '@/utils/format'
import { zh } from '@/utils/i18n'

const EMPTY_PROFILE_FILTERS = createDefaultIdolProfileFilters()

function SectionTitle({ children, extra }) {
  return (
    <h4 className="mb-2.5 flex items-center text-xs font-bold text-zinc-500">
      <span>{children}</span>
      {extra ? <span className="ml-auto font-medium text-zinc-400">{extra}</span> : null}
    </h4>
  )
}

function OptionChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-semibold ${
        active ? 'border-brand bg-brand text-white' : 'border-[#d8dbe1] bg-white text-zinc-700'
      }`}
    >
      <span className="max-w-[10rem] truncate">{children}</span>
    </button>
  )
}

/** 一个资料项的「启用开关 + 双滑块区间」。滑块两端互相夹住，不会出现 min > max。 */
function ProfileFilterCard({ definition, value, onChange }) {
  const label = zh(...definition.label)
  const rangeLabel = formatIdolProfileRange(definition, value, zh)
  const minLabel = formatIdolProfileValue(definition, value.min, zh)
  const maxLabel = formatIdolProfileValue(definition, value.max, zh)

  return (
    <div className="rounded-card border border-[#e6e8ec] bg-white px-3.5 py-3">
      <div className="flex items-center gap-3">
        <span className="flex-1">
          <span className="block text-[13.5px] text-zinc-800">{label}</span>
          <span className="mt-0.5 block text-[11px] text-zinc-400">
            {value.enabled ? rangeLabel : zh('未启用', 'Off')}
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={value.enabled}
          aria-label={label}
          onClick={() => onChange({ ...value, enabled: !value.enabled })}
          className={`relative h-[25px] w-[42px] flex-none rounded-full ${
            value.enabled ? 'bg-brand' : 'bg-[#d8dbe1]'
          }`}
        >
          <span
            className={`absolute top-[2.5px] h-5 w-5 rounded-full bg-white shadow transition-all ${
              value.enabled ? 'right-[2.5px]' : 'left-[2.5px]'
            }`}
          />
        </button>
      </div>
      {value.enabled ? (
        <div className="mt-3 flex items-center gap-2">
          <span className="w-12 flex-none text-right text-[11px] tabular-nums text-zinc-500">
            {minLabel}
          </span>
          <input
            type="range"
            min={definition.min}
            max={definition.max}
            step={1}
            value={value.min}
            onChange={(event) =>
              onChange({ ...value, min: Math.min(Number(event.target.value), value.max) })
            }
            aria-label={zh(`最低${label}`, `Minimum ${label}`)}
            className="flex-1 accent-blue-600"
          />
          <input
            type="range"
            min={definition.min}
            max={definition.max}
            step={1}
            value={value.max}
            onChange={(event) =>
              onChange({ ...value, max: Math.max(Number(event.target.value), value.min) })
            }
            aria-label={zh(`最高${label}`, `Maximum ${label}`)}
            className="flex-1 accent-blue-600"
          />
          <span className="w-12 flex-none text-[11px] tabular-nums text-zinc-500">{maxLabel}</span>
        </div>
      ) : null}
    </div>
  )
}

/**
 * 女优页的排序 + 资料范围筛选抽屉。
 *
 * 与 PC 端女优页一一对应：排序项、方向文案、资料项与区间上下限都取自同一份
 * 定义（`constants/jav.js`），范围超界会被后端 400，所以提交前一律先归一化。
 * 排序为空 = 沿用全局设置里的 `idol_sort`（PC 端 idolTempSort 的语义）。
 */
export default function JavIdolFilterSheet({ open, onClose }) {
  const storedSort = useStore((state) => state.idolSort)
  const storedFilters = useStore((state) => state.idolProfileFilters)
  const globalSort = useStore((state) => state.config)
  const searchTerm = useStore((state) => state.searchTerm)

  const [draftSort, setDraftSort] = useState(storedSort)
  const [draftFilters, setDraftFilters] = useState(storedFilters)
  const [count, setCount] = useState(null)
  const [counting, setCounting] = useState(false)
  const [error, setError] = useState('')

  const globalSortValue = normalizeIdolSort(configString(globalSort, 'idol_sort', 'work'), 'work')
  const effectiveSort = draftSort || globalSortValue
  const sortOption = findIdolSortOption(effectiveSort) || IDOL_SORT_OPTIONS[0]
  const ascending = isIdolSortAscending(effectiveSort)
  const directions = idolSortDirections(sortOption)

  useEffect(() => {
    if (!open) return
    setDraftSort(storedSort)
    setDraftFilters(storedFilters)
    setError('')
  }, [open, storedSort, storedFilters])

  // 实时命中数：抽屉开着的时候能看到这套条件还剩多少人。
  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    setCounting(true)
    const timer = window.setTimeout(async () => {
      try {
        const resp = await fetchJavIdols({
          limit: 1,
          offset: 0,
          search: searchTerm,
          sort: effectiveSort,
          profileRanges: idolProfileRangeParams(draftFilters),
        })
        if (!cancelled) setCount(resp?.total ?? 0)
      } catch (err) {
        if (!cancelled) {
          setCount(null)
          setError(err.message)
        }
      } finally {
        if (!cancelled) setCounting(false)
      }
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, searchTerm, effectiveSort, draftFilters])

  const apply = () => {
    const store = useStore.getState()
    store.setIdolSort(draftSort)
    store.setIdolProfileFilters(draftFilters)
    onClose?.()
  }

  return (
    <BottomSheet
      open={open}
      title={zh('女优排序与资料筛选', 'Idol sort & profile filters')}
      onClose={onClose}
      height="84vh"
      footer={
        <>
          <button
            type="button"
            onClick={() => {
              setDraftSort('')
              setDraftFilters(EMPTY_PROFILE_FILTERS)
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
              ? zh('应用', 'Apply')
              : zh(`查看 ${formatCount(count)} 位`, `Show ${formatCount(count)}`)}
          </button>
        </>
      }
    >
      <div className="mb-5">
        <SectionTitle extra={counting ? zh('统计中…', 'Counting...') : null}>
          {zh('排序方式', 'Sort by')}
        </SectionTitle>
        <div className="flex flex-wrap gap-2">
          {IDOL_SORT_OPTIONS.map((option) => (
            <OptionChip
              key={option.base}
              active={sortOption.base === option.base}
              onClick={() => setDraftSort(option.descValue)}
            >
              {zh(...idolSortLabel(option))}
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

      <div className="mb-5">
        <SectionTitle>{zh('资料范围筛选', 'Profile range filters')}</SectionTitle>
        <div className="flex flex-col gap-2">
          {IDOL_PROFILE_FILTER_DEFINITIONS.map((definition) => (
            <ProfileFilterCard
              key={definition.key}
              definition={definition}
              value={normalizeIdolProfileFilters(draftFilters)[definition.key]}
              onChange={(next) =>
                setDraftFilters((current) => ({ ...current, [definition.key]: next }))
              }
            />
          ))}
        </div>
      </div>

      {error ? (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
          <Icon name="ban" size={14} className="mt-[1px] flex-none" />
          <span>{error}</span>
        </div>
      ) : null}
    </BottomSheet>
  )
}
