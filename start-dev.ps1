# NexusSMM Local Dev Starter
# Run this from c:\smm\nexussmm in PowerShell

Write-Host "================================" -ForegroundColor Cyan
Write-Host "  NexusSMM — Local Dev Startup  " -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan

# 1. Load .env
$envFile = "$PSScriptRoot\.env"
if (!(Test-Path $envFile)) {
  Write-Host "ERROR: .env file not found. Copy .env.example to .env and fill it in." -ForegroundColor Red
  exit 1
}
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^([^#\s][^=]*)=(.*)$') {
    [System.Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim(), "Process")
  }
}
Write-Host "✅ .env loaded" -ForegroundColor Green

# 2. Check Redis
function Test-Port { param($p); try { $t=New-Object System.Net.Sockets.TcpClient; $t.Connect("127.0.0.1",$p); $t.Close(); $true } catch { $false } }

if (!(Test-Port 6379)) {
  $redisExe = "C:\smm\redis\redis-server.exe"
  if (Test-Path $redisExe) {
    Write-Host "Starting Redis..." -ForegroundColor Yellow
    Start-Process -FilePath $redisExe -WindowStyle Minimized
    Start-Sleep 2
    if (Test-Port 6379) { Write-Host "✅ Redis started on 6379" -ForegroundColor Green }
    else { Write-Host "⚠️  Redis failed to start. Start it manually." -ForegroundColor Red }
  } else {
    Write-Host "⚠️  Redis not found at C:\smm\redis\redis-server.exe" -ForegroundColor Red
    Write-Host "   Download from: https://github.com/tporadowski/redis/releases" -ForegroundColor Yellow
  }
} else {
  Write-Host "✅ Redis already running on 6379" -ForegroundColor Green
}

# 3. Check PostgreSQL
if (Test-Port 5432) {
  Write-Host "✅ PostgreSQL running on 5432" -ForegroundColor Green
} else {
  Write-Host "⚠️  PostgreSQL not running on 5432. Start it from Services or pgAdmin." -ForegroundColor Red
}

# 4. Instructions
Write-Host ""
Write-Host "Now open THREE terminal windows and run:" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Terminal 1 (API server):" -ForegroundColor White
Write-Host "    cd c:\smm\nexussmm" -ForegroundColor Gray
Write-Host "    node `"$env:APPDATA\npm\node_modules\pnpm\bin\pnpm.cjs`" --filter @nexussmm/api dev" -ForegroundColor Gray
Write-Host ""
Write-Host "  Terminal 2 (BullMQ workers):" -ForegroundColor White
Write-Host "    cd c:\smm\nexussmm" -ForegroundColor Gray
Write-Host "    node `"$env:APPDATA\npm\node_modules\pnpm\bin\pnpm.cjs`" --filter @nexussmm/api dev:worker" -ForegroundColor Gray
Write-Host ""
Write-Host "  Terminal 3 (Next.js frontend):" -ForegroundColor White
Write-Host "    cd c:\smm\nexussmm" -ForegroundColor Gray
Write-Host "    node `"$env:APPDATA\npm\node_modules\pnpm\bin\pnpm.cjs`" --filter @nexussmm/web dev" -ForegroundColor Gray
Write-Host ""
Write-Host "  Then open: http://localhost:3000" -ForegroundColor Cyan
Write-Host "  Admin:     admin@nexussmm.com / Admin@123456" -ForegroundColor Cyan
Write-Host ""
