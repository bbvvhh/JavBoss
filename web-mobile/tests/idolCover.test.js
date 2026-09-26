import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { register } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// src/ 里用 `@/...` 绝对导入，node 需要这个钩子才能解析（见 aliasLoader.mjs）。
register('./aliasLoader.mjs', import.meta.url)

const {
  IDOL_COVER_ASPECT,
  IDOL_COVER_DEFAULT_CROP_LEFT,
  IDOL_COVER_VISIBLE_RATIO,
  coverImageStyle,
  getCoverVisibleRatio,
  normalizeDynamicCropLeft,
  normalizeIdolCoverCropLeft,
} = await import('../src/utils/idolCover.js')
const { fetchJavIdolCoverOptions, updateJavIdolCover } = await import('../src/api.js')

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
const readSource = (...parts) => readFileSync(join(srcDir, ...parts), 'utf8')

/** 用假的 fetch 收集请求，避免真发网络请求。 */
async function withFetch(run) {
  const calls = []
  const previous = globalThis.fetch
  globalThis.fetch = async (path, init) => {
    calls.push({ path, init })
    return { ok: true, status: 200, json: async () => ({ items: [], cover_code: 'ABC-001' }) }
  }
  try {
    await run()
  } finally {
    globalThis.fetch = previous
  }
  return calls
}

test('默认起点是「贴右显示」：1 - 可见比例，与后端缺省 0.53 一致', () => {
  assert.equal(IDOL_COVER_VISIBLE_RATIO, 0.47)
  assert.equal(IDOL_COVER_DEFAULT_CROP_LEFT, 1 - IDOL_COVER_VISIBLE_RATIO)
  assert.equal(IDOL_COVER_DEFAULT_CROP_LEFT, 0.53)
  assert.equal(IDOL_COVER_ASPECT, '376 / 538')
})

test('normalizeIdolCoverCropLeft：非法回落默认起点，合法值夹到 [0,1]', () => {
  assert.equal(normalizeIdolCoverCropLeft(undefined), IDOL_COVER_DEFAULT_CROP_LEFT)
  assert.equal(normalizeIdolCoverCropLeft('abc'), IDOL_COVER_DEFAULT_CROP_LEFT)
  assert.equal(normalizeIdolCoverCropLeft(-1), 0)
  assert.equal(normalizeIdolCoverCropLeft(2), 1)
  assert.equal(normalizeIdolCoverCropLeft('0.2'), 0.2)
})

test('normalizeDynamicCropLeft：夹在 [0, maxCropLeft]，上限非法时按 0', () => {
  assert.equal(normalizeDynamicCropLeft(0.9, 0.53), 0.53)
  assert.equal(normalizeDynamicCropLeft(-0.2, 0.53), 0)
  assert.equal(normalizeDynamicCropLeft(0.3, 0.53), 0.3)
  assert.equal(normalizeDynamicCropLeft(0.3, 0), 0, '没有可拖动余量时只能是 0')
  assert.equal(normalizeDynamicCropLeft('x', 0.53), 0)
})

test('getCoverVisibleRatio：800×538 的源图正好是 47%，尺寸未知时回落 47%', () => {
  // 47% 是由 800×538 与窗口纵横比反算出来的，浮点除法留一点误差。
  assert.ok(Math.abs(getCoverVisibleRatio({ width: 800, height: 538 }) - 0.47) < 1e-9)
  assert.equal(getCoverVisibleRatio(null), IDOL_COVER_VISIBLE_RATIO)
  assert.equal(getCoverVisibleRatio({ width: 0, height: 0 }), IDOL_COVER_VISIBLE_RATIO)
})

test('coverImageStyle：默认参数等价于改版前的 right:0 贴右裁切', () => {
  const style = coverImageStyle()
  assert.equal(style.width, `${100 / IDOL_COVER_VISIBLE_RATIO}%`)
  assert.equal(style.left, `${(-IDOL_COVER_DEFAULT_CROP_LEFT * 100) / IDOL_COVER_VISIBLE_RATIO}%`)
  assert.equal(style.maxWidth, 'none', '必须覆盖 Tailwind 的 img{max-width:100%}')
  // 语义等价：左偏移 + 宽度正好铺满窗口（右边缘对齐 100%）。
  assert.ok(
    Math.abs(Number.parseFloat(style.left) + Number.parseFloat(style.width) - 100) < 1e-9,
    '右边缘必须刚好落在窗口右边'
  )
})

test('coverImageStyle：起点 0 时贴左，超出上限时按上限夹住', () => {
  assert.equal(Number.parseFloat(coverImageStyle(0).left), 0)
  assert.equal(
    coverImageStyle(0.9).left,
    coverImageStyle(1 - IDOL_COVER_VISIBLE_RATIO).left,
    '超过上限的起点要被夹住，不能把图拉出窗口'
  )
})

