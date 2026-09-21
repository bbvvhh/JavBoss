import { useMemo, useState } from 'react'

import {
  createJavFavoriteGroup,
  deleteJavFavoriteGroup,
  fetchJavFavoriteGroupItems,
  fetchJavFavoriteGroups,
  removeJavFavoriteGroupItems,
  renameJavFavoriteGroup,
  reorderJavFavoriteGroupItems,
  reorderJavFavoriteGroups,
} from '@/api'
import ConfirmDialog from '@/components/ConfirmDialog'
import Icon from '@/components/Icons'
import SettingsPage from '@/components/settings/SettingsPage'
import PromptSheet from '@/components/form/PromptSheet'
import { buttonClass } from '@/components/form/Field'
import useAsyncData from '@/hooks/useAsyncData'
import { useStore } from '@/store'
import { getErrorMessage } from '@/utils/errors'
import { zh } from '@/utils/i18n'

const ENTITIES = [
  { value: 'jav', label: zh('作品', 'Works'), unit: zh('部', 'works') },
  { value: 'idol', label: zh('女优', 'Idols'), unit: zh('位', 'idols') },
  { value: 'studio', label: zh('片商', 'Studios'), unit: zh('个', 'studios') },
  { value: 'series', label: zh('系列', 'Series'), unit: zh('个', 'series') },
]

function entityMeta(type) {
  return ENTITIES.find((item) => item.value === type) || ENTITIES[0]
}

/**
 * 收藏夹管理（作品 / 女优 / 片商 / 系列四类）。
 *
 * 后端把四类拆成 `/jav/<type>-favorite-groups` 四套同形路由，所以这里用一个
 * 实体切换器 + 同一套列表，不再写四份。
 *
 * 与 PC 端的差异：
 *   - 拖拽排序 → 「上移 / 下移」按钮，提交的都是**完整有序 id 数组**。
 *   - 收藏夹顺序的 `sort_order` 是 1 起（`index + 1`），且数组必须**穷举该类型的
 *     全部收藏夹**，不能带任何哨兵值（这点和标签分类相反）。
 */
