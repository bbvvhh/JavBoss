import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  deleteVideoScreenshot,
  fetchVideoScreenshots,
  fetchVideoScreenshotsByIds,
  resetVideoCover,
  updateVideoCover,
} from '@/api'
import Icon from '@/components/Icons'
import { formatBytes, getVideoDisplayName } from '@/utils/display'
import { getErrorMessage } from '@/utils/errors'
import { zh } from '@/utils/i18n'

/**
 * 视频预览图 = MPV / 播放页里保存下来的截图（服务端抽帧，存在 JavBoss 自己的
 * data/video/<id>/screenshot/ 下）。
 *
 * 与 PC 端保持一致的两条规则：
 * - `allowSetCover`：视频模块的入口允许「设为封面」（改的是 /videos/:id/thumbnail
 *   用的那张图）；JAV 作品详情页只看 / 删，不改封面 —— 与 PC 的 JavScreenshotGrid
 *   一致，作品本身已有刮削封面，改视频缩略图没有意义。
 * - 删除只作用在 JavBoss 自己 data/ 目录里的截图，永远不会碰视频文件。
 *
 * `videos` 可以传一个或多个（JAV 作品详情页要把该作品全部本地视频的预览图
 * 汇总在一起）。列表按 `id:updated_at` 做键，所以父组件每次渲染新建数组也不会
 * 触发重复请求。
 */
