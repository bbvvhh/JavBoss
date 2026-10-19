import { useCallback, useEffect, useState } from 'react'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import AppModal from '@/components/AppModal'
import { fetchJavDuplicateWhitelist, removeJavDuplicateWhitelist } from '@/api'
import { getErrorMessage } from '@/utils/errors'
import { zh } from '@/utils/i18n'

export default function JavDuplicateWhitelistDialog({ open, onClose, onChanged }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await fetchJavDuplicateWhitelist()
      setEntries(Array.isArray(data?.items) ? data.items : [])
    } catch (err) {
      setError(getErrorMessage(err))
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    load()
  }, [open, load])

  const handleRemove = async (entry) => {
    const javId = Number(entry?.jav_id)
    if (!Number.isFinite(javId) || javId <= 0) return
    setBusyId(javId)
    setError('')
    try {
      await removeJavDuplicateWhitelist([javId])
      setEntries((prev) => prev.filter((item) => Number(item?.jav_id) !== javId))
      onChanged?.()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusyId(0)
    }
  }

  return (
    <AppModal
      ariaLabel={zh('查重白名单', 'Duplicate whitelist')}
      className="p-4"
      contentClassName="flex max-h-[80vh] w-[92vw] max-w-[560px] flex-col overflow-hidden rounded bg-white shadow-2xl"
      onClose={onClose}
      open={open}
      zIndex={1400}
    >
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="text-base font-semibold text-gray-800">
            {zh('查重白名单', 'Duplicate whitelist')}
          </h2>
          <span className="truncate text-xs text-gray-500">
            {zh(
              '白名单中的作品不会再出现在查重结果中',
              'Whitelisted works are excluded from the scan'
            )}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={zh('关闭', 'Close')}
          className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
        >
          <CloseRoundedIcon fontSize="small" />
        </button>
      </div>

      {error ? (
        <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-600">
          {error}
        </div>
      ) : null}

      <div className="min-h-[160px] flex-1 overflow-y-auto px-4 py-2">
        {loading ? (
          <div className="flex min-h-[140px] items-center justify-center text-gray-500">
            {zh('加载中…', 'Loading...')}
          </div>
        ) : entries.length === 0 ? (
          <div className="flex min-h-[140px] items-center justify-center rounded border border-dashed border-gray-200 text-gray-500">
            {zh('白名单为空', 'The whitelist is empty')}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {entries.map((entry) => {
              const javId = Number(entry?.jav_id)
              return (
                <li key={javId} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 truncate text-sm text-gray-700">
                    {entry?.code || `#${javId}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemove(entry)}
                    disabled={busyId === javId}
                    className="shrink-0 rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    {zh('移出白名单', 'Remove')}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </AppModal>
  )
}
