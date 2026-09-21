import { configFlag, configString } from '@/utils/config'
import Icon from '@/components/Icons'
import SettingsPage from '@/components/settings/SettingsPage'
import { InfoRow, SectionTitle } from '@/components/form/Field'
import { APP_VERSION } from '@/constants/app'
import { useStore } from '@/store'
import { zh } from '@/utils/i18n'

const OS_LABELS = {
  windows: zh('Windows', 'Windows'),
  linux: zh('Linux', 'Linux'),
  darwin: zh('macOS', 'macOS'),
}

function yesNo(value) {
  return value ? zh('是', 'Yes') : zh('否', 'No')
}

/**
 * 关于页。
 *
 * 后端**没有**版本接口（`GET /config` 里没有 version 字段），所以这里只展示
 * 能真实拿到的东西：移动端包版本、服务端派生出的运行环境、当前访问地址。
 * 编造一个「服务端版本号」比不显示更糟。
 */
export default function AboutPage({ onClose }) {
  const config = useStore((state) => state.config)
  const host = typeof window === 'undefined' ? '' : window.location.host

  const os = configString(config, 'runtime_os', '')
  const container = configFlag(config, 'runtime_container')
  const remote = configFlag(config, 'runtime_remote_request')
  const browserOnly = configFlag(config, 'browser_playback_only')
  const mpv = configFlag(config, 'mpv_enabled')
  const picker = configFlag(config, 'directory_picker_enabled')
  const desktop = configFlag(config, 'desktop_integration_enabled')

  return (
    <SettingsPage title={zh('关于 JavBoss', 'About JavBoss')} onBack={onClose}>
      <div className="px-5 pb-2 pt-6 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-[16px] bg-brand text-[17px] font-bold text-white">
          JB
        </span>
        <b className="mt-3 block text-[16px]">JavBoss</b>
        <span className="mt-1 block text-[12px] text-zinc-400">
          {zh(
            `移动端 v${APP_VERSION} · 单用户本地媒体库管理`,
            `Mobile v${APP_VERSION} · single-user local media library`
          )}
        </span>
      </div>

      <SectionTitle>{zh('连接', 'Connection')}</SectionTitle>
      <div className="mx-3 overflow-hidden rounded-card bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
        <InfoRow label={zh('访问地址', 'Address')} value={host} mono />
        <InfoRow label={zh('运行平台', 'Platform')} value={OS_LABELS[os] || os || '—'} />
        <InfoRow label={zh('容器模式', 'Container mode')} value={yesNo(container)} />
        <InfoRow label={zh('本次为局域网访问', 'Accessed over LAN')} value={yesNo(remote)} />
      </div>

      <SectionTitle hint={zh('由服务端决定，移动端不可改', 'Decided by the server')}>
        {zh('服务端能力', 'Server capabilities')}
      </SectionTitle>
      <div className="mx-3 overflow-hidden rounded-card bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
        <InfoRow label={zh('仅浏览器播放', 'Browser playback only')} value={yesNo(browserOnly)} />
        <InfoRow label={zh('MPV 可用', 'MPV available')} value={yesNo(mpv)} />
        <InfoRow label={zh('目录选择器', 'Directory picker')} value={yesNo(picker)} />
        <InfoRow label={zh('桌面集成', 'Desktop integration')} value={yesNo(desktop)} />
      </div>

      <SectionTitle>{zh('安全边界', 'Safety boundary')}</SectionTitle>
      <div className="mx-3 rounded-card bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
        <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-zinc-600">
          <Icon name="shield" size={15} className="mt-[2px] flex-none text-emerald-600" />
          <span>
            {zh(
              '移动端只会读取你的视频目录，不会删除、覆盖或移动任何视频文件。唯一会写媒体目录的操作是「重命名文件」，它需要经过预览与二次确认，且只支持单个文件。',
              'The mobile app only reads your video directories. It never deletes, overwrites, or moves video files. The only media-directory write is renaming a single file, behind a preview and an explicit confirmation.'
            )}
          </span>
        </p>
        <p className="mt-2.5 flex items-start gap-2 text-[12.5px] leading-relaxed text-zinc-600">
          <Icon name="ban" size={15} className="mt-[2px] flex-none text-red-500" />
          <span>
            {zh(
              '目录整理与删除文件是桌面端专属能力，移动端不提供入口。',
              'Directory organising and file deletion are desktop-only and are not offered here.'
            )}
          </span>
        </p>
      </div>

      <p className="px-5 pt-5 text-center text-[11px] leading-relaxed text-zinc-400">
        {zh(
          'JavBoss 是本地优先的工具：所有运行数据都保存在程序自己的目录里，不会上传到任何服务器。',
          'JavBoss is local-first: all runtime data stays in the app’s own directory and is never uploaded.'
        )}
      </p>
    </SettingsPage>
  )
}
