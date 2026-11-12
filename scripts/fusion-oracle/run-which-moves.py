# TASK 518 -- runs the which-moves scenarios in a live Fusion 360 and writes the answers. Executed INSIDE Fusion through
# mcp__fusion360__fusion_execute (adsk, app are provided), which exec()s this file after setting
#   IN_PATH (scenarios json), OUT_PATH (results json), FROM / TO (slice). The scratch document is the one that holds the user
#   parameter CLAUDE_MARK (made once by hand); the script refuses to run in any other document.
# Units: scenario coordinates are our mm; Fusion's API is cm, so x / 10 going in and x * 10 coming out.
import json, time
import adsk.core as core
import adsk.fusion as fus

def P(x, y): return core.Point3D.create(x / 10.0, y / 10.0, 0)
def xy(sp):
    g = sp.geometry
    return [round(g.x * 10, 9), round(g.y * 10, 9)]

def run_one(root, sc):
    sk = root.sketches.add(root.xYConstructionPlane)
    sk.name = 'CLAUDE_TEST_' + sc['id'][:40]
    ents = {}
    def build(e, shared):
        k = e['k']
        if k == 'line':
            p1 = P(*e['p'][1])
            s = shared.get(e['n'] + '.0')
            if s: o = sk.sketchCurves.sketchLines.addByTwoPoints(ents[s[0]]['pts'][s[1]], p1)
            else: o = sk.sketchCurves.sketchLines.addByTwoPoints(P(*e['p'][0]), p1)
            return {'k': k, 'obj': o, 'pts': [o.startSketchPoint, o.endSketchPoint]}
        if k == 'circle':
            o = sk.sketchCurves.sketchCircles.addByCenterRadius(P(*e['c']), e['r'] / 10.0)
            return {'k': k, 'obj': o, 'pts': [o.centerSketchPoint]}
        if k == 'arc':
            o = sk.sketchCurves.sketchArcs.addByCenterStartEnd(P(*e['c']), P(*e['s']), P(*e['e']))
            return {'k': k, 'obj': o, 'pts': [o.centerSketchPoint, o.startSketchPoint, o.endSketchPoint]}
        if k == 'pt':
            o = sk.sketchPoints.add(P(*e['p']))
            return {'k': k, 'obj': o, 'pts': [o]}
    shared = dict(sc.get('shared') or {})
    for e in sc['ents']: ents[e['n']] = build(e, shared)
    def obj(n): return ents[n]['obj']
    def pt(ref): return ents[ref[0]]['pts'][ref[1]]
    def mid(a, b): return P((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    def snap():
        out = {}
        for n, e in ents.items():
            d = {'pts': [xy(p) for p in e['pts']]}
            if e['k'] in ('circle', 'arc'): d['r'] = round(e['obj'].radius * 10, 9)
            try: d['full'] = bool(e['obj'].isFullyConstrained)
            except Exception: d['full'] = None
            out[n] = d
        return out
    def setval(d, a, unit):
        if a.get('scale') is not None: d.parameter.expression = '%.9f %s' % (d.parameter.value * (10 if unit == 'mm' else 180 / 3.141592653589793) * a['scale'], unit)
        elif a.get('delta') is not None: d.parameter.expression = '%.9f deg' % (d.parameter.value * 180 / 3.141592653589793 + a['delta'])
    def dimlen(n):
        l = obj(n)
        a = xy(l.startSketchPoint); b = xy(l.endSketchPoint)
        return sk.sketchDimensions.addDistanceDimension(l.startSketchPoint, l.endSketchPoint, fus.DimensionOrientations.AlignedDimensionOrientation, mid(a, b), True)
    def dimrad(c):
        g = c.centerSketchPoint.geometry
        return sk.sketchDimensions.addRadialDimension(c, core.Point3D.create(g.x + c.radius * 0.7, g.y + c.radius * 0.7, 0), True)
    gc = sk.geometricConstraints
    for st in sc.get('prep', []):
        op = st['op']; n = st.get('e')
        if op == 'fix': pt(st['pt']).isFixed = True
        elif op == 'fixline':
            for p in ents[n]['pts']: p.isFixed = True
        elif op == 'hv': (gc.addHorizontal if st['d'] == 'H' else gc.addVertical)(obj(n))
        elif op == 'len': dimlen(n)
        elif op == 'rad': dimrad(obj(n))
        else: raise Exception('prep op ' + op)
    res = {'id': sc['id'], 'before': snap(), 'accepted': True, 'error': None}
    a = sc['act']
    try:
        op = a['op']
        if op == 'hv2': (gc.addHorizontalPoints if a['d'] == 'H' else gc.addVerticalPoints)(pt(a['pts'][0]), pt(a['pts'][1]))
        elif op == 'hv': (gc.addHorizontal if a['d'] == 'H' else gc.addVertical)(obj(a['order'][0]))
        elif op == 'parallel': gc.addParallel(obj(a['order'][0]), obj(a['order'][1]))
        elif op == 'perp': gc.addPerpendicular(obj(a['order'][0]), obj(a['order'][1]))
        elif op == 'collinear': gc.addCollinear(obj(a['order'][0]), obj(a['order'][1]))
        elif op == 'tangent': gc.addTangent(obj(a['order'][0]), obj(a['order'][1]))
        elif op == 'equal': gc.addEqual(obj(a['order'][0]), obj(a['order'][1]))
        elif op == 'coincident': gc.addCoincident(pt(a['pts'][0]), pt(a['pts'][1]))
        elif op == 'pointon':
            if a['order'][0] == 'pt': gc.addCoincident(pt(a['pt']), obj(a['curve']))
            else: gc.addCoincident(obj(a['curve']), pt(a['pt']))
        elif op == 'midpoint':
            if a['order'][0] == 'pt': gc.addMidPoint(pt(a['pt']), obj(a['curve']))
            else: gc.addMidPoint(obj(a['curve']), pt(a['pt']))
        elif op == 'dist':
            p1 = pt(a['pts'][0]); p2 = pt(a['pts'][1])
            ori = {'aligned': fus.DimensionOrientations.AlignedDimensionOrientation, 'horizontal': fus.DimensionOrientations.HorizontalDimensionOrientation, 'vertical': fus.DimensionOrientations.VerticalDimensionOrientation}[a['mode']]
            g1 = xy(p1); g2 = xy(p2)
            d = sk.sketchDimensions.addDistanceDimension(p1, p2, ori, P((g1[0] + g2[0]) / 2 + 12, (g1[1] + g2[1]) / 2 + 12), True)
            res['dim0_mm'] = round(d.parameter.value * 10, 9); setval(d, a, 'mm')
            res['dim'] = {'driving': bool(d.isDriving), 'value_mm': round(d.parameter.value * 10, 9)}
        elif op == 'len':
            d = dimlen(a['order'][0])
            res['dim0_mm'] = round(d.parameter.value * 10, 9); setval(d, a, 'mm')
            res['dim'] = {'driving': bool(d.isDriving), 'value_mm': round(d.parameter.value * 10, 9)}
        elif op == 'radius':
            d = dimrad(obj(a['order'][0]))
            res['dim0_mm'] = round(d.parameter.value * 10, 9); setval(d, a, 'mm')
            res['dim'] = {'driving': bool(d.isDriving), 'value_mm': round(d.parameter.value * 10, 9)}
        elif op == 'angle':
            l1 = obj(a['order'][0]); l2 = obj(a['order'][1])
            m1 = l1.startSketchPoint.geometry; m2 = l2.startSketchPoint.geometry
            d = sk.sketchDimensions.addAngularDimension(l1, l2, core.Point3D.create((m1.x + m2.x) / 2, (m1.y + m2.y) / 2, 0), True)
            res['dim0_deg'] = round(d.parameter.value * 180 / 3.141592653589793, 9); setval(d, a, 'deg')
            res['dim'] = {'driving': bool(d.isDriving), 'value_deg': round(d.parameter.value * 180 / 3.141592653589793, 9)}
        elif op == 'pointline':
            l = obj(a['line']); p = pt(a['pt']); g = xy(p)
            d = sk.sketchDimensions.addDistanceDimension(p, l, fus.DimensionOrientations.AlignedDimensionOrientation, P(g[0] + 12, g[1] + 12), True)
            res['dim'] = {'driving': bool(d.isDriving), 'value_mm': round(d.parameter.value * 10, 9)}
        else: raise Exception('act op ' + op)
    except Exception as ex:
        res['accepted'] = False
        res['error'] = str(ex).strip().split('\n')[0][:200]
    res['after'] = snap()
    res['sketchFull'] = bool(sk.isFullyConstrained)
    sk.deleteMe()
    return res

def go():
    t0 = time.time()
    des = adsk.fusion.Design.cast(app.activeProduct)
    assert des.userParameters.itemByName('CLAUDE_MARK') is not None, 'active document is not the scratch document'
    scs = json.load(open(IN_PATH))
    try: outd = json.load(open(OUT_PATH))
    except Exception: outd = {'results': {}}
    outd['fusion'] = app.version
    n = 0
    for sc in scs[FROM:TO]:
        if time.time() - t0 > 40: break
        try: r = run_one(des.rootComponent, sc)
        except Exception as ex: r = {'id': sc['id'], 'setupError': str(ex).strip().split('\n')[0][:200]}
        outd['results'][sc['id']] = r
        n += 1
    json.dump(outd, open(OUT_PATH, 'w'))
    print('ran', n, 'of', len(scs[FROM:TO]), 'sketches left', des.rootComponent.sketches.count, 'secs', round(time.time() - t0, 1))
go()
