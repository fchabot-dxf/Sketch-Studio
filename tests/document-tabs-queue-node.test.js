// tests/document-tabs-queue-node.test.js — TASK 628: a click on the strip's "+" or on a tab while the strip's own action is running is QUEUED and runs when
// that action settles; it is never dropped. Fake buffer and actions (the strip is pure DOM over them), the DOM from the node kit.
import assert from 'node:assert';
import { open, createProfile } from './helpers/node-app.js';
import { createDocumentTabs } from '#ui/document-tabs.js';

const profile = await createProfile();
const app = await open({ host: 'sketchstudio', profile });
try {
  const doc = app.document;
  const make = () => {
    let n = 1; let active = 'k1';
    const list = [{ key: 'k1', name: 'One' }];
    const buffer = { ready: Promise.resolve(), tabs: () => list.map((t) => ({ ...t, active: t.key === active })) };
    const gate = { holds: [] }; // promises the next actions wait on
    const wait = async () => { const h = gate.holds.shift(); if (h) await h.promise; };
    const hold = () => { let release; const promise = new Promise((r) => { release = r; }); gate.holds.push({ promise }); return release; };
    const log = [];
    const actions = {
      activateTab: async (key) => { log.push('activate ' + key); await wait(); active = key; },
      closeTab: async (key) => { log.push('close ' + key); await wait(); const i = list.findIndex((t) => t.key === key); if (i >= 0) list.splice(i, 1); if (active === key && list.length) active = list[0].key; },
      newDesign: async () => { log.push('new'); await wait(); const key = 'k' + (++n); list.push({ key, name: 'Untitled' }); active = key; },
    };
    const strip = createDocumentTabs({ getBuffer: () => buffer, store: null, pollMs: 1e9, doc, actions });
    doc.body.appendChild(strip.el);
    const settle = async () => { for (let i = 0; i < 4; i++) { await new Promise((r) => setTimeout(r, 5)); strip.refresh(); } };
    return { strip, hold, log, settle, count: () => strip.el.querySelectorAll('.sk-doctab-name').length, plus: () => strip.el.querySelector('.sk-doctab-new'),
      main: (i) => strip.el.querySelectorAll('.sk-doctab-main')[i], x: (i) => strip.el.querySelectorAll('.sk-doctab-x')[i] };
  };

  // "+" while a switch is held open: the new tab appears after it resolves
  {
    const t = make(); await t.settle();
    await t.plus().click(); await t.settle(); // two tabs: One, Untitled (active)
    assert.strictEqual(t.count(), 2);
    const release = t.hold();
    t.main(0).click(); await t.settle(); // the switch to One is now held open
    t.plus().click(); await t.settle();
    assert.strictEqual(t.count(), 2, 'the "+" waits while the switch runs');
    release(); await t.settle();
    assert.strictEqual(t.count(), 3, 'the "+" clicked while busy opened its tab after the switch');
    assert.deepStrictEqual(t.log, ['new', 'activate k1', 'new']);
  }

  // a double click on "+" while busy: two new tabs; a double click on a tab: one switch
  {
    const t = make(); await t.settle();
    await t.plus().click(); await t.settle();
    const release = t.hold();
    t.main(0).click(); await t.settle();
    t.plus().click(); t.plus().click(); t.main(1).click(); t.main(1).click(); await t.settle();
    release(); await t.settle();
    assert.strictEqual(t.count(), 4, 'two clicks on "+" while busy = two new tabs');
    assert.deepStrictEqual(t.log, ['new', 'activate k1', 'new', 'new', 'activate k2']);
  }

  // a close queued for a tab that is closed before it runs is dropped, and a close behind a switch still closes the tab asked for
  {
    const t = make(); await t.settle();
    await t.plus().click(); await t.settle();
    const release = t.hold();
    t.main(0).click(); await t.settle();
    t.x(1).click(); t.x(1).click(); await t.settle();
    release(); await t.settle();
    assert.strictEqual(t.count(), 1, 'the queued close ran once, on its own tab');
    assert.deepStrictEqual(t.log, ['new', 'activate k1', 'close k2']);
  }
  console.log('document-tabs-queue-node: ok');
} finally { await app.close(); }
