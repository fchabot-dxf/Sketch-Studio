# TASK 530 phase 2 -- OUTSIDE driver: python drag-batch-run.py <RUN dir> [--shot-only]. Reads RUN/plan.json (written by drag-batch-setup.py inside Fusion) and performs
# every drag of the batch with real mouse input (win-mouse.py: all its guards apply before and during every drag). Writes RUN/driver-log.json.
# Aborts the whole batch at the first guard failure (foreground not Fusion, cursor moved by someone else, cursor in a screen corner, point outside the canvas).
import importlib.util, json, os, sys, time
here = os.path.dirname(os.path.abspath(__file__))
s = importlib.util.spec_from_file_location('wm', os.path.join(here, 'win-mouse.py')); wm = importlib.util.module_from_spec(s); s.loader.exec_module(wm)
RUN = sys.argv[1]
plan = json.load(open(os.path.join(RUN, 'plan.json')))
hdr = json.load(open(os.path.join(RUN, 'drag-cells.json')))['path']
CANVAS = [-2540, 705, -300, 1540]
m = wm.main_window()
if not m: print(json.dumps({'ok': False, 'abort': 'no Fusion window'})); sys.exit(2)
wm.u.SetForegroundWindow(m); time.sleep(0.5)
ok, f, ft = wm.fg_is_fusion()
if not ok: print(json.dumps({'ok': False, 'abort': 'Fusion not foreground: %r' % ft})); sys.exit(2)
from PIL import ImageGrab
ImageGrab.grab(bbox=tuple(wm.rect(m)), all_screens=True).save(os.path.join(RUN, 'batch-%s-before.png' % plan['batch']))
if '--shot-only' in sys.argv: print('shot'); sys.exit(0)
log = []; t0 = time.time()
for it in plan['items']:
    (x1, y1), (x2, y2) = it['from_px'], it['to_px']
    t = time.time()
    try:
        r = wm.drag(x1, y1, x2, y2, hdr['ms'], hdr['steps'], CANVAS, hdr['settleMs'])
    except SystemExit:
        log.append({'slot': it['slot'], 'abort': True}); json.dump({'done': log}, open(os.path.join(RUN, 'driver-log.json'), 'w'))
        print(json.dumps({'ok': False, 'abort': 'guard stopped the run at ' + it['slot'], 'done': len(log) - 1})); sys.exit(2)
    log.append({'slot': it['slot'], 'secs': round(time.time() - t, 2)})
    time.sleep(0.25)
ImageGrab.grab(bbox=tuple(wm.rect(m)), all_screens=True).save(os.path.join(RUN, 'batch-%s-after.png' % plan['batch']))
json.dump({'done': log}, open(os.path.join(RUN, 'driver-log.json'), 'w'))
print(json.dumps({'ok': True, 'drags': len(log), 'secs': round(time.time() - t0, 1)}))
