import { useState } from 'react'

import BottomSheet from '@/components/BottomSheet'
import Icon from '@/components/Icons'
import { zh } from '@/utils/i18n'

/**
 * 下拉选择：显示当前值，点击后从底部抽屉里选。
 *
 * 不用原生 `<select>`——它在 iOS 上是全屏滚轮，和 App 的视觉完全脱节，
 * 而且没法显示「每项一句说明」。
 *
 * `multiple` 打开多选模式，值变成数组；确认按钮在抽屉底部。
 */
export default function PickerField({
  label,
  hint,
  value,
  options = [],
  onChange,
  placeholder = zh('未选择', 'Not set'),
  multiple = false,
  disabled = false,
  sheetTitle,
  emptyText = zh('暂无可选项', 'Nothing to choose from'),
}) {
  const [open, setOpen] = useState(false)

  const items = Array.isArray(options) ? options : []
  const selected = multiple ? (Array.isArray(value) ? value : []) : [value]
  const isSelected = (option) => selected.some((item) => String(item) === String(option.value))

  const display = () => {
    if (multiple) {
      if (!selected.length) return placeholder
      if (selected.length === 1) {
        const match = items.find((item) => String(item.value) === String(selected[0]))
        return match?.label ?? String(selected[0])
      }
      return zh(`已选 ${selected.length} 项`, `${selected.length} selected`)
    }
    if (value === null || value === undefined || value === '') return placeholder
    const match = items.find((item) => String(item.value) === String(value))
    return match?.label ?? String(value)
  }

  const commit = (option) => {
    if (multiple) {
      const next = isSelected(option)
        ? selected.filter((item) => String(item) !== String(option.value))
        : [...selected, option.value]
      onChange?.(next)
      return
    }
    onChange?.(option.value)
    setOpen(false)
  }

  const hasValue = multiple
    ? selected.length > 0
    : value !== null && value !== undefined && value !== ''

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className={`w-full rounded-[10px] border border-[#e3e5ea] bg-white px-3 py-2.5 text-left active:bg-zinc-50 disabled:bg-zinc-50 ${
          disabled ? 'opacity-50' : ''
        }`}
      >
        <span className="flex items-center gap-2">
          <span
            className={`min-w-0 flex-1 truncate text-[14px] ${
              hasValue ? 'text-zinc-900' : 'text-zinc-400'
            }`}
          >
            {display()}
          </span>
          <Icon name="down" size={15} className="flex-none text-zinc-400" />
        </span>
        {label && hint ? (
          <span className="mt-1 block text-[11.5px] leading-relaxed text-zinc-400">{hint}</span>
        ) : null}
      </button>

      <BottomSheet
        open={open}
        title={sheetTitle || label || zh('请选择', 'Choose')}
        onClose={() => setOpen(false)}
        height="70vh"
        footer={
          <>
            {/* 清除放在抽屉里而不是输入框里：嵌套 button 是非法 HTML，
                而且在手机上 24px 的小叉子也很难点中。 */}
            {hasValue ? (
              <button
                type="button"
                onClick={() => {
                  onChange?.(multiple ? [] : null)
                  if (!multiple) setOpen(false)
                }}
                className="h-11 flex-1 rounded-[12px] bg-zinc-100 text-[14px] font-medium text-zinc-700 active:opacity-80"
              >
                {zh('清除选择', 'Clear')}
              </button>
            ) : null}
            {multiple ? (
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-11 flex-1 rounded-[12px] bg-brand text-[14.5px] font-semibold text-white active:opacity-80"
              >
                {zh(`确定（已选 ${selected.length}）`, `Done (${selected.length})`)}
              </button>
            ) : null}
          </>
        }
      >
        {items.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-zinc-400">{emptyText}</p>
        ) : (
          <ul className="space-y-1 pb-2">
            {items.map((option) => {
              const active = isSelected(option)
              return (
                <li key={String(option.value)}>
                  <button
                    type="button"
                    onClick={() => commit(option)}
                    className="flex w-full items-start gap-3 rounded-[10px] px-3 py-2.5 text-left active:bg-zinc-100"
                  >
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-[14px] ${
                          active ? 'font-semibold text-brand-ink' : 'text-zinc-800'
                        }`}
                      >
                        {option.label}
                      </span>
                      {option.hint ? (
                        <span className="mt-0.5 block text-[11.5px] leading-relaxed text-zinc-400">
                          {option.hint}
                        </span>
                      ) : null}
                    </span>
                    {active ? (
                      <Icon name="check" size={16} className="mt-0.5 flex-none text-brand" />
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </BottomSheet>
    </>
  )
}
