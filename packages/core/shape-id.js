// THE shape-id generator (task 541, advisor ruling): every NEW shape id (and a shape group id) is minted here, so two shapes made in the
// same millisecond never share an id. Date.now() (the id still sorts by creation time across sessions, so a new id does not meet a saved
// one) plus a monotonic counter (unique within the session). prefix: the id's leading letters ('s' for the tools' shapes).
// Saved ids keep whatever form they had; nothing parses a shape id.
let seq = 0;
export function newShapeId(prefix = 's') {
  return prefix + Date.now() + '_' + (++seq);
}

// THE joint-id generator (task 564): the same module, a second counter, so a JOINT id never repeats within the session either. The counter
// is NOT reset by engine.init(), so a sketch built in the same millisecond as an earlier one gets different ids. The id keeps the old
// 'j' + n + '_' + Date.now() form (nothing parses it). Saved ids, j_origin and the reserved j_ref_x / j_ref_y are not minted here.
let jointSeq = 0;
export function newJointId() {
  return 'j' + (++jointSeq) + '_' + Date.now();
}
