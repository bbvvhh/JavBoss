import { useEffect, useMemo, useState } from 'react'

import { addJavsToFavoriteGroups, addJavTagToJavs } from '@/api'
import BottomSheet from '@/components/BottomSheet'
import Icon from '@/components/Icons'
import { useStore } from '@/store'
import { getErrorMessage } from '@/utils/errors'
import { formatCount } from '@/utils/format'
import { zh } from '@/utils/i18n'

/**
 * JAV 标签 / 收藏夹的批量操作抽屉。
 *
 * - JavBatchTagSheet：JAV 作品多选、视频多选（标签打在视频关联的作品上）都用它。
 * - JavBatchFavoriteSheet：只用于作品多选（把作品加入收藏夹）。
 *
 * 两者都只写 javboss.db（标签关联 / 收藏夹归属），不会碰任何用户文件 ——
 * 这是移动端的硬约束：没有删除、没有移动、没有覆盖。
 * PC 端的第三个动作「使用 MPV 播放全部」不在此列（移动端不做 MPV）。
 */

/** 批量加 JAV 标签：一次只选一个标签，后端 `/jav/tags/add` 是追加语义。 */
export function JavBatchTagSheet({ open, javIds, onClose, onApplied }) {
  const options = useStore((state) => state.javTagOptions)
  const loadOptions = useStore((state) => state.loadJavTagOptions)
  const showToast = useStore((state) => state.showToast)
  const bumpJavListVersion = useStore((state) => state.bumpJavListVersion)

  const [tagId, setTagId] = useState(null)
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setTagId(null)
    setQuery('')
    setError('')
    if (options.length === 0) loadOptions()
  }, [open, options.length, loadOptions])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? options.filter((tag) =>
          String(tag?.name || '')
            .toLowerCase()
            .includes(q)
        )
      : options
    return list.slice(0, 120)
  }, [options, query])

  const apply = async () => {
    const ids = Array.isArray(javIds) ? javIds : []
    if (!tagId || ids.length === 0) return
    setSaving(true)
    setError('')
    try {
      await addJavTagToJavs(tagId, ids)
      // 列表是无限滚动的本地状态，改完得让它重拉一次才能看到新标签。
      bumpJavListVersion()
      showToast(zh(`已给 ${ids.length} 个 JAV 加上标签`, `Tagged ${ids.length} JAV items`))
      onApplied?.()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet
      open={open}
      title={zh('加 JAV 标签', 'Add JAV tag')}
      subtitle={zh(
        `将应用到 ${javIds?.length || 0} 个 JAV`,
        `Applies to ${javIds?.length || 0} JAV items`
      )}
      onClose={onClose}
      height="78vh"
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
            onClick={apply}
            disabled={saving || !tagId}
            className="h-11 flex-1 rounded-card bg-brand text-[14.5px] font-bold text-white disabled:opacity-50"
          >
            {saving ? zh('保存中…', 'Saving...') : zh('应用', 'Apply')}
          </button>
        </>
      }
    >
      <div className="mb-3 flex h-9 items-center gap-1.5 rounded-lg border border-[#d8dbe1] bg-white px-2.5">
        <Icon name="search" size={14} className="flex-none text-zinc-400" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={zh('搜索标签', 'Search tags')}
          aria-label={zh('搜索标签', 'Search tags')}
          className="w-full bg-transparent text-[13px] outline-none placeholder:text-zinc-400"
        />
        {query ? (
          <button type="button" onClick={() => setQuery('')} aria-label={zh('清除', 'Clear')}>
            <Icon name="x" size={13} className="text-zinc-400" />
          </button>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <p className="py-8 text-center text-[12.5px] text-zinc-400">
          {zh('没有可用的标签', 'No tags available')}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2 pb-4">
          {visible.map((tag) => {
            const active = Number(tagId) === Number(tag.id)
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => setTagId(active ? null : tag.id)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-semibold ${
                  active
                    ? 'border-[#fdba74] bg-[#fdba74] text-zinc-900'
                    : 'border-[#d8dbe1] bg-white text-zinc-700'
                }`}
              >
                {active ? <Icon name="check" size={12} /> : null}
                <span className="max-w-[9rem] truncate">{tag.name}</span>
                {tag.count != null ? (
                  <span
                    className={`text-[10px] tabular-nums ${active ? 'text-zinc-700' : 'text-zinc-400'}`}
                  >
                    {formatCount(tag.count)}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      )}

      {error ? (
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
          <Icon name="ban" size={14} className="mt-[1px] flex-none" />
          <span>{error}</span>
        </div>
      ) : null}
    </BottomSheet>
  )
}

/**
 * 批量加入收藏夹。
 *
 * 可以勾多个收藏夹，一次请求全部加入；后端是**追加**语义，作品原本就在别的
 * 收藏夹里也不会被移出（要移出得去详情页逐个取消勾选）。
 */
export function JavBatchFavoriteSheet({ open, javIds, onClose, onApplied }) {
  const groups = useStore((state) => state.javFavoriteGroups)
  const loading = useStore((state) => state.javFavoriteGroupsLoading)
  const loadGroups = useStore((state) => state.loadJavFavoriteGroups)
  const showToast = useStore((state) => state.showToast)

  const [picked, setPicked] = useState(() => new Set())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setPicked(new Set())
    setError('')
    loadGroups()
  }, [open, loadGroups])

  const toggle = (id) => {
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const apply = async () => {
    const ids = Array.isArray(javIds) ? javIds : []
    const groupIds = Array.from(picked)
    if (ids.length === 0 || groupIds.length === 0) return
    setSaving(true)
    setError('')
    try {
      await addJavsToFavoriteGroups(ids, groupIds)
      showToast(
        zh(
          `已将 ${ids.length} 部作品加入 ${groupIds.length} 个收藏夹`,
          `Added ${ids.length} works to ${groupIds.length} favorites`
        )
      )
      onApplied?.()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet
      open={open}
      title={zh('加入收藏夹', 'Add to favorites')}
      subtitle={zh(
        `将应用到 ${javIds?.length || 0} 部作品`,
        `Applies to ${javIds?.length || 0} works`
      )}
      onClose={onClose}
      height="70vh"
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
            onClick={apply}
            disabled={saving || picked.size === 0}
            className="h-11 flex-1 rounded-card bg-brand text-[14.5px] font-bold text-white disabled:opacity-50"
          >
            {saving
              ? zh('保存中…', 'Saving...')
              : zh(`加入（已选 ${picked.size}）`, `Add (${picked.size})`)}
          </button>
        </>
      }
    >
      {loading && groups.length === 0 ? (
        <div className="flex flex-col gap-2 pb-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="skeleton h-12 rounded-card" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <p className="py-6 text-center text-[12.5px] text-zinc-400">
          {zh('还没有作品收藏夹', 'No work favorites yet')}
        </p>
      ) : (
        <div className="flex flex-col gap-2 pb-4">
          {groups.map((group) => {
            const active = picked.has(Number(group.id))
            return (
              <button
                key={group.id}
                type="button"
                onClick={() => toggle(Number(group.id))}
                className={`flex items-center gap-3 rounded-card border px-3.5 py-3 text-left ${
                  active ? 'border-brand bg-brand-soft' : 'border-[#e6e8ec] bg-white'
                }`}
              >
                <span
                  className={`grid h-5 w-5 flex-none place-items-center rounded-full border-2 ${
                    active ? 'border-brand bg-brand' : 'border-[#d8dbe1] bg-white'
                  }`}
                  aria-hidden="true"
                >
                  {active ? <Icon name="check" size={11} className="text-white" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-zinc-800">
                    {group.name}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-zinc-400">
                    {zh(`${formatCount(group.count)} 部`, `${formatCount(group.count)} works`)}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}

      {error ? (
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
          <Icon name="ban" size={14} className="mt-[1px] flex-none" />
          <span>{error}</span>
        </div>
      ) : null}
    </BottomSheet>
  )
}
