# duckpull

Cliente leve de sincronização de artefatos do ecossistema Duck. Roda direto no seu computador — sem Docker — expõe uma interface web local e mantém arquivos `.duckdb` e `.parquet` publicados pelo DuckFlow sempre atualizados.

> Arquitetura detalhada em [`ARCHITECTURE.md`](ARCHITECTURE.md).

---

## Como funciona

1. Você configura a URL do servidor remoto (DuckFlow) e um token de acesso
2. O duckpull lista os artefatos disponíveis e você escolhe quais quer manter localmente
3. A sincronização roda automaticamente em segundo plano, no intervalo que você definir
4. Se um arquivo não mudou, ele não é baixado de novo

---

## Início rápido

**Linux**
```bash
chmod +x scripts/start-linux.sh
./scripts/start-linux.sh
```

**Windows**
```bat
scripts\start-windows.bat
```

Os scripts cuidam de tudo: instalam o Bun se necessário, fazem o build do frontend e sobem o serviço em segundo plano.

Depois, acesse:
```
http://localhost:5767
```

A senha inicial é `@trunks.`

---

## Configuração

Na tela inicial, preencha:

| Campo | Descrição |
|-------|-----------|
| API base URL | Endereço do servidor DuckFlow |
| Token Bearer | Chave de acesso à API remota |
| Pasta de destino | Onde os arquivos serão salvos localmente |
| Intervalo de sync | A cada quantos minutos verificar novidades |
| Sincronização automática | Liga/desliga o agendador |

O botão **Escolher...** abre o seletor de pasta nativo do sistema operacional.

Variáveis de ambiente disponíveis no `.env`:

```env
DUCKPULL_HOST=127.0.0.1
DUCKPULL_PORT=5767
DUCKPULL_DATA_DIR=./data/runtime
DUCKPULL_DOWNLOAD_TIMEOUT_MS=900000
DUCKPULL_STALL_TIMEOUT_MS=30000
```

---

## Autostart

**Linux** — via systemd do usuário:
```bash
./scripts/enable-autostart-linux.sh
./scripts/disable-autostart-linux.sh
```

**Windows** — via Agendador de Tarefas:
```bat
scripts\enable-autostart-windows.bat
scripts\disable-autostart-windows.bat
```

---

## Dados locais

| Caminho | Conteúdo |
|---------|----------|
| `data/runtime/duckpull.db` | Banco SQLite (configurações, histórico, estado dos artefatos) |
| `data/runtime/synced-artifacts/` | Arquivos baixados (pasta padrão, alterável na interface) |
| `data/runtime/duckpull.log` | Log do processo |

---

## Stack

- **Runtime:** [Bun](https://bun.sh)
- **Servidor:** [Elysia](https://elysiajs.com)
- **Interface:** Vue 3 + Vite
- **Banco:** SQLite via `bun:sqlite`

---

## Contrato da API remota

O duckpull espera os seguintes endpoints no servidor DuckFlow:

```
GET /artifacts              → lista artefatos disponíveis
GET /artifacts/:id/meta     → metadados (sha256, etag, tamanho)
GET /artifacts/:id/download → download em streaming
```

Detalhes completos em [`docs/duckflow-artifacts-api.md`](docs/duckflow-artifacts-api.md).