test('fetchJavIdolCoverOptions 走 GET /jav/idols/:id/cover-options', async () => {
  const calls = await withFetch(() => fetchJavIdolCoverOptions(12))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].path, '/jav/idols/12/cover-options')
  assert.equal(calls[0].init.method, 'GET')
})

test('updateJavIdolCover 走 PUT /jav/idols/:id/cover，默认是自动选择', async () => {
  const calls = await withFetch(() => updateJavIdolCover(12, { javId: 7, cropLeft: 0.2 }))
  assert.equal(calls[0].path, '/jav/idols/12/cover')
  assert.equal(calls[0].init.method, 'PUT')
  assert.deepEqual(JSON.parse(calls[0].init.body), { jav_id: 7, crop_left: 0.2 })

  // 「重置 / 自动选择」= jav_id 0 + 默认起点，后端会把两者都恢复。
  const reset = await withFetch(() => updateJavIdolCover(12))
  assert.deepEqual(JSON.parse(reset[0].init.body), {
    jav_id: 0,
    crop_left: IDOL_COVER_DEFAULT_CROP_LEFT,
  })
})

test('封面编辑页只从 api.js 引入封面的两个接口', () => {
  // 白名单而不是黑名单：一旦有人引入会改动文件的接口（截图、封面重下…），这里立刻失败。
  const source = readSource('components', 'IdolCoverEditorPage.jsx')
  const imports = Array.from(source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@\/api'/g))
  assert.equal(imports.length, 1, '封面编辑页应当只从 @/api 引入一次')
  const names = imports[0][1]
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
    .sort()
  assert.deepEqual(names, ['fetchJavIdolCoverOptions', 'updateJavIdolCover'])
})

test('封面编辑页把结果写回补丁表，并复用 coverImageStyle 保持裁切一致', () => {
  const source = readSource('components', 'IdolCoverEditorPage.jsx')
  assert.ok(source.includes('patchJavIdol(idolId'), '保存后要回写补丁表，列表与详情才会更新')
  assert.ok(source.includes('coverImageStyle(displayCropLeft)'), '小样要用同一套裁切计算')
  assert.ok(source.includes('IDOL_COVER_VISIBLE_RATIO'), '取景框宽度必须用列表同一个常数')
})

test('女优详情页点封面进封面编辑页，并把库存的起点交给 IdolCover', () => {
  const detail = readSource('components', 'JavDetailPage.jsx')
  assert.ok(detail.includes("pushPage('jav-idol-cover', coverIdol)"), '封面要能进编辑页')
  assert.ok(detail.includes('cropLeft={coverIdol?.cover_crop_left}'), '详情页要按存的起点裁切')

  // 补丁表里的封面优先于进页面时的 payload 快照。
  assert.ok(detail.includes('itemPatches[idolPatchKey(idolId)]'), '详情页要读补丁表')

  const app = readSource('App.jsx')
  assert.ok(app.includes("topPage?.type === 'jav-idol-cover'"), 'App 要渲染封面编辑页')
})

test('IdolCover 与列表页都接了起点参数，编辑结果三处一致', () => {
  const cover = readSource('components', 'IdolCover.jsx')
  assert.ok(cover.includes('cropLeft = IDOL_COVER_DEFAULT_CROP_LEFT'), '不传起点时保持贴右')
  assert.ok(cover.includes('coverImageStyle(cropLeft)'), '定位要走同一套计算')

  const list = readSource('components', 'JavListPage.jsx')
  assert.ok(list.includes('cropLeft={idol.cover_crop_left}'), '列表卡片也要按存的起点裁切')
})

test('封面来源列表吸顶，吸顶栏里带当前封面的小图与番号', () => {
  const source = readSource('components', 'IdolCoverEditorPage.jsx')
  // 滚到列表里挑来源时上面那块大预览已经出屏，标题栏要吸顶兜住「当前选的是哪张」。
  // SubPage 的滚动容器是内层 div（顶栏是 flex 兄弟节点），所以是 top-0 而不是 top-50px。
  assert.ok(source.includes('sticky top-0'), '封面来源标题栏要吸顶')
  // 小图用源图 800×538 的纵横比：这里要认的是「哪一张封面」，不是裁切窗口。
  assert.ok(source.includes('IDOL_COVER_SOURCE_WIDTH'), '小图按源图纵横比布局')
  // 与大图共用同一个失败标记，否则大图已提示「封面待下载」时小图还留一个空框。
  assert.equal(
    source.split('onError={() => setImageFailed(true)}').length - 1,
    2,
    '大图与吸顶小图共用同一个加载失败标记'
  )
})
