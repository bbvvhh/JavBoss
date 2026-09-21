import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  deleteVideoSubtitle,
  downloadVideoSubtitle,
  fetchVideoSubtitles,
  searchVideoSubtitles,
} from '@/api'
import ConfirmDialog from '@/components/ConfirmDialog'
import Icon from '@/components/Icons'
import { getErrorMessage } from '@/utils/errors'
import { zh } from '@/utils/i18n'
import {
  describeSubtitleMatch,
  formatSubtitleDuration,
  searchResultTitle,
  subtitleDisplayName,
  subtitleLanguageLabel,
} from '@/utils/subtitle'

function GroupTitle({ children, hint }) {
  return (
    <div className="mb-2 flex items-baseline gap-2 px-0.5">
      <h4 className="text-[12px] font-semibold text-zinc-500">{children}</h4>
      {hint ? <span className="text-[11px] text-zinc-400">{hint}</span> : null}
    </div>
  )
}

function MetaText({ parts }) {
  const text = parts.filter(Boolean).join(' · ')
  if (!text) return null
  return <div className="mt-0.5 truncate text-[11px] text-zinc-400">{text}</div>
}

/**
 * 播放器里的「在线字幕」抽屉内容。
 *
 * 字幕列表由 PlayerPage 持有（它负责把字幕挂到 video.js 上），这里只做
 * 拉取 / 搜索 / 下载 / 删除，并通过回调把最新列表交回去。
 */
