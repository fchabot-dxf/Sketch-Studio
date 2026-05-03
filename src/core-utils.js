// DEPRECATED: `core-utils.js` was a re-export shim used for backward compatibility.
// All modules should import directly from the specific core modules to avoid
// indirection and circular dependency risk. The previous exports (constants,
// geometry helpers, constraints helpers, shapes, joints) are now available from
// their respective modules under `./core/` (e.g., `./core/geometry.js`).

// Temporarily keep a helpful error to catch accidental imports and guide devs.
export default function deprecatedCoreUtils(){
    throw new Error('core-utils.js has been removed. Import directly from core/* modules (e.g. ./core/geometry.js, ./core/constants.js).');
}

