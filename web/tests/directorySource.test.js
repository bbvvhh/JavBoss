import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildDirectoryPayload,
  describeDirectorySource,
  directorySourceKind,
  isRemoteIdentity,
  mediaRequestFields,
  normalizeRemotePath,
} from '../src/utils/directorySource.js'

test('directory kind treats missing or unknown values as local', () => {
  for (const value of [undefined, null, '', 'local', 'LOCAL', 'ftp']) {
    assert.equal(directorySourceKind({ kind: value }), 'local', String(value))
  }
  assert.equal(directorySourceKind({}), 'local')
  assert.equal(directorySourceKind(null), 'local')
  for (const value of ['webdav', 'WebDAV', ' WEBDAV ']) {
    assert.equal(directorySourceKind({ kind: value }), 'webdav', value)
  }
})

test('remote paths are trimmed and always start with a slash', () => {
  assert.equal(normalizeRemotePath('  /JAV/HD  '), '/JAV/HD')
  assert.equal(normalizeRemotePath('JAV/HD'), '/JAV/HD')
  assert.equal(normalizeRemotePath('  '), '')
  assert.equal(normalizeRemotePath(undefined), '')
})

test('webdav payload sends the numeric connection id and the normalized remote path', () => {
  assert.deepEqual(
    buildDirectoryPayload({ kind: 'webdav', connectionId: '3', remotePath: ' JAV/HD ' }),
    { kind: 'webdav', connection_id: 3, remote_path: '/JAV/HD' }
  )
  assert.deepEqual(buildDirectoryPayload({ kind: 'webdav', connectionId: 7, remotePath: '/a/b' }), {
    kind: 'webdav',
    connection_id: 7,
    remote_path: '/a/b',
  })
  assert.deepEqual(buildDirectoryPayload({ kind: 'WebDAV', connectionId: 1, remotePath: '/' }), {
    kind: 'webdav',
    connection_id: 1,
    remote_path: '/',
  })
})

test('webdav payload rejects a missing connection or an empty remote path', () => {
  for (const connectionId of [undefined, null, '', 0, -1, 'abc']) {
    assert.throws(
      () => buildDirectoryPayload({ kind: 'webdav', connectionId, remotePath: '/JAV' }),
      (error) => error instanceof Error && /WebDAV/.test(error.message),
      `connectionId=${String(connectionId)}`
    )
  }
  for (const remotePath of [undefined, '', '   ']) {
    assert.throws(
      () => buildDirectoryPayload({ kind: 'webdav', connectionId: 2, remotePath }),
      (error) => error instanceof Error && /远程|Remote/.test(error.message),
      `remotePath=${String(remotePath)}`
    )
  }
})

test('callers can supply localized validation messages', () => {
  const messages = {
    connection: '请选择 WebDAV 连接',
    remotePath: '远程目录路径不能为空',
  }
  assert.throws(
    () => buildDirectoryPayload({ kind: 'webdav', remotePath: '/JAV' }, messages),
    (error) => error.message === '请选择 WebDAV 连接'
  )
  assert.throws(
    () => buildDirectoryPayload({ kind: 'webdav', connectionId: 1, remotePath: '' }, messages),
    (error) => error.message === '远程目录路径不能为空'
  )
  // A partial override keeps the built-in fallback for the other field.
  assert.throws(
    () => buildDirectoryPayload({ kind: 'webdav', connectionId: 1, remotePath: '' }, {}),
    (error) => /Remote directory path/.test(error.message)
  )
})

test('local payload keeps the existing path-only shape', () => {
  assert.deepEqual(buildDirectoryPayload({ kind: 'local', path: '/mnt/videos' }), {
    path: '/mnt/videos',
  })
  assert.deepEqual(buildDirectoryPayload({ path: 'C:\\Videos' }), { path: 'C:\\Videos' })
  // WebDAV-only fields must not leak into a local payload.
  assert.deepEqual(
    buildDirectoryPayload({ path: '/mnt/videos', connectionId: 5, remotePath: '/JAV' }),
    { path: '/mnt/videos' }
  )
})

test('local sources describe the local path without a badge label', () => {
  assert.deepEqual(describeDirectorySource({ kind: 'local', path: '/mnt/videos' }, []), {
    isRemote: false,
    label: null,
    detail: '/mnt/videos',
  })
  assert.deepEqual(describeDirectorySource({ path: '/mnt/movies' }), {
    isRemote: false,
    label: null,
    detail: '/mnt/movies',
  })
})

test('remote sources describe the connection name plus the remote path', () => {
  const remote = {
    kind: 'webdav',
    connection_id: 4,
    remote_path: '/JAV/HD',
    path: 'webdav://4/JAV/HD',
  }
  const described = describeDirectorySource(remote, [
    { id: 4, name: ' seedbox ' },
    { id: 9, name: 'other' },
  ])
  assert.equal(described.isRemote, true)
  assert.equal(described.label, 'seedbox')
  assert.equal(described.detail, '/JAV/HD')
  assert.equal(described.label.includes('webdav://'), false)
  assert.equal(described.detail.includes('webdav://'), false)
})

test('remote sources fall back to a connection id label when the connection is unknown', () => {
  const described = describeDirectorySource(
    { kind: 'webdav', connection_id: 12, remote_path: 'JAV' },
    [{ id: 1, name: 'other' }]
  )
  assert.equal(described.isRemote, true)
  assert.equal(described.label, 'WebDAV #12')
  assert.equal(described.detail, '/JAV')
  assert.equal(describeDirectorySource({ kind: 'webdav' }, null).label, 'WebDAV')
})

// Regression: a WebDAV directory's path is the synthetic identity
// "webdav://<connectionId><remotePath>". Sending it as dir_path made the server
// reject every remote playback with an invalid-path error.
test('media request fields send only the location id when one is available', () => {
  const fields = mediaRequestFields({
    id: 567,
    locationId: 580,
    path: '水/.L3.mp4',
    dirPath: 'webdav://1/7788/R',
  })
  assert.deepEqual(fields, { id: 567, locationId: 580 })
  assert.equal(Object.hasOwn(fields, 'path'), false)
  assert.equal(Object.hasOwn(fields, 'dirPath'), false)
})

test('media request fields keep the legacy path pair when there is no location id', () => {
  assert.deepEqual(mediaRequestFields({ id: 5, path: 'a/movie.mp4', dirPath: '/mnt/videos' }), {
    id: 5,
    path: 'a/movie.mp4',
    dirPath: '/mnt/videos',
  })
  for (const locationId of [undefined, null, 0, -1, '', 'abc']) {
    const fields = mediaRequestFields({
      id: 5,
      locationId,
      path: 'a/movie.mp4',
      dirPath: '/mnt/videos',
    })
    assert.equal(fields.dirPath, '/mnt/videos', `locationId=${String(locationId)}`)
  }
})

test('remote identities are recognised so they never reach local path fields', () => {
  assert.equal(isRemoteIdentity('webdav://1/7788/R'), true)
  assert.equal(isRemoteIdentity('  WebDAV://9/a  '), true)
  assert.equal(isRemoteIdentity('/mnt/videos'), false)
  assert.equal(isRemoteIdentity('D:\\Videos'), false)
  assert.equal(isRemoteIdentity(undefined), false)
})
