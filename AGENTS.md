# Worker seat rules (this repo runs a Claude advisor with worker seats)

Read natively by Antigravity and GitHub Copilot, and by Claude Code (imported from CLAUDE.md), so they hold for EVERY
worker, whatever runs it. They apply when the advisor gives you a task; the task's own instructions win on conflict.

## Opening a seat
If a message is just `worker`: reply exactly `🔨 WORKER SEAT READY: waiting for a task from the advisor.` and stop.
Don't read files or run anything; the advisor's first task tells you what you need.

## Project Principles
- Re-anchor here EVERY rep: see the **PROJECT PRINCIPLES** section at the top of NEXT-SESSION.md (North Star: ONE reusable Design tab; DECLARE over hand-roll; NO SHORTCUTS). Do not duplicate it here; read and follow it directly from NEXT-SESSION.md.

## Where and what
- Work ONLY in your seat's worktree: the one the task names (they live under `D:\APPS\Sketch-Studio-<seat>`, e.g.
  `D:\APPS\Sketch-Studio-agy1` on branch `agy1`), or, if it names none, the isolated worktree your session was created
  in (a Copilot Agents-window chat: VS Code made it, on an `agents/...` branch; your working directory is already
  there). Never run git in another folder, the main checkout included. If you are in the repo's MAIN checkout and the
  task names no worktree: stop and say so.
- Do exactly the one task. Report anything else you find; don't fix it.

## Running things
- Run tests and long commands in the FOREGROUND and wait for them. Don't background-and-poll.
- The repo gate is ONE runner, `scripts/gate.cjs`, in tiers (a file's tier comes from what it imports: a test that reaches `tests/helpers/cdp-browser.js`, or spawns a browser itself, is `live`; the rest is `quick`; `node scripts/gate.cjs --list` shows each). `npm run gate:quick` = every no-browser test in parallel, about a minute, no lock: run it WHILE you iterate. `npm run gate:live` = the browser tests + shell-smoke. `npm run gate:merge -- --base origin/main` = quick + shell-smoke + only the live tests AFFECTED by your commits (the changed files vs the merge-base, followed through the import graph into packages/ and apps/; it prints each live test picked and the changed file that pulled it in; a change to tests/helpers, package.json, scripts/gate.cjs, shell-smoke or packages/core/document.js runs every live test): run it ONCE before your REPORT (commit first). `npm run gate` = `full` = quick + live + the headless-left check: only when the task says so; the advisor runs it on main after merges. live/full take a machine-wide lock (`%LOCALAPPDATA%\sketch-studio-gate.lock`): a second run waits and prints who holds it, so never start a second one by hand and never delete the lock. Exit 0 = green. It prints `GATE tier=<t> jobs=<..> files=<n> pass=<n> fail=<n> elapsed=<s>`, `SMOKE <X/12>`, `HEADLESS-LEFT <n>` (live/full) and the 15 slowest files; each failing file's output tail is printed. Every task that touches code or tests must pass the full gate before reporting.
- A busy shared test slot or port is not a failure: wait and retry.
- Close every headless browser (CDP `Browser.close` plus a process-tree kill) and every server you started before you report. `proc.kill()` alone leaks on Windows.
- A shared live app: check its holder file before every call; if another seat holds it, wait.

## Evidence
- Copy every screenshot or artifact you cite to `<worktree>/.evidence/<task id>/` as soon as it's made (another run wipes `test-results/`). `.evidence/` is LOCAL: never commit it; one-off evidence scripts stay untracked too.
- A screenshot must show the feature at a legible size (zoom in or crop).
- Quote evidence verbatim from the file or command output, never from memory.
- Re-verify EVERY claim in your REPORT with a command run AFTER the change, and quote its output next to the claim: a removal → `git ls-tree -r --name-only <branch>` at the pushed head; a screenshot → re-open it and describe what it actually shows. A claim you didn't re-check goes under `uncertain:`.
- Before/after evidence = two DIFFERENT captures; put both files' md5 (`Get-FileHash -Algorithm MD5`) in the REPORT.

## Fixing
- Fix the cause in ONE place. No compensating overrides or symptom floors, and no copies of a fix in two places;
  if you think one is needed, stop and ask.
- No defensive extras the task didn't ask for: no hidden globals (`window.__x`), no silent `catch {}`, no
  environment-dependent second code path (tests and the app must run the same code).
- Shared files (`packages/core`, `packages/ui`): change only what the task names; a feature must not appear in hosts
  (SketchStudio, Shaper, Pen Plotter, Trace) that don't use it.
- After each removal, grep the callers of every function you touched; list in the REPORT any whose last non-test
  caller you removed.
- List every behaviour change for EXISTING users of the code. If there is any the task didn't ask for, STOP and ask.

## Waiting
- Never end a turn "waiting for" something. Run commands in the foreground; if nothing is running, carry on or
  report.

## Committing
- Commit BY PATH (`git commit <paths> -m ...`), never `git add -A` / `git add .`; files someone else staged stay out.
- Push your branch, never main. Merging is the advisor's.
- Append a WORK-LOG.md entry at the repo root headed with the task id (e.g. `## TURN <task id>`): what changed, why, the evidence. WORK-LOG.md is union-merged across branches.

## Talking to the advisor
- Need to tell it something mid-task (a heads-up, a fact another seat needs) without stopping? From your worktree:
  Antigravity or Copilot: `python D:/APPS/fred-skills/antigravity/fleet-plugin/fleet_hook.py message <task id> <text>` (appends to `<repo>/.fleet/inbox.jsonl`);
  Claude: SendMessage to the advisor. Then carry on. Messages for another seat go through the advisor.
- To ASK (you can't go on without an answer): end your turn with the REPORT, status BLOCKED, the question under `uncertain:`. Never guess to avoid asking.
- For EACH stop condition in the task, say in the REPORT how you checked it and the result. "Tests pass" is not a check unless a test asserts exactly that.

## End every task with exactly this block
```
🔨 REPORT <task id>
status: DONE | STOPPED | BLOCKED
commits: <first..last sha on <branch>>, pushed: yes/no
gate: <result>
stop conditions: <each: how checked, result>
evidence: <.evidence paths, verbatim output>
uncertain: <anything, or none>
headless browsers left: 0
```
When the advisor says GOODBYE (nothing more for you), reply `🪦 ARCHIVE ME: <task id>, nothing pending 🪦` so the owner can archive this seat.