export default function SubtitleSheet({
  video,
  defaultKeyword = '',
  subtitles = [],
  loading = false,
  activeSubtitleId = null,
  onSelectSubtitle,
  onSubtitlesChange,
  onToast,
}) {
  const [keyword, setKeyword] = useState(defaultKeyword)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [searchItems, setSearchItems] = useState(null)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [busyKey, setBusyKey] = useState('')
  const [actionError, setActionError] = useState('')
  const [pendingDelete, setPendingDelete] = useState(null)

  // 番号来自 jav 表，可能比抽屉晚一步拿到（列表接口返回 jav_code）。
  // 只在用户还没输入时补进搜索框，绝不覆盖已经敲进去的内容。
  useEffect(() => {
    const fallback = String(defaultKeyword || '').trim()
    setKeyword((current) => (String(current).trim() ? current : fallback))
  }, [defaultKeyword])

  const videoId = video?.id || 0
  const videoDurationText = formatSubtitleDuration((video?.duration_sec || 0) * 1000)
  const downloadedSources = useMemo(
    () => new Set(subtitles.map((item) => item.source_id).filter(Boolean)),
    [subtitles]
  )

  const runSearch = useCallback(async () => {
    if (!videoId || searching) return
    setSearching(true)
    setSearchError('')
    setActionError('')
    try {
      // 关键词留空时由服务端用 jav 表的番号兜底，所以这里永远可以点搜索。
      const data = await searchVideoSubtitles(videoId, String(keyword).trim())
      const resolved = String(data?.keyword || '').trim()
      setSearchItems(Array.isArray(data?.items) ? data.items : [])
      setSearchKeyword(resolved || String(keyword).trim())
      // 把服务端实际使用的番号回填到输入框：即使本地拿不到番号，
      // 搜过一次之后也能看到到底搜的是什么。
      if (resolved) setKeyword((current) => (String(current).trim() ? current : resolved))
    } catch (error) {
      setSearchItems(null)
      setSearchError(getErrorMessage(error))
    } finally {
      setSearching(false)
    }
  }, [keyword, searching, videoId])

  const download = useCallback(
    async (item) => {
      if (!videoId || !item || busyKey) return
      setBusyKey(item.source_id || item.url)
      setActionError('')
      try {
        const data = await downloadVideoSubtitle(videoId, {
          url: item.url,
          name: item.name,
          ext: item.ext,
          language: item.language,
          duration_ms: item.duration_ms,
          source_id: item.source_id,
        })
        const fresh = await fetchVideoSubtitles(videoId)
        onSubtitlesChange?.(fresh.items)
        if (data?.subtitle) onSelectSubtitle?.(data.subtitle.id)
        onToast?.(
          data?.already_downloaded
            ? zh('该字幕已下载，已自动加载', 'Already downloaded; loaded now')
            : zh('字幕已下载并自动加载', 'Subtitle downloaded and loaded')
        )
      } catch (error) {
        setActionError(getErrorMessage(error))
      } finally {
        setBusyKey('')
      }
    },
    [busyKey, onSelectSubtitle, onSubtitlesChange, onToast, videoId]
  )

  const confirmDelete = useCallback(async () => {
    const item = pendingDelete
    if (!videoId || !item) return
    setBusyKey(`delete-${item.id}`)
    setActionError('')
    try {
      await deleteVideoSubtitle(videoId, item.id)
      const fresh = await fetchVideoSubtitles(videoId)
      onSubtitlesChange?.(fresh.items)
      if (activeSubtitleId === item.id) onSelectSubtitle?.(null)
      onToast?.(zh('字幕已删除', 'Subtitle deleted'))
      setPendingDelete(null)
    } catch (error) {
      setActionError(getErrorMessage(error))
    } finally {
      setBusyKey('')
    }
  }, [activeSubtitleId, onSelectSubtitle, onSubtitlesChange, onToast, pendingDelete, videoId])

  return (
    <div className="pb-2">
      {actionError ? (
        <div className="mb-3 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-[12px] leading-relaxed text-red-700">
          {actionError}
        </div>
      ) : null}

      <GroupTitle
        hint={
          videoDurationText ? zh(`视频 ${videoDurationText}`, `Video ${videoDurationText}`) : ''
        }
      >
        {zh(`本地字幕（${subtitles.length}）`, `Local subtitles (${subtitles.length})`)}
      </GroupTitle>

      <div className="space-y-1.5">
        <button
          type="button"
          onClick={() => onSelectSubtitle?.(null)}
          className={`flex w-full items-center gap-2 rounded-[10px] px-3 py-2.5 text-left text-[13px] ${
            activeSubtitleId ? 'bg-white text-zinc-700' : 'bg-brand-soft text-brand-ink'
          }`}
        >
          <Icon name="ban" size={16} className="flex-none text-zinc-400" />
          <span className="flex-1 font-medium">{zh('关闭字幕', 'No subtitles')}</span>
          {activeSubtitleId ? null : <Icon name="check" size={16} className="flex-none" />}
        </button>

        {loading ? (
          <div className="flex items-center gap-2 rounded-[10px] bg-white px-3 py-2.5 text-[12px] text-zinc-400">
            <Icon name="refresh" size={15} className="spin" />
            {zh('加载字幕列表…', 'Loading subtitles…')}
          </div>
        ) : null}

        {!loading && subtitles.length === 0 ? (
          <p className="px-1 py-1.5 text-[12px] text-zinc-400">
            {zh('还没有下载字幕，可在下面搜索', 'No subtitles yet — search below')}
          </p>
        ) : null}

        {subtitles.map((item) => {
          const active = item.id === activeSubtitleId
          const deleting = busyKey === `delete-${item.id}`
          return (
            <div
              key={item.id}
              className={`flex items-center gap-2 rounded-[10px] px-3 py-2.5 ${
                active ? 'bg-brand-soft' : 'bg-white'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectSubtitle?.(item.id)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-zinc-800">
                    {subtitleDisplayName(item)}
                  </span>
                  {item.auto ? (
                    <span className="flex-none rounded bg-zinc-100 px-1 text-[10px] text-zinc-500">
                      {zh('批量', 'Batch')}
                    </span>
                  ) : null}
                </div>
                <MetaText
                  parts={[
                    subtitleLanguageLabel(item),
                    String(item.format || '').toUpperCase(),
                    formatSubtitleDuration(item.duration_ms),
                    active ? zh('已加载', 'Loaded') : '',
                  ]}
                />
              </button>
              <button
                type="button"
                onClick={() => setPendingDelete(item)}
                disabled={deleting}
                aria-label={zh('删除字幕', 'Delete subtitle')}
                className="grid h-8 w-8 flex-none place-items-center rounded-[9px] text-zinc-400 active:bg-red-50 active:text-red-600 disabled:opacity-40"
              >
                <Icon name="trash" size={16} />
              </button>
            </div>
          )
        })}
      </div>

      <div className="mt-4">
        <GroupTitle>{zh('在线搜索', 'Search online')}</GroupTitle>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') runSearch()
            }}
            placeholder={zh('视频番号，如 ABP-001', 'Video code, e.g. ABP-001')}
            autoComplete="off"
            className="min-w-0 flex-1 rounded-[10px] border border-[#e3e5ea] bg-white px-3 py-2 text-[16px] leading-snug outline-none placeholder:text-zinc-300 focus:border-brand-line focus:ring-2 focus:ring-brand-soft"
          />
          <button
            type="button"
            onClick={runSearch}
            disabled={searching}
            className="flex h-[42px] flex-none items-center gap-1.5 rounded-[10px] px-3.5 text-[13.5px] font-medium text-white bg-brand active:opacity-80 disabled:opacity-40"
          >
            <Icon name="search" size={16} />
            {searching ? zh('搜索中', 'Searching') : zh('搜索', 'Search')}
          </button>
        </div>
        {defaultKeyword ? null : (
          <p className="mt-1.5 px-1 text-[11.5px] leading-relaxed text-amber-600">
            {zh(
              '未自动识别到番号：直接点搜索会按服务端记录的番号查找，也可以手动输入关键词',
              'No JAV code detected — searching still uses the code stored on the server, or type a keyword'
            )}
          </p>
        )}

        {searchError ? (
          <div className="mt-2.5 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-[12px] leading-relaxed text-red-700">
            {searchError}
          </div>
        ) : null}

        {searchItems ? (
          searchItems.length === 0 ? (
            <p className="mt-2.5 px-1 text-[12px] text-zinc-400">
              {zh(
                `没有找到「${searchKeyword}」的字幕`,
                `No subtitles found for "${searchKeyword}"`
              )}
            </p>
          ) : (
            <div className="mt-2 space-y-1.5">
              {searchItems.map((item) => {
                const sourceKey = item.source_id || item.url
                const downloaded = Boolean(item.downloaded) || downloadedSources.has(item.source_id)
                const busy = busyKey === sourceKey
                return (
                  <div
                    key={sourceKey}
                    className={`flex items-center gap-2 rounded-[10px] px-3 py-2.5 ${
                      item.recommended ? 'bg-brand-soft' : 'bg-white'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-zinc-800">
                          {searchResultTitle(item)}
                        </span>
                        {item.recommended ? (
                          <span className="flex-none rounded bg-brand px-1 text-[10px] text-white">
                            {zh('推荐', 'Best')}
                          </span>
                        ) : null}
                      </div>
                      <MetaText
                        parts={[
                          subtitleLanguageLabel(item),
                          String(item.ext || '').toUpperCase(),
                          formatSubtitleDuration(item.duration_ms),
                          describeSubtitleMatch(item),
                        ]}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => download(item)}
                      disabled={busy}
                      className={`flex h-9 flex-none items-center gap-1.5 rounded-[9px] px-2.5 text-[12.5px] font-medium active:opacity-70 disabled:opacity-40 ${
                        downloaded ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-900 text-white'
                      }`}
                    >
                      <Icon name={downloaded ? 'check' : 'download'} size={15} />
                      {busy
                        ? zh('下载中', 'Working')
                        : downloaded
                          ? zh('已下载', 'Downloaded')
                          : zh('下载', 'Download')}
                    </button>
                  </div>
                )
              })}
            </div>
          )
        ) : null}
      </div>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={zh('删除这个字幕？', 'Delete this subtitle?')}
        description={zh(
          '只删除 JavBoss 下载到 data/subtitle 目录的字幕文件，不会动你的视频。',
          'Only the file JavBoss downloaded into data/subtitle is removed. Your videos are untouched.'
        )}
        items={pendingDelete ? [subtitleDisplayName(pendingDelete)] : []}
        confirmText={zh('删除', 'Delete')}
        busy={Boolean(busyKey)}
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  )
}
