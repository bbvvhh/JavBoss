import { useMemo, useState } from 'react'

import { renameVideoLocation } from '@/api'
import Icon from '@/components/Icons'
import SubPage from '@/components/SubPage'
import { useStore, videoKey } from '@/store'
import { getErrorMessage } from '@/utils/errors'
import { zh } from '@/utils/i18n'

/**
 * 重命名确认页 —— 全工程唯一会写入用户媒体目录的界面。
 *
 * 安全设计（对应 DESIGN.md §0.4）：
 *   - 只支持单文件，没有任何批量入口；
 *   - 完整展示「旧名 → 新名」diff；
 *   - 扩展名独立成块并锁定，用户改不到；
 *   - 必须显式点「确认重命名」，不存在一键生效路径；
 *   - 本地先做一次同目录重名预检，把冲突挡在请求之前；
 *   - 后端拒绝时原样展示原因（409 已存在 / 目录不支持等）。
 *
 * 后端本身的防护见 internal/server/video_api.go:676-800。
 */

const ILLEGAL_CHARS = /[/\\]/

function splitName(name) {
  const value = String(name || '')
  const index = value.lastIndexOf('.')
  if (index <= 0) return { base: value, ext: '' }
  return { base: value.slice(0, index), ext: value.slice(index) }
}

