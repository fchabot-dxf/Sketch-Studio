# TASK 530 phase 1 -- OUTSIDE mouse driver for the Fusion drag oracle. Real Windows input (SendInput), Fusion window only.
# Usage:
#   python win-mouse.py info                         -> JSON: foreground window, Fusion windows, DPI, screen size, cursor
#   python win-mouse.py shot OUT.png                 -> screenshot of the Fusion window rect (no input)
#   python win-mouse.py front                        -> SetForegroundWindow(Fusion main window), verify, no key/mouse
#   python win-mouse.py drag X1 Y1 X2 Y2 [MS] [STEPS] [LEFT TOP RIGHT BOTTOM] [SETTLE_MS]  -> press at (X1,Y1), move in STEPS over MS ms, release
#   python win-mouse.py click X Y [LEFT TOP RIGHT BOTTOM]      -> move there, one left click          (task 551)
#   python win-mouse.py dblclick X Y [LEFT TOP RIGHT BOTTOM]   -> move there, a double click          (task 551)
#   python win-mouse.py key SPEC [SPEC ...]                    -> keys, one after the other. SPEC = one key (l r c d esc enter 0-9 minus dot),
#                                                                a chord (ctrl+z ctrl+y ctrl+shift+z) or type:TEXT (digits - . only)   (task 551)
#   python win-mouse.py dismiss TITLE_SUBSTR X Y               -> ONLY way to touch a Fusion dialog: the foreground window must be a Fusion360.exe window whose title
#                                                                contains TITLE_SUBSTR and (X,Y) must lie inside that window; one click, nothing else (task 551)
#                                                                OWNER RULE (2026-11-12): dismiss is for the CANCEL button of a Fusion dialog ONLY (never OK / Yes /
#                                                                Save / Delete); screenshot the dialog first, name the button clicked in the REPORT.
#   Env FUSION_DOC = a substring the Fusion main window title must contain (the scratch document); checked before EVERY mouse/key action.
# Safety (all enforced here, before AND during the drag): foreground window must be Fusion360.exe's main window; both points must be
# inside the canvas rect passed in (default: the Fusion window client rect); cursor in a screen corner (<=3 px) aborts the run; if the
# cursor is moved by anyone while dragging the button is released at once and the run aborts. Keys (task 551) are only sent by `key`, under the same
# guards: foreground = Fusion main window or Fusion's own 'HUD:QTView' input box (a dialog or another window in front aborts), title contains FUSION_DOC, cursor not in a corner, and the
# cursor is where THIS driver last left it (state file in %TEMP%): if anyone moved it between two calls the run aborts.
import ctypes, ctypes.wintypes as w, json, sys, time, os
ctypes.windll.shcore.SetProcessDpiAwareness(2)      # per-monitor aware: all coordinates are physical pixels
u = ctypes.windll.user32; k = ctypes.windll.kernel32
SW, SH = u.GetSystemMetrics(0), u.GetSystemMetrics(1)

def title(h):
    n = u.GetWindowTextLengthW(h); b = ctypes.create_unicode_buffer(n + 1); u.GetWindowTextW(h, b, n + 1); return b.value
def pid_of(h):
    p = w.DWORD(); u.GetWindowThreadProcessId(h, ctypes.byref(p)); return p.value
def exe_of(pid):
    h = k.OpenProcess(0x1000, False, pid)
    if not h: return ''
    b = ctypes.create_unicode_buffer(520); n = w.DWORD(520)
    k.QueryFullProcessImageNameW(h, 0, b, ctypes.byref(n)); k.CloseHandle(h); return b.value
def rect(h):
    r = w.RECT(); u.GetWindowRect(h, ctypes.byref(r)); return [r.left, r.top, r.right, r.bottom]
def cursor():
    p = w.POINT(); u.GetCursorPos(ctypes.byref(p)); return (p.x, p.y)
