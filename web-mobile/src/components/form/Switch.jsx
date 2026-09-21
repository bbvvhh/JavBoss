/**
 * iOS 风格的开关。
 *
 * 用 button + role="switch" 而不是 input[type=checkbox]：移动端 Safari 的原生
 * 复选框在 44px 触摸目标下会被系统缩放，且样式无法和其余设置行对齐。
 */
export default function Switch({ checked, onChange, disabled = false, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={Boolean(checked)}
      aria-label={label}
      disabled={disabled}
      onClick={() => {
        if (disabled) return
        onChange?.(!checked)
      }}
      className={`relative h-[31px] w-[51px] flex-none rounded-full transition-colors duration-150 ${
        checked ? 'bg-brand' : 'bg-zinc-300'
      } ${disabled ? 'opacity-40' : ''}`}
    >
      <span
        className={`absolute top-[2px] block h-[27px] w-[27px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-all duration-150 ${
          checked ? 'left-[22px]' : 'left-[2px]'
        }`}
      />
    </button>
  )
}
