# auto-runner.ps1 - portable Claude trigger watcher
# ----------------------------------------------------------------------
# Drop this script into any project folder. It watches `.triggers/`
# next to itself; when a file appears there, the script executes the
# file's contents as a shell command (cwd = the script's folder),
# captures stdout+stderr to <name>.log, then auto-deletes the trigger.
#
# Leave this PowerShell window open while working. Press Ctrl+C to stop.
#
# Claude's workflow:
#   1. Write a file e.g. .triggers/test  with content   npm test
#   2. Wait ~1 second
#   3. Read .triggers/test.log
#
# Add `.triggers/` to your .gitignore so trigger files don't end up in git.
# ----------------------------------------------------------------------

$ErrorActionPreference = 'Continue'

# Project root = wherever this script lives.
$projectRoot = $PSScriptRoot
if (-not $projectRoot) { $projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path }
$triggerDir  = Join-Path $projectRoot '.triggers'
$projectName = Split-Path $projectRoot -Leaf

if (-not (Test-Path $triggerDir)) {
    New-Item -ItemType Directory -Path $triggerDir | Out-Null
}

$host.UI.RawUI.WindowTitle = "auto-runner - $projectName"

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "  auto-runner - $projectName" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host "  Watching:  $triggerDir"
Write-Host "  Project:   $projectRoot"
Write-Host "  Stop with: Ctrl+C"
Write-Host ""
Write-Host "Drop a file e.g. .triggers/test with 'npm test' inside;"
Write-Host "output appears in .triggers/test.log within 1 second."
Write-Host ""

while ($true) {
    try {
        $files = Get-ChildItem -Path $triggerDir -File -ErrorAction SilentlyContinue |
                 Where-Object { $_.Extension -ne '.log' -and $_.Name -notlike '.git*' }

        foreach ($f in $files) {
            $cmd = $null
            try { $cmd = (Get-Content -Path $f.FullName -Raw -ErrorAction Stop).Trim() } catch { continue }
            if ([string]::IsNullOrWhiteSpace($cmd)) {
                Remove-Item $f.FullName -Force -ErrorAction SilentlyContinue
                continue
            }

            $logPath = "$($f.FullName).log"
            $stamp = Get-Date -Format 'HH:mm:ss'
            Write-Host "[$stamp] $cmd" -ForegroundColor Cyan

            $start = Get-Date
            # cmd /c so npm/git/etc. resolve from PATH; merge stderr into stdout
            $output = & cmd /c "cd /d `"$projectRoot`" && $cmd 2>&1" | Out-String
            $exitCode = $LASTEXITCODE
            $duration = ((Get-Date) - $start).TotalSeconds

            $header = @(
                "# Command:   $cmd",
                "# Exit code: $exitCode",
                "# Duration:  {0:F2}s" -f $duration,
                "# Time:      $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
                "# ----------"
            )
            $logLines = $header + ($output.TrimEnd() -split "`r?`n")
            $logLines -join "`r`n" | Set-Content -Path $logPath -Encoding UTF8 -NoNewline

            Remove-Item $f.FullName -Force -ErrorAction SilentlyContinue

            $stamp = Get-Date -Format 'HH:mm:ss'
            $color = if ($exitCode -eq 0) { 'Green' } else { 'Red' }
            Write-Host "[$stamp] -> exit $exitCode in $('{0:F1}' -f $duration)s -> $($f.Name).log" -ForegroundColor $color
        }
    } catch {
        Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
    }

    Start-Sleep -Milliseconds 500
}
