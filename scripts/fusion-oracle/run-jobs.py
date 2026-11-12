# TASK 518 part 1 -- replays JOBS (built by tests/harness/fusion-oracle/export.js) in a live Fusion 360 and records every answer. Executed INSIDE Fusion
# through mcp__fusion360__fusion_execute, which exec()s this file after setting IN_PATH (jobs json), OUT_PATH (answers json), FROM / TO (slice of jobs).
# Safety: it refuses to run unless the active document holds the user parameter CLAUDE_MARK (the scratch document made by hand), and every sketch it
# makes is named CLAUDE_TEST_* and deleted before the next job. Units: jobs are our mm, Fusion's API is cm (x/10 in, x*10 out).
import json, math, time
import adsk.core as core
import adsk.fusion as fus

def P(x, y): return core.Point3D.create(x / 10.0, y / 10.0, 0)
def r9(v): return round(v, 9)

class Job:
    def __init__(self, root, doc):
        self.sk = root.sketches.add(root.xYConstructionPlane)
        self.sk.name = 'CLAUDE_TEST_JOB'
        self.gc = self.sk.geometricConstraints
        self.pts = {}        # joint id -> SketchPoint (canonical)
        self.ents = {}       # shape id -> sketch entity
        self.shapes = {}
        self.cons = {}       # uid -> Fusion constraint / dimension
        self.kind = {}       # uid -> 'angle' | 'len'
        self.helpers = {}
        self.buildErrors = []
        self.skipped = []
        self.lone = []
        self.doc = doc
        self.sk.isComputeDeferred = True      # one solve for the whole document instead of one per constraint
        self.build(doc)
        self.sk.isComputeDeferred = False

    def build(self, doc):
        sk = self.sk
        J = doc['joints']
        occ = {}
        self.pts['j_origin'] = sk.originPoint
        for s in doc['shapes']:
            self.shapes[s['id']] = s
            try:
                t = s['type']
                if t == 'line':
                    a = J[s['joints'][0]]; b = J[s['joints'][1]]
                    o = sk.sketchCurves.sketchLines.addByTwoPoints(P(a[0], a[1]), P(b[0], b[1]))
                    pl = [o.startSketchPoint, o.endSketchPoint]
                elif t == 'circle':
                    c = J[s['joints'][0]]
                    o = sk.sketchCurves.sketchCircles.addByCenterRadius(P(c[0], c[1]), s['radius'] / 10.0)
                    pl = [o.centerSketchPoint]
                elif t == 'arc':
                    c = J[s['joints'][0]]; a = J[s['joints'][1]]
                    o = sk.sketchCurves.sketchArcs.addByCenterStartSweep(P(c[0], c[1]), P(a[0], a[1]), s['sweep'])
                    pl = [o.centerSketchPoint, o.startSketchPoint, o.endSketchPoint]
                else:
                    self.skipped.append(s['id'] + ':' + t)
                    continue
                if s.get('construction'): o.isConstruction = True
                self.ents[s['id']] = o
                for jid, p in zip(s['joints'], pl): occ.setdefault(jid, []).append(p)
            except Exception as ex:
                self.buildErrors.append('shape ' + s['id'] + ': ' + str(ex).strip().split('\n')[0][:120])
        for jid, lst in occ.items():
            if jid == 'j_origin':
                for p in lst:
                    try: self.gc.addCoincident(sk.originPoint, p)
                    except Exception as ex: self.buildErrors.append('origin join ' + str(ex).strip().split('\n')[0][:100])
                continue
            self.pts[jid] = lst[0]
            for p in lst[1:]:
                try: self.gc.addCoincident(lst[0], p)
                except Exception as ex: self.buildErrors.append('join ' + jid + ': ' + str(ex).strip().split('\n')[0][:100])
        for jid, v in J.items():
            if jid in self.pts: continue
            self.pts[jid] = sk.sketchPoints.add(P(v[0], v[1]))
            self.lone.append(jid)
        for jid, v in J.items():
            if v[2] and jid != 'j_origin':
                try: self.pts[jid].isFixed = True
                except Exception as ex: self.buildErrors.append('fix ' + jid + ': ' + str(ex)[:80])
        for c in doc['constraints']:
            r = self.add(c, None, initial=True)
            if not r['accepted']: self.buildErrors.append('constraint ' + str(c.get('uid')) + ' ' + c['type'] + ': ' + str(r['error']))

    # ---------------------------------------------------------------- measuring
    def xy(self, jid):
        g = self.pts[jid].geometry
        return [r9(g.x * 10), r9(g.y * 10)]

    def snap(self, full=True, watch=None):
        og = self.sk.originPoint.geometry
        out = {'pts': {}, 'radii': {}, 'full': {}, 'origin': [r9(og.x * 10), r9(og.y * 10)]}
        for jid in self.pts:
            if jid == 'j_origin': continue
            out['pts'][jid] = self.xy(jid)
        for sid, o in self.ents.items():
            try:
                if self.shapes[sid]['type'] in ('circle', 'arc'): out['radii'][sid] = r9(o.radius * 10)
                if full and (watch is None or sid in watch): out['full'][sid] = bool(o.isFullyConstrained)
            except Exception: out['full'][sid] = None
        if not full or watch is not None: return out      # isFullyConstrained costs ~1 s per call in Fusion
        for jid in self.lone:
            try: out['full'][jid] = bool(self.pts[jid].isFullyConstrained)
            except Exception: out['full'][jid] = None
        out['sketchFull'] = bool(self.sk.isFullyConstrained)
        return out

    # ---------------------------------------------------------------- constraints
    def line_between(self, a, b):
        pa = self.pts[a]; pb = self.pts[b]
        for sid, s in self.shapes.items():
            if s['type'] == 'line' and sid in self.ents:
                o = self.ents[sid]
                if (o.startSketchPoint == pa and o.endSketchPoint == pb) or (o.startSketchPoint == pb and o.endSketchPoint == pa): return o
        key = a + '|' + b
        if key not in self.helpers:
            h = self.sk.sketchCurves.sketchLines.addByTwoPoints(pa, pb)
            h.isConstruction = True
            self.helpers[key] = h
        return self.helpers[key]

    def textpt(self, p1, p2, off=12.0):
        a = p1.geometry; b = p2.geometry
        mx = (a.x + b.x) / 2; my = (a.y + b.y) / 2
        dx = b.x - a.x; dy = b.y - a.y; L = math.hypot(dx, dy) or 1.0
        return core.Point3D.create(mx - dy / L * off / 10.0, my + dx / L * off / 10.0, 0)

    def add(self, c, extra, initial=False):
        t = c['type']
        res = {'accepted': True, 'error': None, 'driving': None, 'valueError': None}
        sk = self.sk; gc = self.gc
        try:
            obj = None
            if t == 'coincident': obj = gc.addCoincident(self.pts[c['joints'][0]], self.pts[c['joints'][1]])
            elif t == 'horizontal': obj = gc.addHorizontalPoints(self.pts[c['joints'][0]], self.pts[c['joints'][1]])
            elif t == 'vertical': obj = gc.addVerticalPoints(self.pts[c['joints'][0]], self.pts[c['joints'][1]])
            elif t == 'parallel': obj = gc.addParallel(self.ents[c['shapes'][0]], self.ents[c['shapes'][1]])
            elif t == 'perpendicular': obj = gc.addPerpendicular(self.ents[c['shapes'][0]], self.ents[c['shapes'][1]])
            elif t == 'collinear': obj = gc.addCollinear(self.ents[c['shapes'][0]], self.ents[c['shapes'][1]])
            elif t == 'tangent':
                if c.get('line') and c.get('circle'): obj = gc.addTangent(self.ents[c['line']], self.ents[c['circle']])
                else: obj = gc.addTangent(self.ents[c['shapes'][0]], self.ents[c['shapes'][1]])
            elif t == 'equal':
                if c.get('joints') and len(c['joints']) >= 4:
                    res['error'] = 'skipped: the arc keeps its radius structurally in Fusion'
                    res['skipped'] = True
                    return res
                obj = gc.addEqual(self.ents[c['shapes'][0]], self.ents[c['shapes'][1]])
            elif t == 'pointOnLine': obj = gc.addCoincident(self.pts[c['joint']], self.ents[c['shape']])
            elif t == 'midpoint':
                a, b, m = c['joints']
                obj = gc.addMidPoint(self.pts[m], self.line_between(a, b))
            elif t == 'distance': obj = self.add_distance(c)
            elif t == 'angle': obj = self.add_angle(c)
            else:
                res['accepted'] = False; res['error'] = 'unsupported type ' + t; return res
            if c.get('uid') is not None and obj is not None: self.cons[c['uid']] = obj
            if t in ('distance', 'angle') and obj is not None:
                try: res['driving'] = bool(obj.isDriving) if hasattr(obj, 'isDriving') else True
                except Exception: res['driving'] = None
                if extra: self.set_value(obj, t, extra, res)
        except Exception as ex:
            res['accepted'] = False
            res['error'] = str(ex).strip().split('\n')[0][:200]
        return res

    def add_distance(self, c):
        sk = self.sk
        if c.get('isRadius'):
            o = self.ents[c['shape']]; g = o.centerSketchPoint.geometry
            self.kind[c.get('uid')] = 'len'
            return sk.sketchDimensions.addRadialDimension(o, core.Point3D.create(g.x + o.radius * 0.7, g.y + o.radius * 0.7, 0), True)
        if c.get('shapes') and not (c.get('joints') and len(c['joints']) >= 2):
            l1 = self.ents[c['shapes'][0]]; l2 = self.ents[c['shapes'][1]]
            self.kind[c.get('uid')] = 'len'
            m = l2.startSketchPoint.geometry
            return sk.sketchDimensions.addOffsetDimension(l1, l2.startSketchPoint, core.Point3D.create(m.x + 1.0, m.y + 1.0, 0))
        p1 = self.pts[c['joints'][0]]; p2 = self.pts[c['joints'][1]]
        mode = c.get('dimMode') or 'aligned'
        ori = {'aligned': fus.DimensionOrientations.AlignedDimensionOrientation, 'horizontal': fus.DimensionOrientations.HorizontalDimensionOrientation, 'vertical': fus.DimensionOrientations.VerticalDimensionOrientation}[mode]
        self.kind[c.get('uid')] = 'len'
        return sk.sketchDimensions.addDistanceDimension(p1, p2, ori, self.textpt(p1, p2), True)

    def add_angle(self, c):
        l1 = self.ents[c['shapes'][0]]; l2 = self.ents[c['shapes'][1]]
        a = l1.startSketchPoint.geometry; b = l1.endSketchPoint.geometry; q = l2.startSketchPoint.geometry; r = l2.endSketchPoint.geometry
        ux = b.x - a.x; uy = b.y - a.y; vx = r.x - q.x; vy = r.y - q.y
        det = ux * vy - uy * vx
        if abs(det) > 1e-12:
            t = ((q.x - a.x) * vy - (q.y - a.y) * vx) / det
            ix = a.x + t * ux; iy = a.y + t * uy
        else:
            ix = (a.x + q.x) / 2; iy = (a.y + q.y) / 2
        lu = math.hypot(ux, uy) or 1.0; lv = math.hypot(vx, vy) or 1.0
        bx = ux / lu + vx / lv; by = uy / lu + vy / lv
        if math.hypot(bx, by) < 1e-6: bx, by = -uy / lu, ux / lu
        n = math.hypot(bx, by); k = 1.5
        self.kind[c.get('uid')] = 'angle'
        return self.sk.sketchDimensions.addAngularDimension(l1, l2, core.Point3D.create(ix + bx / n * k, iy + by / n * k, 0), True)

    def set_value(self, obj, t, extra, res):
        try:
            cur = obj.parameter.value
            if t == 'angle':
                v = extra['target'] if extra.get('target') is not None else cur * 180 / math.pi + extra['delta']
                obj.parameter.expression = '%.9f deg' % v
            else:
                v = extra['target'] if extra.get('target') is not None else cur * 10 * extra['scale']
                obj.parameter.expression = '%.9f mm' % v
        except Exception as ex:
            res['valueError'] = str(ex).strip().split(chr(10))[0][:200]

    def edit(self, uid, value):
        res = {'accepted': True, 'error': None, 'valueError': None}
        o = self.cons.get(uid)
        if o is None: res['accepted'] = False; res['error'] = 'no such dimension'; return res
        t = 'angle' if self.kind.get(uid) == 'angle' else 'len'
        self.set_value(o, t, {'target': value}, res)
        if res['valueError']: res['accepted'] = False; res['error'] = res['valueError']
        return res

    def delete(self, uid):
        o = self.cons.get(uid)
        if o is None: return {'accepted': False, 'error': 'no such constraint (not created in Fusion)'}
        try:
            o.deleteMe(); del self.cons[uid]
            return {'accepted': True, 'error': None}
        except Exception as ex: return {'accepted': False, 'error': str(ex).strip().split('\n')[0][:200]}

