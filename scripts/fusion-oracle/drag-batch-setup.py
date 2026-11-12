# TASK 530 phase 2 -- executed INSIDE Fusion through mcp__fusion360__fusion_execute:
#   SELF = <path of this file>; BATCH = 0 (int) | 'o' / 'p' (the origin cells, copy a / b) | None (collect only); RUN = <dir with drag-cells.json, plan.json, results.json>; exec(open(<this file>).read())
# 1. COLLECT: if RUN/plan.json exists, read every tagged curve of the sketch (attribute c530/id = "<slot>|<entity>") back into RUN/results.json, then delete the sketch.
# 2. BUILD the next batch: many independent cells at different places of ONE sketch CLAUDE_TEST_DRAG (cm), enter sketch edit mode, frame the view,
#    write RUN/plan.json with the SCREEN pixel of every grab point and target (modelToViewSpace + viewToScreen). Each cell is built TWICE (copies a, b).
# Refuses to run unless the active document holds the user parameter CLAUDE_MARK (the scratch document made for task 530).
import json, math, os
import adsk.core as c, adsk.fusion as f
app = c.Application.get(); ui = app.userInterface
des = f.Design.cast(app.activeProduct)
assert des.userParameters.itemByName('CLAUDE_MARK') is not None, 'not the scratch document'
root = des.rootComponent
for s in root.sketches:
    assert s.name == 'CLAUDE_TEST_DRAG', 'foreign sketch ' + s.name
P = c.Point3D.create
spec = json.load(open(RUN + '/drag-cells.json'))
cells = {x['id']: x for x in spec['cells']}
PLAN = RUN + '/plan.json'; RES = RUN + '/results.json'
msg = []

def collect(sk, plan):
    res = json.load(open(RES)) if os.path.exists(RES) else {'results': {}}
    got = {}
    for cv in sk.sketchCurves:
        a = cv.attributes.itemByName('c530', 'id')
        if not a: continue
        slot, ent = a.value.split('|')
        d = {}
        t = cv.objectType
        if t.endswith('SketchLine'):
            d['pts'] = [[cv.startSketchPoint.geometry.x, cv.startSketchPoint.geometry.y], [cv.endSketchPoint.geometry.x, cv.endSketchPoint.geometry.y]]
        elif t.endswith('SketchCircle'):
            d['pts'] = [[cv.centerSketchPoint.geometry.x, cv.centerSketchPoint.geometry.y]]; d['r'] = cv.radius
        elif t.endswith('SketchArc'):
            cp = cv.centerSketchPoint.geometry; sp = cv.startSketchPoint.geometry; ep = cv.endSketchPoint.geometry
            d['pts'] = [[cp.x, cp.y], [sp.x, sp.y], [ep.x, ep.y]]; d['r'] = math.hypot(sp.x - cp.x, sp.y - cp.y)
        got.setdefault(slot, {})[ent] = d
    n = 0
    for it in plan['items']:
        o = it['offset']; after = {}
        for ent, d in got.get(it['slot'], {}).items():
            after[ent] = {'pts': [[round(p[0] - o[0], 5), round(p[1] - o[1], 5)] for p in d['pts']]}
            if 'r' in d: after[ent]['r'] = round(d['r'], 5)
        res['results'][it['cell'] + '#' + it['copy']] = {'before': it['before'], 'after': after, 'batch': plan['batch'], 'buildErrors': it['buildErrors']}
        n += 1
    res['fusion'] = app.version
    json.dump(res, open(RES, 'w'))
    return n

if os.path.exists(PLAN):
    plan = json.load(open(PLAN))
    sks = [s for s in root.sketches if s.name == 'CLAUDE_TEST_DRAG']
    if sks:
        msg.append('collected %d slots from batch %s' % (collect(sks[0], plan), plan['batch']))
    os.replace(PLAN, RUN + '/plan-prev.json')
REUSE = app.activeEditObject.objectType == 'adsk::fusion::Sketch' and app.activeEditObject.name == 'CLAUDE_TEST_DRAG'
if REUSE:
    # stay in sketch edit mode: empty the sketch (dimensions, curves, stray points) and build the next batch in it, so one call both builds and frames
    sk = app.activeEditObject
    for d in list(sk.sketchDimensions): d.deleteMe()
    for cv in list(sk.sketchCurves): cv.deleteMe()
    for pt in list(sk.sketchPoints):
        if pt != sk.originPoint:
            try: pt.deleteMe()
            except Exception: pass
    assert sk.sketchCurves.count == 0 and sk.sketchDimensions.count == 0, 'sketch not empty after clearing'
else:
    for s in list(root.sketches): s.deleteMe()

