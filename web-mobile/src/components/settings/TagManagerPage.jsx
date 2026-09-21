import { useMemo, useState } from 'react'

import {
  assignJavTagsCategory,
  assignTagsCategory,
  createJavTag,
  createJavTagCategory,
  createTag,
  createTagCategory,
  deleteJavTag,
  deleteJavTagCategory,
  deleteJavTagsBatch,
  deleteTag,
  deleteTagCategory,
  deleteTagsBatch,
  fetchJavTagCategories,
  fetchJavTags,
  fetchTagCategories,
  fetchTags,
  organizeJavTags,
  renameJavTag,
  renameJavTagCategory,
  renameTag,
  renameTagCategory,
  reorderJavTagCategories,
  reorderTagCategories,
} from '@/api'
import BottomSheet from '@/components/BottomSheet'
import ConfirmDialog from '@/components/ConfirmDialog'
import Icon from '@/components/Icons'
import SettingsPage from '@/components/settings/SettingsPage'
import PromptSheet from '@/components/form/PromptSheet'
import { buttonClass } from '@/components/form/Field'
import useAsyncData from '@/hooks/useAsyncData'
import { useStore } from '@/store'
import { getErrorMessage } from '@/utils/errors'
import { javDisplayPrefs, javTagDisplayName } from '@/utils/javDisplay'
import { zh } from '@/utils/i18n'

/** 后端虚拟出来的「默认分类」：没有数据库行，id 固定为 0。 */
const DEFAULT_CATEGORY = { id: 0, name: zh('默认分类', 'Default'), isDefault: true }

const VIDEO_API = {
  fetchTags,
  fetchCategories: fetchTagCategories,
  createTag,
  renameTag,
  deleteTag,
  deleteTagsBatch,
  createCategory: createTagCategory,
  renameCategory: renameTagCategory,
  deleteCategory: deleteTagCategory,
  reorderCategories: reorderTagCategories,
  assignCategory: assignTagsCategory,
}

const JAV_API = {
  fetchTags: fetchJavTags,
  fetchCategories: fetchJavTagCategories,
  createTag: createJavTag,
  renameTag: renameJavTag,
  deleteTag: deleteJavTag,
  deleteTagsBatch: deleteJavTagsBatch,
  createCategory: createJavTagCategory,
  renameCategory: renameJavTagCategory,
  deleteCategory: deleteJavTagCategory,
  reorderCategories: reorderJavTagCategories,
  assignCategory: assignJavTagsCategory,
}

/** JAV 标签：只有用户标签（provider 3）可以改名 / 删除，刮削标签由服务端保护。 */
function isEditable(tag, mode) {
  if (mode !== 'jav') return true
  return Number(tag?.provider) === 3
}

function normalizeTags(data) {
  if (Array.isArray(data)) return data
  return Array.isArray(data?.items) ? data.items : []
}

function normalizeCategories(data) {
  if (Array.isArray(data)) return data
  return Array.isArray(data?.items) ? data.items : []
}

/**
 * 视频标签 / JAV 标签管理。
 *
 * 与 PC 端的差异（都是因为手机没有鼠标）：
 *   1. PC 的改名 / 删除按钮只在 `hover` 时出现，触摸设备上等于不存在；
 *      这里改成**点标签弹底部抽屉**，动作全部显式列出。
 *   2. PC 用拖拽调整分类顺序，这里改成分类抽屉里的「上移 / 下移」——
 *      两者提交的都是同一种「完整有序 id 数组」，语义完全一致。
 *   3. 分类顺序数组**必须包含哨兵 0**，且长度等于「数据库里的分类数 + 1」，
 *      否则后端直接 400（internal/db/tags.go:134-180）。
 */
