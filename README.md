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
  src/
    client/
    server/
  scripts/
  docs/
  data/
```

## Stack

- Projeto único: Bun + Elysia + Vue 3 + Vite
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

## Scripts

Pré-requisito: Bun instalado no sistema.

### Linux

```bash
cd duckpull
chmod +x scripts/start-linux.sh scripts/stop-linux.sh
./scripts/start-linux.sh
./scripts/stop-linux.sh
```

### Windows

Abra PowerShell e rode:

```powershell
cd duckpull
.\scripts\start-windows.ps1
.\scripts\stop-windows.ps1
```

O script de `start`:

- cria `.env` se faltar
- roda `bun install`
- faz o build se `dist/` não existir
- sobe o serviço em segundo plano
- salva PID em `data/runtime/duckpull.pid`
- grava log em `data/runtime/duckpull.log`
- no Windows, erros também vão para `data/runtime/duckpull-error.log`

O script de `stop` encerra o processo salvo no PID file.

## Configuração

Depois de subir o serviço, abra:

```text
http://localhost:5767
```

Na tela inicial configure:

- `API base URL`
- `Token Bearer`
- `Pasta de destino`
- botão `Escolher...` para abrir o seletor nativo de pasta no sistema operacional
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

### Projeto único

```bash
cd duckpull
bun install
bun run dev
```

### UI em modo Vite

```bash
cd duckpull
bun run dev:web
```

### Build e execução local

```bash
cd duckpull
bun install
bun run build
bun start
```

## Observações

- O `duckpull` não altera `duckflow` nem `duckpad`.
- O contrato remoto do DuckFlow foi apenas documentado nesta V1.
- O servidor local serve a build estática do frontend quando `dist/` existir.
