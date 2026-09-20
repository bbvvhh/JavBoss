import Icon from '@/components/Icons'
import { useStore } from '@/store'

export default function Toast() {
  const toast = useStore((state) => state.toast)
  const dismiss = useStore((state) => state.dismissToast)
  if (!toast) return null
  return (
    <button
      type="button"
      onClick={dismiss}
      className="fixed bottom-24 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 rounded-[10px] bg-zinc-900/90 px-3.5 py-2.5 text-[12.5px] text-white"
    >
      <Icon name="check" size={15} className="text-green-400" />
      <span>{toast.message}</span>
    </button>
  )
}
