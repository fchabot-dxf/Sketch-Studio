# Sketch Studio - Apply Config
# Run this script to apply config.json values to all source files

$configPath = Join-Path $PSScriptRoot "config.json"
$srcPath = Join-Path $PSScriptRoot "src"

if (-not (Test-Path $configPath)) {
    Write-Host "Error: config.json not found!" -ForegroundColor Red
    exit 1
}

$cfg = Get-Content $configPath | ConvertFrom-Json
Write-Host "Applying config..." -ForegroundColor Cyan

# ========== 1-utils.js ==========
$utilsPath = Join-Path $srcPath "1-utils.js"
$utils = Get-Content $utilsPath -Raw

# Update SNAP_PX
$utils = $utils -replace 'export const SNAP_PX = \d+;', "export const SNAP_PX = $($cfg.snapping.snapPx);"

# Update DEFAULT_VIEW
$utils = $utils -replace "export const DEFAULT_VIEW = \{ x:0, y:0, w:\d+, h:\d+ \};", "export const DEFAULT_VIEW = { x:0, y:0, w:$($cfg.view.defaultWidth), h:$($cfg.view.defaultHeight) };"

Set-Content $utilsPath $utils -NoNewline
Write-Host "  Updated 1-utils.js" -ForegroundColor Green

# ========== 4-render.js ==========
$renderPath = Join-Path $srcPath "4-render.js"
$render = Get-Content $renderPath -Raw

# Update grid size
$render = $render -replace 'const gridSize = \d+;', "const gridSize = $($cfg.grid.size);"

# Update grid color
$render = $render -replace 'stroke="#e0e0e0" stroke-width="0.5"', "stroke=`"$($cfg.grid.color)`" stroke-width=`"0.5`""

# Update shape stroke (lines)
$render = $render -replace 'stroke="#2563eb" stroke-width="2" stroke-linecap', "stroke=`"$($cfg.shapes.strokeColor)`" stroke-width=`"$($cfg.shapes.strokeWidth)`" stroke-linecap"

# Update shape stroke (circles) - be more specific
$render = $render -replace 'fill="none" stroke="#2563eb" stroke-width="2"/>', "fill=`"none`" stroke=`"$($cfg.shapes.strokeColor)`" stroke-width=`"$($cfg.shapes.strokeWidth)`"/>"

# Update joint radius
$render = $render -replace "const r=\(id==='j_origin'\)\?\d+:\d+;", "const r=(id==='j_origin')?$($cfg.joints.originRadius):$($cfg.joints.radius);"

# Update joint colors
$render = $render -replace "const fill = isSelected \? '#fbbf24' : 'white';", "const fill = isSelected ? '$($cfg.joints.selectedFillColor)' : '$($cfg.joints.fillColor)';"
$render = $render -replace "const stroke = isSelected \? '#f59e0b' : '#2563eb';", "const stroke = isSelected ? '$($cfg.joints.selectedStrokeColor)' : '$($cfg.joints.strokeColor)';"
$render = $render -replace "const strokeW = isSelected \? 3 : 2;", "const strokeW = isSelected ? 3 : $($cfg.joints.strokeWidth);"

# Update preview stroke color
$render = $render -replace 'stroke="#10b981" stroke-width="2" stroke-dasharray', "stroke=`"$($cfg.preview.strokeColor)`" stroke-width=`"2`" stroke-dasharray"

# Update snap indicator color (multiple occurrences)
$render = $render -replace 'stroke="#ea580c"', "stroke=`"$($cfg.snap.indicatorColor)`""
$render = $render -replace 'fill="#ea580c"', "fill=`"$($cfg.snap.indicatorColor)`""

Set-Content $renderPath $render -NoNewline
Write-Host "  Updated 4-render.js" -ForegroundColor Green

# ========== 6-input.js ==========
$inputPath = Join-Path $srcPath "6-input.js"
$input = Get-Content $inputPath -Raw

# Update joint hit radius
$input = $input -replace 'hitJointAtScreen\(state\.joints, svg, e\.clientX, e\.clientY, \d+\)', "hitJointAtScreen(state.joints, svg, e.clientX, e.clientY, $($cfg.snapping.jointHitRadius))"

Set-Content $inputPath $input -NoNewline
Write-Host "  Updated 6-input.js" -ForegroundColor Green

# ========== index.html ==========
$htmlPath = Join-Path $PSScriptRoot "index.html"
$html = Get-Content $htmlPath -Raw

# Update canvas background
$html = $html -replace 'background-color: #[a-fA-F0-9]{6}; transition', "background-color: $($cfg.canvas.backgroundColor); transition"

# Update snap background  
$html = $html -replace '#svgCanvas\.snapping \{ background-color: #[a-fA-F0-9]{6};', "#svgCanvas.snapping { background-color: $($cfg.snap.backgroundColor);"

Set-Content $htmlPath $html -NoNewline
Write-Host "  Updated index.html" -ForegroundColor Green

Write-Host "`nConfig applied successfully!" -ForegroundColor Cyan
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
