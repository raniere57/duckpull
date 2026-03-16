import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { mkdir, readdir, rename, rm, stat } from 'fs/promises'
import { join } from 'path'
import { addLog, getArtifactSyncState, getArtifactsForSync, getSettings, listArtifacts, listInProgressArtifactStates, listLogs, upsertArtifactSyncState, upsertRemoteArtifacts } from './db.js'
import { downloadArtifact, fetchArtifactMeta, fetchRemoteArtifacts } from './remote-api.js'

const runtimeState = {
  running: false,
  queued: false,
  currentArtifactId: null,
  reason: null,
  startedAt: null,
  finishedAt: null,
  lastSummary: null
}

let intervalHandle = null
let queuedSyncRequest = null
const RETRY_COUNT = Math.max(1, Number(process.env.DUCKPULL_RETRY_COUNT || 3))
const RETRY_BACKOFF_MS = Math.max(250, Number(process.env.DUCKPULL_RETRY_BACKOFF_MS || 2000))
const ARTIFACT_SYNC_TIMEOUT_MS = Math.max(
  60 * 1000,
  Number(process.env.DUCKPULL_ARTIFACT_SYNC_TIMEOUT_MS || 30 * 60 * 1000)
)

function nowIso() {
  return new Date().toISOString()
}

function validateSettings(settings) {
  if (!settings.apiBaseUrl) {
    throw new Error('API base URL não configurada.')
  }
  if (!settings.authToken) {
    throw new Error('Token Bearer não configurado.')
  }
  if (!settings.destinationDir) {
    throw new Error('Pasta de destino não configurada.')
  }
}

function resolveSettings(override = null) {
  const persisted = getSettings()
  const merged = {
    ...persisted,
    ...(override || {})
  }
  validateSettings(merged)
  return merged
}

function sanitizeFilename(filename) {
  return String(filename || '')
    .trim()
    .replace(/[\\/]+/g, '_')
    .replace(/^\.+/, '')
}

function artifactStatus(status) {
  return status || 'never_synced'
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withTimeout(task, ms, message) {
  let timer = null
  try {
    return await Promise.race([
      task(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms)
      })
    ])
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}

async function sha256File(filePath) {
  return await new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

async function replaceFileWithRollback(tempPath, finalPath) {
  const backupPath = `${finalPath}.bak`
  await rm(backupPath, { force: true }).catch(() => {})

  try {
    await rename(tempPath, finalPath)
    return
  } catch {
    // Windows typically fails when destination already exists.
  }

  let movedOriginal = false
  try {
    await rename(finalPath, backupPath)
    movedOriginal = true
  } catch {
    movedOriginal = false
  }

  try {
    await rename(tempPath, finalPath)
    if (movedOriginal) {
      await rm(backupPath, { force: true }).catch(() => {})
    }
  } catch (error) {
    if (movedOriginal) {
      await rename(backupPath, finalPath).catch(() => {})
    }
    throw error
  }
}

async function cleanupDirectoryTemps(dirPath) {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    let removed = 0
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue
      }
      if (!entry.name.endsWith('.tmp') && !entry.name.endsWith('.bak')) {
        continue
      }
      await rm(join(dirPath, entry.name), { force: true }).catch(() => {})
      removed += 1
    }
    return removed
  } catch {
    return 0
  }
}

async function cleanupArtifactTemps(finalPath) {
  await rm(`${finalPath}.tmp`, { force: true }).catch(() => {})
  await rm(`${finalPath}.bak`, { force: true }).catch(() => {})
}

function needsDownload(artifact, state, localExists) {
  if (!localExists) {
    return true
  }
  if (!state?.lastSyncedAt) {
    return true
  }
  if (artifact.sha256 && artifact.sha256 !== state.remoteSha256) {
    return true
  }
  if (artifact.etag && artifact.etag !== state.remoteEtag) {
    return true
  }
  if (artifact.updatedAt && artifact.updatedAt !== state.remoteUpdatedAt) {
    return true
  }
  return false
}

