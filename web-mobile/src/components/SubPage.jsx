import Icon from '@/components/Icons'
import { zh } from '@/utils/i18n'

/**
 * 二级页外壳：全屏 + 顶部返回栏 + 可选底部操作区。
 * P1 的重命名 / 截图 / 刮削页与 P2 的设置子页都复用它。
 */
export default function SubPage({
  title,
  subtitle,
  onBack,
  action,
  children,
  footer,
  headerRight,
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
        {action ? <div className="flex-none pr-1">{action}</div> : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>

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
