import { useCallback, useEffect, useRef, useState } from 'react'

import { fetchJavIdols, updateJavItem } from '@/api'
import BottomSheet from '@/components/BottomSheet'
import Icon from '@/components/Icons'
import { useStore } from '@/store'
import { getErrorMessage } from '@/utils/errors'
import { formatCount } from '@/utils/format'
import { idolDisplayName, javDisplayPrefs } from '@/utils/javDisplay'
import { zh } from '@/utils/i18n'

const PAGE_SIZE = 30

/**
 * 给作品手动关联演员的抽屉。
 *
 * 只允许从**已有**女优里挑选（候选来自 `GET /jav/idols`，搜索 + 无限滚动），
 * 刻意不提供新建入口 —— 需求明确「只允许从现在已有的演员列表中选择」，用于给
 * 刮削不到演员的作品补上关联。保存走 `PUT /jav/items/:id` 的 `idol_ids`（覆盖式：
 * 取消勾选即解除关联，清空即移除全部）。
 */
export default function JavActorPickerSheet({ open, jav, onClose, onSaved }) {
  const showToast = useStore((state) => state.showToast)
  const config = useStore((state) => state.config)
  const prefs = javDisplayPrefs(config)
  const javId = Number(jav?.id) || 0

  const [search, setSearch] = useState('')
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  // id → 女优对象：用 Map 而不是 id 数组，这样已选项即使不在当前搜索结果里也能显示名字。
  const [selected, setSelected] = useState(() => new Map())
  const [saving, setSaving] = useState(false)

  const sentinelRef = useRef(null)
  const seqRef = useRef(0)

  // 打开时把作品现有演员作为初始选择，并把上一轮的草稿状态清干净。
  useEffect(() => {
    if (!open) return
    const initial = new Map()
    for (const idol of Array.isArray(jav?.idols) ? jav.idols : []) {
      const id = Number(idol?.id)
      if (Number.isFinite(id) && id > 0) initial.set(id, idol)
    }
    setSearch('')
    setSelected(initial)
    setError('')
    setSaving(false)
  }, [open, jav])

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
        const resp = await fetchJavIdols({ limit: PAGE_SIZE, offset, search: search.trim() })
        if (seq !== seqRef.current) return
        const list = Array.isArray(resp?.items) ? resp.items : []
        setItems((current) => (offset === 0 ? list : [...current, ...list]))
        setTotal(Number(resp?.total) || 0)
      } catch (err) {
        if (seq === seqRef.current) {
          setError(getErrorMessage(err))
          if (offset === 0) {
            setItems([])
            setTotal(0)
          }
        }
      } finally {
        if (seq === seqRef.current) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [search]
  )

  // 搜索防抖：输入停顿后再请求，避免每敲一个字都打一次后端。
  useEffect(() => {
    if (!open) return undefined
    const timer = window.setTimeout(() => {
      void load(0)
    }, 200)
    return () => window.clearTimeout(timer)
  }, [open, load])

  // 触底加载下一页。
  useEffect(() => {
    if (!open) return undefined
    const node = sentinelRef.current
    if (!node || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        if (loading || loadingMore || items.length >= total) return
        void load(items.length)
      },
      { rootMargin: '120px' }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [open, items.length, total, loading, loadingMore, load])

  const toggle = (idol) => {
    const id = Number(idol?.id)
    if (!Number.isFinite(id) || id <= 0) return
    setSelected((current) => {
      const next = new Map(current)
      if (next.has(id)) next.delete(id)
      else next.set(id, idol)
      return next
    })
  }

  const save = async () => {
    if (!javId || saving) return
    setSaving(true)
    setError('')
    try {
      const chosen = Array.from(selected.values())
      const updated = await updateJavItem(javId, {
        idol_ids: chosen.map((idol) => Number(idol?.id)).filter((id) => id > 0),
      })
      const nextIdols = Array.isArray(updated?.idols) ? updated.idols : chosen
      onSaved?.(nextIdols)
      showToast?.(zh('演员已更新', 'Cast updated'))
      onClose?.()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const selectedList = Array.from(selected.values())

  return (
    <BottomSheet
      open={open}
      title={zh('调整演员', 'Edit cast')}
      subtitle={[jav?.code, jav?.title].filter(Boolean).join(' ') || zh('JAV 作品', 'JAV work')}
      onClose={onClose}
      height="80vh"
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
            disabled={saving || loading || !javId}
            className="h-11 flex-1 rounded-card bg-brand text-[14.5px] font-bold text-white disabled:opacity-50"
          >
            {saving
              ? zh('保存中…', 'Saving...')
              : zh(`保存（已选 ${selected.size}）`, `Save (${selected.size})`)}
          </button>
        </>
      }
    >
      {error ? (
        <div className="mb-3 rounded-card border border-red-200 bg-red-50 px-3 py-2 text-[12px] leading-relaxed text-red-700">
          {error}
        </div>
      ) : null}

      {selectedList.length ? (
        <div className="mb-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[12px] font-semibold text-zinc-500">
              {zh('已选演员', 'Selected')}
            </span>
            <button
              type="button"
              onClick={() => setSelected(new Map())}
              disabled={saving}
              className="text-[11.5px] font-semibold text-brand active:underline disabled:opacity-40"
            >
              {zh('清空', 'Clear')}
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {selectedList.map((idol) => (
              <button
                key={idol?.id}
                type="button"
                onClick={() => toggle(idol)}
                disabled={saving}
                className="flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 text-[12px] font-medium text-brand active:opacity-70"
              >
                <span className="max-w-[10rem] truncate">
                  {idolDisplayName(idol, prefs.preferChineseName) || zh('未知女优', 'Unknown idol')}
                </span>
                <Icon name="x" size={12} />
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mb-3 flex items-center gap-2 rounded-[10px] border border-[#e3e5ea] bg-white px-3 py-2">
        <Icon name="search" size={16} className="flex-none text-zinc-400" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={zh('搜索已有演员', 'Search existing idols')}
          aria-label={zh('搜索已有演员', 'Search existing idols')}
          className="min-w-0 flex-1 bg-transparent text-[16px] leading-snug outline-none placeholder:text-zinc-300"
        />
        {search ? (
          <button
            type="button"
            onClick={() => setSearch('')}
            aria-label={zh('清空搜索', 'Clear search')}
            className="flex-none p-0.5 text-zinc-400"
          >
            <Icon name="x" size={14} />
          </button>
        ) : null}
      </div>

      {loading ? (
        <div className="flex flex-col gap-2 pb-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="skeleton h-12 rounded-card" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="py-8 text-center text-[12.5px] text-zinc-400">
          {search.trim()
            ? zh('没有匹配的演员', 'No matching idols')
            : zh(
                '还没有任何演员，请先在女优页添加',
                'No idols yet — add one from the idol page first'
              )}
        </p>
      ) : (
        <div className="flex flex-col gap-2 pb-4">
          {items.map((idol) => {
            const id = Number(idol?.id)
            const active = selected.has(id)
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggle(idol)}
                disabled={saving}
                className={`flex items-center gap-3 rounded-card border px-3.5 py-3 text-left ${
                  active ? 'border-brand bg-brand-soft' : 'border-[#e6e8ec] bg-white'
                }`}
              >
                <span
                  className={`grid h-5 w-5 flex-none place-items-center rounded-[6px] border ${
                    active ? 'border-brand bg-brand text-white' : 'border-zinc-300 bg-white'
                  }`}
                >
                  {active ? <Icon name="check" size={12} /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-zinc-800">
                  {idolDisplayName(idol, prefs.preferChineseName) || zh('未知女优', 'Unknown idol')}
                </span>
                {idol?.work_count ? (
                  <span className="flex-none text-[11px] tabular-nums text-zinc-400">
                    {zh(
                      `${formatCount(idol.work_count)} 部`,
                      `${formatCount(idol.work_count)} works`
                    )}
                  </span>
                ) : null}
              </button>
            )
          })}
          {items.length < total ? (
            <div ref={sentinelRef} className="py-3 text-center text-[11.5px] text-zinc-400">
              {loadingMore ? zh('加载中…', 'Loading...') : ''}
            </div>
          ) : null}
        </div>
      )}
    </BottomSheet>
  )
}