export default function FavoriteGroupPage({ onClose }) {
  const showToast = useStore((state) => state.showToast)
  const pushPage = useStore((state) => state.pushPage)

  const [entity, setEntity] = useState('jav')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [prompt, setPrompt] = useState(null)
  const [confirm, setConfirm] = useState(null)

  const { data, loading, error, reload } = useAsyncData(
    () => fetchJavFavoriteGroups(entity),
    [entity]
  )

  const groups = useMemo(() => {
    const list = Array.isArray(data) ? [...data] : []
    return list.sort(
      (a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || Number(a.id) - Number(b.id)
    )
  }, [data])

  const meta = entityMeta(entity)

  const run = async (task, message) => {
    setBusy(true)
    setActionError('')
    try {
      await task()
      if (message) showToast(message)
      setPrompt(null)
      setConfirm(null)
      reload()
    } catch (err) {
      setActionError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const move = (group, delta) => {
    const ids = groups.map((item) => Number(item.id))
    const from = ids.indexOf(Number(group.id))
    const to = from + delta
    if (from < 0 || to < 0 || to >= ids.length) return
    const next = [...ids]
    ;[next[from], next[to]] = [next[to], next[from]]
    run(() => reorderJavFavoriteGroups(entity, next), zh('顺序已更新', 'Order updated'))
  }

  return (
    <SettingsPage
      title={zh('收藏夹管理', 'Favourites')}
      subtitle={zh(`${groups.length} 个 · ${meta.label}`, `${groups.length} · ${meta.label}`)}
      onBack={onClose}
      loading={loading}
      error={error}
      onRetry={reload}
      footer={
        <button
          type="button"
          onClick={() => setPrompt({ action: 'create' })}
          className={buttonClass('primary', 'h-11 w-full')}
        >
          {zh(`新建${meta.label}收藏夹`, `New ${meta.label.toLowerCase()} group`)}
        </button>
      }
    >
      <div className="sticky top-0 z-10 border-b border-[#e6e8ec] bg-white px-3 py-2">
        <div className="flex gap-1 rounded-[10px] bg-zinc-100 p-1">
          {ENTITIES.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setEntity(item.value)}
              className={`min-w-0 flex-1 truncate rounded-[8px] px-2 py-1.5 text-[12.5px] ${
                item.value === entity
                  ? 'bg-white font-semibold text-brand-ink shadow-sm'
                  : 'text-zinc-600'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {actionError ? (
        <p className="mx-3 mt-3 rounded-card border border-red-200 bg-red-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-red-700">
          {actionError}
        </p>
      ) : null}

      {groups.length === 0 ? (
        <div className="px-5 py-14 text-center">
          <Icon name="heart" size={26} className="mx-auto text-zinc-300" />
          <p className="mt-3 text-[13px] text-zinc-400">
            {zh(`还没有${meta.label}收藏夹`, `No ${meta.label.toLowerCase()} groups yet`)}
          </p>
        </div>
      ) : (
        <div className="mx-3 mt-3 overflow-hidden rounded-card bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
          {groups.map((group, index) => (
            <div
              key={group.id}
              className="flex items-center gap-2 border-t border-[#f1f2f5] px-3 py-2.5 first:border-t-0"
            >
              <button
                type="button"
                onClick={() => pushPage('settings:favorite-items', { entity, group })}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-[14px] text-zinc-800">{group.name}</span>
                <span className="mt-0.5 block text-[11.5px] text-zinc-400">
                  {zh(`${group.count || 0} ${meta.unit}`, `${group.count || 0} ${meta.unit}`)}
                </span>
              </button>

              <div className="flex flex-none items-center gap-0.5">
                <IconButton
                  icon="arrowUp"
                  label={zh('上移', 'Move up')}
                  disabled={busy || index === 0}
                  onClick={() => move(group, -1)}
                />
                <IconButton
                  icon="arrowDown"
                  label={zh('下移', 'Move down')}
                  disabled={busy || index === groups.length - 1}
                  onClick={() => move(group, 1)}
                />
                <IconButton
                  icon="rename"
                  label={zh('重命名', 'Rename')}
                  disabled={busy}
                  onClick={() =>
                    setPrompt({ action: 'rename', group, initialValue: String(group.name || '') })
                  }
                />
                <IconButton
                  icon="trash"
                  label={zh('删除', 'Delete')}
                  danger
                  disabled={busy}
                  onClick={() =>
                    setConfirm({
                      group,
                      title: zh(`删除收藏夹「${group.name}」？`, `Delete “${group.name}”?`),
                      description: zh(
                        '只会取消这个分组，里面的作品 / 女优本身不会被删除。',
                        'Only this grouping is removed. The works or idols themselves stay.'
                      ),
                    })
                  }
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="px-5 pt-5 text-center text-[11px] leading-relaxed text-zinc-400">
        {zh(
          '收藏夹只是分组信息，删除它不会影响任何视频文件或刮削数据。',
          'Groups are just labels. Deleting one affects no video files or scraped data.'
        )}
      </p>

      <PromptSheet
        open={Boolean(prompt)}
        title={
          prompt?.action === 'rename'
            ? zh('重命名收藏夹', 'Rename group')
            : zh('新建收藏夹', 'New group')
        }
        label={zh('收藏夹名称', 'Group name')}
        initialValue={prompt?.initialValue || ''}
        busy={busy}
        error={actionError}
        onClose={() => setPrompt(null)}
        onConfirm={(value) =>
          prompt?.action === 'rename'
            ? run(
                () => renameJavFavoriteGroup(entity, Number(prompt.group.id), value),
                zh('已重命名', 'Renamed')
              )
            : run(() => createJavFavoriteGroup(entity, value), zh('收藏夹已创建', 'Group created'))
        }
      />

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.title || ''}
        description={confirm?.description || ''}
        confirmText={zh('删除', 'Delete')}
        danger
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={() =>
          run(
            () => deleteJavFavoriteGroup(entity, Number(confirm.group.id)),
            zh('收藏夹已删除', 'Group deleted')
          )
        }
      />
    </SettingsPage>
  )
}

/**
 * 收藏夹里的条目。
 *
 * 作为**独立的一级页面**压入页面栈（而不是本页内部状态），这样右滑 / 物理返回键
 * 只需要处理一条栈记录；如果做成内部状态，App 与页面会各注册一个 popstate
 * 监听，一次返回会同时关掉两层。
 */
export function FavoriteItemsPage({ payload, onClose }) {
  const showToast = useStore((state) => state.showToast)
  const entity = payload?.entity || 'jav'
  const group = payload?.group || null
  const meta = entityMeta(entity)

  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [selectionMode, setSelectionMode] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const { data, loading, error, reload } = useAsyncData(
    () => fetchJavFavoriteGroupItems(entity, Number(group?.id)),
    [entity, group?.id]
  )

  const items = useMemo(() => (Array.isArray(data) ? data : []), [data])

  const run = async (task, message) => {
    setBusy(true)
    setActionError('')
    try {
      await task()
      if (message) showToast(message)
      setConfirmOpen(false)
      setSelected(new Set())
      setSelectionMode(false)
      reload()
    } catch (err) {
      setActionError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const move = (item, delta) => {
    const ids = items.map((entry) => Number(entry.id))
    const from = ids.indexOf(Number(item.id))
    const to = from + delta
    if (from < 0 || to < 0 || to >= ids.length) return
    const next = [...ids]
    ;[next[from], next[to]] = [next[to], next[from]]
    run(
      () => reorderJavFavoriteGroupItems(entity, Number(group?.id), next),
      zh('顺序已更新', 'Order updated')
    )
  }

  const toggle = (item) => {
    const id = Number(item.id)
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <SettingsPage
      title={String(group?.name || zh('收藏夹', 'Group'))}
      subtitle={zh(`${items.length} ${meta.unit}`, `${items.length} ${meta.unit}`)}
      onBack={onClose}
      loading={loading}
      error={error}
      onRetry={reload}
      headerRight={
        items.length ? (
          <button
            type="button"
            onClick={() => {
              setSelectionMode((prev) => !prev)
              setSelected(new Set())
            }}
            className="flex-none px-2 text-[13px] font-medium text-brand-ink"
          >
            {selectionMode ? zh('取消', 'Cancel') : zh('选择', 'Select')}
          </button>
        ) : null
      }
      footer={
        selectionMode ? (
          <button
            type="button"
            disabled={!selected.size || busy}
            onClick={() => setConfirmOpen(true)}
            className={buttonClass('danger', 'h-11 w-full')}
          >
            {zh(`移出收藏夹（${selected.size}）`, `Remove from group (${selected.size})`)}
          </button>
        ) : null
      }
    >
      {actionError ? (
        <p className="mx-3 mt-3 rounded-card border border-red-200 bg-red-50 px-3.5 py-2.5 text-[12px] text-red-700">
          {actionError}
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="py-14 text-center text-[13px] text-zinc-400">
          {zh('这个收藏夹还是空的', 'This group is empty')}
        </p>
      ) : (
        <div className="mx-3 mt-3 overflow-hidden rounded-card bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
          {items.map((item, index) => {
            const id = Number(item.id)
            const active = selected.has(id)
            return (
              <div
                key={id}
                className="flex items-center gap-2.5 border-t border-[#f1f2f5] px-3 py-2.5 first:border-t-0"
              >
                {selectionMode ? (
                  <button
                    type="button"
                    onClick={() => toggle(item)}
                    aria-label={zh('选择', 'Select')}
                    className={`grid h-5 w-5 flex-none place-items-center rounded-[6px] border ${
                      active ? 'border-brand bg-brand text-white' : 'border-zinc-300 bg-white'
                    }`}
                  >
                    {active ? <Icon name="check" size={12} /> : null}
                  </button>
                ) : (
                  <span className="grid h-5 w-5 flex-none place-items-center text-[11px] tabular-nums text-zinc-300">
                    {index + 1}
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] text-zinc-800">
                    {item.name || item.code || `#${id}`}
                  </span>
                  {item.work_count ? (
                    <span className="mt-0.5 block text-[11.5px] text-zinc-400">
                      {zh(`${item.work_count} 部作品`, `${item.work_count} works`)}
                    </span>
                  ) : null}
                </div>

                {!selectionMode ? (
                  <div className="flex flex-none items-center gap-0.5">
                    <IconButton
                      icon="arrowUp"
                      label={zh('上移', 'Move up')}
                      disabled={busy || index === 0}
                      onClick={() => move(item, -1)}
                    />
                    <IconButton
                      icon="arrowDown"
                      label={zh('下移', 'Move down')}
                      disabled={busy || index === items.length - 1}
                      onClick={() => move(item, 1)}
                    />
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={zh(`移出 ${selected.size} 项？`, `Remove ${selected.size} item(s)?`)}
        description={zh(
          '只会把它们从这个收藏夹里移出，作品 / 女优本身以及视频文件都不受影响。',
          'They are only removed from this group. The items themselves and all video files are unaffected.'
        )}
        confirmText={zh('移出', 'Remove')}
        danger
        busy={busy}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() =>
          run(
            () => removeJavFavoriteGroupItems(entity, Number(group?.id), Array.from(selected)),
            zh('已移出收藏夹', 'Removed from group')
          )
        }
      />
    </SettingsPage>
  )
}

function IconButton({ icon, label, onClick, disabled = false, danger = false }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-8 w-8 place-items-center rounded-lg ${
        disabled ? 'text-zinc-200' : danger ? 'text-red-500' : 'text-zinc-400'
      } active:bg-zinc-100`}
    >
      <Icon name={icon} size={15} />
    </button>
  )
}
