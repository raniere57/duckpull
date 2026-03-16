import { mkdir } from 'fs/promises'
import { createWriteStream } from 'fs'
import { dirname } from 'path'

const DOWNLOAD_TIMEOUT_MS = Number(process.env.DUCKPULL_DOWNLOAD_TIMEOUT_MS || 15 * 60 * 1000)
const STALL_TIMEOUT_MS = Number(process.env.DUCKPULL_STALL_TIMEOUT_MS || 30 * 1000)

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '')
}

function authHeaders(token) {
  return token
    ? { Authorization: `Bearer ${token}` }
    : {}
}

function buildRemoteUrl(baseUrl, path) {
  return `${normalizeBaseUrl(baseUrl)}${path.startsWith('/') ? path : `/${path}`}`
}

function withQuery(url, params) {
  const nextUrl = new URL(url)
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') {
      nextUrl.searchParams.set(key, String(value))
    }
  }
  return nextUrl.toString()
}

function normalizeArtifact(baseUrl, artifact) {
  const name = String(artifact.name || artifact.filename || artifact.id || '').trim()
  const filename = String(artifact.filename || name).split(/[\\/]/).pop()
  const type = String(
    artifact.type ||
    (filename.endsWith('.parquet') ? 'parquet' : 'duckdb')
  ).replace(/^\./, '')
  const id = String(artifact.id || filename || name)
  const downloadUrl = artifact.download_url
    ? new URL(artifact.download_url, `${normalizeBaseUrl(baseUrl)}/`).toString()
    : buildRemoteUrl(baseUrl, `/artifacts/${encodeURIComponent(id)}/download`)

  return {
    id,
    name: name || filename,
    filename,
    type,
    sizeBytes: artifact.size_bytes ?? artifact.size ?? null,
    sha256: artifact.sha256 ?? null,
    etag: artifact.etag ?? null,
    updatedAt: artifact.updated_at ?? artifact.updatedAt ?? null,
    downloadUrl
  }
}

async function getJson(response) {
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = payload?.detail || payload?.message || response.statusText
    throw new Error(`DuckFlow respondeu ${response.status}: ${detail}`)
  }
  return payload
}

export async function fetchRemoteArtifacts(settings) {
  const url = buildRemoteUrl(settings.apiBaseUrl, '/artifacts')
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...authHeaders(settings.authToken)
    }
  })
  const payload = await getJson(response)
  const artifacts = Array.isArray(payload) ? payload : payload.artifacts
  if (!Array.isArray(artifacts)) {
    throw new Error('Resposta inválida do DuckFlow em /artifacts')
  }
  return artifacts.map((artifact) => normalizeArtifact(settings.apiBaseUrl, artifact))
}

export async function testRemoteConnection(settings) {
  const artifacts = await fetchRemoteArtifacts(settings)
  return {
    ok: true,
    artifactCount: artifacts.length,
    sample: artifacts.slice(0, 5)
  }
}

export async function fetchArtifactMeta(settings, artifact) {
  const url = buildRemoteUrl(settings.apiBaseUrl, `/artifacts/${encodeURIComponent(artifact.id)}/meta`)
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...authHeaders(settings.authToken)
    }
  })
  const payload = await getJson(response)
  return normalizeArtifact(settings.apiBaseUrl, payload)
}

export async function downloadArtifact(settings, artifact, tempPath, onProgress = null) {
  await mkdir(dirname(tempPath), { recursive: true })
  const controller = new AbortController()
  let overallTimer = null
  let stallTimer = null
  const requestUrl = withQuery(artifact.downloadUrl, {
    expected_etag: artifact.etag || undefined
  })

  const resetStallTimer = () => {
    if (stallTimer) {
      clearTimeout(stallTimer)
    }
    stallTimer = setTimeout(() => {
      controller.abort(new Error(`Download parado por mais de ${Math.floor(STALL_TIMEOUT_MS / 1000)}s`))
    }, STALL_TIMEOUT_MS)
  }

  overallTimer = setTimeout(() => {
    controller.abort(new Error(`Download excedeu o tempo limite de ${Math.floor(DOWNLOAD_TIMEOUT_MS / 1000)}s`))
  }, DOWNLOAD_TIMEOUT_MS)

  let response
  try {
    response = await fetch(requestUrl, {
      headers: {
        Accept: '*/*',
        ...authHeaders(settings.authToken)
      },
      signal: controller.signal
    })
  } catch (error) {
    clearTimeout(overallTimer)
    if (stallTimer) {
      clearTimeout(stallTimer)
    }
    throw new Error(error?.cause?.message || error?.message || `Falha de rede ao baixar ${artifact.name}`)
  }

  if (!response.ok || !response.body) {
    clearTimeout(overallTimer)
    if (stallTimer) {
      clearTimeout(stallTimer)
    }
    const bodyText = await response.text().catch(() => '')
    throw new Error(
      `Falha no download de ${artifact.name}: ${response.status} ${bodyText || response.statusText}`
    )
  }

  const responseEtag = response.headers.get('etag') || artifact.etag || null
  if (artifact.etag && responseEtag && artifact.etag !== responseEtag) {
    throw new Error(`Versão do artefato ${artifact.name} mudou durante o início do download`)
  }

  const totalBytes = Number(response.headers.get('content-length') || artifact.sizeBytes || 0) || null
  const writer = createWriteStream(tempPath)
  const reader = response.body.getReader()

  let downloadedBytes = 0
  try {
    resetStallTimer()
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      if (value) {
        resetStallTimer()
        downloadedBytes += value.byteLength
        writer.write(Buffer.from(value))
        if (onProgress) {
          await onProgress(downloadedBytes, totalBytes)
        }
      }
    }
  } finally {
    clearTimeout(overallTimer)
    if (stallTimer) {
      clearTimeout(stallTimer)
    }
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve)
      writer.on('error', reject)
      writer.end()
    })
  }

  if (totalBytes && downloadedBytes !== totalBytes) {
    throw new Error(`Download incompleto de ${artifact.name}: ${downloadedBytes} de ${totalBytes} bytes`)
  }

  return {
    downloadedBytes,
    totalBytes,
    etag: responseEtag
  }
}
