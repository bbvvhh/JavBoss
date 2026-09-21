import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import SubtitlesRoundedIcon from '@mui/icons-material/SubtitlesRounded'

import {
  cancelSubtitleBatchDownload,
  fetchConfig,
  fetchSubtitleBatchStatus,
  startSubtitleBatchDownload,
  testSubtitleEndpoint,
  updateConfig,
} from '@/api'
import { getErrorMessage } from '@/utils/errors'
import { zh } from '@/utils/i18n'
import {
  DEFAULT_SUBTITLE_API_URL,
  formatSubtitleDuration,
  searchResultTitle,
  subtitleLanguageLabel,
} from '@/utils/subtitle'

const STATUS_POLL_MS = 1500

function Panel({ children }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      {children}
    </section>
  )
}

function PanelTitle({ title, hint }) {
  return (
    <div className="mb-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
        <SubtitlesRoundedIcon sx={{ fontSize: 18 }} className="text-zinc-400" />
        {title}
      </h3>
      {hint ? <p className="mt-1 text-xs leading-5 text-zinc-500">{hint}</p> : null}
    </div>
  )
}

function ProgressBar({ value, total }) {
  const percent = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100">
      <div
        className="h-full rounded-full bg-blue-600 transition-all"
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}

/** 设置里的「字幕」面板：配置搜索接口 + 一键下载所有 JAV 视频字幕。 */
export default function SubtitleSettingsPanel({ onToast }) {
  const [apiUrlInput, setApiUrlInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [configError, setConfigError] = useState('')
  const [testKeyword, setTestKeyword] = useState('ABP-001')
  const [testing, setTesting] = useState(false)
  const [testError, setTestError] = useState('')
  const [testResult, setTestResult] = useState(null)
  const [overwrite, setOverwrite] = useState(false)
  const [starting, setStarting] = useState(false)
  const [batchError, setBatchError] = useState('')
  const [status, setStatus] = useState(null)
  const pollRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    fetchConfig()
      .then((config) => {
        if (cancelled) return
        setApiUrlInput(String(config?.subtitle_api_url || DEFAULT_SUBTITLE_API_URL))
      })
      .catch((error) => {
        if (cancelled) return
        setConfigError(getErrorMessage(error))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const refreshStatus = useCallback(async () => {
    try {
      const next = await fetchSubtitleBatchStatus()
      setStatus(next)
      return next
    } catch (error) {
      setBatchError(getErrorMessage(error))
      return null
    }
  }, [])

  useEffect(() => {
    refreshStatus()
  }, [refreshStatus])

  const running = Boolean(status?.running)

  useEffect(() => {
    if (!running) {
      if (pollRef.current) {
        window.clearInterval(pollRef.current)
        pollRef.current = null
      }
      return undefined
    }
    if (pollRef.current) return undefined
    pollRef.current = window.setInterval(() => {
      refreshStatus()
    }, STATUS_POLL_MS)
    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [refreshStatus, running])

  const handleSaveApiUrl = useCallback(async () => {
    setSaving(true)
    setConfigError('')
    try {
      const value = apiUrlInput.trim()
      const config = await updateConfig({ subtitle_api_url: value })
      setApiUrlInput(String(config?.subtitle_api_url || value || DEFAULT_SUBTITLE_API_URL))
      onToast?.(zh('字幕接口已保存', 'Subtitle API saved'))
    } catch (error) {
      setConfigError(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }, [apiUrlInput, onToast])

  const handleTest = useCallback(async () => {
    setTesting(true)
    setTestError('')
    setTestResult(null)
    try {
      const data = await testSubtitleEndpoint({
        keyword: testKeyword.trim(),
        apiUrl: apiUrlInput.trim(),
      })
      setTestResult(data)
    } catch (error) {
      setTestError(getErrorMessage(error))
    } finally {
      setTesting(false)
    }
  }, [apiUrlInput, testKeyword])

  const handleStart = useCallback(async () => {
    setStarting(true)
    setBatchError('')
    try {
      const next = await startSubtitleBatchDownload({ overwrite })
      setStatus(next)
      onToast?.(zh('已开始批量下载字幕', 'Subtitle batch download started'))
    } catch (error) {
      setBatchError(getErrorMessage(error))
      refreshStatus()
    } finally {
      setStarting(false)
    }
  }, [onToast, overwrite, refreshStatus])

  const handleCancel = useCallback(async () => {
    setBatchError('')
    try {
      const next = await cancelSubtitleBatchDownload()
      setStatus(next)
      onToast?.(zh('已请求停止', 'Stop requested'))
    } catch (error) {
      setBatchError(getErrorMessage(error))
    }
  }, [onToast])

  const stageText = useMemo(() => {
    if (!status) return ''
    const stage = String(status.current_stage || '')
    const label =
      stage === 'searching'
        ? zh('搜索中', 'Searching')
        : stage === 'downloading'
          ? zh('下载中', 'Downloading')
          : stage === 'preparing'
            ? zh('准备中', 'Preparing')
            : stage === 'skipped'
              ? zh('跳过', 'Skipped')
              : ''
    const target = [status.current_code, status.current_file].filter(Boolean).join(' · ')
    return [label, target].filter(Boolean).join('：')
  }, [status])

  return (
    <div className="space-y-6">
      <Panel>
        <PanelTitle
          title={zh('字幕搜索接口', 'Subtitle search API')}
          hint={zh(
            '默认使用迅雷字幕接口。地址里的 {keyword} 会被替换成视频番号或你输入的关键词；也可以直接填一个不带占位符的地址。',
            'Uses the Xunlei subtitle endpoint by default. {keyword} is replaced with the video code or your own keyword; a URL without the placeholder also works.'
          )}
        />
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={apiUrlInput}
            onChange={(event) => setApiUrlInput(event.target.value)}
            spellCheck={false}
            className="min-w-[280px] flex-1 rounded border border-zinc-300 px-3 py-1.5 font-mono text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder={DEFAULT_SUBTITLE_API_URL}
          />
          <button
            type="button"
            onClick={handleSaveApiUrl}
            disabled={saving}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? zh('保存中…', 'Saving…') : zh('保存', 'Save')}
          </button>
          <button
            type="button"
            onClick={() => setApiUrlInput(DEFAULT_SUBTITLE_API_URL)}
            className="rounded border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 transition hover:bg-zinc-50"
          >
            {zh('恢复默认', 'Restore default')}
          </button>
        </div>
        {configError ? <p className="mt-2 text-xs text-red-600">{configError}</p> : null}

        <div className="mt-4 border-t border-zinc-100 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={testKeyword}
              onChange={(event) => setTestKeyword(event.target.value)}
              placeholder={zh('测试用番号', 'Test code')}
              className="w-40 rounded border border-zinc-300 px-3 py-1.5 text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={handleTest}
              disabled={testing || !testKeyword.trim()}
              className="rounded border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-60"
            >
              {testing ? zh('测试中…', 'Testing…') : zh('测试接口', 'Test endpoint')}
            </button>
            {testResult ? (
              <span className="text-xs text-zinc-500">
                {zh(`返回 ${testResult.total} 条结果`, `${testResult.total} result(s) returned`)}
              </span>
            ) : null}
          </div>
          {testError ? <p className="mt-2 text-xs text-red-600">{testError}</p> : null}
          {testResult?.items?.length ? (
            <ul className="mt-2 space-y-1">
              {testResult.items.slice(0, 5).map((item) => (
                <li
                  key={item.source_id || item.url}
                  className="truncate rounded bg-zinc-50 px-2 py-1 text-[11px] text-zinc-600"
                >
                  {searchResultTitle(item)} · {subtitleLanguageLabel(item)}
                  {formatSubtitleDuration(item.duration_ms)
                    ? ` · ${formatSubtitleDuration(item.duration_ms)}`
                    : ''}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Panel>

      <Panel>
        <PanelTitle
          title={zh('一键下载全部字幕', 'Download every subtitle')}
          hint={zh(
            '对媒体库里每一个已关联番号的视频搜索字幕，优先按文件名匹配，同名多份时取时长最接近的。下载后可在播放器里切换或删除。',
            'Searches a subtitle for every JAV-linked video. File names are matched first; among identical names the closest duration wins. Downloaded files can be switched or deleted in the player.'
          )}
        />
        <label className="mb-3 flex w-fit cursor-pointer items-center gap-2 text-xs text-zinc-600">
          <input
            type="checkbox"
            checked={overwrite}
            onChange={(event) => setOverwrite(event.target.checked)}
            disabled={running}
            className="h-3.5 w-3.5 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
          />
          {zh('覆盖已有字幕（默认跳过）', 'Re-download videos that already have subtitles')}
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleStart}
            disabled={running || starting}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700 disabled:opacity-60"
          >
            {running
              ? zh('下载中…', 'Running…')
              : starting
                ? zh('启动中…', 'Starting…')
                : zh('一键下载所有 JAV 视频字幕', 'Download all JAV subtitles')}
          </button>
          <button
            type="button"
            onClick={running ? handleCancel : refreshStatus}
            className="rounded border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 transition hover:bg-zinc-50"
          >
            {running ? zh('停止', 'Stop') : zh('刷新进度', 'Refresh progress')}
          </button>
        </div>
        {batchError ? <p className="mt-2 text-xs text-red-600">{batchError}</p> : null}

        {status ? (
          <div className="mt-4 space-y-2">
            <ProgressBar value={status.processed} total={status.total} />
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600">
              <span>
                {zh('进度', 'Progress')}: {status.processed}/{status.total}
              </span>
              <span className="text-emerald-600">
                {zh('成功', 'Saved')} {status.succeeded}
              </span>
              <span>
                {zh('跳过', 'Skipped')} {status.skipped}
              </span>
              <span className={status.failed > 0 ? 'text-red-600' : ''}>
                {zh('失败', 'Failed')} {status.failed}
              </span>
              <span className="text-zinc-400">
                {running
                  ? zh('进行中', 'Running')
                  : status.message === 'canceled'
                    ? zh('已停止', 'Stopped')
                    : status.total > 0
                      ? zh('已完成', 'Finished')
                      : zh('空闲', 'Idle')}
              </span>
            </div>
            {stageText ? <p className="truncate text-[11px] text-zinc-500">{stageText}</p> : null}
            {status.errors?.length ? (
              <details className="text-[11px] text-zinc-500">
                <summary className="cursor-pointer">
                  {zh(`失败详情（${status.errors.length}）`, `Failures (${status.errors.length})`)}
                </summary>
                <ul className="mt-1 space-y-1">
                  {status.errors.map((item, index) => (
                    <li key={`${index}-${item}`} className="truncate" title={item}>
                      {item}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : null}
      </Panel>
    </div>
  )
}
