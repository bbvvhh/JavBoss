/**
 * 设置页通用排版基座。
 *
 * 移动端的表单不用表格，而是「白色圆角卡片 + 分隔线的行」——PC 端那种
 * label 左 control 右的两列布局在 390px 宽度下会把控件挤到没法点。
 * 所以这里的 FormRow 是**纵向**的：标签在上，控件在下或右侧。
 */

/** 分组标题（在卡片外面）。 */
export function SectionTitle({ children, hint }) {
  return (
    <div className="flex items-baseline gap-2 px-4 pb-1.5 pt-4">
      <h3 className="text-[12px] font-semibold text-zinc-500">{children}</h3>
      {hint ? <span className="text-[11px] text-zinc-400">{hint}</span> : null}
    </div>
  )
}

/** 白色圆角卡片容器；多个 FormRow 之间自动画分隔线。 */
export function FormCard({ children, className = '', padded = false }) {
  return (
    <div
      className={`mx-3 overflow-hidden rounded-card bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)] ${
        padded ? 'px-4 py-3.5' : ''
      } ${className}`}
    >
      {children}
    </div>
  )
}

/**
 * 一行表单。
 *
 * - `stack`（默认）：标签在上，控件在下，适合开关之外的一切控件
 * - `inline`：标签在左，控件在右，只适合 Switch 这种宽度固定的控件
 */
export function FormRow({
  label,
  hint,
  control,
  layout = 'stack',
  divider = true,
  className = '',
}) {
  const inline = layout === 'inline'
  return (
    <div
      className={`${divider ? 'border-t border-[#f1f2f5] first:border-t-0' : ''} px-4 py-3 ${className}`}
    >
      <div className={inline ? 'flex items-center gap-3' : ''}>
        <div className={inline ? 'min-w-0 flex-1' : ''}>
          <div className="text-[13.5px] leading-snug text-zinc-800">{label}</div>
          {hint ? <p className="mt-1 text-[11.5px] leading-relaxed text-zinc-400">{hint}</p> : null}
        </div>
        {control ? <div className={inline ? 'flex-none' : 'mt-2.5'}>{control}</div> : null}
      </div>
    </div>
  )
}

/** 卡片里的纯展示行（不可点）。 */
export function InfoRow({ label, value, mono = false }) {
  return (
    <div className="flex items-start gap-3 border-t border-[#f1f2f5] px-4 py-3 first:border-t-0">
      <span className="flex-none text-[13px] text-zinc-500">{label}</span>
      <span
        className={`ml-auto max-w-[62%] break-all text-right text-[13px] text-zinc-800 ${
          mono ? 'font-mono text-[12px]' : ''
        }`}
      >
        {value}
      </span>
    </div>
  )
}

/** 通用按钮样式，避免每个设置页各写一套。 */
export function buttonClass(variant = 'secondary', extra = '') {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-[10px] px-3.5 text-[13.5px] font-medium active:opacity-80 disabled:opacity-40'
  const variants = {
    primary: 'bg-brand text-white',
    secondary: 'bg-zinc-100 text-zinc-700',
    danger: 'bg-red-50 text-red-600',
    ghost: 'text-brand-ink',
  }
  return `${base} ${variants[variant] || variants.secondary} ${extra}`
}

/** 设置页的「+ 新建」按钮，宽度自适应内容。 */
export function AddButton({ children, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={buttonClass('ghost', 'h-8 bg-brand-soft px-2.5 text-[12.5px]')}
    >
      {children}
    </button>
  )
}
