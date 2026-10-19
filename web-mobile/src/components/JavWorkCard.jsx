import { useRef, useState } from 'react'

import Icon from '@/components/Icons'
import useLongPress from '@/hooks/useLongPress'
import { useStore } from '@/store'
import { formatReleaseDate } from '@/utils/format'
import { idolDisplayName, javDisplayPrefs, javTagDisplayName } from '@/utils/javDisplay'
import { zh } from '@/utils/i18n'

/**
 * JAV 作品卡。列表页与女优详情页共用，`density` 控制排版：
 *   large    —— 单列，标题完整 + 元信息 chips + 演员行 + 标签行
 *   standard —— 2 列，标题 2 行 + 演员 · 片商
 *   compact  —— 3 列，只留标题
 *
 * 点击分区（移动端明确要求的行为，务必保持可预测）：
 *   封面   → 播放库内第一个文件（没有本地文件时回落到作品详情）
 *   标题   → 作品详情
 *   演员名 → 女优详情页
 * 卡内其余区域（元信息 chips、标签、留白）不绑定动作，避免误触进错页面。
 *
 * 多选态由作品列表页下发：整卡点选 = 勾选/取消，长按 = 进入多选（与视频卡一致）。
 * 多选态下封面 / 标题 / 演员一律只做勾选，不再触发上面的跳转。
 *
 * 显示哪些行由全局设置决定（不显示演员 / 标签 / 系列、优先中文名、简体标签），
 * 与 PC 端共用同一批配置键。
 */
