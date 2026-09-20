import Icon from '@/components/Icons'
import { zh } from '@/utils/i18n'

/**
 * 尚未实现的模块占位（JAV 在 P1、设置在 P2）。
 * 明确写出后续计划，避免用户以为功能坏了。
 */
export default function PlaceholderPage({
  icon = 'info',
  title,
  description,
  items = [],
  onClose,
}) {
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[#eff1f4]">
      <header className="flex h-[50px] flex-none items-center gap-1.5 border-b border-[#e6e8ec] bg-white px-2">
        <button
          type="button"
          onClick={onClose}
          aria-label={zh('返回', 'Back')}
          className="grid h-9 w-9 place-items-center rounded-[10px] active:bg-zinc-100"
        >
          <Icon name="back" size={20} />
        </button>
        <b className="text-[15px]">{title}</b>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-10">
        <div className="mx-auto max-w-sm text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-white text-zinc-400 shadow-sm">
            <Icon name={icon} size={26} />
          </div>
          <p className="text-[13.5px] leading-relaxed text-zinc-600">{description}</p>
        </div>

        {items.length ? (
          <ul className="mx-auto mt-6 max-w-sm space-y-2">
            {items.map((item) => (
              <li
                key={item}
                className="flex items-start gap-2.5 rounded-card border border-[#e6e8ec] bg-white px-3.5 py-3 text-[12.5px] leading-snug text-zinc-600"
              >
                <Icon name="right" size={14} className="mt-[2px] flex-none text-zinc-300" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}
