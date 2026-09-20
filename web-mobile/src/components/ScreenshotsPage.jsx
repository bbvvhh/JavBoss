import { useCallback, useEffect, useState } from 'react'

import {
  createVideoScreenshot,
  deleteVideoScreenshot,
  fetchVideoScreenshots,
  resetVideoCover,
  updateVideoCover,
} from '@/api'
import Icon from '@/components/Icons'
import SubPage from '@/components/SubPage'
import { useStore, videoKey } from '@/store'
import { formatBytes } from '@/utils/display'
import { getErrorMessage } from '@/utils/errors'
import { formatDuration } from '@/utils/format'
import { zh } from '@/utils/i18n'

const SEEK_STEP_SECONDS = 30

/**
 * 截图页：查看 / 生成 / 设为封面 / 删除截图。
 * 全部操作只作用于 JavBoss 自己 data/ 目录下的截图，不碰视频文件。
 */
export default function ScreenshotsPage({ video, onClose }) {
  const patchVideo = useStore((state) => state.patchVideo)
  const showToast = useStore((state) => state.showToast)

  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [seek, setSeek] = useState(0)
  const [preview, setPreview] = useState(null)

  const duration = Number(video?.duration_sec) || 0
  const coverName = String(video?.cover_screenshot_name || '')

  const load = useCallback(async () => {
    if (!video?.id) return
    setLoading(true)
    setError('')
    try {
      setItems(await fetchVideoScreenshots(video.id))
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [video?.id])

  useEffect(() => {
    load()
  }, [load])

  const generate = async () => {
    if (!video?.id || busy) return
    setBusy(true)
    setError('')
    try {
      await createVideoScreenshot(video.id, { second: seek, locationId: video.location_id })
      await load()
      showToast(zh('截图已生成', 'Screenshot created'))
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const setCover = async (name) => {
    if (!video?.id || busy) return
    setBusy(true)
    setError('')
    try {
      const updated = await updateVideoCover(video.id, name)
      patchVideo(videoKey(video), updated || { cover_screenshot_name: name })
      setItems((current) => current.map((item) => ({ ...item, is_cover: item.name === name })))
      showToast(zh('已设为封面', 'Cover updated'))
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const restoreCover = async () => {
    if (!video?.id || busy) return
    setBusy(true)
    setError('')
    try {
      const updated = await resetVideoCover(video.id)
      patchVideo(videoKey(video), updated || { cover_screenshot_name: '' })
      setItems((current) => current.map((item) => ({ ...item, is_cover: false })))
      showToast(zh('已恢复默认封面', 'Default cover restored'))
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (name) => {
    if (!video?.id || busy) return
    setBusy(true)
    setError('')
    try {
      await deleteVideoScreenshot(video.id, name)
      setItems((current) => current.filter((item) => item.name !== name))
      showToast(zh('截图已删除', 'Screenshot deleted'))
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const shuffle = () => {
    const max = Math.max(0, duration - 1)
    setSeek(Math.floor(Math.random() * max))
  }

  return (
    <SubPage
      title={zh('视频截图', 'Screenshots')}
      subtitle={zh(`${items.length} 张`, `${items.length} images`)}
      onBack={onClose}
      headerRight={
        coverName ? (
          <button
            type="button"
            onClick={restoreCover}
            disabled={busy}
            className="flex-none px-2 text-[12.5px] font-semibold text-zinc-500"
          >
            {zh('恢复默认封面', 'Reset cover')}
          </button>
        ) : null
      }
    >
      <div className="border-b border-[#e6e8ec] bg-white px-3.5 py-3.5">
        <div className="mb-2 flex items-center justify-between text-[12px] text-zinc-500">
          <span>{zh('截取时间点', 'Capture position')}</span>
          <span className="tabular-nums font-semibold text-zinc-700">{formatDuration(seek)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(0, duration)}
          step={1}
          value={seek}
          onChange={(event) => setSeek(Number(event.target.value))}
          aria-label={zh('截取时间点', 'Capture position')}
          className="w-full accent-blue-600"
        />
        <div className="mt-1 flex items-center gap-2">
          {[-SEEK_STEP_SECONDS, SEEK_STEP_SECONDS].map((delta) => (
            <button
              key={delta}
              type="button"
              onClick={() => setSeek((value) => Math.max(0, Math.min(duration, value + delta)))}
              className="h-8 rounded-lg bg-[#f1f2f5] px-3 text-[12px] font-semibold text-zinc-700"
            >
              {delta > 0 ? `+${delta}s` : `${delta}s`}
            </button>
          ))}
          <button
            type="button"
            onClick={shuffle}
            className="h-8 rounded-lg bg-[#f1f2f5] px-3 text-[12px] font-semibold text-zinc-700"
          >
            {zh('随机', 'Random')}
          </button>
          <button
            type="button"
            onClick={generate}
            disabled={busy || duration <= 0}
            className="ml-auto h-8 rounded-lg bg-brand px-3.5 text-[12.5px] font-bold text-white disabled:opacity-50"
          >
            {busy ? zh('生成中…', 'Working...') : zh('生成截图', 'Capture')}
          </button>
        </div>
      </div>

      {error ? (
        <div className="mx-3.5 mt-3 flex items-start gap-2 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] text-red-700">
          <Icon name="ban" size={15} className="mt-[1px] flex-none" />
          <span>{error}</span>
        </div>
      ) : null}

      {loading ? (
        <div className="grid grid-cols-2 gap-2.5 p-3.5">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="skeleton aspect-video rounded-card" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="px-6 py-16 text-center">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-white text-zinc-300 shadow-sm">
            <Icon name="image" size={26} />
          </div>
          <p className="text-sm font-medium text-zinc-500">
            {zh('还没有截图', 'No screenshots yet')}
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            {zh('选好时间点后点「生成截图」', 'Pick a position and tap Capture')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 p-3.5">
          {items.map((item) => (
            <div
              key={item.name}
              className="overflow-hidden rounded-card border border-[#e6e8ec] bg-white"
            >
              <button
                type="button"
                onClick={() => setPreview(item)}
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
                  {formatBytes(item.size) || item.name}
                </span>
                {!item.is_cover ? (
                  <button
                    type="button"
                    onClick={() => setCover(item.name)}
                    disabled={busy}
                    title={zh('设为封面', 'Set as cover')}
                    aria-label={zh('设为封面', 'Set as cover')}
                    className="grid h-7 w-7 place-items-center rounded-lg text-zinc-500 active:bg-zinc-100"
                  >
                    <Icon name="star" size={15} />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => remove(item.name)}
                  disabled={busy}
                  title={zh('删除截图', 'Delete screenshot')}
                  aria-label={zh('删除截图', 'Delete screenshot')}
                  className="grid h-7 w-7 place-items-center rounded-lg text-zinc-500 active:bg-zinc-100"
                >
                  <Icon name="trash" size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="px-3.5 pb-8 pt-2 text-[11px] leading-relaxed text-zinc-400">
        {zh(
          '截图保存在 JavBoss 自己的 data/ 目录下。这里的删除只会移除截图，永远不会动你的视频文件。',
          'Screenshots live in JavBoss’s own data folder. Deleting here only removes the image.'
        )}
      </p>

      {preview ? (
        <button
          type="button"
          onClick={() => setPreview(null)}
          className="fixed inset-0 z-[70] grid place-items-center bg-black/85 p-4"
          aria-label={zh('关闭预览', 'Close preview')}
        >
          <img src={preview.url} alt={preview.name} className="max-h-full max-w-full rounded-lg" />
          <span className="mt-3 block text-[12px] text-white/70">{preview.name}</span>
        </button>
      ) : null}
    </SubPage>
  )
}
