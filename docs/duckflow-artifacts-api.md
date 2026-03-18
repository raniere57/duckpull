# Contrato da API remota do DuckFlow

O `duckpull` assume um contrato HTTP simples para descobrir artefatos publicados e fazer download seguro.

---

## Autenticação

Todas as requisições devem incluir o header:

```
Authorization: Bearer <token>
```

---

## Endpoints

### `GET /artifacts`

Lista os artefatos disponíveis para consumo.

**Resposta esperada:**

```json
{
  "artifacts": [
    {
      "id": "views",
      "name": "views",
      "filename": "views.duckdb",
      "type": "duckdb",
      "size_bytes": 1024000,
      "sha256": "3f0e...",
      "etag": "\"views-20260316\"",
      "updated_at": "2026-03-16T11:20:00Z",
      "download_url": "/artifacts/views/download"
    }
  ]
}
```

**Campos obrigatórios:**

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | string | Identificador único do artefato |
| `name` | string | Nome legível |
| `filename` | string | Nome do arquivo com extensão |
| `type` | string | Tipo do artefato (`duckdb`, `parquet`) |
| `download_url` | string | URL de download (absoluta ou relativa) |

**Campos recomendados:**

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `size_bytes` | integer | Tamanho do arquivo em bytes |
| `sha256` | string | Hash SHA-256 do arquivo final publicado |
| `etag` | string | ETag para detecção de mudança |
| `updated_at` | string (ISO 8601) | Data da última atualização |

---

### `GET /artifacts/:id/meta`

Retorna somente os metadados de um artefato. Usado pelo duckpull para verificar se o arquivo local está desatualizado antes de iniciar um download.

Mesma estrutura de campos do item em `GET /artifacts`.

---

### `GET /artifacts/:id/download`

Retorna o conteúdo binário do arquivo.

**Headers recomendados na resposta:**

| Header | Descrição |
|--------|-----------|
| `Content-Type` | Tipo MIME do arquivo |
| `Content-Length` | Tamanho em bytes (permite cálculo de progresso) |
| `ETag` | Identificador da versão do arquivo |
| `Last-Modified` | Data da última modificação |
| `Content-Disposition` | Ex: `attachment; filename="views.duckdb"` |

O duckpull suporta download em streaming — não é necessário carregar o arquivo inteiro em memória no servidor antes de responder.

---

## Comportamento esperado

- `GET /artifacts` deve listar apenas artefatos publicados e prontos para distribuição.
- O campo `sha256` deve refletir o hash do arquivo **final publicado** (não de versões intermediárias).
- `download_url` pode ser absoluto (`https://...`) ou relativo ao `base_url` configurado.
- Manter `ETag` e `Last-Modified` coerentes facilita a detecção de mudança e evita downloads desnecessários.
- Downloads devem permitir streaming (resposta incremental, não buffered).

---

## Detecção de mudança

O duckpull considera que um artefato precisa ser baixado novamente se qualquer uma das condições abaixo for verdadeira:

- O arquivo local não existe
- `sha256` remoto difere do registrado no último sync
- `etag` remoto difere do registrado no último sync
- `updated_at` remoto difere do registrado no último sync

Se nenhum desses campos estiver disponível na resposta, o duckpull sempre fará o download.

---

## Endpoints opcionais (futuro)

Não implementados no duckpull v1, mas previstos para versões futuras:

```
GET /artifacts/changes?since=<timestamp>   → artefatos modificados após uma data
GET /artifacts/:id/history                 → histórico de versões
SSE /artifacts/events                      → notificações em tempo real
```