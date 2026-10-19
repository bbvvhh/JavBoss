import { useEffect, useState } from 'react'

import { deleteVideoLocation, fetchJavs, updateJavIdol, updateJavItem } from '@/api'
import ConfirmDialog from '@/components/ConfirmDialog'
import Icon from '@/components/Icons'
import IdolCover from '@/components/IdolCover'
import JavActorPickerSheet from '@/components/JavActorPickerSheet'
import JavFavoritePickerSheet from '@/components/JavFavoritePickerSheet'
import JavWorkCard from '@/components/JavWorkCard'
import SubPage from '@/components/SubPage'
import VideoPreviewGrid from '@/components/VideoPreviewGrid'
import { idolPatchKey, useStore } from '@/store'
import { formatBytes, parseVideoFingerprint } from '@/utils/display'
import { getErrorMessage } from '@/utils/errors'
import { formatCount, formatDuration, formatReleaseDate } from '@/utils/format'
import { zh } from '@/utils/i18n'
import { formatBirthDateWithAge, formatCup } from '@/utils/idolDisplay'

/**
 * 作品封面。带 `onPlay` 时整张封面就是一个播放按钮：
 * 点封面 = 用库内第一个文件开始播放（与 PC 端卡片的行为一致）。
 */
function Cover({ code, title, onPlay }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className="relative w-full bg-zinc-200">
      {!code || failed ? (
        <div className="flex aspect-[800/538] w-full items-center justify-center bg-gradient-to-br from-zinc-200 to-zinc-300 text-sm font-semibold text-white/80">
          {code || zh('无封面', 'No cover')}
        </div>
      ) : (
        <img
          src={`/jav/${encodeURIComponent(code)}/cover`}
          alt={title || code}
          onError={() => setFailed(true)}
          className="aspect-[800/538] w-full bg-zinc-200 object-cover"
        />
      )}
      {onPlay ? (
        <button
          type="button"
          onClick={onPlay}
          aria-label={zh('播放第一个文件', 'Play the first local file')}
          className="absolute inset-0 grid place-items-center bg-black/20 active:bg-black/35"
        >
          <span className="grid h-14 w-14 place-items-center rounded-full bg-black/60 text-white shadow-[0_2px_12px_rgba(0,0,0,0.45)]">
            <Icon name="play" size={22} />
          </span>
        </button>
      ) : null}
    </div>
  )
}

