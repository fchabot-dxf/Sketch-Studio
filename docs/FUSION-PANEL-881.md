# Fusion panel build — TASK 881, STEP 1: inventory

Owner turns 3487-3490: the Fusion add-in opens the Shaper website in a palette; the panel should start from what the website has, with the
parts Fusion does not use left out, and be redesigned from there. The add-in will carry this build offline (SA-32), so the panel is always the
same version as the add-in.

This file is the inventory: what Shaper does today in Fusion mode (`?host=fusion`, and `&project=design` from the SA-19 add-in), against
the website. Line numbers are at `origin/main` 0ab16e4f. Task 880 (Export view: the right side panel removed, export actions in the header,
Thickness / Material in the footer) is not merged yet, so the Export-step rows below will move when it is.

Legend. **Mode**: HIDDEN = exists in Fusion mode but is not shown; REPLACED = Fusion mode uses something else; ADDED = only in Fusion mode;
SAME = the same in both. **Fusion**: USED / UNUSED in the Fusion panel; "owner to decide" where the owner has not ruled yet.

## 1. How Fusion mode is decided

| What | Where | Note |
|---|---|---|
| `isFusionMode()`: the URL's `?host=fusion` (the only mode test) | apps/shaper/src/fusion-bridge.js:211 | `window.adsk` only gates sending (fusion-bridge.js:5-6) |
| `isPerDesignProject()`: `?host=fusion&project=design` (SA-19 add-in: the workspace lives in the Fusion design) | fusion-bridge.js:219-224 | |
| main.js reads both once | apps/shaper/src/main.js:64-65 | |
| `mountFusionPrepareBar` reads the URL again for itself | fusion-bridge.js:485 | the bar's own waiting-for-adsk test; a Fusion entry still needs `?host=fusion` in its URL, or this has to become a passed value |

## 2. Stages (views)

| Part | Website | Fusion mode | Where | Fusion |
|---|---|---|---|---|
| Design stage (the shared Design tab: canvas, ribbon, Sketches browser) | first stage | HIDDEN (not a stage; the view stays in the page, hidden) | modes.js:31-36 `FUSION_HIDDEN_STAGES`, main.js:67; index.html:782-789 | UNUSED as a view. The sketch CONTROLLER (`mountSketch`, main.js:710-718) is USED: Prepare and Export read its state / engine |
| Design tool ribbon (`createToolRibbon`) + Sketches browser (`mountShaperBrowser`) | built | built anyway, hidden with the Design view | main.js:693-706 (`buildDesignUI`) called from main.js:720 | UNUSED |
| Opening stage | stored stage or Design | stored stage or Prepare | modes.js:40-45 `resolveInitialMode` | |
| Prepare | SAME + Fusion bar | ADDED bar, see section 4 | prepare-stage.js | USED |
| Export (stage id `review`): 3D / 2D / Paths view, Simulate, Stock, Look, Generate / Send / ShaperHub link | SAME | SAME | main.js:806-916, index.html:802-844 | USED (layout changes with task 880) |

## 3. Menu (drawer), header, footer