def fusion_windows():
    out = []
    @ctypes.WINFUNCTYPE(ctypes.c_bool, w.HWND, w.LPARAM)
    def cb(h, _):
        if u.IsWindowVisible(h) and title(h):
            e = exe_of(pid_of(h))
            if e.lower().endswith('fusion360.exe'): out.append(h)
        return True
    u.EnumWindows(cb, 0); return out
def main_window():
    best = None
    for h in fusion_windows():
        t = title(h)
        if t.startswith('Autodesk Fusion') or 'Autodesk Fusion' in t:
            r = rect(h)
            if best is None or (r[2]-r[0])*(r[3]-r[1]) > best[1]: best = (h, (r[2]-r[0])*(r[3]-r[1]))
    return best[0] if best else None
def monitors():
    out = []
    @ctypes.WINFUNCTYPE(ctypes.c_int, w.HANDLE, w.HDC, ctypes.POINTER(w.RECT), w.LPARAM)
    def cb(hm, hdc, r, _):
        out.append((r.contents.left, r.contents.top, r.contents.right, r.contents.bottom)); return 1
    u.EnumDisplayMonitors(None, None, cb, 0); return out
MONS = monitors()
def in_corner():   # within 3 px of a corner of ANY monitor
    x, y = cursor()
    for (l, t, r, b) in MONS:
        if (x <= l + 3 or x >= r - 4) and (y <= t + 3 or y >= b - 4) and l - 1 <= x <= r and t - 1 <= y <= b: return True
    return False
def fg_is_fusion():
    f = u.GetForegroundWindow(); m = main_window()
    # Fusion's own transient input windows (the inference-dimension box shown while a tool is active, 'HUD:QTView:...') take the foreground; they are
    # Fusion360.exe windows with that title prefix and are accepted. Any other window (dialog, other app) is not.
    hud = f != 0 and title(f).startswith('HUD:QTView') and exe_of(pid_of(f)).lower().endswith('fusion360.exe')
    return f != 0 and (f == m or hud), f, title(f)
STATE = os.path.join(os.environ.get('TEMP', '.'), 'win-mouse-state.json')
def guard(where, check_moved=True):
    m = main_window()
    if not m: abort('no Fusion main window')
    ok, f, ft = fg_is_fusion()
    if not ok: abort('%s: foreground is not Fusion main: %r' % (where, ft))
    doc = os.environ.get('FUSION_DOC')
    if doc and doc not in title(m): abort('%s: Fusion title %r lacks %r' % (where, title(m), doc))
    if in_corner(): abort('%s: cursor in screen corner' % where)
    if check_moved and os.path.exists(STATE):
        last = json.load(open(STATE))
        if max(abs(cursor()[0] - last[0]), abs(cursor()[1] - last[1])) > 3: abort('%s: cursor moved by someone else: %s expected %s' % (where, cursor(), last))
def remember(): json.dump(list(cursor()), open(STATE, 'w'))
def abort(msg): print(json.dumps({'ok': False, 'abort': msg})); sys.exit(2)

class MI(ctypes.Structure): _fields_ = [('dx', w.LONG), ('dy', w.LONG), ('mouseData', w.DWORD), ('dwFlags', w.DWORD), ('time', w.DWORD), ('extra', ctypes.c_void_p)]
class IN(ctypes.Structure):
    class U(ctypes.Union): _fields_ = [('mi', MI)]
    _anonymous_ = ('u',); _fields_ = [('type', w.DWORD), ('u', U)]
def send(flags, x=0, y=0):
    i = IN(0, IN.U(MI(x, y, 0, flags, 0, None))); u.SendInput(1, ctypes.byref(i), ctypes.sizeof(IN))
ABS = 0x8000 | 0x0001 | 0x4000   # absolute + move + virtualdesk
def move_to(x, y):
    vx, vy, vw, vh = u.GetSystemMetrics(76), u.GetSystemMetrics(77), u.GetSystemMetrics(78), u.GetSystemMetrics(79)
    send(ABS, int((x - vx) * 65535 / (vw - 1)), int((y - vy) * 65535 / (vh - 1)))
