import { useEffect, useRef } from 'react'

import Icon from '@/components/Icons'
import { useStore } from '@/store'
import { zh } from '@/utils/i18n'

const DEBOUNCE_MS = 300

/**
 * 搜索栏：点放大镜后「顶栏原地变形」成输入框，下面的列表保持可见。
 * 输入 300ms 后自动生效（searchInput → searchTerm），不需要回车。
 */
export function SearchBar({ onClose }) {
  const inputRef = useRef(null)
  const searchInput = useStore((state) => state.searchInput)
  const setSearchInput = useStore((state) => state.setSearchInput)
  const applySearch = useStore((state) => state.applySearch)
  const rememberSearch = useStore((state) => state.rememberSearch)

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 60)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => applySearch(searchInput), DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [searchInput, applySearch])

  const finish = (term) => {
    if (term) rememberSearch(term)
    applySearch(term)
    onClose?.()
  }

  return (
    <header className="sticky top-0 z-20 flex h-[50px] flex-none items-center gap-2 border-b border-[#e6e8ec] bg-white px-3">
      <div className="flex h-[34px] flex-1 items-center gap-1.5 rounded-full bg-[#eef0f3] px-2.5">
        <Icon name="search" size={16} className="flex-none text-zinc-500" />
        <input
          ref={inputRef}
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') finish(searchInput)
          }}
          placeholder={zh('搜索文件名', 'Search filename')}
          aria-label={zh('搜索文件名', 'Search filename')}
          className="w-full bg-transparent text-[13.5px] outline-none placeholder:text-zinc-400"
        />
        {searchInput ? (
          <button
            type="button"
            onClick={() => setSearchInput('')}
            aria-label={zh('清除', 'Clear')}
            className="flex-none text-zinc-400"
          >
            <Icon name="x" size={14} />
          </button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => finish(searchInput)}
        className="flex-none text-[13.5px] font-semibold text-brand"
      >
        {zh('完成', 'Done')}
      </button>
    </header>
  )
}

/** 输入为空时展示的最近搜索与热门标签。 */
export function SearchHints() {
  const searchHistory = useStore((state) => state.searchHistory)
  const clearSearchHistory = useStore((state) => state.clearSearchHistory)
  const setSearchInput = useStore((state) => state.setSearchInput)
  const applySearch = useStore((state) => state.applySearch)
  const tags = useStore((state) => state.tags)
  const loadTags = useStore((state) => state.loadTags)
  const toggleTag = useStore((state) => state.toggleTag)
  const selectedTags = useStore((state) => state.selectedTags)

  useEffect(() => {
    if (tags.length === 0) loadTags()
  }, [tags.length, loadTags])

  const quickTags = tags.slice(0, 12)

  return (
    <div className="px-3.5 pb-6">
      {searchHistory.length ? (
        <section className="pt-4">
          <div className="mb-2.5 flex items-center">
            <span className="text-[11.5px] font-bold tracking-wide text-zinc-500">
              {zh('最近搜索', 'Recent')}
            </span>
            <button
              type="button"
              onClick={clearSearchHistory}
              className="ml-auto text-[11.5px] text-zinc-400"
            >
              {zh('清除', 'Clear')}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {searchHistory.map((term) => (
              <button
                key={term}
                type="button"
                onClick={() => {
                  setSearchInput(term)
                  applySearch(term)
                }}
                className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[#e6e8ec] bg-white px-2.5 text-[12.5px] text-zinc-700"
              >
                <Icon name="clock" size={13} className="text-zinc-400" />
                {term}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {quickTags.length ? (
        <section className="pt-5">
          <div className="mb-2.5 text-[11.5px] font-bold tracking-wide text-zinc-500">
            {zh('按标签快速找', 'Browse by tag')}
          </div>
          <div className="flex flex-wrap gap-2">
            {quickTags.map((tag) => {
              const name = String(tag?.name || '')
              const active = selectedTags.includes(name)
              return (
                <button
                  key={tag?.id ?? name}
                  type="button"
                  onClick={() => toggleTag(name)}
                  className={`inline-flex h-7 items-center rounded-md px-2.5 text-[12px] font-bold ${
                    active ? 'bg-brand text-white' : 'bg-[#fdba74] text-zinc-900'
                  }`}
                >
                  {name}
                </button>
              )
            })}
          </div>
        </section>
      ) : null}

      {!searchHistory.length && !quickTags.length ? (
        <p className="pt-6 text-center text-[12.5px] text-zinc-400">
          {zh('输入关键词开始搜索', 'Type a keyword to search')}
        </p>
      ) : null}
    </div>
  )
}