function JumpRow({ label, value, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-lg bg-[#f7f8fa] px-2.5 py-2 text-left text-[12.5px] active:bg-zinc-100"
    >
      <span className="flex-none rounded bg-zinc-100 px-[5px] text-[10px] font-bold leading-[15px] text-zinc-400">
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium text-zinc-800">{value}</span>
      <span className="flex-none text-[11px] font-semibold text-brand">
        {zh('查看影片', 'View works')}
      </span>
      <Icon name="right" size={14} className="flex-none text-zinc-300" />
    </button>
  )
}

/** 单颗星的填充量：0 = 空星，0.5 = 半星，1 = 满星（rating 已被约束到 0.5 步进）。 */
function starFillLevel(rating, star) {
  const amount = Math.max(0, Math.min(1, rating - (star - 1)))
  if (amount >= 1) return 1
  if (amount >= 0.5) return 0.5
  return 0
}

/** 用「描边空星打底 + 实心星按比例裁切」拼出半星，省掉一个独立图标。 */
function StarGlyph({ fill, size = 22 }) {
  return (
    <span className="relative inline-flex" style={{ width: size, height: size }}>
      <Icon name="star" size={size} className="text-zinc-300" />
      {fill > 0 ? (
        <span
          className="absolute inset-y-0 left-0 flex overflow-hidden"
          style={{ width: size * fill }}
        >
          <Icon name="starFilled" size={size} className="text-amber-400" />
        </span>
      ) : null}
    </span>
  )
}

/**
 * 喜爱度打分。
 *
 * 值是 0–5、0.5 一档（后端校验见 internal/db/jav.go）。每颗星左右各半个
 * 点击区：点左半边给半星（如 3.5），点右半边给整星（如 4），再点当前
 * 同值清零。
 */
function FavoriteRating({ value, saving, onChange }) {
  const rating = Number(value) || 0
  const commit = (next) => {
    if (saving) return
    onChange(rating === next ? 0 : next)
  }
  return (
    <div className="mt-2.5 rounded-card border border-[#e6e8ec] bg-white px-3.5 py-3">
      <div className="flex items-center gap-2">
        <span className="text-[13.5px] text-zinc-800">{zh('喜爱度', 'Rating')}</span>
        <span className="ml-auto text-[12px] tabular-nums text-zinc-400">
          {saving ? zh('保存中…', 'Saving...') : rating > 0 ? rating.toFixed(1) : '—'}
        </span>
      </div>
      <div className={`mt-2 flex items-center gap-1 ${saving ? 'opacity-60' : ''}`}>
        {[1, 2, 3, 4, 5].map((star) => (
          <div key={star} className="relative grid h-9 w-9 place-items-center">
            <StarGlyph fill={starFillLevel(rating, star)} />
            <button
              type="button"
              disabled={saving}
              onClick={() => commit(star - 0.5)}
              aria-label={zh(`${star - 0.5} 分`, `${star - 0.5} point`)}
              aria-pressed={rating === star - 0.5}
              className="absolute inset-y-0 left-0 w-1/2 rounded-l-lg active:bg-zinc-100"
            />
            <button
              type="button"
              disabled={saving}
              onClick={() => commit(star)}
              aria-label={zh(`${star} 分`, `${star} point`)}
              aria-pressed={rating === star}
              className="absolute inset-y-0 right-0 w-1/2 rounded-r-lg active:bg-zinc-100"
            />
          </div>
        ))}
        {rating > 0 ? (
          <button
            type="button"
            disabled={saving}
            onClick={() => onChange(0)}
            className="ml-1 rounded-lg px-2 py-1 text-[12px] font-semibold text-zinc-400 active:bg-zinc-100"
          >
            {zh('清除', 'Clear')}
          </button>
        ) : null}
      </div>
    </div>
  )
}

/** 演员列表取自 `jav.idols`；过滤掉没有名字的空壳，避免渲染出空按钮。 */
const normalizeIdols = (list) => (Array.isArray(list) ? list : []).filter((idol) => idol?.name)

/** JAV 作品详情：元数据 + 本地实际存在的视频文件。 */
export function JavDetailPage({ jav, onClose }) {
  const openPlayer = useStore((state) => state.openPlayer)
  const openActionSheet = useStore((state) => state.openActionSheet)
  const jumpToJavWorks = useStore((state) => state.jumpToJavWorks)
  const openJavIdol = useStore((state) => state.openJavIdol)
  const showToast = useStore((state) => state.showToast)
  const patchJavItem = useStore((state) => state.patchJavItem)

  const javId = Number(jav?.id) || 0
  // 本地文件列表用 state 承载：删除某个文件后可以立即从界面移除，
  // 同时通过 patchJavItem 把结果同步到列表卡片。
  const [videos, setVideos] = useState(() => (Array.isArray(jav?.videos) ? jav.videos : []))
  const localVideos = videos
  const tags = (jav?.tags || []).map((tag) => tag.name).filter(Boolean)

  // 演员可以在本页编辑（见 JavActorPickerSheet），所以用本地 state 承载，
  // 保存成功后同时写回列表卡片的补丁表。
  const [idols, setIdols] = useState(() => normalizeIdols(jav?.idols))
  const [actorPickerOpen, setActorPickerOpen] = useState(false)
  const idolList = idols

  const [rating, setRating] = useState(() => Number(jav?.favorite_rating) || 0)
  const [ratingSaving, setRatingSaving] = useState(false)
  const [favoriteCount, setFavoriteCount] = useState(() => Number(jav?.favorite_count) || 0)
  const [favoriteOpen, setFavoriteOpen] = useState(false)
  const [actionError, setActionError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  // 每次压入新作品都重新取一次，避免复用到上一条的状态。
  useEffect(() => {
    setIdols(normalizeIdols(jav?.idols))
    setActorPickerOpen(false)
    setRating(Number(jav?.favorite_rating) || 0)
    setFavoriteCount(Number(jav?.favorite_count) || 0)
    setActionError('')
    setDeleteTarget(null)
    setDeleteBusy(false)
    setVideos(Array.isArray(jav?.videos) ? jav.videos : [])
  }, [jav])

  // 删除单个本地文件：必须经过 ConfirmDialog（danger + 勾选确认）二次确认。
  const confirmDeleteFile = async () => {
    const target = deleteTarget
    if (!target || deleteBusy) return
    const locationId = Number(target.location_id)
    const videoId = Number(target.id)
    if (
      !Number.isFinite(locationId) ||
      locationId <= 0 ||
      !Number.isFinite(videoId) ||
      videoId <= 0
    ) {
      setActionError(
        zh(
          '该文件缺少必要标识，无法删除',
          'This file is missing an identifier and cannot be deleted'
        )
      )
      setDeleteTarget(null)
      return
    }
    setDeleteBusy(true)
    setActionError('')
    try {
      await deleteVideoLocation(videoId, locationId)
      const remaining = localVideos.filter((item) => Number(item.location_id) !== locationId)
      setVideos(remaining)
      patchJavItem(javId, { videos: remaining })
      showToast(zh('文件已删除', 'File deleted'))
      setDeleteTarget(null)
    } catch (error) {
      setActionError(getErrorMessage(error))
    } finally {
      setDeleteBusy(false)
    }
  }

  const changeRating = async (next) => {
    if (!javId || ratingSaving) return
    const value = Math.max(0, Math.min(5, Math.round(Number(next) * 2) / 2))
    if (value === rating) return
    const previous = rating
    setRating(value)
    setRatingSaving(true)
    setActionError('')
    try {
      const updated = await updateJavItem(javId, { favorite_rating: value })
      const saved = Number(updated?.favorite_rating)
      const finalValue = Number.isFinite(saved) ? saved : value
      setRating(finalValue)
      patchJavItem(javId, { favorite_rating: finalValue })
      showToast(zh('喜爱度已保存', 'Rating saved'))
    } catch (error) {
      setRating(previous)
      setActionError(getErrorMessage(error))
    } finally {
      setRatingSaving(false)
    }
  }

  // 点预览图上的播放图标 = 用该截图所属的文件从截图所在进度开始播（与 PC 一致）。
  const playAtScreenshot = (video, startSecond) => {
    if (!video || startSecond == null) return
    openPlayer(video, localVideos, startSecond, jav)
  }

  const meta = [
    jav?.release_unix ? formatReleaseDate(jav.release_unix) : '',
    jav?.duration_min ? `${jav.duration_min} ${zh('分钟', 'min')}` : '',
    jav?.is_uncensored === true ? zh('无码', 'Uncensored') : '',
    rating > 0 ? `★ ${Number(rating).toFixed(1)}` : '',
  ].filter(Boolean)

  return (
    <SubPage
      title={jav?.code || zh('JAV 详情', 'JAV detail')}
      subtitle={jav?.title}
      onBack={onClose}
    >
      {/* 点封面 = 播放库内的第一个文件（没有本地文件时封面不可点）。 */}
      <Cover
        code={jav?.code}
        title={jav?.title}
        onPlay={
          localVideos.length ? () => openPlayer(localVideos[0], localVideos, 0, jav) : undefined
        }
      />

      <section className="border-b border-[#e6e8ec] bg-white px-3.5 py-3.5">
        <h3 className="text-[14.5px] font-semibold leading-snug text-zinc-900">
          {jav?.title || jav?.code}
        </h3>
        {meta.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-zinc-500">
            {meta.map((item) => (
              <span key={item} className="rounded bg-[#f1f2f5] px-[7px] py-[2px]">
                {item}
              </span>
            ))}
          </div>
        ) : null}

        {/* 加入作品收藏夹：注意这是 JAV 作品本身的收藏夹，
            与「视频文件的收藏夹」不是一回事。 */}
        <button
          type="button"
          onClick={() => setFavoriteOpen(true)}
          disabled={!javId}
          className="mt-2.5 flex w-full items-center gap-2 rounded-card border border-[#e6e8ec] bg-white px-3 py-2.5 text-left active:bg-zinc-50 disabled:opacity-50"
        >
          <Icon
            name={favoriteCount > 0 ? 'starFilled' : 'star'}
            size={18}
            className={favoriteCount > 0 ? 'flex-none text-amber-400' : 'flex-none text-zinc-400'}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[13.5px] font-medium text-zinc-800">
              {favoriteCount > 0
                ? zh('已在作品收藏夹', 'In work favorites')
                : zh('加入作品收藏夹', 'Add to work favorites')}
            </span>
            <span className="mt-0.5 block text-[11px] text-zinc-400">
              {favoriteCount > 0
                ? zh(`${favoriteCount} 个收藏夹`, `${favoriteCount} group(s)`)
                : zh(
                    '只影响数据库里的分组，不动任何视频文件',
                    'Grouping only — no files are touched'
                  )}
            </span>
          </span>
          <Icon name="right" size={14} className="flex-none text-zinc-300" />
        </button>

        <FavoriteRating value={rating} saving={ratingSaving} onChange={changeRating} />

        {actionError ? (
          <p className="mt-2 rounded-card border border-red-200 bg-red-50 px-3 py-2 text-[12px] leading-relaxed text-red-700">
            {actionError}
          </p>
        ) : null}

        {/* 片商 / 系列：点一下跳到它们的全部影片 */}
        {jav?.studio?.name || jav?.series?.name ? (
          <div className="mt-2.5 flex flex-col gap-2">
            {jav?.studio?.name ? (
              <JumpRow
                label={zh('片商', 'Studio')}
                value={jav.studio.name}
                onClick={() =>
                  jumpToJavWorks({ studioId: jav.studio.id, studioName: jav.studio.name })
                }
              />
            ) : null}
            {jav?.series?.name ? (
              <JumpRow
                label={zh('系列', 'Series')}
                value={jav.series.name}
                onClick={() =>
                  jumpToJavWorks({ seriesId: jav.series.id, seriesName: jav.series.name })
                }
              />
            ) : null}
          </div>
        ) : null}

        {/* 演员：点名字进女优详情页；右侧「调整」打开只选已有女优的选择器，
            用于给刮削不到演员的作品手动补关联。 */}
        <div className="mt-2.5 flex items-start gap-2 text-[12px] text-zinc-600">
          <span className="mt-[1px] flex-none rounded bg-zinc-100 px-[5px] text-[10px] font-bold leading-[15px] text-zinc-400">
            {zh('演员', 'Cast')}
          </span>
          <span className="flex min-w-0 flex-1 flex-wrap gap-x-1.5 gap-y-1">
            {idolList.length ? (
              idolList.map((idol, index) => (
                <button
                  key={idol.id ?? idol.name}
                  type="button"
                  onClick={() => openJavIdol(idol)}
                  className="font-medium text-brand active:underline"
                >
                  {index > 0 ? <span className="text-zinc-300">· </span> : null}
                  {idol.name}
                </button>
              ))
            ) : (
              <span className="text-zinc-400">{zh('未关联演员', 'No cast linked')}</span>
            )}
          </span>
          <button
            type="button"
            onClick={() => setActorPickerOpen(true)}
            disabled={!javId}
            className="flex-none rounded-lg px-2 py-0.5 text-[11.5px] font-semibold text-brand active:bg-zinc-100 disabled:opacity-40"
          >
            {zh('调整', 'Edit')}
          </button>
        </div>

        {tags.length ? (
          <div className="mt-2 flex items-start gap-2 text-[12px] text-zinc-600">
            <span className="flex-none rounded bg-zinc-100 px-[5px] text-[10px] font-bold leading-[15px] text-zinc-400">
              {zh('标签', 'Tags')}
            </span>
            <span className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded bg-[#fdba74] px-[5px] text-[10px] font-bold leading-[15px] text-zinc-900"
                >
                  {tag}
                </span>
              ))}
            </span>
          </div>
        ) : null}
      </section>

      <section className="bg-white">
        <div className="flex items-center gap-2 border-b border-[#f1f2f5] px-3.5 py-2.5">
          <b className="text-[12.5px] text-zinc-700">{zh('库内文件', 'Local files')}</b>
          <span className="text-[11px] text-zinc-400">
            {zh(`${formatCount(localVideos.length)} 个`, `${localVideos.length}`)}
          </span>
        </div>
        {localVideos.length === 0 ? (
          <p className="px-3.5 py-5 text-center text-[12.5px] text-zinc-400">
            {zh('这条记录还没有关联本地文件', 'No local files linked yet')}
          </p>
        ) : (
          localVideos.map((video) => {
            const fingerprint = parseVideoFingerprint(video?.fingerprint)
            const size = formatBytes(fingerprint.size || video?.size)
            const duration = formatDuration(video?.duration_sec)
            return (
              <div
                key={video.location_id || video.id}
                className="flex items-center gap-3 border-b border-[#f1f2f5] px-3.5 py-3 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <b className="block truncate text-[12.5px] font-medium text-zinc-800">
                    {video.filename || video.path}
                  </b>
                  <span className="mt-0.5 block text-[10.5px] text-zinc-400">
                    {[duration, size].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => openPlayer(video, localVideos, 0, jav)}
                  aria-label={zh('播放', 'Play')}
                  className="grid h-9 w-9 flex-none place-items-center rounded-full bg-brand text-white"
                >
                  <Icon name="play" size={15} />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    openActionSheet(video, {
                      canDelete: true,
                      onDelete: () => setDeleteTarget(video),
                    })
                  }
                  aria-label={zh('更多操作', 'More actions')}
                  className="grid h-9 w-9 flex-none place-items-center rounded-lg text-zinc-500 active:bg-zinc-100"
                >
                  <Icon name="more" size={17} />
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(video)}
                  aria-label={zh('删除文件', 'Delete file')}
                  className="grid h-9 w-9 flex-none place-items-center rounded-lg text-red-500 active:bg-red-50"
                >
                  <Icon name="trash" size={17} />
                </button>
              </div>
            )
          })
        )}
      </section>

      {/* 视频预览图：该作品全部本地文件在播放时保存下来的截图。与 PC 的
          JavScreenshotGrid 一致 —— 只能看 / 删，不在这里改封面（作品本身有刮削封面）。 */}
      {localVideos.length ? (
        <section className="mt-3 bg-white">
          <div className="flex items-center gap-2 border-b border-[#f1f2f5] px-3.5 py-2.5">
            <b className="text-[12.5px] text-zinc-700">{zh('视频预览图', 'Preview images')}</b>
          </div>
          <div className="px-3.5 py-3">
            <VideoPreviewGrid
              videos={localVideos}
              emptyHint={zh('暂无视频截图', 'No video screenshots')}
              onPlayAtTime={playAtScreenshot}
            />
          </div>
        </section>
      ) : null}

      <p className="px-3.5 pb-10 pt-4 text-[11px] leading-relaxed text-zinc-400">
        {zh(
          '删除库内文件属于不可恢复的高风险操作，删除前会再次确认；如需重命名文件，请回到视频列表使用「重命名文件」。',
          'Deleting a local file is irreversible and requires an extra confirmation. To rename a file, use “Rename file” in the video list.'
        )}
      </p>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        danger
        busy={deleteBusy}
        title={zh('删除本地文件', 'Delete local file')}
        description={zh(
          '将从磁盘删除该文件，并从数据库移除这条文件位置记录，此操作不可撤销。',
          'This removes the file from disk and deletes its location record. It cannot be undone.'
        )}
        items={
          deleteTarget
            ? [deleteTarget.filename || deleteTarget.path || deleteTarget.location_id]
            : []
        }
        confirmText={zh('删除', 'Delete')}
        onConfirm={confirmDeleteFile}
        onClose={() => {
          if (!deleteBusy) setDeleteTarget(null)
        }}
      />

      <JavActorPickerSheet
        open={actorPickerOpen}
        jav={jav}
        onClose={() => setActorPickerOpen(false)}
        onSaved={(nextIdols) => {
          const normalized = normalizeIdols(nextIdols)
          setIdols(normalized)
          patchJavItem(javId, { idols: normalized })
        }}
      />

      <JavFavoritePickerSheet
        open={favoriteOpen}
        entityType="jav"
        entity={jav}
        onClose={() => setFavoriteOpen(false)}
        onSaved={(ids) => {
          setFavoriteCount(ids.length)
          patchJavItem(javId, { favorite_count: ids.length })
        }}
      />
    </SubPage>
  )
}

