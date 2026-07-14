# Watcher: chờ crawler ghi đủ product roots trong snapshot mới nhất rồi force-import vào DB.
# Doanh thu gắn ngày = (tên thư mục snapshot) - 1, KHÔNG phụ thuộc thời điểm chạy import.
# Chạy: powershell -ExecutionPolicy Bypass -File D:\SetupC\Projects\google-ads-spy\scripts\watch-snapshot-complete.ps1
param(
  [string]$SnapDir = 'D:\SetupC\Tools\shophunter-crawler\snapshots',
  [int]$ExpectedRoots = 24,
  [int]$PollMinutes = 10,
  [int]$Port = 3141
)
$log = 'D:\SetupC\Projects\google-ads-spy\logs\snapshot-watcher.log'
function Log($m) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m" | Add-Content $log }

Log "watcher start (expect $ExpectedRoots product roots, poll ${PollMinutes}m, port $Port)"
while ($true) {
  $dir = Get-ChildItem $SnapDir -Directory | Where-Object Name -match '^\d{4}-\d{2}-\d{2}$' | Sort-Object Name -Descending | Select-Object -First 1
  if ($dir) {
    $count = (Get-ChildItem (Join-Path $dir.FullName 'products') -Filter '*_full.json' -ErrorAction SilentlyContinue | Measure-Object).Count
    Log "$($dir.Name): products_full=$count/$ExpectedRoots"
    if ($count -ge $ExpectedRoots) { break }
  } else { Log 'chua co thu muc snapshot dang ngay' }
  Start-Sleep -Seconds (60 * $PollMinutes)
}
Start-Sleep -Seconds 120  # de file cuoi ghi xong han

Log 'crawl du roots -> bat instance import'
$env:PORT = "$Port"; $env:SH_HARVEST_ENABLED = 'false'; $env:SH_HARVEST_MODE = ''; $env:SH_HARVEST_TYPE = ''
$p = Start-Process -FilePath 'E:\Programming\node.exe' -ArgumentList 'dist/main.js' -WorkingDirectory 'D:\SetupC\Projects\google-ads-spy\apps\api' `
  -RedirectStandardOutput "D:\SetupC\Projects\google-ads-spy\logs\$Port.out.log" -RedirectStandardError "D:\SetupC\Projects\google-ads-spy\logs\$Port.err.log" `
  -WindowStyle Hidden -PassThru
$ok = $false
foreach ($i in 1..60) { Start-Sleep 1; if ((Test-NetConnection 127.0.0.1 -Port $Port -WarningAction SilentlyContinue).TcpTestSucceeded) { $ok = $true; break } }
if (-not $ok) { Log "ERROR: instance $Port khong len"; exit 1 }
try {
  $r = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/sh/import/snapshot" -ContentType 'application/json' -Body '{"force":true}' -TimeoutSec 0
  Log ('import xong: ' + ($r | ConvertTo-Json -Depth 6 -Compress))
} catch { Log "ERROR import: $_" }
Stop-Process -Id $p.Id -Force -Confirm:$false
Log 'watcher xong, da tat instance'
