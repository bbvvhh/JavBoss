import { useState } from 'react'

import { changePassword } from '@/api'
import Icon from '@/components/Icons'
import SettingsPage from '@/components/settings/SettingsPage'
import TextField from '@/components/form/TextField'
import { SectionTitle, buttonClass } from '@/components/form/Field'
import ConfirmDialog from '@/components/ConfirmDialog'
import { UI_MODE_COOKIE } from '@/constants/app'
import { useAuth } from '@/auth'
import { useStore } from '@/store'
import { getErrorMessage } from '@/utils/errors'
import { zh } from '@/utils/i18n'

/**
 * 密码规则抄自 PC 端 App.jsx:1218-1233：
 * 6-20 个字符、首尾不能有空格、两次输入一致。
 * 另外后端用 bcrypt，超过 72 字节会被截断，所以这里也挡一下。
 */
function validatePassword(next, confirm) {
  const value = String(next || '')
  const runes = Array.from(value).length
  if (runes < 6 || runes > 20) {
    return zh('新密码需为 6-20 个字符', 'New password must be 6-20 characters')
  }
  if (value !== value.trim()) {
    return zh('新密码首尾不能包含空格', 'New password cannot start or end with a space')
  }
  if (new TextEncoder().encode(value).length > 72) {
    return zh('新密码过长（最多 72 字节）', 'New password is too long (max 72 bytes)')
  }
  if (value !== confirm) {
    return zh('两次输入的新密码不一致', 'The two passwords do not match')
  }
  return ''
}

/** 写入 UI 偏好 Cookie；P3 的后端分流会读它，现在也用于记住选择。 */
function writeUiModeCookie(value) {
  try {
    const maxAge = 365 * 24 * 60 * 60
    document.cookie = `${UI_MODE_COOKIE}=${encodeURIComponent(
      value
    )}; path=/; max-age=${maxAge}; SameSite=Lax`
  } catch {
    /* 忽略写入失败，跳转本身仍然有效 */
  }
}

export default function AccountPage({ onClose }) {
  const { logout } = useAuth()
  const showToast = useStore((state) => state.showToast)

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [fieldError, setFieldError] = useState('')
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const [logoutOpen, setLogoutOpen] = useState(false)

  const submit = async () => {
    const message = validatePassword(next, confirm)
    setFieldError(message)
    setFormError('')
    if (message) return
    if (!current) {
      setFormError(zh('请输入当前密码', 'Enter your current password'))
      return
    }
    setBusy(true)
    try {
      await changePassword(current, next)
      setCurrent('')
      setNext('')
      setConfirm('')
      showToast(zh('密码已更新', 'Password updated'))
    } catch (err) {
      setFormError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const switchToDesktop = () => {
    writeUiModeCookie('desktop')
    // 直接跳 PC 入口：/ 由后端托管 web/dist，不依赖 P3 的分流逻辑。
    window.location.href = '/'
  }

  const doLogout = async () => {
    setBusy(true)
    try {
      await logout()
    } catch (err) {
      showToast(getErrorMessage(err))
    } finally {
      setBusy(false)
      setLogoutOpen(false)
    }
  }

  return (
    <SettingsPage title={zh('账号与安全', 'Account & security')} onBack={onClose}>
      <SectionTitle>{zh('访问方式', 'Access')}</SectionTitle>
      <div className="mx-3 overflow-hidden rounded-card bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
        <button
          type="button"
          onClick={switchToDesktop}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-zinc-50"
        >
          <span className="grid h-8 w-8 flex-none place-items-center rounded-[9px] bg-zinc-100 text-zinc-500">
            <Icon name="desktop" size={17} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] text-zinc-800">
              {zh('切换到电脑版', 'Switch to desktop')}
            </span>
            <span className="mt-0.5 block text-[11.5px] leading-relaxed text-zinc-400">
              {zh(
                '会记住这个选择，之后用手机访问也直接进电脑版。想回到手机版，访问 /?mobile=1 即可。',
                'This is remembered, so this phone keeps opening the desktop UI. Visit /?mobile=1 to come back.'
              )}
            </span>
          </span>
          <Icon name="right" size={14} className="flex-none text-zinc-300" />
        </button>
      </div>

      <SectionTitle>{zh('修改密码', 'Change password')}</SectionTitle>
      <div className="mx-3 space-y-3 rounded-card bg-white px-4 py-4 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
        <TextField
          label={zh('当前密码', 'Current password')}
          value={current}
          onChange={setCurrent}
          secret
          autoComplete="current-password"
        />
        <TextField
          label={zh('新密码', 'New password')}
          value={next}
          onChange={setNext}
          secret
          autoComplete="new-password"
          hint={zh('6-20 个字符，首尾不能有空格', '6-20 characters, no leading/trailing spaces')}
          error={fieldError}
        />
        <TextField
          label={zh('确认新密码', 'Confirm new password')}
          value={confirm}
          onChange={setConfirm}
          secret
          autoComplete="new-password"
        />
        {formError ? (
          <p className="flex items-start gap-2 rounded-[10px] bg-red-50 px-3 py-2.5 text-[12px] leading-relaxed text-red-700">
            <Icon name="ban" size={14} className="mt-[2px] flex-none" />
            <span>{formError}</span>
          </p>
        ) : null}
        <button
          type="button"
          onClick={submit}
          disabled={busy || !current || !next || !confirm}
          className={buttonClass('primary', 'h-11 w-full')}
        >
          {busy ? zh('保存中…', 'Saving…') : zh('保存新密码', 'Save new password')}
        </button>
      </div>

      <SectionTitle>{zh('会话', 'Session')}</SectionTitle>
      <div className="mx-3 overflow-hidden rounded-card bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
        <button
          type="button"
          onClick={() => setLogoutOpen(true)}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-red-600 active:bg-red-50"
        >
          <span className="grid h-8 w-8 flex-none place-items-center rounded-[9px] bg-red-50 text-red-600">
            <Icon name="logout" size={17} />
          </span>
          <span className="min-w-0 flex-1 text-[14px]">{zh('退出登录', 'Sign out')}</span>
          <Icon name="right" size={14} className="flex-none text-red-200" />
        </button>
      </div>

      <p className="px-5 pt-4 text-center text-[11px] leading-relaxed text-zinc-400">
        {zh(
          '登录状态由浏览器 Cookie 保存，有效期 14 天。',
          'Your session is kept in a browser cookie valid for 14 days.'
        )}
      </p>

      <ConfirmDialog
        open={logoutOpen}
        title={zh('退出登录？', 'Sign out?')}
        description={zh(
          '需要输入密码才能重新进入。不会影响任何视频文件或已保存的数据。',
          'You will need the password to get back in. No videos or saved data are affected.'
        )}
        confirmText={zh('退出', 'Sign out')}
        danger
        busy={busy}
        onConfirm={doLogout}
        onClose={() => setLogoutOpen(false)}
      />
    </SettingsPage>
  )
}
