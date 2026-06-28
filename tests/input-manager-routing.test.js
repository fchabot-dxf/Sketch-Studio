(async () => {
    const fs = await import('fs');
    const path = '../packages/ui/input-manager.js';
    const src = fs.readFileSync(new URL(path, import.meta.url));
    const str = String(src);
    const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };
    assert(str.includes('case TOOL_MODES.EQUAL'), 'TOOL_MODES.EQUAL case missing from input-manager switch');
    assert(str.includes('case TOOL_MODES.MIDPOINT'), 'TOOL_MODES.MIDPOINT case missing from input-manager switch');
    console.log('input-manager routing test passed ✅');
})().catch(e => { console.error('input-manager routing test failed ❌', e); process.exit(1); });