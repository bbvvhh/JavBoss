import { useEffect, useState } from 'react'

import Icon from '@/components/Icons'
import { zh } from '@/utils/i18n'

/**
 * 破坏性操作的确认弹窗。
 *
 * 刻意不用 `window.confirm`：它在移动端 Safari 里会显示当前域名，体验割裂，
 * 而且没法把「这次到底删了什么」讲清楚。删除标签 / 收藏夹 / 目录这类操作
 * 必须让用户看清对象再确认。
 */
export default function ConfirmDialog({
  open,
  title,
  description,
  items = [],
  confirmText = zh('确认', 'Confirm'),
  cancelText = zh('取消', 'Cancel'),
  danger = false,
  busy = false,
  onConfirm,
  onClose,
}) {
  const [ack, setAck] = useState(false)

  useEffect(() => {
    if (open) setAck(false)
  }, [open])

  if (!open) return null

  return (
    <>
      <div
        className="scrim-in fixed inset-0 z-[70] bg-slate-900/40"
        onClick={busy ? undefined : onClose}
        aria-hidden="true"
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="fixed inset-x-6 top-1/2 z-[71] max-w-sm -translate-y-1/2 rounded-[16px] bg-white p-4 shadow-xl sm:mx-auto"
        style={{ marginInline: 'auto' }}
      >
        <div className="flex items-start gap-2.5">
          <span
            className={`grid h-8 w-8 flex-none place-items-center rounded-full ${
              danger ? 'bg-red-50 text-red-600' : 'bg-brand-soft text-brand-ink'
            }`}
          >
            <Icon name={danger ? 'ban' : 'info'} size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <b className="block text-[14.5px] leading-snug text-zinc-900">{title}</b>
            {description ? (
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-zinc-500">{description}</p>
            ) : null}
          </div>
        </div>

        {items.length ? (
          <ul className="mt-3 max-h-[30vh] space-y-1 overflow-y-auto rounded-[10px] bg-zinc-50 p-2">
            {items.map((item, index) => (
              <li
                key={`${item}-${index}`}
                className="truncate rounded px-2 py-1 text-[12px] text-zinc-600"
              >
                {item}
              </li>
            ))}
          </ul>
        ) : null}

        {danger ? (
          <label className="mt-3 flex items-center gap-2 rounded-[10px] bg-red-50/60 px-3 py-2.5">
            <input
              type="checkbox"
              checked={ack}
              onChange={(event) => setAck(event.target.checked)}
              className="h-4 w-4 flex-none accent-red-600"
            />
            <span className="text-[12px] leading-snug text-red-700">
              {zh('我已确认，这个操作不可撤销', 'I understand this cannot be undone')}
            </span>
          </label>
        ) : null}

        <div className="mt-4 flex gap-2.5">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="h-11 flex-1 rounded-[12px] bg-zinc-100 text-[14px] font-medium text-zinc-700 active:opacity-80 disabled:opacity-40"
          >
            {cancelText}
          </button>
          <button
            type="button"
            disabled={busy || (danger && !ack)}
            onClick={onConfirm}
            className={`h-11 flex-1 rounded-[12px] text-[14px] font-semibold text-white active:opacity-80 disabled:opacity-40 ${
              danger ? 'bg-red-600' : 'bg-brand'
            }`}
          >
            {busy ? zh('处理中…', 'Working…') : confirmText}
          </button>
        </div>
      </div>
    </>
  )
}