def run_job(root, jb, doc):
    j = Job(root, doc)
    out = {'id': jb['id'], 'buildErrors': j.buildErrors, 'skipped': j.skipped, 'initial': j.snap(), 'steps': []}
    try:
        n = len(jb['ops'])
        for i, op in enumerate(jb['ops']):
            if op['op'] == 'add':
                r = j.add({**op['params'], 'uid': op.get('uid') if op.get('uid') is not None else ('x' + str(i))}, op.get('extra') or ({'target': op['target']} if op.get('isDim') else None))
            elif op['op'] == 'delete': r = j.delete(op['uid'])
            elif op['op'] == 'edit': r = j.edit(op['uid'], op['value'])
            r['label'] = op.get('label')
            if jb['record'] == 'all' or i == n - 1: r['snap'] = j.snap(jb['record'] != 'coords', jb.get('watch'))
            out['steps'].append(r)
    finally:
        j.sk.deleteMe()
    return out

def go():
    t0 = time.time()
    des = adsk.fusion.Design.cast(app.activeProduct)
    assert des.userParameters.itemByName('CLAUDE_MARK') is not None, 'active document is not the scratch document'
    data = json.load(open(IN_PATH))
    try: outd = json.load(open(OUT_PATH))
    except Exception: outd = {'results': {}}
    outd['fusion'] = app.version
    n = 0
    for jb in data['jobs'][FROM:TO]:
        if time.time() - t0 > 27: break
        if (data['name'] + '/' + jb['id']) in outd['results']: n += 1; continue      # already answered
        try: outd['results'][data['name'] + '/' + jb['id']] = run_job(des.rootComponent, jb, jb.get('doc') or data['doc'])
        except Exception as ex: outd['results'][data['name'] + '/' + jb['id']] = {'id': jb['id'], 'setupError': str(ex).strip().split('\n')[0][:200]}
        n += 1
    json.dump(outd, open(OUT_PATH, 'w'))
    print(data['name'], 'ran', n, 'of', len(data['jobs'][FROM:TO]), 'sketches left', des.rootComponent.sketches.count, 'secs', round(time.time() - t0, 1))
go()
