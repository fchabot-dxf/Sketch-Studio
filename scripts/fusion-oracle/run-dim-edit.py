# TASK 528 -- replays the dimension-edit runs (built by scripts/fusion-oracle/dim-edit-jobs.mjs) in a live Fusion 360: build the hold state, place the dimension at its
# measured value, then set the dimension's parameter (the same thing as typing in the box) and record where every point went. Executed INSIDE Fusion through
# mcp__fusion360__fusion_execute after setting IN_PATH (jobs json) and OUT_PATH (answers json). It reuses the Job class of run-jobs.py (task 518), so the scratch
# document guard (user parameter CLAUDE_MARK), the CLAUDE_TEST_* sketch name and the deletion of every sketch it makes are the same. Units: our mm / Fusion cm.
import json, time
src = open(RUNJOBS_PATH).read().rsplit('\ngo()', 1)[0]
exec(src, globals())

def _add_distance(self, c):
    if c.get('joints') and len(c['joints']) == 3:        # point to line: joints [P, A, B] -> the offset dimension of the line A-B and the point P
        p, a, b = c['joints']
        self.kind[c.get('uid')] = 'len'
        return self.sk.sketchDimensions.addOffsetDimension(self.line_between(a, b), self.pts[p], self.textpt(self.pts[p], self.pts[a]))
    return _orig_add_distance(self, c)
_orig_add_distance = Job.add_distance
Job.add_distance = _add_distance

def dim_values(j):
    out = {}
    for uid, k in j.kind.items():
        if uid == 'D' or uid not in j.cons: continue
        try:
            v = j.cons[uid].parameter.value
            out[str(uid)] = r9(v * 180 / math.pi) if k == 'angle' else r9(v * 10)
        except Exception: out[str(uid)] = None
    return out

def health(sk):
    try: return [int(sk.healthState), str(sk.errorOrWarningMessage)[:120]]
    except Exception as ex: return [None, str(ex)[:80]]

def run_one(root, jb):
    j = Job(root, jb['doc'])
    rec = {'id': jb['id'], 'buildErrors': j.buildErrors, 'initial': j.snap(False), 'initialHealth': health(j.sk), 'dimsBefore': dim_values(j)}
    try:
        r = j.add({**jb['params'], 'uid': 'D'}, None)
        rec['add'] = {'accepted': r['accepted'], 'error': r['error'], 'driving': r['driving']}
        if not r['accepted'] or r['driving'] is False: return rec
        rec['afterAdd'] = j.snap(False)
        o = j.cons['D']
        rec['valueAdd'] = r9(o.parameter.value * 180 / math.pi) if j.kind.get('D') == 'angle' else r9(o.parameter.value * 10)
        e = j.edit('D', jb['target'])
        rec['edit'] = e
        rec['health'] = health(j.sk)
        rec['after'] = j.snap(False)
        rec['dimsAfter'] = dim_values(j)
        rec['value'] = r9(o.parameter.value * 180 / math.pi) if j.kind.get('D') == 'angle' else r9(o.parameter.value * 10)
    finally:
        j.sk.deleteMe()
    return rec

def go_dim():
    t0 = time.time()
    des = adsk.fusion.Design.cast(app.activeProduct)
    assert des.userParameters.itemByName('CLAUDE_MARK') is not None, 'active document is not the scratch document'
    data = json.load(open(IN_PATH))
    try: outd = json.load(open(OUT_PATH))
    except Exception: outd = {'results': {}}
    outd['fusion'] = app.version
    n = 0
    for jb in data['jobs']:
        if time.time() - t0 > 25: break
        if jb['id'] in outd['results']: n += 1; continue
        try: outd['results'][jb['id']] = run_one(des.rootComponent, jb)
        except Exception as ex:
            outd['results'][jb['id']] = {'id': jb['id'], 'setupError': str(ex).strip().split('\n')[0][:200]}
            for s in list(des.rootComponent.sketches):
                if s.name == 'CLAUDE_TEST_JOB':
                    try: s.deleteMe()
                    except Exception: pass
        n += 1
    json.dump(outd, open(OUT_PATH, 'w'))
    print(data['name'], 'done', n, 'of', len(data['jobs']), 'sketches left', des.rootComponent.sketches.count, 'secs', round(time.time() - t0, 1))
go_dim()
