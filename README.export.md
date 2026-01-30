Export script (simple)

This repository includes a minimal exporter that concatenates `src/*.js` into the `sketch-studio-unified/index.html` template and writes a single-file HTML into `export/`.

Usage:

- Node is nice-to-have (v12+) — run `npm run export:simple` from the `Sketch-Studio` folder.
- If Node is not available on Windows, run the PowerShell script directly:

  powershell -ExecutionPolicy Bypass -File .\scripts\export-simple.ps1

Output:
- `export/sketch-studio-unified-v{timestamp}.html`

Notes:
- The scripts are intentionally simple; they remove `import`/`export` lines and inline the module files in the prescribed order (1..8). They do not bundle or transpile; for more robust builds use an esbuild or Rollup script.
