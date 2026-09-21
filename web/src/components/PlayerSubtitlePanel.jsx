import { useCallback, useEffect, useMemo, useState } from 'react'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import CloudDownloadRoundedIcon from '@mui/icons-material/CloudDownloadRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import SubtitlesRoundedIcon from '@mui/icons-material/SubtitlesRounded'

import {
  deleteVideoSubtitle,
  downloadVideoSubtitle,
  fetchVideoSubtitles,
  searchVideoSubtitles,
} from '@/api'
import { getErrorMessage } from '@/utils/errors'
import { zh } from '@/utils/i18n'
import {
  describeSubtitleMatch,
  formatSubtitleDuration,
  searchResultTitle,
  subtitleDisplayName,
  subtitleLanguageLabel,
} from '@/utils/subtitle'

function SectionTitle({ children, count }) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
      <span>{children}</span>
      {count != null ? (
        <span className="rounded bg-zinc-100 px-1.5 text-[10px] text-zinc-500">{count}</span>
      ) : null}
    </div>
  )
}

function MetaLine({ parts }) {
  const text = parts.filter(Boolean).join(' · ')
  if (!text) return null
  return <div className="mt-0.5 truncate text-[11px] text-zinc-500">{text}</div>
}

/**
 * 播放器内的「在线字幕」面板：本地字幕的加载/删除 + 在线搜索与下载。
 *
 * 字幕列表由 PlayerModal 持有（它负责真正把字幕挂到 video.js 上），
 * 本组件只负责拉取、搜索、下载与删除，然后通过回调把最新列表交回去。
 */