async function syncArtifact(settings, artifact, force = false) {
  const startedAtMs = Date.now()
  const liveArtifact = await fetchArtifactMeta(settings, artifact)
  const safeFilename = sanitizeFilename(artifact.filename || `${artifact.name}.${artifact.type}`)
  const finalPath = join(settings.destinationDir, safeFilename)
  const tempPath = `${finalPath}.tmp`
  const state = getArtifactSyncState(artifact.id)
  let lastProgressPersistAt = 0
  await cleanupArtifactTemps(finalPath)

  let localExists = true
  let localStat = null
  try {
    localStat = await stat(finalPath)
  } catch {
    localExists = false
  }

  if (!force && !needsDownload(liveArtifact, state, localExists)) {
    upsertArtifactSyncState(artifact.id, {
      status: 'synchronized',
      localPath: finalPath,
      localSizeBytes: localStat?.size ?? state?.localSizeBytes ?? null,
      lastCheckedAt: nowIso(),
      lastSyncedAt: state?.lastSyncedAt ?? null,
      lastError: null,
      downloadedBytes: state?.downloadedBytes ?? null,
      totalBytes: state?.totalBytes ?? liveArtifact.sizeBytes ?? null,
      downloadProgress: 100,
      lastSyncDurationMs: state?.lastSyncDurationMs ?? null,
      remoteSha256: liveArtifact.sha256 ?? state?.remoteSha256 ?? null,
      remoteEtag: liveArtifact.etag ?? state?.remoteEtag ?? null,
      remoteUpdatedAt: liveArtifact.updatedAt ?? state?.remoteUpdatedAt ?? null
    })
    return { downloaded: false }
  }

  addLog('info', `Baixando ${liveArtifact.name}`, artifact.id)
  upsertArtifactSyncState(artifact.id, {
    status: 'downloading',
    localPath: finalPath,
    lastCheckedAt: nowIso(),
    lastError: null,
    downloadedBytes: 0,
    totalBytes: liveArtifact.sizeBytes ?? null,
    downloadProgress: 0,
    lastSyncDurationMs: null,
    remoteSha256: liveArtifact.sha256 ?? state?.remoteSha256 ?? null,
    remoteEtag: liveArtifact.etag ?? state?.remoteEtag ?? null,
    remoteUpdatedAt: liveArtifact.updatedAt ?? state?.remoteUpdatedAt ?? null
  })

  const downloadResult = await downloadArtifact(settings, liveArtifact, tempPath, async (downloadedBytes, totalBytes) => {
    const now = Date.now()
    if (now - lastProgressPersistAt < 250 && totalBytes && downloadedBytes < totalBytes) {
      return
    }
    lastProgressPersistAt = now
    upsertArtifactSyncState(artifact.id, {
      status: 'downloading',
      localPath: finalPath,
      lastCheckedAt: nowIso(),
      lastError: null,
      downloadedBytes,
      totalBytes,
      downloadProgress: totalBytes ? Math.min(100, (downloadedBytes / totalBytes) * 100) : null,
      lastSyncDurationMs: null,
      remoteSha256: liveArtifact.sha256 ?? state?.remoteSha256 ?? null,
      remoteEtag: liveArtifact.etag ?? state?.remoteEtag ?? null,
      remoteUpdatedAt: liveArtifact.updatedAt ?? state?.remoteUpdatedAt ?? null
    })
  })

  upsertArtifactSyncState(artifact.id, {
    status: 'finalizing',
    localPath: finalPath,
    lastCheckedAt: nowIso(),
    lastError: null,
    downloadedBytes: downloadResult.downloadedBytes ?? liveArtifact.sizeBytes ?? null,
    totalBytes: downloadResult.totalBytes ?? liveArtifact.sizeBytes ?? null,
    downloadProgress: 100,
    lastSyncDurationMs: null,
    remoteSha256: liveArtifact.sha256 ?? state?.remoteSha256 ?? null,
    remoteEtag: liveArtifact.etag ?? state?.remoteEtag ?? null,
    remoteUpdatedAt: liveArtifact.updatedAt ?? state?.remoteUpdatedAt ?? null
  })
  addLog('info', `Download concluído, validando ${liveArtifact.name}`, artifact.id)

  if (liveArtifact.sha256) {
    const fileHash = await sha256File(tempPath)
    if (fileHash !== liveArtifact.sha256) {
      await rm(tempPath, { force: true }).catch(() => {})
      throw new Error(`Checksum inválido para ${liveArtifact.name}`)
    }
  }

  await replaceFileWithRollback(tempPath, finalPath)
  const finalStat = await stat(finalPath)

  if (liveArtifact.sizeBytes && finalStat.size !== liveArtifact.sizeBytes) {
    throw new Error(`Arquivo final inconsistente para ${liveArtifact.name}: esperado ${liveArtifact.sizeBytes}, obtido ${finalStat.size}`)
  }

  upsertArtifactSyncState(artifact.id, {
    status: 'updated',
    localPath: finalPath,
    localSizeBytes: finalStat.size,
    lastCheckedAt: nowIso(),
    lastSyncedAt: nowIso(),
    lastError: null,
    downloadedBytes: finalStat.size,
    totalBytes: finalStat.size,
    downloadProgress: 100,
    lastSyncDurationMs: Date.now() - startedAtMs,
    remoteSha256: liveArtifact.sha256 ?? state?.remoteSha256 ?? null,
    remoteEtag: liveArtifact.etag ?? state?.remoteEtag ?? null,
    remoteUpdatedAt: liveArtifact.updatedAt ?? state?.remoteUpdatedAt ?? null
  })
  addLog('info', `Artefato atualizado: ${liveArtifact.name}`, artifact.id)
  return { downloaded: true }
}

