import { useEffect } from 'react'

import Icon from '@/components/Icons'

/**
 * 底部抽屉基座：遮罩 + 圆角面板 + 安全区。
 * 点遮罩或按 Esc 关闭。
 */
export default function BottomSheet({ open, title, subtitle, onClose, children, footer, height }) {
  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      <div
        className="scrim-in fixed inset-0 z-40 bg-slate-900/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="sheet-in fixed inset-x-0 bottom-0 z-50 flex flex-col overflow-hidden rounded-t-sheet bg-[#f7f8fa] shadow-[0_-12px_40px_-12px_rgba(0,0,0,0.4)]"
        style={{ height: height || 'auto', maxHeight: '88vh' }}
      >
        <div className="flex flex-none justify-center pt-2">
          <span className="block h-1 w-9 rounded-full bg-zinc-300" />
        </div>
        <div className="flex flex-none items-center border-b border-[#e6e8ec] px-4 pb-2.5 pt-1">
          <div className="min-w-0 flex-1">
            <b className="block truncate text-[15px] font-semibold">{title}</b>
            {subtitle ? (
              <span className="block truncate text-[11px] leading-tight text-zinc-400">
                {subtitle}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="ml-auto flex-none p-1 text-zinc-500"
          >
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-1 pt-3.5">{children}</div>
        {footer ? (
          <div
            className="flex flex-none gap-2.5 border-t border-[#e6e8ec] bg-white px-4 pt-3"
            style={{ paddingBottom: 'calc(1.5rem + var(--safe-bottom))' }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </>
  )
}
