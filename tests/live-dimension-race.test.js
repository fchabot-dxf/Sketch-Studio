(async () => {
  const { setupLiveDimensionInput, showSingleInput } = await import('#ui/input-handlers/live-dimension-input.js');
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  // Minimal DOM shim: track created elements by id
  const created = {};
  global.document = global.document || {};
  global.document.body = global.document.body || { appendChild(){}};
  global.document.createElement = (tag) => {
    const el = {
      tagName: tag.toUpperCase(),
      style: {},
      value: '',
      id: null,
      _children: [],
      _handlers: {},
      addEventListener(name, handler){ this._handlers[name] = handler; },
      removeEventListener(){},
      focus(){},
      select(){},
      setAttribute(){},
      appendChild(child){ this._children.push(child); },
    };
    // After id is assigned by module, store by id for lookup
    Object.defineProperty(el, 'id', {
      set(v){ this._id = v; created[v] = this; },
      get(){ return this._id; }
    });
    return el;
  };

  global.window = global.window || {};
  // Minimal event handling on `window` for tests
  global.window._windowHandlers = global.window._windowHandlers || {};
  global.window.addEventListener = (name, handler) => { global.window._windowHandlers[name] = global.window._windowHandlers[name] || []; global.window._windowHandlers[name].push(handler); };
  global.window.dispatchEvent = (evt) => { const list = global.window._windowHandlers[evt.type] || []; for (const h of list) try { h(evt); } catch(_){ } };

  // Listen for applications
  let appliedCount = 0;
  window.addEventListener('liveDimensionApplied', () => { appliedCount++; });

  // Setup the module which creates the elements
  setupLiveDimensionInput();

  // Find single input element
  const singleContainer = created['liveDimSingleInput'];
  const singleInput = created['liveDimSingle'];
  assert(singleInput, 'Single input should be created by setup');

  // Show single input to make sure it's active
  showSingleInput(100, 100, 12.3, 'length');

  // Simulate Enter: call keydown handler
  if (singleInput._handlers['keydown']) {
    singleInput.value = '25';
    singleInput._handlers['keydown']({ key: 'Enter', preventDefault(){}});
  } else {
    throw new Error('keydown handler not attached to single input');
  }

  // Simulate immediate blur (which would have scheduled an apply after 100ms)
  if (singleInput._handlers['blur']) {
    singleInput._handlers['blur']();
  } else {
    throw new Error('blur handler not attached to single input');
  }

  // Wait enough time for any scheduled blur handler to run
  await new Promise(resolve => setTimeout(resolve, 200));

  // Applied event should have fired exactly once (Enter should suppress blur double-apply)
  assert(appliedCount === 1, 'liveDimensionApplied should be dispatched exactly once after Enter + blur');

  console.log('live-dimension-race tests passed ✅');
})().catch(e => { console.error('live-dimension-race tests failed ❌', e); process.exit(1); });