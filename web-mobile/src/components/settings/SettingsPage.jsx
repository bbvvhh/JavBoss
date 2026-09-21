import Icon from '@/components/Icons'
import { zh } from '@/utils/i18n'

/**
 * 设置子页的统一外壳：加载中 / 出错可重试 / 正常内容三态。
 *
 * 所有设置页共用一个骨架，避免每个页面各自实现一遍 loading 和 error —— 那样
 * 一定会有的页面忘了显示错误，用户看到空白页却不知道发生了什么。
 */
export default function SettingsPage({
  title,
  subtitle,
  onBack,
  headerRight,
  footer,
  loading = false,
  error = null,
  onRetry,
  hint,
  children,
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#eff1f4]">
      <header className="flex h-[50px] flex-none items-center gap-1.5 border-b border-[#e6e8ec] bg-white px-2">
        <button
          type="button"
          onClick={onBack}
          aria-label={zh('返回', 'Back')}
          className="grid h-9 w-9 flex-none place-items-center rounded-[10px] active:bg-zinc-100"
        >
          <Icon name="back" size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <b className="block truncate text-[15px] leading-tight">{title}</b>
          {subtitle ? (
            <span className="block truncate text-[10.5px] leading-tight text-zinc-400">
              {subtitle}
            </span>
          ) : null}
        </div>
        {headerRight}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-zinc-400">
            <Icon name="refresh" size={16} className="spin" />
            {zh('加载中…', 'Loading…')}
          </div>
        ) : error ? (
          <div className="mx-3 mt-3 rounded-card border border-red-200 bg-red-50 px-3.5 py-3">
            <p className="text-[12.5px] leading-relaxed text-red-700">
              {error.message || String(error)}
            </p>
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="mt-2.5 inline-flex h-8 items-center gap-1.5 rounded-[9px] bg-white px-3 text-[12.5px] font-medium text-red-700 active:opacity-80"
              >
                <Icon name="refresh" size={14} />
                {zh('重试', 'Retry')}
              </button>
            ) : null}
          </div>
        ) : (
          children
        )}
      </div>

      {hint ? (
        <p className="flex-none px-5 pb-1 text-center text-[11px] leading-relaxed text-zinc-400">
          {hint}
        </p>
      ) : null}

      {footer ? (
        <div
          className="flex flex-none gap-2.5 border-t border-[#e6e8ec] bg-white px-4 pt-3"
          style={{ paddingBottom: 'calc(1rem + var(--safe-bottom))' }}
        >
          {footer}
        </div>
      ) : null}
    </div>
  )
}
