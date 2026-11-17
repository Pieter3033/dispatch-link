param(
    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 2147483647)]
    [int]$IncidentId,

    [Parameter(Mandatory = $true)]
    [ValidateSet('incident', 'communication')]
    [string]$ReportType,

    [Parameter(Mandatory = $true)]
    [string]$ResultPath
)

$result = $null
try {
    $ErrorActionPreference = 'Stop'
    $projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
    $nodePath = Join-Path $projectRoot 'tools\runtime\node.exe'
    $scriptName = if ($ReportType -eq 'incident') { 'generate_incident_report.js' } else { 'generate_communication_log_report.js' }
    $env:NODE_NO_WARNINGS = '1'
    Push-Location $projectRoot
    try {
        $reportUrl = (& $nodePath (Join-Path 'tools' $scriptName) $IncidentId 2>&1 | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) { throw $reportUrl }
    } finally {
        Pop-Location
    }
    if (-not $reportUrl.StartsWith('/dispatch_link/public/generated-reports/')) { throw 'The report URL was invalid.' }
    $relativePath = [Uri]::UnescapeDataString($reportUrl.Substring('/dispatch_link/public/'.Length)).Replace('/', [IO.Path]::DirectorySeparatorChar)
    $filePath = Join-Path (Join-Path $projectRoot 'public') $relativePath
    $stream = [IO.File]::OpenRead($filePath)
    try {
        $signatureBytes = New-Object byte[] 4
        if ($stream.Read($signatureBytes, 0, 4) -ne 4 -or [Text.Encoding]::ASCII.GetString($signatureBytes) -ne '%PDF') {
            throw 'The generated file is not a PDF.'
        }
    } finally { $stream.Dispose() }
    $result = [ordered]@{ ok = $true; type = $ReportType; reportUrl = $reportUrl; bytes = (Get-Item -LiteralPath $filePath).Length }
} catch {
    $result = [ordered]@{ ok = $false; type = $ReportType; error = $_.Exception.Message }
}
[IO.File]::WriteAllText([IO.Path]::GetFullPath($ResultPath), ($result | ConvertTo-Json -Compress))
