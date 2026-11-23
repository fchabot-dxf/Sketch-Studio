Task 864 fixtures, captured read-only from the owner's design "bromont" (Fusion, second PC, 2026-11-23; not saved).
body1-single-solid.json  : the add-in's selection_data for Body1, Single Solid Body mode (stock thicknessMm 38.1, one Outside region).
body1-top-face.json      : NOT a separate file: identical to body1-single-solid.json except selectionId "CLAUDE_TEST_901_body1-top-face";
                           summary {"mode": "Faces", "items": [{"kind": "face", "count": 1, "names": ["Body1"], "detail": "1 face"}], "text": "Body1 · 1 face"};
                           source.kind "face"; "stock": null; region label "Body1 · Face 1", "depthMm": null, "through": false. Build it from that file.
sketch2-entire.json      : Sketch2, Entire Sketch mode: reg_0 = the rectangle around the part (with the part outline as its hole), reg_1 = the part outline, 2 chains.
THE PROJECT AT THE MOMENT OF THE BUG (bromont's saved per-design project, abbreviated where marked):
 operations: op-1 type stock, on, settings cutDepth 38.1, geometry [] (EMPTY);
             op-3 type exterior, on, geometry [{"key": "loop:loop_fusion1795456987884_4_s10-..._4_s10-..._4_s4-..._4_s5-..._4_s6-..._4_s7-..._4_s8-..._4_s9", "seq": 3}]
             (that key is NOT in project.regions).
 nextSeq 4.
 regions: only "loop:loop_fusion1795456987884_4_s0-..._4_s1-..._4_s2-..._4_s3" (Sketch2 Profile 1) and "chain:chain_fusion1795456987884_4_s11" (Sketch2 chain_1).
 stock: {"thickness": 38.1, "width": null, "height": null, "margin": 12.7}.
 selections: one, "Sketch2" (fusion, kind sketch), cutKeys = [that s0-s3 loop, that s11 chain], regionCount 2.
 Keys carry an import stamp + counter (fusion1795456987884_4_).
