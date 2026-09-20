import Icon from '@/components/Icons'
import { useStore } from '@/store'
import { getVideoDisplayName } from '@/utils/display'
import { zh } from '@/utils/i18n'

/**
 * 长按卡片 / 点 ⋮ 后的操作菜单。
 *
 * ⚠️ 这里**不允许**出现任何会删除、覆盖或移动视频文件的入口。
 * 唯一会写媒体目录的是「重命名文件」，它会跳到带 diff 预览的确认页。
 * 菜单末尾保留一条置灰的「删除文件（移动端已禁用）」，明确告知能力边界。
 */
function Row({ icon, label, hint, onClick, disabled = false, danger = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-3 rounded-[10px] px-3 py-3 text-left text-[13.5px] ${
        disabled ? 'text-zinc-400' : danger ? 'text-red-600' : 'text-zinc-800'
      } active:bg-zinc-100`}
    >
      <Icon name={icon} size={18} className={disabled ? 'text-zinc-300' : 'text-zinc-500'} />
      <span className="flex-1">{label}</span>
      {hint ? (
        <span className="flex-none rounded bg-zinc-100 px-1.5 py-[1px] text-[10px] font-bold text-zinc-400">
          {hint}
        </span>
      ) : null}
      {!disabled && !hint ? <Icon name="right" size={14} className="text-zinc-300" /> : null}
    </button>
  )
}

export default function ActionSheet() {
  const video = useStore((state) => state.actionSheetVideo)
  const close = useStore((state) => state.closeActionSheet)
  const pushPage = useStore((state) => state.pushPage)
  const enterSelection = useStore((state) => state.enterSelection)
  const openPlayer = useStore((state) => state.openPlayer)
  const videos = useStore((state) => state.videos)

  if (!video) return null

  const label = getVideoDisplayName(video)
  const jav = video?.jav || video?.locations?.[0]?.jav || null
  const code = String(jav?.code || '').trim()

  const go = (type, payload) => {
    close()
    pushPage(type, payload)
  }

  return (
    <>
      <div
        className="scrim-in fixed inset-0 z-[60] bg-slate-900/40"
        onClick={close}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={zh('视频操作', 'Video actions')}
        className="sheet-in fixed inset-x-0 bottom-0 z-[61] overflow-hidden rounded-t-sheet bg-white pb-[var(--safe-bottom)] shadow-[0_-12px_40px_-12px_rgba(0,0,0,0.4)]"
      >
        <div className="flex items-start gap-2 border-b border-[#e6e8ec] px-4 py-3">
          <div className="min-w-0 flex-1">
            <b className="block truncate text-[13px]">{label}</b>
            <span className="mt-0.5 block text-[11px] text-zinc-400">
              {code ? zh(`已刮削 ${code}`, `Scraped ${code}`) : zh('未刮削', 'Unscraped')}
            </span>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label={zh('关闭', 'Close')}
            className="flex-none p-1 text-zinc-400"
          >
            <Icon name="x" size={18} />
          </button>
        </div>

        <div className="p-1.5">
          <Row
            icon="play"
            label={zh('播放', 'Play')}
            onClick={() => {
              close()
              openPlayer(video, videos)
            }}
          />
          <Row
            icon="image"
            label={zh('查看截图', 'Screenshots')}
            onClick={() => go('screenshots', video)}
          />
          <Row icon="tag" label={zh('编辑标签', 'Edit tags')} onClick={() => go('tags', video)} />
          <Row
            icon="check"
            label={zh('多选', 'Select')}
            onClick={() => {
              close()
              enterSelection(video)
            }}
          />

          <div className="mx-3 my-1.5 border-t border-[#f1f2f5]" />

          <Row
            icon="wand"
            label={zh('刮削设置', 'Scrape settings')}
            onClick={() => go('scrape', video)}
          />
          <Row
            icon="rename"
            label={zh('重命名文件', 'Rename file')}
            onClick={() => go('rename', video)}
          />

          <div className="mx-3 my-1.5 border-t border-[#f1f2f5]" />

          {/* 能力边界：明确告诉用户移动端不做这件事，而不是藏起来 */}
          <Row
            icon="ban"
            label={zh('删除文件', 'Delete file')}
            hint={zh('移动端已禁用', 'Disabled on mobile')}
            disabled
          />
        </div>

        <p className="px-4 pb-4 pt-1 text-[11px] leading-relaxed text-zinc-400">
          {zh(
            '移动端不会删除、覆盖或移动你的视频文件。需要清理列表时请使用「从媒体库移除」，它只隐藏数据库记录。',
            'The mobile app never deletes, overwrites, or moves your video files.'
          )}
        </p>
      </div>
    </>
  )
}
