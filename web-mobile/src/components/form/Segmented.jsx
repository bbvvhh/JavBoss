/**
 * 分段选择器：2~4 个互斥选项。
 *
 * 选项超过 4 个就用 PickerField（底部抽屉），横向排不下会变成挤成一团的
 * 小字，反而更难点。
 */
export default function Segmented({ value, options, onChange, disabled = false, label }) {
  const items = Array.isArray(options) ? options : []
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex w-full gap-1 rounded-[10px] bg-zinc-100 p-1"
    >
      {items.map((option) => {
        const active = String(option.value) === String(value)
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => {
              if (!disabled) onChange?.(option.value)
            }}
            className={`min-w-0 flex-1 truncate rounded-[8px] px-2 py-1.5 text-[12.5px] transition-colors ${
              active ? 'bg-white font-semibold text-brand-ink shadow-sm' : 'text-zinc-600'
            } ${disabled ? 'opacity-40' : ''}`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
