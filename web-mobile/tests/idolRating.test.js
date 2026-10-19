import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { register } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// src/ 里用 `@/...` 绝对导入，node 需要这个钩子才能解析（见 aliasLoader.mjs）。
register('./aliasLoader.mjs', import.meta.url)

const {
  IDOL_SORT_OPTIONS,
  createDefaultIdolProfileFilters,
  createDefaultIdolRatingFilter,
  findIdolSortOption,
  idolRatingRangeParams,
  normalizeIdolRatingFilter,
  normalizeIdolSort,
} = await import('../src/constants/jav.js')
const { buildUrlFromState, parseUrlState, urlStatePatch } = await import('../src/utils/urlState.js')
const { useStore } = await import('../src/store.js')
const { fetchJavIdols, updateJavIdol } = await import('../src/api.js')

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
const readSource = (...parts) => readFileSync(join(srcDir, ...parts), 'utf8')

/** 请求捕获：mock global.fetch，返回一个还原函数。 */
function mockFetch(calls) {
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init: init || {} })
    return { ok: true, status: 200, json: async () => ({ items: [], total: 0 }) }
  }
  return () => {
    globalThis.fetch = original
  }
}

function queryOf(url) {
  const sp = new URLSearchParams(url.split('?')[1] || '')
  const out = {}
  for (const key of new Set(sp.keys())) {
    const values = sp.getAll(key)
    out[key] = values.length > 1 ? values : values[0]
  }
  return out
}

function baseState(patch = {}) {
  return {
    view: 'jav',
    searchTerm: '',
    selectedTags: [],
    sort: 'recent',
    hideJav: false,
    randomSeed: null,
    javTab: 'idols',
    javSort: 'recent',
    javRandomSeed: null,
    javFilters: {},
    idolSort: '',
    idolProfileFilters: createDefaultIdolProfileFilters(),
    idolRatingFilter: createDefaultIdolRatingFilter(),
    ...patch,
  }
}

test('女优排序新增喜爱度两项，取值与作品一致，默认排序仍是 work', () => {
  const rating = IDOL_SORT_OPTIONS.find((option) => option.base === 'favorite_rating')
  assert.ok(rating, '女优排序必须有 favorite_rating')
  assert.equal(rating.ascValue, 'favorite_rating_asc')
  assert.equal(rating.descValue, 'favorite_rating')
  assert.deepEqual(rating.label, ['喜爱度', 'Rating'])

  assert.equal(normalizeIdolSort('favorite_rating', 'x'), 'favorite_rating')
  assert.equal(normalizeIdolSort('favorite_rating_asc', 'x'), 'favorite_rating_asc')
  assert.equal(findIdolSortOption('favorite_rating_asc').base, 'favorite_rating')

  // 默认排序不能被这次改动带偏。
  assert.equal(IDOL_SORT_OPTIONS[0].base, 'work')
  assert.equal(normalizeIdolSort('', 'work'), 'work')
  assert.equal(normalizeIdolSort('zzz', 'work'), 'work')
  assert.equal(useStore.getState().idolSort, '')
})

test('喜爱度区间归一化到 0.5~5、0.5 一档；未启用不产生请求参数', () => {
  assert.deepEqual(createDefaultIdolRatingFilter(), { enabled: false, min: 0.5, max: 5 })
  assert.deepEqual(normalizeIdolRatingFilter({ enabled: true, min: 0.2, max: 9 }), {
    enabled: true,
    min: 0.5,
    max: 5,
  })
  assert.deepEqual(normalizeIdolRatingFilter({ enabled: true, min: 3.3, max: 4.8 }), {
    enabled: true,
    min: 3.5,
    max: 5,
  })
  // min > max 时互相夹住，绝不出现反区间。
  const swapped = normalizeIdolRatingFilter({ enabled: true, min: 5, max: 2 })
  assert.ok(swapped.min <= swapped.max)

  assert.deepEqual(idolRatingRangeParams(createDefaultIdolRatingFilter()), [])
  assert.deepEqual(idolRatingRangeParams({ enabled: true, min: 3, max: 4.5 }), [
    { key: 'rating', min: 3, max: 4.5 },
  ])
})

