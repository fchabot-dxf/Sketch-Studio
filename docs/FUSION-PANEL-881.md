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
| Prepare toolbar "Insert STL" (lead group) | main.js:639-640, 648-653; stl-import.js | present in Fusion today; **owner to decide** (a Fusion design brings its geometry from Fusion; the drawer's STL entries are already hidden) |
| STL card in Prepare (an imported STL's settings) | stl-card.js; main.js:664-666 | only with an inserted STL: follows the Insert STL decision |
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
- Insert STL (Prepare toolbar): KEPT in the Fusion panel for now (owner to review later).
- Send to ShaperHub offline (R1): out of scope; the open item for a follow-up task. functions/ and the add-in are not touched.
- STEP 3 targets http://127.0.0.1 only (file:// ruled out live).
- STEP 2 starts only once task 880 is on origin/main, merged in first.

## 11. Redesign direction (owner turns 3534-3535)

Recorded only; not built in this task (STEP 2 still waits for task 880).

1. OPERATION-FIRST in Fusion (like Fusion CAM): no "Add selection", no selection list, no imported copy of the geometry. The user clicks a
   cut type (Outside / Inside / Pocket / ...), Fusion's own selection dialog opens, they pick faces / edges for THAT operation, and the
   operation keeps those Fusion references; its path is computed from them (the add-in still extracts 2D for the engine, invisibly). When
   the part is edited in Fusion, the operation re-reads its references. SA-16's "Select in Fusion" per operation is the existing seed.
2. The panel's CANVAS shows the TOOLPATHS (like Export's Paths view), not the art: the geometry is already in Fusion's own view.
3. The website keeps its draw / open-file -> assign-cuts flow; only the Fusion panel changes.
