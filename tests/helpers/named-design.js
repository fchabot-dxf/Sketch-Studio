// tests/helpers/named-design.js — TASK 558 save rule (owner, 2026-11-12: "Auto save only once I actually saved and named"): a fresh page
// shows an UNSAVED Untitled and stores nothing until its first named save. A live test that reads the AUTOSAVED design (IndexedDB) or
// carries a drawing across apps / reloads must first give the page a NAMED design, as a user with a saved design has.
//
// CREATE_NAMED_DESIGN(app, name): page JS (for evalJs) that stores a new named design in the page's shared project store, holding what a
// fresh page's first named save stores (the fixed origin joint only), and makes it the current one (resolves its id). The NEXT page load
// restores it, and from then on the app autosaves into it (the real restore path).
// (store.newDesign alone stores emptyDocument(), which has NO origin joint: finding F7 in docs/DOCUMENT-TABS-DESIGN.md.)
export const CREATE_NAMED_DESIGN = (app, name = 'Test design') => `import('/packages/ui/project-store.js').then(async (m) => {
  const store = m.getProjectStore();
  const d = await store.newDesign(${JSON.stringify(name)}, { app: ${JSON.stringify(app)} });
  const doc = m.emptyDocument(); doc.geometry.joints = [['j_origin', { x: 0, y: 0, fixed: true }]];
  await store.save(doc, { app: ${JSON.stringify(app)}, id: d.id });
  return d.id;
})`;
