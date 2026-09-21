import { useCallback, useEffect, useRef, useState } from 'react'

import { fetchJavIdols, fetchJavSeries, fetchJavStudios, fetchJavs } from '@/api'
import Icon from '@/components/Icons'
import IdolCover from '@/components/IdolCover'
import JavWorkCard from '@/components/JavWorkCard'
import { JAV_DENSITY_COLUMNS, normalizeIdolSort } from '@/constants/jav'
import useHideOnScroll from '@/hooks/useHideOnScroll'
import { useStore } from '@/store'
import { configString } from '@/utils/config'
import { formatCount } from '@/utils/format'
import { javPageSize } from '@/utils/javDisplay'
import { zh } from '@/utils/i18n'

const TABS = [
  ['works', zh('作品', 'Works')],
  ['idols', zh('女优', 'Idols')],
  ['studios', zh('片商', 'Studios')],
  ['series', zh('系列', 'Series')],
]

const FETCHERS = {
  works: fetchJavs,
  idols: fetchJavIdols,
  studios: fetchJavStudios,
  series: fetchJavSeries,
}

/**
 * 次级导航：吸顶但不必常显 —— 下滑时收起，上滑时重新出现。
 * 主功能栏（排序 / 随机 / 密度 / 筛选）由 App 渲染，始终可见。
 */
