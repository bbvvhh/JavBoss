import { useEffect, useMemo, useState } from 'react'

import Icon from '@/components/Icons'
import SettingsPage from '@/components/settings/SettingsPage'
import PickerField from '@/components/form/PickerField'
import Segmented from '@/components/form/Segmented'
import Stepper from '@/components/form/Stepper'
import Switch from '@/components/form/Switch'
import TextField from '@/components/form/TextField'
import { FormCard, FormRow, InfoRow, SectionTitle, buttonClass } from '@/components/form/Field'
import {
  IDOL_SORT_OPTIONS,
  JAV_SORT_OPTIONS,
  buildSortChoices,
  normalizeIdolSort,
  normalizeJavSort,
} from '@/constants/jav'
import { VIDEO_SORT_OPTIONS, normalizeVideoSort } from '@/constants/video'
import { configFlag, configInt, configString } from '@/utils/config'
import { initialViewMode } from '@/utils/javDisplay'
import { useStore } from '@/store'
import { getErrorMessage } from '@/utils/errors'
import { zh } from '@/utils/i18n'

const MAX_PAGE_SIZE = 500

const VIDEO_SORT_CHOICES = buildSortChoices(VIDEO_SORT_OPTIONS)
const JAV_SORT_CHOICES = buildSortChoices(JAV_SORT_OPTIONS)
const IDOL_SORT_CHOICES = buildSortChoices(IDOL_SORT_OPTIONS)

/** 桌面端专属、移动端不显示的配置项 —— 只做说明，不提供开关。 */
const DESKTOP_ONLY_NOTES = [
  {
    key: 'waterfall',
    label: zh('瀑布流默认开启', 'Waterfall default'),
    reason: zh(
      '桌面网格布局，移动端用顶部密度切换',
      'Desktop grid layout; mobile uses the density switch'
    ),
  },
  {
    key: 'jav_grid_columns',
    label: zh('每行 JAV 数量', 'JAVs per row'),
    reason: zh('同上，移动端由密度决定列数', 'Same as above; density decides columns on mobile'),
  },
  {
    key: 'rows',
    label: zh('标题 / 标签最多行数', 'Title / tag max rows'),
    reason: zh(
      '移动端固定为「标题完整 + 标签一行」',
      'Mobile always shows full titles and one tag row'
    ),
  },
  {
    key: 'jav_hide_actions',
    label: zh('不显示操作按钮', 'Hide action buttons'),
    reason: zh(
      '移动端卡片没有操作按钮，走长按菜单',
      'Mobile cards have no buttons; actions live in the long-press menu'
    ),
  },
  {
    key: 'jav_favorite_rating_show_full',
    label: zh('展示完整喜爱度爱心', 'Full favourite hearts'),
    reason: zh('移动端用 ★ 数字角标表示喜爱度', 'Mobile shows the rating as a ★ number'),
  },
  {
    key: 'jav_sort_rules',
    label: zh('JAV 排序规则', 'JAV sort rules'),
    reason: zh('按筛选条件切换排序的复杂规则，仅桌面端', 'Per-filter sort rules are desktop-only'),
  },
  {
    key: 'mpv',
    label: zh('MPV 窗口 / 音量 / 置顶 / 复用窗口 / 快捷键', 'MPV window, volume, hotkeys'),
    reason: zh('手机无法驱动电脑上的 MPV', 'A phone cannot drive MPV on the computer'),
  },
  {
    key: 'web_hotkeys',
    label: zh('Web / 播放器快捷键', 'Web & player shortcuts'),
    reason: zh('没有物理键盘', 'No physical keyboard'),
  },
]

/**
 * 全局设置。
 *
 * `PATCH /config` 是**部分更新**（只写请求里出现的键），但校验是**整单通过或整单失败**：
 * 只要有一个键非法，整个请求 400、一个都不写。所以这里每个字段都先在前端做范围校验。
 *
 * 另一个必须记住的点：请求体是**强类型**的 —— 整数键要发 number、布尔键要发真正的
 * boolean。发字符串会直接 400。而响应永远是 `map[string]string`。
 */
