import { useState } from 'react'

import Icon from '@/components/Icons'
import { zh } from '@/utils/i18n'

/**
 * 文本输入。
 *
 * 注意 iOS 的行为：input 的 font-size 小于 16px 时，聚焦会触发页面自动放大，
 * 而且放大之后不会自己缩回去。所以真实输入框统一给 `text-[16px]`（用 `scale`
 * 做不了这件事，必须是 computed font-size）。视觉上的「小字」只用在非输入元素上。
 */
export default function TextField({
  label,
  hint,
  error,
  value,
  onChange,
  placeholder = '',
  type = 'text',
  secret = false,
  mono = false,
  multiline = false,
  rows = 3,
  disabled = false,
  autoComplete,
  inputMode,
}) {
  const [revealed, setRevealed] = useState(false)

  const resolvedType = secret && !revealed ? 'password' : type
  const shared = {
    value: value ?? '',
    disabled,
    placeholder,
    autoComplete,
    inputMode,
    onChange: (event) => onChange?.(event.target.value),
    className: `w-full rounded-[10px] border bg-white px-3 py-2.5 text-[16px] leading-snug text-zinc-900 outline-none placeholder:text-zinc-300 focus:border-brand-line focus:ring-2 focus:ring-brand-soft disabled:bg-zinc-50 disabled:text-zinc-400 ${
      mono ? 'font-mono text-[13px]' : ''
    } ${error ? 'border-red-300' : 'border-[#e3e5ea]'}`,
  }

  return (
    <label className="block">
      {label ? (
        <span className="mb-1.5 block text-[12.5px] font-medium text-zinc-600">{label}</span>
      ) : null}

      <span className="relative block">
        {multiline ? (
          <textarea {...shared} rows={rows} className={`${shared.className} resize-y`} />
        ) : (
          <input {...shared} type={resolvedType} />
        )}

        {secret && !multiline ? (
          <button
            type="button"
            onClick={() => setRevealed((prev) => !prev)}
            aria-label={revealed ? zh('隐藏', 'Hide') : zh('显示', 'Show')}
            className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-zinc-400 active:bg-zinc-100"
          >
            <Icon name={revealed ? 'eyeOff' : 'eye'} size={17} />
          </button>
        ) : null}
      </span>

      {error ? (
        <span className="mt-1 block text-[11.5px] text-red-600">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[11.5px] leading-relaxed text-zinc-400">{hint}</span>
      ) : null}
    </label>
  )
}
