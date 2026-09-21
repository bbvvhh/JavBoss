import { useState } from 'react'

import {
  createStorageConnection,
  deleteStorageConnection,
  fetchStorageConnections,
  testStorageConnection,
  updateStorageConnection,
} from '@/api'
import BottomSheet from '@/components/BottomSheet'
import ConfirmDialog from '@/components/ConfirmDialog'
import Icon from '@/components/Icons'
import SettingsPage from '@/components/settings/SettingsPage'
import TextField from '@/components/form/TextField'
import { buttonClass } from '@/components/form/Field'
import useAsyncData from '@/hooks/useAsyncData'
import { useStore } from '@/store'
import { getErrorMessage } from '@/utils/errors'
import { zh } from '@/utils/i18n'

const EMPTY_FORM = { id: null, name: '', url: '', username: '', password: '' }

/**
 * 存储连接（只支持 WebDAV）。
 *
 * 两个必须记住的后端语义：
 *   1. `PATCH` 是真正的部分更新 —— **不带 password 键 = 保留原密码**。
 *      所以在编辑模式下，只有用户真的填了新密码才会把它放进请求体；
 *      空字符串会**清空**已保存的密码（这是个陷阱，不能在编辑时无脑提交空值）。
 *   2. 密码永远不会被返回，列表里只有 `has_password` 布尔值。
 *      编辑时必须让用户知道「留空 = 不改」。
 */