export default function GlobalSettingsPage({ onClose }) {
  const config = useStore((state) => state.config)
  const saveConfig = useStore((state) => state.saveConfig)
  const showToast = useStore((state) => state.showToast)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const initial = useMemo(
    () => ({
      initial_view_mode: initialViewMode(config),
      video_page_size: configInt(config, 'video_page_size', 25),
      video_sort: normalizeVideoSort(configString(config, 'video_sort', 'recent')),
      video_hide_jav: configFlag(config, 'video_hide_jav', false),
      jav_page_size: configInt(config, 'jav_page_size', 24),
      jav_sort: normalizeJavSort(configString(config, 'jav_sort', 'recent')),
      idol_sort: normalizeIdolSort(configString(config, 'idol_sort', 'work')),
      idol_page_size: configInt(config, 'idol_page_size', 24),
      studio_page_size: configInt(config, 'studio_page_size', 25),
      series_page_size: configInt(config, 'series_page_size', 25),
      jav_hide_idols: configFlag(config, 'jav_hide_idols', false),
      jav_hide_tags: configFlag(config, 'jav_hide_tags', false),
      jav_hide_series: configFlag(config, 'jav_hide_series', false),
      jav_idol_prefer_chinese_name: configFlag(config, 'jav_idol_prefer_chinese_name', false),
      jav_tag_show_simplified: configFlag(config, 'jav_tag_show_simplified', false),
      allow_lan_access: configFlag(config, 'allow_lan_access', false),
      proxy_host: configString(config, 'proxy_host', ''),
      proxy_port: configInt(config, 'proxy_port', 0),
    }),
    [config]
  )

  const [form, setForm] = useState(initial)

  // 保存成功后 store 里的 config 会被替换，这里跟着回到「未改动」状态。
  useEffect(() => setForm(initial), [initial])

  const set = (key) => (value) => setForm((prev) => ({ ...prev, [key]: value }))

  const dirtyKeys = Object.keys(initial).filter((key) => form[key] !== initial[key])
  const dirty = dirtyKeys.length > 0

  const validate = () => {
    for (const key of [
      'video_page_size',
      'jav_page_size',
      'idol_page_size',
      'studio_page_size',
      'series_page_size',
    ]) {
      const value = Number(form[key])
      if (!Number.isFinite(value) || value < 1 || value > MAX_PAGE_SIZE) {
        return zh(
          `每页数量必须在 1-${MAX_PAGE_SIZE} 之间`,
          `Page size must be between 1 and ${MAX_PAGE_SIZE}`
        )
      }
    }
    const port = Number(form.proxy_port)
    if (port !== 0 && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      return zh(
        '代理端口必须是 1-65535，留空表示不使用代理',
        'Proxy port must be 1-65535; leave empty to disable'
      )
    }
    if (form.proxy_host.trim() && port === 0) {
      return zh('填写了代理地址就必须填写端口号', 'A proxy address needs a port')
    }
    if (!form.proxy_host.trim() && port !== 0) {
      return zh('填写了端口号就必须填写代理地址', 'A proxy port needs an address')
    }
    return ''
  }

  const save = async () => {
    const message = validate()
    setError(message)
    if (message) return

    // 只提交真正改动过的键；类型必须是 number / boolean / string，不能是字符串化的数字。
    const patch = {}
    for (const key of dirtyKeys) {
      patch[key] = key === 'proxy_host' ? String(form[key]).trim() : form[key]
    }

    setSaving(true)
    try {
      await saveConfig(patch)
      showToast(zh(`已保存 ${dirtyKeys.length} 项设置`, `Saved ${dirtyKeys.length} setting(s)`))
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const resetAll = () => {
    setForm(initial)
    setError('')
  }

  return (
    <SettingsPage
      title={zh('全局设置', 'Global settings')}
      subtitle={
        dirty ? zh(`有 ${dirtyKeys.length} 项未保存`, `${dirtyKeys.length} unsaved`) : undefined
      }
      onBack={onClose}
      footer={
        <>
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={resetAll}
            className={buttonClass('secondary', 'h-11 flex-1')}
          >
            {zh('撤销', 'Revert')}
          </button>
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={save}
            className={buttonClass('primary', 'h-11 flex-[2]')}
          >
            {saving ? zh('保存中…', 'Saving…') : zh('保存设置', 'Save')}
          </button>
        </>
      }
    >
      {error ? (
        <p className="mx-3 mt-3 flex items-start gap-2 rounded-card border border-red-200 bg-red-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-red-700">
          <Icon name="ban" size={14} className="mt-[2px] flex-none" />
          <span>{error}</span>
        </p>
      ) : null}

      <SectionTitle hint={zh('打开时默认进入哪个模式', 'Which mode opens first')}>
        {zh('界面', 'Interface')}
      </SectionTitle>
      <FormCard>
        <FormRow
          label={zh('初始页面', 'Initial page')}
          control={
            <Segmented
              label={zh('初始页面', 'Initial page')}
              value={form.initial_view_mode}
              onChange={set('initial_view_mode')}
              options={[
                { value: 'video', label: zh('视频模式', 'Video') },
                { value: 'jav', label: zh('JAV 模式', 'JAV') },
              ]}
            />
          }
        />
      </FormCard>

      <SectionTitle>{zh('视频列表', 'Video list')}</SectionTitle>
      <FormCard>
        <FormRow
          label={zh('每页数量', 'Per page')}
          hint={zh('1-500，长按 ＋/− 可连续调整', '1-500; press and hold +/− to repeat')}
          control={
            <Stepper
              value={form.video_page_size}
              onChange={set('video_page_size')}
              min={1}
              max={MAX_PAGE_SIZE}
              step={5}
              label={zh('每页数量', 'Per page')}
            />
          }
        />
        <FormRow
          label={zh('默认排序', 'Default sort')}
          control={
            <PickerField
              label={zh('默认排序', 'Default sort')}
              value={form.video_sort}
              onChange={set('video_sort')}
              options={VIDEO_SORT_CHOICES}
            />
          }
        />
        <FormRow
          layout="inline"
          label={zh('隐藏已刮削的视频', 'Hide scraped videos')}
          hint={zh('只显示没有关联 JAV 番号的视频', 'Only show videos without a linked JAV code')}
          control={
            <Switch
              checked={form.video_hide_jav}
              onChange={set('video_hide_jav')}
              label={zh('隐藏已刮削的视频', 'Hide scraped videos')}
            />
          }
        />
      </FormCard>

      <SectionTitle>{zh('JAV 列表', 'JAV lists')}</SectionTitle>
      <FormCard>
        <FormRow
          label={zh('作品每页数量', 'Works per page')}
          control={
            <Stepper
              value={form.jav_page_size}
              onChange={set('jav_page_size')}
              min={1}
              max={MAX_PAGE_SIZE}
              step={4}
              label={zh('作品每页数量', 'Works per page')}
            />
          }
        />
        <FormRow
          label={zh('作品默认排序', 'Works default sort')}
          control={
            <PickerField
              label={zh('作品默认排序', 'Works default sort')}
              value={form.jav_sort}
              onChange={set('jav_sort')}
              options={JAV_SORT_CHOICES}
            />
          }
        />
        <FormRow
          label={zh('女优每页数量', 'Idols per page')}
          control={
            <Stepper
              value={form.idol_page_size}
              onChange={set('idol_page_size')}
              min={1}
              max={MAX_PAGE_SIZE}
              step={4}
              label={zh('女优每页数量', 'Idols per page')}
            />
          }
        />
        <FormRow
          label={zh('女优默认排序', 'Idols default sort')}
          control={
            <PickerField
              label={zh('女优默认排序', 'Idols default sort')}
              value={form.idol_sort}
              onChange={set('idol_sort')}
              options={IDOL_SORT_CHOICES}
            />
          }
        />
        <FormRow
          label={zh('片商每页数量', 'Studios per page')}
          control={
            <Stepper
              value={form.studio_page_size}
              onChange={set('studio_page_size')}
              min={1}
              max={MAX_PAGE_SIZE}
              step={5}
              label={zh('片商每页数量', 'Studios per page')}
            />
          }
        />
        <FormRow
          label={zh('系列每页数量', 'Series per page')}
          control={
            <Stepper
              value={form.series_page_size}
              onChange={set('series_page_size')}
              min={1}
              max={MAX_PAGE_SIZE}
              step={5}
              label={zh('系列每页数量', 'Series per page')}
            />
          }
        />
      </FormCard>

      <SectionTitle hint={zh('控制卡片上显示什么', 'Controls what cards show')}>
        {zh('JAV 显示', 'JAV display')}
      </SectionTitle>
      <FormCard>
        <FormRow
          layout="inline"
          label={zh('不显示演员', 'Hide actors')}
          control={
            <Switch
              checked={form.jav_hide_idols}
              onChange={set('jav_hide_idols')}
              label={zh('不显示演员', 'Hide actors')}
            />
          }
        />
        <FormRow
          layout="inline"
          label={zh('不显示标签', 'Hide tags')}
          control={
            <Switch
              checked={form.jav_hide_tags}
              onChange={set('jav_hide_tags')}
              label={zh('不显示标签', 'Hide tags')}
            />
          }
        />
        <FormRow
          layout="inline"
          label={zh('不显示系列', 'Hide series')}
          control={
            <Switch
              checked={form.jav_hide_series}
              onChange={set('jav_hide_series')}
              label={zh('不显示系列', 'Hide series')}
            />
          }
        />
        <FormRow
          layout="inline"
          label={zh('优先显示中文名', 'Prefer Chinese names')}
          hint={zh('女优名有中文时优先显示中文', 'Show the Chinese name when available')}
          control={
            <Switch
              checked={form.jav_idol_prefer_chinese_name}
              onChange={set('jav_idol_prefer_chinese_name')}
              label={zh('优先显示中文名', 'Prefer Chinese names')}
            />
          }
        />
        <FormRow
          layout="inline"
          label={zh('刮削标签显示简体', 'Simplified scraped tags')}
          hint={zh('仅对刮削来的标签生效', 'Only affects scraped tags')}
          control={
            <Switch
              checked={form.jav_tag_show_simplified}
              onChange={set('jav_tag_show_simplified')}
              label={zh('刮削标签显示简体', 'Simplified scraped tags')}
            />
          }
        />
      </FormCard>

      <SectionTitle hint={zh('服务端设置，影响刮削与访问', 'Server-side')}>
        {zh('网络', 'Network')}
      </SectionTitle>
      <FormCard>
        <FormRow
          layout="inline"
          label={zh('允许局域网访问', 'Allow LAN access')}
          hint={zh(
            '改完需要重启 JavBoss 才生效；容器模式下无效',
            'Requires a JavBoss restart; ignored in containers'
          )}
          control={
            <Switch
              checked={form.allow_lan_access}
              onChange={set('allow_lan_access')}
              label={zh('允许局域网访问', 'Allow LAN access')}
            />
          }
        />
        <FormRow
          label={zh('代理地址', 'Proxy host')}
          hint={zh(
            '刮削请求走这个代理；留空表示不使用',
            'Scraper requests use this proxy; leave empty to disable'
          )}
          control={
            <TextField
              value={form.proxy_host}
              onChange={set('proxy_host')}
              placeholder="127.0.0.1"
              autoComplete="off"
            />
          }
        />
        <FormRow
          label={zh('代理端口', 'Proxy port')}
          control={
            <Stepper
              value={form.proxy_port}
              onChange={set('proxy_port')}
              min={0}
              max={65535}
              step={1}
              label={zh('代理端口', 'Proxy port')}
            />
          }
        />
      </FormCard>

      <SectionTitle hint={zh('这些项只在电脑网页版上生效', 'Only apply to the desktop web UI')}>
        {zh('桌面端专属', 'Desktop only')}
      </SectionTitle>
      <div className="mx-3 overflow-hidden rounded-card bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
        {DESKTOP_ONLY_NOTES.map((item) => (
          <InfoRow key={item.key} label={item.label} value={item.reason} />
        ))}
      </div>
      <p className="px-5 pt-3 text-center text-[11px] leading-relaxed text-zinc-400">
        {zh(
          '这些设置没有消失，只是手机上没有对应形态；改回电脑网页版依然可以调整。',
          'These settings still exist — they just have no phone equivalent. Use the desktop web UI to change them.'
        )}
      </p>
    </SettingsPage>
  )
}
