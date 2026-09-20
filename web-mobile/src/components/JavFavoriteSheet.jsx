import { useEffect } from 'react'

import BottomSheet from '@/components/BottomSheet'
import Icon from '@/components/Icons'
import { useStore } from '@/store'
import { formatCount } from '@/utils/format'
import { zh } from '@/utils/i18n'

/**
 * JAV 收藏夹筛选。同样放在功能栏上作为独立入口。
 * 收藏夹是单选（「全部作品」= 不筛选）。
 */
export default function JavFavoriteSheet({ open, onClose }) {
  const groups = useStore((state) => state.javFavoriteGroups)
  const loading = useStore((state) => state.javFavoriteGroupsLoading)
  const loadGroups = useStore((state) => state.loadJavFavoriteGroups)
  const selectedId = useStore((state) => state.javFilters.favoriteGroupId)
  const setFavoriteGroup = useStore((state) => state.setJavFavoriteGroup)

  useEffect(() => {
    if (!open) return
    loadGroups()
  }, [open, loadGroups])

  const pick = (id, name) => {
    setFavoriteGroup(id, name)
    onClose?.()
  }

  return (
    <BottomSheet
      open={open}
      title={zh('作品收藏夹', 'Work favorites')}
      onClose={onClose}
      height="70vh"
    >
      {loading && groups.length === 0 ? (
        <div className="flex flex-col gap-2 pb-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="skeleton h-12 rounded-card" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2 pb-4">
          <button
            type="button"
            onClick={() => pick(null, '')}
            className={`flex items-center gap-3 rounded-card border px-3.5 py-3 text-left ${
              !selectedId ? 'border-brand bg-brand-soft' : 'border-[#e6e8ec] bg-white'
            }`}
          >
            <Icon name="star" size={17} className={selectedId ? 'text-zinc-400' : 'text-brand'} />
            <span className="flex-1 text-[13.5px] font-semibold text-zinc-800">
              {zh('全部作品', 'All works')}
            </span>
            {!selectedId ? <Icon name="check" size={16} className="text-brand" /> : null}
          </button>

          {groups.map((group) => {
            const active = Number(selectedId) === Number(group.id)
            return (
              <button
                key={group.id}
                type="button"
                onClick={() => pick(group.id, group.name)}
                className={`flex items-center gap-3 rounded-card border px-3.5 py-3 text-left ${
                  active ? 'border-brand bg-brand-soft' : 'border-[#e6e8ec] bg-white'
                }`}
              >
                <Icon name="folder" size={17} className={active ? 'text-brand' : 'text-zinc-400'} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-zinc-800">
                    {group.name}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-zinc-400">
                    {zh(`${formatCount(group.count)} 部`, `${formatCount(group.count)} works`)}
                  </span>
                </span>
                {active ? <Icon name="check" size={16} className="flex-none text-brand" /> : null}
              </button>
            )
          })}

          {groups.length === 0 ? (
            <p className="py-6 text-center text-[12.5px] text-zinc-400">
              {zh('还没有作品收藏夹', 'No work favorites yet')}
            </p>
          ) : null}
        </div>
      )}
    </BottomSheet>
  )
}
