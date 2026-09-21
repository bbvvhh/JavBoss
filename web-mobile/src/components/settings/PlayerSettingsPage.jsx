import { useState } from 'react'

import Icon from '@/components/Icons'
import SettingsPage from '@/components/settings/SettingsPage'
import Switch from '@/components/form/Switch'
import { FormCard, FormRow, InfoRow, SectionTitle, buttonClass } from '@/components/form/Field'
import ConfirmDialog from '@/components/ConfirmDialog'
import { configFlag, configString } from '@/utils/config'
import {
  clearAllProgress,
  countProgress,
  isResumeEnabled,
  setResumeEnabled,
} from '@/utils/progress'
import { useStore } from '@/store'
import { zh } from '@/utils/i18n'

const PLAYER_LABELS = {
  browser: zh('浏览器', 'Browser'),
  mpv: zh('MPV', 'MPV'),
  system: zh('系统播放器', 'System player'),
}

/**
 * 播放设置。
 *
 * PC 端这一页几乎全是 mpv 专属（窗口尺寸、置顶、复用窗口、音量、MPV 快捷键），
 * 这些键在手机上即使写了也没有任何效果，所以不显示 —— 但会明确说明它们在桌面端，
 * 而不是让用户以为功能被砍了。
 *
 * 真正对手机有意义的是「本机播放偏好」：续播开关与观看记录，它们只写 localStorage。
 */
export default function PlayerSettingsPage({ onClose }) {
  const config = useStore((state) => state.config)
  const showToast = useStore((state) => state.showToast)

  const [resume, setResume] = useState(() => isResumeEnabled())
  const [records, setRecords] = useState(() => countProgress())
  const [clearOpen, setClearOpen] = useState(false)

  const browserOnly = configFlag(config, 'browser_playback_only')
  const mpvEnabled = configFlag(config, 'mpv_enabled')
  const defaultPlayer = configString(config, 'default_player', '')

  const toggleResume = (next) => {
    setResumeEnabled(next)
    setResume(next)
    showToast(
      next
        ? zh('已开启续播', 'Resume playback on')
        : zh(
            '已关闭续播，之后不再记录进度',
            'Resume playback off; progress will no longer be saved'
          )
    )
  }

  const doClear = () => {
    const removed = clearAllProgress()
    setRecords(0)
    setClearOpen(false)
    showToast(zh(`已清除 ${removed} 条观看记录`, `Cleared ${removed} watch record(s)`))
  }

  return (
    <SettingsPage
      title={zh('播放设置', 'Player')}
      subtitle={zh('本机偏好', 'This device')}
      onBack={onClose}
    >
      <SectionTitle hint={zh('只影响这台手机', 'Only affects this phone')}>
        {zh('本机播放偏好', 'On this device')}
      </SectionTitle>

      <FormCard>
        <FormRow
          layout="inline"
          label={zh('记住播放进度', 'Remember playback position')}
          hint={zh(
            '关闭后不再写入新的进度，已有记录也不会再自动续播。',
            'When off, no new progress is saved and existing records stop resuming.'
          )}
          control={
            <Switch
              checked={resume}
              onChange={toggleResume}
              label={zh('记住播放进度', 'Remember playback position')}
            />
          }
        />
      </FormCard>

      <div className="mx-3 mt-3 overflow-hidden rounded-card bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
        <InfoRow
          label={zh('本机观看记录', 'Watch records on this device')}
          value={zh(`${records} 部`, `${records}`)}
        />
      </div>

      <div className="mx-3 mt-3">
        <button
          type="button"
          disabled={records === 0}
          onClick={() => setClearOpen(true)}
          className={buttonClass('secondary', 'h-10 w-full')}
        >
          {zh('清空观看记录', 'Clear watch records')}
        </button>
      </div>

      <SectionTitle hint={zh('由服务端决定', 'Decided by the server')}>
        {zh('播放方式', 'Playback')}
      </SectionTitle>
      <div className="mx-3 overflow-hidden rounded-card bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
        <InfoRow
          label={zh('当前方式', 'Current mode')}
          value={
            browserOnly
              ? zh('浏览器内播放', 'In-browser playback')
              : MPV_FALLBACK_LABEL(defaultPlayer)
          }
        />
        <InfoRow
          label={zh('服务端 MPV', 'Server MPV')}
          value={mpvEnabled ? zh('可用', 'Available') : zh('不可用', 'Unavailable')}
        />
      </div>

      <div className="mx-3 mt-3 rounded-card bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
        <p className="flex items-start gap-2 text-[12px] leading-relaxed text-zinc-500">
          <Icon name="info" size={14} className="mt-[2px] flex-none text-zinc-400" />
          <span>
            {zh(
              '手机没有键盘，也无法驱动电脑上的 MPV，所以「默认播放器 / MPV 快捷键 / 窗口尺寸 / 置顶 / 复用窗口」这些设置不在移动端显示。视频用浏览器直接播放，支持直连与 HLS 自动回退。',
              'A phone has no keyboard and cannot drive MPV on the computer, so desktop-only settings (default player, MPV hotkeys, window size, always-on-top, window reuse) are not shown here. Video plays in the browser with automatic direct-to-HLS fallback.'
            )}
          </span>
        </p>
      </div>

      <ConfirmDialog
        open={clearOpen}
        title={zh('清空本机观看记录？', 'Clear watch records?')}
        description={zh(
          '只会删除这台手机上保存的播放位置，服务端的播放次数与任何视频文件都不受影响。',
          'This only removes playback positions stored on this phone. Server-side play counts and video files are untouched.'
        )}
        confirmText={zh('清空', 'Clear')}
        danger
        onConfirm={doClear}
        onClose={() => setClearOpen(false)}
      />
    </SettingsPage>
  )
}

function MPV_FALLBACK_LABEL(value) {
  return PLAYER_LABELS[value] || zh('浏览器内播放', 'In-browser playback')
}
