# scripts/

Tools for the repo. Run each from the repo root.

## The test gate

- `scripts/gate.cjs` : the ONE test runner, in tiers (`npm run gate:quick`, `gate:live`, `gate:merge`, `gate`). The tiers and the rules are in
  `AGENTS.md`; `node scripts/gate.cjs --list` shows each test's tier.
- `scripts/run-tests.js` : `npm test`, a plain loop over `tests/*.test.js`, `packages/core/tests/*.test.js` and `tests/harness/*.test.js` in one process.
- `scripts/shell-smoke.cjs` : `npm run test:shell`, a headless-browser smoke of the Sketch shell (the gate runs it too).

## Websites

- `scripts/build-site.cjs` : `node scripts/build-site.cjs <app>` (or `npm run site:<app>`) builds one app's site into `dist/` (see `README.md`, "Websites").
  It uses `scripts/site-closure.cjs` (which files the app reaches), `scripts/site-identity.cjs` (favicons, manifest and share tags from
  `packages/ui/app-registry.js`) and `scripts/site-about.cjs` (the About page).

## Audits, reports and benches

- `scripts/constraint-audit.cjs`, `scripts/coverage-audit.cjs`, `scripts/coverage-properties.cjs` : print the tables of `docs/CONSTRAINT-AUDIT.md` and `docs/COVERAGE-AUDIT.md`.
- `scripts/gen-origin-rules-index.mjs` : GENERATES `docs/ORIGIN-RULES.md` from `packages/core/origin-rules.js` (`--check` fails when the file is stale).
- `scripts/replay-report.cjs` : rebuild a drawing from a pasted diagnostic report.
- `scripts/solver-bench.mjs` : the solver's speed on large sketches.
- `scripts/mobile-audit.mjs` : phone-size measurements through a headless browser.
- `scripts/fusion-oracle/` : helpers that compare the solver with a running Fusion 360.
- `scripts/test-shaper-live.js` : a manual check of the Shaper upload against the real service; it needs credentials kept outside the repo.

## Old single-app build (broken)

`scripts/build-inline.cjs`, `scripts/smoke-test.cjs` and `scripts/validate-standalone.cjs` (`npm run build:inline`) belong to the first single-page app:
they read a root index page and a top-level source folder that no longer exist, so `npm run build:inline` fails with a missing-folder error (ENOENT). Nothing uses them.

## Deployment

Each app is a Cloudflare Pages site built by `scripts/build-site.cjs`; the Pages projects, deploy commands and secret names are in `README.md`
("Websites: one per app").