| Part | Website | Fusion mode | Where | Fusion |
|---|---|---|---|---|
| Header stage tabs | Design, Prepare, Export | Prepare, Export | main.js:67, 92 | USED |
| Document tab strip | shown | HIDDEN (`projects: false`) | main.js:96; app-chrome.js:61; sidebar-projects.js:54 | UNUSED |
| Project / file actions: New design, Templates…, Save, Save as…, Duplicate, Open recent, Projects, Open…, Import SVG / DXF… | shown | HIDDEN (`projects: false`) | sidebar-projects.js:48, 95-112 | UNUSED |
| Document name / rename, Drive save status line | shown | HIDDEN | sidebar-projects.js:142-164 | UNUSED |
| Google account avatar, Save button (footer), Drive controls | shown | HIDDEN | sidebar-projects.js:174; main.js:66 (`getGoogleAccount().init()` skipped) | UNUSED |
| Settings sync through Google Drive | started | not started | app-chrome.js:29-31 | UNUSED |
| Ctrl+S save prompt, unsaved-leave prompt, design-file drop opening a tab | on | off | sidebar-projects.js:236-250 | UNUSED |
| Open STL, Insert STL (drawer entries) | shown | HIDDEN (not declared) | main.js:100-103 | UNUSED |
| Download (the same SVG as Generate Shaper SVG, param-hints.js:108) | shown | shown | main.js:104-110 | **UNUSED** (owner turn 3494) |
| Fusion add-in (download view) | shown | HIDDEN (`visible: () => !fusion`) | main.js:111, 118; addin-download.js:46 | UNUSED |
| Settings (the shared style panel, a modal) | shown | shown | main.js:113, 671-673 | **UNUSED** (owner turn 3494) |
| Settings gear in the footer (the same style panel) | shown | shown | main.js:763; app-footer.js:246-255 | **UNUSED** (owner turn 3494: Settings unused; the gear opens the same panel) |
| Log (diagnostic log + Copy report) | shown | shown | main.js:62, 114 | **USED** (owner turn 3494: "only thing i use is log") |
| About (opens /about.html in a new tab) | shown | HIDDEN (`host !== 'fusion'`) | sidebar-projects.js:92 | UNUSED |
| Rate & feedback | shown | shown | sidebar-projects.js:87-94; feedback.js | **owner to decide** (advisor asking whether other users of the public add-in keep it). Note: from the offline panel (127.0.0.1) it cannot send today, see section 9 |
| "Enjoying Shaper?" feedback card in the Export panel | shown | shown | index.html:839 `data-feedback-slot` | owner to decide (same question) |
| Footer Undo / Redo | shown | shown (Prepare's history) | main.js:760-764; modes.js:15-21 | USED |
| Footer Delete / Clear sketch / Recenter | Design only | never shown (Design hidden) | app-footer.js:12 | UNUSED |
| Analytics (`host: 'fusion'`) | sends from the public site | sends from the public site | main.js:90; analytics.js:39-41 | offline panel on 127.0.0.1: `isPublicPage` is false (analytics-events.js:65 LOCAL_HOST), so it never sends |

## 4. Added in Fusion mode

| Part | Where | Fusion |
|---|---|---|
| Fusion bar over Prepare: Add selection, the connection status ("Waiting for Fusion…" / "Connected to Fusion: <doc>"), the toolpaths spinner, the selection list (X per row, Clear all) | fusion-bridge.js:417-480 (`mountFusionPrepareBar`); index.html:349, 360-372, 387-388, 597, 642 (`.is-fusion` CSS) | USED |
| The palette bridge `window.fusionJavaScriptHandler` (the one global, Fusion's palette API) and `adsk.fusionSendData` sends; the actions | fusion-bridge.js:62-79 `FUSION_ACTIONS`, 255 `createFusionBridge` | USED |
| Fusion selection import (selection_data -> sketch + plan + stock) | fusion-import.js; main.js:991-1001 | USED |
| Selection list edits (remove one, Clear all) | selection-edit.js; main.js:1002-1007 | USED |
| Live toolpaths in Fusion (toolpaths / toolpaths_clear) | fusion-toolpaths.js; main.js:1010-1018 | USED |
| Select in Fusion per operation (op-list row action) | main.js:643-646; prepare-stage.js:297; op-list.js:35 | USED |
| Project saved in the Fusion design (design_context / save_project / project_saved, debounced) | fusion-bridge.js:30, 83-157; main.js:972-990 | USED |
| In-memory project store when `project=design` (nothing in the browser's storage) | main.js:727 | USED |
| One-time offer of the browser's pre-855 work ("Open the panel's previous work") | main.js:925-964; fusion-bridge.js:31 | UNUSED in an offline panel: it reads the website origin's browser store; a panel served from 127.0.0.1 is another origin and has none |
| Fusion length units -> the doc unit | fusion-bridge.js:39-58 | USED |
| `pagehide` / `beforeunload`: flush the project save, clear Fusion's toolpaths | main.js:1017-1018 | USED |

## 5. Same code in both modes, and whether Fusion uses it

| Part | Where | Fusion |
|---|---|---|
| Prepare: canvas, operations toolbar (the shared tool ribbon with Prepare's own buttons), cut card, operations list, notice, Tool table window | prepare-stage.js; main.js:631-647 | USED |
| Prepare toolbar "Insert STL" (lead group) | main.js:639-640, 648-653; stl-import.js | **UNUSED: removed from the Fusion panel** (owner turn 3604, "Yes remove it"; task 885). The website keeps it, plain and with `?host=fusion` |
| STL card in Prepare (an imported STL's settings) | stl-card.js; main.js:664-666 | **UNUSED: not in the Fusion panel** (task 885, with Insert STL). The website keeps it |
| SVG / DXF drop anywhere on the page | main.js:705 (`shaperImporter.mountDrop()`); cut-import.js | live in Fusion today; imports into the HIDDEN Design (modes.js:87-89: `showDesign` does nothing in Fusion mode). UNUSED |
| Paths worker (operation paths in the background) | main.js:122; paths-worker.js | USED |
| Generate Shaper SVG (download) | main.js:160-190 | USED |
| Send to ShaperHub dialog (sign-in, folder browser, Replace / Keep both) | main.js:192-610; index.html:845-904 | USED; see risk R1 (offline it posts to the panel's own server) |
| Open ShaperHub link (external, new window) | index.html:836 | USED |
| Origin-rules warning on every exported file | main.js:145 | USED |
| 3D view (three.js, loaded on first entry), 2D / Paths view, Simulate | review-view.js; export-preview.js; export-sim.js | USED |
| Stock thickness card, Look (material, colour) | main.js:876-914; stock-card.js | USED (moves to the footer with task 880) |
| Diagnostic log | #ui/diagnostic-log.js | USED |
| Old ShaperHub login removal at start | main.js:71; shaperhub-login.js | UNUSED offline (a fresh origin has nothing stored) |
| Remember login on this computer (TASK 886) | shaper-app.js; shaperhub-login.js | USED (the module is in the panel since task 886; the old login's removal stays main.js only) |
| Templates (template picker) | reached through feedback.js, transform-box.js, file-dialog.js, sidebar-projects.js | UNUSED |

## 6. Fusion tests today

Node: fusion-mode-663-node, fusion-import-664-node, fusion-polish-665-node, fusion-replace-712-node, fusion-toolpaths-799-node,
fusion-adsk-wait-685-node. Live: fusion-mode-663-live (boot, ping / pong, Add selection, selection_data, error, Export tab, no-adsk wait, website
unchanged), fusion-import-664-live, fusion-polish-665-live, fusion-replace-712-live, fusion-toolpaths-799-live, fusion-adsk-wait-685-live,
param-hints-770-fusion-live, pocket-loop-750-fusion-live, pocket-startmark-775-fusion-live.

## 7. The import graph: why "exclude at build time" reaches into shared modules

A static-import walk from apps/shaper/src/main.js reaches 238 modules. Leaving out a UNUSED part is not only dropping a line in main.js: the
shared modules the Fusion panel USES import the unused layers themselves.

| Used by Fusion | imports (and so pulls in) | |
|---|---|---|
| fusion-bridge.js:17 | `emptyDocument` from #ui/project-store.js | the whole Drive / Google stack: project-store -> cloud/router-adapter, drive-adapter, drive-writer, google-account, providers, auth-state, project-file |
| #ui/document-buffer.js:45 (the sketch's document buffer) | `getProjectStore, emptyDocument` from project-store.js; text-fonts.js (opentype) | the same stack |
| fusion-import.js | project-store.js | the same stack |
| #ui/app-chrome.js:5-9 (header + drawer) | sidebar-projects.js, google-account.js, settings-sync.js | project actions, project manager, template picker, document tabs, Drive |
| prepare-stage.js (operations toolbar) | #ui/tool-ribbon.js | text-fonts / opentype, template-picker (via transform-box) |
| #ui/app-footer.js | app-sidebar.js, template-picker (via feedback) | |
| #ui/style-panel.js (Settings, UNUSED) | cloud/settings-sync.js -> drive-writer, drive-adapter | |

So a Fusion entry that leaves out projects / Drive / Google / templates / Settings / STL / the Design ribbon needs those shared modules to
TAKE the layer instead of importing it (DECLARE / inject: e.g. app-chrome given the sidebar, document-buffer given its store, fusion-bridge
not reaching project-store for an empty document). That changes the bytes of website modules (main.js and shared packages/ui files),
while the website's behaviour stays the same. The task says the website build must stay byte-identical, or STOP and ask before keeping any
difference. This is the question for STEP 2 (see the REPORT).

## 8. Constraints from SA-32 (advisor, live-checked in Fusion 2706.1.17)

- The palette loads `http://127.0.0.1:<port>/index.html` from the add-in's local server. ES modules work there; `adsk.fusionSendData`
  arrives about 200 ms after the module runs (the app already waits for it: task 685).
- file:// is not an option (module imports, module workers and `import()` are blocked on file:// origins).
- The build is ONE self-contained folder, `index.html` at its root, only relative URLs inside it: today's import map climbs
  `../../packages/` (index.html:12-21): the Fusion build must point `#core/`, `#ui/`, `three` inside the folder.
- three.js vendored (packages/ui/vendor/three), no CDN or font fetches, the module worker URL relative (main.js:122 already is:
  `new URL('./paths-worker.js', import.meta.url)`).
- Only the files the app loads (no tests / samples), plus a file list / manifest (count and size) for the release to pin.
- Case-exact paths, no Cloudflare rewrites or extensionless URLs.

## 9. Run-time network: what is fetched from outside the panel

| Call | Where | Offline panel (127.0.0.1) |
|---|---|---|
| R1 `fetch('/api/shaper-upload')` (Send to ShaperHub: list, mkdir, upload) | main.js:381 | **RISK**: relative, so it goes to the add-in's local server (no such route). Pointing it at `https://shaper-svg.pages.dev/api/shaper-upload` is a cross-origin JSON POST; functions/api/shaper-upload.js sends no CORS headers and has no OPTIONS handler, so the browser would refuse it. Send to ShaperHub does not work offline until one of these is decided (the local server proxies it, or the function allows the panel's origin) |
| Analytics events + Rate & feedback post to `sketch-analytics.dansemur.workers.dev` | analytics.js:29, 86, 126 | events: never sent from 127.0.0.1 (LOCAL_HOST). Feedback: refused on a local page (analytics.js:114 `canSendFeedback` = public page only; analytics.js:123 answers "Feedback can only be sent from the published app, not from this copy."), so **Rate & feedback cannot send from the offline panel** as it is: input for the owner's decision on it |
| Google sign-in script `accounts.google.com/gsi/client`, Drive API | google-account.js:30; drive-adapter.js:21-22 | not called in Fusion mode (projects off); excluded with the project layer |
| Add-in download json `downloads/shaper-addin.json` | addin-download.js:56 | not called in Fusion mode |
| Links opened by the user: ShaperHub My Files, shaper-sync credit | index.html:836, 904; main.js:185 | external links, not loads |
| Bundled fonts (text tool) `new URL('./vendor/fonts/...', import.meta.url)` | text-fonts.js:20-30 | inside the folder (relative); the text tool is a Design tool (UNUSED) |

Nothing in the Fusion path loads code or styles from shaper-svg.pages.dev: every module, stylesheet, three.js and the worker are relative
files today.

## 10. Rulings for STEP 2 (advisor + owner turn 3503 "ok good")

- Refactor, never a fork: main.js is split into shared wiring + web-only + Fusion-only parts; app-chrome, document-buffer and fusion-bridge
  TAKE the Drive / projects / templates layers as passed values instead of importing them. The website stays BEHAVIOUR-identical (not
  byte-identical), proven by the existing website and Fusion-mode tests plus shell-smoke; every changed / new module is listed.
- Rate & feedback and the "Enjoying Shaper?" card: UNUSED in the Fusion panel (they cannot send from 127.0.0.1): left out of the Fusion build.
- Insert STL (Prepare toolbar): ~~KEPT in the Fusion panel for now (owner to review later).~~ REMOVED from the Fusion panel: owner turn 3604
  ("Yes remove it"; "I dont need to add stl in the fusion addin"), task 885, see section 14.
- Send to ShaperHub offline (R1): out of scope; the open item for a follow-up task. functions/ and the add-in are not touched.
- STEP 3 targets http://127.0.0.1 only (file:// ruled out live).
- STEP 2 starts only once task 880 is on origin/main, merged in first.

## 11. Redesign direction (owner turns 3534-3535)

Recorded only; not built in this task (the redesign comes after the offline panel of sections 12-13).

1. OPERATION-FIRST in Fusion (like Fusion CAM): no "Add selection", no selection list, no imported copy of the geometry. The user clicks a
   cut type (Outside / Inside / Pocket / ...), Fusion's own selection dialog opens, they pick faces / edges for THAT operation, and the
   operation keeps those Fusion references; its path is computed from them (the add-in still extracts 2D for the engine, invisibly). When
   the part is edited in Fusion, the operation re-reads its references. SA-16's "Select in Fusion" per operation is the existing seed.
2. The panel's CANVAS shows the TOOLPATHS (like Export's Paths view), not the art: the geometry is already in Fusion's own view.
3. The website keeps its draw / open-file -> assign-cuts flow; only the Fusion panel changes.
4. Clarification (owner turn 3538): point 2 is PREPARE's canvas: in the Fusion panel it shows the toolpaths, not the art. EXPORT keeps its
   views as today (the 3D / 2D / Paths simulation).
5. Owner turns 3572-3582 (for AFTER the offline panel; not built now):
   - Fusion's Prepare has NO canvas: Fusion's own viewport shows the paths and the volumes.
   - HYBRID: native Fusion command dialogs create and edit operations and setups; the palette keeps the setups + operations list, Export,
     and the shared JS engine.
   - SETUPS (like Fusion CAM): one board each = the picked part(s) / bodies (the "Model") + the Stock (default: the parts' bounds + a
     margin, thickness from the part; or a picked sketch) + its operations + one SVG export. A file can mix separate boards and parts
     nested on one board; an operation's dialog accepts only faces of its setup's parts.
   - The Stock is an operation-like item, picked as a Fusion sketch.

## 12. STEP 2: the build (done)

`node scripts/build-site.cjs shaper-fusion [--out <dir>]` (default `dist-fusion/`, git-ignored) writes the Fusion panel folder. One source:

- **The page** is the website's `apps/shaper/index.html`, written as the folder's `index.html` with ONE change: its module script
  `src/main.js` becomes `src/fusion-main.js` (build-site.cjs `FUSION_PANEL.entry`; the build fails unless there is exactly one such script).
- **The boot**: `apps/shaper/src/shaper-app.js` (new) holds Shaper's page wiring, moved from main.js unchanged except where a page
  DECLARES its part (`startShaperApp({...})`: fusion, mountChrome, createDocumentBuffer, bufferStore, menu, beforeChrome, afterChrome,
  createImporter, mountDesignBrowser, createSettingsPanel, onDesignContext). `main.js` (the website, both modes) passes the website's
  parts; `fusion-main.js` (the panel) passes Fusion mode, the plain drawer with Log only, and an in-memory store.
- **Shared layers take what they used to import** (the Q1 ruling): `#ui/app-shell.js` (new: the header, a declared drawer, the
  analytics visit; `mountPlainSidebar`) under `#ui/app-chrome.js` (the shell + the project drawer + feedback + settings sync);
  `#ui/document-buffer-core.js` (the autosave loop, `store` passed) under `#ui/document-buffer.js` (default: the page's shared store);
  `#ui/project-store-core.js` (the store engine: no Google sign-in, Drive client or router) under `#ui/project-store.js` (re-exports it,
  adds `getProjectStore()`); `#ui/cloud/drive-errors.js` (driveErrorText, re-exported by drive-adapter.js); `CURRENT_DESIGN_KEY` defined in
  the store engine (router-adapter.js re-exports it); `mountFusionPrepareBar({ fusionMode })` (default: the page's `?host=fusion`, as
  before); the SKETCHES browser mount moved to `apps/shaper/src/shaper-browser.js`; `export-payload.js`, `fusion-bridge.js`,
  `fusion-import.js` and `design-canvas.js` import the core modules.
- **The folder** holds only what the panel page reaches (scripts/site-closure.cjs), plus `LICENSE.md`, `THIRD-PARTY-NOTICES.md`, the
  licence files of the vendor folders it reaches, and the manifest `fusion-panel.json`. References that only worked because a URL's `..`
  stops at the site root, or that start at the root, are rewritten in the panel's copy only (13: in index.html the import map's
  `../../packages/` values (4) and the sketcher.css link; `../../../packages/core/` imports (7) in src/op-derive.js and src/op-paths.js, the
  module worker's; `/assets/constraint-glyphs.svg` in packages/ui/glyph-sheet.js). The build then proves the folder: the same files as
  from the repo page, nothing missing, no reference leaving the folder when it is served under any path, nothing in it the page does not
  load (but the licences and the manifest).
- **Excluded by the module graph** (tests/fusion-panel-881-node.test.js asserts each is reached by the website and not by the panel, and
  is not in the folder): src/main.js, addin-download.js, cut-import.js, shaper-browser.js (shaperhub-login.js until task 886: the panel loads it now); packages/ui design-browser,
  app-chrome, sidebar-projects, project-actions, project-manager, document-tabs, save-button, account-avatar, file-dialog, sketch-import,
  feedback, style-panel, project-store, document-buffer, cloud/google-account, cloud/auth-state, cloud/providers, cloud/drive-adapter,
  cloud/router-adapter, cloud/settings-sync; about.html (and privacy.html). The website page reaches 275 files, the panel page 243 (after tasks 884 + 885: the website 276, the panel 241; task 885 took out 3, section 14; task 886 adds shaperhub-login.js: the panel 242).
- **Kept although the panel does not show them** (part of the shared Design tab engine the panel runs, or of a used module): the Design
  view's DOM and its tool ribbon instance (#design-ribbon; the ribbon module is Prepare's toolbar too), the sketch engine's text support
  (text-fonts.js, opentype, the bundled fonts: about 1.2 MB), the template picker's modal (transform-box.js uses it), the store engine's
  Drive write queue (drive-writer.js, content-print.js, drive-errors.js: never used with the memory store), analytics.js (track() is
  called by shared modules; it sends nothing from 127.0.0.1, analytics-events.js LOCAL_HOST).

Changed / new modules (the website's behaviour unchanged; the website build differs from the one before 881 by exactly these): NEW
src/shaper-app.js, src/fusion-main.js, src/shaper-browser.js, packages/ui/app-shell.js, document-buffer-core.js, project-store-core.js,
cloud/drive-errors.js; CHANGED src/main.js, design-canvas.js, export-payload.js, fusion-bridge.js, fusion-import.js, packages/ui/app-chrome.js,
document-buffer.js, project-store.js, cloud/drive-adapter.js, cloud/router-adapter.js. The website's index.html is byte-identical. The
website build also carries src/fusion-main.js (its app folder is copied whole); its page never loads it.

Behaviour differences for existing users: none intended. Two orders change with no observable effect: app-chrome starts the feedback
ask and the settings sync before the analytics visit (independent services), and the website's Google session probe runs once the stage
list is computed (beforeChrome) instead of just before it.

## 13. STEP 3: what the add-in must serve (SA-32)

- **One folder**, `index.html` at its top: `index.html`, `src/` (44 files), `styles/main.css`, `assets/` (3), `packages/` (196: core, ui
  with vendor/three, vendor/opentype, vendor/fonts), `LICENSE.md`, `THIRD-PARTY-NOTICES.md`, and `fusion-panel.json`. 247 files + the
  manifest, 7,681,254 bytes (build 2026-11-25, after tasks 884 + 885 + 886; 246 files, 7,673,186 bytes after 884 + 885; 248 files, 7,685,886 bytes before them). Every reference is relative and stays inside the folder, so it works at the server root
  or under a path.
- **The entry**: `index.html` (its module: `src/fusion-main.js`). No query string is needed: the panel is Fusion mode, with its workspace
  in the Fusion design (in memory in the page), by declaration. A `?host=fusion&project=design` the add-in still passes is ignored.
- **http only**: file:// is ruled out (live-checked by the advisor in Fusion 2706.1.17: module imports, module workers and import() are
  blocked on file://); not re-tested here.
- **What the server must do**: answer `GET /<path>` for every path in the manifest's `files` (case-exact, no rewrites, no extensionless
  URLs, no directory listing; `/` may answer index.html), with the media type of its extension (the manifest's `mime`): `.html`
  text/html, `.js` text/javascript (REQUIRED: the browser refuses a module script of any other type), `.css` text/css, `.svg`
  image/svg+xml, `.jpg` image/jpeg, `.woff` font/woff, `.json` application/json, `.txt` / `.license` / no extension text/plain, `.md`
  text/markdown. Anything else: 404. The reference server is `servePanel` in tests/fusion-panel-881-live.test.js.
- **Pin the release with the manifest**: `count`, `bytes`, and each file's `bytes` + `sha256`.
- **Keep the port fixed**: the panel's settings live in the page's localStorage (the tool table / My bits, units, the 3D look, the open
  stage), which belongs to the origin `http://127.0.0.1:<port>`: a new port each run starts from empty settings.
- **Run-time calls outside the folder** (the manifest's `network`): `/api/shaper-upload` from src/shaper-app.js, Send to ShaperHub (R1).
  On the add-in's server it answers 404, so Send to ShaperHub does not work offline; out of scope here (advisor ruling), the open item for
  a follow-up task. Nothing else is fetched from shaper-svg.pages.dev or any other host (the live test records every request: all to the
  panel's own server, all 200). Open ShaperHub (My Files) and the export status line's link open hub.shapertools.com in a new window (a
  link the user follows, not a load).

## 14. Task 885: no Insert STL in the Fusion panel (owner turn 3604)

Owner turn 3604: "Yes remove it"; "I dont need to add stl in the fusion addin". The website keeps Open STL, Insert STL and the STL card
exactly as before, plain and with `?host=fusion`.

- **Declared, not detected**: the STL part is one more thing the ENTRY passes to `startShaperApp`, like `createImporter` /
  `mountDesignBrowser`: `createStlImporter(ctx)` (stl-import.js: the STL card in Prepare, the importer Open / Insert STL call) and
  `prepareLeadGroups(app)` (the Prepare toolbar's sections before Operations). `main.js` passes stl-import.js's `createStlImporter` and
  the INSERT section (`insertStlGroup`, moved unchanged from shaper-app.js); `fusion-main.js` passes neither. shaper-app.js no longer
  imports stl-import.js. No branch on Fusion mode.
- **Without the part**: Prepare's toolbar starts with OPERATIONS (no INSERT section, no empty one, no label: `leadGroups` is `[]`);
  no STL card is mounted; the restore's `reimportOld()` (task 807, a design saved with an STL before 807 sliced again) runs only on a page
  with the part (`if (stlImporter)`, as `if (shaperImporter)` for the SVG / DXF drop); `app.stlImporter()` is null and nothing in the
  panel calls it (its callers are main.js's drawer entries and toolbar button). `nameAfterSelection`'s comment now says an opened STL
  names the design on the website (main.js's Open STL); in the panel only a Fusion selection does.
- **Out of the panel's folder** (tests/fusion-panel-881-node.test.js UNUSED, each still reached by the website): src/stl-import.js,
  src/stl-card.js, src/orient-view.js. Kept (reached by shared modules: the saved document's STL sources and the relief engine):
  src/stl-source.js (shaper-doc.js, selection-list.js, selection-edit.js, fusion-import.js), packages/core/stl-slice.js (height-map.js,
  level-smooth.js, stepped-cut.js), src/relief-frame.js (cut-plan.js, fusion-import.js). The panel page reaches 3 files fewer than before it (243 -> 240 at origin/main e6d98227; 241 with task 884 merged).
- **Behaviour change in the panel only**: a workspace saved in a Fusion design by the website in Fusion mode WITH an inserted STL keeps its
  relief operations (they are ordinary cut-plan entries) but has no STL card to re-slice or re-orient that part in the panel; a design
  saved with an STL before task 807 is not re-sliced as a relief when it opens in the panel.
