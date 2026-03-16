<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'

const auth = reactive({
  checking: true,
  authenticated: false,
  password: '',
  loggingIn: false,
  loggingOut: false
})

const settings = reactive({
  apiBaseUrl: '',
  authToken: '',
  destinationDir: '',
  syncIntervalMinutes: 15,
  autoSyncEnabled: true
})

const artifacts = ref([])
const logs = ref([])
const runtime = ref({
  running: false,
  queued: false,
  currentArtifactId: null,
  startedAt: null,
  finishedAt: null,
  lastSummary: null
})
const message = ref('')
const messageKind = ref('info')
const busy = reactive({
  saving: false,
  testing: false,
  pickingDir: false,
  openingDir: false,
  loadingArtifacts: false,
  syncing: false
})

let pollHandle = null

const selectedCount = computed(() => artifacts.value.filter((artifact) => artifact.selected).length)

function currentSettingsPayload() {
  return {
    apiBaseUrl: settings.apiBaseUrl,
    authToken: settings.authToken,
    destinationDir: settings.destinationDir,
    syncIntervalMinutes: settings.syncIntervalMinutes,
    autoSyncEnabled: settings.autoSyncEnabled
  }
}

function setMessage(text, kind = 'info') {
  message.value = text
  messageKind.value = kind
}

