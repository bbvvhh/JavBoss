import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { register } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// src/ 里用 `@/...` 绝对导入，node 需要这个钩子才能解析（见 aliasLoader.mjs）。
register('./aliasLoader.mjs', import.meta.url)

const { JAV_TAB_VALUES, applyUrlState, buildUrlFromState, parseUrlState, urlStatePatch } =
  await import('../src/utils/urlState.js')
const { EMPTY_JAV_FILTERS, useStore } = await import('../src/store.js')
const { createDefaultIdolProfileFilters, normalizeIdolProfileFilters } =
  await import('../src/constants/jav.js')
const { initialViewMode } = await import('../src/utils/javDisplay.js')

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
const readSource = (...parts) => readFileSync(join(srcDir, ...parts), 'utf8')

/** 查询串 → 便于断言的普通对象（重复键取数组）。 */
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
    view: 'video',
    searchTerm: '',
    selectedTags: [],
    sort: 'recent',
    hideJav: false,
    randomSeed: null,
    javTab: 'works',
    javSort: 'recent',
    javRandomSeed: null,
    javFilters: { ...EMPTY_JAV_FILTERS },
    idolSort: '',
    idolProfileFilters: createDefaultIdolProfileFilters(),
    ...patch,
  }
}

test('空地址栏：所有项都当成「没写」，不会覆盖设置里的默认值', () => {
  const parsed = parseUrlState('')
  assert.equal(parsed.view, null)
  assert.equal(parsed.search, '')
  assert.equal(parsed.video.sort, '')
  assert.equal(parsed.video.hideJav, null, '三态：没写不能等于 false')
  assert.equal(parsed.video.random, false)
  assert.equal(parsed.jav.tab, null)
  assert.equal(parsed.jav.sort, '')
  assert.equal(parsed.jav.idolSort, '')
  assert.deepEqual(parsed.jav.filters, {})
  assert.equal(parsed.jav.idolProfileFilters, null)
  assert.deepEqual(urlStatePatch(parsed), {}, '默认设置（初始视图 / 默认随机）要原样留住')
})

test('非法值一律丢弃：排序、隐藏 JAV、tab 都不许把脏数据带进 store', () => {
  const parsed = parseUrlState('?view=jelly&tab=videos&sort=zzz&hide_jav=maybe&random=1')
  assert.equal(parsed.view, null, '不认识的视图保持设置里的初始模式')
  assert.equal(parsed.jav.tab, null)
  assert.equal(parsed.video.sort, '')
  assert.equal(parsed.video.hideJav, null)
  assert.equal(parsed.video.random, true)

  const patch = urlStatePatch(parsed)
  assert.equal('sort' in patch, false)
  assert.equal('hideJav' in patch, false)
  assert.ok(patch.randomSeed > 0 && patch.randomSeed <= 2147483646, '进随机时要补一个合法种子')
})

test('视频：标签按名字逐个写、可重复，隐藏 JAV 与排序都在 URL 里', () => {
  const state = baseState({
    searchTerm: ' 深田 ',
    selectedTags: ['无码', '中文字幕'],
    sort: 'play_count_asc',
    hideJav: true,
  })
  const url = buildUrlFromState(state, '/')
  const query = queryOf(url)
  assert.equal(query.view, 'video')
  assert.equal(query.search, '深田')
  assert.deepEqual(query.tags, ['无码', '中文字幕'])
  assert.equal(query.hide_jav, '1')
  assert.equal(query.sort, 'play_count_asc')

  const parsed = parseUrlState(url.slice(url.indexOf('?')))
  assert.deepEqual(urlStatePatch(parsed), {
    view: 'video',
    searchTerm: '深田',
    searchInput: '深田',
    selectedTags: ['无码', '中文字幕'],
    sort: 'play_count_asc',
    hideJav: true,
  })
  assert.equal(parsed.jav.sort, '', '视频的排序不能串到 JAV 作品页')
})

