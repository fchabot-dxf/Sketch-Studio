# TASK 530 phase 2 -- executed inside Fusion AFTER drag-batch-setup.py (separate call): RUN = <run dir>; exec(open(<this file>).read())
# Frames the view (top view, 9 cm of height = about 95 px/cm), then writes the SCREEN pixel of every grab point and target into RUN/plan.json
# (modelToViewSpace + viewToScreen, read AFTER the camera is applied) and prints the pixel extent so the driver can check it lies inside the canvas.
import json, math
import adsk.core as c, adsk.fusion as f
app = c.Application.get()
des = f.Design.cast(app.activeProduct)
assert des.userParameters.itemByName('CLAUDE_MARK') is not None, 'not the scratch document'
assert app.activeEditObject.objectType == 'adsk::fusion::Sketch' and app.activeEditObject.name == 'CLAUDE_TEST_DRAG', 'not in sketch edit mode'
P = c.Point3D.create
cells = {x['id']: x for x in json.load(open(RUN + '/drag-cells.json'))['cells']}
PLAN = RUN + '/plan.json'
plan = json.load(open(PLAN))
vp = app.activeViewport
cam = vp.camera
cx, cy = (0.35, 0.2) if plan['batch'] in ('o', 'p') else (plan['cols'] * plan['pitch'] / 2 + 0.15 + 1.5, plan['rows'] * plan['pitch'] / 2 + 0.15)
cam.target = P(cx, cy, 0); cam.eye = P(cx, cy, 30); cam.viewExtents = 9.0; cam.isSmoothTransition = False; vp.camera = cam; vp.refresh()
def scr(x, y):
    s = vp.viewToScreen(vp.modelToViewSpace(P(x, y, 0))); return [int(round(s.x)), int(round(s.y))]
items = plan['items']
for it in items:
    cell = cells[it['cell']]; o = it['offset']
    if 'pt' in cell['grab']:
        g = it['before'][cell['grab']['pt'][0]]['pts'][cell['grab']['pt'][1]]; fr = [g[0] + o[0], g[1] + o[1]]
    else:
        fr = [cell['from'][0] + o[0], cell['from'][1] + o[1]]
    to = [fr[0] + cell['to'][0] - cell['from'][0], fr[1] + cell['to'][1] - cell['from'][1]]
    it['from_px'] = scr(*fr); it['to_px'] = scr(*to)
px = [p for it in items for p in (it['from_px'], it['to_px'])]
plan['px_per_cm'] = scr(1, 0)[0] - scr(0, 0)[0]
plan['extent_px'] = [min(p[0] for p in px), min(p[1] for p in px), max(p[0] for p in px), max(p[1] for p in px)]
json.dump(plan, open(PLAN, 'w'))
print('px/cm', plan['px_per_cm'], 'extent_px', plan['extent_px'], 'view extents', vp.camera.viewExtents)
