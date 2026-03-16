# duckpull

`duckpull` é o cliente leve do ecossistema Duck. Ele roda sem Docker, expõe uma interface web local e sincroniza artefatos `.duckdb` e `.parquet` publicados pelo `duckflow`.

## Objetivo

Resolver distribuição local de artefatos sem SMB, Syncthing ou FTP:

- configura a URL remota do DuckFlow
- usa autenticação por Bearer token
- lista artefatos remotos publicados
- permite selecionar quais artefatos manter localmente
- baixa com arquivo temporário e troca segura
- registra logs e status locais
- executa sincronização manual ou automática

## Estrutura

```text
duckpull/
  backend/
  frontend/
  scripts/
  docs/
  data/
```

## Stack

- Backend local: Bun + Elysia
- Frontend: Vue 3 + Vite
- Banco local: SQLite via `bun:sqlite`
- Porta padrão: `http://localhost:5767`

## Funcionalidades da V1

- tela de configuração inicial
- teste de conexão
- listagem de artefatos remotos
- seleção por artefato
- sincronização manual
- sincronização automática por intervalo
- logs locais
- status por artefato:
  - `never_synced`
  - `synchronized`
  - `downloading`
  - `error`
  - `updated`

## API local do duckpull

- `GET /api/health`
- `GET /api/settings`
- `PUT /api/settings`
- `POST /api/test-connection`
- `GET /api/remote-artifacts`
- `PUT /api/artifacts/:id`
- `POST /api/sync`
- `GET /api/sync/status`
- `GET /api/logs`

## Instalação

Pré-requisito: Bun instalado no sistema.

### Linux

```bash
cd duckpull
chmod +x scripts/install-linux.sh scripts/start-linux.sh
./scripts/install-linux.sh
./scripts/start-linux.sh
```

### Windows

Abra PowerShell e rode:

```powershell
cd duckpull
.\scripts\install-windows.ps1
.\scripts\start-windows.ps1
```

## Configuração

Depois de subir o serviço, abra:

```text
http://localhost:5767
```

Na tela inicial configure:

- `API base URL`
- `Token Bearer`
- `Pasta de destino`
- `Intervalo de sincronização`
- `Sincronização automática`

## Persistência local

O banco SQLite é criado em:

```text
duckpull/data/runtime/duckpull.db
```

Por padrão, os artefatos sincronizados ficam em:

```text
duckpull/data/runtime/synced-artifacts
```

Você pode trocar a pasta de destino pela interface.

## Segurança de atualização de arquivo

O download sempre acontece para um arquivo temporário primeiro.

Fluxo:

1. baixa para `arquivo.tmp`
2. valida checksum quando `sha256` existe
3. troca o arquivo final
4. em caso de falha na substituição, mantém rollback do original

## Contrato esperado do DuckFlow

O contrato remoto esperado está em:

[docs/duckflow-artifacts-api.md](/Users/raniere/Dev/duck_project/duckpull/docs/duckflow-artifacts-api.md)

## Desenvolvimento

### Backend

```bash
cd duckpull/backend
bun install
bun run dev
```

### Frontend

```bash
cd duckpull/frontend
bun install
bun run dev
```

Para rodar o frontend servido pelo backend:

```bash
cd duckpull/frontend
bun run build

cd ../backend
bun start
```

## Observações

- O `duckpull` não altera `duckflow` nem `duckpad`.
- O contrato remoto do DuckFlow foi apenas documentado nesta V1.
- O backend local serve a build estática do frontend quando `frontend/dist` existir.
