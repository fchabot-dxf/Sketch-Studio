#!/usr/bin/env python3
"""
handoff.py - turn-marker coordination for the advisor/worker handoff.

WHY THIS EXISTS
  The old triggers watched file CONTENT (sha256 of NEXT-SESSION.md / WORK-LOG.md):
  they fired on every save and every commit, and they re-baselined to "now" after
  each run -> a write in the re-arm gap was lost and the loop silently stalled.
  Fix: ONE monotonic turn counter + a "ball" (whose turn it is), written atomically.
  Reading the plan/log is DECOUPLED from triggering; the only trigger is a single
  `pass` you call LAST. A waiter fires only when turn > the last turn IT handled.

import sys: Windows consoles default to cp1252 and crash printing notes with arrows/
emoji; we force UTF-8 below.

SIGNATURE -- ONE number for live turns, so the gap between windows is obvious
  turn = monotonic, +1 on EVERY pass. Each agent signs the turn IT HANDLED (woke on) --
  NOT the turn its `pass` created (that one belongs to the other side). So the two windows
  are always EXACTLY ONE apart: the HIGHER turn is the latest response, the LOWER turn is
  the window that owes the next move -- trigger that one.
  Get yours verbatim:  handoff.py sig --role <you>   ->  "turn N"

  DONE is NOT a turn. When the advisor ends the loop it does NOT pass, so there is no
  handoff to number. It runs `handoff.py done` and signs "cycle N DONE" -- N = how many
  task rounds (advisor dispatches) completed. cycle is used ONLY here, never per-turn.

SETTLE (debounce)
  wait/watch don't act the instant the ball flips -- they require HANDOFF.md to stay
  unchanged for --settle seconds (default 20) first. With the advisor calling `pass` LAST,
  this stops the worker starting before the advisor is done.

MARKER FILE (repo root):  HANDOFF.md   -- written ONLY via this tool, never hand-edited
    cycle: 3          # rounds dispatched so far (only surfaced at DONE)
    turn: 7
    to: worker        # advisor | worker | done
    from: advisor
    updated: 2026-06-27T14:03:11Z
    note: implement the final sweep

PER-ROLE PROGRESS (gitignore):  .handoff/<role>.last = last turn handled · .handoff/<role>.done = last DONE cycle acked

The worker NEVER kills its watcher: DONE wakes it ONCE to sign 'cycle N DONE', then it re-arms
and idles. Only the human (Ctrl-C / STOP) ends it; a later advisor dispatch starts the next batch.

SUBCOMMANDS
  init  [--to advisor|worker] [--note ...]   create HANDOFF.md at turn 0
  pass  --to advisor|worker  [--note ...]    end my turn: turn+=1 (cycle+=1 if --to worker)  (call LAST)
  done  [--note ...]                          advisor ends the loop: no turn; prints "cycle N DONE" to sign
  wait  --role advisor|worker [--timeout S] [--settle S]   block until ball is mine on a NEW settled turn (exits if DONE)
  watch --role advisor|worker --cmd "..." [--settle S]     headless: each new settled turn, run --cmd once
  sig   --role advisor|worker                print "turn N" = the turn THAT role last handled (your signature)
  status                                     print turn + which window the human should trigger
  amend --to advisor|worker --note ...       queue a MID-TASK amendment (no turn/ball change) -- the other side sees it at their next `amendments` checkpoint. Use INSTEAD of a re-pass once they are past settle + working (a re-pass would be orphaned).
  amendments --role advisor|worker [--peek]  print + consume mid-task amendments addressed to me on THIS turn. Run at each checkpoint (before commit, phase boundary, before pass-back). --peek = look without consuming.

MID-TASK AMENDMENTS (the mailbox)
  `pass` only lands within the settle window; once the other side is working, a re-pass is
  orphaned. `amend` drops a turn-stamped line in .handoff/amendments.tsv WITHOUT changing the
  turn/ball; the recipient polls it via `amendments` at natural checkpoints. It is a POLL not
  an interrupt -- the amendment lands at their next stopping point, before they finalize.
"""
import argparse, os, sys, time, tempfile
from datetime import datetime, timezone

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

MARKER = "HANDOFF.md"
STATE_DIR = ".handoff"
STOP = "STOP"
OTHER = {"advisor": "worker", "worker": "advisor"}
BALLS = ("advisor", "worker", "done")


