import Icon from '@/components/Icons'
import { findVideoSortOption } from '@/constants/video'
import { useStore } from '@/store'
import { zh } from '@/utils/i18n'

function Chip({ tone = 'default', onClick, children }) {
  const base =
    'inline-flex h-[30px] flex-none items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] font-semibold'
  const tones = {
    default: 'border-[#d8dbe1] bg-white text-zinc-700',
    active: 'border-brand-line bg-brand-soft text-brand-ink',
    dashed: 'border-dashed border-[#d8dbe1] bg-white text-zinc-500',
    dark: 'border-zinc-900 bg-zinc-900 text-white',
  }
  return (
    <button type="button" onClick={onClick} className={`${base} ${tones[tone]}`}>
      {children}
    </button>
  )
}

export default function QuickChips({ onOpenFilter }) {
  const sort = useStore((state) => state.sort)
  const selectedTags = useStore((state) => state.selectedTags)
  const hideJav = useStore((state) => state.hideJav)
  const randomSeed = useStore((state) => state.randomSeed)
  const clearFilters = useStore((state) => state.clearFilters)
  const rollRandom = useStore((state) => state.rollRandom)
  const clearRandom = useStore((state) => state.clearRandom)

  const hasFilters = selectedTags.length > 0 || hideJav || sort !== 'recent' || Boolean(randomSeed)
  const sortOption = findVideoSortOption(sort)
  const sortLabel = sortOption ? zh(sortOption.label[0], sortOption.label[1]) : zh('排序', 'Sort')

  return (
    <div className="no-scrollbar sticky top-[50px] z-10 flex flex-none gap-[7px] overflow-x-auto border-b border-[#e6e8ec] bg-white/95 px-3 py-2 backdrop-blur-md">
      <Chip tone={hasFilters ? 'active' : 'default'} onClick={onOpenFilter}>
        <Icon name="sort" size={14} />
        {sortLabel}
      </Chip>

      <Chip
        tone={randomSeed ? 'active' : 'default'}
        onClick={() => (randomSeed ? clearRandom() : rollRandom())}
      >
        <Icon name="shuffle" size={14} />
        {zh('随机', 'Random')}
      </Chip>

      <Chip tone={selectedTags.length > 0 ? 'active' : 'default'} onClick={onOpenFilter}>
        <Icon name="tag" size={14} />
        {zh('标签', 'Tags')}
        {selectedTags.length ? (
          <span className="min-w-[14px] rounded-full bg-brand px-1 text-center text-[10px] text-white">
            {selectedTags.length}
          </span>
        ) : null}
      </Chip>

      <Chip tone="dashed" onClick={onOpenFilter}>
        <Icon name="filter" size={14} />
        {zh('筛选', 'Filter')}
      </Chip>

      {hasFilters ? (
        <Chip tone="dark" onClick={clearFilters}>
          <Icon name="x" size={13} />
          {zh('清空', 'Clear')}
        </Chip>
      ) : null}
    </div>
  )
}
