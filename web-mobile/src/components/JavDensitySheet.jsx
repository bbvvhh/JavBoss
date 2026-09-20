import BottomSheet from '@/components/BottomSheet'
import Icon from '@/components/Icons'
import { JAV_DENSITIES, JAV_DENSITY_LABELS, JAV_DENSITY_COLUMNS } from '@/constants/jav'
import { useStore } from '@/store'
import { zh } from '@/utils/i18n'

const DESCRIPTIONS = {
  large: ['作品单列，标题完整 + 演员 + 标签', 'One work per row with full title, cast and tags'],
  standard: ['作品 2 列、女优 3 列', 'Works in 2 columns, idols in 3'],
  compact: ['作品 3 列、女优 4 列，一屏更多', 'Works in 3 columns, idols in 4'],
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

export default function JavDensitySheet() {
  const open = useStore((state) => state.javDensitySheetOpen)
  const density = useStore((state) => state.javDensity)
  const close = useStore((state) => state.closeJavDensitySheet)
  const setDensity = useStore((state) => state.setJavDensity)

  return (
    <BottomSheet open={open} title={zh('JAV 列表密度', 'JAV list density')} onClose={close}>
      <div className="flex flex-col gap-2 pb-3">
        {JAV_DENSITIES.map((key) => {
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
              <DensityPreview columns={JAV_DENSITY_COLUMNS[key].works} active={active} />
              <span className="min-w-0 flex-1">
                <span
                  className={`block text-[13.5px] font-semibold ${active ? 'text-brand-ink' : 'text-zinc-800'}`}
                >
                  {zh(...JAV_DENSITY_LABELS[key])}
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
