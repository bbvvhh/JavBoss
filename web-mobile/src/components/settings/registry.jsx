import { lazy, Suspense } from 'react'

import Icon from '@/components/Icons'
import { zh } from '@/utils/i18n'

/**
 * 「我的」里 15 个入口对应的页面。
 *
 * 用注册表而不是在 App.jsx 里堆 15 个三元表达式：新增设置页只需要在这里加一行。
 * 并且全部走 `lazy()` —— 这 15 个页面只在用户真的点进设置时才需要，
 * 静态 import 会让首屏包凭空多出 150 KB 以上（首屏是视频列表，那才是重点）。
 *
 * 注意 `settings:favorite-items` 是收藏夹详情的**独立页面类型**，不是
 * FavoriteGroupPage 的内部状态 —— 这样右滑 / Android 返回键只需处理一条
 * 页面栈记录。做成内部状态会让 App 与页面各注册一个 popstate 监听，
 * 一次返回同时关掉两层。
 */
const SETTINGS_PAGES = {
  'settings:directories': lazy(() => import('@/components/settings/DirectoryManagerPage')),
  'settings:scan': lazy(() => import('@/components/settings/ScanTaskPage')),
  'settings:video-tags': lazy(() => import('@/components/settings/VideoTagPage')),
  'settings:jav-tags': lazy(() => import('@/components/settings/JavTagPage')),
  'settings:favorites': lazy(() => import('@/components/settings/FavoriteGroupPage')),
  'settings:favorite-items': lazy(() =>
    import('@/components/settings/FavoriteGroupPage').then((mod) => ({
      default: mod.FavoriteItemsPage,
    }))
  ),
  'settings:player': lazy(() => import('@/components/settings/PlayerSettingsPage')),
  'settings:scrape': lazy(() => import('@/components/settings/ScrapeOverviewPage')),
  'settings:subtitles': lazy(() => import('@/components/settings/SubtitlePage')),
  'settings:downloader': lazy(() => import('@/components/settings/DownloaderPage')),
  'settings:global': lazy(() => import('@/components/settings/GlobalSettingsPage')),
  'settings:storage': lazy(() => import('@/components/settings/StorageConnectionPage')),
  'settings:tokens': lazy(() => import('@/components/settings/ExtensionTokenPage')),
  'settings:backup': lazy(() => import('@/components/settings/BackupPage')),
  'settings:tools': lazy(() => import('@/components/settings/ToolsPage')),
  'settings:account': lazy(() => import('@/components/settings/AccountPage')),
  'settings:about': lazy(() => import('@/components/settings/AboutPage')),
}

export function isSettingsPage(type) {
  return Object.prototype.hasOwnProperty.call(SETTINGS_PAGES, type)
}

export default function SettingsSubPage({ page, onClose }) {
  const Component = SETTINGS_PAGES[page.type]
  if (!Component) return null
  return (
    <Suspense fallback={<PageLoading />}>
      <Component payload={page.payload} onClose={onClose} />
    </Suspense>
  )
}

/** 分包加载期间的占位：形状与设置页外壳一致，不闪白屏。 */
function PageLoading() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#eff1f4]">
      <header className="flex h-[50px] flex-none items-center gap-1.5 border-b border-[#e6e8ec] bg-white px-2">
        <span className="h-5 w-5" />
        <span className="h-4 w-24 rounded bg-zinc-100" />
      </header>
      <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-zinc-400">
        <Icon name="refresh" size={16} className="spin" />
        {zh('加载中…', 'Loading…')}
      </div>
    </div>
  )
}
