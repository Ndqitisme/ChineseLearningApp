<#
.SYNOPSIS
  Samples CPU and memory of the running app ("TieuMai - Chinese Learning.exe") plus every
  msedgewebview2.exe that WebView2 started for it (they carry --webview-exe-name=<app exe>).
.EXAMPLE
  powershell -File tools/perf/measure.ps1 -Seconds 600 -Csv .cache/perf.csv
#>
param([int]$Seconds = 60, [string]$Csv = "", [string]$AppName = "TieuMai - Chinese Learning")

$cores = [Environment]::ProcessorCount
$webviewArg = '--webview-exe-name="?' + [regex]::Escape("$AppName.exe")
function Get-AppProcesses {
  $ids = @(Get-Process -Name $AppName -ErrorAction SilentlyContinue | ForEach-Object Id)
  $wv = Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" |
    Where-Object { $_.CommandLine -match $webviewArg } | ForEach-Object ProcessId
  @($ids + $wv) | ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }
}

$procs = Get-AppProcesses
if (-not $procs) { Write-Error "$AppName is not running"; exit 1 }
$prevCpu = @{}; foreach ($p in $procs) { $prevCpu[$p.Id] = $p.TotalProcessorTime.TotalMilliseconds }
$rows = @()
$sw = [Diagnostics.Stopwatch]::StartNew()
for ($i = 0; $i -lt $Seconds; $i++) {
  Start-Sleep -Milliseconds 1000
  $elapsed = $sw.Elapsed.TotalMilliseconds; $sw.Restart()
  $procs = Get-AppProcesses
  $cpuMs = 0; $private = 0; $ws = 0
  foreach ($p in $procs) {
    $now = $p.TotalProcessorTime.TotalMilliseconds
    if ($prevCpu.ContainsKey($p.Id)) { $cpuMs += $now - $prevCpu[$p.Id] }
    $prevCpu[$p.Id] = $now
    $private += $p.PrivateMemorySize64; $ws += $p.WorkingSet64
  }
  $rows += [pscustomobject]@{
    t = $i + 1; processes = $procs.Count
    cpuPctOfMachine = [math]::Round(100 * $cpuMs / ($elapsed * $cores), 2)
    privateMB = [math]::Round($private / 1MB, 1); workingSetMB = [math]::Round($ws / 1MB, 1)
  }
}
if ($Csv) { $rows | Export-Csv -NoTypeInformation -Path $Csv }
$cpu = $rows | Measure-Object cpuPctOfMachine -Average -Maximum
$sorted = $rows.cpuPctOfMachine | Sort-Object
$p95 = $sorted[[math]::Min($sorted.Count - 1, [math]::Floor($sorted.Count * 0.95))]
$mem = $rows | Measure-Object privateMB -Average -Maximum
$wsm = $rows | Measure-Object workingSetMB -Average
"processes: $($rows[-1].processes)  samples: $($rows.Count)  cores: $cores"
"CPU % of whole machine: avg {0:N2}  p95 {1:N2}  max {2:N2}" -f $cpu.Average, $p95, $cpu.Maximum
"Private memory MB: avg {0:N1}  max {1:N1}   Working set MB: avg {2:N1}" -f $mem.Average, $mem.Maximum, $wsm.Average
