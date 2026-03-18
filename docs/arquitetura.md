# Arquitetura do duckpull

O duckpull é um cliente local de sincronização de artefatos. Ele roda no computador do usuário, conecta a uma API remota (DuckFlow), baixa arquivos de dados selecionados e os mantém atualizados automaticamente.

---

## Visão geral

```
Servidor remoto (DuckFlow)
        │
        │  HTTP + Bearer token
        ▼
┌─────────────────────────────────────────────┐
│              duckpull (Bun)                 │
│                                             │
│  ┌──────────────┐     ┌───────────────────┐ │
│  │  Servidor    │────▶│  Sync manager     │ │
│  │  HTTP :5767  │     │  (agendador +     │ │
│  │  (Elysia)    │     │   download)       │ │
│  └──────┬───────┘     └────────┬──────────┘ │
│         │                      │            │
│         ▼                      ▼            │
│  ┌──────────────┐     ┌───────────────────┐ │
│  │  Interface   │     │  SQLite           │ │
│  │  Vue 3 (SPA) │     │  (duckpull.db)    │ │
│  └──────────────┘     └───────────────────┘ │
└─────────────────────────────────────────────┘
        │
        ▼
  data/runtime/synced-artifacts/
  (arquivos .duckdb / .parquet locais)
```

---

## Componentes

### Servidor HTTP (`src/server/index.js`)
Usa o framework [Elysia](https://elysiajs.com/) rodando sobre Bun. Expõe a API REST consumida pela interface e pelos scripts externos. Autentica todas as rotas protegidas via cookie de sessão.

Principais rotas:

| Rota | Descrição |
|------|-----------|
| `POST /api/auth/login` | Autenticação por senha |
| `GET /api/settings` | Lê configurações salvas |
| `PUT /api/settings` | Salva configurações e reinicia o agendador |
| `POST /api/remote-artifacts/refresh` | Busca lista de artefatos no servidor remoto |
| `PUT /api/artifacts/:id` | Marca/desmarca artefato para sincronização |
| `POST /api/sync` | Dispara sincronização manual |
| `GET /api/sync/status` | Retorna estado atual do runtime + artefatos + logs |
| `POST /api/pick-directory` | Abre seletor de pasta nativo do OS |

---

### Autenticação (`src/server/auth.js`)
Sessão baseada em cookie `HttpOnly` assinado com HMAC-SHA256. TTL de 12 horas. A senha é armazenada como hash bcrypt no banco. Sem JWT, sem dependências externas.

---

### Sincronização (`src/server/sync-manager.js`)
Núcleo do sistema. Responsável por:

- **Agendador** — dispara `requestSync` a cada N minutos (configurável). Reinicia quando as configurações mudam.
- **Fila** — se uma sync já está rodando quando outra é solicitada, a nova fica enfileirada e executa logo em seguida.
- **Ciclo por artefato** — para cada artefato selecionado:
  1. Busca metadados frescos no servidor (`/artifacts/:id/meta`)
  2. Compara `sha256`, `etag` e `updated_at` com o estado local
  3. Se mudou: baixa para um arquivo `.tmp`, valida hash, substitui o arquivo final com rollback em caso de falha
  4. Marca o arquivo como somente leitura após o sync
- **Retry** — 3 tentativas com backoff em caso de erro por artefato
- **Cleanup no boot** — artefatos travados em `downloading`/`finalizing` são liberados para nova tentativa

---

### Cliente de API remota (`src/server/remote-api.js`)
Faz as chamadas HTTP ao servidor DuckFlow:

- `GET /artifacts` — lista artefatos disponíveis
- `GET /artifacts/:id/meta` — metadados para decisão de download
- `GET /artifacts/:id/download` — download em streaming com controle de progresso, timeout total e timeout de stall

---

### Banco de dados (`src/server/db.js`)
SQLite via `bun:sqlite`, com WAL mode. Cinco tabelas:

| Tabela | Conteúdo |
|--------|----------|
| `app_config` | Configurações chave-valor (intervalo, pasta destino, etc.) |
| `remote_sources` | URL e token do servidor remoto |
| `artifacts` | Catálogo de artefatos conhecidos |
| `artifact_sync_state` | Estado de cada artefato (status, progresso, erros, hashes) |
| `sync_logs` | Log de eventos com nível e referência ao artefato |

---

### Interface (`src/client/`)
SPA Vue 3 compilada pelo Vite (`dist/`). Servida como arquivos estáticos pelo próprio servidor Bun. Faz polling em `/api/sync/status` a cada 3 segundos para atualizar status de download em tempo real.

---

### Scripts de OS (`scripts/`)
Scripts para Linux (bash) e Windows (PowerShell + .bat) que gerenciam o ciclo de vida do processo:

- `start-*` — verifica PID, instala Bun se necessário, faz build do frontend se ausente, inicia em background
- `stop-*` — lê o PID file e encerra o processo
- `enable-autostart-*` / `disable-autostart-*` — registra/remove o serviço no systemd (Linux) ou no Agendador de Tarefas (Windows)

---

## Fluxo de dados

```
Usuário abre o navegador
        │
        ▼
Interface Vue faz login → recebe cookie de sessão
        │
        ▼
Usuário configura URL + token + pasta de destino
        │
        ▼
Clica em "Atualizar lista" → duckpull chama GET /artifacts no DuckFlow
        │
        ▼
Usuário seleciona quais artefatos quer sincronizar
        │
        ▼
Sync manual ou agendador automático dispara
        │
        ├── Para cada artefato selecionado:
        │       ├── Busca metadados frescos
        │       ├── Compara com versão local
        │       ├── Se mudou: baixa → valida sha256 → substitui arquivo
        │       └── Atualiza estado no banco
        │
        ▼
Arquivos disponíveis em data/runtime/synced-artifacts/
```

---

## Configuração

Variáveis de ambiente (arquivo `.env`):

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `DUCKPULL_HOST` | `127.0.0.1` | Endereço de escuta |
| `DUCKPULL_PORT` | `5767` | Porta HTTP |
| `DUCKPULL_DATA_DIR` | `./data/runtime` | Diretório de dados e banco |
| `DUCKPULL_DOWNLOAD_TIMEOUT_MS` | `900000` | Timeout total de download (15 min) |
| `DUCKPULL_STALL_TIMEOUT_MS` | `30000` | Timeout de stall por chunk (30 s) |

---

## Contrato da API remota

O duckpull espera que o servidor remoto implemente:

```
GET /artifacts              → lista de artefatos com id, filename, type, download_url
GET /artifacts/:id/meta     → metadados: sha256, etag, size_bytes, updated_at
GET /artifacts/:id/download → binário em streaming
```

Autenticação via header `Authorization: Bearer <token>`.
Detalhes completos em [`docs/duckflow-artifacts-api.md`](docs/duckflow-artifacts-api.md).