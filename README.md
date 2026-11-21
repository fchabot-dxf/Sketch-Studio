# Sketch Studio

One shared **Design tab** (a constraint-solving 2D sketcher) and four apps built on it. Browser-native ES modules and an import map, no
bundler, no build step to run it.

| App | What it does | Steps (declared in) |
|---|---|---|
| **Sketch** (`apps/sketchstudio/`) | Draw, dimension and constrain shapes; export SVG and DXF. | Design, Drawing (`apps/sketchstudio/stages.js`) |
| **Shaper** (`apps/shaper/`) | Turn a sketch into cuts for the Shaper Origin. Also runs inside a Fusion 360 palette (`?host=fusion`). | Design, Prepare, Export (`apps/shaper/src/modes.js`) |
| **Pen Plotter** (`apps/penplotter/`) | Draw or import art, set pens and paper, export plotter files. | Design, Prepare, Export (`apps/penplotter/src/stages.js`) |
| **Trace** (`apps/trace/`) | Turn a photo into SVG and DXF paths. | Trace, Design, Export (`apps/trace/src/stages.js`) |

The names, taglines and icons of the four apps are declared once in `packages/ui/app-registry.js`.
The plan and the principles (one reusable Design tab; declare, don't hand-roll) are in `ROADMAP.md` and `NEXT-SESSION.md`.

## Run it locally

```
npm install
node server.js
```

`node server.js` serves the repo root on http://localhost:8000/ (`PORT` changes the port; a folder as the first argument serves that folder).
`/` forwards to Sketch; the apps are at `/apps/sketchstudio/`, `/apps/shaper/`, `/apps/penplotter/` and `/apps/trace/`.
It also answers `/api/shaper-upload` with the same code as the Pages Function. `npm install` is only needed for the tests and the site build.

## Folder layout

- `apps/` : one folder per app (its page, its own modules and styles).
- `packages/core/` : the shared engine: model, constraints, solver, geometry, units, import / export. No DOM.
- `packages/ui/` : the shared Design tab and UI: header, sidebar, ribbons, document tabs, settings, shortcuts, vendored libraries.
- `tests/` : the tests (`*.test.js`); `tests/helpers/` is the shared test kit; `packages/core/tests/` holds the core's own.
- `scripts/` : the test gate, the site build, audits and benches (`scripts/README.md`).
- `functions/` : the Cloudflare Pages Functions (Google sign-in routes, `/api/shaper-upload`).
- `analytics/` : the anonymous usage-count Worker (`analytics/README.md`).
- `docs/` : design notes and audits (`docs/README.md`).
- `assets/`, `about.html`, `privacy.html` : shared site files.

## Tests

`npm run gate:quick` runs every test that needs no browser; `npm run gate:live` runs the browser tests; `npm run gate:merge` runs what a
branch affects. The tiers and the rules for running them are in `AGENTS.md` (the runner is `scripts/gate.cjs`).
`tests/readme-848-node.test.js` checks that every file path and `npm run` command the READMEs name exists.

## Keyboard shortcuts

Every shortcut is declared in one table, `packages/ui/shortcuts.js`, and the app lists the ones it has in Settings > Shortcuts, where they
can also be changed. There is no copy of the list here, so it cannot go stale.

## Where the plans live

`ROADMAP.md` (the plan), `NEXT-SESSION.md` (the work in flight and the project principles), `WORK-LOG.md` (what each task did),
`CONTEXT.md` (environment and gotchas), `AGENTS.md` (the rules for the people and agents working here).

## Websites: one per app

Each app is its own website (its own Cloudflare Pages project). The engine and every shared package stay ONE copy in this repo:
`node scripts/build-site.cjs <app>` writes the app at the ROOT of its site (the address bar shows https://shaper-svg.pages.dev/):
the files of `apps/<app>/` at the top of `dist/`, then `packages/`, the root files the app reaches (the glyph sheet), `privacy.html`, `about.html`,
a 404 page and that site's `_redirects`. No source file changes: the page's relative links to `packages/` stop at the root, and the build checks every
reference of the page lands on the same file as in the repo. No other app's folder is in a site (`tests/site-closure.test.js`, `tests/site-root-763.test.js`).
The old addresses keep working: `/apps/<app>/`, `/apps/<app>/index.html` and any `/apps/<app>/<file>` forward (302) to `/` / `/<file>`, the query
string kept (`/apps/shaper/?host=fusion` -> `/?host=fusion`: the Fusion add-in) and the `#hash` kept by the browser.

| Site | Pages project | Build command | Output dir |
|---|---|---|---|
| https://sketch-studio.pages.dev (Sketch) | `sketch-studio` (Git-connected) | `node scripts/build-site.cjs sketchstudio` | `dist` |
| https://shaper-svg.pages.dev | `shaper-svg` (direct upload) | `node scripts/build-site.cjs shaper` | `dist` |
| https://sketch-plotter.pages.dev | `sketch-plotter` (direct upload) | `node scripts/build-site.cjs penplotter` | `dist` |
| https://sketch-trace.pages.dev | `sketch-trace` (direct upload) | `node scripts/build-site.cjs trace` | `dist` |

`npm run site:<app>` runs the same build. A direct-upload site is deployed from the REPO ROOT (`wrangler pages deploy dist --project-name <project>`):
wrangler uploads the `functions/` folder of the directory it runs in (the Google sign-in routes), not one inside `dist/`.
sketch-studio's site keeps the old links: `/shaper`, `/penplotter`, `/trace` and `/apps/<app>/*` redirect (302, query string kept) to the app's own site, at its root.
The build needs Node 20.19 or newer (it loads the ES module app registry): `.node-version` pins 22.16.0 for the Git-connected Cloudflare build, and package.json `engines` says `>=20.19`.
Check a built site the way Cloudflare serves it, locally, with no login and no deploy: `node tests/site-root-763-live.test.js` (it runs `wrangler pages dev`).

Each Pages project needs the same three secrets (names only): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_KEY`.
All four sites use the SAME Google OAuth client (Drive files made by one app stay visible to the others: the drive.file scope is per client).
In the Google Cloud console that client needs, for EACH site:
- Authorized redirect URI: `https://<site>/auth/google/callback`
- Authorized JavaScript origin: `https://<site>`

Each site has its own browser storage: open tabs, settings and sign-in are per site; designs on Google Drive show on every site.

## Licence

Sketch Studio's own code is under the PolyForm Noncommercial License 1.0.0 (`LICENSE.md`). In plain words: you may use it for any noncommercial
purpose, change it and share it, as long as you pass the licence on with it; you may not use it commercially without permission. The third-party
parts bundled with it keep their own licences: see `THIRD-PARTY-NOTICES.md`.
