import { existsSync } from 'fs'
import { join } from 'path'
import { staticPlugin } from '@elysiajs/static'
import { Elysia, t } from 'elysia'
import { frontendDistDir, host, port } from './config.js'
import { addLog, getArtifact, getSettings, initDb, listArtifacts, listLogs, saveSettings, updateArtifactSelection, upsertRemoteArtifacts } from './db.js'
import { fetchRemoteArtifacts, testRemoteConnection } from './remote-api.js'
import { getSyncStatus, refreshScheduler, requestSync } from './sync-manager.js'

initDb()
if (process.env.DUCKPULL_DISABLE_LISTEN !== '1') {
  refreshScheduler()
}

export const app = new Elysia()
  .onError(({ error, set, code }) => {
    if (code === 'NOT_FOUND') {
      set.status = 404
      return { detail: 'Not Found' }
    }
    set.status = 500
    return { detail: error.message || 'Internal Server Error' }
  })
  .get('/api/health', () => ({
    ok: true,
    service: 'duckpull',
    time: new Date().toISOString(),
    hasFrontendBuild: existsSync(join(frontendDistDir, 'index.html'))
  }))
  .get('/api/settings', () => getSettings())
  .put('/api/settings', async ({ body }) => {
    const settings = saveSettings(body)
    refreshScheduler()
    addLog('info', 'Configurações atualizadas.')
    return settings
  }, {
    body: t.Object({
      apiBaseUrl: t.String(),
      authToken: t.String(),
      destinationDir: t.String(),
      syncIntervalMinutes: t.Numeric(),
      autoSyncEnabled: t.Boolean()
    })
  })
  .post('/api/test-connection', async ({ body }) => {
    const settings = {
      ...getSettings(),
      ...body
    }
    const result = await testRemoteConnection(settings)
    addLog('info', `Teste de conexão concluído com sucesso (${result.artifactCount} artefato(s)).`)
    return result
  }, {
    body: t.Optional(t.Object({
      apiBaseUrl: t.Optional(t.String()),
      authToken: t.Optional(t.String()),
      destinationDir: t.Optional(t.String()),
      syncIntervalMinutes: t.Optional(t.Numeric()),
      autoSyncEnabled: t.Optional(t.Boolean())
    }))
  })
  .get('/api/remote-artifacts', async () => {
    const settings = getSettings()
    const artifacts = await fetchRemoteArtifacts(settings)
    upsertRemoteArtifacts(artifacts)
    return { artifacts: listArtifacts() }
  })
  .put('/api/artifacts/:id', ({ params, body, set }) => {
    const artifact = getArtifact(params.id)
    if (!artifact) {
      set.status = 404
      return { detail: 'Artefato não encontrado.' }
    }
    updateArtifactSelection(params.id, body.selected)
    return { ok: true }
  }, {
    body: t.Object({
      selected: t.Boolean()
    })
  })
  .post('/api/sync', async ({ body }) => {
    return await requestSync({
      reason: body?.reason || 'manual',
      force: body?.force,
      artifactIds: body?.artifactIds
    })
  }, {
    body: t.Optional(t.Object({
      reason: t.Optional(t.String()),
      force: t.Optional(t.Boolean()),
      artifactIds: t.Optional(t.Array(t.String()))
    }))
  })
  .get('/api/sync/status', () => getSyncStatus())
  .get('/api/logs', ({ query }) => {
    const limit = Math.min(Number(query.limit || 200), 500)
    return {
      logs: listLogs(limit)
    }
  }, {
    query: t.Object({
      limit: t.Optional(t.String())
    })
  })

if (existsSync(join(frontendDistDir, 'index.html'))) {
  app
    .use(staticPlugin({
      assets: frontendDistDir,
      prefix: '/'
    }))
    .get('/', () => Bun.file(join(frontendDistDir, 'index.html')))
    .get('/*', ({ path, set }) => {
      if (path.startsWith('/api')) {
        set.status = 404
        return { detail: 'API route not found' }
      }
      return Bun.file(join(frontendDistDir, 'index.html'))
    })
}

if (process.env.DUCKPULL_DISABLE_LISTEN !== '1') {
  app.listen({ hostname: host, port })
  console.log(`[duckpull] Rodando em http://${host}:${port}`)
}
