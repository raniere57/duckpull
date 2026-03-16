# Contrato esperado da API remota do DuckFlow

O `duckpull` assume um contrato HTTP simples para descobrir artefatos publicados e fazer download seguro.

## Autenticação

- `Authorization: Bearer <token>`

## Endpoints

### `GET /artifacts`

Lista os artefatos disponíveis para consumo.

Resposta esperada:

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

Campos mínimos:

- `id`
- `name`
- `filename`
- `type`
- `download_url`

Campos recomendados:

- `size_bytes`
- `sha256`
- `etag`
- `updated_at`

### `GET /artifacts/:id/meta`

Retorna somente os metadados de um artefato.

### `GET /artifacts/:id/download`

Retorna o conteúdo binário do arquivo.

Headers recomendados:

- `Content-Type`
- `Content-Length`
- `ETag`
- `Last-Modified`
- `Content-Disposition: attachment; filename="views.duckdb"`

## Comportamento recomendado no DuckFlow

- `GET /artifacts` deve listar apenas artefatos publicados para distribuição.
- Downloads devem permitir streaming.
- `sha256` deve refletir o arquivo final publicado.
- `download_url` pode ser absoluto ou relativo.
- Se possível, manter `ETag` e `Last-Modified` coerentes para facilitar detecção de mudança.

## Opcional futuro

- `GET /artifacts/changes?since=...`
- `GET /artifacts/:id/history`
- `SSE /artifacts/events`

O `duckpull` V1 não depende desses endpoints opcionais.