test('随机模式：URL 只记随机标记不记种子，复原现货一个新种子（重启 / 刷新不再复用上一屏）', () => {
  const url = buildUrlFromState(baseState({ randomSeed: 987654, sort: 'duration' }), '/')
  const query = queryOf(url)
  assert.equal(query.random, '1')
  assert.equal(query.seed, undefined, '不写种子，否则重启 / 刷新会一直看到同一屏')
  assert.equal(query.sort, undefined, '随机模式下排序由种子决定，写了反而误导')

  const patch = urlStatePatch(parseUrlState(url.slice(url.indexOf('?'))))
  assert.equal('javRandomSeed' in patch, false, '视频的随机标记不能带到作品页')
  assert.ok(
    patch.randomSeed > 0 && patch.randomSeed <= 2147483646,
    '每次按 URL 复原随机都要现摇一个新种子'
  )
})

test('JAV 作品随机同样只记标记，进页面现摇种子', () => {
  const url = buildUrlFromState(baseState({ view: 'jav', javRandomSeed: 13579 }), '/')
  const query = queryOf(url)
  assert.equal(query.random, '1')
  assert.equal(query.seed, undefined)
  assert.equal(query.sort, undefined)

  const patch = urlStatePatch(parseUrlState(url.slice(url.indexOf('?'))))
  assert.equal('randomSeed' in patch, false, '作品页的随机标记不能串到视频页')
  assert.ok(patch.javRandomSeed > 0 && patch.javRandomSeed <= 2147483646)
})

test('JAV 作品：筛选条件往返一致，studio / 系列 / 收藏夹都带上名字用于回显', () => {
  const state = baseState({
    view: 'jav',
    javTab: 'works',
    javSort: 'favorite_rating',
    javFilters: {
      ...EMPTY_JAV_FILTERS,
      prefix: 'abc',
      idolIds: [9, 3],
      tagIds: [12],
      studioId: 4,
      studioName: 'S1',
      seriesId: 8,
      seriesName: 'Ser',
      favoriteGroupId: 6,
      favoriteGroupName: '我的收藏',
      soloOnly: true,
      favoriteRatingEnabled: true,
      favoriteRatingMin: 3,
      favoriteRatingMax: 4.5,
    },
  })
  const url = buildUrlFromState(state, '/')
  const query = queryOf(url)
  assert.equal(query.view, 'jav')
  assert.equal(query.tab, undefined, '作品页是默认子分类，不必写出来')
  assert.equal(query.prefix, 'ABC', '前缀统一大写，与后端风格一致')
  assert.equal(query.idol_ids, '9,3')
  assert.equal(query.tag_ids, '12')
  assert.equal(query.studio_id, '4')
  assert.equal(query.studio_name, 'S1')
  assert.equal(query.series_id, '8')
  assert.equal(query.series_name, 'Ser')
  assert.equal(query.fav_group_id, '6')
  assert.equal(query.fav_group_name, '我的收藏')
  assert.equal(query.solo, '1')
  assert.equal(query.fav_min, '3')
  assert.equal(query.fav_max, '4.5')
  assert.equal(query.sort, 'favorite_rating')

  const patch = urlStatePatch(parseUrlState(url.slice(url.indexOf('?'))))
  assert.deepEqual(patch.javFilters, {
    ...EMPTY_JAV_FILTERS,
    prefix: 'ABC',
    idolIds: [9, 3],
    tagIds: [12],
    studioId: 4,
    studioName: 'S1',
    seriesId: 8,
    seriesName: 'Ser',
    favoriteGroupId: 6,
    favoriteGroupName: '我的收藏',
    soloOnly: true,
    favoriteRatingEnabled: true,
    favoriteRatingMin: 3,
    favoriteRatingMax: 4.5,
  })
  assert.equal(patch.javSort, 'favorite_rating')
  assert.equal(
    'javTab' in patch,
    false,
    '作品页是默认子分类，URL 不写 tab，复原时保留 store 的默认值'
  )

  // 复原后再写一次地址，结果必须与第一次完全相同（否则刷新会来回改写 URL）。
  assert.equal(buildUrlFromState({ ...baseState(), ...patch }, '/'), url)
})

