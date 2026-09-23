import assert from 'node:assert/strict'
import test from 'node:test'
import { register } from 'node:module'

// src/ 里用 `@/...` 绝对导入，node 需要这个钩子才能解析（见 aliasLoader.mjs）。
register('./aliasLoader.mjs', import.meta.url)

const {
  backupLocationCandidates,
  backupLocationFromOverview,
  formatBackupSize,
  formatBackupTime,
  lastRestoreNotice,
  pendingRestoreText,
  summarizeRestoreContents,
} = await import('../src/utils/backup.js')

const { zh } = await import('../src/utils/i18n.js')

test('formatBackupSize 输出人类可读体积', () => {
  assert.equal(formatBackupSize(512), '512 B')
  assert.equal(formatBackupSize(0), '0 B')
  assert.equal(formatBackupSize(1024), '1.0 KB')
  assert.equal(formatBackupSize(998877), '975 KB')
  assert.equal(formatBackupSize(1234567), '1.2 MB')
  assert.equal(formatBackupSize(12.3 * 1024 * 1024), '12 MB')
  assert.equal(formatBackupSize(1024 ** 3), '1.0 GB')
})

test('formatBackupSize 对非法输入返回空字符串', () => {
  for (const value of [null, undefined, '', -1, 'abc', NaN]) {
    assert.equal(formatBackupSize(value), '')
  }
})

test('formatBackupTime 输出本地时间，非法输入返回空字符串', () => {
  // 先按本地时间构造再转 ISO，避免测试结果随运行机器的时区漂移。
  const local = new Date(2026, 8, 23, 20, 15)
  assert.equal(formatBackupTime(local.toISOString()), '2026-09-23 20:15')
  for (const value of ['', null, undefined, 'not-a-date']) {
    assert.equal(formatBackupTime(value), '')
  }
})

test('summarizeRestoreContents 组合文件数与体积', () => {
  assert.equal(
    summarizeRestoreContents({ fileCount: 137, totalSize: 998877 }),
    `${zh('137 个文件', '137 files')} · 975 KB`
  )
  assert.equal(summarizeRestoreContents({ fileCount: 5 }), zh('5 个文件', '5 files'))
  assert.equal(summarizeRestoreContents({ fileCount: 0, totalSize: 1024 }), '1.0 KB')
  assert.equal(summarizeRestoreContents({}), '')
  assert.equal(summarizeRestoreContents(), '')
})

test('pendingRestoreText 组装文件名 / 内容 / 暂存时间', () => {
  const staged = new Date(2026, 8, 23, 20, 20)
  const text = pendingRestoreText({
    file_name: 'javboss-backup-20260923-201500.zip',
    staged_at: staged.toISOString(),
    file_count: 137,
    total_size: 998877,
  })
  assert.ok(text.startsWith('javboss-backup-20260923-201500.zip'))
  assert.ok(text.includes(zh('137 个文件', '137 files')))
  assert.ok(text.includes('975 KB'))
  assert.ok(text.includes('20:20'))

  assert.equal(pendingRestoreText(null), '')
  assert.equal(pendingRestoreText(undefined), '')
})

test('lastRestoreNotice：失败时用错误文案且不列目录', () => {
  const notice = lastRestoreNotice({
    file_name: 'a.zip',
    file_count: 3,
    error: 'zip: not a valid zip file',
    missing_directories: [],
  })
  assert.equal(notice.tone, 'error')
  assert.deepEqual(notice.missing, [])
  assert.ok(notice.title.includes('zip: not a valid zip file'))

  // 失败时不关心缺目录：后端也不会返回。
  const withMissing = lastRestoreNotice({ error: 'boom', missing_directories: ['D:\\videos'] })
  assert.equal(withMissing.tone, 'error')
  assert.deepEqual(withMissing.missing, [])
})

test('lastRestoreNotice：缺目录时列出路径并给出提示', () => {
  const notice = lastRestoreNotice({
    file_name: 'a.zip',
    file_count: 137,
    error: '',
    missing_directories: ['D:\\videos', 'E:\\movies'],
  })
  assert.equal(notice.tone, 'warn')
  assert.deepEqual(notice.missing, ['D:\\videos', 'E:\\movies'])
})

test('lastRestoreNotice：正常完成时是 ok', () => {
  const notice = lastRestoreNotice({
    file_name: 'javboss-backup-20260923-201500.zip',
    file_count: 137,
    error: '',
    missing_directories: [],
  })
  assert.equal(notice.tone, 'ok')
  assert.deepEqual(notice.missing, [])
  assert.ok(notice.title.includes('javboss-backup-20260923-201500.zip'))
  assert.ok(notice.title.includes('137'))

  // missing_directories 缺失（null）也要当成正常完成。
  assert.equal(lastRestoreNotice({ file_name: 'a.zip', file_count: 1 }).tone, 'ok')
})

test('lastRestoreNotice：没有 last_restore 时返回 null', () => {
  assert.equal(lastRestoreNotice(null), null)
  assert.equal(lastRestoreNotice(undefined), null)
})

test('backupLocationFromOverview：区分本机目录与 WebDAV 远程目录', () => {
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

test('backupLocationCandidates：把扫描目录整理成备份位置候选', () => {
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
    [{ id: 5, name: '坚果云' }]
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

test('backupLocationCandidates：容忍缺失的目录与连接列表', () => {
  assert.deepEqual(backupLocationCandidates(null, null), [])
  assert.deepEqual(backupLocationCandidates(undefined), [])
})