if BATCH is not None:
    COLS, ROWS, PITCH = 8, 3, 2.7
    ids = [i for i, x in cells.items() if not x.get('origin')]
    slots = []
    if BATCH in ('o', 'p'):      # the origin cells: 'o' = copy a, 'p' = copy b (one origin per sketch: one copy per build)
        for i, x in cells.items():
            if x.get('origin'): slots.append((i, 'a' if BATCH == 'o' else 'b', [0.0, 0.0], 'o' + str(len(slots))))
    else:
        flat = [(i, cp) for i in ids for cp in ('a', 'b')]
        for k, (i, cp) in enumerate(flat[BATCH * COLS * ROWS:(BATCH + 1) * COLS * ROWS]):
            col, row = k % COLS, k // COLS
            slots.append((i, cp, [round(0.15 + col * PITCH, 4), round(0.15 + (ROWS - 1 - row) * PITCH, 4)], 's%d' % k))
    if not REUSE:
        sk = root.sketches.add(root.xYConstructionPlane); sk.name = 'CLAUDE_TEST_DRAG'
    L = sk.sketchCurves.sketchLines; gc = sk.geometricConstraints
    sk.isComputeDeferred = True
    items = []
    for (cid, cp, off, slot) in slots:
        cell = cells[cid]; ents = {}; pts = {}; kinds = {}
        def Q(p): return P(p[0] + off[0], p[1] + off[1], 0)
        for e in cell['ents']:
            kinds[e['n']] = e['k']
            if e['k'] == 'line':
                o = L.addByTwoPoints(Q(e['p'][0]), Q(e['p'][1])); pts[e['n']] = [o.startSketchPoint, o.endSketchPoint]
            elif e['k'] == 'circle':
                o = sk.sketchCurves.sketchCircles.addByCenterRadius(Q(e['c']), e['r']); pts[e['n']] = [o.centerSketchPoint]
            else:
                a0 = math.atan2(e['s'][1] - e['c'][1], e['s'][0] - e['c'][0]); a1 = math.atan2(e['e'][1] - e['c'][1], e['e'][0] - e['c'][0])
                o = sk.sketchCurves.sketchArcs.addByCenterStartSweep(Q(e['c']), Q(e['s']), (a1 - a0) % (2 * math.pi)); pts[e['n']] = [o.centerSketchPoint, o.startSketchPoint, o.endSketchPoint]
            o.attributes.add('c530', 'id', slot + '|' + e['n']); ents[e['n']] = o
        bad = []
        for k in cell['cons']:
            try:
                t = k['t']
                if t == 'fix': pts[k['pt'][0]][k['pt'][1]].isFixed = True
                elif t == 'origin': gc.addCoincident(sk.originPoint, pts[k['pt'][0]][k['pt'][1]])
                elif t == 'hv': (gc.addHorizontal if k['d'] == 'H' else gc.addVertical)(ents[k['e']])
                elif t == 'coinc': gc.addCoincident(pts[k['a'][0]][k['a'][1]], pts[k['b'][0]][k['b'][1]])
                elif t == 'tang': gc.addTangent(ents[k['line']], ents[k['circle']])
                elif t == 'len':
                    p0, p1 = pts[k['e']][0], pts[k['e']][1]; a, b = p0.geometry, p1.geometry
                    mx, my = (a.x + b.x) / 2, (a.y + b.y) / 2; dx, dy = b.x - a.x, b.y - a.y; n = math.hypot(dx, dy)
                    sk.sketchDimensions.addDistanceDimension(p0, p1, f.DimensionOrientations.AlignedDimensionOrientation, P(mx - dy / n * 0.3, my + dx / n * 0.3, 0))
                elif t == 'rad':
                    e = ents[k['e']]; g = pts[k['e']][0].geometry
                    sk.sketchDimensions.addRadialDimension(e, P(g.x + 0.3, g.y + 0.3, 0))
            except Exception as ex: bad.append(k['t'] + ':' + str(ex).strip().split('\n')[0][:60])
        before = {}
        for n_, pl in pts.items():
            before[n_] = {'pts': [[round(p.geometry.x - off[0], 5), round(p.geometry.y - off[1], 5)] for p in pl]}
            if kinds[n_] == 'circle': before[n_]['r'] = round(ents[n_].radius, 5)
            if kinds[n_] == 'arc':
                cc, ss = pl[0].geometry, pl[1].geometry; before[n_]['r'] = round(math.hypot(ss.x - cc.x, ss.y - cc.y), 5)
        items.append({'slot': slot, 'cell': cid, 'copy': cp, 'offset': off, 'before': before, 'buildErrors': bad})
    sk.isComputeDeferred = False
    if not REUSE:
        ui.activeSelections.clear(); ui.activeSelections.add(sk)
        ui.commandDefinitions.itemById('SketchActivate').execute()
    plan = {'batch': BATCH, 'items': items, 'cols': COLS, 'rows': ROWS, 'pitch': PITCH}
    json.dump(plan, open(PLAN, 'w'))
    msg.append('built %d slots, buildErrors %d: %s' % (len(items), sum(1 for i in items if i['buildErrors']), [(i['cell'], i['buildErrors']) for i in items if i['buildErrors']][:6]))
    if REUSE:
        exec(open(os.path.join(os.path.dirname(SELF), 'drag-batch-frame.py')).read())    # already in edit mode: frame in the same call
        msg.append('framed')
    else:
        msg.append('first batch: run drag-batch-frame.py in a SEPARATE call (the sketch activation completes after this script returns)')
print(' | '.join(msg))
