import { useEffect, useMemo, useRef, useState } from 'react'

import { fetchJavIdolCoverOptions, updateJavIdolCover } from '@/api'
import Icon from '@/components/Icons'
import SubPage from '@/components/SubPage'
import { useStore } from '@/store'
import { getErrorMessage } from '@/utils/errors'
import {
  IDOL_COVER_DEFAULT_CROP_LEFT,
  IDOL_COVER_SOURCE_HEIGHT,
  IDOL_COVER_SOURCE_WIDTH,
  IDOL_COVER_VISIBLE_RATIO,
  coverImageStyle,
  normalizeDynamicCropLeft,
  normalizeIdolCoverCropLeft,
} from '@/utils/idolCover'
import { zh } from '@/utils/i18n'
import { idolDisplayName, javDisplayPrefs } from '@/utils/javDisplay'

/**
 * 女优封面编辑页（二级页，与「截图」「重命名」同级）。
 *
 * 能做的事与 PC 的 `JavIdolCoverModal` 一致：在「自动选择」和这位女优的作品之间
 * 挑一张封面，并横向调整取景起点。整页只写数据库里女优那一行的 `cover_jav_id`
 * 与 `cover_crop_left`，不下载、不改动任何文件。
 *
 * 用整页而不是抽屉：抽屉在页面栈深度 ≥ 1 时挂 `useOverlayBack` 会和 `useStackBack`
 * 抢同一次 popstate（返回键会同时关抽屉又弹掉页面），而页面栈天然支持返回键。
 *
 * 取景窗口宽度用固定的 47%（与列表 / 详情页同一常数），这样「编辑时看到的框」
 * 和「列表里的裁切」必然一致。
 */
