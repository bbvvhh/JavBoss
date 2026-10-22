import assert from 'node:assert/strict'
import test from 'node:test'

import { getVideoFolderPath } from '../src/utils/videoPath.js'

test('返回嵌套相对路径所在的文件夹', () => {
  assert.equal(getVideoFolderPath({ path: 'A/B/f.mp4' }), 'A/B')
})

test('反斜杠路径按正斜杠归一化', () => {
  assert.equal(getVideoFolderPath({ path: 'A\\B\\f.mp4' }), 'A/B')
})

test('根目录下的视频返回空串', () => {
  assert.equal(getVideoFolderPath({ path: 'f.mp4' }), '')
})

test('缺少 video / path 时返回空串', () => {
  assert.equal(getVideoFolderPath(null), '')
  assert.equal(getVideoFolderPath({}), '')
  assert.equal(getVideoFolderPath({ path: '   ' }), '')
})
