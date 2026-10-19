import { useCallback, useEffect, useMemo, useState } from 'react'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import AppModal from '@/components/AppModal'
import JavGrid from '@/components/JavGrid'
import Pagination from '@/components/Pagination'
import JavDuplicateWhitelistDialog from '@/components/JavDuplicateWhitelistDialog'
import { addJavDuplicateWhitelist, fetchJavDuplicates } from '@/api'
import { getErrorMessage } from '@/utils/errors'
import { zh } from '@/utils/i18n'

const PAGE_SIZE = 25

export default function JavDuplicateDialog({
  open,
  onClose,
  cardProps = {},
  gridColumns = 0,
  titleMaxRows = 2,
  idolTagMaxRows = 1,
  tagMaxRows = 1,
}) {
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [whitelistOpen, setWhitelistOpen] = useState(false)

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await fetchJavDuplicates({
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
        search,
      })
      setItems(Array.isArray(data?.items) ? data.items : [])
      setTotal(Number(data?.total) || 0)
    } catch (err) {
      setError(getErrorMessage(err))
      setItems([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [page, search])

  useEffect(() => {
    if (!open) return
    load()
  }, [open, load])

  useEffect(() => {
    if (open) return
    setItems([])
    setTotal(0)
    setPage(1)
    setSelectedIds(new Set())
    setSearch('')
    setSearchInput('')
    setNotice('')
    setError('')
    setWhitelistOpen(false)
  }, [open])

  const pageIds = useMemo(
    () => items.map((item) => Number(item?.id)).filter((id) => Number.isFinite(id) && id > 0),
    [items]
  )

  const toggleSelect = useCallback((id) => {
    const numeric = Number(id)
    if (!Number.isFinite(numeric) || numeric <= 0) return
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(numeric)) next.delete(numeric)
      else next.add(numeric)
      return next
    })
  }, [])

  const selectPage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      pageIds.forEach((id) => next.add(id))
      return next
    })
  }

  const clearSelection = () => setSelectedIds(new Set())

  const handleSearch = (event) => {
    event.preventDefault()
    setPage(1)
    setSelectedIds(new Set())
    setSearch(searchInput.trim())
  }

  const handleAddWhitelist = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await addJavDuplicateWhitelist(ids)
      setNotice(
        zh(
          `已将 ${ids.length} 个作品加入查重白名单，后续查重不再出现。`,
          `Added ${ids.length} work(s) to the duplicate whitelist.`
        )
      )
      setSelectedIds(new Set())
      await load()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <AppModal
        ariaLabel={zh('JAV 查重', 'JAV duplicate scan')}
        className="p-4"
        contentClassName="flex max-h-[92vh] w-[96vw] max-w-[1440px] flex-col overflow-hidden rounded bg-white shadow-2xl"
        onClose={onClose}
        open={open}
        zIndex={1300}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="text-base font-semibold text-gray-800">
              {zh('JAV 查重', 'JAV duplicate scan')}
            </h2>
            <span className="truncate text-xs text-gray-500">
              {zh(
                '同一番号下存在多个视频文件即视为重复',
                'Works with more than one video file are treated as duplicates'
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

        <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-2">
          <form onSubmit={handleSearch} className="flex items-center gap-2">
            <input
              type="text"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={zh('搜索番号或标题', 'Search code or title')}
              className="w-56 rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-400 focus:outline-none"
            />
            <button
              type="submit"
              className="rounded border border-gray-300 px-3 py-1 text-sm hover:border-blue-300 hover:text-blue-600"
            >
              {zh('搜索', 'Search')}
            </button>
          </form>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500">
              {zh(`共 ${total} 项`, `${total} item(s)`)}
            </span>
            <span className="text-xs text-gray-500">
              {zh(`已选 ${selectedIds.size}`, `Selected ${selectedIds.size}`)}
            </span>
            <button
              type="button"
              onClick={selectPage}
              disabled={pageIds.length === 0 || busy}
              className="rounded border border-gray-300 px-3 py-1 text-sm disabled:opacity-50"
            >
              {zh('全选本页', 'Select page')}
            </button>
            <button
              type="button"
              onClick={clearSelection}
              disabled={selectedIds.size === 0 || busy}
              className="rounded border border-gray-300 px-3 py-1 text-sm disabled:opacity-50"
            >
              {zh('清空', 'Clear')}
            </button>
            <button
              type="button"
              onClick={handleAddWhitelist}
              disabled={selectedIds.size === 0 || busy}
              className="rounded bg-blue-600 px-3 py-1 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {zh('加入查重白名单', 'Add to whitelist')}
            </button>
            <button
              type="button"
              onClick={() => setWhitelistOpen(true)}
              className="rounded border border-gray-300 px-3 py-1 text-sm hover:border-blue-300 hover:text-blue-600"
            >
              {zh('白名单管理', 'Manage whitelist')}
            </button>
          </div>
        </div>

        {notice ? (
          <div className="border-b border-green-100 bg-green-50 px-4 py-2 text-xs text-green-700">
            {notice}
          </div>
        ) : null}
        {error ? (
          <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-600">
            {error}
          </div>
        ) : null}

        <div className="min-h-[240px] flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <div className="flex min-h-[200px] items-center justify-center rounded border border-dashed border-gray-200 text-gray-500">
              {zh('加载中…', 'Loading...')}
            </div>
          ) : items.length === 0 ? (
            <div className="flex min-h-[200px] items-center justify-center rounded border border-dashed border-gray-200 text-gray-500">
              {zh('未发现重复作品', 'No duplicates found')}
            </div>
          ) : (
            <JavGrid
              items={items}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              selectionDisabled={busy}
              columns={gridColumns}
              titleMaxRows={titleMaxRows}
              idolTagMaxRows={idolTagMaxRows}
              tagMaxRows={tagMaxRows}
              {...cardProps}
            />
          )}
        </div>

        <div className="border-t border-gray-200 px-4 py-2">
          <Pagination
            page={page}
            lastPage={lastPage}
            hasPrev={page > 1}
            hasNext={page < lastPage}
            totalItems={total}
            onFirst={() => setPage(1)}
            onPrev={() => setPage((current) => Math.max(1, current - 1))}
            onGoToPage={(target) => setPage(target)}
            onNext={() => setPage((current) => Math.min(lastPage, current + 1))}
            onLast={() => setPage(lastPage)}
          />
        </div>
      </AppModal>

      <JavDuplicateWhitelistDialog
        open={whitelistOpen}
        onClose={() => setWhitelistOpen(false)}
        onChanged={load}
      />
    </>
  )
}
