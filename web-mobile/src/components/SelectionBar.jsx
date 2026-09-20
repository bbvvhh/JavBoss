import Icon from '@/components/Icons'
import { useStore, videoKey } from '@/store'
import { zh } from '@/utils/i18n'

/** 多选态顶栏：取消 / 已选数量 / 全选。 */
export function SelectionTopBar() {
  const selectedKeys = useStore((state) => state.selectedKeys)
  const videos = useStore((state) => state.videos)
  const exitSelection = useStore((state) => state.exitSelection)
  const selectAll = useStore((state) => state.selectAll)
  const clearSelection = useStore((state) => state.clearSelection)

  const count = selectedKeys.size
  const allSelected = videos.length > 0 && count >= videos.length

  return (
    <header className="flex h-[50px] flex-none items-center gap-2 bg-[#0f172a] px-3 text-white">
      <button
        type="button"
        onClick={exitSelection}
        className="text-[13px] font-semibold text-sky-300"
      >
        {zh('取消', 'Cancel')}
      </button>
      <b className="flex-1 text-center text-[13.5px]">
        {zh(`已选 ${count} 项`, `${count} selected`)}
      </b>
      <button
        type="button"
        onClick={() => (allSelected ? clearSelection() : selectAll(videos))}
        className="text-[13px] font-semibold text-sky-300"
      >
        {allSelected ? zh('取消全选', 'None') : zh('全选', 'All')}
      </button>
    </header>
  )
}

/**
 * 多选态底部批量操作栏。
 * 只列真正可用且只写数据库的操作；「移出媒体库」等后端接口（P3）落地后再启用。
 * 这里永远不会有「删除文件」。
 */
export function SelectionActionBar({ onOpenTags }) {
  const selectedKeys = useStore((state) => state.selectedKeys)
  const videos = useStore((state) => state.videos)

  const selectedVideos = videos.filter((video) => selectedKeys.has(videoKey(video)))
  const disabled = selectedVideos.length === 0

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-[#e6e8ec] bg-white/95 pt-2 backdrop-blur-md"
      style={{ paddingBottom: 'calc(0.5rem + var(--safe-bottom))' }}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => onOpenTags(selectedVideos)}
        className="flex flex-1 flex-col items-center gap-1 text-[10.5px] font-semibold text-zinc-700 disabled:opacity-40"
      >
        <Icon name="tag" size={21} />
        {zh('打标签', 'Tag')}
      </button>
      <button
        type="button"
        disabled
        title={zh('需要后端接口支持', 'Needs a backend endpoint')}
        className="flex flex-1 flex-col items-center gap-1 text-[10.5px] font-semibold text-zinc-300"
      >
        <Icon name="shield" size={21} />
        {zh('移出媒体库', 'Hide')}
      </button>
      <div className="flex flex-1 flex-col items-center gap-1 text-[10.5px] font-semibold text-zinc-300">
        <Icon name="ban" size={21} />
        {zh('删除文件', 'Delete')}
      </div>
    </div>
  )
}
