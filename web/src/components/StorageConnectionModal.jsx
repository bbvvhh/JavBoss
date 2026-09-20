import { useEffect, useState } from 'react'
import CloseOutlinedIcon from '@mui/icons-material/CloseOutlined'
import { CircularProgress, IconButton } from '@mui/material'

import {
  createStorageConnection,
  deleteStorageConnection,
  fetchStorageConnections,
  testStorageConnection,
  updateStorageConnection,
} from '@/api'
import AppModal from '@/components/AppModal'
import { getErrorMessage } from '@/utils/errors'
import { zh } from '@/utils/i18n'

const emptyForm = () => ({ id: null, name: '', url: '', username: '', password: '', path: '' })

const inputClassName =
  'w-full rounded border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-blue-500'

export default function StorageConnectionModal({ open = true, onClose, onChanged }) {
  const [connections, setConnections] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [actionError, setActionError] = useState('')
  const [testResult, setTestResult] = useState(null)
  const [testing, setTesting] = useState(false)
  const [deletingId, setDeletingId] = useState(null)

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    setLoading(true)
    fetchStorageConnections()
      .then((list) => {
        if (cancelled) return
        setConnections(Array.isArray(list) ? list : [])
        setLoadError('')
      })
      .catch((err) => {
        if (cancelled) return
        setConnections([])
        setLoadError(getErrorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, reloadToken])

  useEffect(() => {
    if (open) return
    setForm(emptyForm())
    setFormError('')
    setActionError('')
    setTestResult(null)
    setDeletingId(null)
    setLoadError('')
  }, [open])

  const updateField = (field) => (event) =>
    setForm((previous) => ({ ...previous, [field]: event.target.value }))

  const startEdit = (connection) => {
    setForm({
      id: connection?.id ?? null,
      name: String(connection?.name || ''),
      url: String(connection?.url || ''),
      username: String(connection?.username || ''),
      password: '',
      path: '',
    })
    setFormError('')
    setActionError('')
    setTestResult(null)
  }

  const resetForm = () => {
    setForm(emptyForm())
    setFormError('')
    setTestResult(null)
  }

  const handleSubmit = async (event) => {
    event?.preventDefault?.()
    const name = form.name.trim()
    const url = form.url.trim()
    if (!name) {
      setFormError(zh('连接名称不能为空', 'Connection name cannot be empty'))
      return
    }
    if (!url) {
      setFormError(zh('WebDAV 地址不能为空', 'WebDAV URL cannot be empty'))
      return
    }
    // A blank password keeps the stored one while editing an existing connection.
    const payload = { name, url, username: form.username.trim() }
    if (form.password) payload.password = form.password

    setSaving(true)
    setFormError('')
    setActionError('')
    setTestResult(null)
    try {
      if (form.id) {
        await updateStorageConnection(form.id, payload)
      } else {
        await createStorageConnection(payload)
      }
      setForm(emptyForm())
      setReloadToken((token) => token + 1)
      await onChanged?.()
    } catch (err) {
      setFormError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setFormError('')
    setTestResult(null)
    try {
      const result = await testStorageConnection({
        connectionId: form.id || undefined,
        url: form.url.trim() || undefined,
        username: form.username.trim() || undefined,
        password: form.password || undefined,
        path: form.path.trim() || undefined,
      })
      const label = String(result?.name || form.name || '').trim()
      setTestResult({
        ok: true,
        message: label
          ? zh(`连接成功：${label}`, `Connected: ${label}`)
          : zh('连接成功', 'Connected successfully'),
        detail: String(result?.path || ''),
      })
    } catch (err) {
      setTestResult({ ok: false, message: getErrorMessage(err), detail: '' })
    } finally {
      setTesting(false)
    }
  }

  const handleDelete = async (connection) => {
    if (!connection?.id || deletingId != null) return
    const label = String(connection.name || connection.url || `#${connection.id}`)
    if (
      !window.confirm(
        zh(
          `确定删除连接“${label}”吗？使用该连接的目录会失去来源。`,
          `Delete connection "${label}"? Directories using it will lose their source.`
        )
      )
    ) {
      return
    }
    setDeletingId(connection.id)
    setFormError('')
    setActionError('')
    setTestResult(null)
    try {
      await deleteStorageConnection(connection.id)
      if (form.id === connection.id) setForm(emptyForm())
      setReloadToken((token) => token + 1)
      await onChanged?.()
    } catch (err) {
      // A 409 means directories still use this connection; show the server message.
      setActionError(getErrorMessage(err))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <AppModal
      ariaLabel={zh('WebDAV 连接管理', 'WebDAV Connections')}
      contentClassName="mx-4 flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-slate-200/70"
      onClose={onClose}
      zIndex={1500}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200/70 bg-slate-50/80 px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            {zh('WebDAV 连接管理', 'WebDAV Connections')}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            {zh(
              '远程连接为只读来源，JavBoss 只会扫描和播放，不会修改远程文件。',
              'Remote sources are read-only: JavBoss scans and plays them without changing remote files.'
            )}
          </p>
        </div>
        <IconButton
          type="button"
          size="small"
          onClick={onClose}
          aria-label={zh('关闭连接管理', 'Close connection manager')}
          title={zh('关闭', 'Close')}
        >
          <CloseOutlinedIcon fontSize="small" />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
        <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-zinc-200 p-4">
          <div className="text-sm font-semibold text-zinc-900">
            {form.id ? zh('编辑连接', 'Edit connection') : zh('新建连接', 'New connection')}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs text-zinc-600">
              <span>{zh('名称', 'Name')}</span>
              <input
                value={form.name}
                onChange={updateField('name')}
                placeholder={zh('例如：家里的 NAS', 'e.g. Home NAS')}
                className={inputClassName}
              />
            </label>
            <label className="space-y-1 text-xs text-zinc-600">
              <span>{zh('WebDAV 地址', 'WebDAV URL')}</span>
              <input
                value={form.url}
                onChange={updateField('url')}
                placeholder="https://example.com/dav"
                className={inputClassName}
              />
            </label>
            <label className="space-y-1 text-xs text-zinc-600">
              <span>{zh('用户名', 'Username')}</span>
              <input
                value={form.username}
                onChange={updateField('username')}
                autoComplete="off"
                className={inputClassName}
              />
            </label>
            <label className="space-y-1 text-xs text-zinc-600">
              <span>
                {form.id
                  ? zh('密码（留空保持不变）', 'Password (leave blank to keep)')
                  : zh('密码', 'Password')}
              </span>
              <input
                type="password"
                value={form.password}
                onChange={updateField('password')}
                autoComplete="new-password"
                className={inputClassName}
              />
            </label>
            <label className="space-y-1 text-xs text-zinc-600 sm:col-span-2">
              <span>{zh('测试路径（可选）', 'Test path (optional)')}</span>
              <input
                value={form.path}
                onChange={updateField('path')}
                placeholder="/JAV/HD"
                className={inputClassName}
              />
            </label>
          </div>
          {testResult && (
            <div
              role="status"
              className={`text-sm ${testResult.ok ? 'text-emerald-700' : 'text-rose-600'}`}
            >
              {testResult.message}
              {testResult.detail ? (
                <span className="ml-1 break-all text-xs text-zinc-500">{testResult.detail}</span>
              ) : null}
            </div>
          )}
          {formError && <div className="text-sm text-rose-600">{formError}</div>}
          <div className="flex flex-wrap justify-end gap-2">
            {form.id ? (
              <button
                type="button"
                onClick={resetForm}
                disabled={saving || testing}
                className="rounded border px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
              >
                {zh('取消编辑', 'Cancel edit')}
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleTest}
              disabled={testing || saving}
              className="rounded border px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
            >
              {testing ? zh('测试中…', 'Testing...') : zh('测试连接', 'Test connection')}
            </button>
            <button
              type="submit"
              disabled={saving || testing}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {saving
                ? zh('保存中…', 'Saving...')
                : form.id
                  ? zh('保存', 'Save')
                  : zh('新建连接', 'Create connection')}
            </button>
          </div>
        </form>

        <div className="space-y-2">
          <div className="text-sm font-semibold text-zinc-900">{zh('连接列表', 'Connections')}</div>
          {actionError && <div className="text-sm text-rose-600">{actionError}</div>}
          {loading ? (
            <div role="status" className="flex items-center gap-2 py-4 text-sm text-zinc-500">
              <CircularProgress size={16} />
              {zh('正在读取连接…', 'Loading connections…')}
            </div>
          ) : loadError ? (
            <div role="alert" className="py-2 text-sm text-rose-600">
              {loadError}
            </div>
          ) : connections.length === 0 ? (
            <div className="py-2 text-sm text-zinc-500">
              {zh('还没有 WebDAV 连接。', 'No WebDAV connections yet.')}
            </div>
          ) : (
            <ul className="space-y-2">
              {connections.map((connection) => {
                const editing = form.id === connection.id
                const busy = deletingId === connection.id || saving
                return (
                  <li
                    key={connection.id}
                    className={`flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between ${
                      editing ? 'border-blue-300 bg-blue-50' : 'border-zinc-200'
                    }`}
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="truncate text-sm font-medium text-zinc-900">
                        {connection.name}
                      </div>
                      <div className="break-all text-xs text-zinc-500">{connection.url}</div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                        <span>
                          {zh('用户名：', 'Username: ')}
                          {String(connection.username || '').trim() || zh('未设置', 'Not set')}
                        </span>
                        <span>
                          {connection.has_password
                            ? zh('已保存密码', 'Password saved')
                            : zh('无密码', 'No password')}
                        </span>
                        <span>
                          {zh(
                            `使用中的目录：${Number(connection.directory_count) || 0}`,
                            `Directories: ${Number(connection.directory_count) || 0}`
                          )}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(connection)}
                        disabled={busy}
                        className="rounded border px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
                      >
                        {zh('编辑', 'Edit')}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(connection)}
                        disabled={busy}
                        className="rounded border border-rose-200 px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-60"
                      >
                        {deletingId === connection.id
                          ? zh('删除中…', 'Deleting...')
                          : zh('删除', 'Delete')}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
      <div className="flex shrink-0 justify-end border-t border-slate-200/70 bg-slate-50/80 px-6 py-4">
        <button
          type="button"
          onClick={onClose}
          disabled={saving || testing || deletingId != null}
          className="rounded border bg-white px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-60"
        >
          {zh('关闭', 'Close')}
        </button>
      </div>
    </AppModal>
  )
}