def _guard_forked_marker():
    """SPLIT-BRAIN guard (field-proven 2026-07-15): running from a SUBDIR of the loop root silently forks a second
    HANDOFF.md + .handoff/ there -- passes/waits act on the fork, the other role never sees them, the loop stalls
    with no error. If no marker exists HERE but one exists in a parent directory, refuse and name the real root."""
    if os.path.exists(MARKER):
        return
    d = os.path.dirname(os.path.abspath(os.getcwd()))
    while True:
        if os.path.exists(os.path.join(d, MARKER)):
            sys.stderr.write("SPLIT-BRAIN GUARD: no %s here, but the loop root is %s\n"
                             "cd there and re-run -- a nested marker forks the loop (no override; cd to the root).\n"
                             % (MARKER, d))
            sys.exit(2)
        parent = os.path.dirname(d)
        if parent == d:
            return
        d = parent


def now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def read_marker():
    d = {}
    try:
        with open(MARKER, encoding="utf-8") as f:
            for line in f:
                if ":" in line:
                    k, _, v = line.partition(":")
                    d[k.strip()] = v.strip()
    except (FileNotFoundError, OSError):
        return None
    try:
        d["turn"] = int(d.get("turn", "0"))
        d["cycle"] = int(d.get("cycle", "0"))
    except ValueError:
        return None
    if d.get("to") not in BALLS:
        return None
    return d


