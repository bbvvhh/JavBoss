import { useCallback, useEffect, useState } from 'react'

import {
  createJavFavoriteGroup,
  fetchJavFavoriteGroupIDs,
  fetchJavFavoriteGroups,
  replaceJavFavoriteGroups,
} from '@/api'
import BottomSheet from '@/components/BottomSheet'
import Icon from '@/components/Icons'
import { useStore } from '@/store'
import { getErrorMessage } from '@/utils/errors'
import { formatCount } from '@/utils/format'
import { zh } from '@/utils/i18n'
import { idolDisplayNames } from '@/utils/idolDisplay'

function entityLabel(entityType) {
  switch (entityType) {
    case 'jav':
      return zh('作品', 'work')
    case 'studio':
      return zh('片商', 'studio')
    case 'series':
      return zh('系列', 'series')
    case 'idol':
    default:
      return zh('女优', 'idol')
  }
}

/** 抽屉标题下面那行「给谁加收藏夹」。 */
function entityName(entityType, entity) {
  if (entityType === 'idol') {
    return idolDisplayNames(entity, false).primary || zh('未知女优', 'Unknown idol')
  }
  if (entityType === 'jav') {
    return [entity?.code, entity?.title].filter(Boolean).join(' ') || zh('未知作品', 'Unknown work')
  }
  return String(entity?.name || '').trim() || zh('未知条目', 'Unknown item')
}

/**
 * 「把这条作品 / 这位女优加入收藏夹」的抽屉。
 *
 * 收藏夹是**覆盖式**保存：勾上就加入、取消勾选就移出（后端 PUT 语义）。
 * 与 PC 端 `JavFavoriteModal` 对齐，另外提供「新建收藏夹」——否则第一次使用的
 * 用户在这个抽屉里无事可做。
 */
export default function JavFavoritePickerSheet({
  open,
  entityType = 'jav',
  entity,
  onClose,
  onSaved,
  onToast,
}) {
  const showToast = useStore((state) => state.showToast)
  const toast = onToast || showToast

  const entityId = Number(entity?.id) || 0
  const [groups, setGroups] = useState([])
  const [selected, setSelected] = useState(() => new Set())
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [createError, setCreateError] = useState('')

  const label = entityLabel(entityType)

  const load = useCallback(async () => {
    if (!entityId) return
    setLoading(true)
    setError('')
    try {
      const [groupList, selectedIds] = await Promise.all([
        fetchJavFavoriteGroups(entityType),
        fetchJavFavoriteGroupIDs(entityType, entityId),
      ])
      const sorted = [...(Array.isArray(groupList) ? groupList : [])].sort(
        (a, b) =>
          Number(a?.sort_order || 0) - Number(b?.sort_order || 0) || Number(a?.id) - Number(b?.id)
      )
      setGroups(sorted)
      setSelected(new Set(selectedIds))
    } catch (err) {
      setGroups([])
      setSelected(new Set())
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [entityId, entityType])

  useEffect(() => {
    if (!open) return
    setNewName('')
    setCreateError('')
    load()
  }, [open, load])

  const toggle = (id) => {
    const value = Number(id)
    if (!Number.isFinite(value) || value <= 0) return
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  }

  const createGroup = async () => {
    const name = newName.trim()
    if (!name || creating || saving) return
    setCreating(true)
    setCreateError('')
    try {
      const group = await createJavFavoriteGroup(entityType, name)
      const id = Number(group?.id)
      if (Number.isFinite(id) && id > 0) {
        setGroups((current) => [...current, { ...group, count: 0 }])
        setSelected((current) => new Set(current).add(id))
      }
      setNewName('')
    } catch (err) {
      setCreateError(getErrorMessage(err))
    } finally {
      setCreating(false)
    }
  }

  const save = async () => {
    if (!entityId || saving) return
    setSaving(true)
    setError('')
    try {
      const ids = Array.from(selected).sort((a, b) => a - b)
      await replaceJavFavoriteGroups(entityType, entityId, ids)
      onSaved?.(ids)
      toast?.(zh('收藏夹已更新', 'Favorites updated'))
      onClose?.()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet
      open={open}
      title={zh(`加入${label}收藏夹`, `Add to ${label} favorites`)}
      subtitle={entityName(entityType, entity)}
      onClose={onClose}
      height="76vh"
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
            disabled={saving || loading}
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

      <div className="mb-3 flex items-center gap-2">
        <input
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') createGroup()
          }}
          placeholder={zh(`新建${label}收藏夹`, `New ${label} group`)}
          aria-label={zh(`新建${label}收藏夹`, `New ${label} group`)}
          className="min-w-0 flex-1 rounded-[10px] border border-[#e3e5ea] bg-white px-3 py-2 text-[16px] leading-snug outline-none placeholder:text-zinc-300 focus:border-brand-line focus:ring-2 focus:ring-brand-soft"
        />
        <button
          type="button"
          onClick={createGroup}
          disabled={!newName.trim() || creating || saving}
          className="flex h-[42px] flex-none items-center gap-1.5 rounded-[10px] px-3.5 text-[13px] font-medium text-white bg-brand active:opacity-80 disabled:opacity-40"
        >
          <Icon name="plus" size={15} />
          {zh('新建', 'Create')}
        </button>
      </div>
      {createError ? (
        <p className="mb-3 text-[12px] leading-relaxed text-red-600">{createError}</p>
      ) : null}

      {loading ? (
        <div className="flex flex-col gap-2 pb-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="skeleton h-12 rounded-card" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <p className="py-8 text-center text-[12.5px] text-zinc-400">
          {zh(
            `还没有${label}收藏夹，先在上面新建一个`,
            `No ${label} groups yet — create one above`
          )}
        </p>
      ) : (
        <div className="flex flex-col gap-2 pb-4">
          {groups.map((group) => {
            const id = Number(group?.id)
            const active = selected.has(id)
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggle(id)}
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
                  {group?.name || zh('未命名收藏夹', 'Untitled group')}
                </span>
                <span className="flex-none text-[11px] tabular-nums text-zinc-400">
                  {formatCount(group?.count || 0)}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </BottomSheet>
  )
}
