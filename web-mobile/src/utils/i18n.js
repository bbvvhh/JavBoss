// 从 web/src/utils/i18n.js 复制而来（PC 端工程保持零改动）。
// 移动端工程自包含，避免跨工程耦合。
const primaryLanguage = (() => {
  if (typeof navigator !== 'undefined') {
    if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
      return navigator.languages[0]
    }
    if (navigator.language) {
      return navigator.language
    }
  }
  if (typeof document !== 'undefined') {
    const lang = document.documentElement?.lang
    if (lang) {
      return lang
    }
  }
  return ''
})()

const prefersChinese = /^zh\b/i.test(String(primaryLanguage || '').trim())

export function isChineseLocale() {
  return prefersChinese
}

export function zh(cn, en) {
  return prefersChinese ? cn : en
}
