import { useMemo } from 'react'

import Icon from '@/components/Icons'
import { findJavSortOption, javSortLabel, JAV_DENSITY_LABELS } from '@/constants/jav'
import { useStore } from '@/store'
import { zh } from '@/utils/i18n'

function Chip({ tone = 'default', onClick, children }) {
  const base =
    'inline-flex h-[30px] flex-none items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] font-semibold'
  const tones = {
    default: 'border-[#d8dbe1] bg-white text-zinc-700',
    active: 'border-brand-line bg-brand-soft text-brand-ink',
    dark: 'border-zinc-900 bg-zinc-900 text-white',
  }
  return (
    <button type="button" onClick={onClick} className={`${base} ${tones[tone]}`}>
      {children}
    </button>
  )
}

function Count({ value }) {
  if (!value) return null
  return (
    <span className="min-w-[14px] rounded-full bg-brand px-1 text-center text-[10px] text-white">
      {value}
    </span>
  )
}

/**
 * JAV 模式的功能栏，与视频模式的 QuickChips 同位置、同行为：吸顶常显。
 * 排序 / 随机 / 密度 / 标签 / 收藏夹 / 筛选 —— 标签与收藏夹都做成了独立入口，
 * 不用再钻进筛选抽屉里找。
 */
export default function JavQuickChips({ onOpenFilter, onOpenTags, onOpenFavorites }) {
  const javSort = useStore((state) => state.javSort)
  const javDensity = useStore((state) => state.javDensity)
  const javRandomSeed = useStore((state) => state.javRandomSeed)
  const filters = useStore((state) => state.javFilters)
  const rollJavRandom = useStore((state) => state.rollJavRandom)
  const clearJavRandom = useStore((state) => state.clearJavRandom)
  const openJavDensitySheet = useStore((state) => state.openJavDensitySheet)
  const clearJavFilters = useStore((state) => state.clearJavFilters)
  const setJavSort = useStore((state) => state.setJavSort)

  const tagCount = filters.tagIds.length
  const hasFavorite = Boolean(filters.favoriteGroupId)

  // 「筛选」chip 只反映抽屉里的条件，标签与收藏夹各自计数，避免数字对不上。
  const drawerCount = useMemo(
    () =>
      (filters.prefix ? 1 : 0) +
      (filters.idolIds.length ? 1 : 0) +
      (filters.studioId ? 1 : 0) +
      (filters.seriesId ? 1 : 0) +
      (filters.soloOnly ? 1 : 0) +
      (filters.favoriteRatingEnabled ? 1 : 0),
    [filters]
  )

  const hasAny = drawerCount > 0 || tagCount > 0 || hasFavorite || Boolean(javRandomSeed)

  const sortOption = findJavSortOption(javSort)
  const sortLabel = zh(...javSortLabel(sortOption))
  const densityLabel = zh(...JAV_DENSITY_LABELS[javDensity])

  return (
    <div className="no-scrollbar sticky top-[50px] z-10 flex flex-none gap-[7px] overflow-x-auto border-b border-[#e6e8ec] bg-white/95 px-3 py-2 backdrop-blur-md">
      <Chip tone={drawerCount > 0 ? 'active' : 'default'} onClick={onOpenFilter}>
        <Icon name="sort" size={14} />
        {sortLabel}
      </Chip>

      <Chip
        tone={javRandomSeed ? 'active' : 'default'}
        onClick={() => (javRandomSeed ? clearJavRandom() : rollJavRandom())}
      >
        <Icon name="shuffle" size={14} />
        {zh('随机', 'Random')}
      </Chip>

      <Chip tone="active" onClick={openJavDensitySheet}>
        <Icon name="layers" size={14} />
        {densityLabel}
      </Chip>

      <Chip tone={tagCount ? 'active' : 'default'} onClick={onOpenTags}>
        <Icon name="tag" size={14} />
        {zh('标签', 'Tags')}
        <Count value={tagCount} />
      </Chip>

      <Chip tone={hasFavorite ? 'active' : 'default'} onClick={onOpenFavorites}>
        <Icon name="star" size={14} />
        <span className="max-w-[7rem] truncate">
          {hasFavorite
            ? filters.favoriteGroupName || zh('收藏夹', 'Favorites')
            : zh('收藏夹', 'Favorites')}
        </span>
      </Chip>

      <Chip tone={drawerCount > 0 ? 'active' : 'default'} onClick={onOpenFilter}>
        <Icon name="filter" size={14} />
        {zh('筛选', 'Filter')}
        <Count value={drawerCount} />
      </Chip>

      {hasAny ? (
        <Chip
          tone="dark"
          onClick={() => {
            clearJavFilters()
            setJavSort('recent')
            clearJavRandom()
          }}
        >
          <Icon name="x" size={13} />
          {zh('清空', 'Clear')}
        </Chip>
      ) : null}
    </div>
  )
}