/** 女优详情：资料 + 封面（与列表一致，只展示源图最右侧 47%）+ 她参与的作品。 */
export function JavIdolPage({ idol, onClose }) {
  const pushPage = useStore((state) => state.pushPage)
  const jumpToJavWorks = useStore((state) => state.jumpToJavWorks)
  const patchJavIdol = useStore((state) => state.patchJavIdol)
  const showToast = useStore((state) => state.showToast)
  const itemPatches = useStore((state) => state.javItemPatches)

  const [works, setWorks] = useState([])
  const [worksLoading, setWorksLoading] = useState(true)
  const [favoriteCount, setFavoriteCount] = useState(() => Number(idol?.favorite_count) || 0)
  const [favoriteOpen, setFavoriteOpen] = useState(false)
  // 喜爱度：与作品详情页完全一致的交互（星左右半边 = 0.5 步进，再点同值清零）。
  const [rating, setRating] = useState(() => Number(idol?.favorite_rating) || 0)
  const [ratingSaving, setRatingSaving] = useState(false)
  const [ratingError, setRatingError] = useState('')

  const idolId = Number(idol?.id) || null
  const total = Number(idol?.work_count) || works.length
  // 封面可能刚在编辑页改过，补丁表里的是最新值；payload 是进页面时的那一份快照。
  // 没有补丁时保持原引用，避免每次渲染都造新对象。
  const patch = idolId ? itemPatches[idolPatchKey(idolId)] : null
  const coverIdol = patch ? { ...idol, ...patch } : idol
  const PREVIEW = 6

  useEffect(() => {
    setFavoriteCount(Number(idol?.favorite_count) || 0)
    setRating(Number(idol?.favorite_rating) || 0)
    setRatingError('')
  }, [idol])

  const changeRating = async (next) => {
    if (!idolId || ratingSaving) return
    const value = Math.max(0, Math.min(5, Math.round(Number(next) * 2) / 2))
    if (value === rating) return
    const previous = rating
    setRating(value)
    setRatingSaving(true)
    setRatingError('')
    try {
      const updated = await updateJavIdol(idolId, { favorite_rating: value })
      const saved = Number(updated?.favorite_rating)
      const finalValue = Number.isFinite(saved) ? saved : value
      setRating(finalValue)
      patchJavIdol(idolId, { favorite_rating: finalValue })
      showToast(zh('喜爱度已保存', 'Rating saved'))
    } catch (error) {
      setRating(previous)
      setRatingError(getErrorMessage(error))
    } finally {
      setRatingSaving(false)
    }
  }

  useEffect(() => {
    if (!idolId) {
      setWorks([])
      setWorksLoading(false)
      return undefined
    }
    let cancelled = false
    setWorksLoading(true)
    fetchJavs({ limit: PREVIEW, offset: 0, idolIds: [idolId] })
      .then((resp) => {
        if (!cancelled) setWorks(resp?.items || [])
      })
      .catch(() => {
        if (!cancelled) setWorks([])
      })
      .finally(() => {
        if (!cancelled) setWorksLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [idolId])

  const rows = [
    [zh('作品数', 'Works'), idol?.work_count ? formatCount(idol.work_count) : ''],
    [zh('生日', 'Birthday'), formatBirthDateWithAge(idol?.birth_date)],
    [zh('身高', 'Height'), idol?.height_cm ? `${idol.height_cm} cm` : ''],
    // 罩杯在库里是 1–11 的序号，必须换算成字母，不能直接打印数字。
    [zh('罩杯', 'Cup'), formatCup(idol?.cup)],
    [zh('胸围', 'Bust'), idol?.bust ? `${idol.bust} cm` : ''],
    [zh('腰围', 'Waist'), idol?.waist ? `${idol.waist} cm` : ''],
    [zh('臀围', 'Hips'), idol?.hips ? `${idol.hips} cm` : ''],
    [zh('别名', 'Aliases'), (idol?.aliases || []).join('、')],
  ].filter(([, value]) => value)

  return (
    <SubPage
      title={idol?.name || zh('女优', 'Idol')}
      onBack={onClose}
      headerRight={
        idolId ? (
          <button
            type="button"
            onClick={() => jumpToJavWorks({ idolIds: [idolId] })}
            className="flex-none px-2 text-[12.5px] font-semibold text-brand"
          >
            {zh('查看影片', 'View works')}
          </button>
        ) : null
      }
    >
      <div className="flex flex-col items-center gap-2 px-4 py-4">
        {/* 点封面进封面编辑页：换一张作品封面或调取景起点（只写数据库）。 */}
        <button
          type="button"
          onClick={() => pushPage('jav-idol-cover', coverIdol)}
          disabled={!idolId}
          aria-label={zh('编辑女优封面', 'Edit idol cover')}
          className="w-[62%] max-w-[260px] disabled:opacity-60"
        >
          <IdolCover
            code={coverIdol?.cover_code}
            alt={coverIdol?.name}
            cropLeft={coverIdol?.cover_crop_left}
            className="w-full shadow-[0_2px_10px_-4px_rgba(15,23,42,0.35)]"
          />
        </button>
        {idolId ? (
          <button
            type="button"
            onClick={() => pushPage('jav-idol-cover', coverIdol)}
            className="flex items-center gap-1 text-[11.5px] font-semibold text-brand"
          >
            <Icon name="image" size={13} />
            {zh('更换封面', 'Change cover')}
          </button>
        ) : null}
      </div>

      {/* 收藏这位女优：走的是女优收藏夹（/jav/idols/:id/favorite-groups），
          和视频文件、作品收藏夹都不相干。 */}
      <section className="bg-white">
        <button
          type="button"
          onClick={() => setFavoriteOpen(true)}
          disabled={!idolId}
          className="flex w-full items-center gap-3 border-b border-[#f1f2f5] px-3.5 py-3 text-left active:bg-zinc-50 disabled:opacity-50"
        >
          <Icon
            name={favoriteCount > 0 ? 'starFilled' : 'star'}
            size={18}
            className={favoriteCount > 0 ? 'flex-none text-amber-400' : 'flex-none text-zinc-400'}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[13.5px] font-medium text-zinc-800">
              {favoriteCount > 0
                ? zh('已在女优收藏夹', 'In idol favorites')
                : zh('加入女优收藏夹', 'Add to idol favorites')}
            </span>
            <span className="mt-0.5 block text-[11px] text-zinc-400">
              {favoriteCount > 0
                ? zh(`${favoriteCount} 个收藏夹`, `${favoriteCount} group(s)`)
                : zh('只写数据库分组，不动任何文件', 'Grouping only — no files are touched')}
            </span>
          </span>
          <Icon name="right" size={14} className="flex-none text-zinc-300" />
        </button>

        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-center gap-3 border-b border-[#f1f2f5] px-3.5 py-3 text-[13px] last:border-b-0"
          >
            <span className="flex-1 text-zinc-500">{label}</span>
            <span className="flex-none font-medium text-zinc-800">{value}</span>
          </div>
        ))}
        {rows.length === 0 ? (
          <p className="px-3.5 py-6 text-center text-[12.5px] text-zinc-400">
            {zh('暂无资料', 'No profile data')}
          </p>
        ) : null}

        <div className="border-t border-[#f1f2f5] px-3.5 pb-3.5 pt-1">
          <FavoriteRating value={rating} saving={ratingSaving} onChange={changeRating} />
          {ratingError ? (
            <p className="mt-2 rounded-card border border-red-200 bg-red-50 px-3 py-2 text-[12px] leading-relaxed text-red-700">
              {ratingError}
            </p>
          ) : null}
        </div>
      </section>

      <section className="mt-3 bg-white pb-10">
        <div className="flex items-center gap-2 border-b border-[#f1f2f5] px-3.5 py-2.5">
          <b className="text-[12.5px] text-zinc-700">{zh('参与作品', 'Works')}</b>
          <span className="text-[11px] text-zinc-400">{formatCount(total)}</span>
          {idolId && total > works.length ? (
            <button
              type="button"
              onClick={() => jumpToJavWorks({ idolIds: [idolId] })}
              className="ml-auto text-[11.5px] font-semibold text-brand"
            >
              {zh('查看全部', 'View all')}
            </button>
          ) : null}
        </div>

        {worksLoading ? (
          <div className="grid grid-cols-2 gap-2.5 p-3.5">
            {Array.from({ length: 2 }).map((_, index) => (
              <div key={index} className="skeleton aspect-[800/538] rounded-card" />
            ))}
          </div>
        ) : works.length === 0 ? (
          <p className="px-3.5 py-6 text-center text-[12.5px] text-zinc-400">
            {zh('暂无关联作品', 'No works linked yet')}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 p-3.5">
            {works.map((item) => (
              <JavWorkCard
                key={item.id}
                item={item}
                density="standard"
                onOpen={(value) => pushPage('jav-detail', value)}
              />
            ))}
          </div>
        )}
      </section>

      <JavFavoritePickerSheet
        open={favoriteOpen}
        entityType="idol"
        entity={idol}
        onClose={() => setFavoriteOpen(false)}
        onSaved={(ids) => {
          setFavoriteCount(ids.length)
          patchJavIdol(idolId, { favorite_count: ids.length })
        }}
      />
    </SubPage>
  )
}
