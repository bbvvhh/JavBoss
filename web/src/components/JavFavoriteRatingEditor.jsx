import { useState } from 'react'
import FavoriteBorderRoundedIcon from '@mui/icons-material/FavoriteBorderRounded'
import FavoriteRoundedIcon from '@mui/icons-material/FavoriteRounded'
import RemoveCircleOutlineRoundedIcon from '@mui/icons-material/RemoveCircleOutlineRounded'
import { Rating, Tooltip } from '@mui/material'

import { zh } from '@/utils/i18n'

/**
 * 作品 / 女优共用的「喜爱度」星级控件。
 *
 * `value` 契约：0 = 未评分；否则 0.5~5.0，0.5 一档。
 * 传入 `readOnly` 时只做展示（列表卡片），不响应点击。
 */
export default function JavFavoriteRatingEditor({
  value,
  saving = false,
  error = '',
  onChange,
  name = 'jav-detail-favorite-rating',
  readOnly = false,
}) {
  const rating = Number(value) || 0
  const [editing, setEditing] = useState(false)
  const [preview, setPreview] = useState(null)
  const tooltipValue = preview ?? rating
  const hasTooltipValue = preview !== null || rating > 0
  const displayCount = Math.ceil(rating)
  const ratingWidth = !editing ? Math.max(displayCount, 1) * 21 : 5 * 21
  const tooltipTitle = error
    ? error
    : preview === 0
      ? zh('清空喜爱度', 'Clear favorite rating')
      : hasTooltipValue
        ? zh(`喜爱度：${tooltipValue.toFixed(1)} 分`, `Favorite rating: ${tooltipValue.toFixed(1)}`)
        : zh('设置喜爱度评分', 'Set favorite rating')
  const starSx = {
    flexShrink: 0,
    color: '#fbbf24',
    fontSize: 21,
    '& .MuiRating-iconEmpty': { color: '#9ca3af' },
  }

  if (readOnly) {
    return (
      <Tooltip title={tooltipTitle} placement="top" arrow>
        <span
          role="group"
          aria-label={zh('喜爱度评分', 'Favorite rating')}
          className="inline-flex items-center rounded-full bg-gray-100 px-1.5 py-0.5"
        >
          <span className="flex overflow-hidden" style={{ width: ratingWidth }}>
            <Rating
              name={name}
              value={rating}
              precision={0.5}
              size="small"
              readOnly
              icon={<FavoriteRoundedIcon fontSize="inherit" />}
              emptyIcon={<FavoriteBorderRoundedIcon fontSize="inherit" />}
              sx={starSx}
            />
          </span>
          {rating > 0 ? (
            <span className="ml-1 shrink-0 text-xs font-semibold tabular-nums leading-none text-gray-700">
              {rating.toFixed(1)}
            </span>
          ) : null}
        </span>
      </Tooltip>
    )
  }

  return (
    <Tooltip title={tooltipTitle} placement="top" arrow>
      <span
        role="group"
        aria-label={zh('喜爱度评分', 'Favorite rating')}
        className={`inline-flex items-center rounded-full bg-gray-100 px-1.5 py-0.5 transition-opacity ${
          saving ? 'opacity-60' : 'opacity-100'
        }`}
        onMouseLeave={() => {
          setEditing(false)
          setPreview(null)
        }}
        onBlur={(event) => {
          if (event.currentTarget.contains(event.relatedTarget)) return
          setEditing(false)
          setPreview(null)
        }}
      >
        <span
          className="flex overflow-hidden transition-[width] duration-150"
          style={{ width: ratingWidth }}
        >
          <Rating
            name={name}
            value={rating}
            precision={0.5}
            size="small"
            icon={<FavoriteRoundedIcon fontSize="inherit" />}
            emptyIcon={<FavoriteBorderRoundedIcon fontSize="inherit" />}
            disabled={saving}
            onChange={onChange}
            onMouseEnter={() => setEditing(true)}
            onFocus={() => setEditing(true)}
            onChangeActive={(_, nextValue) => setPreview(nextValue >= 0.5 ? nextValue : null)}
            sx={starSx}
          />
        </span>
        {editing && rating > 0 ? (
          <button
            type="button"
            className="ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-gray-500 transition hover:bg-gray-200 hover:text-gray-800"
            disabled={saving}
            aria-label={zh('清空喜爱度', 'Clear favorite rating')}
            onMouseEnter={() => setPreview(0)}
            onMouseLeave={() => setPreview(null)}
            onClick={(event) => onChange?.(event, 0)}
          >
            <RemoveCircleOutlineRoundedIcon sx={{ fontSize: 16 }} />
          </button>
        ) : null}
        {rating > 0 && !editing ? (
          <span className="ml-1 shrink-0 text-xs font-semibold tabular-nums leading-none text-gray-700">
            {rating.toFixed(1)}
          </span>
        ) : null}
      </span>
    </Tooltip>
  )
}
