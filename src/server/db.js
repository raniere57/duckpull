import { Database } from 'bun:sqlite'
import { randomBytes } from 'crypto'
import { dbPath, defaultDestinationDir, ensureDir } from './config.js'

const db = new Database(dbPath)
const DEFAULT_UI_PASSWORD = '@trunks.'

function nowIso() {
  return new Date().toISOString()
}

function boolToInt(value) {
  return value ? 1 : 0
}

function intToBool(value) {
  return Number(value) === 1
}

export function initDb() {
  ensureDir(defaultDestinationDir)

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS remote_sources (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT NOT NULL DEFAULT 'default',
      base_url TEXT NOT NULL DEFAULT '',
      auth_token TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      remote_source_id INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL,
      filename TEXT NOT NULL,
      type TEXT NOT NULL,
      size_bytes INTEGER,
      sha256 TEXT,
      etag TEXT,
      updated_at_remote TEXT,
      download_url TEXT NOT NULL,
      selected INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      FOREIGN KEY (remote_source_id) REFERENCES remote_sources (id)
    );

    CREATE TABLE IF NOT EXISTS artifact_sync_state (
      artifact_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'never_synced',
      local_path TEXT,
      last_synced_at TEXT,
      last_checked_at TEXT,
      local_size_bytes INTEGER,
      last_error TEXT,
      remote_sha256 TEXT,
      remote_etag TEXT,
      remote_updated_at TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (artifact_id) REFERENCES artifacts (id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sync_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      artifact_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (artifact_id) REFERENCES artifacts (id) ON DELETE SET NULL
    );
  `)

  const stateColumns = db.prepare(`PRAGMA table_info('artifact_sync_state')`).all()
  if (!stateColumns.some((column) => column.name === 'remote_updated_at')) {
    try {
      db.exec(`ALTER TABLE artifact_sync_state ADD COLUMN remote_updated_at TEXT`)
    } catch (error) {
      if (!String(error.message || '').includes('duplicate column name')) {
        throw error
      }
    }
  }

  const timestamp = nowIso()
  db.prepare(`
    INSERT INTO remote_sources (id, name, base_url, auth_token, enabled, created_at, updated_at)
    VALUES (1, 'default', '', '', 1, ?, ?)
    ON CONFLICT(id) DO NOTHING
  `).run(timestamp, timestamp)

  const defaults = [
    ['destination_dir', defaultDestinationDir],
    ['sync_interval_minutes', '15'],
    ['auto_sync_enabled', '1']
  ]

  for (const [key, value] of defaults) {
    db.prepare(`
      INSERT INTO app_config (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO NOTHING
      `).run(key, value, timestamp)
  }

  const passwordHash = getAppConfigValue('ui_password_hash')
  if (!passwordHash) {
    setAppConfigValue('ui_password_hash', Bun.password.hashSync(DEFAULT_UI_PASSWORD), timestamp)
  }

  const sessionSecret = getAppConfigValue('session_secret')
  if (!sessionSecret) {
    setAppConfigValue('session_secret', randomBytes(32).toString('hex'), timestamp)
  }
}

export function getAppConfigValue(key) {
  return db.prepare(`
    SELECT value
    FROM app_config
    WHERE key = ?
  `).get(key)?.value ?? null
}

export function setAppConfigValue(key, value, updatedAt = nowIso()) {
  db.prepare(`
    INSERT INTO app_config (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run(key, value, updatedAt)
}

export function getSettings() {
  const source = db.prepare(`
    SELECT base_url, auth_token
    FROM remote_sources
    WHERE id = 1
  `).get()

  const configRows = db.prepare(`
    SELECT key, value
    FROM app_config
  `).all()

  const config = Object.fromEntries(configRows.map((row) => [row.key, row.value]))

  return {
    apiBaseUrl: source?.base_url || '',
    authToken: source?.auth_token || '',
    destinationDir: config.destination_dir || defaultDestinationDir,
    syncIntervalMinutes: Number(config.sync_interval_minutes || 15),
    autoSyncEnabled: intToBool(config.auto_sync_enabled || 1)
  }
}

export function saveSettings(settings) {
  const timestamp = nowIso()
  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE remote_sources
      SET base_url = ?, auth_token = ?, updated_at = ?
      WHERE id = 1
    `).run(
      String(settings.apiBaseUrl || '').trim(),
      String(settings.authToken || '').trim(),
      timestamp
    )

    const configPairs = [
      ['destination_dir', String(settings.destinationDir || defaultDestinationDir).trim()],
      ['sync_interval_minutes', String(settings.syncIntervalMinutes || 15)],
      ['auto_sync_enabled', boolToInt(settings.autoSyncEnabled)]
    ]

    for (const [key, value] of configPairs) {
      db.prepare(`
        INSERT INTO app_config (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `).run(key, String(value), timestamp)
    }
  })

  tx()
  return getSettings()
}

export function addLog(level, message, artifactId = null) {
  db.prepare(`
    INSERT INTO sync_logs (level, message, artifact_id, created_at)
    VALUES (?, ?, ?, ?)
  `).run(level, message, artifactId, nowIso())
}

export function listLogs(limit = 200) {
  return db.prepare(`
    SELECT id, level, message, artifact_id AS artifactId, created_at AS createdAt
    FROM sync_logs
    ORDER BY id DESC
    LIMIT ?
  `).all(limit)
}

export function upsertRemoteArtifacts(artifacts) {
  const timestamp = nowIso()
  const stmt = db.prepare(`
    INSERT INTO artifacts (
      id, remote_source_id, name, filename, type, size_bytes, sha256, etag,
      updated_at_remote, download_url, selected, created_at, updated_at, last_seen_at
    )
    VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      filename = excluded.filename,
      type = excluded.type,
      size_bytes = excluded.size_bytes,
      sha256 = excluded.sha256,
      etag = excluded.etag,
      updated_at_remote = excluded.updated_at_remote,
      download_url = excluded.download_url,
      updated_at = excluded.updated_at,
      last_seen_at = excluded.last_seen_at
  `)

  const tx = db.transaction((items) => {
    for (const artifact of items) {
      stmt.run(
        artifact.id,
        artifact.name,
        artifact.filename,
        artifact.type,
        artifact.sizeBytes ?? null,
        artifact.sha256 ?? null,
        artifact.etag ?? null,
        artifact.updatedAt ?? null,
        artifact.downloadUrl,
        boolToInt(artifact.selected),
        timestamp,
        timestamp,
        timestamp
      )
    }
  })

  tx(artifacts)
}

export function updateArtifactSelection(artifactId, selected) {
  db.prepare(`
    UPDATE artifacts
    SET selected = ?, updated_at = ?
    WHERE id = ?
  `).run(boolToInt(selected), nowIso(), artifactId)
}

export function getArtifact(artifactId) {
  return db.prepare(`
    SELECT
      a.id,
      a.name,
      a.filename,
      a.type,
      a.size_bytes AS sizeBytes,
      a.sha256,
      a.etag,
      a.updated_at_remote AS updatedAt,
      a.download_url AS downloadUrl,
      a.selected AS selected
    FROM artifacts a
    WHERE a.id = ?
  `).get(artifactId)
}

export function listArtifacts() {
  return db.prepare(`
    SELECT
      a.id,
      a.name,
      a.filename,
      a.type,
      a.size_bytes AS sizeBytes,
      a.sha256,
      a.etag,
      a.updated_at_remote AS updatedAt,
      a.download_url AS downloadUrl,
      a.selected AS selected,
      COALESCE(s.status, 'never_synced') AS status,
      s.local_path AS localPath,
      s.last_synced_at AS lastSyncedAt,
      s.last_checked_at AS lastCheckedAt,
      s.local_size_bytes AS localSizeBytes,
      s.last_error AS lastError
    FROM artifacts a
    LEFT JOIN artifact_sync_state s ON s.artifact_id = a.id
    ORDER BY a.type ASC, a.name ASC
  `).all().map((row) => ({
    ...row,
    selected: intToBool(row.selected)
  }))
}

export function getArtifactsForSync(artifactIds = null) {
  if (artifactIds?.length) {
    const placeholders = artifactIds.map(() => '?').join(', ')
    return db.prepare(`
      SELECT
        a.id,
        a.name,
        a.filename,
        a.type,
        a.size_bytes AS sizeBytes,
        a.sha256,
        a.etag,
        a.updated_at_remote AS updatedAt,
        a.download_url AS downloadUrl
      FROM artifacts a
      WHERE a.id IN (${placeholders})
      ORDER BY a.name ASC
    `).all(...artifactIds)
  }

  return db.prepare(`
    SELECT
      a.id,
      a.name,
      a.filename,
      a.type,
      a.size_bytes AS sizeBytes,
      a.sha256,
      a.etag,
      a.updated_at_remote AS updatedAt,
      a.download_url AS downloadUrl
    FROM artifacts a
    WHERE a.selected = 1
    ORDER BY a.name ASC
  `).all()
}

export function getArtifactSyncState(artifactId) {
  return db.prepare(`
    SELECT
      artifact_id AS artifactId,
      status,
      local_path AS localPath,
      last_synced_at AS lastSyncedAt,
      last_checked_at AS lastCheckedAt,
      local_size_bytes AS localSizeBytes,
      last_error AS lastError,
      remote_sha256 AS remoteSha256,
      remote_etag AS remoteEtag,
      remote_updated_at AS remoteUpdatedAt
    FROM artifact_sync_state
    WHERE artifact_id = ?
  `).get(artifactId)
}

export function upsertArtifactSyncState(artifactId, fields) {
  const payload = {
    status: fields.status ?? 'never_synced',
    local_path: fields.localPath ?? null,
    last_synced_at: fields.lastSyncedAt ?? null,
    last_checked_at: fields.lastCheckedAt ?? null,
    local_size_bytes: fields.localSizeBytes ?? null,
    last_error: fields.lastError ?? null,
    remote_sha256: fields.remoteSha256 ?? null,
    remote_etag: fields.remoteEtag ?? null,
    remote_updated_at: fields.remoteUpdatedAt ?? null,
    updated_at: nowIso()
  }

  db.prepare(`
    INSERT INTO artifact_sync_state (
      artifact_id, status, local_path, last_synced_at, last_checked_at,
      local_size_bytes, last_error, remote_sha256, remote_etag, remote_updated_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(artifact_id) DO UPDATE SET
      status = excluded.status,
      local_path = excluded.local_path,
      last_synced_at = excluded.last_synced_at,
      last_checked_at = excluded.last_checked_at,
      local_size_bytes = excluded.local_size_bytes,
      last_error = excluded.last_error,
      remote_sha256 = excluded.remote_sha256,
      remote_etag = excluded.remote_etag,
      remote_updated_at = excluded.remote_updated_at,
      updated_at = excluded.updated_at
  `).run(
    artifactId,
    payload.status,
    payload.local_path,
    payload.last_synced_at,
    payload.last_checked_at,
    payload.local_size_bytes,
    payload.last_error,
    payload.remote_sha256,
    payload.remote_etag,
    payload.remote_updated_at,
    payload.updated_at
  )
}
