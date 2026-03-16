Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$TaskName = "duckpull"

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Autostart do duckpull desabilitado."
}
else {
    Write-Host "Nenhuma tarefa de autostart do duckpull encontrada."
}
