Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$PidFile = Join-Path $Root "data\runtime\duckpull.pid"

if (-not (Test-Path $PidFile)) {
    Write-Host "duckpull não está em execução."
    exit 0
}

$PidValue = (Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
if (-not $PidValue) {
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    Write-Host "PID inválido removido."
    exit 0
}

$Process = Get-Process -Id ([int]$PidValue) -ErrorAction SilentlyContinue
if ($Process) {
    Stop-Process -Id ([int]$PidValue) -Force
    Write-Host "duckpull interrompido."
}
else {
    Write-Host "Processo não estava mais ativo."
}

Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
