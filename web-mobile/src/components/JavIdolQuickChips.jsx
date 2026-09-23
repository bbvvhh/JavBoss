import Icon from '@/components/Icons'
import { findIdolSortOption, idolProfileFilterCount, idolSortLabel } from '@/constants/jav'
import { useStore } from '@/store'
import { configString } from '@/utils/config'
import { zh } from '@/utils/i18n'

function Chip({ tone = 'default', onClick, children, ...rest }) {
  const base =
    'inline-flex h-[30px] flex-none items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] font-semibold'
  const tones = {
    default: 'border-[#d8dbe1] bg-white text-zinc-700',
    active: 'border-brand-line bg-brand-soft text-brand-ink',
    dark: 'border-zinc-900 bg-zinc-900 text-white',
  }
  return (
    <button type="button" onClick={onClick} className={`${base} ${tones[tone]}`} {...rest}>
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
 * 女优页的功能栏（第二行）。
 *
 * 作品页那套「排序 / 随机 / 标签 / 收藏夹 / 筛选」只作用于作品：后端 `/jav/idols`
 * 只认 `sort` 与 `idol_*_min/max`，借用过去只会是一排点不动的按钮。这里对齐
 * PC 端女优页（`JavIdolView` 的排序 + `IdolProfileFilters` 的资料范围筛选），
 * 两者都收在同一个抽屉里（与作品页的 JavFilterSheet 同一种交互）。
 */
export default function JavIdolQuickChips({ onOpenIdolSheet }) {
  const idolSort = useStore((state) => state.idolSort)
  const profileFilters = useStore((state) => state.idolProfileFilters)
  const config = useStore((state) => state.config)
  const resetIdolControls = useStore((state) => state.resetIdolControls)

  const profileCount = idolProfileFilterCount(profileFilters)
  const hasAny = profileCount > 0 || Boolean(idolSort)

  // 与作品页的排序 chip 一致：直接显示当前生效的排序项，而不是干巴巴的「排序」。
  // 临时排序为空时显示的就是全局设置里的 idol_sort。
  const sortOption = findIdolSortOption(idolSort || configString(config, 'idol_sort', 'work'))
  const sortLabel = zh(...idolSortLabel(sortOption))

  return (
    <div className="no-scrollbar sticky top-[50px] z-10 flex flex-none gap-[7px] overflow-x-auto border-b border-[#e6e8ec] bg-white/95 px-3 py-2 backdrop-blur-md">
      <Chip
        tone={idolSort ? 'active' : 'default'}
        onClick={onOpenIdolSheet}
        aria-haspopup="dialog"
        aria-label={zh('女优排序与资料筛选', 'Idol sort & profile filters')}
      >
        <Icon name="sort" size={14} />
        {sortLabel}
      </Chip>

      <Chip
        tone={profileCount ? 'active' : 'default'}
        onClick={onOpenIdolSheet}
        aria-haspopup="dialog"
        aria-label={zh('女优资料筛选', 'Idol profile filters')}
      >
        <Icon name="filter" size={14} />
        {zh('资料筛选', 'Profile')}
        <Count value={profileCount} />
      </Chip>

      {hasAny ? (
        <Chip tone="dark" onClick={resetIdolControls}>
          <Icon name="x" size={13} />
          {zh('清空', 'Clear')}
        </Chip>
      ) : null}
    </div>
  )
}
