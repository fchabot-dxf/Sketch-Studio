(async () => {
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };
  const { setupUI } = await import('../src/ui-manager.js');
  // const { setupArcTool } = await import('../src/ui/input-handlers/arc-tool.js');
  // Minimal DOM: arc icon container with variants and dropdown
  let doc;
  if (typeof document !== 'undefined' && typeof document.querySelectorAll === 'function') {
    doc = document;
  } else {
    // Lightweight mock DOM for tests (avoids adding jsdom as a dependency)
    const arc3 = { classList: new Set(), style: { display: '' } };
    const arcCse = { classList: new Set(), style: { display: 'none' } };
    const icon = {
      querySelectorAll: (sel) => {
        if (sel === '.tool-icon-variant') return [arc3, arcCse];
        if (sel.includes('.arc-icon-3pt')) return [arc3];
        if (sel.includes('.arc-icon-cse')) return [arcCse];
        return [];
      }
    };
    function makeClassList() {
      const s = new Set();
      return {
        add: (c) => s.add(c),
        remove: (c) => s.delete(c),
        contains: (c) => s.has(c),
        has: (c) => s.has(c),
        toggle: (c, v) => { if (v) s.add(c); else s.delete(c); },
        _set: s
      };
    }

    const dropdownItems = [ { dataset: { mode: 'arc-3pt' }, classList: makeClassList() }, { dataset: { mode: 'arc-cse' }, classList: makeClassList() } ];
    const dropdown = { querySelectorAll: () => dropdownItems };
    const label = { innerText: '' };
    global.document = {
      getElementById: (id) => id === 'arc-icon' ? icon : (id === 'arc-dropdown' ? dropdown : (id === 'arc-label' ? label : null)),
      querySelectorAll: (sel) => {
        if (sel === '#arc-dropdown .tool-dropdown-item') return dropdownItems;
        return [];
      },
      addEventListener: () => {}
    };
    doc = global.document;
  }

  // State without arcMode to trigger fallback + UI update
  const state = { currentTool: 'arc' };
  // Run full UI setup so dropdown/button UI is updated as in normal app init
  setupUI(state);

  assert(state.arcMode === 'arc-cse', 'setupUI should set default arc mode to arc-cse');

  // Check that cse variant exists
  const icon = doc.getElementById('arc-icon');
  const cses = Array.from(icon.querySelectorAll('.arc-icon-cse'));
  assert(cses.length > 0, 'cse icon elements should exist');


  console.log('arc-icon tests passed ✅');
})().catch(e => { console.error('arc-icon tests failed ❌', e); process.exit(1); });