export default function JavWorkCard({
  item,
  density = 'standard',
  onOpen,
  selectionMode = false,
  selected = false,
  onToggle,
  onLongPress,
}) {
  const [failed, setFailed] = useState(false)
  // 刚发生过长按（用于挡掉长按进入多选后紧跟着的那次 click）。
  const longPressedRef = useRef(false)
  const config = useStore((state) => state.config)
  const openPlayer = useStore((state) => state.openPlayer)
  const openJavIdol = useStore((state) => state.openJavIdol)
  const prefs = javDisplayPrefs(config)

  const compact = density === 'compact'
  const large = density === 'large'
  const code = String(item?.code || '').trim()
  const videos = Array.isArray(item?.videos) ? item.videos : []
  const canPlay = videos.length > 0
  // 演员要能单独点进详情页，就得同时留着 id 和显示名（只留名字的字符串数组点不出详情）。
  const idols = prefs.hideIdols
    ? []
    : (item?.idols || [])
        .map((idol) => ({ idol, name: idolDisplayName(idol, prefs.preferChineseName) }))
        .filter((entry) => entry.name)
  const tags = prefs.hideTags ? [] : item?.tags || []

  const gesture = useLongPress({
    onTap: () => {
      if (selectionMode) onToggle?.(item)
    },
    onLongPress: () => {
      // 长按进入多选后（尤其桌面按住再松开）浏览器可能补发一次 click 到内部分区，
      // 用这个标记把那次 click 挡掉，避免「刚进多选又跳了详情」。
      longPressedRef.current = true
      if (selectionMode) onToggle?.(item)
      else onLongPress?.(item)
    },
  })

  // 每次新的按下都清掉长按标记，保证它只影响紧跟着的那一次点击。
  const { onPointerDown: gesturePointerDown, ...gestureRest } = gesture
  const handlePointerDown = (event) => {
    longPressedRef.current = false
    gesturePointerDown(event)
  }

  const blocked = () => selectionMode || longPressedRef.current

  const play = () => {
    if (blocked()) return
    if (canPlay) openPlayer(videos[0], videos)
    else onOpen?.(item)
  }
  const openDetail = () => {
    if (blocked()) return
    onOpen?.(item)
  }
  const openIdol = (idol) => {
    if (blocked()) return
    openJavIdol(idol)
  }

  return (
    <div
      {...gestureRest}
      onPointerDown={handlePointerDown}
      className={`select-none overflow-hidden rounded-card border bg-white text-left shadow-[0_1px_2px_rgba(15,23,42,0.05)] ${
        selected ? 'border-sky-400 ring-2 ring-sky-200' : 'border-[#e6e8ec]'
      }`}
    >
      <div className="relative aspect-[800/538] w-full overflow-hidden bg-zinc-200">
        {/* 封面 = 播放按钮：有本地文件时点封面直接播放第一个文件。 */}
        <button
          type="button"
          onClick={play}
          aria-label={canPlay ? zh('播放', 'Play') : zh('查看详情', 'View details')}
          className="absolute inset-0 block h-full w-full"
        >
          {!code || failed ? (
            <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-200 to-zinc-300 text-[11px] font-semibold text-white/80">
              {code || zh('无封面', 'No cover')}
            </span>
          ) : (
            <img
              src={`/jav/${encodeURIComponent(code)}/cover`}
              alt={item?.title || code}
              loading="lazy"
              decoding="async"
              onError={() => setFailed(true)}
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
        </button>
        {/* 角标压在封面按钮之上但不吃点击，点它们仍会落到封面上播放。 */}
        <span
          className={`pointer-events-none absolute left-1.5 top-1.5 max-w-[calc(100%-0.75rem)] truncate rounded bg-black/70 px-1.5 py-[1px] font-bold text-white ${
            compact ? 'text-[9px]' : 'text-[10px]'
          }`}
        >
          {code}
        </span>
        {/* 番号是 JAV 卡片的主标识，不能像视频卡那样被勾选圈顶掉，
            所以多选态的勾选圈放在右上角（那里本来就是空的）。 */}
        {selectionMode ? (
          <span
            className={`pointer-events-none absolute right-1.5 top-1.5 z-10 grid h-5 w-5 place-items-center rounded-full border-2 border-white shadow ${
              selected ? 'bg-sky-500' : 'bg-black/25'
            }`}
            aria-hidden="true"
          >
            {selected ? <Icon name="check" size={12} className="text-white" /> : null}
          </span>
        ) : null}
        {!compact && item?.favorite_rating > 0 ? (
          <span className="pointer-events-none absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1.5 py-[1px] text-[10px] font-bold text-white">
            ★ {Number(item.favorite_rating).toFixed(1)}
          </span>
        ) : null}
      </div>

      <div className={compact ? 'px-1.5 py-1.5' : 'px-2 pb-2.5 pt-2'}>
        {/* 标题 = 打开作品详情 */}
        <button
          type="button"
          onClick={openDetail}
          className={`block w-full text-left ${
            large
              ? 'text-[14px] font-semibold leading-[1.45] text-zinc-800 [overflow-wrap:anywhere]'
              : `line-clamp-2 font-semibold leading-[1.35] text-zinc-800 ${
                  compact ? 'text-[10.5px]' : 'text-xs'
                }`
          }`}
        >
          {item?.title || code}
        </button>

        {large ? (
          <>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
              {[
                formatReleaseDate(item?.release_unix),
                item?.duration_min ? `${item.duration_min} ${zh('分钟', 'min')}` : '',
                item?.studio?.name,
                prefs.hideSeries ? '' : item?.series?.name,
                item?.is_uncensored === true ? zh('无码', 'Uncensored') : '',
              ]
                .filter(Boolean)
                .map((value) => (
                  <span key={value} className="rounded bg-[#f1f2f5] px-[7px] py-[2px]">
                    {value}
                  </span>
                ))}
            </div>

            {idols.length ? (
              <div className="fade-clip mt-1.5 flex items-center gap-1.5 text-[11.5px] text-zinc-600">
                <span className="flex-none rounded bg-zinc-100 px-[5px] text-[10px] font-bold leading-[15px] text-zinc-400">
                  {zh('演员', 'Cast')}
                </span>
                <span className="flex min-w-0 items-center gap-1 overflow-hidden">
                  {idols.map((entry, index) => (
                    <button
                      key={entry.idol?.id ?? `${entry.name}-${index}`}
                      type="button"
                      onClick={() => openIdol(entry.idol)}
                      className="flex-none font-medium text-brand active:underline"
                    >
                      {index > 0 ? <span className="text-zinc-300">· </span> : null}
                      {entry.name}
                    </button>
                  ))}
                </span>
              </div>
            ) : null}

            {tags.length ? (
              <div className="fade-clip mt-1.5 flex h-[17px] items-center gap-1.5 overflow-hidden">
                <span className="flex-none rounded bg-zinc-100 px-[5px] text-[10px] font-bold leading-[15px] text-zinc-400">
                  {zh('标签', 'Tags')}
                </span>
                {tags.map((tag) => (
                  <span
                    key={tag.id ?? tag.name}
                    className="h-[15px] flex-none rounded bg-[#fdba74] px-[5px] text-[10px] font-bold leading-[15px] text-zinc-900"
                  >
                    {javTagDisplayName(tag, prefs.simplifiedTags)}
                  </span>
                ))}
              </div>
            ) : null}
          </>
        ) : null}

        {!compact && !large ? (
          <p className="mt-1 truncate text-[10.5px] text-zinc-400">
            {idols.map((entry, index) => (
              <span key={entry.idol?.id ?? `${entry.name}-${index}`}>
                {index > 0 ? <span className="text-zinc-300"> · </span> : null}
                <button
                  type="button"
                  onClick={() => openIdol(entry.idol)}
                  className="font-medium text-brand active:underline"
                >
                  {entry.name}
                </button>
              </span>
            ))}
            {idols.length && item?.studio?.name ? <span className="text-zinc-300"> · </span> : null}
            {item?.studio?.name ? <span>{item.studio.name}</span> : null}
            {!idols.length && !item?.studio?.name ? '—' : null}
          </p>
        ) : null}
      </div>
    </div>
  )
}