function JavTabs({ value, onChange, total, loading, hidden }) {
  return (
    <div
      className="sticky top-[96px] z-[9] flex-none overflow-hidden border-b border-[#e6e8ec] bg-white/95 backdrop-blur-md transition-transform duration-200 ease-out"
      style={{ transform: hidden ? 'translateY(-100%)' : 'translateY(0)' }}
      aria-hidden={hidden}
    >
      <div className="no-scrollbar flex gap-[7px] overflow-x-auto px-3 py-2">
        {TABS.map(([tabValue, label]) => (
          <button
            key={tabValue}
            type="button"
            onClick={() => onChange(tabValue)}
            tabIndex={hidden ? -1 : 0}
            className={`h-[30px] flex-none rounded-full border px-3 text-[12.5px] font-semibold ${
              value === tabValue
                ? 'border-brand bg-brand text-white'
                : 'border-[#d8dbe1] bg-white text-zinc-700'
            }`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto flex flex-none items-center pr-1 text-[11px] tabular-nums text-zinc-400">
          {loading ? '' : formatCount(total)}
        </span>
      </div>
    </div>
  )
}

/** JAV 内容区。顶栏与功能栏由 App 渲染，这里只负责子分类行 + 网格。 */
export default function JavListPage() {
  const pushPage = useStore((state) => state.pushPage)
  const search = useStore((state) => state.searchTerm)
  const tab = useStore((state) => state.javTab)
  const setTab = useStore((state) => state.setJavTab)
  const javSort = useStore((state) => state.javSort)
  const javRandomSeed = useStore((state) => state.javRandomSeed)
  const javDensity = useStore((state) => state.javDensity)
  const jumpToJavWorks = useStore((state) => state.jumpToJavWorks)
  const filters = useStore((state) => state.javFilters)
  const config = useStore((state) => state.config)

  // 每页数量与女优默认排序都来自全局设置（缺省值与 PC 端一致）。
  const pageSize = javPageSize(config, tab)
  const idolSort = normalizeIdolSort(configString(config, 'idol_sort', 'work'))

  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')

  const sentinelRef = useRef(null)
  const seqRef = useRef(0)

  // 子分类行：下滑隐藏、上滑显示。
  const tabsHidden = useHideOnScroll({ enabled: true })

  const filtersKey = JSON.stringify(filters)

  const load = useCallback(
    async (offset = 0) => {
      const fetcher = FETCHERS[tab]
      const seq = offset === 0 ? (seqRef.current += 1) : seqRef.current
      if (offset === 0) {
        setLoading(true)
        setError('')
      } else {
        setLoadingMore(true)
      }

      const parsed = JSON.parse(filtersKey)
      const common = { limit: pageSize, offset, search }
      const params =
        tab === 'works'
          ? {
              ...common,
              idolIds: parsed.idolIds,
              tagIds: parsed.tagIds,
              studioId: parsed.studioId,
              seriesId: parsed.seriesId,
              prefix: parsed.prefix,
              favoriteGroupId: parsed.favoriteGroupId,
              soloOnly: parsed.soloOnly,
              favoriteRatingEnabled: parsed.favoriteRatingEnabled,
              favoriteRatingMin: parsed.favoriteRatingMin,
              favoriteRatingMax: parsed.favoriteRatingMax,
              sort: javRandomSeed ? 'random' : javSort,
              seed: javRandomSeed || null,
            }
          : tab === 'idols'
            ? { ...common, sort: idolSort }
            : common

      try {
        const resp = await fetcher(params)
        if (seq !== seqRef.current) return
        const next = resp?.items || []
        setItems((current) => (offset === 0 ? next : [...current, ...next]))
        setTotal(resp?.total ?? next.length)
      } catch (err) {
        if (seq !== seqRef.current) return
        setError(err.message)
        if (offset === 0) setItems([])
      } finally {
        if (seq === seqRef.current) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [tab, search, javSort, javRandomSeed, filtersKey, pageSize, idolSort]
  )

  useEffect(() => {
    load(0)
  }, [load])

  const hasNext = items.length < total

  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !hasNext || loading || loadingMore || javRandomSeed) return undefined
    if (typeof IntersectionObserver !== 'function') return undefined
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) load(items.length)
      },
      { rootMargin: '400px' }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasNext, loading, loadingMore, items.length, load, javRandomSeed])

  const columns = JAV_DENSITY_COLUMNS[javDensity] || JAV_DENSITY_COLUMNS.standard
  const compact = javDensity === 'compact'

  return (
    <>
      <JavTabs value={tab} onChange={setTab} total={total} loading={loading} hidden={tabsHidden} />

      {search ? (
        <div className="flex items-center gap-2 border-b border-[#e6e8ec] bg-white px-3 py-2 text-[12px] text-zinc-500">
          <Icon name="search" size={13} />
          <span className="truncate">{zh(`搜索「${search}」`, `Searching “${search}”`)}</span>
        </div>
      ) : null}

      {javRandomSeed ? (
        <div className="flex items-center gap-2 border-b border-[#e6e8ec] bg-brand-soft px-3 py-2 text-[12px] text-brand-ink">
          <Icon name="shuffle" size={13} />
          <span>{zh('随机模式：不支持分页', 'Random mode: no pagination')}</span>
          <button
            type="button"
            onClick={() => useStore.getState().clearJavRandom()}
            className="ml-auto flex-none font-semibold underline"
          >
            {zh('退出随机', 'Exit')}
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="mx-2.5 mt-2.5 flex items-start gap-2 rounded-card border border-red-200 bg-red-50 px-3 py-2.5 text-[12.5px] text-red-700">
          <Icon name="ban" size={15} className="mt-[1px] flex-none" />
          <span>{error}</span>
        </div>
      ) : null}

      <main className="min-h-0 flex-1">
        {loading ? (
          <div
            className="grid gap-2.5 p-2.5"
            style={{ gridTemplateColumns: `repeat(${columns.works}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: columns.works * 2 }).map((_, index) => (
              <div key={index} className="skeleton aspect-[800/538] rounded-card" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="px-6 py-24 text-center">
            <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-white text-zinc-300 shadow-sm">
              <Icon name="star" size={26} />
            </div>
            <p className="text-sm font-medium text-zinc-500">
              {zh('没有找到内容', 'Nothing found')}
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              {zh('试试清空筛选或换个关键词', 'Try clearing filters or another keyword')}
            </p>
          </div>
        ) : (
          <div className="px-2.5 pt-2.5">
            {tab === 'works' ? (
              <div
                className="grid"
                style={{
                  gridTemplateColumns: `repeat(${columns.works}, minmax(0, 1fr))`,
                  gap: compact ? 7 : 10,
                }}
              >
                {items.map((item) => (
                  <JavWorkCard
                    key={item.id}
                    item={item}
                    density={javDensity}
                    onOpen={(value) => pushPage('jav-detail', value)}
                  />
                ))}
              </div>
            ) : tab === 'idols' ? (
              <div
                className="grid"
                style={{
                  gridTemplateColumns: `repeat(${columns.idols}, minmax(0, 1fr))`,
                  gap: compact ? 6 : 8,
                }}
              >
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => pushPage('jav-idol', item)}
                    className="overflow-hidden rounded-card border border-[#e6e8ec] bg-white text-left"
                  >
                    <IdolCover code={item.cover_code} alt={item.name} className="w-full" />
                    <div className={compact ? 'px-1 pb-1.5 pt-1' : 'px-1.5 pb-2 pt-1.5'}>
                      <h3
                        className={`line-clamp-2 font-semibold leading-[1.3] text-zinc-800 ${
                          compact ? 'text-[10px]' : 'text-[11px]'
                        }`}
                      >
                        {item.name}
                      </h3>
                      {!compact ? (
                        <p className="mt-0.5 text-[10px] text-zinc-400">
                          {formatCount(item.work_count)} {zh('部', 'works')}
                        </p>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="overflow-hidden rounded-card border border-[#e6e8ec] bg-white">
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() =>
                      jumpToJavWorks(
                        tab === 'studios'
                          ? { studioId: item.id, studioName: item.name }
                          : { seriesId: item.id, seriesName: item.name }
                      )
                    }
                    className="flex w-full items-center gap-3 border-b border-[#f1f2f5] px-3.5 py-3 text-left last:border-b-0 active:bg-zinc-50"
                  >
                    <div className="min-w-0 flex-1">
                      <b className="block truncate text-[13.5px] font-semibold text-zinc-800">
                        {item.name}
                      </b>
                      <span className="mt-0.5 block truncate text-[11px] text-zinc-400">
                        {[item.studio_name, `${formatCount(item.work_count)} ${zh('部', 'works')}`]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </div>
                    <span className="flex-none text-[11px] font-semibold text-brand">
                      {zh('查看影片', 'View works')}
                    </span>
                    <Icon name="right" size={14} className="flex-none text-zinc-300" />
                  </button>
                ))}
              </div>
            )}

            <div ref={sentinelRef} className="h-px w-full" aria-hidden="true" />
            <div className="flex items-center justify-center gap-2 py-4 pb-10 text-xs text-zinc-400">
              {loadingMore ? (
                <>
                  <span className="spin h-3.5 w-3.5 rounded-full border-2 border-zinc-300 border-t-zinc-500" />
                  {zh('正在加载更多…', 'Loading more...')}
                </>
              ) : javRandomSeed ? (
                zh('随机模式已加载 24 项', 'Random mode loaded 24 items')
              ) : hasNext ? (
                zh('继续下滑加载更多', 'Scroll for more')
              ) : (
                zh(`已到底部 · 共 ${total} 项`, `End · ${total} total`)
              )}
            </div>
          </div>
        )}
      </main>
    </>
  )
}
