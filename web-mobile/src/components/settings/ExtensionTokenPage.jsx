import { useState } from 'react'

import {
  createExtensionToken,
  deleteExtensionToken,
  fetchExtensionTokens,
  rotateExtensionToken,
} from '@/api'
import BottomSheet from '@/components/BottomSheet'
import ConfirmDialog from '@/components/ConfirmDialog'
import Icon from '@/components/Icons'
import SettingsPage from '@/components/settings/SettingsPage'
import PickerField from '@/components/form/PickerField'
import TextField from '@/components/form/TextField'
import { buttonClass } from '@/components/form/Field'
import useAsyncData from '@/hooks/useAsyncData'
import { useStore } from '@/store'
import { getErrorMessage } from '@/utils/errors'
import { zh } from '@/utils/i18n'

const NEVER_EXPIRES = '0001-01-01T00:00:00Z'

const LIFETIME_OPTIONS = [
  { value: 30, label: zh('30 天', '30 days') },
  { value: 90, label: zh('90 天', '90 days') },
  { value: 365, label: zh('1 年', '1 year') },
  { value: 0, label: zh('永不过期', 'Never expires') },
]

function formatDate(value) {
  if (!value || value === NEVER_EXPIRES) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function isExpired(token) {
  if (!token?.expires_at || token.expires_at === NEVER_EXPIRES) return false
  const date = new Date(token.expires_at)
  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now()
}

/**
 * 浏览器扩展令牌。
 *
 * 已核实的后端行为：**令牌明文存在数据库里，并且每次 `GET` 都会原样返回** ——
 * 不是「只显示一次」。所以这一页可以随时复制任意令牌，界面上如实说明这一点，
 * 不假装它是一次性的。
 *
 * 令牌只能访问三个接口：POST /extension/downloads、GET /extension/status、
 * POST /extension/jav/ownership。其它接口一律 403。
 */
export default function ExtensionTokenPage({ onClose }) {
  const showToast = useStore((state) => state.showToast)

  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [pending, setPending] = useState(null)
  const [name, setName] = useState('')
  const [lifetime, setLifetime] = useState(365)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [justCreated, setJustCreated] = useState(null)

  const { data, loading, error, reload } = useAsyncData(() => fetchExtensionTokens(), [])

  const tokens = Array.isArray(data) ? data : []

  const run = async (task, message) => {
    setBusy(true)
    setActionError('')
    try {
      await task()
      if (message) showToast(message)
      setPending(null)
      setDeleteTarget(null)
      setName('')
      reload()
      return true
    } catch (err) {
      setActionError(getErrorMessage(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  const copy = (value) => {
    if (!navigator.clipboard) {
      showToast(
        zh('当前环境不支持一键复制，请长按选择', 'Copy is unavailable here; select manually')
      )
      return
    }
    navigator.clipboard
      .writeText(String(value || ''))
      .then(() => showToast(zh('令牌已复制', 'Token copied')))
      .catch(() => showToast(zh('复制失败，请长按选择', 'Copy failed; select manually')))
  }

  const openCreate = () => {
    setActionError('')
    setName('')
    setLifetime(365)
    setPending({ action: 'create' })
  }

  const openRotate = (token) => {
    setActionError('')
    setLifetime(token?.expires_at === NEVER_EXPIRES ? 0 : 365)
    setPending({ action: 'rotate', token })
  }

  return (
    <SettingsPage
      title={zh('扩展令牌', 'Extension tokens')}
      subtitle={
        tokens.length ? zh(`${tokens.length} 个令牌`, `${tokens.length} tokens`) : undefined
      }
      onBack={onClose}
      loading={loading}
      error={error}
      onRetry={reload}
      footer={
        <button
          type="button"
          onClick={openCreate}
          className={buttonClass('primary', 'h-11 w-full')}
        >
          {zh('创建令牌', 'Create token')}
        </button>
      }
    >
      {actionError ? (
        <p className="mx-3 mt-3 rounded-card border border-red-200 bg-red-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-red-700">
          {actionError}
        </p>
      ) : null}

      {justCreated ? (
        <div className="mx-3 mt-3 rounded-card border border-emerald-200 bg-emerald-50 px-3.5 py-3">
          <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-emerald-800">
            <Icon name="check" size={14} />
            {zh('令牌已生成', 'Token created')}
          </p>
          <code className="mt-2 block break-all rounded-[8px] bg-white px-2.5 py-2 font-mono text-[11.5px] text-zinc-700">
            {justCreated}
          </code>
          <button
            type="button"
            onClick={() => copy(justCreated)}
            className={buttonClass('primary', 'mt-2.5 h-9 w-full text-[12.5px]')}
          >
            {zh('复制令牌', 'Copy token')}
          </button>
        </div>
      ) : null}

      {tokens.length === 0 ? (
        <div className="px-5 py-14 text-center">
          <Icon name="shield" size={26} className="mx-auto text-zinc-300" />
          <p className="mt-3 text-[13px] text-zinc-400">
            {zh('还没有扩展令牌', 'No extension tokens yet')}
          </p>
        </div>
      ) : (
        <div className="mx-3 mt-3 space-y-2.5">
          {tokens.map((token) => {
            const expired = isExpired(token)
            return (
              <div
                key={token.id}
                className="rounded-card bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(16,24,40,0.05)]"
              >
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[14px] text-zinc-800">
                    {token.name}
                  </span>
                  <span
                    className={`flex-none rounded px-1.5 py-[1px] text-[10.5px] font-semibold ${
                      expired ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
                    }`}
                  >
                    {expired ? zh('已过期', 'Expired') : zh('有效', 'Active')}
                  </span>
                </div>

                <code className="mt-2 block break-all rounded-[8px] bg-[#f7f8fa] px-2.5 py-2 font-mono text-[11px] text-zinc-600">
                  {token.token}
                </code>

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-400">
                  <span>
                    {token.expires_at === NEVER_EXPIRES
                      ? zh('永不过期', 'Never expires')
                      : zh(
                          `到期 ${formatDate(token.expires_at)}`,
                          `Expires ${formatDate(token.expires_at)}`
                        )}
                  </span>
                  <span>
                    {token.last_used_at
                      ? zh(
                          `最近使用 ${formatDate(token.last_used_at)}`,
                          `Used ${formatDate(token.last_used_at)}`
                        )
                      : zh('从未使用', 'Never used')}
                  </span>
                </div>

                <div className="mt-2.5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => copy(token.token)}
                    className={buttonClass('secondary', 'h-8 px-3 text-[12px]')}
                  >
                    {zh('复制', 'Copy')}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => openRotate(token)}
                    className={buttonClass('secondary', 'h-8 px-3 text-[12px]')}
                  >
                    {zh('重新生成', 'Rotate')}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setDeleteTarget(token)}
                    className={buttonClass('danger', 'h-8 px-3 text-[12px]')}
                  >
                    {zh('删除', 'Delete')}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="mx-3 mt-4 rounded-card bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
        <p className="flex items-start gap-2 text-[12px] leading-relaxed text-zinc-500">
          <Icon name="info" size={14} className="mt-[2px] flex-none text-zinc-400" />
          <span>
            {zh(
              '令牌供浏览器扩展使用，只能访问「下载任务、状态、JAV 归属」三个接口，其它接口即使令牌有效也会被拒绝。令牌明文保存在服务端数据库里，这里可以随时再次查看和复制。',
              'Tokens are for the browser extension and can only reach three endpoints (downloads, status, JAV ownership); everything else is rejected even with a valid token. Tokens are stored in plain text on the server and can be viewed or copied here at any time.'
            )}
          </span>
        </p>
      </div>

      <BottomSheet
        open={Boolean(pending)}
        title={
          pending?.action === 'rotate'
            ? zh('重新生成令牌', 'Rotate token')
            : zh('创建令牌', 'Create token')
        }
        onClose={() => setPending(null)}
        footer={
          <button
            type="button"
            disabled={busy || (pending?.action === 'create' && !name.trim())}
            onClick={() =>
              run(
                async () => {
                  if (pending?.action === 'rotate') {
                    const result = await rotateExtensionToken(Number(pending.token.id), lifetime)
                    setJustCreated(String(result?.token || result?.item?.token || ''))
                  } else {
                    const result = await createExtensionToken(name.trim(), lifetime)
                    setJustCreated(String(result?.token || result?.item?.token || ''))
                    setName('')
                  }
                },
                pending?.action === 'rotate'
                  ? zh(
                      '已生成新令牌，旧令牌立即失效',
                      'New token issued; the old one is now invalid'
                    )
                  : zh('令牌已创建', 'Token created')
              )
            }
            className={buttonClass('primary', 'h-11 w-full')}
          >
            {busy ? zh('处理中…', 'Working…') : zh('确定', 'Confirm')}
          </button>
        }
      >
        <div className="space-y-3 pb-3">
          {actionError ? (
            <p className="rounded-[10px] bg-red-50 px-3 py-2.5 text-[12px] leading-relaxed text-red-700">
              {actionError}
            </p>
          ) : null}

          {pending?.action === 'rotate' ? (
            <p className="rounded-[10px] bg-amber-50 px-3 py-2.5 text-[12px] leading-relaxed text-amber-800">
              {zh(
                '旧令牌会立即失效，正在使用它的扩展需要重新配置。',
                'The old token becomes invalid immediately; extensions using it must be reconfigured.'
              )}
            </p>
          ) : (
            <TextField
              label={zh('名称', 'Name')}
              value={name}
              onChange={(value) => setName(String(value).slice(0, 80))}
              placeholder={zh('例如：Chrome 扩展', 'e.g. Chrome extension')}
              autoComplete="off"
            />
          )}

          <PickerField
            label={zh('有效期', 'Lifetime')}
            value={lifetime}
            options={LIFETIME_OPTIONS}
            onChange={(value) => setLifetime(Number(value))}
          />
        </div>
      </BottomSheet>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={zh(`删除令牌「${deleteTarget?.name}」？`, `Delete “${deleteTarget?.name}”?`)}
        description={zh(
          '正在使用它的扩展会立即失去访问权限。这个操作不可撤销。',
          'Extensions using it lose access immediately. This cannot be undone.'
        )}
        confirmText={zh('删除', 'Delete')}
        danger
        busy={busy}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() =>
          run(
            () => deleteExtensionToken(Number(deleteTarget.id)),
            zh('令牌已删除', 'Token deleted')
          )
        }
      />
    </SettingsPage>
  )
}
