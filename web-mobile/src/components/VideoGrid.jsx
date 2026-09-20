import VideoCard from '@/components/VideoCard'
import Icon from '@/components/Icons'
import { videoKey } from '@/store'
import { DENSITY_COLUMNS } from '@/utils/density'
import { zh } from '@/utils/i18n'

function SkeletonCard() {
  return (
    <div className="overflow-hidden rounded-card border border-[#e6e8ec] bg-white">
      <div className="skeleton aspect-video w-full" />
      <div className="px-2 pb-2.5 pt-2">
        <div className="skeleton h-2.5 w-full rounded" />
        <div className="skeleton mt-1.5 h-2.5 w-3/5 rounded" />
      </div>
    </div>
  )
}

export default function VideoGrid({
  videos,
  density,
  loading,
  loadingMore,
  hasNext,
  total,
  sentinelRef,
  onOpen,
  onLongPress,
  selectionMode = false,
  selectedKeys,
  onToggle,
}) {
  const columns = DENSITY_COLUMNS[density] || 1
  const gap = density === 'compact' ? 7 : 10

  if (loading && videos.length === 0) {
    return (
      <div
        className="grid p-2.5"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap }}
      >
        {Array.from({ length: columns * 2 }).map((_, index) => (
          <SkeletonCard key={index} />
        ))}
      </div>
    )
  }

  if (!loading && videos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
        <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-white text-zinc-300 shadow-sm">
          <Icon name="inbox" size={26} />
        </div>
        <p className="text-sm font-medium text-zinc-500">
          {zh('没有匹配的视频', 'No videos found')}
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          {zh('试试清空筛选条件或换个关键词', 'Try clearing filters or another keyword')}
        </p>
      </div>
    )
  }

  return (
    <div className="px-2.5 pt-2.5">
      <div
        className="grid"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap }}
      >
        {videos.map((video) => (
          <VideoCard
            key={video.location_id || video.id}
            video={video}
            density={density}
            onOpen={onOpen}
            onLongPress={onLongPress}
            selectionMode={selectionMode}
            selected={selectedKeys ? selectedKeys.has(videoKey(video)) : false}
            onToggle={onToggle}
          />
        ))}
      </div>

      <div ref={sentinelRef} className="h-px w-full" aria-hidden="true" />

      <div className="flex items-center justify-center gap-2 py-4 pb-8 text-xs text-zinc-500">
        {loadingMore ? (
          <>
            <span className="spin h-3.5 w-3.5 rounded-full border-2 border-zinc-300 border-t-zinc-500" />
            {zh('正在加载更多…', 'Loading more...')}
          </>
        ) : hasNext ? (
          <span className="text-zinc-400">{zh('继续下滑加载更多', 'Scroll for more')}</span>
        ) : (
          <span className="text-zinc-400">
            {zh(`已到底部 · 共 ${total} 部`, `End of list · ${total} total`)}
          </span>
        )}
      </div>
    </div>
  )
}
