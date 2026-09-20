import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const srcDir = join(here, '..', 'src')
const apiPath = join(srcDir, 'api.js')
const apiSourceRaw = readFileSync(apiPath, 'utf8')
const apiSource = stripComments(apiSourceRaw)

/** 唯一允许调用重命名的文件（相对 src/ 的 POSIX 路径）。 */
const RENAME_CALL_SITE = 'components/RenamePage.jsx'

/**
 * 去掉注释但保留字符串内容，这样「文档里提到被封禁的接口」不会被误判，
 * 而真实代码里的字符串仍然会被扫描到。
 */
export function stripComments(source) {
  let out = ''
  let i = 0
  let state = 'code'
  while (i < source.length) {
    const c = source[i]
    const next = source[i + 1]
    if (state === 'code') {
      if (c === '/' && next === '/') {
        state = 'line'
        i += 2
        continue
      }
      if (c === '/' && next === '*') {
        state = 'block'
        i += 2
        continue
      }
      if (c === "'") state = 'single'
      else if (c === '"') state = 'double'
      else if (c === '`') state = 'template'
      out += c
      i++
      continue
    }
    if (state === 'line') {
      if (c === '\n') {
        state = 'code'
        out += c
      }
      i++
      continue
    }
    if (state === 'block') {
      if (c === '*' && next === '/') {
        state = 'code'
        i += 2
        continue
      }
      if (c === '\n') out += c
      i++
      continue
    }
    // 字符串 / 模板字符串：保留内容，处理转义
    if (c === '\\') {
      out += c + (next === undefined ? '' : next)
      i += 2
      continue
    }
    if (
      (state === 'single' && c === "'") ||
      (state === 'double' && c === '"') ||
      (state === 'template' && c === '`')
    ) {
      state = 'code'
    }
    out += c
    i++
  }
  return out
}

function sourceFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full))
      continue
    }
    if (/\.(js|jsx)$/.test(entry)) out.push(full)
  }
  return out
}

/**
 * 抽取所有网络请求调用。
 * 必须覆盖 request / requestJSON / requestOK —— 漏掉任何一个都会形成绕过白名单的漏洞。
 */
export function extractRoutes(source) {
  const re = /(request(?:JSON|OK)?)\(\s*'([A-Z]+)'\s*,\s*(`[^`]*`|'[^']*')/g
  const routes = []
  let match
  while ((match = re.exec(source)) !== null) {
    routes.push({ helper: match[1], method: match[2], path: match[3].slice(1, -1) })
  }
  return routes
}

// 只改数据库、不碰文件的例外路径。
const MEDIA_SAFE_LOCATION_ROUTES = ['/videos/locations/hide']

/** 是否是「某个具体视频文件位置」的资源路径（可能被删除或重命名）。 */
export function isMediaLocationResource(path) {
  const p = String(path || '')
  if (!p.includes('/locations/')) return false
  return !MEDIA_SAFE_LOCATION_ROUTES.some((safe) => p.startsWith(safe))
}

/**
 * 用户明确要求：任何时候不允许删除视频文件。
 * 这个判定是整个移动端的最后防线，所以它本身也被测试覆盖。
 */
export function classifyRoute(method, path) {
  const m = String(method || '').toUpperCase()
  const p = String(path || '')

  if (p.includes('/process')) {
    return { allowed: false, reason: '目录整理内部会 os.Remove / os.Rename 用户文件' }
  }
  if (p.includes('/videos/open')) return { allowed: false, reason: '桌面端能力，移动端无意义' }
  if (p.includes('/videos/reveal')) return { allowed: false, reason: '桌面端能力，移动端无意义' }
  if (m === 'DELETE' && isMediaLocationResource(p)) {
    return { allowed: false, reason: '会物理删除视频文件（Linux/macOS 上是 os.Remove）' }
  }
  return { allowed: true }
}

test('stripComments 保留字符串、去掉注释', () => {
  assert.equal(stripComments(`const a = '/x' // '/y'\n`).includes('/y'), false)
  assert.equal(stripComments(`const a = '/x' // '/y'\n`).includes('/x'), true)
  assert.equal(stripComments(`/* '/z' */ const b = 1`).includes('/z'), false)
  assert.equal(stripComments("const c = 'a//b'").includes('a//b'), true)
})

test('extractRoutes 覆盖全部请求 helper（含 requestOK）', () => {
  const sample = [
    `request('GET', \`/a\`)`,
    `requestJSON('POST', \`/b\`)`,
    `requestOK('DELETE', \`/c\`)`,
  ].join('\n')
  const found = extractRoutes(sample).map((route) => `${route.method} ${route.path}`)
  assert.deepEqual(found, ['GET /a', 'POST /b', 'DELETE /c'])
})

