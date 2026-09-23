import assert from 'node:assert/strict'
import test from 'node:test'
import { register } from 'node:module'

// src/ 里用 `@/...` 绝对导入，node 需要这个钩子才能解析（见 aliasLoader.mjs）。
register('./aliasLoader.mjs', import.meta.url)

const {
  backupLocationCandidates,
  backupLocationFromOverview,
  buildBackupSettingsPayload,
  describeBackupFile,
  formatBackupSize,
  formatBackupTime,
  lastRestoreNotice,
  pendingRestoreNotice,
} = await import('../src/utils/backup.js')

// 文案跟随系统语言，断言同时接受中英文。
const ZH_OR_EN = {
  restart: /重启|Restart/,
  stage: /暂存|Staged/,
  fail: /失败|failed/,
  finished: /已完成|finished/,
  applied: /已应用|was applied/,
  missing: /这些视频目录在本机不存在|do not exist on this machine/,
}

test('formatBackupSize 把字节格式化成人类可读体积', () => {
  assert.equal(formatBackupSize(0), '0 B')
  assert.equal(formatBackupSize(512), '512 B')
  assert.equal(formatBackupSize(1024), '1.0 KB')
  assert.equal(formatBackupSize(1536), '1.5 KB')
  assert.equal(formatBackupSize(1234567), '1.2 MB')
  assert.equal(formatBackupSize(12900000), '12.3 MB')
  assert.equal(formatBackupSize(1024 ** 3 * 3), '3.0 GB')
  assert.equal(formatBackupSize(1024 ** 4 * 2.5), '2.5 TB')
})

test('formatBackupSize 对缺失或非法体积返回占位符', () => {
  for (const value of [undefined, null, '', 'abc', NaN, -1]) {
    assert.equal(formatBackupSize(value), '—', String(value))
  }
})

test('formatBackupTime 本地化时间戳，缺失或非法时为空', () => {
  assert.equal(formatBackupTime(''), '')
  assert.equal(formatBackupTime(null), '')
  assert.equal(formatBackupTime(undefined), '')
  assert.equal(formatBackupTime('not-a-date'), '')
  assert.match(formatBackupTime('2026-09-23T20:15:00+08:00'), /2026/)
})

test('describeBackupFile 组装列表项的文件名、时间与体积', () => {
  const described = describeBackupFile({
    name: 'javboss-backup-20260923-201500.zip',
    size: 12900000,
    modified_at: '2026-09-23T20:15:00+08:00',
  })
  assert.equal(described.name, 'javboss-backup-20260923-201500.zip')
  assert.equal(described.sizeText, '12.3 MB')
  assert.match(described.timeText, /2026/)
  assert.equal(described.metaText, `${described.timeText} · 12.3 MB`)
})

test('describeBackupFile 对缺失字段保持稳定', () => {
  assert.deepEqual(describeBackupFile(null), {
    name: '',
    timeText: '',
    sizeText: '—',
    metaText: '—',
  })
})

test('buildBackupSettingsPayload 留空的密码表示不修改', () => {
  assert.deepEqual(
    buildBackupSettingsPayload({ backupPath: 'D:\\javboss-backups', password: '' }),
    { backup_path: 'D:\\javboss-backups' }
  )
  assert.deepEqual(buildBackupSettingsPayload({ backupPath: '/mnt/backups' }), {
    backup_path: '/mnt/backups',
  })
  assert.deepEqual(buildBackupSettingsPayload({}), {})
})

test('buildBackupSettingsPayload 只在有内容时带上路径与密码', () => {
  assert.deepEqual(
    buildBackupSettingsPayload({ backupPath: '  /mnt/backups  ', password: 'secret' }),
    { backup_path: '/mnt/backups', password: 'secret' }
  )
  assert.deepEqual(buildBackupSettingsPayload({ password: 12345 }), { password: '12345' })
})

// 清空输入框后保存必须真的把路径取消掉，否则会变成静默无效的操作。
test('buildBackupSettingsPayload 用空路径表达取消备份路径', () => {
  assert.deepEqual(buildBackupSettingsPayload({ backupPath: '   ' }), { backup_path: '' })
  assert.deepEqual(buildBackupSettingsPayload({ backupPath: '', password: ' secret ' }), {
    backup_path: '',
    password: ' secret ',
  })
})

test('buildBackupSettingsPayload 用 clear_password 表达清空密码', () => {
  assert.deepEqual(
    buildBackupSettingsPayload({
      backupPath: '/mnt/backups',
      password: 'ignored',
      clearPassword: true,
    }),
    { backup_path: '/mnt/backups', clear_password: true }
  )
  assert.deepEqual(buildBackupSettingsPayload({ clearPassword: true }), { clear_password: true })
  assert.deepEqual(buildBackupSettingsPayload({ clearPassword: false, password: '' }), {})
})

// 从远程切回本机时必须显式下发 0，否则后端会把本机路径当成远程路径。
test('buildBackupSettingsPayload 显式区分本地与 WebDAV 位置', () => {
  assert.deepEqual(buildBackupSettingsPayload({ backupPath: '/JAV/HD', connectionId: 7 }), {
    backup_path: '/JAV/HD',
    connection_id: 7,
  })
  assert.deepEqual(buildBackupSettingsPayload({ backupPath: 'D:\\backups', connectionId: 0 }), {
    backup_path: 'D:\\backups',
    connection_id: 0,
  })
  // 空字符串 / 非法值都按「本机目录」处理。
  assert.deepEqual(buildBackupSettingsPayload({ backupPath: '/x', connectionId: '' }), {
    backup_path: '/x',
    connection_id: 0,
  })
  assert.deepEqual(buildBackupSettingsPayload({ backupPath: '/x', connectionId: 'abc' }), {
    backup_path: '/x',
    connection_id: 0,
  })
  // 不传 connectionId 表示「保持当前选择」，不能凭空塞一个 0 进去。
  assert.equal('connection_id' in buildBackupSettingsPayload({ backupPath: '/x' }), false)
})