export default function PlayerSubtitlePanel({
  video,
  defaultKeyword = '',
  subtitles = [],
  loading = false,
  activeSubtitleId = null,
  onSelectSubtitle,
  onSubtitlesChange,
  onClose,
}) {
  const [listError, setListError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [keyword, setKeyword] = useState(defaultKeyword)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [searchItems, setSearchItems] = useState(null)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [downloadingSource, setDownloadingSource] = useState('')
  const [downloadError, setDownloadError] = useState('')
  const [deletingId, setDeletingId] = useState(0)
  const [confirmDeleteId, setConfirmDeleteId] = useState(0)
  const [notice, setNotice] = useState('')

  const videoId = video?.id || 0
  const downloadedSources = useMemo(
    () => new Set(subtitles.map((item) => item.source_id).filter(Boolean)),
    [subtitles]
  )
  const videoDurationText = formatSubtitleDuration((video?.duration_sec || 0) * 1000)

  // 番号来自 jav 表，可能比面板晚一步拿到（列表接口返回 jav_code）。
  // 只在用户还没输入时补进搜索框，绝不覆盖已经敲进去的内容。
  useEffect(() => {
    const fallback = String(defaultKeyword || '').trim()
    setKeyword((current) => (String(current).trim() ? current : fallback))
  }, [defaultKeyword])

  const refresh = useCallback(async () => {
    if (!videoId) return
    setRefreshing(true)
    setListError('')
    try {
      const data = await fetchVideoSubtitles(videoId)
      onSubtitlesChange?.(data.items)
    } catch (error) {
      setListError(getErrorMessage(error))
    } finally {
      setRefreshing(false)
    }
  }, [onSubtitlesChange, videoId])

  const runSearch = useCallback(async () => {
    if (!videoId || searching) return
    setSearching(true)
    setSearchError('')
    setDownloadError('')
    setNotice('')
    try {
      // 关键词留空时由服务端用 jav 表的番号兜底，所以这里永远可以点搜索。
      const data = await searchVideoSubtitles(videoId, keyword.trim())
      const resolved = String(data?.keyword || '').trim()
      setSearchItems(Array.isArray(data?.items) ? data.items : [])
      setSearchKeyword(resolved || String(keyword).trim())
      // 把服务端实际使用的番号回填到输入框：这样即使本地拿不到番号，
      // 搜过一次之后用户也能看到到底搜的是什么。
      if (resolved) setKeyword((current) => (String(current).trim() ? current : resolved))
    } catch (error) {
      setSearchItems(null)
      setSearchError(getErrorMessage(error))
    } finally {
      setSearching(false)
    }
  }, [keyword, searching, videoId])

  const handleDownload = useCallback(
    async (item) => {
      if (!videoId || !item) return
      setDownloadingSource(item.source_id || item.url)
      setDownloadError('')
      setNotice('')
      try {
        const data = await downloadVideoSubtitle(videoId, {
          url: item.url,
          name: item.name,
          ext: item.ext,
          language: item.language,
          duration_ms: item.duration_ms,
          source_id: item.source_id,
        })
        const subtitle = data?.subtitle || null
        if (subtitle) {
          const data2 = await fetchVideoSubtitles(videoId)
          onSubtitlesChange?.(data2.items)
          onSelectSubtitle?.(subtitle.id)
          setNotice(
            data?.already_downloaded
              ? zh('该字幕已下载，已自动加载', 'Already downloaded; loaded now')
              : zh('字幕已下载并自动加载', 'Subtitle downloaded and loaded')
          )
        }
      } catch (error) {
        setDownloadError(getErrorMessage(error))
      } finally {
        setDownloadingSource('')
      }
    },
    [onSelectSubtitle, onSubtitlesChange, videoId]
  )

  const handleDelete = useCallback(
    async (item) => {
      if (!videoId || !item) return
      if (confirmDeleteId !== item.id) {
        setConfirmDeleteId(item.id)
        return
      }
      setDeletingId(item.id)
      setListError('')
      setNotice('')
      try {
        await deleteVideoSubtitle(videoId, item.id)
        const data = await fetchVideoSubtitles(videoId)
        onSubtitlesChange?.(data.items)
        if (activeSubtitleId === item.id) onSelectSubtitle?.(null)
        setNotice(zh('字幕已删除', 'Subtitle deleted'))
      } catch (error) {
        setListError(getErrorMessage(error))
      } finally {
        setDeletingId(0)
        setConfirmDeleteId(0)
      }
    },
    [activeSubtitleId, confirmDeleteId, onSelectSubtitle, onSubtitlesChange, videoId]
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <header className="flex flex-none items-center gap-2 border-b border-zinc-200 px-3 py-2">
        <SubtitlesRoundedIcon sx={{ fontSize: 18 }} className="text-zinc-500" />
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-800">
          {zh('在线字幕', 'Online subtitles')}
        </h3>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          aria-label={zh('刷新本地字幕', 'Refresh local subtitles')}
          title={zh('刷新本地字幕', 'Refresh local subtitles')}
          className="inline-flex h-6 w-6 items-center justify-center rounded text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-50"
        >
          <RefreshRoundedIcon className={refreshing ? 'animate-spin' : ''} sx={{ fontSize: 16 }} />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={zh('关闭字幕面板', 'Close subtitle panel')}
          title={zh('关闭字幕面板', 'Close subtitle panel')}
          className="inline-flex h-6 w-6 items-center justify-center rounded text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800"
        >
          <CloseRoundedIcon sx={{ fontSize: 16 }} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
        {notice ? (
          <div className="mb-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] text-emerald-700">
            {notice}
          </div>
        ) : null}
        {listError ? (
          <div className="mb-2 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
            {listError}
          </div>
        ) : null}

        <SectionTitle count={subtitles.length}>{zh('本地字幕', 'Local subtitles')}</SectionTitle>
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => onSelectSubtitle?.(null)}
            className={`flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left text-xs transition ${
              activeSubtitleId ? 'border-zinc-200 hover:bg-zinc-50' : 'border-blue-500 bg-blue-50'
            }`}
          >
            <span className="min-w-0 flex-1 truncate font-medium">
              {zh('关闭字幕', 'No subtitles')}
            </span>
          </button>

          {loading ? (
            <div className="px-1 py-2 text-[11px] text-zinc-500">
              {zh('加载字幕列表…', 'Loading subtitles…')}
            </div>
          ) : null}

          {!loading && subtitles.length === 0 ? (
            <div className="px-1 py-2 text-[11px] text-zinc-500">
              {zh('还没有下载字幕', 'No subtitles downloaded yet')}
            </div>
          ) : null}

          {subtitles.map((item) => {
            const active = item.id === activeSubtitleId
            return (
              <div
                key={item.id}
                className={`flex items-start gap-1.5 rounded border px-2 py-1.5 transition ${
                  active ? 'border-blue-500 bg-blue-50' : 'border-zinc-200 hover:bg-zinc-50'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectSubtitle?.(item.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex items-center gap-1">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">
                      {subtitleDisplayName(item)}
                    </span>
                    {item.auto ? (
                      <span className="flex-none rounded bg-zinc-200 px-1 text-[10px] text-zinc-600">
                        {zh('批量', 'Batch')}
                      </span>
                    ) : null}
                  </div>
                  <MetaLine
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
                  onClick={() => handleDelete(item)}
                  disabled={deletingId === item.id}
                  aria-label={zh('删除字幕', 'Delete subtitle')}
                  title={
                    confirmDeleteId === item.id
                      ? zh('再点一次确认删除', 'Click again to confirm')
                      : zh('删除字幕', 'Delete subtitle')
                  }
                  className={`inline-flex h-6 flex-none items-center justify-center gap-1 rounded px-1.5 text-[10px] transition disabled:opacity-50 ${
                    confirmDeleteId === item.id
                      ? 'bg-red-600 text-white hover:bg-red-700'
                      : 'text-zinc-400 hover:bg-red-50 hover:text-red-600'
                  }`}
                >
                  <DeleteOutlineRoundedIcon sx={{ fontSize: 15 }} />
                  {confirmDeleteId === item.id ? zh('确认', 'Confirm') : null}
                </button>
              </div>
            )
          })}
        </div>

        <div className="mt-3 border-t border-zinc-200 pt-2.5">
          <SectionTitle>{zh('在线搜索', 'Search online')}</SectionTitle>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  runSearch()
                }
              }}
              placeholder={zh('视频番号，如 ABP-001', 'Video code, e.g. ABP-001')}
              className="min-w-0 flex-1 rounded border border-zinc-300 px-2 py-1 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={runSearch}
              disabled={searching}
              className="inline-flex flex-none items-center gap-1 rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white transition hover:bg-blue-700 disabled:opacity-60"
            >
              <SearchRoundedIcon sx={{ fontSize: 15 }} />
              {searching ? zh('搜索中…', 'Searching…') : zh('搜索', 'Search')}
            </button>
          </div>
          {!defaultKeyword ? (
            <div className="mt-1 text-[11px] text-amber-600">
              {zh(
                '未自动识别到番号：直接点搜索会按服务端记录的番号查找，也可以手动输入关键词',
                'No JAV code detected — searching still uses the code stored on the server, or type a keyword'
              )}
            </div>
          ) : null}
          {videoDurationText ? (
            <div className="mt-1 text-[11px] text-zinc-500">
              {zh(`视频时长 ${videoDurationText}`, `Video length ${videoDurationText}`)}
            </div>
          ) : null}

          {searchError ? (
            <div className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
              {searchError}
            </div>
          ) : null}
          {downloadError ? (
            <div className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
              {downloadError}
            </div>
          ) : null}

          {searchItems ? (
            searchItems.length === 0 ? (
              <div className="mt-2 text-[11px] text-zinc-500">
                {zh(
                  `没有找到「${searchKeyword}」的字幕`,
                  `No subtitles found for "${searchKeyword}"`
                )}
              </div>
            ) : (
              <div className="mt-2 space-y-1">
                {searchItems.map((item) => {
                  const sourceKey = item.source_id || item.url
                  const downloaded =
                    Boolean(item.downloaded) || downloadedSources.has(item.source_id)
                  const busy = downloadingSource === sourceKey
                  return (
                    <div
                      key={sourceKey}
                      className={`flex items-start gap-1.5 rounded border px-2 py-1.5 ${
                        item.recommended ? 'border-blue-400 bg-blue-50/60' : 'border-zinc-200'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1">
                          <span className="min-w-0 flex-1 truncate text-xs font-medium">
                            {searchResultTitle(item)}
                          </span>
                          {item.recommended ? (
                            <span className="flex-none rounded bg-blue-600 px-1 text-[10px] text-white">
                              {zh('推荐', 'Best')}
                            </span>
                          ) : null}
                        </div>
                        <MetaLine
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
                        onClick={() => handleDownload(item)}
                        disabled={busy}
                        className={`inline-flex flex-none items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition disabled:opacity-60 ${
                          downloaded
                            ? 'border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            : 'bg-zinc-800 text-white hover:bg-zinc-900'
                        }`}
                      >
                        <CloudDownloadRoundedIcon sx={{ fontSize: 14 }} />
                        {busy
                          ? zh('下载中…', 'Downloading…')
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
      </div>
    </div>
  )
}
