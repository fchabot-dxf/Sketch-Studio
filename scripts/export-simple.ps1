# Simple exporter (PowerShell) for Windows
# Usage: Open PowerShell in this folder and run: .\scripts\export-simple.ps1

$root = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent
$srcDir = Join-Path $root 'sketch-studio-unified\src'
$template = Join-Path $root 'sketch-studio-unified\index.html'
$exportDir = Join-Path $root 'export'

if(-not (Test-Path $srcDir)){
  Write-Error "src folder not found: $srcDir"; exit 1
}
if(-not (Test-Path $template)){
  Write-Error "template not found: $template"; exit 1
}

$order = @('1-utils.js','2-solver.js','3-snap.js','4-render.js','5-engine.js','6-input.js','7-ui.js','8-main.js')
$bundle = ""
foreach($f in $order){
  $p = Join-Path $srcDir $f
  if(-not (Test-Path $p)){ Write-Warning "Skipping missing file: $f"; continue }
  $src = Get-Content $p -Raw
  # Remove import lines
  $src = $src -replace "(?m)^(\s*import[\s\S]*?;\s*)$", ''
  # Replace export keywords
  $src = $src -replace "\bexport\s+function\s+", 'function '
  $src = $src -replace "\bexport\s+(const|let|var)\s+", '$1 '
  $src = $src -replace "\bexport\s+default\s+", ''
  $bundle += "`n// ---- $f (inlined) ----`n$src`n"
}

$html = Get-Content $template -Raw
if(-not ($html -match "<!-- INJECT:JS -->")){
  Write-Error "Template missing <!-- INJECT:JS --> marker"; exit 1
}

$outHtml = $html -replace '<!-- INJECT:JS -->', "<script>`n$bundle`n</script>"

if(-not (Test-Path $exportDir)){ New-Item -ItemType Directory -Path $exportDir | Out-Null }
$outName = "sketch-studio-unified-v$(Get-Date -UFormat %s).html"
$outPath = Join-Path $exportDir $outName
Set-Content -Path $outPath -Value $outHtml -Encoding UTF8
Write-Host "Export written to $outPath" -ForegroundColor Green
