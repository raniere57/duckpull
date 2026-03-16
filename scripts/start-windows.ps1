Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Host "Bun não encontrado no PATH."
    exit 1
}

$FrontendDist = Join-Path $Root "dist\index.html"
if (-not (Test-Path $FrontendDist)) {
    Write-Host "Build do frontend não encontrado. Executando build..."
    Push-Location $Root
    bun install
    bun run build
    Pop-Location
}

Push-Location $Root
bun install
bun start
Pop-Location
