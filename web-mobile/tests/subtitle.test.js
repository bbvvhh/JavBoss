import assert from 'node:assert/strict'
import test from 'node:test'
import { register } from 'node:module'

// src/ 里用 `@/...` 绝对导入，node 需要这个钩子才能解析（见 aliasLoader.mjs）。
register('./aliasLoader.mjs', import.meta.url)

const {
  DEFAULT_SUBTITLE_API_URL,
  describeSubtitleMatch,
  formatDurationDelta,
  formatSubtitleDuration,
  searchResultTitle,
  subtitleDisplayName,
  subtitleLanguageLabel,
} = await import('../src/utils/subtitle.js')

test('DEFAULT_SUBTITLE_API_URL 使用迅雷字幕接口并保留 {keyword} 占位符', () => {
  assert.equal(
    DEFAULT_SUBTITLE_API_URL,
    'https://api-shoulei-ssl.xunlei.com/oracle/subtitle?name={keyword}'
  )
})

test('formatSubtitleDuration 把毫秒格式化成 H:MM:SS / M:SS', () => {
  assert.equal(formatSubtitleDuration(7467301), '2:04:27')
  assert.equal(formatSubtitleDuration(5672987), '1:34:33')
  assert.equal(formatSubtitleDuration(125000), '2:05')
  assert.equal(formatSubtitleDuration(1000), '0:01')
})

test('formatSubtitleDuration 对未知时长返回空字符串', () => {
  for (const value of [0, null, undefined, -1, 'abc', NaN]) {
    assert.equal(formatSubtitleDuration(value), '')
  }
})

test('formatDurationDelta 描述字幕与视频的时长差', () => {
  assert.equal(formatDurationDelta(0), '时长一致')
  assert.equal(formatDurationDelta(12000), '差 12 秒')
  assert.equal(formatDurationDelta(120000), '差 2 分')
  assert.equal(formatDurationDelta(125000), '差 2 分 5 秒')
  assert.equal(formatDurationDelta(-1), '')
})

test('describeSubtitleMatch 组合文件名匹配与时长差', () => {
  assert.equal(
    describeSubtitleMatch({ match_tier: 0, duration_delta_ms: 301, extra_name: '（网友上传）' }),
    '文件名完全匹配 · 时长一致 · （网友上传）'
  )
  assert.equal(describeSubtitleMatch({ match_tier: 2, duration_delta_ms: -1 }), '')
})

test('subtitleDisplayName / searchResultTitle 提供兜底文案', () => {
  assert.equal(subtitleDisplayName({ title: 'ABP-001.srt' }), 'ABP-001.srt')
  assert.equal(subtitleDisplayName({}), '未命名字幕')
  assert.equal(searchResultTitle({ name: 'abp001.srt' }), 'abp001.srt')
  assert.equal(searchResultTitle({}), '未命名字幕')
})

test('subtitleLanguageLabel 对空语言给出占位', () => {
  assert.equal(subtitleLanguageLabel({ language: '简体' }), '简体')
  assert.equal(subtitleLanguageLabel(null), '未知语言')
})
