import { groupOf, makeGroup, ungroup, renameGroup, shapesInGroup, loopsInGroup } from '#core/group-model.js';
import { createSketches } from '#core/sketch-model.js';

(async () => {
  const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };

  const fresh = () => ({
    ...createSketches(), // sketches + activeSketchId + groups:[]
    joints: new Map(), constraints: [],
    shapes: [
      // a "rect" with a factory groupId (the renderer's fill key — must stay untouched)
      { id: 'AB', type: 'line', joints: ['A', 'B'], groupId: 'rect_1' },
      { id: 'BC', type: 'line', joints: ['B', 'C'], groupId: 'rect_1' },
      { id: 'CD', type: 'line', joints: ['C', 'D'], groupId: 'rect_1' },
      { id: 'DA', type: 'line', joints: ['D', 'A'], groupId: 'rect_1' },
      { id: 'circ', type: 'circle', joints: ['Z'], radius: 5 },
    ],
  });

  // 1. default — no user groups; every shape ungrouped
  {
    const state = fresh();
    assert(Array.isArray(state.groups) && state.groups.length === 0, 'default: no user groups');
    assert(state.shapes.every((s) => groupOf(s) === null), 'default: all shapes ungrouped');
  }

  // 2. makeGroup — mints 'group-1', stamps the shapes, appends { id, name, sketchId }; the factory groupId UNTOUCHED
  {
    const state = fresh();
    const g = makeGroup(state, ['AB', 'circ'], 'Island A');
    assert(g.id === 'group-1' && g.name === 'Island A' && g.sketchId === 'sketch-1', 'group entry { id, name, sketchId }');
    assert(state.groups.length === 1, 'appended to state.groups');
    assert(groupOf(state.shapes.find((s) => s.id === 'AB')) === 'group-1' && groupOf(state.shapes.find((s) => s.id === 'circ')) === 'group-1', 'members stamped userGroupId');
    assert(groupOf(state.shapes.find((s) => s.id === 'BC')) === null, 'non-member not stamped');
    // CRITICAL: the factory groupId is a SEPARATE field, untouched
    assert(state.shapes.find((s) => s.id === 'AB').groupId === 'rect_1', 'factory groupId untouched (distinct from userGroupId)');
    assert(shapesInGroup(state, 'group-1').sort().join(',') === 'AB,circ', 'shapesInGroup');
    assert(makeGroup(state, []) === null, 'empty selection → null');
    const g2 = makeGroup(state, ['BC']);
    assert(g2.id === 'group-2' && g2.name === 'Group 2', 'next group id + auto-name');
  }

  // 3. loopsInGroup — a loop is in the group iff ALL its edge-shapes carry the userGroupId
  {
    const state = fresh();
    makeGroup(state, ['AB', 'BC', 'CD', 'DA']); // the whole rect loop
    const loops = [
      { id: 'loop_rect', edges: ['AB', 'BC', 'CD', 'DA'] },
      { id: 'loop_circ', edges: ['circ'] },
      { id: 'loop_partial', edges: ['AB', 'circ'] }, // circ not in the group → not fully grouped
    ];
    assert(loopsInGroup(loops, state, 'group-1').join(',') === 'loop_rect', 'only the fully-grouped loop counts');
  }

  // 4. ungroup — clears the stamps + removes the group; renameGroup
  {
    const state = fresh();
    const g = makeGroup(state, ['AB', 'BC']);
    renameGroup(state, g.id, 'Renamed');
    assert(state.groups[0].name === 'Renamed', 'renameGroup');
    ungroup(state, g.id);
    assert(state.groups.length === 0, 'group entry removed');
    assert(state.shapes.every((s) => groupOf(s) === null), 'all userGroupId stamps cleared');
    assert(state.shapes.find((s) => s.id === 'AB').groupId === 'rect_1', 'ungroup left the factory groupId untouched');
  }

  console.log('group-model tests passed ✅');
})().catch((e) => { console.error('group-model tests failed ❌', e); process.exit(1); });