async function api(path, options = {}) {
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? 15000
  const timer = window.setTimeout(() => {
    controller.abort()
  }, timeoutMs)

  let response
  try {
    response = await fetch(path, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      ...options,
      signal: controller.signal
    })
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Operação excedeu ${Math.floor(timeoutMs / 1000)}s.`)
    }
    throw error
  } finally {
    window.clearTimeout(timer)
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    const error = new Error(payload.detail || payload.message || `Erro ${response.status}`)
    error.status = response.status
    throw error
  }

  if (response.status === 204) {
    return null
  }

  return await response.json()
}

async function loadAuthStatus() {
  const payload = await api('/api/auth/status', { timeoutMs: 8000 })
  auth.authenticated = Boolean(payload.authenticated)
  auth.checking = false
}

function applySettings(payload) {
  settings.apiBaseUrl = payload.apiBaseUrl || ''
  settings.authToken = payload.authToken || ''
  settings.destinationDir = payload.destinationDir || ''
  settings.syncIntervalMinutes = payload.syncIntervalMinutes || 15
  settings.autoSyncEnabled = Boolean(payload.autoSyncEnabled)
}

async function loadSettings() {
  const payload = await api('/api/settings', { timeoutMs: 10000 })
  applySettings(payload)
}

async function loadStatus() {
  const payload = await api('/api/sync/status', { timeoutMs: 10000 })
  runtime.value = payload.runtime
  artifacts.value = payload.artifacts
  logs.value = payload.logs
}

async function saveSettings() {
  busy.saving = true
  try {
    const payload = await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
      timeoutMs: 15000
    })
    applySettings(payload)
    setMessage('Configurações salvas.', 'success')
  } catch (error) {
    setMessage(error.message, 'error')
  } finally {
    busy.saving = false
  }
}

async function testConnection() {
  busy.testing = true
  try {
    const payload = await api('/api/test-connection', {
      method: 'POST',
      body: JSON.stringify(settings),
      timeoutMs: 20000
    })
    setMessage(`Conexão OK. ${payload.artifactCount} artefato(s) encontrado(s).`, 'success')
  } catch (error) {
    setMessage(error.message, 'error')
  } finally {
    busy.testing = false
  }
}

async function refreshArtifacts() {
  busy.loadingArtifacts = true
  try {
    const payload = await api('/api/remote-artifacts/refresh', {
      method: 'POST',
      body: JSON.stringify(currentSettingsPayload()),
      timeoutMs: 20000
    })
    artifacts.value = payload.artifacts
    setMessage('Lista de artefatos atualizada.', 'success')
  } catch (error) {
    setMessage(error.message, 'error')
  } finally {
    busy.loadingArtifacts = false
  }
}

async function browseDestinationDir() {
  busy.pickingDir = true
  try {
    const payload = await api('/api/pick-directory', {
      method: 'POST',
      body: JSON.stringify({}),
      timeoutMs: 120000
    })
    if (payload?.path) {
      settings.destinationDir = payload.path
      setMessage('Pasta de destino selecionada.', 'success')
    }
  } catch (error) {
    setMessage(error.message, 'error')
  } finally {
    busy.pickingDir = false
  }
}

async function openCurrentDestinationDir() {
  if (!settings.destinationDir) {
    setMessage('Informe uma pasta de destino primeiro.', 'info')
    return
  }

  busy.openingDir = true
  try {
    await api('/api/open-directory', {
      method: 'POST',
      body: JSON.stringify({ path: settings.destinationDir }),
      timeoutMs: 15000
    })
    setMessage('Pasta aberta no explorador do sistema.', 'success')
  } catch (error) {
    setMessage(error.message, 'error')
  } finally {
    busy.openingDir = false
  }
}

async function login() {
  auth.loggingIn = true
  try {
    await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password: auth.password }),
      timeoutMs: 10000
    })
    auth.password = ''
    auth.authenticated = true
    setMessage('Acesso liberado.', 'success')
    await loadSettings()
    await loadStatus()
  } catch (error) {
    setMessage(error.message, 'error')
  } finally {
    auth.loggingIn = false
  }
}

async function logout() {
  auth.loggingOut = true
  try {
    await api('/api/auth/logout', {
      method: 'POST',
      body: JSON.stringify({}),
      timeoutMs: 10000
    })
  } finally {
    auth.authenticated = false
    auth.loggingOut = false
  }
}

async function updateSelection(artifact) {
  try {
    await api(`/api/artifacts/${encodeURIComponent(artifact.id)}`, {
      method: 'PUT',
      body: JSON.stringify({ selected: artifact.selected }),
      timeoutMs: 10000
    })
  } catch (error) {
    artifact.selected = !artifact.selected
    setMessage(error.message, 'error')
  }
}

async function triggerSync(force = false) {
  if (!selectedCount.value) {
    setMessage('Selecione pelo menos um artefato antes de sincronizar.', 'info')
    return
  }

  busy.syncing = true
  try {
    const payload = await api('/api/sync', {
      method: 'POST',
      body: JSON.stringify({
        reason: 'manual',
        force,
        ...currentSettingsPayload()
      }),
      timeoutMs: 20000
    })
    if (payload.queued) {
      setMessage('Sincronização enfileirada.', 'info')
    } else {
      setMessage('Sincronização iniciada.', 'success')
    }
    await loadStatus()
  } catch (error) {
    setMessage(error.message, 'error')
  } finally {
    busy.syncing = false
  }
}

function formatTime(value) {
  if (!value) {
    return 'n/a'
  }
  return new Date(value).toLocaleString('pt-BR')
}

function formatSize(value) {
  if (!value && value !== 0) {
    return 'n/a'
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = Number(value)
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function formatDuration(value) {
  if (!value && value !== 0) {
    return 'n/a'
  }
  const totalMs = Number(value)
  const totalSeconds = Math.floor(totalMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  }
  return `${seconds}s`
}

function formatStatusLabel(status) {
  if (status === 'finalizing') {
    return 'Finalizing'
  }
  return String(status || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

async function boot() {
  try {
    await loadAuthStatus()
    if (auth.authenticated) {
      await loadSettings()
      await loadStatus()
    }
  } catch (error) {
    setMessage(error.message, 'error')
    auth.checking = false
  }

  pollHandle = window.setInterval(() => {
    if (auth.authenticated) {
      loadStatus().catch((error) => {
        if (error.status === 401) {
          auth.authenticated = false
        }
      })
    }
  }, 5000)
}

onMounted(boot)
onUnmounted(() => {
  if (pollHandle) {
    clearInterval(pollHandle)
  }
})
</script>

<template>
  <div class="shell">
    <div v-if="auth.checking" class="auth-shell">
      <section class="auth-card">
        <h2>duckpull</h2>
        <p>Verificando acesso local...</p>
      </section>
    </div>

    <div v-else-if="!auth.authenticated" class="auth-shell">
      <section class="auth-card">
        <p class="eyebrow">Acesso Local</p>
        <h2>Entrar no duckpull</h2>
        <p class="lead compact">Informe a senha local para acessar a interface.</p>
        <label class="auth-field">
          <span>Senha</span>
          <input v-model="auth.password" type="password" placeholder="Senha de acesso" @keyup.enter="login" />
        </label>
        <button class="primary auth-button" :disabled="auth.loggingIn || !auth.password" @click="login">
          {{ auth.loggingIn ? 'Entrando...' : 'Entrar' }}
        </button>
        <p v-if="message" class="message" :data-kind="messageKind">{{ message }}</p>
      </section>
    </div>

    <template v-else>
    <header class="hero">
      <div>
        <p class="eyebrow">Local Artifact Pull Client</p>
        <h1>duckpull</h1>
        <p class="lead">
          Cliente leve para puxar snapshots `.duckdb` e `.parquet` do DuckFlow sem depender de SMB.
        </p>
      </div>
      <div class="hero-status">
        <span class="status-pill" :data-state="runtime.running ? 'running' : 'idle'">
          {{ runtime.running ? 'Sincronizando' : 'Ocioso' }}
        </span>
        <span class="status-pill subtle">
          {{ selectedCount }} selecionado(s)
        </span>
        <button class="ghost-button" :disabled="auth.loggingOut" @click="logout">
          {{ auth.loggingOut ? 'Saindo...' : 'Sair' }}
        </button>
      </div>
    </header>

    <main class="grid">
      <section class="panel config-panel">
        <div class="panel-head">
          <div>
            <h2>Configuração</h2>
            <p>Defina a origem remota, autenticação, pasta local e intervalo automático.</p>
          </div>
        </div>

        <div class="form-grid">
          <label>
            <span>API base URL</span>
            <input v-model="settings.apiBaseUrl" placeholder="https://duckflow.exemplo.com/api" />
          </label>

          <label>
            <span>Token Bearer</span>
            <input v-model="settings.authToken" type="password" placeholder="token" />
          </label>

          <label class="wide">
            <span>Pasta de destino</span>
            <div class="path-picker">
              <input v-model="settings.destinationDir" placeholder="/dados/duckpull" />
              <button type="button" :disabled="busy.pickingDir" @click="browseDestinationDir">
                {{ busy.pickingDir ? 'Abrindo...' : 'Escolher...' }}
              </button>
              <button type="button" :disabled="busy.openingDir || !settings.destinationDir" @click="openCurrentDestinationDir">
                {{ busy.openingDir ? 'Abrindo pasta...' : 'Abrir pasta' }}
              </button>
            </div>
          </label>

          <label>
            <span>Intervalo (min)</span>
            <input v-model.number="settings.syncIntervalMinutes" type="number" min="1" />
          </label>

          <label class="toggle-row">
            <span>Sincronização automática</span>
            <input v-model="settings.autoSyncEnabled" type="checkbox" />
          </label>
        </div>

        <div class="actions">
          <button class="primary" :disabled="busy.saving" @click="saveSettings">
            {{ busy.saving ? 'Salvando...' : 'Salvar Configurações' }}
          </button>
          <button :disabled="busy.testing" @click="testConnection">
            {{ busy.testing ? 'Testando...' : 'Testar Conexão' }}
          </button>
          <button :disabled="busy.loadingArtifacts" @click="refreshArtifacts">
            {{ busy.loadingArtifacts ? 'Consultando...' : 'Atualizar Artefatos' }}
          </button>
          <button class="accent" :disabled="busy.syncing || runtime.running" @click="triggerSync(false)">
            {{ runtime.running ? 'Sincronização em andamento' : 'Sincronizar Agora' }}
          </button>
        </div>

        <p v-if="message" class="message" :data-kind="messageKind">{{ message }}</p>
      </section>

      <section class="panel state-panel">
        <div class="panel-head">
          <div>
            <h2>Execução</h2>
            <p>Status geral do pull local.</p>
          </div>
        </div>

        <div class="metrics">
          <article>
            <span>Último início</span>
            <strong>{{ formatTime(runtime.startedAt) }}</strong>
          </article>
          <article>
            <span>Último fim</span>
            <strong>{{ formatTime(runtime.finishedAt) }}</strong>
          </article>
          <article>
            <span>Artefato atual</span>
            <strong>{{ runtime.currentArtifactId || 'n/a' }}</strong>
          </article>
          <article>
            <span>Resumo</span>
            <strong v-if="runtime.lastSummary">
              {{ runtime.lastSummary.updated }} atualizados / {{ runtime.lastSummary.errors }} erros
            </strong>
            <strong v-else>n/a</strong>
          </article>
          <article>
            <span>Duração último sync</span>
            <strong>{{ formatDuration(runtime.lastSummary?.durationMs) }}</strong>
          </article>
        </div>
      </section>

      <section class="panel artifacts-panel">
        <div class="panel-head">
          <div>
            <h2>Artefatos remotos</h2>
            <p>Selecione o que deve ser mantido localmente sincronizado.</p>
          </div>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Sync</th>
                <th>Nome</th>
                <th>Tipo</th>
                <th>Tamanho</th>
                <th>Status</th>
                <th>Último sync</th>
                <th>Arquivo local</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="artifact in artifacts" :key="artifact.id">
                <td>
                  <input v-model="artifact.selected" type="checkbox" @change="updateSelection(artifact)" />
                </td>
                <td>
                  <div class="artifact-name">
                    <strong>{{ artifact.name }}</strong>
                    <small>{{ artifact.filename }}</small>
                  </div>
                </td>
                <td>{{ artifact.type }}</td>
                <td>{{ formatSize(artifact.sizeBytes) }}</td>
                <td>
                  <div class="status-stack">
                    <span class="status-pill" :data-state="artifact.status">{{ formatStatusLabel(artifact.status) }}</span>
                    <div v-if="artifact.status === 'downloading' || artifact.status === 'finalizing'" class="progress-wrap">
                      <div class="progress-bar">
                        <div class="progress-fill" :style="{ width: `${Math.round(artifact.downloadProgress || 0)}%` }"></div>
                      </div>
                      <small>
                        <template v-if="artifact.status === 'finalizing'">
                          Validando integridade e concluindo troca segura
                        </template>
                        <template v-else>
                          {{ Math.round(artifact.downloadProgress || 0) }}%
                        </template>
                        <template v-if="artifact.downloadedBytes || artifact.totalBytes">
                          · {{ formatSize(artifact.downloadedBytes || 0) }}
                          <span v-if="artifact.totalBytes"> / {{ formatSize(artifact.totalBytes) }}</span>
                        </template>
                      </small>
                    </div>
                    <small v-if="artifact.lastError" class="error-text">{{ artifact.lastError }}</small>
                  </div>
                </td>
                <td>{{ formatTime(artifact.lastSyncedAt) }}</td>
                <td>{{ artifact.localPath || 'n/a' }}</td>
              </tr>
              <tr v-if="!artifacts.length">
                <td colspan="7" class="empty-state">Nenhum artefato carregado ainda.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel logs-panel">
        <div class="panel-head">
          <div>
            <h2>Logs</h2>
            <p>Eventos recentes de conexão, download e atualização.</p>
          </div>
        </div>

        <div class="logs">
          <article v-for="log in logs" :key="log.id" class="log-entry">
            <span class="log-meta">{{ formatTime(log.createdAt) }} · {{ log.level }}</span>
            <p>{{ log.message }}</p>
          </article>
          <p v-if="!logs.length" class="empty-state">Sem eventos ainda.</p>
        </div>
      </section>
    </main>
    </template>
  </div>
</template>
