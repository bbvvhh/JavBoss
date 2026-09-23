import { useEffect, useState } from 'react'

import { browseDirectories, browseStorageDirectories } from '@/api'
import Icon from '@/components/Icons'
import { buttonClass } from '@/components/form/Field'
import { zh } from '@/utils/i18n'

/**
 * 服务端目录选择器。
 *
 * 关键认知：它浏览的是**服务端所在电脑**的文件系统，不是手机。界面上必须说清楚，
 * 否则用户会以为在选自己手机里的文件夹。
 *
 * 本地与远程（WebDAV）返回的是同一种结构 {path,parent,home,roots,directories}，
 * 所以一套 UI 同时服务两者。
 */
export default function DirectoryPicker({
  open,
  mode = 'local',
  connectionId = null,
  title,
  onSelect,
  onClose,
  extraAction = null,
  remoteHint = '',
}) {
  const [path, setPath] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [listing, setListing] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const remote = mode === 'remote'

  useEffect(() => {
    if (!open) return undefined
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    const request = remote
      ? browseStorageDirectories(connectionId, path, { showHidden, signal: controller.signal })
      : browseDirectories(path, { showHidden, signal: controller.signal })
    Promise.resolve(request)
      .then((data) => setListing(data))
      .catch((err) => {
        if (err?.name !== 'AbortError') setError(err)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [open, remote, connectionId, path, showHidden])

  // 每次打开都从默认位置开始，避免上次浏览到一半的路径影响下次。
  useEffect(() => {
    if (open) {
      setPath('')
      setShowHidden(false)
      setListing(null)
    }
  }, [open])

  if (!open) return null

  const current = listing?.path ?? path
  const directories = Array.isArray(listing?.directories) ? listing.directories : []
  const roots = Array.isArray(listing?.roots) ? listing.roots : []
  const parent = listing?.parent ?? ''

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#eff1f4]">
      <header className="flex h-[50px] flex-none items-center gap-1.5 border-b border-[#e6e8ec] bg-white px-2">
        <button
          type="button"
          onClick={onClose}
          aria-label={zh('返回', 'Back')}
          className="grid h-9 w-9 flex-none place-items-center rounded-[10px] active:bg-zinc-100"
        >
          <Icon name="back" size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <b className="block truncate text-[15px] leading-tight">
            {title || zh('选择文件夹', 'Choose a folder')}
          </b>
          <span className="block truncate text-[10.5px] leading-tight text-zinc-400">
            {remote
              ? zh('远程 WebDAV 目录', 'Remote WebDAV folder')
              : zh('服务端电脑上的文件夹', 'Folder on the server computer')}
          </span>
        </div>
        {extraAction}
      </header>

      <div className="flex flex-none items-center gap-2 border-b border-[#e6e8ec] bg-white px-3 py-2">
        <button
          type="button"
          disabled={!parent && parent !== ''}
          onClick={() => setPath(parent)}
          aria-label={zh('上一级', 'Parent')}
          className="grid h-8 w-8 flex-none place-items-center rounded-[9px] bg-zinc-100 text-zinc-600 active:bg-zinc-200 disabled:opacity-30"
        >
          <Icon name="back" size={15} className="rotate-90" />
        </button>
        <code className="min-w-0 flex-1 truncate rounded-[9px] bg-[#f7f8fa] px-2.5 py-1.5 text-[11.5px] text-zinc-600">
          {current || (remote ? '/' : zh('（默认位置）', '(default)'))}
        </code>
        <label className="flex flex-none items-center gap-1.5 text-[11.5px] text-zinc-500">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(event) => setShowHidden(event.target.checked)}
            className="h-3.5 w-3.5 accent-brand"
          />
          {zh('隐藏项', 'Hidden')}
        </label>
      </div>

      {roots.length > 1 ? (
        <div className="no-scrollbar flex flex-none gap-1.5 overflow-x-auto border-b border-[#e6e8ec] bg-white px-3 py-2">
          {roots.map((root) => (
            <button
              key={root.path}
              type="button"
              onClick={() => setPath(root.path)}
              className="flex-none rounded-full border border-[#e3e5ea] px-3 py-1 text-[12px] text-zinc-600 active:bg-zinc-100"
            >
              {root.name}
            </button>
          ))}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && !listing ? (
          <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-zinc-400">
            <Icon name="refresh" size={16} className="spin" />
            {zh('读取中…', 'Loading…')}
          </div>
        ) : error ? (
          <div className="mx-3 mt-3 rounded-card border border-red-200 bg-red-50 px-3.5 py-3">
            <p className="text-[12.5px] leading-relaxed text-red-700">
              {error.message || String(error)}
            </p>
            <button
              type="button"
              onClick={() => setPath((value) => value)}
              className="mt-2.5 inline-flex h-8 items-center gap-1.5 rounded-[9px] bg-white px-3 text-[12.5px] font-medium text-red-700"
            >
              <Icon name="refresh" size={14} />
              {zh('重试', 'Retry')}
            </button>
          </div>
        ) : directories.length === 0 ? (
          <p className="py-16 text-center text-[13px] text-zinc-400">
            {zh('这个位置没有子文件夹', 'No subfolders here')}
          </p>
        ) : (
          <div className="mx-3 mt-3 overflow-hidden rounded-card bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
            {directories.map((entry) => (
              <button
                key={entry.path}
                type="button"
                onClick={() => setPath(entry.path)}
                className="flex w-full items-center gap-3 border-t border-[#f1f2f5] px-3.5 py-3 text-left first:border-t-0 active:bg-zinc-50"
              >
                <Icon name="folder" size={17} className="flex-none text-amber-500" />
                <span className="min-w-0 flex-1 truncate text-[13.5px] text-zinc-800">
                  {entry.name}
                </span>
                <Icon name="right" size={14} className="flex-none text-zinc-300" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div
        className="flex flex-none gap-2.5 border-t border-[#e6e8ec] bg-white px-4 pt-3"
        style={{ paddingBottom: 'calc(1rem + var(--safe-bottom))' }}
      >
        <p className="flex-1 self-center text-[11px] leading-snug text-zinc-400">
          {remote
            ? remoteHint ||
              zh(
                '远程来源是只读的，JavBoss 只会扫描和播放。',
                'Remote sources are read-only; JavBoss only scans and plays.'
              )
            : zh(
                'JavBoss 只会读取这个文件夹，不会修改里面任何文件。',
                'JavBoss only reads this folder and never modifies its files.'
              )}
        </p>
        <button
          type="button"
          disabled={loading || Boolean(error)}
          onClick={() => onSelect?.(current, listing)}
          className={buttonClass('primary', 'h-11 flex-none px-4')}
        >
          {zh('选择此文件夹', 'Select')}
        </button>
      </div>
    </div>
  )
}