export default function StorageConnectionPage({ onClose }) {
  const showToast = useStore((state) => state.showToast)

  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [form, setForm] = useState(null)
  const [testPath, setTestPath] = useState('')
  const [testResult, setTestResult] = useState(null)
  const [removeTarget, setRemoveTarget] = useState(null)

  const { data, loading, error, reload } = useAsyncData(() => fetchStorageConnections(), [])

  const connections = Array.isArray(data) ? data : []

  const run = async (task, message) => {
    setBusy(true)
    setActionError('')
    try {
      await task()
      if (message) showToast(message)
      setForm(null)
      setRemoveTarget(null)
      reload()
      return true
    } catch (err) {
      setActionError(getErrorMessage(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  const openCreate = () => {
    setActionError('')
    setTestResult(null)
    setTestPath('')
    setForm({ ...EMPTY_FORM })
  }

  const openEdit = (connection) => {
    setActionError('')
    setTestResult(null)
    setTestPath('')
    setForm({
      id: Number(connection.id),
      name: String(connection.name || ''),
      url: String(connection.url || ''),
      username: String(connection.username || ''),
      password: '',
    })
  }

  const save = () => {
    const name = String(form?.name || '').trim()
    const url = String(form?.url || '').trim()
    if (!name) {
      setActionError(zh('连接名称不能为空', 'Connection name is required'))
      return
    }
    if (!url) {
      setActionError(zh('WebDAV 地址不能为空', 'WebDAV address is required'))
      return
    }

    const payload = { name, url, username: String(form.username || '').trim() }
    // 关键：编辑时留空表示「保持原密码」，绝不能把空字符串发出去（那会清空密码）。
    if (String(form.password || '')) payload.password = String(form.password)

    return run(
      () =>
        form.id ? updateStorageConnection(form.id, payload) : createStorageConnection(payload),
      form.id ? zh('连接已更新', 'Connection updated') : zh('连接已创建', 'Connection created')
    )
  }

  const test = async () => {
    setBusy(true)
    setActionError('')
    setTestResult(null)
    try {
      const result = await testStorageConnection({
        connectionId: form?.id || undefined,
        url: form?.url ? String(form.url).trim() : undefined,
        username: form?.username ? String(form.username).trim() : undefined,
        password: String(form?.password || '') || undefined,
        path: testPath.trim() || undefined,
      })
      setTestResult({
        ok: true,
        text: zh(
          `连接成功${result?.name ? ` · ${result.name}` : ''}${result?.path ? ` · ${result.path}` : ''}`,
          `Connected${result?.name ? ` · ${result.name}` : ''}${result?.path ? ` · ${result.path}` : ''}`
        ),
      })
    } catch (err) {
      setTestResult({ ok: false, text: getErrorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsPage
      title={zh('存储连接', 'Storage connections')}
      subtitle={zh('WebDAV 远程来源', 'WebDAV remote sources')}
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
          {zh('添加 WebDAV 连接', 'Add WebDAV connection')}
        </button>
      }
    >
      {actionError && !form ? (
        <p className="mx-3 mt-3 rounded-card border border-red-200 bg-red-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-red-700">
          {actionError}
        </p>
      ) : null}

      {connections.length === 0 ? (
        <div className="px-5 py-14 text-center">
          <Icon name="layers" size={26} className="mx-auto text-zinc-300" />
          <p className="mt-3 text-[13px] text-zinc-400">
            {zh('还没有远程连接', 'No remote connections yet')}
          </p>
        </div>
      ) : (
        <div className="mx-3 mt-3 overflow-hidden rounded-card bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
          {connections.map((connection) => (
            <div
              key={connection.id}
              className="flex items-center gap-2 border-t border-[#f1f2f5] px-3.5 py-3 first:border-t-0"
            >
              <button
                type="button"
                onClick={() => openEdit(connection)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-[14px] text-zinc-800">{connection.name}</span>
                <span className="mt-0.5 block truncate text-[11.5px] text-zinc-400">
                  {connection.url}
                  {connection.username ? ` · ${connection.username}` : ''}
                </span>
                <span className="mt-0.5 block text-[11px] text-zinc-400">
                  {zh(
                    `${connection.directory_count || 0} 个目录 · ${
                      connection.has_password ? '已保存密码' : '无密码'
                    }`,
                    `${connection.directory_count || 0} directories · ${
                      connection.has_password ? 'password saved' : 'no password'
                    }`
                  )}
                </span>
              </button>
              <button
                type="button"
                aria-label={zh('删除', 'Delete')}
                onClick={() => setRemoveTarget(connection)}
                className="grid h-8 w-8 flex-none place-items-center rounded-lg text-red-500 active:bg-red-50"
              >
                <Icon name="trash" size={15} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mx-3 mt-4 rounded-card bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
        <p className="flex items-start gap-2 text-[12px] leading-relaxed text-zinc-500">
          <Icon name="shield" size={14} className="mt-[2px] flex-none text-emerald-600" />
          <span>
            {zh(
              '远程连接是只读来源：JavBoss 只会扫描和播放，不会修改远程文件。密码保存在服务端，永远不会回传给浏览器。',
              'Remote connections are read-only: JavBoss only scans and plays, and never modifies remote files. Passwords stay on the server and are never sent back to the browser.'
            )}
          </span>
        </p>
      </div>

      <BottomSheet
        open={Boolean(form)}
        title={
          form?.id
            ? zh('编辑连接', 'Edit connection')
            : zh('添加 WebDAV 连接', 'Add WebDAV connection')
        }
        onClose={() => setForm(null)}
        footer={
          <div className="flex w-full gap-2.5">
            <button
              type="button"
              disabled={busy}
              onClick={test}
              className={buttonClass('secondary', 'h-11 flex-1')}
            >
              {zh('测试', 'Test')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={save}
              className={buttonClass('primary', 'h-11 flex-1')}
            >
              {busy ? zh('保存中…', 'Saving…') : zh('保存', 'Save')}
            </button>
          </div>
        }
      >
        <div className="space-y-3 pb-3">
          {actionError ? (
            <p className="rounded-[10px] bg-red-50 px-3 py-2.5 text-[12px] leading-relaxed text-red-700">
              {actionError}
            </p>
          ) : null}

          <TextField
            label={zh('名称', 'Name')}
            value={form?.name || ''}
            onChange={(value) => setForm((prev) => ({ ...prev, name: value }))}
            placeholder={zh('例如：家里的 NAS', 'e.g. Home NAS')}
            autoComplete="off"
          />
          <TextField
            label={zh('WebDAV 地址', 'WebDAV URL')}
            value={form?.url || ''}
            onChange={(value) => setForm((prev) => ({ ...prev, url: value }))}
            placeholder="https://example.com/dav"
            autoComplete="off"
          />
          <TextField
            label={zh('用户名', 'Username')}
            value={form?.username || ''}
            onChange={(value) => setForm((prev) => ({ ...prev, username: value }))}
            autoComplete="off"
          />
          <TextField
            label={
              form?.id
                ? zh('密码（留空保持不变）', 'Password (blank keeps current)')
                : zh('密码', 'Password')
            }
            value={form?.password || ''}
            onChange={(value) => setForm((prev) => ({ ...prev, password: value }))}
            secret
            autoComplete="new-password"
            hint={
              form?.id
                ? zh(
                    '只有填写了新密码才会覆盖；留空表示继续使用已保存的密码。',
                    'Only a non-empty value replaces it; leaving it blank keeps the stored password.'
                  )
                : undefined
            }
          />
          <TextField
            label={zh('测试路径（可选）', 'Test path (optional)')}
            value={testPath}
            onChange={setTestPath}
            placeholder="/JAV"
            autoComplete="off"
            hint={zh('只用于「测试」按钮，不会被保存', 'Only used by the Test button; never saved')}
          />

          {testResult ? (
            <p
              className={`rounded-[10px] px-3 py-2.5 text-[12px] leading-relaxed ${
                testResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
              }`}
            >
              {testResult.text}
            </p>
          ) : null}
        </div>
      </BottomSheet>

      <ConfirmDialog
        open={Boolean(removeTarget)}
        title={zh(`删除连接「${removeTarget?.name}」？`, `Delete “${removeTarget?.name}”?`)}
        description={zh(
          '使用这个连接的目录会失去来源，扫描时会报错。远程服务器上的文件不会被改动。',
          'Directories using this connection lose their source and will fail to scan. Files on the remote server are not touched.'
        )}
        confirmText={zh('删除', 'Delete')}
        danger
        busy={busy}
        onClose={() => setRemoveTarget(null)}
        onConfirm={() =>
          run(
            () => deleteStorageConnection(Number(removeTarget.id)),
            zh('连接已删除', 'Connection deleted')
          )
        }
      />
    </SettingsPage>
  )
}