def up(): send(0x0004)
class KI(ctypes.Structure): _fields_ = [('wVk', w.WORD), ('wScan', w.WORD), ('dwFlags', w.DWORD), ('time', w.DWORD), ('extra', ctypes.c_void_p)]
class KIN(ctypes.Structure):
    class U(ctypes.Union): _fields_ = [('ki', KI), ('mi', MI)]
    _anonymous_ = ('u',); _fields_ = [('type', w.DWORD), ('u', U)]
def keyev(vk, down_):
    i = KIN(1, KIN.U(ki=KI(vk, u.MapVirtualKeyW(vk, 0), 0 if down_ else 2, 0, None))); u.SendInput(1, ctypes.byref(i), ctypes.sizeof(KIN))
VK = {'esc': 0x1B, 'enter': 0x0D, 'ctrl': 0x11, 'shift': 0x10, 'minus': 0xBD, 'dot': 0xBE, '-': 0xBD, '.': 0xBE}
def vk_of(n):
    n = n.lower()
    if n in VK: return VK[n]
    if len(n) == 1 and (n.isalpha() or n.isdigit()): return ord(n.upper())
    abort('unknown key %r' % n)
def press_chord(spec):   # 'ctrl+shift+z' -> down in order, up reversed; every key guarded before it is sent
    ks = [vk_of(x) for x in spec.split('+')]
    for v in ks: guard('key ' + spec); keyev(v, True); time.sleep(0.03)
    for v in reversed(ks): keyev(v, False); time.sleep(0.03)
def keys(specs):
    for sp in specs:
        if sp.startswith('type:'):
            for ch in sp[5:]: press_chord(ch); time.sleep(0.08)
        else: press_chord(sp)
        time.sleep(0.4)
    remember(); return {'ok': True, 'keys': specs}
def click(x, y, canvas, n=1):
    guard('click', check_moved=False)
    L, T, R, B = canvas
    if not (L <= x <= R and T <= y <= B): abort('point %s outside canvas %s' % ((x, y), canvas))
    if os.path.exists(STATE):
        last = json.load(open(STATE))
        if max(abs(cursor()[0] - last[0]), abs(cursor()[1] - last[1])) > 3: abort('click: cursor moved by someone else: %s expected %s' % (cursor(), last))
    move_to(x, y); time.sleep(0.2)
    if max(abs(cursor()[0] - x), abs(cursor()[1] - y)) > 2: abort('cursor did not land: %s expected %s' % (cursor(), (x, y)))
    for _ in range(n):
        guard('click press', check_moved=False); down(); time.sleep(0.06); up(); time.sleep(0.08)
    time.sleep(0.4); remember(); return {'ok': True, 'cursor': cursor()}
def down(): send(0x0002)

def info():
    m = main_window(); ok, f, ft = fg_is_fusion()
    return {'screen': [SW, SH], 'monitors': MONS, 'dpi': u.GetDpiForSystem(), 'cursor': cursor(), 'fg_hwnd': f, 'fg_title': ft, 'fg_is_fusion_main': ok,
            'fusion_main': m, 'fusion_title': title(m) if m else None, 'fusion_rect': rect(m) if m else None,
            'fusion_windows': [(h, title(h), rect(h)) for h in fusion_windows()]}

