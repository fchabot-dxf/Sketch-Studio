// THE shape-id generator (task 541, advisor ruling): every NEW shape id (and a shape group id) is minted here, so two shapes made in the
// same millisecond never share an id. Date.now() (the id still sorts by creation time across sessions, so a new id does not meet a saved
// one) plus a monotonic counter (unique within the session). prefix: the id's leading letters ('s' for the tools' shapes).
// Saved ids keep whatever form they had; nothing parses a shape id.
let seq = 0;
export function newShapeId(prefix = 's') {
  return prefix + Date.now() + '_' + (++seq);
}