test('女优喜爱度：URL 往返一致，非法 / 缺一边一律丢弃', () => {
  const url = buildUrlFromState(
    baseState({
      idolSort: 'favorite_rating',
      idolRatingFilter: { enabled: true, min: 3, max: 4.5 },
    }),
    '/'
  )
  const query = queryOf(url)
  assert.equal(query.tab, 'idols')
  assert.equal(query.idol_sort, 'favorite_rating')
  assert.equal(query.idol_rating_min, '3')
  assert.equal(query.idol_rating_max, '4.5')

  const patch = urlStatePatch(parseUrlState(url.slice(url.indexOf('?'))))
  assert.equal(patch.idolSort, 'favorite_rating')
  assert.deepEqual(patch.idolRatingFilter, { enabled: true, min: 3, max: 4.5 })
  // 复原后再写一次地址，结果必须完全相同。
  assert.equal(buildUrlFromState(baseState({ ...patch }), '/'), url)

  // 未启用时不写任何参数。
  assert.equal(queryOf(buildUrlFromState(baseState(), '/')).idol_rating_min, undefined)

  // 只给一边 / 越界 / 步长不对 / 反区间都当成「没写」。
  assert.equal(parseUrlState('?idol_rating_min=3').jav.idolRatingFilter, null)
  assert.equal(parseUrlState('?idol_rating_max=3').jav.idolRatingFilter, null)
  assert.equal(parseUrlState('?idol_rating_min=0&idol_rating_max=5').jav.idolRatingFilter, null)
  assert.equal(parseUrlState('?idol_rating_min=3.3&idol_rating_max=5').jav.idolRatingFilter, null)
  assert.equal(parseUrlState('?idol_rating_min=4&idol_rating_max=3').jav.idolRatingFilter, null)
  assert.deepEqual(parseUrlState('?idol_rating_min=0.5&idol_rating_max=5').jav.idolRatingFilter, {
    enabled: true,
    min: 0.5,
    max: 5,
  })
})

test('api：喜爱度区间拼成 idol_rating_min/max，updateJavIdol 走 PATCH /jav/idols/:id', async () => {
  const calls = []
  const restore = mockFetch(calls)
  try {
    await fetchJavIdols({
      limit: 1,
      offset: 0,
      sort: 'favorite_rating',
      profileRanges: [
        { key: 'height', min: 155, max: 175 },
        { key: 'rating', min: 3, max: 4.5 },
      ],
    })
    await updateJavIdol(5, { favorite_rating: 0 })
  } finally {
    restore()
  }

  const listUrl = calls[0].url
  assert.match(listUrl, /^\/jav\/idols\?/)
  assert.match(listUrl, /idol_rating_min=3/)
  assert.match(listUrl, /idol_rating_max=4.5/)
  assert.match(listUrl, /idol_height_min=155/)
  assert.match(listUrl, /sort=favorite_rating/)

  assert.equal(calls[1].init.method, 'PATCH')
  assert.equal(calls[1].url, '/jav/idols/5')
  assert.deepEqual(JSON.parse(calls[1].init.body), { favorite_rating: 0 })
})

test('入口已接好：详情页可编辑星级、筛选面板含喜爱度区间、卡片展示星级', () => {
  const detail = readSource('components', 'JavDetailPage.jsx')
  assert.ok(detail.includes('updateJavIdol'), '女优详情页要用 updateJavIdol 保存喜爱度')
  assert.ok(
    /export function JavIdolPage[\s\S]*<FavoriteRating[\s\S]*\/>/.test(detail),
    '女优详情页要挂载 FavoriteRating（与作品同一组件）'
  )

  const sheet = readSource('components', 'JavIdolFilterSheet.jsx')
  assert.ok(sheet.includes('idolRatingRangeParams'), '筛选面板命中数要带上喜爱度区间')
  assert.ok(sheet.includes('setIdolRatingFilter'), '应用时要把区间写回 store')

  const list = readSource('components', 'JavListPage.jsx')
  assert.ok(list.includes('idolRatingRangeParams'), '女优列表请求要带喜爱度区间')
  assert.ok(list.includes('idol.favorite_rating'), '女优卡片要展示星级')
})
