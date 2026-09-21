import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  cancelSubtitleBatchDownload,
  fetchConfig,
  fetchSubtitleBatchStatus,
  startSubtitleBatchDownload,
  testSubtitleEndpoint,
  updateConfig,
} from '@/api'
import Icon from '@/components/Icons'
import SettingsPage from '@/components/settings/SettingsPage'
import Switch from '@/components/form/Switch'
import { FormCard, FormRow, InfoRow, buttonClass } from '@/components/form/Field'
import TextField from '@/components/form/TextField'
import useAsyncData from '@/hooks/useAsyncData'
import { useStore } from '@/store'
import { getErrorMessage } from '@/utils/errors'
import { zh } from '@/utils/i18n'
import {
  DEFAULT_SUBTITLE_API_URL,
  formatSubtitleDuration,
  searchResultTitle,
  subtitleLanguageLabel,
} from '@/utils/subtitle'

const STATUS_POLL_MS = 1500

/**
 * 字幕设置页：配置在线字幕接口地址 + 一键下载所有 JAV 视频字幕。
 *
 * 批量下载跑在服务端后台，这里只轮询状态；关闭页面不会中断任务。
 */
export default function SubtitlePage({ onClose }) {
  const showToast = useStore((state) => state.showToast)

  const { data, loading, error, reload } = useAsyncData(() => fetchConfig(), [])
  const [apiUrl, setApiUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState('')
  const [testKeyword, setTestKeyword] = useState('ABP-001')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [testError, setTestError] = useState('')
  const [overwrite, setOverwrite] = useState(false)
  const [starting, setStarting] = useState(false)
  const [status, setStatus] = useState(null)
  const pollRef = useRef(null)

  useEffect(() => {
    if (data) setApiUrl(String(data?.subtitle_api_url || DEFAULT_SUBTITLE_API_URL))
  }, [data])

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await fetchSubtitleBatchStatus())
    } catch (err) {
      setActionError(getErrorMessage(err))
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
    pollRef.current = window.setInterval(refreshStatus, STATUS_POLL_MS)
    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [refreshStatus, running])

  const save = async () => {
    setSaving(true)
    setActionError('')
    try {
      const config = await updateConfig({ subtitle_api_url: apiUrl.trim() })
      setApiUrl(String(config?.subtitle_api_url || apiUrl.trim() || DEFAULT_SUBTITLE_API_URL))
      showToast(zh('字幕接口已保存', 'Subtitle API saved'))
    } catch (err) {
      setActionError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    setTesting(true)
    setTestError('')
    setTestResult(null)
    try {
      setTestResult(
        await testSubtitleEndpoint({ keyword: testKeyword.trim(), apiUrl: apiUrl.trim() })
      )
    } catch (err) {
      setTestError(getErrorMessage(err))
    } finally {
      setTesting(false)
    }
  }

  const start = async () => {
    setStarting(true)
    setActionError('')
    try {
      setStatus(await startSubtitleBatchDownload({ overwrite }))
      showToast(zh('已开始批量下载字幕', 'Subtitle batch download started'))
    } catch (err) {
      setActionError(getErrorMessage(err))
      refreshStatus()
    } finally {
      setStarting(false)
    }
  }

  const stop = async () => {
    setActionError('')
    try {
      setStatus(await cancelSubtitleBatchDownload())
      showToast(zh('已请求停止', 'Stop requested'))
    } catch (err) {
      setActionError(getErrorMessage(err))
    }
  }

  const percent = useMemo(() => {
    if (!status?.total) return 0
    return Math.min(100, Math.round((Number(status.processed || 0) / status.total) * 100))
  }, [status])

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
    <SettingsPage
      title={zh('字幕', 'Subtitles')}
      subtitle={zh('在线搜索与一键下载', 'Search and batch download')}
      onBack={onClose}
      loading={loading}
      error={error}
      onRetry={reload}
    >
      {actionError ? (
        <div className="mx-3 mt-3 rounded-card border border-red-200 bg-red-50 px-3.5 py-3 text-[12.5px] leading-relaxed text-red-700">
          {actionError}
        </div>
      ) : null}

      <FormCard className="mt-3" padded>
        <TextField
          label={zh('字幕搜索接口', 'Subtitle search API')}
          hint={zh(
            '默认使用迅雷字幕接口。地址里的 {keyword} 会被替换成视频番号或你输入的关键词。',
            'Uses the Xunlei subtitle endpoint by default. {keyword} is replaced with the video code or your keyword.'
          )}
          value={apiUrl}
          onChange={setApiUrl}
          mono
          placeholder={DEFAULT_SUBTITLE_API_URL}
          autoComplete="off"
        />
        <div className="mt-3 flex gap-2.5">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className={buttonClass('primary', 'h-10 flex-1')}
          >
            {saving ? zh('保存中…', 'Saving…') : zh('保存', 'Save')}
          </button>
          <button
            type="button"
            onClick={() => setApiUrl(DEFAULT_SUBTITLE_API_URL)}
            className={buttonClass('secondary', 'h-10 flex-1')}
          >
            {zh('恢复默认', 'Restore default')}
          </button>
        </div>
      </FormCard>

      <FormCard className="mt-3" padded>
        <TextField
          label={zh('测试接口', 'Test endpoint')}
          hint={zh('用一个番号试搜一次，确认地址可用。', 'Try one code to verify the endpoint.')}
          value={testKeyword}
          onChange={setTestKeyword}
          placeholder={zh('例如 ABP-001', 'e.g. ABP-001')}
          autoComplete="off"
        />
        <button
          type="button"
          onClick={test}
          disabled={testing || !testKeyword.trim()}
          className={buttonClass('secondary', 'mt-3 h-10 w-full')}
        >
          <Icon name="search" size={16} />
          {testing ? zh('测试中…', 'Testing…') : zh('测试', 'Test')}
        </button>
        {testError ? <p className="mt-2 text-[12px] text-red-600">{testError}</p> : null}
        {testResult ? (
          <div className="mt-3">
            <p className="text-[12px] text-zinc-500">
              {zh(`返回 ${testResult.total} 条结果`, `${testResult.total} result(s)`)}
            </p>
            <ul className="mt-1.5 space-y-1">
              {(testResult.items || []).slice(0, 5).map((item) => (
                <li
                  key={item.source_id || item.url}
                  className="truncate rounded-[8px] bg-zinc-50 px-2.5 py-1.5 text-[11.5px] text-zinc-600"
                >
                  {searchResultTitle(item)} · {subtitleLanguageLabel(item)}
                  {formatSubtitleDuration(item.duration_ms)
                    ? ` · ${formatSubtitleDuration(item.duration_ms)}`
                    : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </FormCard>

      <FormCard className="mt-3">
        <FormRow
          label={zh('覆盖已有字幕', 'Re-download existing subtitles')}
          hint={zh(
            '默认跳过已经有字幕的视频。',
            'Videos that already own a subtitle are skipped by default.'
          )}
          layout="inline"
          control={
            <Switch
              checked={overwrite}
              disabled={running}
              label={zh('覆盖已有字幕', 'Re-download existing subtitles')}
              onChange={setOverwrite}
            />
          }
        />
        {status ? (
          <>
            <InfoRow
              label={zh('进度', 'Progress')}
              value={`${status.processed || 0}/${status.total || 0}`}
            />
            <InfoRow label={zh('成功', 'Saved')} value={String(status.succeeded || 0)} />
            <InfoRow label={zh('跳过', 'Skipped')} value={String(status.skipped || 0)} />
            <InfoRow label={zh('失败', 'Failed')} value={String(status.failed || 0)} />
          </>
        ) : null}
      </FormCard>

      {status && (running || status.total > 0) ? (
        <div className="mx-3 mt-3">
          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200">
            <div
              className="h-full rounded-full bg-brand transition-all"
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-zinc-500">
            {running
              ? stageText || zh('进行中…', 'Running…')
              : status.message === 'canceled'
                ? zh('已停止', 'Stopped')
                : zh('已完成', 'Finished')}
          </p>
          {status.errors?.length ? (
            <ul className="mt-1 space-y-1">
              {status.errors.slice(-5).map((item, index) => (
                <li
                  key={`${index}-${item}`}
                  className="truncate text-[11px] text-red-500"
                  title={item}
                >
                  {item}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="mx-3 mt-4 flex gap-2.5">
        <button
          type="button"
          onClick={start}
          disabled={running || starting}
          className={buttonClass('primary', 'h-11 flex-1')}
        >
          <Icon name="download" size={16} />
          {running
            ? zh('下载中…', 'Running…')
            : starting
              ? zh('启动中…', 'Starting…')
              : zh('一键下载所有 JAV 视频字幕', 'Download all JAV subtitles')}
        </button>
        {running ? (
          <button type="button" onClick={stop} className={buttonClass('danger', 'h-11 px-4')}>
            {zh('停止', 'Stop')}
          </button>
        ) : (
          <button
            type="button"
            onClick={refreshStatus}
            className={buttonClass('secondary', 'h-11 px-4')}
          >
            {zh('刷新', 'Refresh')}
          </button>
        )}
      </div>

      <p className="px-5 pb-2 pt-3 text-[11px] leading-relaxed text-zinc-400">
        {zh(
          '单个视频的番号搜索优先匹配文件名，同名多份时取时长最接近的。下载的字幕保存在服务端 data/subtitle 目录，可在播放器里切换或删除。',
          'Matching prefers the file name; among identical names the closest duration wins. Files live in the server’s data/subtitle directory and can be switched or deleted from the player.'
        )}
      </p>
    </SettingsPage>
  )
}