function collapseSpaces(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

export default function RenamePage({ video, onClose }) {
  const videos = useStore((state) => state.videos)
  const patchVideo = useStore((state) => state.patchVideo)
  const showToast = useStore((state) => state.showToast)

  const currentName = useMemo(() => {
    const raw = String(video?.filename || video?.path || '')
    return raw.split(/[\\/]/).pop() || ''
  }, [video])

  const { base: currentBase, ext } = useMemo(() => splitName(currentName), [currentName])

  const [nextBase, setNextBase] = useState(currentBase)
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState('')

  const jav = video?.jav || video?.locations?.[0]?.jav || null
  const code = String(jav?.code || '').trim()
  const idols = (jav?.idols || []).map((idol) => idol?.name).filter(Boolean)

  const trimmedBase = nextBase.trim()
  const nextName = `${trimmedBase}${ext}`

  const validation = useMemo(() => {
    if (!trimmedBase) return { ok: false, message: zh('文件名不能为空', 'Name cannot be empty') }
    if (ILLEGAL_CHARS.test(nextBase)) {
      return { ok: false, message: zh('文件名不能包含 / 或 \\', 'Name cannot contain / or \\') }
    }
    if (nextName === currentName) {
      return { ok: false, message: zh('文件名没有变化', 'Name is unchanged') }
    }
    // 本地预检：同一目录下是否已存在同名文件（后端也会再查一次）。
    const directoryId = video?.directory_id ?? video?.directory?.id ?? null
    const clash = (videos || []).some((item) => {
      if (videoKey(item) === videoKey(video)) return false
      const itemDirectoryId = item?.directory_id ?? item?.directory?.id ?? null
      if (directoryId !== null && itemDirectoryId !== null && itemDirectoryId !== directoryId) {
        return false
      }
      const itemName =
        String(item?.filename || item?.path || '')
          .split(/[\\/]/)
          .pop() || ''
      return itemName.toLowerCase() === nextName.toLowerCase()
    })
    if (clash) {
      return {
        ok: false,
        message: zh(
          '当前目录下已存在同名文件，重命名会被拒绝',
          'A file with this name already exists'
        ),
      }
    }
    return { ok: true, message: zh('目标文件名可用', 'Target name is available') }
  }, [nextBase, nextName, currentName, trimmedBase, videos, video])

  const canSubmit = validation.ok && !saving

  const applyHelper = (fn) => {
    setServerError('')
    setNextBase((value) => fn(value))
  }

  const submit = async () => {
    if (!canSubmit) return
    const locationId = Number(video?.location_id)
    if (!video?.id || !Number.isFinite(locationId) || locationId <= 0) {
      setServerError(zh('缺少文件位置，无法重命名', 'Missing file location'))
      return
    }
    setSaving(true)
    setServerError('')
    try {
      const updated = await renameVideoLocation(video.id, locationId, nextName)
      patchVideo(videoKey(video), updated || { filename: nextName })
      showToast(zh('已重命名', 'Renamed'))
      onClose?.()
    } catch (error) {
      setServerError(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SubPage
      title={zh('重命名文件', 'Rename file')}
      subtitle={currentName}
      onBack={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="h-11 w-24 flex-none rounded-card bg-[#f1f2f5] text-sm font-bold text-zinc-700"
          >
            {zh('取消', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="h-11 flex-1 rounded-card bg-brand text-[14.5px] font-bold text-white disabled:opacity-45"
          >
            {saving ? zh('重命名中…', 'Renaming...') : zh('确认重命名', 'Confirm rename')}
          </button>
        </>
      }
    >
      <div className="px-3.5 pb-8 pt-3.5">
        <div className="flex items-start gap-2.5 rounded-[10px] border border-orange-200 bg-orange-50 px-3 py-2.5 text-[12px] leading-relaxed text-orange-900">
          <Icon name="shield" size={16} className="mt-[1px] flex-none text-orange-500" />
          <span>
            {zh(
              '这会重命名磁盘上的真实文件。JavBoss 绝不删除、绝不覆盖；目标名已存在时会被直接拒绝。',
              'This renames the real file on disk. JavBoss never deletes or overwrites; an existing name is rejected.'
            )}
          </span>
        </div>

        <h4 className="mb-2 mt-4 text-[11.5px] font-bold text-zinc-500">
          {zh('新文件名', 'New name')}
        </h4>
        <div
          className={`flex overflow-hidden rounded-[10px] border-[1.5px] bg-white ${
            validation.ok ? 'border-brand' : 'border-red-400'
          }`}
        >
          <input
            value={nextBase}
            onChange={(event) => {
              setNextBase(event.target.value)
              setServerError('')
            }}
            aria-label={zh('新文件名', 'New name')}
            className="min-w-0 flex-1 bg-transparent px-3 py-3 text-[13.5px] outline-none"
          />
          {ext ? (
            <span
              className="grid flex-none place-items-center border-l border-[#e6e8ec] bg-[#f1f2f5] px-3 text-[13px] font-bold text-zinc-500"
              title={zh('扩展名不可修改', 'Extension is locked')}
            >
              {ext}
            </span>
          ) : null}
        </div>

        <p
          className={`mt-2 flex items-center gap-1.5 text-[11.5px] ${
            validation.ok ? 'text-green-700' : 'text-red-600'
          }`}
        >
          <Icon name={validation.ok ? 'check' : 'ban'} size={13} />
          {validation.message}
        </p>

        <h4 className="mb-2 mt-4 text-[11.5px] font-bold text-zinc-500">
          {zh('变更预览', 'Preview')}
        </h4>
        <div className="overflow-hidden rounded-[10px] border border-[#e6e8ec] bg-white">
          <div className="flex items-start gap-2 border-b border-[#f1f2f5] px-3 py-2.5 text-[12.5px] leading-snug">
            <span className="w-3 flex-none font-bold text-zinc-300">−</span>
            <span className="break-all text-zinc-400 line-through">{currentName}</span>
          </div>
          <div className="flex items-start gap-2 px-3 py-2.5 text-[12.5px] leading-snug">
            <span className="w-3 flex-none font-bold text-green-500">+</span>
            <span className="break-all font-semibold text-green-700">{nextName}</span>
          </div>
        </div>

        <h4 className="mb-2 mt-4 text-[11.5px] font-bold text-zinc-500">
          {zh('快捷助手', 'Quick edit')}
        </h4>
        <div className="flex flex-wrap gap-2">
          {code ? (
            <button
              type="button"
              onClick={() =>
                applyHelper((value) =>
                  value.includes(code) ? value : collapseSpaces(`${code} ${value}`)
                )
              }
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-[#d8dbe1] bg-white px-3 text-[12px] font-semibold text-zinc-700"
            >
              <Icon name="tag" size={13} className="text-zinc-400" />
              {zh('插入番号', 'Insert code')}
            </button>
          ) : null}
          {idols.length ? (
            <button
              type="button"
              onClick={() =>
                applyHelper((value) => {
                  const missing = idols.filter((name) => !value.includes(name))
                  return missing.length ? collapseSpaces(`${value} ${missing.join(' ')}`) : value
                })
              }
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-dashed border-[#d8dbe1] bg-white px-3 text-[12px] font-semibold text-zinc-700"
            >
              <Icon name="star" size={13} className="text-zinc-400" />
              {zh('插入演员', 'Insert cast')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => applyHelper((value) => value.toUpperCase())}
            className="inline-flex h-8 items-center rounded-lg border border-dashed border-[#d8dbe1] bg-white px-3 text-[12px] font-semibold text-zinc-700"
          >
            {zh('转大写', 'Uppercase')}
          </button>
          <button
            type="button"
            onClick={() => applyHelper(collapseSpaces)}
            className="inline-flex h-8 items-center rounded-lg border border-dashed border-[#d8dbe1] bg-white px-3 text-[12px] font-semibold text-zinc-700"
          >
            {zh('去多余空格', 'Trim spaces')}
          </button>
          <button
            type="button"
            onClick={() => applyHelper(() => currentBase)}
            className="inline-flex h-8 items-center rounded-lg border border-dashed border-[#d8dbe1] bg-white px-3 text-[12px] font-semibold text-zinc-700"
          >
            {zh('还原', 'Reset')}
          </button>
        </div>

        {serverError ? (
          <div className="mt-4 flex items-start gap-2 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] leading-relaxed text-red-700">
            <Icon name="ban" size={15} className="mt-[1px] flex-none" />
            <span>{serverError}</span>
          </div>
        ) : null}

        <p className="mt-5 text-[11px] leading-relaxed text-zinc-400">
          {zh(
            '扩展名单独锁定，避免误改导致文件无法识别。只改大小写的重命名会被后端拒绝（数据库对路径不区分大小写）。',
            'The extension is locked separately. Case-only renames are rejected by the backend.'
          )}
        </p>
      </div>
    </SubPage>
  )
}

export { splitName, collapseSpaces }
