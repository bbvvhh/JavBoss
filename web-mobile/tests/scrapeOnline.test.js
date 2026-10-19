import test from 'node:test'
import assert from 'node:assert/strict'

const {
  SCRAPE_PROVIDERS,
  isScrapeCodeValid,
  normalizeScrapeCode,
  pickFirstPossibleCode,
  scrapeResultMissingFields,
  scrapeResultToManualPayload,
} = await import('../src/utils/scrapeOnline.js')

test('SCRAPE_PROVIDERS 与后端 lookup 支持的来源一致', () => {
  assert.deepEqual(
    SCRAPE_PROVIDERS.map((item) => item.value),
    ['javbus', 'avmoo', 'avsox']
  )
})

test('normalizeScrapeCode 去空格并转大写', () => {
  assert.equal(normalizeScrapeCode('  ssis-698 '), 'SSIS-698')
  assert.equal(normalizeScrapeCode(null), '')
})

test('isScrapeCodeValid 只接受字母数字与 -_', () => {
  assert.equal(isScrapeCodeValid('abc-001'), true)
  assert.equal(isScrapeCodeValid('ABC_001'), true)
  assert.equal(isScrapeCodeValid('-ABC'), false)
  assert.equal(isScrapeCodeValid('ABC 001'), false)
  assert.equal(isScrapeCodeValid(''), false)
})

test('pickFirstPossibleCode 兼容字符串与对象两种候选形状', () => {
  assert.equal(pickFirstPossibleCode({ possible_codes: ['abc-001', 'def-002'] }), 'ABC-001')
  assert.equal(
    pickFirstPossibleCode({ possible_codes: [{ code: 'abc-001' }, { code: 'def-002' }] }),
    'ABC-001'
  )
  assert.equal(pickFirstPossibleCode({ possible_codes: [] }), '')
  assert.equal(pickFirstPossibleCode(null), '')
})

test('scrapeResultToManualPayload 生成手动刮削所需的字段', () => {
  const payload = scrapeResultToManualPayload({
    code: 'ssis-698',
    title: ' 测试标题 ',
    studio: 'S1',
    series: '系列',
    release_date: '2024-11-08',
    duration_min: '120',
    tags: ['标签A', '标签A', { name: '标签B' }],
    actors: ['演员A'],
    cover_url: 'https://example.com/c.jpg',
    is_uncensored: false,
  })
  assert.deepEqual(payload, {
    code: 'SSIS-698',
    title: '测试标题',
    studio: 'S1',
    series: '系列',
    release_date: '2024-11-08',
    duration_min: 120,
    tags: ['标签A', '标签B'],
    actors: ['演员A'],
    cover_url: 'https://example.com/c.jpg',
    is_uncensored: false,
  })
})

test('scrapeResultToManualPayload 缺字段时保持空值且不臆造 is_uncensored', () => {
  const payload = scrapeResultToManualPayload({ code: 'ABC-001' })
  assert.equal(payload.duration_min, null)
  assert.equal(payload.release_date, '')
  assert.deepEqual(payload.tags, [])
  assert.ok(!('is_uncensored' in payload))
})

test('scrapeResultMissingFields 指出缺失的必填字段', () => {
  assert.deepEqual(scrapeResultMissingFields({ code: 'ABC-001' }), [
    'title',
    'release_date',
    'duration_min',
    'is_uncensored',
  ])

  const complete = {
    code: 'ABC-001',
    title: 'T',
    release_date: '2024-01-02',
    duration_min: 100,
    is_uncensored: true,
  }
  assert.deepEqual(scrapeResultMissingFields(complete), [])

  assert.deepEqual(
    scrapeResultMissingFields({
      title: 'T',
      release_date: '2024-01-02',
      duration_min: 1,
      is_uncensored: false,
    }),
    ['code']
  )
})
