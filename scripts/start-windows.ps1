Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$RuntimeDir = Join-Path $Root "data\runtime"
$PidFile = Join-Path $RuntimeDir "duckpull.pid"
$StdoutLog = Join-Path $RuntimeDir "duckpull.log"
$StderrLog = Join-Path $RuntimeDir "duckpull-error.log"
$HostValue = "127.0.0.1"
$PortValue = "5767"
$BunInstall = if ($env:BUN_INSTALL) { $env:BUN_INSTALL } else { Join-Path $HOME ".bun" }

function Ensure-Bun {
    $bunCommand = Get-Command bun -ErrorAction SilentlyContinue
    if ($bunCommand) {
        return $bunCommand.Source
    }

    $bunCandidate = Join-Path $BunInstall "bin\bun.exe"
    if (Test-Path $bunCandidate) {
        $env:BUN_INSTALL = $BunInstall
        $env:Path = "$($BunInstall)\bin;$env:Path"
        return $bunCandidate
    }

    Write-Host "Bun não encontrado. Tentando instalar automaticamente..."

    if (Get-Command winget -ErrorAction SilentlyContinue) {
        winget install --id Oven-sh.Bun --exact --accept-source-agreements --accept-package-agreements | Out-Host
    }
    else {
        $InstallScript = Join-Path $env:TEMP "install-bun.ps1"
        Invoke-WebRequest -UseBasicParsing -Uri "https://bun.sh/install.ps1" -OutFile $InstallScript
        powershell -NoProfile -ExecutionPolicy Bypass -File $InstallScript | Out-Host
    }

    $env:BUN_INSTALL = $BunInstall
    $env:Path = "$($BunInstall)\bin;$env:Path"

    $bunCommand = Get-Command bun -ErrorAction SilentlyContinue
    if ($bunCommand) {
        return $bunCommand.Source
    }

    if (Test-Path $bunCandidate) {
        return $bunCandidate
    }

    throw "Falha ao instalar/configurar Bun automaticamente."
}
$BunExecutable = Ensure-Bun

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

$EnvFile = Join-Path $Root ".env"
if (-not (Test-Path $EnvFile)) {
    Copy-Item (Join-Path $Root ".env.example") $EnvFile
}

Get-Content $EnvFile -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_ -match '^DUCKPULL_HOST=(.+)$') {
        $HostValue = $Matches[1].Trim()
    }
    elseif ($_ -match '^DUCKPULL_PORT=(.+)$') {
        $PortValue = $Matches[1].Trim()
    }
}

if (-not $HostValue) {
    $HostValue = "127.0.0.1"
}

if (-not $PortValue) {
    $PortValue = "5767"
}

$ExistingPid = $null
if (Test-Path $PidFile) {
    $ExistingPid = (Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
    if ($ExistingPid) {
        $ExistingProcess = Get-Process -Id ([int]$ExistingPid) -ErrorAction SilentlyContinue
        if ($ExistingProcess) {
            Write-Host "duckpull já está em execução (PID $ExistingPid)."
            exit 0
        }
    }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

$FrontendDist = Join-Path $Root "dist\index.html"
Push-Location $Root
& $BunExecutable install

if (-not (Test-Path $FrontendDist)) {
    Write-Host "Build do frontend não encontrado. Executando build..."
    & $BunExecutable run build
}

$Process = Start-Process -FilePath $BunExecutable -ArgumentList "start" -WorkingDirectory $Root -RedirectStandardOutput $StdoutLog -RedirectStandardError $StderrLog -PassThru
$Process.Id | Set-Content $PidFile
Pop-Location

Start-Sleep -Seconds 1
if (Get-Process -Id $Process.Id -ErrorAction SilentlyContinue) {
    Write-Host "duckpull iniciado em segundo plano (PID $($Process.Id))."
    Write-Host "URL: http://$HostValue`:$PortValue"
    Write-Host "Logs: $StdoutLog e $StderrLog"
}
else {
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    Write-Host "duckpull falhou ao iniciar. Verifique $StdoutLog e $StderrLog"
    exit 1
}
