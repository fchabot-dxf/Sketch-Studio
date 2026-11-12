# TASK 530 phase 1 -- executed INSIDE Fusion via mcp__fusion360__fusion_execute: `CASE = 1; exec(open(<this file>).read())`.
# Rebuilds sketch CLAUDE_TEST_DRAG for one hand case (cm), enters sketch edit mode, frames the view, and PRINTS a JSON line with the SCREEN pixel of
# the point to drag and of its target (viewport.modelToViewSpace + viewToScreen) plus the Fusion window canvas rect. Refuses to run unless the active
# document holds the user parameter CLAUDE_MARK (the scratch document made for task 530).
import json
import adsk.core as c, adsk.fusion as f
app = c.Application.get(); ui = app.userInterface
des = f.Design.cast(app.activeProduct)
assert des.userParameters.itemByName('CLAUDE_MARK') is not None, 'not the scratch document'
root = des.rootComponent
for s in list(root.sketches):
    if s.name != 'CLAUDE_TEST_DRAG': raise Exception('foreign sketch in scratch doc: ' + s.name)
prev = [[round(l.startSketchPoint.geometry.x, 5), round(l.startSketchPoint.geometry.y, 5), round(l.endSketchPoint.geometry.x, 5), round(l.endSketchPoint.geometry.y, 5)] for s in root.sketches for l in s.sketchCurves.sketchLines]
if app.activeEditObject.objectType == 'adsk::fusion::Sketch':
    ui.commandDefinitions.itemById('SketchStop').execute()
for s in list(root.sketches): s.deleteMe()
sk = root.sketches.add(root.xYConstructionPlane); sk.name = 'CLAUDE_TEST_DRAG'
P = c.Point3D.create; L = sk.sketchCurves.sketchLines; gc = sk.geometricConstraints
pts = {}
if CASE == 1:      # line, start fixed, length 10 dimensioned; drag the free end by (3,5)
    l = L.addByTwoPoints(P(0,0,0), P(10,0,0)); l.startSketchPoint.isFixed = True
    sk.sketchDimensions.addDistanceDimension(l.startSketchPoint, l.endSketchPoint, f.DimensionOrientations.AlignedDimensionOrientation, P(5,-2,0))
    pts = {'a': l.startSketchPoint, 'b': l.endSketchPoint}; drag = 'b'; target = (13, 5)
elif CASE == 2:    # free line, drag one end by (3,5)
    l = L.addByTwoPoints(P(1,1,0), P(8,1,0)); pts = {'a': l.startSketchPoint, 'b': l.endSketchPoint}; drag = 'b'; target = (11, 6)
elif CASE == 3:    # rectangle, H/V + coincident, corner (0,0) fixed, drag the opposite corner (8,5) to (12,6)
    l1 = L.addByTwoPoints(P(0,0,0), P(8,0,0)); l2 = L.addByTwoPoints(P(8,0,0), P(8,5,0)); l3 = L.addByTwoPoints(P(8,5,0), P(0,5,0)); l4 = L.addByTwoPoints(P(0,5,0), P(0,0,0))
    gc.addCoincident(l1.endSketchPoint, l2.startSketchPoint); gc.addCoincident(l2.endSketchPoint, l3.startSketchPoint)
    gc.addCoincident(l3.endSketchPoint, l4.startSketchPoint); gc.addCoincident(l4.endSketchPoint, l1.startSketchPoint)
    gc.addHorizontal(l1); gc.addVertical(l2); gc.addHorizontal(l3); gc.addVertical(l4)
    l1.startSketchPoint.isFixed = True
    pts = {'c00': l1.startSketchPoint, 'c80': l2.startSketchPoint, 'c85': l2.endSketchPoint, 'c05': l3.endSketchPoint}; drag = 'c85'; target = (12, 6)
ui.activeSelections.clear(); ui.activeSelections.add(sk)
ui.commandDefinitions.itemById('SketchActivate').execute()
vp = app.activeViewport
cam = vp.camera; cam.target = c.Point3D.create(6.5, 2.5, 0); cam.eye = c.Point3D.create(6.5, 2.5, 30); cam.viewExtents = 9.0; cam.isSmoothTransition = False; vp.camera = cam; vp.refresh()
def scr(x, y):
    s = vp.viewToScreen(vp.modelToViewSpace(P(x, y, 0))); return [int(s.x), int(s.y)]
g = pts[drag].geometry
o = vp.viewToScreen(c.Point2D.create(0, 0)); e = vp.viewToScreen(c.Point2D.create(vp.width, vp.height))
print(json.dumps({'prev_lines_after_last_drag': prev, 'case': CASE, 'edit': app.activeEditObject.name, 'drag': drag, 'from_model': [g.x, g.y], 'to_model': list(target),
                  'from_px': scr(g.x, g.y), 'to_px': scr(*target), 'px_per_cm': scr(1, 0)[0] - scr(0, 0)[0], 'viewport_px': [[int(o.x), int(o.y)], [int(e.x), int(e.y)]],
                  'before': {k: [round(p.geometry.x, 6), round(p.geometry.y, 6)] for k, p in pts.items()}}))