test('喜爱度区间：缺一边 / 越界 / 非 0.5 步进都不启用，避免整单 400', () => {
  assert.equal(parseUrlState('?fav_min=3').jav.filters.favoriteRatingEnabled, undefined)
  assert.equal(parseUrlState('?fav_min=0&fav_max=5').jav.filters.favoriteRatingEnabled, undefined)
  assert.equal(parseUrlState('?fav_min=3.3&fav_max=5').jav.filters.favoriteRatingEnabled, undefined)
  assert.equal(parseUrlState('?fav_min=4&fav_max=3').jav.filters.favoriteRatingEnabled, undefined)
  assert.deepEqual(parseUrlState('?fav_min=0.5&fav_max=5').jav.filters.favoriteRatingMin, 0.5)
})

test('JAV 子分类：女优页只带自己的排序与资料范围，片商 / 系列页只带搜索词', () => {
  const idols = buildUrlFromState(
    baseState({
      view: 'jav',
      javTab: 'idols',
      searchTerm: 'x',
      idolSort: 'height',
      idolProfileFilters: normalizeIdolProfileFilters({
        height: { enabled: true, min: 155, max: 175 },
        cup: { enabled: false, min: 1, max: 11 },
      }),
    }),
    '/'
  )
  const idolQuery = queryOf(idols)
  assert.equal(idolQuery.tab, 'idols')
  assert.equal(idolQuery.search, 'x')
  assert.equal(idolQuery.idol_sort, 'height')
  assert.equal(idolQuery.idol_height_min, '155')
  assert.equal(idolQuery.idol_height_max, '175')
  assert.equal(idolQuery.idol_cup_min, undefined, '未启用的资料筛选不写进 URL')
  assert.equal(idolQuery.tag_ids, undefined, '作品页的筛选不该跑到女优页')

  const parsed = parseUrlState(idols.slice(idols.indexOf('?')))
  assert.equal(parsed.jav.tab, 'idols')
  assert.equal(parsed.jav.idolSort, 'height')
  assert.deepEqual(parsed.jav.idolProfileFilters, {
    height: { enabled: true, min: 155, max: 175 },
  })
  const patch = urlStatePatch(parsed)
  assert.deepEqual(
    patch.idolProfileFilters,
    normalizeIdolProfileFilters({ height: { enabled: true, min: 155, max: 175 } })
  )

  const studios = buildUrlFromState(
    baseState({ view: 'jav', javTab: 'studios', searchTerm: 'y' }),
    '/'
  )
  assert.deepEqual(queryOf(studios), { view: 'jav', tab: 'studios', search: 'y' })
  assert.deepEqual(JAV_TAB_VALUES, ['works', 'idols', 'studios', 'series'])
})

test('资料范围越界 / 只有一边时整项丢弃', () => {
  assert.equal(parseUrlState('?idol_height_min=150').jav.idolProfileFilters, null)
  assert.equal(
    parseUrlState('?idol_height_min=100&idol_height_max=170').jav.idolProfileFilters,
    null
  )
  assert.equal(parseUrlState('?idol_age_min=30&idol_age_max=20').jav.idolProfileFilters, null)
  assert.deepEqual(parseUrlState('?idol_cup_min=3&idol_cup_max=6').jav.idolProfileFilters, {
    cup: { enabled: true, min: 3, max: 6 },
  })
})

test('applyUrlState 直接落到 store 上，JAV 筛选补齐其余字段', () => {
  useStore.setState(baseState())
  const patch = applyUrlState(
    useStore,
    parseUrlState(
      '?view=jav&tab=idols&search=abc&idol_sort=hips&idol_height_min=150&idol_height_max=170'
    )
  )
  const state = useStore.getState()
  assert.equal(state.view, 'jav')
  assert.equal(state.javTab, 'idols')
  assert.equal(state.searchTerm, 'abc')
  assert.equal(state.searchInput, 'abc', '搜索框里也要回显，不然用户看不出为什么列表被过滤了')
  assert.equal(state.idolSort, 'hips')
  assert.equal(state.idolProfileFilters.height.enabled, true)
  assert.equal(state.idolProfileFilters.height.max, 170)
  assert.deepEqual(patch.javFilters, undefined, '女优页不带作品筛选')

  // 空地址栏不能把已有的筛选清掉。
  useStore.setState(baseState({ view: 'jav', javTab: 'works', searchTerm: 'keep' }))
  applyUrlState(useStore, parseUrlState(''))
  assert.equal(useStore.getState().searchTerm, 'keep')
  assert.equal(useStore.getState().view, 'jav')
})

