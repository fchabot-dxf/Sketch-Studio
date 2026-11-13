// tests/helpers/named-design.js — TASK 558 save rule (owner, 2026-11-12: "Auto save only once I actually saved and named"): a fresh page
// shows an UNSAVED Untitled and stores nothing until its first named save. A live test that reads the AUTOSAVED design (IndexedDB) or
// carries a drawing across apps / reloads must first give the page a NAMED design, as a user with a saved design has.
//
// CREATE_NAMED_DESIGN(app, name): page JS (for evalJs) that stores a new, empty, named design in the page's shared project store and makes it
// the current one (resolves its id). The NEXT page load restores it (with its fixed origin: deserializeDocument adds it, task 554), and from
// then on the app autosaves into it (the real restore path).
export const CREATE_NAMED_DESIGN = (app, name = 'Test design') =>
  `import('/packages/ui/project-store.js').then((m) => m.getProjectStore().newDesign(${JSON.stringify(name)}, { app: ${JSON.stringify(app)} })).then((d) => d.id)`;
