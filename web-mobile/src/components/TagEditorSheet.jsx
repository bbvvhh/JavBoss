import { useEffect, useMemo, useState } from 'react'

import { addTagToVideos, createTag, removeTagFromVideos, replaceTagsForVideos } from '@/api'
import BottomSheet from '@/components/BottomSheet'
import Icon from '@/components/Icons'
import { useStore } from '@/store'
import { getErrorMessage } from '@/utils/errors'
import { zh } from '@/utils/i18n'

/**
 * 标签编辑。单视频与批量共用同一个组件。
 * 单视频默认「替换」；批量时可切换「追加 / 移除 / 替换」，避免误伤其它标签。
 */
export default function TagEditorSheet({ open, videos, onClose }) {
  const tagOptions = useStore((state) => state.tags)
  const loadTags = useStore((state) => state.loadTags)
  const loadVideos = useStore((state) => state.loadVideos)
  const showToast = useStore((state) => state.showToast)

  // 单视频时用它的现有标签作为初始选择。
  const single = videos?.length === 1 ? videos[0] : null
  const initialNames = useMemo(
    () => (single?.tags || []).map((tag) => tag.name).filter(Boolean),
    [single]
  )

  const [selected, setSelected] = useState(() => new Set())
  const [query, setQuery] = useState('')
  const [batchMode, setBatchMode] = useState('add')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setSelected(new Set(initialNames))
    setQuery('')
    setBatchMode('add')
    setError('')
  }, [open, initialNames])

  useEffect(() => {
    if (!open) return
    if (tagOptions.length === 0) loadTags()
  }, [open, tagOptions.length, loadTags])

  const allNames = useMemo(
    () =>
      Array.from(new Set(tagOptions.map((tag) => String(tag?.name || '')).filter(Boolean))).sort(),
    [tagOptions]
  )

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? allNames.filter((name) => name.toLowerCase().includes(q)) : allNames
    return list.slice(0, 120)
  }, [allNames, query])

  const toggle = (name) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const createAndSelect = async () => {
    const name = query.trim()
    if (!name) return
    setError('')
    try {
      const created = await createTag(name)
      const createdName = String(created?.name || name)
      await loadTags()
      setSelected((current) => new Set(current).add(createdName))
      setQuery('')
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  const apply = async () => {
    const ids = Array.from(new Set((videos || []).map((video) => video?.id).filter(Boolean)))
    if (ids.length === 0) return
    setSaving(true)
    setError('')
    try {
      const byName = new Map(tagOptions.map((tag) => [String(tag?.name || ''), tag?.id]))
      const chosen = Array.from(selected)

      if (single) {
        const tagIds = chosen.map((name) => byName.get(name)).filter((id) => Number.isFinite(id))
        await replaceTagsForVideos(ids, tagIds)
      } else if (batchMode === 'replace') {
        const tagIds = chosen.map((name) => byName.get(name)).filter((id) => Number.isFinite(id))
        await replaceTagsForVideos(ids, tagIds)
      } else {
        // 追加 / 移除：只动被勾选的标签，其它标签保持不变。
        for (const name of chosen) {
          const tagId = byName.get(name)
          if (!Number.isFinite(tagId)) continue
          if (batchMode === 'remove') await removeTagFromVideos(tagId, ids)
          else await addTagToVideos(tagId, ids)
        }
      }

      await loadVideos()
      showToast(
        single
          ? zh('标签已更新', 'Tags updated')
          : zh(`已更新 ${ids.length} 个视频的标签`, `Updated ${ids.length} videos`)
      )
      onClose?.()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const title = single
    ? zh('编辑标签', 'Edit tags')
    : zh(`批量标签 · ${videos?.length || 0} 个`, `Bulk tags · ${videos?.length || 0}`)

  return (
    <BottomSheet
      open={open}
      title={title}
      onClose={onClose}
      height="82vh"
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
            disabled={saving}
            className="h-11 flex-1 rounded-card bg-brand text-[14.5px] font-bold text-white disabled:opacity-50"
          >
            {saving
              ? zh('保存中…', 'Saving...')
              : zh(`应用（已选 ${selected.size}）`, `Apply (${selected.size})`)}
          </button>
        </>
      }
    >
      {!single ? (
        <div className="mb-3.5 flex gap-0.5 rounded-lg bg-[#eceef2] p-[3px]">
          {[
            ['add', zh('追加', 'Add')],
            ['remove', zh('移除', 'Remove')],
            ['replace', zh('替换全部', 'Replace all')],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setBatchMode(value)}
              className={`flex-1 rounded-md py-1.5 text-xs font-semibold ${
                batchMode === value ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mb-3 flex h-9 items-center gap-1.5 rounded-lg border border-[#d8dbe1] bg-white px-2.5">
        <Icon name="search" size={14} className="flex-none text-zinc-400" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={zh('搜索或新建标签', 'Search or create a tag')}
          aria-label={zh('搜索标签', 'Search tags')}
          className="w-full bg-transparent text-[13px] outline-none placeholder:text-zinc-400"
        />
        {query ? (
          <button type="button" onClick={() => setQuery('')} aria-label={zh('清除', 'Clear')}>
            <Icon name="x" size={13} className="text-zinc-400" />
          </button>
        ) : null}
      </div>

      {query.trim() && !allNames.some((name) => name === query.trim()) ? (
        <button
          type="button"
          onClick={createAndSelect}
          className="mb-3 flex w-full items-center gap-2 rounded-lg border border-dashed border-brand-line bg-brand-soft px-3 py-2.5 text-[13px] font-semibold text-brand-ink"
        >
          <Icon name="plus" size={14} />
          {zh(`新建标签「${query.trim()}」`, `Create “${query.trim()}”`)}
        </button>
      ) : null}

      {visible.length === 0 ? (
        <p className="py-6 text-center text-[12.5px] text-zinc-400">
          {zh('还没有标签，直接输入名称即可新建', 'No tags yet — type a name to create one')}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2 pb-4">
          {visible.map((name) => {
            const active = selected.has(name)
            return (
              <button
                key={name}
                type="button"
                onClick={() => toggle(name)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-semibold ${
                  active
                    ? 'border-[#fdba74] bg-[#fdba74] text-zinc-900'
                    : 'border-[#d8dbe1] bg-white text-zinc-700'
                }`}
              >
                {active ? <Icon name="check" size={12} /> : null}
                {name}
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
