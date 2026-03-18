# Arquitetura do duckpull

## Visão geral

O `duckpull` é um cliente local do ecossistema Duck responsável por sincronizar artefatos publicados pelo `duckflow` para uma pasta local do usuário. A aplicação roda sem Docker, expõe uma interface web local, mantém estado operacional em banco SQLite e executa sincronizações manuais ou automáticas de arquivos como `.duckdb` e `.parquet`.

A arquitetura foi desenhada para resolver a distribuição local desses artefatos sem depender de SMB, Syncthing ou FTP, mantendo configuração simples, operação local e controle sobre autenticação, seleção dos artefatos e histórico de sincronização.

## Objetivos da arquitetura

- disponibilizar uma interface local simples para configuração e operação
- consumir uma API remota do `duckflow` via HTTP com Bearer token
- listar artefatos remotos disponíveis para sincronização
- permitir seleção individual dos artefatos mantidos localmente
- executar downloads com segurança operacional
- persistir configurações, estado e logs localmente
- suportar sincronização manual e automática
- funcionar em Windows e Linux, com integração local para seleção e abertura de diretórios

## Stack

- **Backend local:** Bun + Elysia
- **Frontend local:** Vue 3 + Vite
- **Banco local:** SQLite via `bun:sqlite`
- **Execução:** processo local sem Docker
- **Porta padrão:** `127.0.0.1:5767`

## Topologia geral

