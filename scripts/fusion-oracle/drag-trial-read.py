# TASK 530 phase 1 -- executed inside Fusion: prints every point of CLAUDE_TEST_DRAG (cm) after a drag, plus the sketch's constraint state.
import json
import adsk.core as c, adsk.fusion as f
app = c.Application.get(); des = f.Design.cast(app.activeProduct)
assert des.userParameters.itemByName('CLAUDE_MARK') is not None
sk = [s for s in des.rootComponent.sketches if s.name == 'CLAUDE_TEST_DRAG'][0]
out = {'edit': app.activeEditObject.name, 'lines': [], 'fullyConstrained': sk.isFullyConstrained}
for l in sk.sketchCurves.sketchLines:
    out['lines'].append([round(l.startSketchPoint.geometry.x, 5), round(l.startSketchPoint.geometry.y, 5), round(l.endSketchPoint.geometry.x, 5), round(l.endSketchPoint.geometry.y, 5)])
print(json.dumps(out))
