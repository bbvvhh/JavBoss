import Icon from '@/components/Icons'
import { useStore } from '@/store'
import { zh } from '@/utils/i18n'

export default function TopBar({ onOpenSearch, onOpenSettings }) {
  const view = useStore((state) => state.view)
  const setView = useStore((state) => state.setView)
  const total = useStore((state) => state.total)
  const loading = useStore((state) => state.loading)

  return (
    <header className="sticky top-0 z-20 flex h-[50px] flex-none items-center gap-2 border-b border-[#e6e8ec] bg-white/95 px-2.5 backdrop-blur-md">
      <div className="grid h-[27px] w-[27px] place-items-center rounded-[9px] bg-gradient-to-br from-blue-500 to-cyan-400 text-[11px] font-extrabold tracking-tight text-white shadow-[0_2px_6px_-1px_rgba(37,99,235,0.5)]">
        JB
      </div>

      <div className="ml-1 flex gap-0.5 rounded-full bg-[#e9ebef] p-[3px]" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'video'}
          onClick={() => setView('video')}
          className={`rounded-full px-[15px] py-1.5 text-[13px] font-semibold transition ${
            view === 'video' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'
          }`}
        >
          {zh('视频', 'Videos')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'jav'}
          onClick={() => setView('jav')}
          className={`rounded-full px-[15px] py-1.5 text-[13px] font-semibold transition ${
            view === 'jav' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'
          }`}
        >
          JAV
        </button>
      </div>

      <div className="flex-1" />

      {view === 'video' && !loading && total > 0 ? (
        <span className="text-[11px] tabular-nums text-zinc-400">{total}</span>
      ) : null}

      <button
        type="button"
        onClick={onOpenSearch}
        aria-label={zh('搜索', 'Search')}
        className="grid h-[34px] w-[34px] place-items-center rounded-[10px] text-zinc-700 active:bg-zinc-100"
      >
        <Icon name="search" />
      </button>
      <button
        type="button"
        onClick={onOpenSettings}
        aria-label={zh('设置', 'Settings')}
        className="grid h-[34px] w-[34px] place-items-center rounded-[10px] text-zinc-700 active:bg-zinc-100"
      >
        <Icon name="gear" />
      </button>
    </header>
  )
}
