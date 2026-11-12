# TASK 551 -- executed INSIDE Fusion through mcp__fusion360__fusion_execute (one call at a time, never beside a mouse/key action):
#   MODE = 'setup' then, in a separate call, 'frame' (GX, GY = model point at the view centre) (NAME = new sketch name; optional SEG = [[x1,y1,x2,y2],...] cm lines to pre-draw; LOCK = index of a line to lock) | 'read'
#   exec(open(<this file>).read())
# setup: ADDS a sketch NAME on the XY plane (adding it enters edit mode), frames the top view (9 cm high),
#        prints the screen mapping inputs.
# read:  prints the active sketch: lines, arcs, circles, points, constraints (labelled), dimensions with values, and ui.activeCommand.
# Refuses to run unless the active document holds the user parameter CLAUDE_MARK (the scratch document made for task 551).
import json, math
import adsk.core as c, adsk.fusion as f
app = c.Application.get(); ui = app.userInterface
des = f.Design.cast(app.activeProduct)
assert des.userParameters.itemByName('CLAUDE_MARK') is not None, 'not the scratch document'
root = des.rootComponent
P = c.Point3D.create
r4 = lambda v: round(v, 4)
if MODE == 'setup':
    assert all(s.name.startswith('CLAUDE_TEST_') for s in root.sketches), 'foreign sketch'
    for o in root.sketches: o.isVisible = False      # earlier cases must not be snapped to or inferred from
    sk = root.sketches.add(root.xYConstructionPlane); sk.name = NAME
    for i, s in enumerate(globals().get('SEG', []) or []):
        if len(s) == 2: sk.sketchCurves.sketchLines.addByTwoPoints(sk.sketchCurves.sketchLines.item(0).startSketchPoint, P(s[0], s[1], 0))   # [x2, y2]: from line 0's start point (shared corner)
        else: sk.sketchCurves.sketchLines.addByTwoPoints(P(s[0], s[1], 0), P(s[2], s[3], 0))
    if globals().get('LOCK') is not None:
        ln = sk.sketchCurves.sketchLines.item(LOCK); ln.startSketchPoint.isFixed = True; ln.endSketchPoint.isFixed = True
    ui.activeSelections.clear(); ui.activeSelections.add(sk)
    ui.commandDefinitions.itemById('SketchActivate').execute()   # completes after this script returns: run MODE='frame' in a SEPARATE call
    print('sketch %s added, activation requested' % NAME)
elif MODE == 'frame':
    sk = app.activeEditObject
    assert sk.objectType == 'adsk::fusion::Sketch' and sk.name.startswith('CLAUDE_TEST_'), 'not in a CLAUDE_TEST sketch'
    vp = app.activeViewport; cam = vp.camera
    cam.target = P(GX, GY, 0); cam.eye = P(GX, GY, 30); cam.viewExtents = 9.0; cam.isSmoothTransition = False; vp.camera = cam; vp.refresh()
    o = vp.viewToScreen(vp.modelToViewSpace(P(GX, GY, 0)))
    print(json.dumps({'sketch': sk.name, 'center_screen_in_viewport_coords': [o.x, o.y], 'view': [vp.width, vp.height] if hasattr(vp, 'width') else None,
                      'mv_center': [vp.modelToViewSpace(P(GX, GY, 0)).x, vp.modelToViewSpace(P(GX, GY, 0)).y], 'mv_1cm': [vp.modelToViewSpace(P(GX + 1, GY, 0)).x, vp.modelToViewSpace(P(GX, GY + 1, 0)).y]}))
else:
    sk = app.activeEditObject
    out = {'activeCommand': ui.activeCommand, 'edit': getattr(sk, 'name', None), 'doc': app.activeDocument.name}
    if sk.objectType == 'adsk::fusion::Sketch':
        lab = {}
        for i, l in enumerate(sk.sketchCurves.sketchLines): lab[l.entityToken] = 'L%d' % i
        for i, l in enumerate(sk.sketchCurves.sketchArcs): lab[l.entityToken] = 'A%d' % i
        for i, l in enumerate(sk.sketchCurves.sketchCircles): lab[l.entityToken] = 'C%d' % i
        for i, p in enumerate(sk.sketchPoints): lab[p.entityToken] = 'P%d' % i
        L = lambda e: lab.get(e.entityToken, '?') if e is not None else None
        pt = lambda p: [r4(p.geometry.x), r4(p.geometry.y)]
        out['lines'] = {lab[l.entityToken]: [pt(l.startSketchPoint), pt(l.endSketchPoint)] for l in sk.sketchCurves.sketchLines}
        out['arcs'] = {lab[l.entityToken]: {'c': pt(l.centerSketchPoint), 's': pt(l.startSketchPoint), 'e': pt(l.endSketchPoint), 'r': r4(l.radius)} for l in sk.sketchCurves.sketchArcs}
        out['circles'] = {lab[l.entityToken]: {'c': pt(l.centerSketchPoint), 'r': r4(l.radius)} for l in sk.sketchCurves.sketchCircles}
        out['points'] = {lab[p.entityToken]: pt(p) + (['fixed'] if p.isFixed else []) for p in sk.sketchPoints if p != sk.originPoint}
        cs = []
        for g in sk.geometricConstraints:
            t = g.objectType.split('::')[-1]; ents = []
            for a in ('line', 'lineOne', 'lineTwo', 'curveOne', 'curveTwo', 'point', 'entityOne', 'entityTwo', 'curve', 'entity', 'circleOne', 'circleTwo', 'arc'):
                try:
                    e = getattr(g, a)
                    if e is not None: ents.append(L(e))
                except Exception: pass
            cs.append(t + ':' + ','.join(str(x) for x in ents))
        out['constraints'] = cs
        ds = []
        for d in sk.sketchDimensions:
            t = d.objectType.split('::')[-1]; p = d.parameter
            v = p.value
            ds.append({'type': t, 'value': r4(math.degrees(v)) if 'Angular' in t else r4(v), 'unit': 'deg' if 'Angular' in t else 'cm', 'expr': p.expression, 'driving': d.isDriving if hasattr(d, 'isDriving') else None,
                       'text_screen': [round(-1280 + 95 * (d.textPosition.x - 3.0)), round(1124 - 95 * (d.textPosition.y - 2.0))]})   # for the view framed at GX=3, GY=2 (95 px/cm)
        out['dimensions'] = ds
    print(json.dumps(out))
