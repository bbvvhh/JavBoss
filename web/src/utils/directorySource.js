const SOURCE_LOCAL = 'local'
const SOURCE_WEBDAV = 'webdav'

// This module deliberately has no imports: `src/**` must use `@/` alias imports
// (see .eslintrc.cjs), but node:test cannot resolve that alias. Keeping the
// module dependency-free lets web/tests/directorySource.test.js import it
// directly, and the caller supplies the localized backstop messages.
const DEFAULT_MESSAGES = {
  connection: 'Choose a WebDAV connection',
  remotePath: 'Remote directory path cannot be empty',
}

// Older directory rows have no `kind` value; they are all local folders.
export function directorySourceKind(dir) {
  return String(dir?.kind || '')
    .trim()
    .toLowerCase() === SOURCE_WEBDAV
    ? SOURCE_WEBDAV
    : SOURCE_LOCAL
}

export function normalizeRemotePath(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  return raw.startsWith('/') ? raw : `/${raw}`
}

// Builds the payload for createDirectory/updateDirectory. Local folders keep the
// existing `{ path }` shape, WebDAV folders send the connection and remote path.
// `messages` overrides the fallback error text so the UI can stay localized;
// callers validate first, so these are only backstops.
export function buildDirectoryPayload(
  { kind, path, remotePath, connectionId } = {},
  messages = DEFAULT_MESSAGES
) {
  if (
    String(kind || '')
      .trim()
      .toLowerCase() === SOURCE_WEBDAV
  ) {
    const id = Number(connectionId)
    if (!Number.isFinite(id) || id <= 0) {
      throw new Error(messages?.connection || DEFAULT_MESSAGES.connection)
    }
    const normalizedRemotePath = normalizeRemotePath(remotePath)
    if (!normalizedRemotePath) {
      throw new Error(messages?.remotePath || DEFAULT_MESSAGES.remotePath)
    }
    return { kind: SOURCE_WEBDAV, connection_id: id, remote_path: normalizedRemotePath }
  }
  return { path }
}

// Display helper: WebDAV rows must never show the synthetic `webdav://<id>/x`
// identity path, so they render the connection name plus the remote path.
export function describeDirectorySource(dir, connections = []) {
  if (directorySourceKind(dir) !== SOURCE_WEBDAV) {
    return { isRemote: false, label: null, detail: String(dir?.path || '') }
  }
  const connectionId = Number(dir?.connection_id)
  const list = Array.isArray(connections) ? connections : []
  const connection = list.find((item) => Number(item?.id) === connectionId)
  const name = String(connection?.name || '').trim()
  return {
    isRemote: true,
    label:
      name ||
      (Number.isFinite(connectionId) && connectionId > 0 ? `WebDAV #${connectionId}` : 'WebDAV'),
    detail: normalizeRemotePath(dir?.remote_path),
  }
}

// Fields for POST /videos/play and /videos/open.
//
// A location id is authoritative on the server, and a WebDAV directory exposes
// the synthetic "webdav://<connectionId><remotePath>" identity as its path -
// which is not a filesystem path, so sending it as dir_path made every remote
// playback fail validation. When a usable location id exists we therefore send
// only that; the legacy path/dir_path pair is kept for local videos without one.
export function mediaRequestFields({ id, locationId, path, dirPath } = {}) {
  const videoId = Number(id) || 0
  const resolvedLocationId = Number(locationId)
  if (Number.isFinite(resolvedLocationId) && resolvedLocationId > 0) {
    return { id: videoId, locationId: resolvedLocationId }
  }
  return { id: videoId, path, dirPath }
}

// True when the value is a remote directory identity rather than a real path.
// Used to keep such values out of local-path request fields.
export function isRemoteIdentity(value) {
  return /^webdav:\/\//i.test(String(value ?? '').trim())
}
