# stop.ps1 — Stop ProjectFlow infrastructure containers.
# Run from the repo root:  .\stop.ps1
#
# This stops SQL Server, Redis, and MinIO. The 'sqldata' Docker volume is
# preserved by default so your database survives the restart.
# Pass -Wipe to also remove the SQL data volume (fresh DB next time).

#requires -Version 5.0
[CmdletBinding()]
param(
    [switch]$Wipe
)

$ErrorActionPreference = 'Stop'

if ($Wipe) {
    Write-Host '==> Stopping containers AND removing the sqldata volume...' -ForegroundColor Yellow
    docker compose down -v
} else {
    Write-Host '==> Stopping containers (sqldata volume preserved)...' -ForegroundColor Cyan
    docker compose down
}

if ($LASTEXITCODE -eq 0) {
    Write-Host '    Done.' -ForegroundColor Green
    if (-not $Wipe) {
        Write-Host '    Tip: to wipe the database too, run: .\stop.ps1 -Wipe' -ForegroundColor Gray
    }
} else {
    Write-Host 'ERROR: docker compose down exited non-zero. Check Docker Desktop.' -ForegroundColor Red
    exit 1
}

# Heads-up if the dev server might still be running
$apiPort = (Get-NetTCPConnection -State Listen -LocalPort 3001 -ErrorAction SilentlyContinue) -ne $null
$webPort = (Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue) -ne $null
if ($apiPort -or $webPort) {
    Write-Host ''
    Write-Host 'Note: a dev server still appears to be listening:' -ForegroundColor Yellow
    if ($webPort) { Write-Host '  - Web on :3000' -ForegroundColor Yellow }
    if ($apiPort) { Write-Host '  - API on :3001' -ForegroundColor Yellow }
    Write-Host 'Press Ctrl+C in that terminal, or close the window, to stop it.' -ForegroundColor Yellow
}
