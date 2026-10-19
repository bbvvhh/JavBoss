import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  addJavDuplicateWhitelist,
  fetchJavDuplicateWhitelist,
  fetchJavDuplicates,
  removeJavDuplicateWhitelist,
} from '@/api'
import { buttonClass } from '@/components/form/Field'
import Icon from '@/components/Icons'
import JavWorkCard from '@/components/JavWorkCard'
import SettingsPage from '@/components/settings/SettingsPage'
import { JAV_DENSITY_COLUMNS } from '@/constants/jav'
import { useStore } from '@/store'
import { getErrorMessage } from '@/utils/errors'
import { formatCount } from '@/utils/format'
import { zh } from '@/utils/i18n'

const PAGE_SIZE = 24

/**
 * JAV 查重页（移动端）。
 *
 * 规则与 PC 端一致：同一番号下存在多个视频文件即视为重复。结果按 JAV 作品列表
 * 展示，勾选后加入查重白名单，白名单里的作品后续不再出现。
 *
 * 所有接口只读 / 只写 javboss.db，不碰任何用户媒体文件 —— 移动端硬约束。
 * 列表数据是本页的本地状态（无限滚动），与二级设置页的做法一致。
 */
export function JavDuplicatePage({ onClose }) {
  const javDensity = useStore((state) => state.javDensity)
  const pushPage = useStore((state) => state.pushPage)
  const showToast = useStore((state) => state.showToast)

  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [saving, setSaving] = useState(false)

  const sentinelRef = useRef(null)
  const seqRef = useRef(0)

  const load = useCallback(
    async (offset = 0) => {
      const seq = offset === 0 ? (seqRef.current += 1) : seqRef.current
      if (offset === 0) {
        setLoading(true)
        setError('')
      } else {
        setLoadingMore(true)
      }
      try {
        const resp = await fetchJavDuplicates({ limit: PAGE_SIZE, offset, search })
        if (seq !== seqRef.current) return
        const next = Array.isArray(resp?.items) ? resp.items : []
        setItems((current) => (offset === 0 ? next : [...current, ...next]))
        setTotal(Number(resp?.total) || 0)
      } catch (err) {
        if (seq !== seqRef.current) return
        setError(getErrorMessage(err))
        if (offset === 0) setItems([])
      } finally {
        if (seq === seqRef.current) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [search]
  )

  useEffect(() => {
    load(0)
  }, [load])

  const hasNext = items.length < total

  useEffect(() => {
    const node = sentinelRef.current
    if (!node || !hasNext || loading || loadingMore) return undefined
    if (typeof IntersectionObserver !== 'function') return undefined
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) load(items.length)
      },
      { rootMargin: '400px' }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasNext, loading, loadingMore, items.length, load])

  const pageIds = useMemo(
    () => items.map((item) => Number(item?.id)).filter((id) => Number.isFinite(id) && id > 0),
    [items]
  )
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id))

  const toggle = (item) => {
    const id = Number(item?.id)
    if (!Number.isFinite(id) || id <= 0) return
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const runSearch = () => {
    setSelected(new Set())
    setSearch(searchInput.trim())
  }

  const toggleSelectPage = () => {
    setSelected(allSelected ? new Set() : new Set(pageIds))
  }

  const addToWhitelist = async () => {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    setSaving(true)
    setError('')
    try {
      await addJavDuplicateWhitelist(ids)
      showToast(
        zh(
          `已将 ${ids.length} 个作品加入查重白名单`,
          `Added ${ids.length} work(s) to the whitelist`
        )
      )
      setSelected(new Set())
      await load(0)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const columns = JAV_DENSITY_COLUMNS[javDensity] || JAV_DENSITY_COLUMNS.standard
  const compact = javDensity === 'compact'

  return (
    <SettingsPage
      title={zh('JAV 查重', 'JAV duplicate scan')}
      subtitle={zh(
        '同一番号下存在多个视频文件即视为重复',
        'Works with more than one video file are duplicates'
      )}
      onBack={onClose}
      headerRight={
        <button
          type="button"
          onClick={() => pushPage('jav-duplicate-whitelist')}
          className="flex-none px-2 text-[13px] font-medium text-brand-ink"
        >
          {zh('白名单', 'Whitelist')}
        </button>
      }
      footer={
        <>
          <button
            type="button"
            disabled={pageIds.length === 0 || saving}
            onClick={toggleSelectPage}
            className={buttonClass('secondary', 'h-11 w-24 flex-none')}
          >
            {allSelected ? zh('取消全选', 'None') : zh('全选本页', 'Select page')}
          </button>
          <button
            type="button"
            disabled={selected.size === 0 || saving}
            onClick={addToWhitelist}
            className={buttonClass('primary', 'h-11 flex-1')}
          >
            {saving
              ? zh('加入中…', 'Adding…')
              : zh(`加入查重白名单（${selected.size}）`, `Add to whitelist (${selected.size})`)}
          </button>
        </>
      }
    >
      <div className="sticky top-0 z-10 border-b border-[#e6e8ec] bg-white px-3 py-2">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            runSearch()
          }}
          className="flex h-9 items-center gap-1.5 rounded-lg border border-[#d8dbe1] bg-white px-2.5"
        >
          <Icon name="search" size={14} className="flex-none text-zinc-400" />
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={zh('搜索番号或标题', 'Search code or title')}
            aria-label={zh('搜索番号或标题', 'Search code or title')}
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-zinc-400"
          />
          {searchInput ? (
            <button
              type="button"
              onClick={() => setSearchInput('')}
              aria-label={zh('清除', 'Clear')}
              className="flex-none"
            >
              <Icon name="x" size={13} className="text-zinc-400" />
            </button>
          ) : null}
          <button
            type="submit"
            className="flex-none px-1 text-[12.5px] font-semibold text-brand-ink"
          >
            {zh('搜索', 'Search')}
          </button>
        </form>
        <div className="mt-2 flex items-center justify-between text-[11.5px] text-zinc-400">
          <span>{zh(`共 ${formatCount(total)} 项`, `${formatCount(total)} item(s)`)}</span>
          <span>{zh(`已选 ${selected.size}`, `Selected ${selected.size}`)}</span>
        </div>
      </div>

      {error ? (
        <p className="mx-3 mt-3 rounded-card border border-red-200 bg-red-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-red-700">
          {error}
        </p>
      ) : null}

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
        <div className="px-6 py-16 text-center">
          <Icon name="copy" size={26} className="mx-auto text-zinc-300" />
          <p className="mt-3 text-[13px] font-medium text-zinc-500">
            {zh('未发现重复作品', 'No duplicates found')}
          </p>
          <p className="mt-1 text-[11.5px] text-zinc-400">
            {zh('试试换个关键词，或查看白名单', 'Try another keyword or check the whitelist')}
          </p>
        </div>
      ) : (
        <div className="px-2.5 pt-2.5">
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
                selectionMode
                selected={selected.has(Number(item.id))}
                onToggle={toggle}
              />
            ))}
          </div>

          <div ref={sentinelRef} className="h-px w-full" aria-hidden="true" />
          <div className="flex items-center justify-center gap-2 py-4 pb-6 text-xs text-zinc-400">
            {loadingMore ? (
              <>
                <span className="spin h-3.5 w-3.5 rounded-full border-2 border-zinc-300 border-t-zinc-500" />
                {zh('正在加载更多…', 'Loading more...')}
              </>
            ) : hasNext ? (
              zh('继续下滑加载更多', 'Scroll for more')
            ) : (
              zh('已到底部', 'End of list')
            )}
          </div>
        </div>
      )}
    </SettingsPage>
  )
}

