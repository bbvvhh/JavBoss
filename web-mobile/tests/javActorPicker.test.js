import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const srcDir = join(here, '..', 'src')
const pickerPath = join(srcDir, 'components', 'JavActorPickerSheet.jsx')
const detailPath = join(srcDir, 'components', 'JavDetailPage.jsx')

const read = (path) => readFileSync(path, 'utf8')

/**
 * 需求硬约束：给作品调整演员时**只允许从已有女优里选**，不得顺手新建女优。
 * 这里用源码扫描把它钉死 —— 一旦有人往选择器里塞新建入口，测试立刻失败。
 */
test('调整演员选择器只从已有女优里选，不提供新建入口', () => {
  const source = read(pickerPath)
  assert.match(source, /\bfetchJavIdols\b/, '候选列表必须来自已有女优接口')
  assert.match(source, /\bupdateJavItem\b/, '保存必须走作品更新接口的 idol_ids')
  // 不允许调用任何「新建」类接口（如 createJavIdol / createJavItem 之类）。
  assert.ok(!/\bcreate[A-Za-z]+/.test(source), '不允许出现任何新建（create*）调用')
  // 网络请求必须走 @/api，不得自行拼接路由绕过 api.js 的白名单。
  assert.ok(!/request(JSON|OK)?\s*\(/.test(source), '网络请求必须走 @/api 暴露的函数')
})

test('作品详情页接入调整演员：入口 + 保存后回写本地与列表补丁', () => {
  const source = read(detailPath)
  assert.match(source, /\bJavActorPickerSheet\b/, '详情页必须引入并渲染调整演员抽屉')
  assert.match(source, /open=\{actorPickerOpen\}/, '抽屉应由页面状态控制开关')
  assert.match(source, /patchJavItem\(javId,\s*\{\s*idols/, '保存后要把 idols 写回列表补丁表')
})
