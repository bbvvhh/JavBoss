import { useEffect, useState } from 'react'

import BottomSheet from '@/components/BottomSheet'
import TextField from '@/components/form/TextField'
import { buttonClass } from '@/components/form/Field'
import { zh } from '@/utils/i18n'

/**
 * 「输入一个名字然后确定」的底部抽屉：新建标签 / 重命名 / 新建分类都用它。
 *
 * 为什么不用 window.prompt：移动端 Safari 的 prompt 会被部分浏览器直接屏蔽，
 * 而且没法做校验提示。
 */
export default function PromptSheet({
  open,
  title,
  label,
  hint,
  placeholder = '',
  initialValue = '',
  confirmText = zh('确定', 'Confirm'),
  busy = false,
  error = '',
  maxLength = 80,
  onConfirm,
  onClose,
}) {
  const [value, setValue] = useState(initialValue)

  useEffect(() => {
    if (open) setValue(initialValue)
  }, [open, initialValue])

  const trimmed = value.trim()

  return (
    <BottomSheet
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className={buttonClass('secondary', 'h-11 flex-1')}
          >
            {zh('取消', 'Cancel')}
          </button>
          <button
            type="button"
            disabled={busy || !trimmed}
            onClick={() => onConfirm?.(trimmed)}
            className={buttonClass('primary', 'h-11 flex-1')}
          >
            {busy ? zh('处理中…', 'Working…') : confirmText}
          </button>
        </>
      }
    >
      <div className="pb-3">
        <TextField
          label={label}
          hint={hint}
          value={value}
          onChange={(next) => setValue(String(next).slice(0, maxLength))}
          placeholder={placeholder}
          error={error}
          autoComplete="off"
        />
        {maxLength ? (
          <p className="mt-1.5 text-right text-[11px] tabular-nums text-zinc-400">
            {Array.from(value).length} / {maxLength}
          </p>
        ) : null}
      </div>
    </BottomSheet>
  )
}
