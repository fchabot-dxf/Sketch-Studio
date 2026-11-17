/**
 * analytics/deployLib.mjs (TASK 738, ported from the DDCS worker's t4034 deployLib): the TESTABLE core of the deploy wrapper. No process spawning, no
 * file I/O, no process.exit here: those live in deploy.mjs, so tests/analytics-worker.test.js exercises this with fake results and never runs wrangler.
 *
 * Why a wrapper at all: the DDCS worker's wrangler.toml held its D1 placeholder for THREE MONTHS, because every `wrangler deploy` in that window
 * failed loud, but only in the one terminal that ran it, with nobody reading the output afterwards. Here the wrapper also refuses to start while a
 * placeholder is left in wrangler.toml.
 */

/** The REPLACE-WITH placeholders still in wrangler.toml's text (each as `key = "REPLACE-WITH-..."`), [] when there is none. */
export function placeholderProblems(tomlText) {
  return String(tomlText || '').split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('#') && /REPLACE-WITH/.test(line))
    .map((line) => line.trim());
}

/** A spawnSync-shaped result ({ status, error, stdout, stderr }) → { ok, entry, message, exitCode }. `entry` is the record deploy.mjs appends to its
 *  log; `message` is what to print. */
export function evaluateDeployResult(res) {
  const stdout = String((res && res.stdout) || '');
  const stderr = String((res && res.stderr) || '');
  const ok = !!res && res.status === 0 && !res.error;
  const entry = {
    ts: Date.now(),
    ok,
    status: res && res.status != null ? res.status : null,
    error: res && res.error ? String(res.error.message || res.error) : null,
    tail: (stdout + stderr).slice(-2000),
  };
  const message = ok
    ? '[deploy] OK: wrangler deploy succeeded.'
    : '[deploy] FAILED: wrangler deploy ' + (res && res.error ? ('could not run: ' + String(res.error.message || res.error)) : ('exited with code ' + (res && res.status)))
      + '. The analytics worker was NOT updated: production still runs whatever deployed last.';
  return { ok, entry, message, exitCode: ok ? 0 : ((res && res.status) || 1) };
}

/** The last logged attempt (or null) → a one-line status printed BEFORE the new attempt, so a silent gap shows the next time anyone deploys. */
export function formatLastAttempt(prev) {
  if (!prev) return null;
  const ago = Math.max(0, Math.round((Date.now() - prev.ts) / 86400000));
  return `[deploy] last attempt: ${prev.ok ? 'OK' : 'FAILED'}, ${ago} day${ago === 1 ? '' : 's'} ago (${new Date(prev.ts).toISOString()})`;
}

/** The log's text (one JSON object per line) → its LAST valid entry, or null. A corrupt line (a crash mid-write) is passed over for the one before it. */
export function parseLastLogLine(text) {
  const lines = String(text || '').trim().split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry = null;
    try { entry = JSON.parse(lines[i]); } catch (e) { console.warn(`[deploy] log line ${i + 1} is not JSON (${e.message}); reading the one before it`); }
    if (entry) return entry;
  }
  return null;
}
