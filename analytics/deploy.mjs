#!/usr/bin/env node
/**
 * analytics/deploy.mjs (TASK 738, ported from the DDCS worker's t4034 deploy.mjs): run `wrangler deploy` with a failure that cannot be missed.
 *   node deploy.mjs        (from analytics/, after `wrangler login`; README.md "One-time setup")
 * - refuses to run while wrangler.toml still holds a REPLACE-WITH placeholder (the D1 database_id: README step 2);
 * - the exit code mirrors wrangler's own (0 = deployed);
 * - a failure prints an unmissable banner;
 * - every attempt is appended to .deploy-log.jsonl (gitignored, local to this machine), and the LAST attempt's age is printed before the next one.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { evaluateDeployResult, formatLastAttempt, parseLastLogLine, placeholderProblems } from './deployLib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const LOG = join(here, '.deploy-log.jsonl');
const banner = (lines) => { console.error('\n' + '='.repeat(70)); for (const l of lines) console.error(l); console.error('='.repeat(70)); };

const placeholders = placeholderProblems(readFileSync(join(here, 'wrangler.toml'), 'utf8'));
if (placeholders.length) {
  banner(['[deploy] REFUSED: wrangler.toml still has a placeholder:', ...placeholders.map((p) => '  ' + p), '[deploy] see README.md "One-time setup" (wrangler d1 create ...), then run this again.']);
  process.exit(1);
}

const prev = existsSync(LOG) ? parseLastLogLine(readFileSync(LOG, 'utf8')) : null;
const lastLine = formatLastAttempt(prev);
if (lastLine) console.log(lastLine);

console.log('[deploy] running: wrangler deploy (in ' + here + ')');
const res = spawnSync('wrangler', ['deploy'], {
  cwd: here,
  stdio: ['inherit', 'pipe', 'pipe'],
  encoding: 'utf8',
  shell: process.platform === 'win32', // wrangler is wrangler.cmd on Windows: spawnSync needs the shell to find it on PATH
});
if (res.stdout) process.stdout.write(res.stdout);
if (res.stderr) process.stderr.write(res.stderr);

const { ok, entry, message, exitCode } = evaluateDeployResult(res);
appendFileSync(LOG, JSON.stringify(entry) + '\n');
if (!ok) banner([message, '[deploy] recorded in ' + LOG + ': check it before assuming the analytics worker is current.']);
else console.log(message);
process.exitCode = exitCode;
