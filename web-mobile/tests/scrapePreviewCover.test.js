import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const src = join(here, '..', 'src')
const apiSource = readFileSync(join(src, 'api.js'), 'utf8')
const pageSource = readFileSync(join(src, 'components', 'ScrapeOnlinePage.jsx'), 'utf8')

test('api.js 暴露删除预览封面的接口', () => {
  assert.match(
    apiSource,
    /requestOK\('DELETE', `\/videos\/\$\{videoId\}\/jav-scrape\/cover-preview`\)/
  )
})

test('刮削预览优先使用本地预览封面，并在关闭时删除临时封面', () => {
  assert.ok(pageSource.includes('cover_preview_url'), '预览应使用后端下载到临时目录的本地封面')
  assert.match(
    pageSource,
    /disposeVideoJavScrapeCoverPreview\(video\.id\)/,
    '离开页面时应删除临时封面'
  )
  assert.ok(pageSource.includes('onBack={closePage}'), '返回按钮必须走会清理临时封面的 closePage')
})
