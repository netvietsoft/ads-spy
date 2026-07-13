# Dựng lại stack ShopHunter clone sau reboot: build API rồi bật 5 instance + web.
# Chạy: powershell -ExecutionPolicy Bypass -File D:\SetupC\Projects\google-ads-spy\start-stack.ps1
# YÊU CẦU: MySQL (127.0.0.1:3306) đã chạy trước (Laragon / mysqld).

$root = 'D:\SetupC\Projects\google-ads-spy'
$api  = Join-Path $root 'apps\api'
$web  = Join-Path $root 'apps\web'
$node = 'E:\Programming\node.exe'
$logs = Join-Path $root 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null

Write-Host '=== Build API (nạp code đã commit) ==='
Push-Location $root
& npm run build --workspace apps/api
Pop-Location

function Start-Api($port, $mode, $type) {
  $env:PORT = "$port"
  $env:SH_HARVEST_ENABLED = 'true'
  $env:SH_HARVEST_MODE = $mode
  $env:SH_HARVEST_TYPE = $type   # rỗng với import/revsync (bị bỏ qua)
  Start-Process -FilePath $node -ArgumentList 'dist/main.js' -WorkingDirectory $api `
    -RedirectStandardOutput (Join-Path $logs "$port.out.log") -RedirectStandardError (Join-Path $logs "$port.err.log") -WindowStyle Hidden
  Write-Host "  started :$port ($mode $type)"
  Start-Sleep -Seconds 3   # tránh đua ensureReady/DDL cùng lúc lần đầu
}

Write-Host '=== Bật 5 instance ==='
Start-Api 3100 'deep' 'shops'
Start-Api 3110 'deep' 'products'
Start-Api 3120 'import' ''
Start-Api 3130 'revsync' ''

# Web (Next dev :3101) — cwd apps\web
Start-Process -FilePath 'cmd' -ArgumentList '/c npm run dev' -WorkingDirectory $web -WindowStyle Minimized
Write-Host '  started :3101 (web)'

Write-Host '=== XONG. Web: http://localhost:3101  |  log: logs\<port>.out.log ==='
