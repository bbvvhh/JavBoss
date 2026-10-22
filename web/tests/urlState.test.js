import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { register } from 'node:module'

const source = fs.readFileSync(new URL('../src/utils/urlState.js', import.meta.url), 'utf8')

test('page URL state no longer parses or serializes directory_ids', () => {
  assert.doesNotMatch(source, /directory_ids/)
})

// src/ 里用 `@/...` 绝对导入，node 需要这个钩子才能解析（见 aliasLoader.mjs）。
register('./aliasLoader.mjs', import.meta.url)

const { buildUrlFromState, normalizeUrlStateFromStore, parseUrlState } = await import(
  '../src/utils/urlState.js'
)

test('parseUrlState 支持 view=other 与 dir/path', () => {
  const empty = parseUrlState('', { defaultView: 'other' })
  assert.equal(empty.view, 'other')
  assert.equal(empty.other.directoryId, null)
  assert.equal(empty.other.path, '')

  const parsed = parseUrlState('?view=other&dir=12&path=A%2FB')
  assert.equal(parsed.view, 'other')
  assert.equal(parsed.other.directoryId, 12)
  assert.equal(parsed.other.path, 'A/B')

  const fallback = parseUrlState('?view=other')
  assert.equal(fallback.view, 'other')
})

test('buildUrlFromState 输出 other 的 dir/path 并编码', () => {
  const url = buildUrlFromState({ view: 'other', other: { directoryId: 12, path: 'A/B' } }, '/')
  assert.match(url, /view=other/)
  assert.match(url, /dir=12/)
  assert.match(url, /path=A%2FB/)
  assert.doesNotMatch(url, /page=/)

  const unknownView = buildUrlFromState({ view: 'video', video: { page: 1 } }, '/')
  assert.match(unknownView, /view=video/)
})

test('other 视图 URL 回环保持一致', () => {
  const state = { view: 'other', other: { directoryId: 8, path: '子/目录' } }
  const url = buildUrlFromState(state, '/')
  const parsed = parseUrlState(url.slice(url.indexOf('?')))
  assert.equal(parsed.view, 'other')
  assert.equal(parsed.other.directoryId, 8)
  assert.equal(parsed.other.path, '子/目录')
})

test('normalizeUrlStateFromStore 归一化其它模式状态', () => {
  const normalized = normalizeUrlStateFromStore(
    { viewMode: 'other', otherDirectoryId: 5, otherPath: 'A/B' },
    []
  )
  assert.equal(normalized.view, 'other')
  assert.deepEqual(normalized.other, { directoryId: 5, path: 'A/B' })

  const fallback = normalizeUrlStateFromStore({ viewMode: 'other' }, [])
  assert.deepEqual(fallback.other, { directoryId: null, path: '' })

  const video = normalizeUrlStateFromStore({ viewMode: 'video' }, [])
  assert.equal(video.view, 'video')
})