export default function VideoPreviewGrid({
  videos,
  allowSetCover = false,
  refreshToken = 0,
  emptyHint,
  onCoverChanged,
}) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [previewKey, setPreviewKey] = useState('')

  const videoList = useMemo(
    () => (Array.isArray(videos) ? videos : []).filter((video) => Number(video?.id) > 0),
    [videos]
  )
  const idsKey = videoList.map((video) => `${video.id}:${video.updated_at || ''}`).join(',')

  useEffect(() => {
    let cancelled = false
    const ids = idsKey
      .split(',')
      .filter(Boolean)
      .map((part) => Number(part.split(':')[0]))
    if (ids.length === 0) {
      setItems([])
      setLoading(false)
      setError('')
      return undefined
    }

    setLoading(true)
    setError('')
    const request = ids.length > 1 ? fetchVideoScreenshotsByIds(ids) : fetchVideoScreenshots(ids[0])
    request
      .then((nextItems) => {
        if (!cancelled) setItems(nextItems)
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [idsKey, refreshToken])

  const itemKey = (item) => `${item?.video_id || ''}:${item?.name || item?.url || ''}`
  const previewIndex = items.findIndex((item) => itemKey(item) === previewKey)
  const previewItem = previewIndex >= 0 ? items[previewIndex] : null

  const setCover = useCallback(
    async (item) => {
      const videoId = Number(item?.video_id)
      if (!videoId || !item?.name || busy || item.is_cover) return
      setBusy(true)
      setError('')
      try {
        const updated = await updateVideoCover(videoId, item.name)
        setItems((current) =>
          current.map((candidate) => ({
            ...candidate,
            is_cover:
              Number(candidate.video_id) === videoId
                ? candidate.name === item.name
                : candidate.is_cover,
          }))
        )
        onCoverChanged?.(
          updated || {
            id: videoId,
            cover_screenshot_name: item.name,
            updated_at: new Date().toISOString(),
          }
        )
      } catch (err) {
        setError(getErrorMessage(err))
      } finally {
        setBusy(false)
      }
    },
    [busy, onCoverChanged]
  )

  const restoreCover = useCallback(
    async (item) => {
      const videoId = Number(item?.video_id)
      if (!videoId || !item?.is_cover || busy) return
      setBusy(true)
      setError('')
      try {
        const updated = await resetVideoCover(videoId)
        setItems((current) =>
          current.map((candidate) =>
            Number(candidate.video_id) === videoId ? { ...candidate, is_cover: false } : candidate
          )
        )
        onCoverChanged?.(
          updated || {
            id: videoId,
            cover_screenshot_name: '',
            updated_at: new Date().toISOString(),
          }
        )
      } catch (err) {
        setError(getErrorMessage(err))
      } finally {
        setBusy(false)
      }
    },
    [busy, onCoverChanged]
  )

  const remove = useCallback(
    async (item) => {
      const videoId = Number(item?.video_id)
      if (!videoId || !item?.name || busy) return
      setBusy(true)
      setError('')
      try {
        await deleteVideoScreenshot(videoId, item.name)
        setItems((current) => current.filter((candidate) => itemKey(candidate) !== itemKey(item)))
        setPreviewKey((current) => (current === itemKey(item) ? '' : current))
        // 删掉的正好是封面时，后端会把 cover_screenshot_name 清空，列表缩略图要跟着变。
        if (item.is_cover) onCoverChanged?.({ id: videoId, cover_screenshot_name: '' })
      } catch (err) {
        setError(getErrorMessage(err))
      } finally {
        setBusy(false)
      }
    },
    [busy, onCoverChanged]
  )

  // 多视频（JAV 作品）时每张图要标出它属于哪个文件，单视频时不需要。
  const showVideoName = videoList.length > 1
  const videoNameOf = (videoId) =>
    getVideoDisplayName(videoList.find((video) => Number(video.id) === Number(videoId)))

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-2.5">
        {Array.from({ length: 2 }).map((_, index) => (
          <div key={index} className="skeleton aspect-video rounded-card" />
        ))}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-[#e6e8ec] px-4 py-6 text-center">
        <p className="text-[12.5px] text-zinc-500">
          {error || emptyHint || zh('还没有截图', 'No screenshots yet')}
        </p>
        <p className="mt-1 text-[11px] text-zinc-400">
          {zh(
            '播放时点控制条上的相机按钮即可截图',
            'Tap the camera button on the player controls to capture one'
          )}
        </p>
      </div>
    )
  }

  return (
    <>
      {error ? (
        <div className="mb-2.5 flex items-start gap-2 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] text-red-700">
          <Icon name="ban" size={15} className="mt-[1px] flex-none" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2.5">
        {items.map((item) => {
          const key = itemKey(item)
          return (
            <div
              key={key}
              className="overflow-hidden rounded-card border border-[#e6e8ec] bg-white"
            >
              <button
                type="button"
                onClick={() => setPreviewKey(key)}
                aria-label={zh('放大查看预览图', 'Enlarge preview image')}
                className="relative block aspect-video w-full bg-zinc-200"
              >
                <img
                  src={item.url}
                  alt={item.name}
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover"
                />
                {item.is_cover ? (
                  <span className="absolute left-1.5 top-1.5 rounded bg-brand px-1.5 py-[1px] text-[10px] font-bold text-white">
                    {zh('封面', 'Cover')}
                  </span>
                ) : null}
              </button>
              <div className="flex items-center gap-1 px-1.5 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[10px] text-zinc-400">
                  {[
                    showVideoName ? videoNameOf(item.video_id) : '',
                    formatBytes(item.size) || item.name,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {allowSetCover ? (
                  <button
                    type="button"
                    onClick={() => (item.is_cover ? restoreCover(item) : setCover(item))}
                    disabled={busy}
                    title={
                      item.is_cover
                        ? zh('恢复默认封面', 'Restore default cover')
                        : zh('设为封面', 'Set as cover')
                    }
                    aria-label={
                      item.is_cover
                        ? zh('恢复默认封面', 'Restore default cover')
                        : zh('设为封面', 'Set as cover')
                    }
                    className={`grid h-7 w-7 place-items-center rounded-lg active:bg-zinc-100 ${
                      item.is_cover ? 'text-brand' : 'text-zinc-500'
                    }`}
                  >
                    <Icon name={item.is_cover ? 'starFilled' : 'star'} size={15} />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => remove(item)}
                  disabled={busy}
                  title={zh('删除截图', 'Delete screenshot')}
                  aria-label={zh('删除截图', 'Delete screenshot')}
                  className="grid h-7 w-7 place-items-center rounded-lg text-zinc-500 active:bg-zinc-100"
                >
                  <Icon name="trash" size={15} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {previewItem ? (
        <PreviewOverlay
          item={previewItem}
          index={previewIndex}
          total={items.length}
          onClose={() => setPreviewKey('')}
          onStep={(delta) => {
            const next = (previewIndex + delta + items.length) % items.length
            setPreviewKey(itemKey(items[next]))
          }}
        />
      ) : null}
    </>
  )
}

/** 全屏预览：点空白关闭，底部可左右翻页（与 PC 的截图预览一致）。 */
function PreviewOverlay({ item, index, total, onClose, onStep }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={zh('预览图', 'Preview image')}
      className="fixed inset-0 z-[80] flex flex-col bg-black/90"
    >
      <div className="flex h-[46px] flex-none items-center gap-2 px-2 text-zinc-100">
        <button
          type="button"
          onClick={onClose}
          aria-label={zh('关闭预览', 'Close preview')}
          className="grid h-9 w-9 flex-none place-items-center rounded-[10px] active:bg-white/10"
        >
          <Icon name="x" size={20} />
        </button>
        <span className="min-w-0 flex-1 truncate text-[12px]">{item.name}</span>
        <span className="flex-none pr-2 text-[12px] tabular-nums">
          {index + 1}/{total}
        </span>
      </div>

      <button
        type="button"
        onClick={onClose}
        aria-label={zh('关闭预览', 'Close preview')}
        className="grid min-h-0 flex-1 place-items-center px-2"
      >
        <img
          src={item.url}
          alt={item.name}
          className="max-h-full max-w-full rounded-lg object-contain"
        />
      </button>

      {total > 1 ? (
        <div
          className="flex flex-none items-center justify-center gap-4 pb-6 pt-2"
          style={{ paddingBottom: 'calc(1.5rem + var(--safe-bottom))' }}
        >
          <button
            type="button"
            onClick={() => onStep(-1)}
            aria-label={zh('上一张', 'Previous image')}
            className="grid h-11 w-11 place-items-center rounded-full bg-white/15 text-white active:bg-white/25"
          >
            <Icon name="back" size={20} />
          </button>
          <button
            type="button"
            onClick={() => onStep(1)}
            aria-label={zh('下一张', 'Next image')}
            className="grid h-11 w-11 place-items-center rounded-full bg-white/15 text-white active:bg-white/25"
          >
            <Icon name="right" size={20} />
          </button>
        </div>
      ) : null}
    </div>
  )
}
