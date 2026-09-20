import { useState } from 'react'

import Icon from '@/components/Icons'
import { zh } from '@/utils/i18n'
import { getErrorMessage } from '@/utils/errors'

export default function LoginPage({ onLogin, checkError = '', onRetry }) {
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!password) return
    setError('')
    setSubmitting(true)
    try {
      await onLogin(password)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-screen flex-col justify-center bg-[#eff1f4] px-6 pb-16">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-400 text-lg font-extrabold text-white shadow-[0_8px_24px_-8px_rgba(37,99,235,0.9)]">
          JB
        </div>
        <h1 className="text-xl font-bold tracking-tight text-zinc-900">JavBoss</h1>
        <p className="mt-1.5 text-[13px] text-zinc-500">
          {zh('移动版 · 请输入密码继续', 'Mobile · Enter your password')}
        </p>
      </div>

      {checkError ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-700">
          <div>{checkError}</div>
          <button type="button" onClick={onRetry} className="mt-1.5 font-medium underline">
            {zh('重新连接', 'Retry')}
          </button>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="relative">
          <input
            id="password"
            type={visible ? 'text' : 'password'}
            autoComplete="current-password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
              setError('')
            }}
            placeholder={zh('密码', 'Password')}
            aria-label={zh('密码', 'Password')}
            className="w-full rounded-xl border border-[#e6e8ec] bg-white py-3 pl-4 pr-12 text-[15px] text-zinc-900 outline-none focus:border-brand focus:ring-2 focus:ring-blue-100"
          />
          <button
            type="button"
            onClick={() => setVisible((value) => !value)}
            aria-label={visible ? zh('隐藏密码', 'Hide password') : zh('显示密码', 'Show password')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400"
          >
            <Icon name={visible ? 'eyeOff' : 'eye'} size={17} />
          </button>
        </div>

        {error ? (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
            <Icon name="ban" size={14} className="mt-[1px] flex-none" />
            <span>{error}</span>
          </div>
        ) : null}

        <button
          type="submit"
          disabled={submitting || !password}
          className="h-12 w-full rounded-xl bg-brand text-[15px] font-bold text-white transition disabled:opacity-55"
        >
          {submitting ? zh('登录中…', 'Signing in...') : zh('登录', 'Sign in')}
        </button>
      </form>

      <p className="mt-6 text-center text-[11.5px] leading-relaxed text-zinc-400">
        {zh(
          '默认密码 admin，登录后可在电脑端全局设置中修改',
          'Default password is admin. Change it in Global Settings on desktop.'
        )}
      </p>
    </main>
  )
}
