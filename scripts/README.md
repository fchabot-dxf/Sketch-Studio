# scripts/

Build and test helpers for Sketch-Studio. All paths are relative to the repository root.

## Available scripts

- **`run-tests.js`** — entry point for `npm test`. Runs every `*.test.js` file under `tests/`.
- **`build-inline.cjs`** — bundles `src/` plus the compiled CSS into a single self-contained HTML file at `output/sketch-studio-unified-v1.0.html`. Useful for offline distribution.
- **`smoke-test.cjs`** — quick post-build sanity check on the inlined HTML output.
- **`validate-standalone.cjs`** — deeper validation of the standalone HTML (loads it in a headless context).

## Usage

From the repo root:

```
npm test                # run the test suite
npm run build:css       # compile Tailwind once
npm run watch:css       # compile Tailwind on save (development)
npm run build:inline    # produce output/sketch-studio-unified-v1.0.html
npm run build           # build:css + build:inline
```

The build scripts assume the flat layout: `index.html` and `src/` at the repo root.

## Deployment

This project deploys via Cloudflare Pages connected to GitHub. Pushing to `main` triggers an automatic build (Cloudflare runs `npm run build:css`) and deploy. No local wrangler CLI or deploy script needed.
