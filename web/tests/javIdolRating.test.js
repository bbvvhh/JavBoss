import assert from 'node:assert/strict'
import fs from 'node:fs'
import { register } from 'node:module'
import test from 'node:test'

// src/ 里用 `@/...` 绝对导入，node 需要这个钩子才能解析（见 aliasLoader.mjs）。
register('./aliasLoader.mjs', import.meta.url)

const { IDOL_SORT_OPTIONS, normalizeIdolSort, IDOL_FAVORITE_ORDER_SORT } = await import(
  '../src/constants/jav.js'
)
const { parseUrlState, buildUrlFromState } = await import('../src/utils/urlState.js')

test('idol sort options expose favorite rating in both directions', () => {
  const option = IDOL_SORT_OPTIONS.find((item) => item.base === 'favorite_rating')
  assert.ok(option, 'favorite_rating option should exist')
  assert.equal(option.defaultValue, 'favorite_rating')
  assert.equal(option.descValue, 'favorite_rating')
  assert.equal(option.ascValue, 'favorite_rating_asc')
  assert.deepEqual(option.label, ['喜爱度', 'Favorite rating'])
})

test('idol default sort stays on work count', () => {
  assert.equal(normalizeIdolSort(undefined), 'work')
  assert.equal(normalizeIdolSort(''), 'work')
})

test('idol sort normalizes favorite rating values and falls back for unknown values', () => {
  assert.equal(normalizeIdolSort('favorite_rating'), 'favorite_rating')
  assert.equal(normalizeIdolSort('favorite_rating_asc'), 'favorite_rating_asc')
  assert.equal(normalizeIdolSort('favorite_rating_desc'), 'favorite_rating')
  assert.equal(normalizeIdolSort('favorite_rating', ''), 'favorite_rating')
  assert.equal(normalizeIdolSort('not-a-sort', 'work'), 'work')
})

test('idol favorite order sort key is distinct from rating sort', () => {
  assert.equal(IDOL_FAVORITE_ORDER_SORT, 'favorite_order')
  assert.notEqual(IDOL_FAVORITE_ORDER_SORT, 'favorite_rating')
})

test('parses idol rating range from URL on the idol tab', () => {
  const parsed = parseUrlState('view=jav&tab=idol&idol_rating_min=2.5&idol_rating_max=4.5')
  assert.equal(parsed.jav.idolRatingEnabled, true)
  assert.equal(parsed.jav.idolRatingMin, 2.5)
  assert.equal(parsed.jav.idolRatingMax, 4.5)
})

test('ignores idol rating range that is out of contract', () => {
  const notPair = parseUrlState('view=jav&tab=idol&idol_rating_min=2.5')
  assert.equal(notPair.jav.idolRatingEnabled, false)
  assert.equal(notPair.jav.idolRatingMin, 0.5)
  assert.equal(notPair.jav.idolRatingMax, 5)

  const inverted = parseUrlState('view=jav&tab=idol&idol_rating_min=4.5&idol_rating_max=2.5')
  assert.equal(inverted.jav.idolRatingEnabled, false)

  const badStep = parseUrlState('view=jav&tab=idol&idol_rating_min=2.3&idol_rating_max=4.5')
  assert.equal(badStep.jav.idolRatingEnabled, false)

  const outOfRange = parseUrlState('view=jav&tab=idol&idol_rating_min=0&idol_rating_max=6')
  assert.equal(outOfRange.jav.idolRatingEnabled, false)
})

test('serializes idol rating range only for the idol tab', () => {
  const baseJav = {
    tab: 'idol',
    page: 1,
    search: '',
    favoriteGroupId: null,
    idolProfileFilters: null,
    tempSort: '',
    random: false,
    seed: null,
  }

  const withRating = buildUrlFromState(
    {
      view: 'jav',
      jav: {
        ...baseJav,
        idolRatingEnabled: true,
        idolRatingMin: 2.5,
        idolRatingMax: 4.5,
      },
    },
    '/'
  )
  assert.match(withRating, /idol_rating_min=2\.5/)
  assert.match(withRating, /idol_rating_max=4\.5/)

  const withoutRating = buildUrlFromState(
    {
      view: 'jav',
      jav: { ...baseJav, idolRatingEnabled: false, idolRatingMin: 0.5, idolRatingMax: 5 },
    },
    '/'
  )
  assert.doesNotMatch(withoutRating, /idol_rating_min/)
})

test('fetchJavIdols sends the idol rating params as a pair', () => {
  const source = fs.readFileSync(new URL('../src/api.js', import.meta.url), 'utf8')
  assert.match(source, /params\.set\('idol_rating_min'/)
  assert.match(source, /params\.set\('idol_rating_max'/)
})