def drag(x1, y1, x2, y2, ms, steps, canvas, settle=120):
    m = main_window()
    if not m: abort('no Fusion main window')
    ok, f, ft = fg_is_fusion()
    if not ok: abort('foreground is not Fusion: %s %r' % (f, ft))
    if in_corner(): abort('cursor in screen corner')
    L, T, R, B = canvas
    for (x, y) in ((x1, y1), (x2, y2)):
        if not (L <= x <= R and T <= y <= B): abort('point %s outside canvas %s' % ((x, y), canvas))
    t0 = time.time(); move_to(x1, y1); time.sleep(0.15)
    if max(abs(cursor()[0] - x1), abs(cursor()[1] - y1)) > 2: abort('cursor did not land at start: %s expected %s' % (cursor(), (x1, y1)))
    ok, f, ft = fg_is_fusion()
    if not ok: abort('foreground changed before press: %r' % ft)
    down(); time.sleep(0.12); last = (x1, y1); log = []
    try:
        for i in range(1, steps + 1):
            x = round(x1 + (x2 - x1) * i / steps); y = round(y1 + (y2 - y1) * i / steps)
            if in_corner(): up(); abort('cursor in screen corner during drag')
            if max(abs(cursor()[0] - last[0]), abs(cursor()[1] - last[1])) > 3: up(); abort('cursor moved by someone else: %s expected %s' % (cursor(), last))
            ok, f, ft = fg_is_fusion()
            if not ok: up(); abort('foreground left Fusion during drag: %r' % ft)
            move_to(x, y); last = (x, y); time.sleep(ms / 1000.0 / steps)
        time.sleep(settle / 1000.0)
    finally:
        up()
    time.sleep(0.2); remember()
    return {'ok': True, 'secs': round(time.time() - t0, 3), 'cursor_end': cursor(), 'target': (x2, y2)}

if __name__ == '__main__':
    a = sys.argv[1:]
    if not a or a[0] == 'info': print(json.dumps(info()))
    elif a[0] == 'front':
        m = main_window()
        if not m: abort('no Fusion main window')
        u.SetForegroundWindow(m); time.sleep(0.4); ok, f, ft = fg_is_fusion()
        print(json.dumps({'ok': ok, 'fg_title': ft}))
    elif a[0] == 'shot':
        from PIL import ImageGrab
        m = main_window(); r = rect(m); ImageGrab.grab(bbox=tuple(r), all_screens=True).save(a[1]); print(json.dumps({'ok': True, 'rect': r}))
    elif a[0] == 'drag':
        x1, y1, x2, y2 = map(int, a[1:5]); ms = int(a[5]) if len(a) > 5 else 600; st = int(a[6]) if len(a) > 6 else 20
        canvas = list(map(int, a[7:11])) if len(a) >= 11 else rect(main_window())
        settle = int(a[11]) if len(a) > 11 else 120
        print(json.dumps(drag(x1, y1, x2, y2, ms, st, canvas, settle)))
    elif a[0] in ('click', 'dblclick'):
        x, y = int(a[1]), int(a[2]); canvas = list(map(int, a[3:7])) if len(a) >= 7 else rect(main_window())
        print(json.dumps(click(x, y, canvas, 1 if a[0] == 'click' else 2)))
    elif a[0] == 'key':
        guard('key'); print(json.dumps(keys(a[1:])))
    elif a[0] == 'park':   # remember the current cursor as the expected one (call once after `front`)
        guard('park', check_moved=False); remember(); print(json.dumps({'ok': True, 'cursor': cursor()}))
    elif a[0] == 'dismiss':
        f = u.GetForegroundWindow(); x, y = int(a[2]), int(a[3])
        if not (f and exe_of(pid_of(f)).lower().endswith('fusion360.exe') and a[1] in title(f)): abort('dismiss: foreground %r is not a Fusion window titled %r' % (title(f), a[1]))
        L, T, R, B = rect(f)
        if not (L <= x <= R and T <= y <= B): abort('dismiss: point outside the dialog %s' % rect(f))
        if in_corner(): abort('dismiss: cursor in screen corner')
        move_to(x, y); time.sleep(0.25)
        if max(abs(cursor()[0] - x), abs(cursor()[1] - y)) > 2: abort('cursor did not land')
        down(); time.sleep(0.06); up(); time.sleep(0.5); remember(); print(json.dumps({'ok': True, 'dialog': title(f), 'cursor': cursor()}))