export default function TagManagerPage({ mode = 'video', onClose }) {
  const config = useStore((state) => state.config)
  const showToast = useStore((state) => state.showToast)
  const prefs = javDisplayPrefs(config)
  const api = mode === 'jav' ? JAV_API : VIDEO_API
  const isJav = mode === 'jav'

  const { data, loading, error, reload } = useAsyncData(
    () => Promise.all([api.fetchTags(), api.fetchCategories()]),
    [mode]
  )

  const tags = normalizeTags(data?.[0])
  const categories = normalizeCategories(data?.[1])

  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [selectionMode, setSelectionMode] = useState(false)
  const [chipTarget, setChipTarget] = useState(null)
  const [categoryMenu, setCategoryMenu] = useState(null)
  const [prompt, setPrompt] = useState(null)
  const [moveOpen, setMoveOpen] = useState(false)
  const [confirm, setConfirm] = useState(null)
  const [organizeOpen, setOrganizeOpen] = useState(false)

  /**
   * 分类展示顺序：默认分类永远排第一，其余按 sort_order, id 排序。
   * 提交顺序时要把这个数组整体转成 id 列表 —— 包括 0。
   */
  const orderedCategories = useMemo(() => {
    const stored = [...categories].sort(
      (a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || Number(a.id) - Number(b.id)
    )
    return [DEFAULT_CATEGORY, ...stored]
  }, [categories])

  const grouped = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    const visible = keyword
      ? tags.filter((tag) => {
          const label = javTagDisplayName(tag, prefs.simplifiedTags).toLowerCase()
          return label.includes(keyword)
        })
      : tags

    const buckets = new Map(orderedCategories.map((category) => [Number(category.id), []]))
    for (const tag of visible) {
      const key = Number(tag?.category_id || 0)
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key).push(tag)
    }
    const groups = orderedCategories.map((category) => ({
      category,
      tags: (buckets.get(Number(category.id)) || []).sort(
        (a, b) =>
          Number(b.count || 0) - Number(a.count || 0) ||
          javTagDisplayName(a, false).localeCompare(javTagDisplayName(b, false))
      ),
    }))
    // 搜索时隐藏空分类（否则满屏「没有匹配」的噪音）；
    // 不搜索时**保留空分类** —— 否则刚建好的空分类会整个消失，
    // 用户既看不到它，也没法给它改名 / 排序 / 删除。
    return keyword ? groups.filter((group) => group.tags.length > 0) : groups
  }, [orderedCategories, tags, search, prefs.simplifiedTags])

  const run = async (task, successMessage) => {
    setBusy(true)
    setActionError('')
    try {
      await task()
      if (successMessage) showToast(successMessage)
      setPrompt(null)
      setChipTarget(null)
      setCategoryMenu(null)
      setMoveOpen(false)
      setConfirm(null)
      setOrganizeOpen(false)
      setSelected(new Set())
      setSelectionMode(false)
      reload()
    } catch (err) {
      setActionError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const toggleSelected = (tag) => {
    const id = Number(tag.id)
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const categoryOptions = orderedCategories.map((category) => ({
    value: Number(category.id),
    label: category.isDefault ? DEFAULT_CATEGORY.name : String(category.name || ''),
  }))

  /**
   * 上/下移一个分类并提交完整顺序。
   * 注意默认分类（0）也参与数组顺序 —— 后端要求它必须在数组里。
   */
  const moveCategory = (categoryId, delta) => {
    const list = orderedCategories.map((category) => Number(category.id))
    const from = list.indexOf(Number(categoryId))
    const to = from + delta
    if (from < 0 || to < 0 || to >= list.length) return
    const next = [...list]
    ;[next[from], next[to]] = [next[to], next[from]]
    run(() => api.reorderCategories(next), zh('分类顺序已更新', 'Category order updated'))
  }

  const title = isJav ? zh('JAV 标签', 'JAV tags') : zh('视频标签与分类', 'Video tags')
  const subtitle = tags.length
    ? zh(
        `${tags.length} 个标签 · ${categories.length} 个分类`,
        `${tags.length} tags · ${categories.length} categories`
      )
    : undefined

  const footer = selectionMode ? (
    <>
      <span className="flex-none self-center pr-1 text-[12.5px] text-zinc-500">
        {zh(`已选 ${selected.size}`, `${selected.size} selected`)}
      </span>
      <button
        type="button"
        disabled={!selected.size}
        onClick={() => setMoveOpen(true)}
        className={buttonClass('secondary', 'h-11 flex-1')}
      >
        {zh('调整分类', 'Move')}
      </button>
      <button
        type="button"
        disabled={!selected.size}
        onClick={() =>
          setConfirm({
            kind: 'batch',
            title: zh(`删除 ${selected.size} 个标签？`, `Delete ${selected.size} tag(s)?`),
            description: zh(
              '只会解除这些标签与内容的关联，不会删除任何视频文件。',
              'This only unlinks the tags. No video files are deleted.'
            ),
          })
        }
        className={buttonClass('danger', 'h-11 flex-1')}
      >
        {zh('删除', 'Delete')}
      </button>
      <button
        type="button"
        onClick={() => {
          setSelectionMode(false)
          setSelected(new Set())
        }}
        className={buttonClass('ghost', 'h-11 flex-none px-3')}
      >
        {zh('取消', 'Cancel')}
      </button>
    </>
  ) : (
    <>
      <button
        type="button"
        disabled={!tags.length}
        onClick={() => {
          setSelectionMode(true)
          setSelected(new Set())
        }}
        className={buttonClass('secondary', 'h-11 flex-none px-3.5')}
      >
        {zh('多选', 'Select')}
      </button>
      {isJav ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => setOrganizeOpen(true)}
          className={buttonClass('secondary', 'h-11 flex-none px-3.5')}
        >
          {zh('整理分类', 'Organize')}
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => setPrompt({ action: 'create-category' })}
        className={buttonClass('secondary', 'h-11 flex-1')}
      >
        {zh('新建分类', 'New category')}
      </button>
      <button
        type="button"
        onClick={() => setPrompt({ action: 'create-tag' })}
        className={buttonClass('primary', 'h-11 flex-1')}
      >
        {zh('新建标签', 'New tag')}
      </button>
    </>
  )

  return (
    <SettingsPage
      title={title}
      subtitle={subtitle}
      onBack={onClose}
      loading={loading}
      error={error}
      onRetry={reload}
      footer={footer}
    >
      <div className="sticky top-0 z-10 border-b border-[#e6e8ec] bg-white px-3 py-2">
        <label className="relative block">
          <Icon
            name="search"
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
          />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={zh('搜索标签', 'Search tags')}
            className="w-full rounded-[10px] border border-[#e3e5ea] bg-[#f7f8fa] py-2 pl-9 pr-3 text-[16px] text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-brand-line"
          />
        </label>
      </div>

      {actionError ? (
        <p className="mx-3 mt-3 rounded-card border border-red-200 bg-red-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-red-700">
          {actionError}
        </p>
      ) : null}

      {isJav ? (
        <p className="mx-3 mt-3 rounded-card bg-brand-soft px-3.5 py-2.5 text-[11.5px] leading-relaxed text-brand-ink">
          {zh(
            '只有你自己创建的标签可以改名或删除；刮削来的标签由服务端保护，改动的请求会被拒绝。',
            'Only tags you created can be renamed or deleted. Scraped tags are protected by the server.'
          )}
        </p>
      ) : null}

      {tags.length === 0 && categories.length === 0 ? (
        <p className="py-14 text-center text-[13px] text-zinc-400">
          {zh('还没有标签', 'No tags yet')}
        </p>
      ) : grouped.length === 0 ? (
        <p className="py-14 text-center text-[13px] text-zinc-400">
          {zh('没有匹配的标签', 'No matching tags')}
        </p>
      ) : (
        grouped.map(({ category, tags: groupTags }) => (
          <section key={category.id} className="mt-4 first:mt-3">
            <div className="flex items-center gap-2 px-4 pb-1.5">
              <h3 className="text-[12px] font-semibold text-zinc-500">
                {category.isDefault ? DEFAULT_CATEGORY.name : String(category.name || '')}
              </h3>
              <span className="text-[11px] tabular-nums text-zinc-400">{groupTags.length}</span>
              {category.isDefault ? (
                <span className="rounded bg-zinc-100 px-1.5 py-[1px] text-[10px] text-zinc-400">
                  {zh('不可删除', 'Built-in')}
                </span>
              ) : null}
              {!category.isDefault ? (
                <button
                  type="button"
                  aria-label={zh('分类操作', 'Category actions')}
                  onClick={() => setCategoryMenu(category)}
                  className="ml-auto grid h-7 w-7 place-items-center rounded-lg text-zinc-400 active:bg-zinc-100"
                >
                  <Icon name="more" size={15} />
                </button>
              ) : null}
            </div>

            {groupTags.length === 0 ? (
              <p className="mx-3 rounded-card border border-dashed border-[#e3e5ea] bg-white px-3 py-3.5 text-center text-[12px] text-zinc-400">
                {zh(
                  '这个分类还没有标签，用「调整分类」把标签移进来',
                  'No tags in this category yet — use “Move to category” to add some'
                )}
              </p>
            ) : (
              <div className="mx-3 flex flex-wrap gap-1.5 rounded-card bg-white p-3 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
                {groupTags.map((tag) => {
                  const id = Number(tag.id)
                  const active = selected.has(id)
                  const editable = isEditable(tag, mode)
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => (selectionMode ? toggleSelected(tag) : setChipTarget(tag))}
                      className={`flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[12.5px] ${
                        active
                          ? 'border-brand bg-brand-soft text-brand-ink'
                          : editable
                            ? 'border-[#e3e5ea] bg-white text-zinc-700'
                            : 'border-[#e9ebef] bg-zinc-50 text-zinc-500'
                      }`}
                    >
                      {active ? <Icon name="check" size={12} /> : null}
                      <span className="min-w-0 truncate">
                        {javTagDisplayName(tag, prefs.simplifiedTags)}
                      </span>
                      <span className="flex-none text-[10.5px] tabular-nums text-zinc-400">
                        {Number(tag.count || 0)}
                      </span>
                      {!editable ? (
                        <Icon name="shield" size={11} className="flex-none text-zinc-300" />
                      ) : null}
                    </button>
                  )
                })}
              </div>
            )}
          </section>
        ))
      )}

      <p className="px-5 pt-5 text-center text-[11px] leading-relaxed text-zinc-400">
        {zh(
          '删除标签只会解除它与内容的关联，不会删除任何视频文件。',
          'Deleting a tag only unlinks it. No video files are deleted.'
        )}
      </p>

      {/* 点标签 → 动作抽屉（替代 PC 端只在 hover 时出现的按钮） */}
      <BottomSheet
        open={Boolean(chipTarget)}
        title={chipTarget ? javTagDisplayName(chipTarget, prefs.simplifiedTags) : ''}
        onClose={() => setChipTarget(null)}
      >
        <div className="space-y-1 pb-3">
          <SheetRow
            icon="rename"
            label={zh('重命名', 'Rename')}
            disabled={!isEditable(chipTarget, mode)}
            hint={
              !isEditable(chipTarget, mode)
                ? zh('刮削标签不可改', 'Scraped tags are read-only')
                : undefined
            }
            onClick={() =>
              setPrompt({
                action: 'rename-tag',
                target: chipTarget,
                initialValue: String(chipTarget?.name || ''),
              })
            }
          />
          <SheetRow
            icon="layers"
            label={zh('调整分类', 'Move to category')}
            onClick={() => {
              setSelected(new Set([Number(chipTarget?.id)]))
              setChipTarget(null)
              setMoveOpen(true)
            }}
          />
          <SheetRow
            icon="trash"
            label={zh('删除标签', 'Delete tag')}
            danger
            disabled={!isEditable(chipTarget, mode)}
            onClick={() => {
              const target = chipTarget
              setChipTarget(null)
              setConfirm({
                kind: 'tag',
                target,
                title: zh(`删除标签「${target?.name}」？`, `Delete tag “${target?.name}”?`),
                description: zh(
                  '标签会从所有内容上移除，视频文件不受影响。',
                  'The tag is removed from every item. Video files are unaffected.'
                ),
              })
            }}
          />
        </div>
      </BottomSheet>

      {/* 分类操作抽屉：上移 / 下移替代 PC 的拖拽 */}
      <BottomSheet
        open={Boolean(categoryMenu)}
        title={categoryMenu ? String(categoryMenu.name || '') : ''}
        onClose={() => setCategoryMenu(null)}
      >
        <div className="space-y-1 pb-3">
          <SheetRow
            icon="rename"
            label={zh('重命名分类', 'Rename category')}
            onClick={() =>
              setPrompt({
                action: 'rename-category',
                target: categoryMenu,
                initialValue: String(categoryMenu?.name || ''),
              })
            }
          />
          <SheetRow
            icon="arrowUp"
            label={zh('上移', 'Move up')}
            onClick={() => moveCategory(categoryMenu?.id, -1)}
          />
          <SheetRow
            icon="arrowDown"
            label={zh('下移', 'Move down')}
            onClick={() => moveCategory(categoryMenu?.id, 1)}
          />
          <SheetRow
            icon="trash"
            label={zh('删除分类', 'Delete category')}
            danger
            onClick={() => {
              const target = categoryMenu
              setCategoryMenu(null)
              setConfirm({
                kind: 'category',
                target,
                title: zh(`删除分类「${target?.name}」？`, `Delete category “${target?.name}”?`),
                description: zh(
                  '分类里的标签不会被删除，只会回到「默认分类」。',
                  'Tags inside are not deleted — they move back to the default category.'
                ),
              })
            }}
          />
        </div>
      </BottomSheet>

      {/* 批量 / 单个标签的「调整分类」 */}
      <BottomSheet
        open={moveOpen}
        title={zh('调整分类', 'Move to category')}
        onClose={() => setMoveOpen(false)}
      >
        <ul className="space-y-1 pb-3">
          {categoryOptions.map((option) => (
            <li key={option.value}>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(
                    () =>
                      api.assignCategory(
                        Array.from(selected),
                        option.value === 0 ? null : option.value
                      ),
                    zh('分类已更新', 'Category updated')
                  )
                }
                className="flex w-full items-center gap-2 rounded-[10px] px-3 py-2.5 text-left text-[14px] text-zinc-800 active:bg-zinc-100 disabled:opacity-40"
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                <Icon name="right" size={14} className="flex-none text-zinc-300" />
              </button>
            </li>
          ))}
        </ul>
      </BottomSheet>

      <PromptSheet
        open={Boolean(prompt)}
        title={promptTitle(prompt)}
        label={
          prompt?.action === 'create-tag' || prompt?.action === 'rename-tag'
            ? zh('标签名称', 'Tag name')
            : zh('分类名称', 'Category name')
        }
        initialValue={prompt?.initialValue || ''}
        busy={busy}
        error={actionError}
        onClose={() => setPrompt(null)}
        onConfirm={(value) => {
          if (prompt?.action === 'create-tag') {
            return run(() => api.createTag(value), zh('标签已创建', 'Tag created'))
          }
          if (prompt?.action === 'rename-tag') {
            return run(
              () => api.renameTag(Number(prompt.target.id), value),
              zh('已重命名', 'Renamed')
            )
          }
          if (prompt?.action === 'create-category') {
            return run(() => api.createCategory(value), zh('分类已创建', 'Category created'))
          }
          return run(
            () => api.renameCategory(Number(prompt.target.id), value),
            zh('已重命名', 'Renamed')
          )
        }}
      />

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.title || ''}
        description={confirm?.description || ''}
        confirmText={zh('删除', 'Delete')}
        danger
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.kind === 'tag') {
            return run(
              () => api.deleteTag(Number(confirm.target.id)),
              zh('标签已删除', 'Tag deleted')
            )
          }
          if (confirm?.kind === 'category') {
            return run(
              () => api.deleteCategory(Number(confirm.target.id)),
              zh('分类已删除', 'Category deleted')
            )
          }
          return run(
            () => api.deleteTagsBatch(Array.from(selected)),
            zh('标签已删除', 'Tags deleted')
          )
        }}
      />

      <ConfirmDialog
        open={organizeOpen}
        title={zh('自动整理 JAV 标签分类？', 'Auto-organize JAV tag categories?')}
        description={zh(
          '会从 JavBus 读取标签分类并套用到能匹配上的标签，需要联网，最长可能等待 45 秒。没有匹配到的标签保持原样。',
          'This reads tag categories from JavBus and applies them to matching tags. It needs internet access and can take up to 45 seconds. Unmatched tags are left alone.'
        )}
        confirmText={zh('开始整理', 'Organize')}
        busy={busy}
        onClose={() => setOrganizeOpen(false)}
        onConfirm={() =>
          run(async () => {
            const result = await organizeJavTags()
            showToast(
              zh(
                `匹配 ${result?.matched_tag_count ?? 0} / ${result?.remote_tag_count ?? 0}，更新 ${result?.updated_tag_count ?? 0} 个`,
                `Matched ${result?.matched_tag_count ?? 0} of ${result?.remote_tag_count ?? 0}, updated ${result?.updated_tag_count ?? 0}`
              )
            )
          })
        }
      />
    </SettingsPage>
  )
}

function promptTitle(prompt) {
  if (!prompt) return ''
  switch (prompt.action) {
    case 'create-tag':
      return zh('新建标签', 'New tag')
    case 'rename-tag':
      return zh('重命名标签', 'Rename tag')
    case 'create-category':
      return zh('新建分类', 'New category')
    default:
      return zh('重命名分类', 'Rename category')
  }
}

function SheetRow({ icon, label, hint, onClick, danger = false, disabled = false }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-[10px] px-3 py-3 text-left text-[13.5px] ${
        disabled ? 'text-zinc-300' : danger ? 'text-red-600' : 'text-zinc-800'
      } active:bg-zinc-100`}
    >
      <Icon name={icon} size={17} className={disabled ? 'text-zinc-200' : 'text-zinc-500'} />
      <span className="min-w-0 flex-1">{label}</span>
      {hint ? <span className="flex-none text-[11px] text-zinc-400">{hint}</span> : null}
    </button>
  )
}
