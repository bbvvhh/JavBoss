import { useEffect, useMemo, useState } from 'react'

import BottomSheet from '@/components/BottomSheet'
import Icon from '@/components/Icons'
import { useStore } from '@/store'
import { formatCount } from '@/utils/format'
import { zh } from '@/utils/i18n'

/**
 * JAV 标签筛选。放在功能栏上作为独立入口（与视频模式的「标签」chip 对齐），
 * 不再埋进筛选抽屉里。
 */
export default function JavTagSheet({ open, onClose }) {
  const options = useStore((state) => state.javTagOptions)
  const loadOptions = useStore((state) => state.loadJavTagOptions)
  const storedTagIds = useStore((state) => state.javFilters.tagIds)
  const setJavTagIds = useStore((state) => state.setJavTagIds)

  const [draft, setDraft] = useState(() => new Set(storedTagIds))
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!open) return
    setDraft(new Set(storedTagIds))
    setQuery('')
    if (options.length === 0) loadOptions()
  }, [open, storedTagIds, options.length, loadOptions])

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

  const toggle = (id) => {
    setDraft((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <BottomSheet
      open={open}
      title={zh('JAV 标签筛选', 'JAV tags')}
      onClose={onClose}
      height="80vh"
      footer={
        <>
          <button
            type="button"
            onClick={() => setDraft(new Set())}
            className="h-11 w-20 flex-none rounded-card bg-[#f1f2f5] text-sm font-bold text-zinc-700"
          >
            {zh('清空', 'Clear')}
          </button>
          <button
            type="button"
            onClick={() => {
              setJavTagIds(Array.from(draft))
              onClose?.()
            }}
            className="h-11 flex-1 rounded-card bg-brand text-[14.5px] font-bold text-white"
          >
            {zh(`应用（已选 ${draft.size}）`, `Apply (${draft.size})`)}
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
            const active = draft.has(tag.id)
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggle(tag.id)}
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
    </BottomSheet>
  )
}