test('api.js 保留安全哨兵注释，防止被整体替换后失去约束', () => {
  assert.ok(
    apiSourceRaw.includes('@api-safety-guard'),
    'src/api.js 必须保留 @api-safety-guard 注释块'
  )
  assert.ok(
    apiSourceRaw.includes('任何时候不允许删除视频文件'),
    'src/api.js 必须写明禁止删除视频文件的原因'
  )
})

test('api.js 的每个请求都能被安全测试扫描到', () => {
  const routes = extractRoutes(apiSource)
  assert.ok(routes.length > 0, '没有扫描到任何请求调用')
  for (const route of routes) {
    assert.ok(route.path.startsWith('/'), `路由必须以 / 开头：${route.method} ${route.path}`)
  }
})

test('api.js 不含任何被封禁的接口', () => {
  for (const route of extractRoutes(apiSource)) {
    const verdict = classifyRoute(route.method, route.path)
    assert.ok(verdict.allowed, `${route.method} ${route.path} 被禁止：${verdict.reason}`)
  }
})

test('api.js 里触碰视频文件位置的接口有且仅有受控的重命名', () => {
  const locationRoutes = extractRoutes(apiSource).filter((route) =>
    isMediaLocationResource(route.path)
  )
  assert.equal(
    locationRoutes.length,
    1,
    `只允许一个受控接口，实际发现 ${locationRoutes.length} 个：` +
      locationRoutes.map((r) => `${r.method} ${r.path}`).join(', ')
  )
  const [route] = locationRoutes
  assert.equal(route.method, 'PATCH', '重命名必须是 PATCH，DELETE 会删文件')
  assert.match(
    route.path,
    /^\/videos\/\$\{[^}]+\}\/locations\/\$\{[^}]+\}$/,
    `重命名路由形状必须精确到单个 location，实际是 ${route.path}`
  )
})

test('renameVideoLocation 只能被 RenamePage.jsx 调用', () => {
  const callers = []
  for (const file of sourceFiles(srcDir)) {
    const rel = relative(srcDir, file).replace(/\\/g, '/')
    if (rel === 'api.js') continue
    const source = stripComments(readFileSync(file, 'utf8'))
    if (/\brenameVideoLocation\b/.test(source)) callers.push(rel)
  }
  assert.deepEqual(
    callers.sort(),
    [RENAME_CALL_SITE],
    `renameVideoLocation 是唯一会写媒体目录的接口，只允许 ${RENAME_CALL_SITE} 引用；` +
      `实际引用者：${callers.join(', ') || '（无）'}`
  )
})

test('整个 src/ 不出现封禁字符串，也不绕过 api.js 直接 fetch', () => {
  for (const file of sourceFiles(srcDir)) {
    const rel = relative(srcDir, file).replace(/\\/g, '/')
    const source = stripComments(readFileSync(file, 'utf8'))

    for (const banned of ['/process', '/videos/open', '/videos/reveal']) {
      assert.ok(!source.includes(banned), `${rel} 不得出现 ${banned}`)
    }

    // 所有网络请求必须走 src/api.js，这样上面的白名单才是有效约束。
    if (rel !== 'api.js') {
      assert.ok(!/\bfetch\s*\(/.test(source), `${rel} 直接使用了 fetch()，请改用 @/api 暴露的函数`)
    }
  }
})

test('classifyRoute 判定符合预期（防回归）', () => {
  const forbidden = [
    ['DELETE', '/videos/1/locations/2'],
    ['POST', '/directories/3/process'],
    ['POST', '/videos/open'],
    ['POST', '/videos/reveal'],
  ]
  for (const [method, path] of forbidden) {
    assert.equal(classifyRoute(method, path).allowed, false, `${method} ${path} 应被禁止`)
  }

  const allowed = [
    ['GET', '/videos'],
    ['GET', '/videos/1/streams'],
    ['POST', '/videos/1/play'],
    ['POST', '/videos/tags/add'],
    ['POST', '/videos/locations/hide'],
    ['PATCH', '/videos/1/locations/2'],
    ['DELETE', '/videos/1/screenshots/mpv_00-01-02.jpg'],
    ['POST', '/directories/3/scan'],
    ['DELETE', '/tags/9'],
  ]
  for (const [method, path] of allowed) {
    assert.equal(classifyRoute(method, path).allowed, true, `${method} ${path} 应被允许`)
  }
})

test('isMediaLocationResource 不会把 hide 接口误判为文件位置', () => {
  assert.equal(isMediaLocationResource('/videos/locations/hide'), false)
  assert.equal(isMediaLocationResource('/videos/1/locations/2'), true)
  assert.equal(isMediaLocationResource('/videos'), false)
})