async function syncArtifactWithRetry(settings, artifact, force = false) {
  let lastError = null
  for (let attempt = 1; attempt <= RETRY_COUNT; attempt += 1) {
    try {
      if (attempt > 1) {
        addLog('warn', `Nova tentativa ${attempt}/${RETRY_COUNT} para ${artifact.name}`, artifact.id)
      }
      return await withTimeout(
        () => syncArtifact(settings, artifact, force),
        ARTIFACT_SYNC_TIMEOUT_MS,
        `Sincronização de ${artifact.name} excedeu ${Math.floor(ARTIFACT_SYNC_TIMEOUT_MS / 1000)}s`
      )
    } catch (error) {
      lastError = error
      await cleanupArtifactTemps(join(settings.destinationDir, sanitizeFilename(artifact.filename || `${artifact.name}.${artifact.type}`)))
      if (attempt >= RETRY_COUNT) {
        break
      }
      await sleep(RETRY_BACKOFF_MS * attempt)
    }
  }
  throw lastError
}

async function runSyncPass(options) {
  const settings = resolveSettings(options.settingsOverride)

  await mkdir(settings.destinationDir, { recursive: true })
  const removedTemps = await cleanupDirectoryTemps(settings.destinationDir)
  if (removedTemps > 0) {
    addLog('info', `Limpeza preventiva removeu ${removedTemps} arquivo(s) temporário(s).`)
  }

  const remoteArtifacts = await fetchRemoteArtifacts(settings)
  upsertRemoteArtifacts(remoteArtifacts)

  const artifacts = getArtifactsForSync(options.artifactIds)
  if (!artifacts.length) {
    addLog('warn', 'Nenhum artefato selecionado para sincronizar.')
    return {
      total: 0,
      updated: 0,
      errors: 0
    }
  }

  let updated = 0
  let errors = 0

  for (const artifact of artifacts) {
    runtimeState.currentArtifactId = artifact.id
    try {
      const result = await syncArtifactWithRetry(settings, artifact, options.force)
      if (result.downloaded) {
        updated += 1
      }
    } catch (error) {
      errors += 1
      addLog('error', `Falha ao sincronizar ${artifact.name}: ${error.message}`, artifact.id)
      upsertArtifactSyncState(artifact.id, {
        status: 'error',
        localPath: join(settings.destinationDir, sanitizeFilename(artifact.filename)),
        lastCheckedAt: nowIso(),
        lastError: error.message,
        downloadedBytes: null,
        totalBytes: artifact.sizeBytes ?? null,
        downloadProgress: null,
        lastSyncDurationMs: null,
        remoteSha256: artifact.sha256 ?? null,
        remoteEtag: artifact.etag ?? null,
        remoteUpdatedAt: artifact.updatedAt ?? null
      })
    }
  }

  return {
    total: artifacts.length,
    updated,
    errors
  }
}

