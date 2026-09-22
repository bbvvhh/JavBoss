import { useEffect, useState } from 'react'

import { fetchJavs, updateJavItem } from '@/api'
import Icon from '@/components/Icons'
import IdolCover from '@/components/IdolCover'
import JavFavoritePickerSheet from '@/components/JavFavoritePickerSheet'
import JavWorkCard from '@/components/JavWorkCard'
import SubPage from '@/components/SubPage'
import { useStore } from '@/store'
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

/**
 * 喜爱度打分。
 *
 * 值是 0–5、允许 0.5 步进（后端校验见 internal/db/jav.go），但移动端不做
 * 半星拖拽 —— 点第 N 颗星 = N 分，再点同一颗 = 清零。既简单又避免了
 * 手指在窄屏上分辨半颗星的麻烦。
 */
function FavoriteRating({ value, saving, onChange }) {
  const rating = Number(value) || 0
  const filled = Math.round(rating)
  return (
    <div className="mt-2.5 rounded-card border border-[#e6e8ec] bg-white px-3.5 py-3">
      <div className="flex items-center gap-2">
        <span className="text-[13.5px] text-zinc-800">{zh('喜爱度', 'Rating')}</span>
        <span className="ml-auto text-[12px] tabular-nums text-zinc-400">
          {saving ? zh('保存中…', 'Saving...') : rating > 0 ? rating.toFixed(1) : '—'}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((star) => {
          const active = star <= filled
          return (
            <button
              key={star}
              type="button"
              disabled={saving}
              onClick={() => onChange(rating === star ? 0 : star)}
              aria-label={zh(`${star} 分`, `${star} point`)}
              aria-pressed={active}
              className="grid h-9 w-9 place-items-center rounded-lg active:bg-zinc-100 disabled:opacity-60"
            >
              <Icon
                name={active ? 'starFilled' : 'star'}
                size={22}
                className={active ? 'text-amber-400' : 'text-zinc-300'}
              />
            </button>
          )
        })}
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

/** JAV 作品详情：元数据 + 本地实际存在的视频文件。 */
export function JavDetailPage({ jav, onClose }) {
  const openPlayer = useStore((state) => state.openPlayer)
  const openActionSheet = useStore((state) => state.openActionSheet)
  const jumpToJavWorks = useStore((state) => state.jumpToJavWorks)
  const showToast = useStore((state) => state.showToast)
  const patchJavItem = useStore((state) => state.patchJavItem)

  const javId = Number(jav?.id) || 0
  const localVideos = Array.isArray(jav?.videos) ? jav.videos : []
  const idolList = (jav?.idols || []).filter((idol) => idol?.name)
  const tags = (jav?.tags || []).map((tag) => tag.name).filter(Boolean)

  const [rating, setRating] = useState(() => Number(jav?.favorite_rating) || 0)
  const [ratingSaving, setRatingSaving] = useState(false)
  const [favoriteCount, setFavoriteCount] = useState(() => Number(jav?.favorite_count) || 0)
  const [favoriteOpen, setFavoriteOpen] = useState(false)
  const [actionError, setActionError] = useState('')

  // 每次压入新作品都重新取一次，避免复用到上一条的状态。
  useEffect(() => {
    setRating(Number(jav?.favorite_rating) || 0)
    setFavoriteCount(Number(jav?.favorite_count) || 0)
    setActionError('')
  }, [jav])

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
        onPlay={localVideos.length ? () => openPlayer(localVideos[0], localVideos) : undefined}
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

        {idolList.length ? (
          <div className="mt-2.5 flex items-start gap-2 text-[12px] text-zinc-600">
            <span className="mt-[1px] flex-none rounded bg-zinc-100 px-[5px] text-[10px] font-bold leading-[15px] text-zinc-400">
              {zh('演员', 'Cast')}
            </span>
            <span className="flex flex-wrap gap-x-1.5 gap-y-1">
              {idolList.map((idol, index) => (
                <button
                  key={idol.id ?? idol.name}
                  type="button"
                  onClick={() => jumpToJavWorks({ idolIds: [idol.id] })}
                  className="font-medium text-brand active:underline"
                >
                  {index > 0 ? <span className="text-zinc-300">· </span> : null}
                  {idol.name}
                </button>
              ))}
            </span>
          </div>
        ) : null}

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
                  onClick={() => openPlayer(video, localVideos)}
                  aria-label={zh('播放', 'Play')}
                  className="grid h-9 w-9 flex-none place-items-center rounded-full bg-brand text-white"
                >
                  <Icon name="play" size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => openActionSheet(video)}
                  aria-label={zh('更多操作', 'More actions')}
                  className="grid h-9 w-9 flex-none place-items-center rounded-lg text-zinc-500 active:bg-zinc-100"
                >
                  <Icon name="more" size={17} />
                </button>
              </div>
            )
          })
        )}
      </section>

      <p className="px-3.5 pb-10 pt-4 text-[11px] leading-relaxed text-zinc-400">
        {zh(
          '详情页只展示与编辑数据库中的元数据；如需修改本地文件，请回到视频列表使用「重命名文件」。',
          'This page only reads and edits metadata. Use “Rename file” in the video list to touch local files.'
        )}
      </p>

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

  const [works, setWorks] = useState([])
  const [worksLoading, setWorksLoading] = useState(true)
  const [favoriteCount, setFavoriteCount] = useState(() => Number(idol?.favorite_count) || 0)
  const [favoriteOpen, setFavoriteOpen] = useState(false)

  const idolId = Number(idol?.id) || null
  const total = Number(idol?.work_count) || works.length
  const PREVIEW = 6

  useEffect(() => {
    setFavoriteCount(Number(idol?.favorite_count) || 0)
  }, [idol])

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
      <div className="flex justify-center px-4 py-4">
        <IdolCover
          code={idol?.cover_code}
          alt={idol?.name}
          className="w-[62%] max-w-[260px] shadow-[0_2px_10px_-4px_rgba(15,23,42,0.35)]"
        />
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