test('backupLocationFromOverview 区分本机目录与 WebDAV 远程目录', () => {
  assert.deepEqual(backupLocationFromOverview(null), { kind: 'local', connectionId: '', path: '' })
  assert.deepEqual(
    backupLocationFromOverview({ backup_path: 'D:\\backups', backup_connection_id: null }),
    { kind: 'local', connectionId: '', path: 'D:\\backups' }
  )
  assert.deepEqual(
    backupLocationFromOverview({ backup_path: '/JAV/HD', backup_connection_id: 3 }),
    { kind: 'webdav', connectionId: '3', path: '/JAV/HD' }
  )
})

test('backupLocationCandidates 把扫描目录整理成备份位置候选', () => {
  const connections = [{ id: 5, name: '坚果云' }]
  const candidates = backupLocationCandidates(
    [
      { id: 1, kind: '', path: 'D:\\videos' },
      { id: 2, kind: 'webdav', connection_id: 5, remote_path: 'JAV/HD' },
      { id: 3, kind: 'webdav', connection_id: 9, remote_path: '/JAV' },
      { id: 4, kind: 'webdav', connection_id: 5, remote_path: '' },
      { id: 5, kind: '', path: 'D:\\videos' },
      { id: 6, kind: '', path: 'E:\\gone', is_delete: true },
      { id: 7, kind: '', path: '   ' },
    ],
    connections
  )
  assert.deepEqual(
    candidates.map((option) => [option.kind, option.connectionId, option.path, option.label]),
    [
      ['local', '', 'D:\\videos', 'D:\\videos'],
      ['webdav', '5', '/JAV/HD', '坚果云'],
      // 连接名缺失时退回 WebDAV #<id>，绝不能显示成空字符串。
      ['webdav', '9', '/JAV', 'WebDAV #9'],
    ]
  )
  assert.equal(candidates[1].detail, '/JAV/HD')
  assert.equal(candidates[0].detail, '')
})

test('backupLocationCandidates 容忍缺失的目录与连接列表', () => {
  assert.deepEqual(backupLocationCandidates(null, null), [])
  assert.deepEqual(backupLocationCandidates(undefined), [])
})

test('pendingRestoreNotice 提示暂存结果并强调重启后生效', () => {
  assert.equal(pendingRestoreNotice(null), null)
  assert.equal(pendingRestoreNotice({}), null)

  const notice = pendingRestoreNotice({
    file_name: 'javboss-backup-20260923-201500.zip',
    staged_at: '2026-09-23T20:20:00+08:00',
    file_count: 137,
    total_size: 998877,
  })
  assert.equal(notice.fileName, 'javboss-backup-20260923-201500.zip')
  assert.equal(notice.fileCount, 137)
  assert.equal(notice.sizeText, '975.5 KB')
  assert.match(notice.title, ZH_OR_EN.restart)
  assert.match(notice.detail, ZH_OR_EN.restart)
  assert.match(notice.detail, ZH_OR_EN.stage)
  assert.match(notice.detail, /137/)
})

test('pendingRestoreNotice 容忍缺失的时间与体积', () => {
  const notice = pendingRestoreNotice({ file_name: 'a.zip' })
  assert.equal(notice.timeText, '')
  assert.equal(notice.sizeText, '—')
  assert.equal(notice.fileCount, 0)
})

test('lastRestoreNotice 没有恢复结果时返回 null', () => {
  assert.equal(lastRestoreNotice(null), null)
  assert.equal(lastRestoreNotice(undefined), null)
  assert.equal(lastRestoreNotice({ file_name: '  ' }), null)
})

test('lastRestoreNotice 优先报告恢复失败的原因', () => {
  const notice = lastRestoreNotice({
    file_name: 'javboss-backup-20260923-201500.zip',
    applied_at: '2026-09-23T21:00:00+08:00',
    file_count: 0,
    error: 'copy data: access denied',
    missing_directories: ['D:\\videos'],
  })
  assert.equal(notice.failed, true)
  assert.match(notice.title, ZH_OR_EN.fail)
  assert.match(notice.detail, /copy data: access denied/)
  assert.deepEqual(notice.missingDirectories, [])
  assert.equal(notice.missingNote, '')
})

test('lastRestoreNotice 列出本机缺失的视频目录', () => {
  const notice = lastRestoreNotice({
    file_name: 'javboss-backup-20260923-201500.zip',
    applied_at: '2026-09-23T21:00:00+08:00',
    file_count: 137,
    error: '',
    missing_directories: ['D:\\videos', ' /mnt/disk2 ', ''],
  })
  assert.equal(notice.failed, false)
  assert.match(notice.title, ZH_OR_EN.finished)
  assert.match(notice.detail, ZH_OR_EN.applied)
  assert.deepEqual(notice.missingDirectories, ['D:\\videos', '/mnt/disk2'])
  assert.match(notice.missingNote, ZH_OR_EN.missing)
  assert.match(notice.missingNote, /不会改写路径|did not rewrite paths/)
})

test('lastRestoreNotice 没有缺失目录时不给额外说明', () => {
  const notice = lastRestoreNotice({
    file_name: 'a.zip',
    error: '',
    missing_directories: null,
  })
  assert.deepEqual(notice.missingDirectories, [])
  assert.equal(notice.missingNote, '')
})
