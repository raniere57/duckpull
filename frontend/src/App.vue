<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'

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
  loadingArtifacts: false,
  syncing: false
})

let pollHandle = null

const selectedCount = computed(() => artifacts.value.filter((artifact) => artifact.selected).length)

function setMessage(text, kind = 'info') {
  message.value = text
  messageKind.value = kind
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.detail || payload.message || `Erro ${response.status}`)
  }

  if (response.status === 204) {
    return null
  }

  return await response.json()
}

function applySettings(payload) {
  settings.apiBaseUrl = payload.apiBaseUrl || ''
  settings.authToken = payload.authToken || ''
  settings.destinationDir = payload.destinationDir || ''
  settings.syncIntervalMinutes = payload.syncIntervalMinutes || 15
  settings.autoSyncEnabled = Boolean(payload.autoSyncEnabled)
}

async function loadSettings() {
  const payload = await api('/api/settings')
  applySettings(payload)
}

async function loadStatus() {
  const payload = await api('/api/sync/status')
  runtime.value = payload.runtime
  artifacts.value = payload.artifacts
  logs.value = payload.logs
}

async function saveSettings() {
  busy.saving = true
  try {
    const payload = await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(settings)
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
      body: JSON.stringify(settings)
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
    const payload = await api('/api/remote-artifacts')
    artifacts.value = payload.artifacts
    setMessage('Lista de artefatos atualizada.', 'success')
  } catch (error) {
    setMessage(error.message, 'error')
  } finally {
    busy.loadingArtifacts = false
  }
}

async function updateSelection(artifact) {
  try {
    await api(`/api/artifacts/${encodeURIComponent(artifact.id)}`, {
      method: 'PUT',
      body: JSON.stringify({ selected: artifact.selected })
    })
  } catch (error) {
    artifact.selected = !artifact.selected
    setMessage(error.message, 'error')
  }
}

async function triggerSync(force = false) {
  busy.syncing = true
  try {
    const payload = await api('/api/sync', {
      method: 'POST',
      body: JSON.stringify({
        reason: 'manual',
        force
      })
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

async function boot() {
  try {
    await loadSettings()
    await loadStatus()
  } catch (error) {
    setMessage(error.message, 'error')
  }

  pollHandle = window.setInterval(() => {
    loadStatus().catch(() => {})
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
            <input v-model="settings.destinationDir" placeholder="/dados/duckpull" />
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
                  <span class="status-pill" :data-state="artifact.status">{{ artifact.status }}</span>
                  <small v-if="artifact.lastError" class="error-text">{{ artifact.lastError }}</small>
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
  </div>
</template>
