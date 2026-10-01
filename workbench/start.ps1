param(
    [ValidateRange(1, 65535)][int]$Port = 8765,
    [switch]$BuildExperiments
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$projectPython = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $projectPython)) {
    throw 'Project Python is missing. Create .venv and install requirements.txt first.'
}
if ($BuildExperiments) {
    & $projectPython -B (Join-Path $projectRoot 'frontend\case_browser\build.py')
    if ($LASTEXITCODE -ne 0) { throw 'Experiment build failed; inspect the build output above.' }
}

$workbenchUrl = 'http://127.0.0.1:' + $Port
function Test-Workbench {
    try {
        $evidenceResponse = Invoke-WebRequest -UseBasicParsing -Uri ($workbenchUrl + '/') -TimeoutSec 3
        $experimentResponse = Invoke-WebRequest -UseBasicParsing -Uri ($workbenchUrl + '/experiments/') -TimeoutSec 3
        return ($evidenceResponse.StatusCode -eq 200 -and $experimentResponse.StatusCode -eq 200 -and
            $evidenceResponse.Content -match 'ProDebugger' -and $experimentResponse.Content -match 'ProDebugger')
    } catch { return $false }
}

if (Test-Workbench) {
    Write-Output 'Workbench is already running; both views returned HTTP 200.'
} else {
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($listener) { throw "Port $Port is occupied by another or unhealthy service. Use -Port with a free port." }
    $logRoot = Join-Path $projectRoot 'artifacts\workbench'
    [void](New-Item -ItemType Directory -Path $logRoot -Force)
    $serverScript = Join-Path $projectRoot 'core\workbench.py'
    $logStamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $stdoutLog = Join-Path $logRoot ($logStamp + '.stdout.log')
    $stderrLog = Join-Path $logRoot ($logStamp + '.stderr.log')
    $serviceProcess = Start-Process -FilePath $projectPython -ArgumentList @('-u', '-B', ('"' + $serverScript + '"'), '--port', $Port) `
        -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru
    $ready = $false
    for ($attempt = 0; $attempt -lt 10; $attempt++) {
        $serviceProcess.Refresh()
        if ($serviceProcess.HasExited) { break }
        if (Test-Workbench) { $ready = $true; break }
        Start-Sleep -Milliseconds 300
    }
    if (-not $ready) { throw "Workbench did not become ready. Check $stderrLog" }
    Write-Output ('Background workbench PID: ' + $serviceProcess.Id)
    Write-Output ('Logs: ' + $logRoot)
}
Write-Output ('Evidence: ' + $workbenchUrl + '/')
Write-Output ('Experiments: ' + $workbenchUrl + '/experiments/')