def write_marker(cycle, turn, to, frm, note=""):
    body = (f"cycle: {cycle}\n"
            f"turn: {turn}\n"
            f"to: {to}\n"
            f"from: {frm}\n"
            f"updated: {now()}\n"
            f"note: {note}\n")
    fd, tmp = tempfile.mkstemp(dir=".", prefix=".handoff-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(body)
        os.replace(tmp, MARKER)          # atomic on the same filesystem
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def read_last(role):
    """Last turn this role handled. Tolerates the old 'cycle turn' two-token format."""
    try:
        with open(os.path.join(STATE_DIR, role + ".last"), encoding="utf-8") as f:
            toks = f.read().split()
        if toks:
            return int(toks[-1])
    except (FileNotFoundError, ValueError, OSError):
        pass
    return 0


def set_handled(role, turn):
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(os.path.join(STATE_DIR, role + ".last"), "w", encoding="utf-8") as f:
        f.write(str(turn))


def read_acked_done(role):
    """Highest DONE cycle this role has already acknowledged (so it fires DONE once, then idles)."""
    try:
        with open(os.path.join(STATE_DIR, role + ".done"), encoding="utf-8") as f:
            return int(f.read().strip() or "0")
    except (FileNotFoundError, ValueError, OSError):
        return 0


def set_acked_done(role, cycle):
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(os.path.join(STATE_DIR, role + ".done"), "w", encoding="utf-8") as f:
        f.write(str(cycle))


def mine(m, role):
    return m is not None and m["to"] == role and m["turn"] > read_last(role)


def settled(role, turn, settle, poll):
    """Debounce: after detecting our turn, require HANDOFF.md to stay unchanged for
    `settle` seconds before we act, so we never start before the other side has finished."""
    end = time.time() + settle
    while time.time() < end:
        if os.path.exists(STOP):
            return False
        time.sleep(min(poll, max(0.05, end - time.time())))
        m = read_marker()
        if not m or m["turn"] != turn or m["to"] != role:
            return False
    return True


def cmd_init(a):
    if read_marker() and not a.force:
        print("%s already exists (use --force to reset)." % MARKER)
        return 1
    to = a.to or "advisor"
    write_marker(0, 0, to, OTHER[to], a.note or "point the advisor at a task list")
    print("init: turn 0, ball -> %s" % to)
    return 0


def cmd_pass(a):
    m = read_marker()
    caller = OTHER[a.to]
    cycle = (m["cycle"] if m else 0) + (1 if a.to == "worker" else 0)
    turn = (m["turn"] if m else 0) + 1
    write_marker(cycle, turn, a.to, caller, a.note or "")
    print("pass: created turn %d for %s -- that is THEIR number." % (turn, a.to))
    print("you (%s) SIGN your handled turn: turn %d   (not the turn above)" % (caller, read_last(caller)))
    return 0


def cmd_done(a):
    m = read_marker()
    cycle = m["cycle"] if m else 0
    turn = m["turn"] if m else 0
    write_marker(cycle, turn, "done", "advisor", a.note or "loop complete")
    print("done: loop complete after %d cycle(s)." % cycle)
    print("you (advisor) SIGN this message: cycle %d DONE   (the DONE message is not a turn)" % cycle)
    return 0


def cmd_wait(a):
    role = a.role
    deadline = (time.time() + a.timeout) if a.timeout else None
    while True:
        if os.path.exists(STOP):
            print("STOP present - exiting.")
            return 2
        m = read_marker()
        if m and m["to"] == "done":
            if m["cycle"] > read_acked_done(role):
                set_acked_done(role, m["cycle"])
                print("loop DONE (cycle %d) - the advisor ended this batch." % m["cycle"])
                print("   sign this message: cycle %d DONE, then RE-ARM wait (keep listening)." % m["cycle"])
                return 3
            # already acknowledged -> fall through and idle; a future pass wakes you for the next batch
        if mine(m, role):
            t0 = m["turn"]
            if not settled(role, t0, a.settle, a.poll):
                continue
            m = read_marker()
            set_handled(role, t0)
            print(">> turn %d is yours (%s) [settled %gs]. from=%s note=%s"
                  % (t0, role, a.settle, m.get("from"), m.get("note", "")))
            print("   sign this message: turn %d" % t0)
            return 0
        if deadline and time.time() >= deadline:
            print("timeout - still waiting (re-arm).")
            return 75
        time.sleep(a.poll)


def cmd_watch(a):
    import subprocess
    role = a.role
    n = 0
    print("watch: role=%s, max=%d runs. Ctrl-C / touch STOP to halt." % (role, a.max))
    while n < a.max:
        if os.path.exists(STOP):
            print("STOP present - exiting.")
            return 2
        m = read_marker()
        if m and m["to"] == "done":
            if m["cycle"] > read_acked_done(role):
                set_acked_done(role, m["cycle"])
                print("loop DONE (cycle %d) - batch complete; idling, still watching for the next batch." % m["cycle"])
            time.sleep(a.poll)
            continue
        if mine(m, role):
            t0 = m["turn"]
            if not settled(role, t0, a.settle, a.poll):
                continue
            set_handled(role, t0)
            n += 1
            print(">>> turn %d -> running (%d/%d) [settled %gs]" % (t0, n, a.max, a.settle))
            subprocess.run(a.cmd, shell=True)
            print(">>> done; back to watching.")
        time.sleep(a.poll)
    print("reached max %d runs - stopping." % a.max)
    return 0


def cmd_sig(a):
    print("turn %d" % read_last(a.role))
    return 0


def cmd_status(a):
    m = read_marker()
    if not m:
        print("no HANDOFF.md - run: python handoff.py init")
        return 1
    if m["to"] == "done":
        print("HANDOFF: LOOP DONE at cycle %d   (note: %s)" % (m["cycle"], m.get("note", "")))
        print("=> nothing to trigger; the run is complete.")
        return 0
    ball = m["to"]
    owed = m["turn"] > read_last(ball)
    print("HANDOFF turn %d - ball -> %s   (note: %s)" % (m["turn"], ball.upper(), m.get("note", "")))
    print("  advisor signs: turn %d" % read_last("advisor"))
    print("  worker  signs: turn %d" % read_last("worker"))
    if owed:
        print("=> %s owes turn %d. TRIGGER THE %s WINDOW (the lower-numbered one)."
              % (ball.upper(), m["turn"], ball.upper()))
    else:
        print("=> %s holds the latest turn (%d) and has NOT passed -- it is mid-work,"
              % (ball.upper(), m["turn"]))
        print("   about to pass, or (if it ended on a question) waiting on YOU. Answer the asker,")
        print("   not the lower-turn bot -- 'trigger the lower one' is only for advancing the loop.")
    return 0


def _amend_file():
    return os.path.join(STATE_DIR, "amendments.tsv")


def read_amseen(role):
    """How many amendment lines this role has already consumed."""
    try:
        with open(os.path.join(STATE_DIR, role + ".amseen"), encoding="utf-8") as f:
            return int(f.read().strip() or "0")
    except (FileNotFoundError, ValueError, OSError):
        return 0


def set_amseen(role, n):
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(os.path.join(STATE_DIR, role + ".amseen"), "w", encoding="utf-8") as f:
        f.write(str(n))


def cmd_amend(a):
    """Queue a MID-TASK amendment for the other role WITHOUT advancing the turn/ball.
    Use this (NOT `pass`) to inject new instructions once the other side is already past
    settle + working: a re-pass would be orphaned, but this waits in the mailbox until they
    check `amendments` at their next checkpoint. It is a POLL, not an interrupt -- the other
    side sees it at their next stopping point (before commit / pass-back), not mid-thought."""
    m = read_marker()
    turn = m["turn"] if m else 0
    os.makedirs(STATE_DIR, exist_ok=True)
    note = (a.note or "").replace("\t", " ").replace("\r", " ").replace("\n", " ")
    with open(_amend_file(), "a", encoding="utf-8") as f:
        f.write("%d\t%s\t%s\t%s\n" % (turn, a.to, now(), note))
    print("amend: queued for %s on turn %d -- they pick it up at their next `amendments` checkpoint (not instant)." % (a.to, turn))
    return 0


def cmd_amendments(a):
    """Print NEW mid-task amendments addressed to me for the CURRENT turn, then mark them
    consumed (--peek to look without consuming). Run at each checkpoint: before you commit,
    at a phase boundary, and before you pass back -- so a late instruction lands before you
    finalize the wrong thing."""
    role = a.role
    m = read_marker()
    turn = m["turn"] if m else 0
    try:
        with open(_amend_file(), encoding="utf-8") as f:
            lines = f.read().splitlines()
    except (FileNotFoundError, OSError):
        lines = []
    seen = read_amseen(role)
    fresh = []
    for ln in lines[seen:]:
        parts = ln.split("\t", 3)
        if len(parts) == 4 and parts[1] == role and parts[0] == str(turn):
            fresh.append(parts[3])
    if not a.peek:
        set_amseen(role, len(lines))   # advance past all lines read (future ones append beyond, seen next check)
    if fresh:
        print("AMENDMENTS for turn %d (%d new) -- INCORPORATE before you commit/pass:" % (turn, len(fresh)))
        for n in fresh:
            print("  - " + n)
    else:
        print("no new amendments (turn %d)." % turn)
    return 0


def main():
    _guard_forked_marker()
    p = argparse.ArgumentParser(description="advisor/worker turn-marker handoff")
    sub = p.add_subparsers(dest="cmd", required=True)

    pi = sub.add_parser("init")
    pi.add_argument("--to", choices=["advisor", "worker"])
    pi.add_argument("--note"); pi.add_argument("--force", action="store_true")
    pi.set_defaults(fn=cmd_init)

    pp = sub.add_parser("pass")
    pp.add_argument("--to", choices=["advisor", "worker"], required=True)
    pp.add_argument("--note"); pp.set_defaults(fn=cmd_pass)

    pd = sub.add_parser("done")
    pd.add_argument("--note"); pd.set_defaults(fn=cmd_done)

    pw = sub.add_parser("wait")
    pw.add_argument("--role", choices=["advisor", "worker"], required=True)
    pw.add_argument("--poll", type=float, default=2.0)
    pw.add_argument("--timeout", type=float, default=0.0)
    pw.add_argument("--settle", type=float, default=20.0)
    pw.set_defaults(fn=cmd_wait)

    pc = sub.add_parser("watch")
    pc.add_argument("--role", choices=["advisor", "worker"], required=True)
    pc.add_argument("--cmd", required=True)
    pc.add_argument("--poll", type=float, default=2.0)
    pc.add_argument("--max", type=int, default=12)
    pc.add_argument("--settle", type=float, default=20.0)
    pc.set_defaults(fn=cmd_watch)

    pg = sub.add_parser("sig")
    pg.add_argument("--role", choices=["advisor", "worker"], required=True)
    pg.set_defaults(fn=cmd_sig)

    ps = sub.add_parser("status"); ps.set_defaults(fn=cmd_status)

    pam = sub.add_parser("amend")
    pam.add_argument("--to", choices=["advisor", "worker"], required=True)
    pam.add_argument("--note", required=True)
    pam.set_defaults(fn=cmd_amend)

    pms = sub.add_parser("amendments")
    pms.add_argument("--role", choices=["advisor", "worker"], required=True)
    pms.add_argument("--peek", action="store_true")
    pms.set_defaults(fn=cmd_amendments)

    a = p.parse_args()
    sys.exit(a.fn(a))


if __name__ == "__main__":
    main()