/** 查重白名单管理：列出已加入的作品，可逐条移出。 */
export function JavDuplicateWhitelistPage({ onClose }) {
  const showToast = useStore((state) => state.showToast)

  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const items = await fetchJavDuplicateWhitelist()
      setEntries(items)
    } catch (err) {
      setError(getErrorMessage(err))
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const remove = async (entry) => {
    const javId = Number(entry?.jav_id)
    if (!Number.isFinite(javId) || javId <= 0) return
    setBusyId(javId)
    setError('')
    try {
      await removeJavDuplicateWhitelist([javId])
      setEntries((prev) => prev.filter((item) => Number(item?.jav_id) !== javId))
      showToast(zh('已移出白名单', 'Removed from the whitelist'))
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusyId(0)
    }
  }

  return (
    <SettingsPage
      title={zh('查重白名单', 'Duplicate whitelist')}
      subtitle={zh(
        '白名单中的作品不会再出现在查重结果中',
        'Whitelisted works are excluded from the scan'
      )}
      onBack={onClose}
      loading={loading}
      error={error ? new Error(error) : null}
      onRetry={load}
    >
      {entries.length === 0 ? (
        <div className="px-5 py-16 text-center">
          <Icon name="shield" size={26} className="mx-auto text-zinc-300" />
          <p className="mt-3 text-[13px] text-zinc-400">
            {zh('白名单为空', 'The whitelist is empty')}
          </p>
        </div>
      ) : (
        <div className="mx-3 mt-3 overflow-hidden rounded-card bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
          {entries.map((entry) => {
            const javId = Number(entry?.jav_id)
            return (
              <div
                key={javId}
                className="flex items-center gap-3 border-t border-[#f1f2f5] px-3.5 py-3 first:border-t-0"
              >
                <span className="min-w-0 flex-1 truncate text-[13.5px] text-zinc-800">
                  {entry?.code || `#${javId}`}
                </span>
                <button
                  type="button"
                  disabled={busyId === javId}
                  onClick={() => remove(entry)}
                  className={buttonClass('danger', 'flex-none h-8')}
                >
                  {zh('移出', 'Remove')}
                </button>
              </div>
            )
          })}
        </div>
      )}

      <p className="px-5 pt-5 text-center text-[11px] leading-relaxed text-zinc-400">
        {zh(
          '移出白名单后，该作品会重新出现在查重结果里。',
          'Removing an entry makes it show up in the scan again.'
        )}
      </p>
    </SettingsPage>
  )
}
