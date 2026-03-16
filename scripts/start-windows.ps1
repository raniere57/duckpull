Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Host "Bun não encontrado no PATH."
    exit 1
}

$FrontendDist = Join-Path $Root "frontend\dist\index.html"
if (-not (Test-Path $FrontendDist)) {
    Write-Host "Build do frontend não encontrado. Executando build..."
    Push-Location (Join-Path $Root "frontend")
    bun install
    bun run build
    Pop-Location
}

Push-Location (Join-Path $Root "backend")
bun install
bun index.js
Pop-Location
