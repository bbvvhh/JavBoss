import pkg from '../../package.json'

/**
 * 移动端版本号直接读 package.json，避免手写常量与包版本漂移。
 * Vite 原生支持 JSON 导入（只取 version，其余字段会被 tree-shake）。
 */
export const APP_VERSION = String(pkg.version || '0.0.0')

/** 与 PC 端「切换到电脑版 / 手机版」共用的 UI 偏好 Cookie 名。 */
export const UI_MODE_COOKIE = 'javboss_ui'
