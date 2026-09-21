/**
 * node:test 用的模块解析钩子。
 *
 * `src/` 里统一使用 `@/...` 绝对导入（eslint 强制），但 node 只会解析真实路径。
 * 测试文件在动态 import 之前 `register()` 本文件，就能像 vite 一样解析别名，
 * 顺带补上省略的扩展名（`@/utils/i18n` → `src/utils/i18n.js`）。
 */
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const sourceRoot = new URL('../src/', import.meta.url)

function resolveCandidates(basePath) {
  return [
    basePath,
    `${basePath}.js`,
    `${basePath}.jsx`,
    `${basePath}.mjs`,
    `${basePath}/index.js`,
    `${basePath}/index.jsx`,
  ]
}

export async function resolve(specifier, context, nextResolve) {
  if (typeof specifier !== 'string' || !specifier.startsWith('@/')) {
    return nextResolve(specifier, context)
  }
  const target = fileURLToPath(new URL(specifier.slice(2), sourceRoot))
  for (const candidate of resolveCandidates(target)) {
    if (existsSync(candidate)) {
      return nextResolve(pathToFileURL(candidate).href, context)
    }
  }
  return nextResolve(specifier, context)
}
