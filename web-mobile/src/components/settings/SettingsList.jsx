import Icon from '@/components/Icons'
import { zh } from '@/utils/i18n'

/** 「我的」里的一组入口。 */
export function SettingsGroup({ title, children }) {
  return (
    <section className="mt-3 first:mt-0">
      <h3 className="px-4 pb-1.5 text-[12px] font-semibold text-zinc-500">{title}</h3>
      <div className="mx-3 overflow-hidden rounded-card bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
        {children}
      </div>
    </section>
  )
}

/**
 * 一个设置入口。
 *
 * 统一 56px 行高 + 44px 最小触摸目标；`value` 用来做「一眼看到状态」的
 * 右侧摘要（3 个 / 已配置 / 浏览器播放），避免每个入口都要点进去才知道情况。
 */
export function SettingsRow({
  icon,
  label,
  value,
  hint,
  onClick,
  danger = false,
  disabled = false,
  trailing,
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      {...(onClick
        ? {
            type: 'button',
            onClick,
            disabled,
          }
        : {})}
      className={`flex w-full items-center gap-3 border-t border-[#f1f2f5] px-4 py-3 text-left first:border-t-0 ${
        danger ? 'text-red-600' : 'text-zinc-800'
      } ${onClick && !disabled ? 'active:bg-zinc-50' : ''} ${disabled ? 'opacity-40' : ''}`}
    >
      <span
        className={`grid h-8 w-8 flex-none place-items-center rounded-[9px] ${
          danger ? 'bg-red-50 text-red-600' : 'bg-zinc-100 text-zinc-500'
        }`}
      >
        <Icon name={icon} size={17} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px]">{label}</span>
        {hint ? (
          <span className="mt-0.5 block truncate text-[11.5px] text-zinc-400">{hint}</span>
        ) : null}
      </span>

      {trailing ?? null}
      {value ? (
        <span className="max-w-[42%] flex-none truncate text-[12.5px] text-zinc-400">{value}</span>
      ) : null}
      {onClick ? <Icon name="right" size={14} className="flex-none text-zinc-300" /> : null}
    </Tag>
  )
}

/** 「我的」顶部的概览卡（深色，与播放页呼应）。 */
export function MeHeader({ version, host, stats }) {
  return (
    <div className="bg-gradient-to-b from-[#1e293b] to-[#243449] px-4 pb-5 pt-4 text-white">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 flex-none place-items-center rounded-[13px] bg-brand text-[15px] font-bold">
          JB
        </span>
        <div className="min-w-0 flex-1">
          <b className="block truncate text-[15.5px]">{zh('JavBoss 移动版', 'JavBoss Mobile')}</b>
          <span className="mt-0.5 block truncate text-[11.5px] text-white/60">
            {[version, zh('已登录', 'Signed in'), host].filter(Boolean).join(' · ')}
          </span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        {stats.map((item) => (
          <div key={item.label} className="rounded-[11px] bg-white/[0.08] px-2.5 py-2">
            <b className="block text-[17px] leading-tight tabular-nums">{item.value}</b>
            <span className="mt-0.5 block truncate text-[11px] text-white/55">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
