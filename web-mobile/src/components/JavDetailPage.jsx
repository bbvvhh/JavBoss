import { useEffect, useState } from 'react'

import { fetchJavs } from '@/api'
import Icon from '@/components/Icons'
import IdolCover from '@/components/IdolCover'
import JavWorkCard from '@/components/JavWorkCard'
import SubPage from '@/components/SubPage'
import { useStore } from '@/store'
import { formatBytes, parseVideoFingerprint } from '@/utils/display'
import { formatCount, formatDuration, formatReleaseDate } from '@/utils/format'
import { zh } from '@/utils/i18n'

function Cover({ code, title }) {
  const [failed, setFailed] = useState(false)
  if (!code || failed) {
    return (
      <div className="flex aspect-[800/538] w-full items-center justify-center bg-gradient-to-br from-zinc-200 to-zinc-300 text-sm font-semibold text-white/80">
        {code || zh('无封面', 'No cover')}
      </div>
    )
  }
  return (
    <img
      src={`/jav/${encodeURIComponent(code)}/cover`}
      alt={title || code}
      onError={() => setFailed(true)}
      className="aspect-[800/538] w-full bg-zinc-200 object-cover"
    />
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

/** JAV 作品详情：元数据 + 本地实际存在的视频文件。 */
export function JavDetailPage({ jav, onClose }) {
  const openPlayer = useStore((state) => state.openPlayer)
  const openActionSheet = useStore((state) => state.openActionSheet)
  const jumpToJavWorks = useStore((state) => state.jumpToJavWorks)

  const videos = useStore((state) => state.videos)
  const localVideos = Array.isArray(jav?.videos) ? jav.videos : []
  const idolList = (jav?.idols || []).filter((idol) => idol?.name)
  const tags = (jav?.tags || []).map((tag) => tag.name).filter(Boolean)

  const meta = [
    jav?.release_unix ? formatReleaseDate(jav.release_unix) : '',
    jav?.duration_min ? `${jav.duration_min} ${zh('分钟', 'min')}` : '',
    jav?.is_uncensored === true ? zh('无码', 'Uncensored') : '',
    jav?.favorite_rating > 0 ? `★ ${Number(jav.favorite_rating).toFixed(1)}` : '',
  ].filter(Boolean)

  return (
    <SubPage
      title={jav?.code || zh('JAV 详情', 'JAV detail')}
      subtitle={jav?.title}
      onBack={onClose}
    >
      <Cover code={jav?.code} title={jav?.title} />

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
                  onClick={() => openPlayer(video, videos)}
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
    </SubPage>
  )
}

/** 女优详情：资料 + 封面（与列表一致，只展示源图最右侧 47%）+ 她参与的作品。 */
export function JavIdolPage({ idol, onClose }) {
  const pushPage = useStore((state) => state.pushPage)
  const jumpToJavWorks = useStore((state) => state.jumpToJavWorks)

  const [works, setWorks] = useState([])
  const [worksLoading, setWorksLoading] = useState(true)

  const idolId = Number(idol?.id) || null
  const total = Number(idol?.work_count) || works.length
  const PREVIEW = 6

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
    [zh('身高', 'Height'), idol?.height_cm ? `${idol.height_cm} cm` : ''],
    [zh('罩杯', 'Cup'), idol?.cup ? `${idol.cup}` : ''],
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

      <section className="bg-white">
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
    </SubPage>
  )
}
