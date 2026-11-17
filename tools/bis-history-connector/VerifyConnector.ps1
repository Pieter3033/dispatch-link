param(
    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 2147483647)]
    [int]$IncidentId,

    [ValidateSet('json', 'xls', 'pdf')]
    [string]$Format = 'json',

    [Parameter(Mandatory = $true)]
    [string]$ResultPath
)

try {
    $ErrorActionPreference = 'Stop'
    $projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:43128/health' -Method Get -TimeoutSec 5
    if (-not $health.ok -or $health.mode -ne 'read-only') {
        throw 'The connector health response was invalid.'
    }
    Push-Location $projectRoot
    try {
        $nodePath = Join-Path $projectRoot 'tools\runtime\node.exe'
        $env:NODE_NO_WARNINGS = '1'
        $reportUrl = (& $nodePath 'tools\generate_mstrack_history.js' $IncidentId $Format 2>&1 | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) { throw $reportUrl }
    } finally {
        Pop-Location
    }
    if (-not $reportUrl.StartsWith('/dispatch_link/public/generated-reports/')) {
        throw 'The generated report URL was invalid.'
    }
    $result = [ordered]@{
        ok = $true
        mode = $health.mode
        incidentId = $IncidentId
        format = $Format
        reportUrl = $reportUrl
    }
} catch {
    $result = [ordered]@{
        ok = $false
        incidentId = $IncidentId
        format = $Format
        error = $_.Exception.Message
    }
}
[IO.File]::WriteAllText([IO.Path]::GetFullPath($ResultPath), ($result | ConvertTo-Json -Compress))
