import { mkdir } from 'fs/promises'
import { createWriteStream } from 'fs'
import { dirname } from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'

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

export async function downloadArtifact(settings, artifact, tempPath) {
  await mkdir(dirname(tempPath), { recursive: true })

  const response = await fetch(artifact.downloadUrl, {
    headers: {
      Accept: '*/*',
      ...authHeaders(settings.authToken)
    }
  })

  if (!response.ok || !response.body) {
    const bodyText = await response.text().catch(() => '')
    throw new Error(
      `Falha no download de ${artifact.name}: ${response.status} ${bodyText || response.statusText}`
    )
  }

  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(tempPath)
  )
}
