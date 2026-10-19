import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'components')
const readSource = (name) => readFileSync(join(srcDir, name), 'utf8')

test('视频卡片优先展示 JAV 封面，封面缺失时回退视频缩略图', () => {
  const source = readSource('VideoCard.jsx')
  // 与播放记录页一致：刮削过的视频用 /jav/<code>/cover，取不到再回退缩略图，
  // 否则服务端没生成截图时卡片会一直是一块空白。
  assert.ok(
    source.includes('/jav/${encodeURIComponent(code)}/cover'),
    '应优先使用 /jav/<code>/cover 作为封面'
  )
  assert.ok(source.includes('coverSrc === javCoverSrc'), 'JAV 封面加载失败时应回退到视频缩略图')
  assert.ok(source.includes('setImageFailed(true)'), '缩略图也失败时才显示底色占位')
})

test('播放记录与视频卡片采用同样的封面回退顺序', () => {
  const history = readSource('PlaybackHistoryPage.jsx')
  const card = readSource('VideoCard.jsx')
  const priority = 'javCoverSrc && !javCoverFailed ? javCoverSrc : thumbnailSrc'
  assert.ok(history.includes(priority), '播放记录页应优先 JAV 封面')
  assert.ok(card.includes(priority), '视频卡片应与播放记录页保持一致')
})