```mermaid
flowchart TD
    U[Usuario] --> UI[Frontend local]
    UI --> API[Servidor local]

    API --> AUTH[Autenticacao]
    API --> DB[SQLite local]
    API --> SYNC[Sync Manager]
    API --> PICKER[Integracao com SO]

    SYNC --> REMOTE[DuckFlow remoto]
    SYNC --> FILES[Pasta local sincronizada]

    DB --> CFG[Configuracoes]
    DB --> ART[Catalogo de artefatos]
    DB --> STATE[Estado de sincronizacao]
    DB --> LOGS[Logs operacionais]
Camadas da aplicação
1. Apresentação
A camada de apresentação é composta pela interface Vue servida localmente. Ela concentra:
login
configuração da conexão remota
definição da pasta de destino
teste de conexão
listagem e seleção de artefatos
disparo de sincronização
visualização de status e logs
Essa camada é responsável pela experiência do usuário e pela comunicação com a API local.
2. API local
A API local centraliza a lógica de entrada da aplicação. Ela:
valida autenticação
expõe endpoints de configuração e operação
interage com o banco local
consulta a API remota do duckflow
aciona o gerenciador de sincronização
expõe status e logs
serve a build estática do frontend quando disponível
3. Domínio de sincronização
A lógica de sincronização fica concentrada em módulos próprios do backend, que tratam:
leitura de configurações
descoberta de artefatos remotos
orquestração de sincronizações
controle de concorrência
atualização de progresso
persistência de estado
tratamento de falhas e reexecução
4. Persistência local
Toda a persistência operacional é local, usando SQLite. O banco guarda:
configurações da aplicação
origem remota
catálogo de artefatos conhecidos
estado de sincronização por artefato
histórico de logs
5. Integrações externas
O sistema depende de:
API remota do duckflow
sistema operacional local para seleção e abertura de diretórios
filesystem local para armazenamento dos arquivos sincronizados
Topologia por camadas
flowchart LR
    subgraph APRESENTACAO
        UI[Vue UI]
    end

    subgraph BACKEND_LOCAL
        API[Elysia API]
        AUTH[Auth]
        REMOTE_API[Remote API Client]
        SYNC[Sync Manager]
        PICKER[Folder Picker]
    end

    subgraph PERSISTENCIA
        DB[SQLite]
    end

    subgraph EXTERNO
        DF[DuckFlow remoto]
        FS[Pasta local sincronizada]
        OS[Sistema operacional]
    end

    UI --> API
    API --> AUTH
    API --> REMOTE_API
    API --> SYNC
    API --> PICKER
    API --> DB
    REMOTE_API --> DF
    SYNC --> REMOTE_API
    SYNC --> FS
    PICKER --> OS
Estrutura do projeto
duckpull/
├── docs/
│   └── duckflow-artifacts-api.md
├── scripts/
│   ├── start-linux.sh
│   ├── stop-linux.sh
│   ├── start-windows.bat
│   ├── start-windows.ps1
│   ├── stop-windows.bat
│   ├── stop-windows.ps1
│   ├── enable-autostart-linux.sh
│   ├── disable-autostart-linux.sh
│   ├── enable-autostart-windows.bat
│   ├── enable-autostart-windows.ps1
│   ├── disable-autostart-windows.bat
│   └── disable-autostart-windows.ps1
├── src/
│   ├── client/
│   │   ├── App.vue
│   │   ├── main.js
│   │   └── index.css
│   └── server/
│       ├── auth.js
│       ├── config.js
│       ├── db.js
│       ├── folder-picker.js
│       ├── index.js
│       ├── remote-api.js
│       └── sync-manager.js
├── .env.example
├── index.html
├── package.json
└── vite.config.js
Componentes principais
Frontend local
O frontend é inicializado em src/client/main.js e usa App.vue como componente principal. Ele representa a interface operacional do duckpull, incluindo:
fluxo de autenticação
configuração do endpoint remoto e token
configuração da pasta de destino
listagem de artefatos
seleção do que deve ser sincronizado
acompanhamento do estado de execução
consulta de logs
A build do frontend é gerada com Vite e publicada em dist/. Quando essa build existe, o backend passa a servi-la localmente.
Backend local
O servidor local é definido em src/server/index.js e usa Elysia para expor a API da aplicação. Ele é o ponto central da arquitetura e executa as seguintes responsabilidades:
inicializa o banco local
recupera estados interrompidos na inicialização
ativa o agendamento automático quando permitido
protege rotas privadas por autenticação
expõe endpoints REST para o frontend
integra banco, cliente remoto e sincronização
serve o frontend compilado
Autenticação
A autenticação é local e baseada em cookie assinado. O backend usa:
cookie duckpull_session
assinatura HMAC SHA-256
HttpOnly
SameSite=Strict
expiração de 12 horas
A senha da interface é validada contra um hash persistido no banco local. O segredo de sessão também é persistido localmente.
Banco local
O banco SQLite é inicializado em src/server/db.js e utiliza:
journal_mode = WAL
foreign_keys = ON
busy_timeout = 5000
O banco mantém a persistência necessária para operação contínua mesmo após reinicializações do processo.
Sync Manager
O sync-manager é o núcleo operacional da sincronização. Ele é responsável por:
receber solicitações de sincronização
coordenar sincronização manual e automática
evitar concorrência entre execuções
acompanhar progresso
atualizar o estado dos artefatos
registrar eventos em log
recuperar execuções interrompidas
limpar arquivos temporários órfãos
Cliente da API remota
O módulo remote-api.js implementa a comunicação com o duckflow. Entre suas responsabilidades estão:
montar URLs remotas
enviar Bearer token quando configurado
listar artefatos
ler metadados de artefatos
baixar arquivos com streaming
controlar timeout total
detectar stall de download
normalizar a estrutura dos artefatos recebidos
Integração com sistema operacional
O módulo folder-picker.js abstrai a escolha e abertura da pasta de destino.
Suporte implementado:
macOS: osascript e open
Linux: zenity, kdialog e xdg-open
Windows: PowerShell, FolderBrowserDialog e explorer.exe
Essa integração permite que a aplicação tenha comportamento mais natural para o usuário em cada plataforma.
Modelo de dados local
Tabela app_config
Armazena configurações gerais da aplicação, como:
diretório de destino
intervalo de sincronização
sincronização automática habilitada
hash da senha local
segredo da sessão
Tabela remote_sources
Armazena a configuração da origem remota, incluindo:
nome da origem
base_url
token de autenticação
status de habilitação
A versão atual mantém uma origem principal fixa com id = 1.
Tabela artifacts
Mantém o catálogo de artefatos conhecidos pelo sistema:
identificador do artefato
nome
nome do arquivo
tipo
tamanho
hash
etag
data de atualização remota
URL de download
seleção para sincronização
Tabela artifact_sync_state
Guarda o estado operacional de sincronização por artefato:
status atual
caminho local
última sincronização
último check
tamanho local
bytes baixados
bytes totais
progresso
duração da última sincronização
último erro
metadados remotos associados
Tabela sync_logs
Mantém os logs operacionais da aplicação, incluindo:
nível do log
mensagem
artefato relacionado, quando houver
timestamp
Fluxo principal de autenticação
sequenceDiagram
    participant U as Usuario
    participant UI as Frontend
    participant API as API local
    participant DB as SQLite

    U->>UI: Informa senha
    UI->>API: POST /api/auth/login
    API->>DB: Le hash da senha
    API-->>UI: Define cookie de sessao
    UI->>API: GET /api/auth/status
    API-->>UI: Retorna authenticated true
Fluxo principal de descoberta de artefatos
sequenceDiagram
    participant UI as Frontend
    participant API as API local
    participant REM as DuckFlow remoto
    participant DB as SQLite

    UI->>API: GET /api/remote-artifacts
    API->>REM: GET /artifacts
    REM-->>API: Lista de artefatos
    API->>DB: Atualiza catalogo local
    API-->>UI: Retorna artefatos com estado local
Fluxo principal de sincronização
sequenceDiagram
    participant UI as Frontend
    participant API as API local
    participant SYNC as Sync Manager
    participant REM as DuckFlow remoto
    participant FS as Arquivos locais
    participant DB as SQLite

    UI->>API: POST /api/sync
    API->>SYNC: Solicita sincronizacao
    SYNC->>REM: Consulta metadados e download
    REM-->>SYNC: Arquivo remoto
    SYNC->>FS: Escreve arquivo temporario
    SYNC->>FS: Promove para arquivo final
    SYNC->>DB: Atualiza estado e logs
    API-->>UI: Retorna status
Segurança operacional do download
O download foi desenhado para reduzir risco de corrupção de arquivo local. O fluxo operacional segue a lógica abaixo:
o arquivo é baixado para um caminho temporário
o progresso é acompanhado durante a transferência
o checksum pode ser validado quando disponível
o arquivo final é substituído de forma controlada
em caso de falha, o sistema preserva rollback do original quando aplicável
Esse desenho também permite identificar downloads interrompidos e limpar resíduos temporários.
Resiliência operacional
A arquitetura inclui mecanismos para melhorar robustez em ambiente real:
timeout total de download
timeout para download parado
tentativas automáticas com backoff
limpeza de arquivos .tmp e .bak órfãos
fila simples para evitar sincronizações concorrentes
recuperação de estados interrompidos na inicialização
autostart opcional em Windows e Linux
Configuração
A aplicação usa variáveis de ambiente simples:
DUCKPULL_HOST=127.0.0.1
DUCKPULL_PORT=5767
DUCKPULL_DATA_DIR=./data/runtime
Também existem opções operacionais adicionais para timeout e retry:
DUCKPULL_DOWNLOAD_TIMEOUT_MS=900000
DUCKPULL_STALL_TIMEOUT_MS=30000
DUCKPULL_RETRY_COUNT=3
DUCKPULL_RETRY_BACKOFF_MS=2000
Diretórios e arquivos gerados em runtime
Por padrão, a aplicação usa um diretório de runtime local para armazenar estado e operação.
Estrutura típica:
data/runtime/
├── duckpull.db
├── duckpull.pid
├── duckpull.log
├── duckpull-error.log
└── synced-artifacts/
O diretório de artefatos sincronizados pode ser alterado pela interface.
API local
A API local exposta pelo backend inclui os seguintes endpoints principais:
GET /api/health
GET /api/auth/status
POST /api/auth/login
GET /api/settings
PUT /api/settings
POST /api/test-connection
GET /api/remote-artifacts
PUT /api/artifacts/:id
POST /api/sync
GET /api/sync/status
GET /api/logs
As rotas públicas são restritas ao health check e autenticação inicial. As demais exigem sessão válida.
Contrato esperado do DuckFlow
O duckpull espera que o duckflow exponha uma API HTTP simples para:
listar artefatos em GET /artifacts
retornar metadados em GET /artifacts/:id/meta
fornecer download em GET /artifacts/:id/download
Os artefatos esperados incluem, no mínimo:
id
name
filename
type
download_url
Campos adicionais como size_bytes, sha256, etag e updated_at melhoram a operação de sincronização.
Execução local
Desenvolvimento
bun install
bun run dev
Frontend em modo Vite
bun run dev:web
Build e execução local
bun install
bun run build
bun start
Operação em Linux e Windows
A aplicação inclui scripts próprios de operação para ambos os sistemas, com suporte a:
inicialização
parada
habilitação de autostart
desabilitação de autostart
Linux
O autostart é feito via systemd --user.
Windows
O autostart é feito via Agendador de Tarefas.
Os scripts também tentam preparar o ambiente automaticamente, incluindo instalação do Bun quando necessário.
Considerações arquiteturais
A arquitetura do duckpull prioriza simplicidade operacional, autonomia local e baixo acoplamento com a infraestrutura do cliente. Em vez de depender de compartilhamento de rede ou replicação de arquivos por ferramentas externas, o sistema centraliza a distribuição dos artefatos em uma aplicação local, com controle explícito de autenticação, sincronização, observabilidade e destino dos arquivos.
Esse desenho favorece:
instalação simples
uso por analistas e operadores sem fluxo manual complexo
rastreabilidade da sincronização
tolerância a falhas de rede e interrupções
desacoplamento entre publicação remota e consumo local
Evoluções futuras possíveis
Algumas evoluções naturais para a arquitetura incluem:
múltiplas origens remotas
histórico de versões por artefato
sincronização por eventos
detecção incremental de mudanças
métricas operacionais mais detalhadas
notificações de erro e sucesso
controle de usuários além da senha local única