async function runSyncLoop(options) {
  let nextOptions = options
  do {
    runtimeState.running = true
    runtimeState.queued = false
    runtimeState.reason = nextOptions.reason
    runtimeState.startedAt = nowIso()
    runtimeState.finishedAt = null
    runtimeState.lastSummary = null
    addLog('info', `Sincronização iniciada (${nextOptions.reason})`)
    const runStartedAtMs = Date.now()

    queuedSyncRequest = null
    try {
      const summary = await runSyncPass(nextOptions)
      runtimeState.lastSummary = {
        ...summary,
        durationMs: Date.now() - runStartedAtMs
      }
      addLog('info', `Sincronização concluída: ${summary.updated} atualizado(s), ${summary.errors} erro(s).`)
    } catch (error) {
      runtimeState.lastSummary = { total: 0, updated: 0, errors: 1, durationMs: Date.now() - runStartedAtMs }
      addLog('error', `Sincronização falhou: ${error.message}`)
    } finally {
      runtimeState.running = false
      runtimeState.currentArtifactId = null
      runtimeState.finishedAt = nowIso()
    }

    nextOptions = queuedSyncRequest
  } while (nextOptions)

  runtimeState.queued = false
}

export async function requestSync(options = {}) {
  resolveSettings(options.settingsOverride)

  const normalized = {
    reason: options.reason || 'manual',
    force: Boolean(options.force),
    settingsOverride: options.settingsOverride || null,
    artifactIds: Array.isArray(options.artifactIds) && options.artifactIds.length
      ? [...new Set(options.artifactIds.map(String))]
      : null
  }

  if (runtimeState.running) {
    queuedSyncRequest = normalized
    runtimeState.queued = true
    addLog('info', 'Sincronização já em andamento; nova execução enfileirada.')
    return { started: false, queued: true }
  }

  void runSyncLoop(normalized)
  return { started: true, queued: false }
}

export function refreshScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }

  const settings = getSettings()
  if (!settings.autoSyncEnabled) {
    addLog('info', 'Sincronização automática desativada.')
    return
  }

  const intervalMs = Math.max(1, Number(settings.syncIntervalMinutes || 15)) * 60 * 1000
  intervalHandle = setInterval(() => {
    void requestSync({ reason: 'interval' })
  }, intervalMs)
  addLog('info', `Sincronização automática agendada a cada ${settings.syncIntervalMinutes} minuto(s).`)
}

export async function cleanupStaleSyncArtifacts() {
  const settings = getSettings()
  const stuckArtifacts = listInProgressArtifactStates()
  for (const state of stuckArtifacts) {
    if (state.localPath) {
      await cleanupArtifactTemps(state.localPath)
    }
    upsertArtifactSyncState(state.artifactId, {
      ...state,
      status: 'error',
      lastCheckedAt: nowIso(),
      lastError: 'Sincronização anterior interrompida. O artefato foi liberado para nova tentativa.'
    })
  }
  if (stuckArtifacts.length > 0) {
    addLog('warn', `${stuckArtifacts.length} sincronização(ões) interrompida(s) foram recuperadas no startup.`)
  }
  if (!settings.destinationDir) {
    return
  }
  const removedTemps = await cleanupDirectoryTemps(settings.destinationDir)
  if (removedTemps > 0) {
    addLog('info', `Inicialização removeu ${removedTemps} arquivo(s) temporário(s) órfão(s).`)
  }
}

export function getSyncStatus() {
  return {
    runtime: {
      ...runtimeState,
      currentArtifactId: runtimeState.currentArtifactId,
      currentArtifactStatus: runtimeState.currentArtifactId
        ? artifactStatus(getArtifactSyncState(runtimeState.currentArtifactId)?.status)
        : null
    },
    artifacts: listArtifacts(),
    logs: listLogs(50)
  }
}
