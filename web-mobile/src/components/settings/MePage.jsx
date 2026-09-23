import { useEffect, useState } from 'react'

import Icon from '@/components/Icons'
import { MeHeader, SettingsGroup, SettingsRow } from '@/components/settings/SettingsList'
import { APP_VERSION } from '@/constants/app'
import { useStore } from '@/store'
import { zh } from '@/utils/i18n'

const GROUPS = [
  {
    title: zh('媒体库', 'Library'),
    rows: [
      { type: 'settings:directories', icon: 'folder', label: zh('目录管理', 'Directories') },
      { type: 'settings:scan', icon: 'refresh', label: zh('扫描任务', 'Scan tasks') },
      { type: 'settings:video-tags', icon: 'tag', label: zh('视频标签与分类', 'Video tags') },
      { type: 'settings:jav-tags', icon: 'star', label: zh('JAV 标签', 'JAV tags') },
      { type: 'settings:favorites', icon: 'heart', label: zh('收藏夹管理', 'Favourites') },
    ],
  },
  {
    title: zh('播放与刮削', 'Playback & scraping'),
    rows: [
      { type: 'settings:player', icon: 'play', label: zh('播放设置', 'Player') },
      { type: 'settings:scrape', icon: 'wand', label: zh('刮削设置', 'Scraping') },
      { type: 'settings:subtitles', icon: 'subtitles', label: zh('字幕', 'Subtitles') },
      { type: 'settings:downloader', icon: 'download', label: zh('下载器与任务', 'Downloader') },
    ],
  },
  {
    title: zh('系统与集成', 'System & integrations'),
    rows: [
      { type: 'settings:global', icon: 'gear', label: zh('全局设置', 'Global settings') },
      { type: 'settings:storage', icon: 'layers', label: zh('存储连接', 'Storage connections') },
      { type: 'settings:tokens', icon: 'shield', label: zh('扩展令牌', 'Extension tokens') },
      { type: 'settings:backup', icon: 'inbox', label: zh('备份与恢复', 'Backup & restore') },
      { type: 'settings:tools', icon: 'list', label: zh('工具与日志', 'Tools & logs') },
    ],
  },
  {
    title: zh('账号与关于', 'Account & about'),
    rows: [
      { type: 'settings:account', icon: 'lock', label: zh('账号与安全', 'Account & security') },
      { type: 'settings:about', icon: 'info', label: zh('关于 JavBoss', 'About JavBoss') },
    ],
  },
]

const countOf = (group) => group.rows.length

/**
 * 「我的」总入口。
 *
 * 首屏刻意不放任何设置项；这里是唯一入口（顶栏右上角齿轮）。
 * 15 个入口按 5 / 4 / 4 / 2 分四组，覆盖 PC 端全部设置能力 —— 没有任何
 * 「请去电脑端操作」的降级项，唯一例外是设计上就属于桌面端的能力
 * （mpv 播放、Web 快捷键、目录整理/删除文件），它们在子页里被明确标注为不可用，
 * 而不是悄悄消失。
 */
export default function MePage({ onClose }) {
  const pushPage = useStore((state) => state.pushPage)
  const [stats, setStats] = useState(null)

  useEffect(() => {
    let cancelled = false
    useStore
      .getState()
      .loadOverviewStats()
      .then((next) => {
        if (!cancelled) setStats(next)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const overview = stats || { videos: null, javs: null, directories: null }
  const rendered = (value) => (value === null || value === undefined ? '—' : String(value))

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[#eff1f4]">
      <header className="flex h-[50px] flex-none items-center gap-1.5 bg-[#1e293b] px-2 text-white">
        <button
          type="button"
          onClick={onClose}
          aria-label={zh('返回', 'Back')}
          className="grid h-9 w-9 flex-none place-items-center rounded-[10px] active:bg-white/10"
        >
          <Icon name="back" size={20} />
        </button>
        <b className="text-[15px]">{zh('我的', 'Settings')}</b>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-8">
        <MeHeader
          version={zh(`移动端 v${APP_VERSION}`, `Mobile v${APP_VERSION}`)}
          host={typeof window === 'undefined' ? '' : window.location.host}
          stats={[
            { label: zh('视频', 'Videos'), value: rendered(overview.videos) },
            { label: zh('JAV 作品', 'JAV works'), value: rendered(overview.javs) },
            { label: zh('媒体目录', 'Directories'), value: rendered(overview.directories) },
          ]}
        />

        <div className="pb-2">
          {GROUPS.map((group) => (
            <SettingsGroup key={group.title} title={group.title}>
              {group.rows.map((row) => (
                <SettingsRow
                  key={row.type}
                  icon={row.icon}
                  label={row.label}
                  onClick={() => pushPage(row.type)}
                />
              ))}
            </SettingsGroup>
          ))}
        </div>

        <p className="px-5 pt-2 text-center text-[11px] leading-relaxed text-zinc-400">
          {zh(
            `JavBoss 移动端 · ${GROUPS.reduce((sum, group) => sum + countOf(group), 0)} 个设置入口`,
            `JavBoss Mobile · ${GROUPS.reduce((sum, group) => sum + countOf(group), 0)} settings`
          )}
        </p>
        <p className="mt-1.5 px-5 text-center text-[11px] leading-relaxed text-zinc-400">
          {zh(
            '移动端不会删除、覆盖或移动你的视频文件。',
            'This app never deletes, overwrites, or moves your video files.'
          )}
        </p>
      </div>
    </div>
  )
}
