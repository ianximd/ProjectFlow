# start.ps1 — Start ProjectFlow: containers, wait for readiness, then dev servers.
# Run from the repo root:  .\start.ps1

#requires -Version 5.0
$ErrorActionPreference = 'Stop'

function Write-Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    $msg" -ForegroundColor Green }
function Write-Err($msg)  { Write-Host "ERROR: $msg" -ForegroundColor Red }

# 1. Verify Docker is running
Write-Step 'Checking Docker...'
docker info --format '{{.ServerVersion}}' *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Err 'Docker is not running. Start Docker Desktop and try again.'
    exit 1
}
Write-Ok 'Docker is running'

# 2. Start containers
Write-Step 'Starting containers (SQL Server, Redis, MinIO)...'
docker compose up -d
if ($LASTEXITCODE -ne 0) { Write-Err 'docker compose up failed'; exit 1 }

# 3. Wait for Redis
Write-Step 'Waiting for Redis...'
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    $pong = docker compose exec -T redis redis-cli ping 2>$null
    if ($pong -match 'PONG') { $ready = $true; break }
    Start-Sleep -Seconds 1
}
if (-not $ready) { Write-Err "Redis didn't respond in 30s"; exit 1 }
Write-Ok 'Redis ready'

# 4. Wait for SQL Server (cold start can take ~30s)
Write-Step 'Waiting for SQL Server (cold starts can take ~30s)...'
$sa_password = if ($env:DB_PASSWORD) { $env:DB_PASSWORD } else { 'YourStrong@Passw0rd' }
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
    docker compose exec -T sqlserver /opt/mssql-tools18/bin/sqlcmd `
        -S localhost -U sa -P $sa_password -C -Q 'SELECT 1' *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
}
if (-not $ready) { Write-Err "SQL Server didn't respond in 60s"; exit 1 }
Write-Ok 'SQL Server ready'

# 5. Ensure the ProjectFlow database exists
Write-Step 'Ensuring ProjectFlow database exists...'
docker compose exec -T sqlserver /opt/mssql-tools18/bin/sqlcmd `
    -S localhost -U sa -P $sa_password -C `
    -Q "IF DB_ID('ProjectFlow') IS NULL CREATE DATABASE ProjectFlow" *> $null
if ($LASTEXITCODE -ne 0) { Write-Err 'Could not create/verify the ProjectFlow database'; exit 1 }
Write-Ok 'Database OK'

# 6. Show URLs
Write-Host ''
Write-Host 'ProjectFlow services:' -ForegroundColor Green
Write-Host '  Web          : http://localhost:3000' -ForegroundColor White
Write-Host '  API          : http://localhost:3001' -ForegroundColor White
Write-Host '  GraphQL      : http://localhost:3001/api/v1/graphql' -ForegroundColor White
Write-Host '  MinIO Console: http://localhost:9001  (minioadmin / minioadmin)' -ForegroundColor White
Write-Host ''
Write-Host 'Tip: first-time setup needs migrations + stored procs:' -ForegroundColor Yellow
Write-Host '       npm run db:migrate' -ForegroundColor Yellow
Write-Host '       npm run db:deploy-sps' -ForegroundColor Yellow
Write-Host ''
Write-Host 'Press Ctrl+C to stop the dev servers, then run .\stop.ps1 to stop containers.' -ForegroundColor Yellow
Write-Host ''

# 7. Run the dev servers (foreground — Ctrl+C returns control)
npm run dev