test('写回地址用 replaceState，且不动 history.state 与返回键', () => {
  const hook = readSource('hooks', 'useUrlStateSync.js')
  assert.ok(hook.includes('history.replaceState'), '必须替换当前记录')
  assert.ok(!hook.includes('history.pushState('), '压记录会让返回键变成连续撤销筛选')
  assert.ok(hook.includes('window.history.state'), '页面栈的标记在 history.state 里，必须原样带回')
  assert.ok(hook.includes('useStore.subscribe'), '筛选变化要自动写回')
  assert.ok(
    !hook.includes("addEventListener('popstate'"),
    '地址栏不作为导航来源，返回不能覆盖当前条件'
  )

  const app = readSource('App.jsx')
  assert.ok(app.includes('useUrlStateSync(ready)'), '配置就位后才开始同步')
  assert.ok(
    app.includes('applyUrlState(useStore, parseUrlState(window.location.search))'),
    '首屏要在拉列表之前按地址栏复原'
  )
})

test('其它模式：view=other 记下目录与相对路径，中文 / 斜杠往返不丢', () => {
  const state = baseState({ view: 'other', otherDirectoryId: 12, otherPath: 'A/子目录 B' })
  const url = buildUrlFromState(state, '/')
  const query = queryOf(url)
  assert.equal(query.view, 'other')
  assert.equal(query.dir, '12')
  assert.equal(query.path, 'A/子目录 B')
  assert.equal(query.sort, undefined, '其它模式不借用视频的共用键 sort')
  assert.equal(query.random, undefined, '其它模式不借用视频的共用键 random')
  assert.equal(query.hide_jav, undefined)

  const parsed = parseUrlState(url.slice(url.indexOf('?')))
  assert.equal(parsed.view, 'other')
  assert.deepEqual(parsed.other, { directoryId: 12, path: 'A/子目录 B' })
  assert.equal(parsed.video.sort, '', '视频排序不能串到其它模式')
  assert.equal(parsed.video.random, false)
  assert.deepEqual(urlStatePatch(parsed), {
    view: 'other',
    otherDirectoryId: 12,
    otherPath: 'A/子目录 B',
  })

  // 复原后再写一次地址，结果必须与第一次完全相同（否则刷新会来回改写 URL）。
  assert.equal(buildUrlFromState({ ...baseState(), ...urlStatePatch(parsed) }, '/'), url)
})

test('其它模式：不带 dir 时只写 view，view 不是 other 时 dir / path 一律忽略', () => {
  const rootUrl = buildUrlFromState(baseState({ view: 'other' }), '/')
  assert.deepEqual(queryOf(rootUrl), { view: 'other' })

  const parsed = parseUrlState('?view=video&dir=5&path=A')
  assert.deepEqual(parsed.other, { directoryId: null, path: '' })
  assert.equal('otherDirectoryId' in urlStatePatch(parsed), false, 'dir 只属于其它模式')

  assert.equal(parseUrlState('?view=other&dir=0').other.directoryId, null, '非法目录 id 丢弃')
})

test('initialViewMode：video / jav / other 三态，非法值回落 video', () => {
  assert.equal(initialViewMode({ initial_view_mode: 'video' }), 'video')
  assert.equal(initialViewMode({ initial_view_mode: 'jav' }), 'jav')
  assert.equal(initialViewMode({ initial_view_mode: 'other' }), 'other')
  assert.equal(initialViewMode({}), 'video')
  assert.equal(initialViewMode({ initial_view_mode: 'jelly' }), 'video')
})
