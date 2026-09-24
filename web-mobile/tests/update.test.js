import assert from 'node:assert/strict'
import test from 'node:test'
import { register } from 'node:module'

// src/ 里用 `@/...` 绝对导入，node 需要这个钩子才能解析（见 aliasLoader.mjs）。
register('./aliasLoader.mjs', import.meta.url)

const {
  describeUpdatePackage,
  describeUpdatePlatform,
  lastUpdateNotice,
  pendingUpdateText,
  summarizePackageContents,
  updateLocationFromOverview,
} = await import('../src/utils/update.js')

test('updateLocationFromOverview 区分本机目录与 WebDAV 远程目录', () => {
  assert.deepEqual(updateLocationFromOverview(null), {
    kind: 'local',
    connectionId: '',
    path: '',
  })
  assert.deepEqual(
    updateLocationFromOverview({ update_path: 'D:\\releases', update_connection_id: null }),
    { kind: 'local', connectionId: '', path: 'D:\\releases' }
  )
  assert.deepEqual(
    updateLocationFromOverview({ update_path: '/releases', update_connection_id: 4 }),
    { kind: 'webdav', connectionId: '4', path: '/releases' }
  )
})

test('summarizePackageContents 只拼接存在的项', () => {
  assert.equal(summarizePackageContents({ fileCount: 12, totalSize: 998877 }), '12 个文件 · 975 KB')
  assert.equal(summarizePackageContents({ fileCount: 0, totalSize: 0 }), '0 B')
  assert.equal(summarizePackageContents({}), '')
  assert.equal(summarizePackageContents(), '')
})

test('pendingUpdateText 没有暂存更新时为空', () => {
  assert.equal(pendingUpdateText(null), '')
  assert.equal(pendingUpdateText(undefined), '')
  assert.equal(pendingUpdateText({}), '')
})

test('pendingUpdateText 摘要发布包名与内容', () => {
  const text = pendingUpdateText({
    file_name: 'javboss-0.2.0-windows-x86_64.zip',
    file_count: 12,
    total_size: 998877,
  })
  assert.match(text, /javboss-0\.2\.0-windows-x86_64\.zip/)
  assert.match(text, /12 个文件 · 975 KB/)
})

test('describeUpdatePackage 组装发布包的平台、体积与时间', () => {
  const described = describeUpdatePackage({
    name: 'javboss-0.2.0-windows-x86_64.zip',
    size: 1234567,
    modified_at: '2026-09-23T20:15:00+08:00',
    format: 'zip',
    platform: 'windows-x86_64',
    compatible: true,
  })
  assert.equal(described.name, 'javboss-0.2.0-windows-x86_64.zip')
  assert.equal(described.platform, 'windows-x86_64')
  assert.equal(described.compatible, true)
  assert.equal(described.sizeText, '1.2 MB')
  assert.match(described.timeText, /^2026-09-23 20:15$/)
  assert.equal(described.metaText, `${described.timeText} · 1.2 MB`)
})

test('describeUpdatePackage 对缺失字段保持稳定', () => {
  assert.deepEqual(describeUpdatePackage(null), {
    name: '',
    timeText: '',
    sizeText: '',
    platform: '',
    compatible: false,
    metaText: '',
  })
})

// compatible 只认布尔 true：缺字段的后端版本不能把包显示成「可更新」。
test('describeUpdatePackage 只把 compatible === true 当成可用', () => {
  assert.equal(describeUpdatePackage({ name: 'a.zip', compatible: 'true' }).compatible, false)
  assert.equal(describeUpdatePackage({ name: 'a.zip' }).compatible, false)
})

test('describeUpdatePlatform 把平台串翻译成可读名称', () => {
  assert.match(describeUpdatePlatform('windows-x86_64'), /Windows 64/)
  assert.match(describeUpdatePlatform('linux-arm64-proot'), /Termux/)
  assert.match(describeUpdatePlatform('macos-arm64'), /macOS/)
  // 认不出来时原样返回，界面才有东西可显示。
  assert.equal(describeUpdatePlatform('freebsd-x86_64'), 'freebsd-x86_64')
  assert.equal(describeUpdatePlatform(''), '')
  assert.equal(describeUpdatePlatform(null), '')
})

test('lastUpdateNotice 没有更新结果时返回 null', () => {
  assert.equal(lastUpdateNotice(null), null)
  assert.equal(lastUpdateNotice(undefined), null)
})

test('lastUpdateNotice 优先报告未完成的原因', () => {
  const notice = lastUpdateNotice({
    file_name: 'javboss-0.2.0-windows-x86_64.zip',
    applied_at: '2026-09-23T21:00:00+08:00',
    file_count: 3,
    error: 'replace javboss.exe: access denied',
    restart_required: false,
  })
  assert.equal(notice.tone, 'error')
  assert.equal(notice.restartNeeded, false)
  assert.match(notice.title, /上次更新未完成|did not finish/)
  assert.match(notice.title, /access denied/)
})

test('lastUpdateNotice 成功时强调重启生效', () => {
  const notice = lastUpdateNotice({
    file_name: 'javboss-0.2.0-linux-x86_64.tar.gz',
    applied_at: '2026-09-23T21:00:00+08:00',
    file_count: 9,
    restart_required: true,
    error: '',
  })
  assert.equal(notice.tone, 'ok')
  assert.equal(notice.restartNeeded, true)
  assert.match(notice.title, /更新已写入程序目录|written to the program directory/)
  assert.match(notice.title, /9/)
  assert.match(notice.detail, /data 目录|data directory/)
})

// restart_required 缺省也要按「需要重启」处理，不能因为字段缺失就少提示一句。
test('lastUpdateNotice 缺少 restart_required 时默认需要重启', () => {
  const notice = lastUpdateNotice({ file_name: 'a.zip', error: '' })
  assert.equal(notice.restartNeeded, true)
})
