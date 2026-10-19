import pkg from '../../package.json'

/**
 * 版本号优先取打包时注入的 `VITE_APP_VERSION`（由 scripts/cli 发布时写入，与安装包
 * 版本保持一致）；dev / 未注入时回落到 package.json 的 version。
 *
 * 统一去掉前缀的 `v`：页面里再拼 `v${APP_VERSION}`，避免发布版本是 `v2.1.2` 时
 * 显示成 `vv2.1.2`。
 */
function normalizeVersion(raw) {
  return String(raw || '')
    .trim()
    .replace(/^v/i, '')
}

export const APP_VERSION =
  normalizeVersion(import.meta.env.VITE_APP_VERSION || pkg.version) || '0.0.0'

/** 与 PC 端「切换到电脑版 / 手机版」共用的 UI 偏好 Cookie 名。 */
export const UI_MODE_COOKIE = 'javboss_ui'
