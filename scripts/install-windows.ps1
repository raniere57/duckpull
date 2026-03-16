Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Host "Bun não encontrado no PATH. Instale o Bun e rode este script novamente."
    exit 1
}

New-Item -ItemType Directory -Force -Path (Join-Path $Root "data\runtime") | Out-Null

$EnvFile = Join-Path $Root ".env"
if (-not (Test-Path $EnvFile)) {
    Copy-Item (Join-Path $Root ".env.example") $EnvFile
}

Push-Location (Join-Path $Root "backend")
bun install
Pop-Location

Push-Location (Join-Path $Root "frontend")
bun install
bun run build
Pop-Location

Write-Host "duckpull instalado."
Write-Host "Edite $EnvFile se necessário e execute scripts\start-windows.ps1"
