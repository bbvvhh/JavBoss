/**
 * `GET /config` 的读取辅助。
 *
 * ⚠️ 后端返回的是 `map[string]string` —— **所有值都是字符串**，
 * 包括布尔值（"true"）和数字（"80"）。而且它**不给默认值**：
 * 全新安装时 map 是残缺的，缺 key 必须由前端自己兜底。
 *
 * 所以不要用 `=== true` 或 `JSON.parse` 去读，一律走下面三个函数。
 */

const FALSE_VALUES = new Set(['0', 'false', 'no', 'off'])

/** 缺 key、空串 → 用 fallback；'0'/'false'/'no'/'off' → false；其余非空 → true。 */
export function configFlag(config, key, fallback = false) {
  const raw = config?.[key]
  if (raw === undefined || raw === null) return fallback
  const value = String(raw).trim().toLowerCase()
  if (value === '') return fallback
  return !FALSE_VALUES.has(value)
}

/** 解析整数；缺失或非法时返回 fallback。 */
export function configInt(config, key, fallback) {
  const raw = config?.[key]
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback
  const value = Number.parseInt(String(raw), 10)
  return Number.isFinite(value) ? value : fallback
}

/** 字符串值；缺失时返回 fallback。 */
export function configString(config, key, fallback = '') {
  const raw = config?.[key]
  if (raw === undefined || raw === null) return fallback
  const value = String(raw)
  return value === '' ? fallback : value
}

/**
 * 只读的运行时派生键（后端 `applyRuntimeConfigFields` 注入）。
 * 这些键是服务端算出来的，PATCH 回去也会被忽略 —— 界面上只做展示。
 */
export const RUNTIME_KEYS = [
  'runtime_os',
  'runtime_container',
  'runtime_remote_request',
  'directory_picker_enabled',
  'desktop_integration_enabled',
  'mpv_enabled',
  'browser_playback_only',
  'host_path_prefix_enabled',
]