export default function IdolCoverEditorPage({ idol, onClose }) {
  const patchJavIdol = useStore((state) => state.patchJavIdol)
  const showToast = useStore((state) => state.showToast)
  const config = useStore((state) => state.config)
  const preferChineseName = javDisplayPrefs(config).preferChineseName

  const boxRef = useRef(null)
  const [options, setOptions] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [selectedJavId, setSelectedJavId] = useState(0)
  const [cropLeft, setCropLeft] = useState(IDOL_COVER_DEFAULT_CROP_LEFT)
  const [dragging, setDragging] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)

  const idolId = Number(idol?.id) || 0
  const itemCoverCode = String(idol?.cover_code || '').trim()
  const maxCropLeft = 1 - IDOL_COVER_VISIBLE_RATIO

  useEffect(() => {
    if (!idolId) {
      setOptions([])
      setLoading(false)
      return undefined
    }
    let cancelled = false
    setLoading(true)
    setError('')
    setOptions([])
    setImageFailed(false)
    setSelectedJavId(Number(idol?.cover_jav_id) || 0)
    setCropLeft(normalizeIdolCoverCropLeft(idol?.cover_crop_left ?? IDOL_COVER_DEFAULT_CROP_LEFT))
    fetchJavIdolCoverOptions(idolId)
      .then((items) => {
        if (cancelled) return
        setOptions(items)
        // 库里记的那部作品可能已经不在候选里（被删了 / 换了扫描目录），
        // 这时退回按番号匹配，再不行就当自动选择 —— 不能让预览停在
        // 「选中了一个已经选不到的作品」上。
        setSelectedJavId((current) => {
          if (current && items.some((option) => Number(option.id) === current)) return current
          const matched = items.find(
            (option) => String(option?.code || '').trim() === itemCoverCode
          )
          return matched ? Number(matched.id) : 0
        })
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
  }, [idolId, itemCoverCode, idol?.cover_jav_id, idol?.cover_crop_left])

  const selectedOption = useMemo(
    () => options.find((option) => Number(option?.id) === Number(selectedJavId)) || null,
    [options, selectedJavId]
  )
  const previewCode = String(selectedOption?.code || itemCoverCode).trim()
  const displayCropLeft = Math.min(cropLeft, maxCropLeft)
  const hasPreview = Boolean(previewCode) && !imageFailed

  const setCropFromClientX = (clientX) => {
    const rect = boxRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return
    const ratio = (clientX - rect.left) / rect.width
    // 让手指落在取景框的中心，而不是框的左边缘 —— 拖起来才跟手。
    setCropLeft(normalizeDynamicCropLeft(ratio - IDOL_COVER_VISIBLE_RATIO / 2, maxCropLeft))
  }

  const handlePointerDown = (event) => {
    if (!hasPreview) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDragging(true)
    setCropFromClientX(event.clientX)
  }

  const handlePointerMove = (event) => {
    if (!dragging) return
    setCropFromClientX(event.clientX)
  }

  const handlePointerUp = () => setDragging(false)

  const handleReset = () => {
    setSelectedJavId(0)
    setCropLeft(IDOL_COVER_DEFAULT_CROP_LEFT)
    setImageFailed(false)
  }

  const handleSave = async () => {
    if (!idolId || saving) return
    setSaving(true)
    setError('')
    try {
      const updated = await updateJavIdolCover(idolId, {
        javId: Number(selectedJavId) || 0,
        cropLeft: displayCropLeft,
      })
      // 把结果回写到 store 的补丁表：列表与详情页都从那里取最新封面。
      if (updated && typeof updated === 'object') {
        patchJavIdol(idolId, {
          cover_code: String(updated.cover_code || ''),
          cover_crop_left: Number(updated.cover_crop_left ?? displayCropLeft),
          cover_jav_id: updated.cover_jav_id ?? null,
        })
      }
      showToast(zh('封面已更新', 'Cover updated'))
      onClose?.()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SubPage
      title={idolDisplayName(idol, preferChineseName) || zh('女优', 'Idol')}
      subtitle={zh('封面', 'Cover')}
      onBack={onClose}
      headerRight={
        <button
          type="button"
          onClick={handleReset}
          disabled={saving}
          className="flex-none px-2 text-[12.5px] font-semibold text-brand disabled:opacity-50"
        >
          {zh('重置', 'Reset')}
        </button>
      }
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
            onClick={handleSave}
            disabled={saving || loading || !idolId}
            className="h-11 flex-1 rounded-card bg-brand text-[14.5px] font-bold text-white disabled:opacity-50"
          >
            {saving ? zh('保存中…', 'Saving...') : zh('保存', 'Save')}
          </button>
        </>
      }
    >
      <section className="bg-white pb-3.5">
        <div className="flex items-center gap-2 border-b border-[#f1f2f5] px-3.5 py-2.5">
          <b className="text-[12.5px] text-zinc-700">{zh('取景', 'Framing')}</b>
          <span className="text-[11px] text-zinc-400">
            {previewCode || zh('无封面', 'No cover')}
          </span>
          <span className="ml-auto text-[11px] tabular-nums text-zinc-400">
            {Math.round(displayCropLeft * 100)}%
          </span>
        </div>

        <div className="px-3.5 pt-3">
          <div
            ref={boxRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className={`relative w-full select-none overflow-hidden rounded-card bg-zinc-100 ${
              hasPreview ? 'touch-none' : ''
            }`}
          >
            {hasPreview ? (
              <>
                <img
                  src={`/jav/${encodeURIComponent(previewCode)}/cover`}
                  alt={previewCode}
                  draggable={false}
                  onLoad={() => setImageFailed(false)}
                  onError={() => setImageFailed(true)}
                  className="block w-full"
                />
                {/* 取景框：框内正常亮度，框外用超大阴影压暗，一眼能看出会保留哪一段。 */}
                <div
                  className="absolute inset-y-0 border-2 border-white bg-white/10 shadow-[0_0_0_999px_rgba(15,23,42,0.75)]"
                  style={{
                    left: `${displayCropLeft * 100}%`,
                    width: `${IDOL_COVER_VISIBLE_RATIO * 100}%`,
                  }}
                >
                  <div className="absolute inset-y-0 left-0 w-1 bg-white/80" />
                  <div className="absolute inset-y-0 right-0 w-1 bg-white/80" />
                </div>
              </>
            ) : (
              <div className="flex aspect-[800/538] items-center justify-center text-[12.5px] text-zinc-400">
                {loading ? zh('加载中…', 'Loading...') : zh('封面待下载', 'Cover pending')}
              </div>
            )}
          </div>

          <p className="mt-2 text-center text-[11px] text-zinc-400">
            {zh('左右拖动可移动取景框', 'Drag sideways to move the frame')}
          </p>

          <label className="mt-3 flex items-center gap-3">
            <span className="w-8 flex-none text-[12px] text-zinc-500">{zh('起点', 'Start')}</span>
            <input
              type="range"
              min="0"
              max={maxCropLeft}
              step="0.001"
              value={displayCropLeft}
              onChange={(event) =>
                setCropLeft(normalizeDynamicCropLeft(event.target.value, maxCropLeft))
              }
              aria-label={zh('取景起点', 'Framing start')}
              className="min-w-0 flex-1 accent-brand"
            />
          </label>

          {/* 保存后窗口里会显示成什么样子，直接给一个按最终参数裁切的小样。 */}
          {hasPreview ? (
            <div className="mt-3 flex justify-center">
              <div
                className="relative w-[104px] overflow-hidden rounded-card bg-zinc-200"
                style={{ aspectRatio: '376 / 538' }}
              >
                <img
                  src={`/jav/${encodeURIComponent(previewCode)}/cover`}
                  alt=""
                  aria-hidden="true"
                  className="absolute top-0 h-full object-cover"
                  style={coverImageStyle(displayCropLeft)}
                />
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="mt-3 bg-white pb-6">
        {/* 滚到列表里挑来源时，上面那块大预览已经出屏了 —— 标题栏吸顶，并带上当前
            选中封面的缩略图与番号，选谁都能立刻确认，不用来回滚。
            这里放的是 800×538 的全图而不是裁切小样：要认的是「哪一张封面」，
            裁切结果上面已经有一份小样了。 */}
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-[#f1f2f5] bg-white px-3.5 py-2">
          <b className="flex-none text-[12.5px] text-zinc-700">{zh('封面来源', 'Cover source')}</b>
          <div className="ml-auto flex flex-none items-center gap-2">
            {hasPreview ? (
              <img
                src={`/jav/${encodeURIComponent(previewCode)}/cover`}
                alt=""
                aria-hidden="true"
                onError={() => setImageFailed(true)}
                className="h-10 flex-none rounded bg-zinc-100 object-cover"
                style={{ aspectRatio: `${IDOL_COVER_SOURCE_WIDTH} / ${IDOL_COVER_SOURCE_HEIGHT}` }}
              />
            ) : null}
            <span className="max-w-[140px] truncate text-[11px] text-zinc-600">
              {previewCode || zh('无封面', 'No cover')}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setSelectedJavId(0)
            setImageFailed(false)
          }}
          className={`flex w-full items-center gap-2.5 border-b border-[#f1f2f5] px-3.5 py-3 text-left active:bg-zinc-50 ${
            Number(selectedJavId) === 0 ? 'bg-brand-soft' : ''
          }`}
        >
          <Icon
            name="image"
            size={18}
            className={
              Number(selectedJavId) === 0 ? 'flex-none text-brand' : 'flex-none text-zinc-400'
            }
          />
          <span className="min-w-0 flex-1 text-[13.5px] font-medium text-zinc-800">
            {zh('自动选择', 'Auto')}
          </span>
          {Number(selectedJavId) === 0 ? (
            <Icon name="check" size={16} className="flex-none text-brand" />
          ) : null}
        </button>

        {loading ? (
          <div className="flex flex-col gap-2 p-3.5">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="skeleton h-11 rounded-card" />
            ))}
          </div>
        ) : options.length === 0 ? (
          <p className="px-3.5 py-6 text-center text-[12.5px] text-zinc-400">
            {zh('暂无可用作品', 'No available works')}
          </p>
        ) : (
          options.map((option) => {
            const active = Number(option.id) === Number(selectedJavId)
            const optionTitle = String(option?.title || '').trim()
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  setSelectedJavId(Number(option.id))
                  setImageFailed(false)
                }}
                className={`flex w-full items-center gap-2.5 border-b border-[#f1f2f5] px-3.5 py-2.5 text-left last:border-b-0 active:bg-zinc-50 ${
                  active ? 'bg-brand-soft' : ''
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <b className="text-[13px] text-zinc-800">{option.code}</b>
                    {option.solo ? (
                      <span className="rounded bg-emerald-50 px-1.5 py-[1px] text-[10px] font-semibold text-emerald-700">
                        {zh('单人', 'Solo')}
                      </span>
                    ) : null}
                  </span>
                  {optionTitle && optionTitle !== option.code ? (
                    <span className="mt-0.5 line-clamp-2 block text-[11.5px] text-zinc-400">
                      {optionTitle}
                    </span>
                  ) : null}
                </span>
                {active ? <Icon name="check" size={16} className="flex-none text-brand" /> : null}
              </button>
            )
          })
        )}
      </section>

      {error ? (
        <div className="mx-3.5 mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
          <Icon name="ban" size={14} className="mt-[1px] flex-none" />
          <span>{error}</span>
        </div>
      ) : null}
    </SubPage>
  )
}
