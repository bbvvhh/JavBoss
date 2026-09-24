import assert from 'node:assert/strict'
import test from 'node:test'
import { register } from 'node:module'

// src/ 里用 `@/...` 绝对导入，node 需要这个钩子才能解析（见 aliasLoader.mjs）。
register('./aliasLoader.mjs', import.meta.url)

const {
  buildUpdateSettingsPayload,
  describeUpdatePackage,
  describeUpdatePlatform,
  lastUpdateNotice,
  pendingUpdateNotice,
  updateLocationFromOverview,
} = await import('../src/utils/update.js')

// 文案跟随系统语言，断言同时接受中英文。
const ZH_OR_EN = {
  replacing: /正在覆盖|Replacing/,
  rollback: /回滚|rolls the program back|rolls it back/,
  didNotFinish: /没有完成|did not finish/,
  applied: /已应用|applied/,
  restart: /重启|restart/i,
  untouched: /data 目录|data directory/,
}

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

// 从远程切回本机时必须显式下发 0，否则后端会把本机路径当成远程路径。
test('buildUpdateSettingsPayload 显式区分本地与 WebDAV 位置', () => {
  assert.deepEqual(buildUpdateSettingsPayload({ updatePath: '/releases', connectionId: 7 }), {
    update_path: '/releases',
    connection_id: 7,
  })
  assert.deepEqual(buildUpdateSettingsPayload({ updatePath: 'D:\\releases', connectionId: 0 }), {
    update_path: 'D:\\releases',
    connection_id: 0,
  })
  // 空字符串 / 非法值都按「本机目录」处理。
  assert.deepEqual(buildUpdateSettingsPayload({ updatePath: '/x', connectionId: '' }), {
    update_path: '/x',
    connection_id: 0,
  })
  // 不传 connectionId 表示「保持当前选择」，不能凭空塞一个 0 进去。
  assert.equal('connection_id' in buildUpdateSettingsPayload({ updatePath: '/x' }), false)
})

test('buildUpdateSettingsPayload 用空路径表达取消目录，并去除首尾空白', () => {
  assert.deepEqual(buildUpdateSettingsPayload({ updatePath: '   ' }), { update_path: '' })
  assert.deepEqual(buildUpdateSettingsPayload({ updatePath: '  /releases  ' }), {
    update_path: '/releases',
  })
  assert.deepEqual(buildUpdateSettingsPayload({}), {})
})

test('describeUpdatePackage 组装发布包的平台、体积与时间', () => {
  const described = describeUpdatePackage({
    name: 'javboss-0.2.0-windows-x86_64.zip',
    size: 12900000,
    modified_at: '2026-09-23T20:15:00+08:00',
    format: 'zip',
    platform: 'windows-x86_64',
    compatible: true,
  })
  assert.equal(described.name, 'javboss-0.2.0-windows-x86_64.zip')
  assert.equal(described.sizeText, '12.3 MB')
  assert.equal(described.platform, 'windows-x86_64')
  assert.equal(described.compatible, true)
  assert.match(described.timeText, /2026/)
  assert.equal(described.metaText, `${described.timeText} · 12.3 MB`)
})

test('describeUpdatePackage 对缺失字段保持稳定', () => {
  assert.deepEqual(describeUpdatePackage(null), {
    name: '',
    timeText: '',
    sizeText: '—',
    platform: '',
    compatible: false,
    metaText: '—',
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

test('pendingUpdateNotice 没有暂存更新时返回 null', () => {
  assert.equal(pendingUpdateNotice(null), null)
  assert.equal(pendingUpdateNotice({}), null)
  assert.equal(pendingUpdateNotice({ file_name: '  ' }), null)
})

test('pendingUpdateNotice 提示正在覆盖程序文件并说明会自动回滚', () => {
  const notice = pendingUpdateNotice({
    file_name: 'javboss-0.2.0-windows-x86_64.zip',
    file_count: 12,
    total_size: 998877,
  })
  assert.equal(notice.fileName, 'javboss-0.2.0-windows-x86_64.zip')
  assert.equal(notice.fileCount, 12)
  assert.equal(notice.sizeText, '975.5 KB')
  assert.match(notice.title, ZH_OR_EN.replacing)
  assert.match(notice.detail, ZH_OR_EN.rollback)
  assert.match(notice.detail, /12/)
})

test('lastUpdateNotice 没有更新结果时返回 null', () => {
  assert.equal(lastUpdateNotice(null), null)
  assert.equal(lastUpdateNotice(undefined), null)
  assert.equal(lastUpdateNotice({ file_name: '  ' }), null)
})

test('lastUpdateNotice 优先报告未完成的原因', () => {
  const notice = lastUpdateNotice({
    file_name: 'javboss-0.2.0-windows-x86_64.zip',
    applied_at: '2026-09-23T21:00:00+08:00',
    file_count: 3,
    error: 'replace javboss.exe: access denied',
    restart_required: false,
  })
  assert.equal(notice.failed, true)
  assert.equal(notice.restartNeeded, false)
  assert.match(notice.title, ZH_OR_EN.didNotFinish)
  assert.match(notice.detail, /access denied/)
  assert.match(notice.detail, /javboss-0\.2\.0-windows-x86_64\.zip/)
})

test('lastUpdateNotice 成功时强调重启生效与 data 目录不动', () => {
  const notice = lastUpdateNotice({
    file_name: 'javboss-0.2.0-linux-x86_64.tar.gz',
    applied_at: '2026-09-23T21:00:00+08:00',
    file_count: 9,
    restart_required: true,
    error: '',
  })
  assert.equal(notice.failed, false)
  assert.equal(notice.restartNeeded, true)
  assert.match(notice.title, ZH_OR_EN.applied)
  assert.match(notice.title, ZH_OR_EN.restart)
  assert.match(notice.detail, ZH_OR_EN.untouched)
  assert.match(notice.detail, /9/)
})

// restart_required 缺省也要按「需要重启」处理，不能因为字段缺失就少提示一句。
test('lastUpdateNotice 缺少 restart_required 时默认需要重启', () => {
  const notice = lastUpdateNotice({ file_name: 'a.zip', error: '' })
  assert.equal(notice.restartNeeded, true)
  assert.equal(notice.fileCount, 0)
  assert.equal(notice.timeText, '')
})
