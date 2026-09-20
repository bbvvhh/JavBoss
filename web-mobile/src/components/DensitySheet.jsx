import BottomSheet from '@/components/BottomSheet'
import Icon from '@/components/Icons'
import { useStore } from '@/store'
import { DENSITIES, DENSITY_LABELS, DENSITY_COLUMNS } from '@/utils/density'
import { zh } from '@/utils/i18n'

const DESCRIPTIONS = {
  large: [
    '标题完整显示，带演员行与标签行，一屏约 2 部',
    'Full title plus cast and tag rows. About 2 per screen.',
  ],
  standard: [
    '标题 2 行、标签最多 2 个，一屏约 7 部',
    'Two-line titles, up to 2 tags. About 7 per screen.',
  ],
  compact: ['3 列只留标题，一屏约 12 部', 'Three columns, titles only. About 12 per screen.'],
}

export default function DensitySheet() {
  const open = useStore((state) => state.densitySheetOpen)
  const density = useStore((state) => state.density)
  const close = useStore((state) => state.closeDensitySheet)
  const setDensity = useStore((state) => state.setDensity)

  return (
    <BottomSheet open={open} title={zh('列表密度', 'List density')} onClose={close}>
      <div className="flex flex-col gap-2 pb-3">
        {DENSITIES.map((key) => {
          const active = density === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => setDensity(key)}
              className={`flex items-center gap-3 rounded-card border px-3.5 py-3 text-left ${
                active ? 'border-brand bg-brand-soft' : 'border-[#e6e8ec] bg-white'
              }`}
            >
              <DensityPreview columns={DENSITY_COLUMNS[key]} active={active} />
              <span className="min-w-0 flex-1">
                <span
                  className={`block text-[13.5px] font-semibold ${active ? 'text-brand-ink' : 'text-zinc-800'}`}
                >
                  {zh(...DENSITY_LABELS[key])}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">
                  {zh(...DESCRIPTIONS[key])}
                </span>
              </span>
              {active ? <Icon name="check" size={16} className="flex-none text-brand" /> : null}
            </button>
          )
        })}
      </div>
    </BottomSheet>
  )
}

function DensityPreview({ columns, active }) {
  const color = active ? 'bg-brand/70' : 'bg-zinc-300'
  return (
    <span
      className="grid h-8 w-8 flex-none gap-[2px] rounded-md bg-zinc-100 p-[3px]"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      aria-hidden="true"
    >
      {Array.from({ length: columns * 2 }).map((_, index) => (
        <span key={index} className={`rounded-[1px] ${color}`} />
      ))}
    </span>
  )
}
