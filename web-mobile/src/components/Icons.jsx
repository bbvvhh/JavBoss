const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

const FILLED = { fill: 'currentColor', stroke: 'none' }

const PATHS = {
  search: (
    <>
      <circle cx="11" cy="11" r="6.6" {...STROKE} />
      <path d="M16.2 16.2 21 21" {...STROKE} />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" {...STROKE} />
      <path
        d="M19.5 12c0-.5-.05-1-.14-1.47l1.6-1.24-1.9-3.29-1.9.77a7.5 7.5 0 0 0-2.55-1.48L14.4 3.3h-3.8l-.2 1.99a7.5 7.5 0 0 0-2.56 1.48l-1.9-.77-1.9 3.29 1.6 1.24a7.6 7.6 0 0 0 0 2.94l-1.6 1.24 1.9 3.29 1.9-.77a7.5 7.5 0 0 0 2.55 1.48l.21 1.99h3.8l.2-1.99a7.5 7.5 0 0 0 2.56-1.48l1.9.77 1.9-3.29-1.6-1.24c.09-.47.14-.97.14-1.47Z"
        {...STROKE}
      />
    </>
  ),
  sort: <path d="M7 4v15m0 0-3-3m3 3 3-3M17 20V5m0 0-3 3m3-3 3 3" {...STROKE} />,
  shuffle: (
    <path
      d="M17 4h3v3M21 4l-6 6M7 20H4v-3M3 20l6-6M17 20h3v-3M21 20l-4.5-4.5M7 4H4v3M3 4l4.5 4.5"
      {...STROKE}
    />
  ),
  tag: (
    <>
      <path d="M3 10.5V4.5A1.5 1.5 0 0 1 4.5 3h6l10 10-7.5 7.5L3 10.5Z" {...STROKE} />
      <circle cx="7.5" cy="7.5" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  filter: <path d="M4 6h16M7 12h10M10 18h4" {...STROKE} strokeWidth={2} />,
  subtitles: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" {...STROKE} />
      <path d="M7 10h4.5M7 14h7M14.5 10H17" {...STROKE} />
    </>
  ),
  layers: (
    <path
      d="M12 3.5 3.5 8 12 12.5 20.5 8 12 3.5ZM3.5 12.5 12 17l8.5-4.5M3.5 16.5 12 21l8.5-4.5"
      {...STROKE}
      strokeWidth={1.7}
    />
  ),
  play: <path d="M7 4.5 19.5 12 7 19.5V4.5Z" {...FILLED} />,
  check: <path d="m5 12.5 4.5 4.5L19 7" {...STROKE} strokeWidth={2.6} />,
  x: <path d="M6 6l12 12M18 6 6 18" {...STROKE} strokeWidth={2} />,
  more: (
    <>
      <circle cx="12" cy="5.5" r="1.9" {...FILLED} />
      <circle cx="12" cy="12" r="1.9" {...FILLED} />
      <circle cx="12" cy="18.5" r="1.9" {...FILLED} />
    </>
  ),
  back: <path d="M15 5 8 12l7 7" {...STROKE} strokeWidth={2.2} />,
  down: <path d="m6 9 6 6 6-6" {...STROKE} strokeWidth={2.2} />,
  right: <path d="m9 5 7 7-7 7" {...STROKE} strokeWidth={2.2} />,
  film: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.4" {...STROKE} />
      <path d="M8 4v16M16 4v16M3 12h18M3 8h5M3 16h5M16 8h5M16 16h5" {...STROKE} strokeWidth={1.4} />
    </>
  ),
  star: (
    <path
      d="m12 3.6 2.7 5.5 6 .9-4.35 4.25 1.03 6-5.38-2.83L6.62 20.2l1.03-6L3.3 10l6-.9L12 3.6Z"
      {...STROKE}
    />
  ),
  image: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.2" {...STROKE} />
      <circle cx="8.6" cy="9.6" r="1.6" fill="currentColor" stroke="none" />
      <path d="m4 17.5 5-4.6 3.3 3 2.6-2.3 5.1 4.4" {...STROKE} />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v5.5c0 4.2 2.9 7.7 7 9.5 4.1-1.8 7-5.3 7-9.5V6l-7-3Z" {...STROKE} />
      <path d="m9 12 2.2 2.2L15.5 10" {...STROKE} />
    </>
  ),
  ban: (
    <>
      <circle cx="12" cy="12" r="8.4" {...STROKE} />
      <path d="M6.2 6.2 17.8 17.8" {...STROKE} />
    </>
  ),
  folder: (
    <path
      d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.4h7A1.5 1.5 0 0 1 19 9.9v7.6A1.5 1.5 0 0 1 17.5 19h-13A1.5 1.5 0 0 1 3 17.5v-10Z"
      {...STROKE}
    />
  ),
  refresh: <path d="M20 11a8 8 0 1 0-1.6 5.6M20 5.5V11h-5.4" {...STROKE} />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.4" {...STROKE} />
      <path d="M12 7.5V12l3 1.8" {...STROKE} />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.4" {...STROKE} />
      <path d="M12 11v5.2" {...STROKE} />
      <circle cx="12" cy="7.9" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  desktop: (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="1.8" {...STROKE} />
      <path d="M9 20h6M12 16.5V20" {...STROKE} />
    </>
  ),
  rename: <path d="M4 20h4l10-10a2.1 2.1 0 0 0-3-3L5 17v3ZM14.5 6.5l3 3" {...STROKE} />,
  heart: (
    <path
      d="M12 20s-7.5-4.6-7.5-9.7A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.9C19.5 15.4 12 20 12 20Z"
      {...STROKE}
    />
  ),
  wand: (
    <path
      d="M4 20 15 9M14 4.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1ZM19.5 13l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6.6-1.4Z"
      {...STROKE}
      strokeWidth={1.7}
    />
  ),
  trash: (
    <path
      d="M4 7h16M9 7V5.2A1.2 1.2 0 0 1 10.2 4h3.6A1.2 1.2 0 0 1 15 5.2V7M6.5 7l.9 12.1A1.4 1.4 0 0 0 8.8 20.4h6.4a1.4 1.4 0 0 0 1.4-1.3L17.5 7"
      {...STROKE}
    />
  ),
  expand: <path d="M4 9V4h5M20 15v5h-5M4 4l6 6M20 20l-6-6" {...STROKE} />,
  plus: <path d="M12 5.5v13M5.5 12h13" {...STROKE} />,
  minus: <path d="M5.5 12h13" {...STROKE} />,
  // 单向箭头。排序用的双向「sort」图标旋转 180° 之后外形几乎一样，
  // 拿来做「上移 / 下移」按钮用户根本分不出哪个是哪个，所以另开两个图标。
  arrowUp: <path d="M12 19.5V5m0 0-5 5m5-5 5 5" {...STROKE} strokeWidth={2.2} />,
  arrowDown: <path d="M12 4.5V19m0 0-5-5m5 5 5-5" {...STROKE} strokeWidth={2.2} />,
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2" {...STROKE} />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" {...STROKE} />
    </>
  ),
  download: <path d="M12 4v11m0 0-4-4m4 4 4-4M4.5 19.5h15" {...STROKE} />,
  list: <path d="M4 7h16M4 12h16M4 17h10" {...STROKE} strokeWidth={2} />,
  logout: (
    <path
      d="M14 5.5H6.5A1.5 1.5 0 0 0 5 7v10a1.5 1.5 0 0 0 1.5 1.5H14M17 8.5 20.5 12 17 15.5M10 12h10.5"
      {...STROKE}
    />
  ),
  inbox: <path d="M3.5 13.5 6 5h12l2.5 8.5V19h-17v-5.5ZM3.5 13.5H9l1 2h4l1-2h5.5" {...STROKE} />,
  eye: (
    <>
      <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" {...STROKE} />
      <circle cx="12" cy="12" r="3" {...STROKE} />
    </>
  ),
  eyeOff: (
    <>
      <path
        d="M4 5.5 20 18.5M9.6 6.3A9.6 9.6 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3.6 4.1M6.3 8.3A16.6 16.6 0 0 0 2.5 12s3.5 6 9.5 6c1.2 0 2.3-.2 3.2-.6"
        {...STROKE}
      />
      <path d="M10.1 10.3a3 3 0 0 0 4.2 4.2" {...STROKE} />
    </>
  ),
}

export default function Icon({ name, size = 20, className = '', strokeWidth }) {
  const body = PATHS[name]
  if (!body) return null
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
      style={strokeWidth ? { strokeWidth } : undefined}
    >
      {body}
    </svg>
  )
}

export const ICON_NAMES = Object.keys(PATHS)
