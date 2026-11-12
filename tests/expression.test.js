// TASK 535 slice 1a — packages/core/expression.js (parser / evaluator / printer / dependencies) and the units.js table.
// TABLE-DRIVEN: each row is [input, ctx, expected, canonicalText?].
//   ctx      '' (no target, mm document) | 'in' / 'cm' (inch / cm document, no target) | 'L' length target | 'Lin' length target, inch document
//            | 'A' angle target | 'N' unitless target
//   expected [v, L, A] (v in base mm / degrees; L and A the unit exponents)  OR  'CODE@start,end' (an error and its position)
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  parseInput, evaluate, evaluateText, canonicalize, print, dependencies, validateName,
  CASE_SENSITIVE_NAMES, RESERVE_AUTO_DIM_NAMES, ACCEPTED_ARG_SEPARATORS, STORED_ARG_SEPARATOR, ALWAYS_STORE_UNITS,
  FRACTION_UNIT_IS_ONE_NUMBER, MAX_NAME_LENGTH,
} from '#core/expression.js';
import { parse as unitsParse, UNIT_TABLE, unitInfo, basePer, UNITS } from '#core/units.js';

const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
const near = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

// ── scope: width/gap/d1/d2 are lengths, holes is a plain number, ang an angle, d5 a REFERENCE dimension (refused) ──
const SCOPE = {
  width: { v: 120, L: 1, A: 0 }, gap: { v: 30, L: 1, A: 0 }, d1: { v: 10, L: 1, A: 0 }, d2: { v: 20, L: 1, A: 0 },
  holes: 4, ang: { v: 45, L: 0, A: 1 }, a: 3, b: 5, r: 2,
  d5: { ok: false, code: 'REFERENCE_DIM', message: 'd5 is a reference dimension' },
};
const lookup = (n) => (Object.prototype.hasOwnProperty.call(SCOPE, n) ? SCOPE[n] : undefined);
const CTX = { '': {}, in: { unit: 'in' }, cm: { unit: 'cm' }, L: { target: 'length' }, Lin: { target: 'length', unit: 'in' }, A: { target: 'angle' }, N: { target: 'none' } };

const ROWS = [
  // ── NUMBER ──
  ['5', '', [5, 0, 0]], ['5.', '', [5, 0, 0]], ['.5', '', [0.5, 0, 0]], ['0.25', '', [0.25, 0, 0]], ['007', '', [7, 0, 0]],
  ['1e3', '', [1000, 0, 0]], ['1E-2', '', [0.01, 0, 0]], ['2.5e+1', '', [25, 0, 0]], ['1.e2', '', [100, 0, 0]], ['  5  ', '', [5, 0, 0]],
  ['1e999', '', 'NOT_FINITE@0,5'],
  // ── every unit, case-insensitive, spaced or not ──
  ['5 mm', '', [5, 1, 0]], ['5mm', '', [5, 1, 0]], ['5MM', '', [5, 1, 0]], ['5 Mm', '', [5, 1, 0]],
  ['2 cm', '', [20, 1, 0]], ['0.5cm', '', [5, 1, 0]],
  ['1 in', '', [25.4, 1, 0]], ['0.25in', '', [6.35, 1, 0]], ['1"', '', [25.4, 1, 0]], ['1 "', '', [25.4, 1, 0]], ['2 IN', '', [50.8, 1, 0]],
  ['30 deg', '', [30, 0, 1]], ['30deg', '', [30, 0, 1]], ['30 DEG', '', [30, 0, 1]],
  ['1 rad', '', [180 / Math.PI, 0, 1]], ['PI rad', '', [180, 0, 1]],
  ['(1 + 2) mm', '', [3, 1, 0]], ['(1/2) in', '', [12.7, 1, 0]], ['holes mm', '', [4, 1, 0]], ['width mm', '', 'UNIT_MISMATCH@0,8'],
  // ── FRACTION_UNIT (O20) ──
  ['1/2 in', '', [12.7, 1, 0]], ['1 / 2 in', '', [12.7, 1, 0]], ['3/4"', '', [19.05, 1, 0]], ['1/2 mm', '', [0.5, 1, 0]],
  ['10/4 in', '', [63.5, 1, 0]], ['4/2 in', '', [50.8, 1, 0]], ['2 * 1/2 in', '', [25.4, 1, 0]], ['1/2', '', [0.5, 0, 0]],
  ['1.5/2 in', '', [1.5 / 50.8, -1, 0]], ['width/2 in', '', [120 / 50.8, 0, 0]], ['1/0 in', '', 'DIV_ZERO@2,3'], ['1/2 deg', '', [0.5, 0, 1]],
  // ── precedence and associativity ──
  ['1 + 2 * 3', '', [7, 0, 0]], ['(1 + 2) * 3', '', [9, 0, 0]], ['10 - 4 - 3', '', [3, 0, 0]], ['24 / 4 / 2', '', [3, 0, 0]],
  ['2 ^ 3 ^ 2', '', [512, 0, 0]], ['(2 ^ 3) ^ 2', '', [64, 0, 0]], ['-2 ^ 2', '', [-4, 0, 0]], ['(-2) ^ 2', '', [4, 0, 0]],
  ['2 ^ -1', '', [0.5, 0, 0]], ['- -3', '', [3, 0, 0]], ['--3', '', [3, 0, 0]], ['+5', '', [5, 0, 0]], ['+-5', '', [-5, 0, 0]],
  ['2 * -3', '', [-6, 0, 0]], ['2 - -3', '', [5, 0, 0]], ['2 ^ 2 * 3', '', [12, 0, 0]], ['2 * 3 ^ 2', '', [18, 0, 0]],
  ['8 / 2 * 4', '', [16, 0, 0]], ['2 + 3 - 1', '', [4, 0, 0]], ['1 - 2 + 3', '', [2, 0, 0]], ['((((7))))', '', [7, 0, 0]],
  ['-3 mm', '', [-3, 1, 0]], ['- 3 mm', '', [-3, 1, 0]], ['2 mm ^ 2', '', [4, 2, 0]], ['(2 mm) ^ 2', '', [4, 2, 0]], ['2 mm ^ 1', '', [2, 1, 0]],
  ['2 ^ 0.5', '', [Math.SQRT2, 0, 0]], ['-2 mm ^ 2', '', [-4, 2, 0]], ['2 * 3 mm', '', [6, 1, 0]],
  // ── dimension arithmetic ──
  ['10 mm / 4', '', [2.5, 1, 0]], ['10 mm / 4 mm', '', [2.5, 0, 0]], ['3 mm * 4 mm', '', [12, 2, 0]], ['3 mm * 2', '', [6, 1, 0]],
  ['2 * width', '', [240, 1, 0]], ['width * width / width', '', [120, 1, 0]], ['30 deg * 2', '', [60, 0, 1]], ['90 deg / 30 deg', '', [3, 0, 0]],
  ['width ^ 2', '', [14400, 2, 0]], ['width ^ 0', '', [1, 0, 0]], ['width ^ -1', '', [1 / 120, -1, 0]], ['1 mm * 1 deg', '', [1, 1, 1]],
  ['1 mm + 2 mm', '', [3, 1, 0]], ['1 cm + 5 mm', '', [15, 1, 0]], ['1 in - 1 cm', '', [15.4, 1, 0]], ['30 deg + 1 rad', '', [30 + 180 / Math.PI, 0, 1]],
  ['width - gap', '', [90, 1, 0]], ['ang / 2', '', [22.5, 0, 1]], ['holes * 2', '', [8, 0, 0]], ['holes + 1', '', [5, 0, 0]],
  // ── promotion of a bare number next to a length / angle (Fusion: width + 1 -> width + 1 mm) ──
  ['width + 1', '', [121, 1, 0], 'width + 1 mm'], ['width + 1', 'in', [145.4, 1, 0], 'width + 1 in'], ['1 + width', '', [121, 1, 0], '1 mm + width'],
  ['width - 5', 'Lin', [120 - 127, 1, 0], 'width - 5 in'], ['ang + 10', '', [55, 0, 1], 'ang + 10 deg'], ['width + 2 * 3', '', [126, 1, 0], 'width + (2 * 3) mm'],
  ['width + PI', '', [120 + Math.PI, 1, 0], 'width + PI mm'], ['-1 + width', '', [119, 1, 0], '-1 mm + width'],
  ['width / 2 + 5', 'L', [65, 1, 0], 'width / 2 + 5 mm'], ['width * 2 + 5', 'L', [245, 1, 0], 'width * 2 + 5 mm'],
  // ── target kind (the dimension / parameter being set) ──
  ['5', 'L', [5, 1, 0], '5 mm'], ['5', 'Lin', [127, 1, 0], '5 in'], ['7', 'A', [7, 0, 1], '7 deg'], ['5', 'N', [5, 0, 0], '5'],
  ['1 + 2', 'L', [3, 1, 0], '(1 + 2) mm'], ['2*3', 'L', [6, 1, 0], '(2 * 3) mm'], ['-5', 'L', [-5, 1, 0], '-5 mm'], ['-(2*3)', 'L', [-6, 1, 0], '-(2 * 3) mm'],
  ['holes', 'L', [4, 1, 0], 'holes mm'], ['holes', 'N', [4, 0, 0], 'holes'], ['width / gap', 'L', [4, 1, 0], '(width / gap) mm'],
  ['width', 'L', [120, 1, 0], 'width'], ['30 deg', 'A', [30, 0, 1], '30 deg'], ['1 rad', 'A', [180 / Math.PI, 0, 1], '1 rad'],
  ['2 in', 'Lin', [50.8, 1, 0], '2 in'], ['PI', 'L', [Math.PI, 1, 0], 'PI mm'],
  ['30 deg', 'L', 'UNIT_MISMATCH@0,6'], ['width', 'A', 'UNIT_MISMATCH@0,5'], ['width', 'N', 'UNIT_MISMATCH@0,5'], ['ang', 'L', 'UNIT_MISMATCH@0,3'],
  ['5 mm', 'A', 'UNIT_MISMATCH@0,4'], ['5 mm', 'N', 'UNIT_MISMATCH@0,4'], ['width * width', 'L', 'UNIT_MISMATCH@0,13'], ['1 mm * 1 deg', 'L', 'UNIT_MISMATCH@0,12'],
  // ── + and - mismatches ──
  ['1 mm + 2 deg', '', 'UNIT_MISMATCH@0,12'], ['1 mm - 2 deg', '', 'UNIT_MISMATCH@0,12'], ['holes + width', '', 'UNIT_MISMATCH@0,13'],
  ['1 mm + 2 mm * 3 mm', '', 'UNIT_MISMATCH@0,18'], ['ang + width', '', 'UNIT_MISMATCH@0,11'], ['1 + 2 mm * 3 mm', '', 'UNIT_MISMATCH@0,15'],
  // ── functions ──
  ['sqrt(16) * 1 mm', '', [4, 1, 0]], ['sqrt(16)', '', [4, 0, 0]], ['sqrt(16 mm ^ 2)', '', [16, 1, 0]], ['sqrt(4 mm * 4 mm)', '', [4, 1, 0]], ['sqrt(d1^2 + d2^2)', '', [Math.sqrt(500), 1, 0]],
  ['sqrt(4 mm)', '', 'UNIT_MISMATCH@0,10'], ['sqrt(-1)', '', 'NOT_FINITE@0,8'], ['sqrt(0)', '', [0, 0, 0]],
  ['abs(-4 mm)', '', [4, 1, 0]], ['abs(-4)', '', [4, 0, 0]], ['abs(3 deg - 5 deg)', '', [2, 0, 1]],
  ['floor(2.7) * 1 mm', '', [2, 1, 0]], ['floor(2.7)', '', [2, 0, 0]], ['floor(-2.1)', '', [-3, 0, 0]], ['floor(2.7 mm)', '', [2, 1, 0]],
  ['ceil(2.1)', '', [3, 0, 0]], ['ceil(2.1 mm)', '', [3, 1, 0]], ['ceil(-2.9)', '', [-2, 0, 0]],
  ['round(2.5)', '', [3, 0, 0]], ['round(2.4)', '', [2, 0, 0]], ['round(width / 7)', '', 'UNIT_MISMATCH@0,16'], ['floor(width)', '', 'UNIT_MISMATCH@0,12'], ['ceil(1 mm + 2 mm)', '', 'UNIT_MISMATCH@0,17'], ['round(ang)', '', 'UNIT_MISMATCH@0,10'],
  ['floor(width / 1 mm) * 1 mm', '', [120, 1, 0]], ['floor(width / 7 mm) * 1 mm', '', [17, 1, 0]], ['ceil(holes / 3) * 1 mm', '', [2, 1, 0]],
  ['floor(-2.7 mm)', '', [-3, 1, 0]], ['ceil(-2.7 mm)', '', [-2, 1, 0]], ['floor(1/2 in)', '', [0, 1, 0]], ['ceil(1/2 in)', '', [25.4, 1, 0]], ['round(2.5 deg)', '', [3, 0, 1]],
  ['floor(2.7 cm)', '', [20, 1, 0]], ['floor(holes)', '', [4, 0, 0]], ['floor(PI)', '', [3, 0, 0]], ['round(1.4 in)', '', [25.4, 1, 0]], ['round(1.4 in)', 'in', [25.4, 1, 0]],
  ['min(1; 2)', '', [1, 0, 0]], ['min(3, 2, 1)', '', [1, 0, 0]], ['min(3; 2, 1)', '', [1, 0, 0]], ['max(2 mm; 3 mm)', '', [3, 1, 0]],
  ['max(2 mm, 3 mm)', '', [3, 1, 0]], ['max(width; 50 mm)', '', [120, 1, 0]], ['max(1 mm; 2)', '', [2, 1, 0], 'max(1 mm; 2 mm)'],
  ['max(2; 1 mm)', 'in', [25.4 * 2, 1, 0], 'max(2 in; 1 mm)'], ['min(1 mm; 2 deg)', '', 'UNIT_MISMATCH@0,16'], ['max(holes; width)', '', 'UNIT_MISMATCH@0,17'],
  ['max(1)', '', 'SYNTAX@0,6'], ['min()', '', 'SYNTAX@4,5'], ['sqrt(1; 2)', '', 'SYNTAX@0,10'], ['abs()', '', 'SYNTAX@4,5'],
  ['sin(30)', '', [0.5, 0, 0], 'sin(30 deg)'], ['sin(30 deg)', '', [0.5, 0, 0]], ['sin(PI rad)', '', [0, 0, 0]], ['cos(60 deg)', '', [0.5, 0, 0]],
  ['cos(0)', '', [1, 0, 0]], ['tan(45)', '', [1, 0, 0]], ['sin(ang)', '', [Math.SQRT1_2, 0, 0]], ['sin(1 mm)', '', 'UNIT_MISMATCH@0,9'],
  ['asin(1)', '', [90, 0, 1]], ['acos(0)', '', [90, 0, 1]], ['atan(1)', '', [45, 0, 1]], ['asin(2)', '', 'NOT_FINITE@0,7'], ['atan(1 mm)', '', 'UNIT_MISMATCH@0,10'],
  ['asin(0.5) + 1 deg', '', [31, 0, 1]], ['asin(0.5)', 'A', [30, 0, 1], 'asin(0.5)'],
  // ── constants and names ──
  ['PI', '', [Math.PI, 0, 0]], ['PI * 1 mm', '', [Math.PI, 1, 0]], ['2 * PI * 5 mm', '', [10 * Math.PI, 1, 0]],
  ['width', '', [120, 1, 0]], ['width / 2', '', [60, 1, 0]], ['holes', '', [4, 0, 0]], ['a * b', '', [15, 0, 0]],
  ['unknown', '', 'UNKNOWN_NAME@0,7'], ['width + nope', '', 'UNKNOWN_NAME@8,12'], ['foo(1)', '', 'UNKNOWN_NAME@0,3'], ['Width', '', 'UNKNOWN_NAME@0,5'],
  ['WIDTH', '', 'UNKNOWN_NAME@0,5'], ['d5', '', 'REFERENCE_DIM@0,2'], ['width + d5', '', 'REFERENCE_DIM@8,10'], ['SQRT(4)', '', 'UNKNOWN_NAME@0,4'],
  ['sqrt', '', 'SYNTAX@0,4'], ['sqrt + 1', '', 'SYNTAX@0,4'],
  // ── numeric errors ──
  ['1 / 0', '', 'DIV_ZERO@4,5'], ['1 / (2 - 2)', '', 'DIV_ZERO@5,10'], ['width / 0 mm', '', 'DIV_ZERO@8,12'], ['0 ^ -1', '', 'DIV_ZERO@0,6'],
  ['10 ^ 400', '', 'NOT_FINITE@0,8'], ['(-8) ^ 0.5', '', 'NOT_FINITE@1,10'], ['width ^ 0.5', '', 'UNIT_MISMATCH@8,11'],
  ['width ^ width', '', 'UNIT_MISMATCH@8,13'], ['2 ^ width', '', 'UNIT_MISMATCH@4,9'], ['2 mm ^ 1 mm', '', 'UNIT_MISMATCH@7,11'], ['(1 mm) mm', '', 'UNIT_MISMATCH@1,9'],
  ['1e300 * 1e300', '', 'NOT_FINITE@0,13'],
  // ── syntax errors with positions ──
  ['', '', 'SYNTAX@0,0'], ['   ', '', 'SYNTAX@3,3'], ['(', '', 'SYNTAX@1,1'], ['(1', '', 'SYNTAX@2,2'], ['1)', '', 'SYNTAX@1,2'], ['1 +', '', 'SYNTAX@3,3'],
  ['* 2', '', 'SYNTAX@0,1'], ['1 $ 2', '', 'SYNTAX@2,3'], ['1 2', '', 'SYNTAX@2,3'], ['1.2.3', '', 'SYNTAX@3,5'], ['mm', '', 'SYNTAX@0,2'],
  ['2 mm mm', '', 'SYNTAX@5,7'], ['2 width', '', 'SYNTAX@2,7'], ['2 (3)', '', 'SYNTAX@2,3'], ['2 ; 3', '', 'SYNTAX@2,3'], ['max(1;)', '', 'SYNTAX@6,7'],
  ['max(1 2)', '', 'SYNTAX@6,7'], ['max 1', '', 'SYNTAX@0,3'], ['()', '', 'SYNTAX@1,2'], ['1 + * 2', '', 'SYNTAX@4,5'], ['2x', '', 'SYNTAX@1,2'], ['1 ^', '', 'SYNTAX@3,3'],
  ['max(1, 2', '', 'SYNTAX@8,8'], ['é', '', 'SYNTAX@0,1'], ['5 %', '', 'SYNTAX@2,3'], ['2 width + 1', '', 'SYNTAX@2,7'],
  // ── "=" is never part of an expression ──
  ['1 == 2', '', 'ASSIGN_NOT_TOP@2,3'], ['(a = 3)', '', 'ASSIGN_NOT_TOP@3,4'], ['a = 3', '', 'ASSIGN_NOT_TOP@2,3'], ['= 3', '', 'ASSIGN_NOT_TOP@0,1'],
  ['max(a = 3; 1)', '', 'ASSIGN_NOT_TOP@6,7'], ['1 + a = 3', '', 'ASSIGN_NOT_TOP@6,7'],
];

// Fusion MEASURED (API, 535-1a ruling): floor / ceil / round round in the unit the ARGUMENT IS WRITTEN IN, never the document's or
// the parameter's unit. Same result in an mm, a cm and an inch document.
const MEASURED = [
  ['floor(2.7 mm)', [2, 1, 0]], ['floor(27 mm)', [27, 1, 0]], ['ceil(2.7 mm)', [3, 1, 0]], ['round(2.4 mm)', [2, 1, 0]], ['floor(30.5 mm)', [30, 1, 0]],
  ['floor(2.7 in)', [50.8, 1, 0]], ['floor(1 in)', [25.4, 1, 0]], ['round(25.4 mm)', [25, 1, 0]], ['floor(2.7) * 1 mm', [2, 1, 0]],
  ['floor(27 mm / 1 mm) * 1 mm', [27, 1, 0]],
];
const MEASURED_TARGETS = [['', {}], ['in', { unit: 'in' }], ['cm', { unit: 'cm' }], ['L', { target: 'length' }], ['Lin', { target: 'length', unit: 'in' }]];
let rows = 0;
for (const [input, want] of MEASURED) for (const [k, c] of MEASURED_TARGETS) {
  rows++;
  const r = evaluateText(input, lookup, c);
  assert(r.ok && near(r.v, want[0]) && r.L === 1 && r.A === 0, `measured ${input} [${k}]: expected ${want[0]} mm, got ${JSON.stringify(r.ok ? [r.v, r.L, r.A] : r.code)}`);
}

const parseExpect = (e) => { const m = /^([A-Z_]+)@(\d+),(\d+)$/.exec(e); return { code: m[1], start: +m[2], end: +m[3] }; };
for (const [input, ck, expected, text] of ROWS) {
  rows++;
  const ctx = CTX[ck];
  assert(ctx, `bad ctx key ${ck}`);
  const r = evaluateText(input, lookup, ctx);
  const label = `row ${JSON.stringify(input)} [${ck}]`;
  if (typeof expected === 'string') {
    const x = parseExpect(expected);
    assert(r.ok === false, `${label}: expected error ${expected}, got ok ${JSON.stringify(r)}`);
    assert(r.code === x.code && r.at.start === x.start && r.at.end === x.end, `${label}: expected ${expected}, got ${r.code}@${r.at.start},${r.at.end} (${r.message})`);
    assert(typeof r.message === 'string' && r.message.length > 0, `${label}: an error has a message`);
  } else {
    assert(r.ok === true, `${label}: expected value, got ${r.code}@${r.at && r.at.start},${r.at && r.at.end} (${r.message})`);
    assert(near(r.v, expected[0]) && r.L === expected[1] && r.A === expected[2], `${label}: expected ${JSON.stringify(expected)}, got [${r.v},${r.L},${r.A}]`);
    if (text !== undefined) {
      const p = parseInput(input, { allowAssign: false });
      const c = canonicalize(p.ast, lookup, ctx);
      assert(c.ok && c.text === text, `${label}: canonical text expected ${JSON.stringify(text)}, got ${JSON.stringify(c.text)}`);
      // the stored text means the same under ANY document unit and needs no target to promote (decision O19)
      const back = evaluateText(c.text, lookup, { target: ctx.target, unit: ctx.unit === 'in' ? 'mm' : 'in' });
      assert(back.ok && near(back.v, r.v) && back.L === r.L && back.A === r.A, `${label}: canonical text ${c.text} re-evaluates differently: ${JSON.stringify(back)}`);
    }
  }
}

// ── print(parse(x)): canonical text, stable (round trip) ──
const PRINT_ROWS = [
  ['width/2+5', 'width / 2 + 5'], ['1+2*3', '1 + 2 * 3'], ['(1+2)*3', '(1 + 2) * 3'], ['1-(2-3)', '1 - (2 - 3)'], ['1-2-3', '1 - 2 - 3'], ['1-(2+3)', '1 - (2 + 3)'],
  ['2^3^2', '2 ^ 3 ^ 2'], ['(2^3)^2', '(2 ^ 3) ^ 2'], ['-(2^2)', '-2 ^ 2'], ['(-2)^2', '(-2) ^ 2'], ['2^-1', '2 ^ -1'], ['- -3', '--3'], ['+5 mm', '5 mm'],
  ['(width)', 'width'], ['((1 mm))', '1 mm'], ['1e3', '1000'], ['.5', '0.5'], ['5.', '5'], ['sqrt( 16 )', 'sqrt(16)'], ['max(a, b)', 'max(a; b)'], ['max(a;b)', 'max(a; b)'],
  ['30 DEG', '30 deg'], ['1 "', '1 in'], ['1 RAD', '1 rad'], ['2 mm^2', '2 mm ^ 2'], ['(2 mm)^2', '2 mm ^ 2'], ['2^2 mm', '2 ^ 2 mm'], ['(2^2) mm', '(2 ^ 2) mm'],
  ['1/2 in', '(1 / 2) in'], ['(1/2) in', '(1 / 2) in'], ['1 / (2 in)', '1 / (2 in)'], ['width*1/(2 in)', 'width * 1 / (2 in)'], ['(1 mm)^2', '1 mm ^ 2'],
  ['-3 mm', '-3 mm'], ['(-3) mm', '(-3) mm'], ['a*(b+c)', 'a * (b + c)'], ['a/(b*c)', 'a / (b * c)'], ['a/b/c', 'a / b / c'], ['a*-b', 'a * -b'], ['-a*b', '-a * b'],
  ['-(a*b)', '-(a * b)'], ['max(1, min(2, 3)) mm', 'max(1; min(2; 3)) mm'], ['sin(30 deg)^2', 'sin(30 deg) ^ 2'], ['PI', 'PI'], ['2 * PI * r', '2 * PI * r'],
  ['  gap  =  1 ', null], // an assignment is not an allowAssign:false expression
];
for (const [input, want] of PRINT_ROWS) {
  rows++;
  const p = parseInput(input, { allowAssign: false });
  if (want === null) { assert(!p.ok && p.code === 'ASSIGN_NOT_TOP', 'allowAssign:false rejects name = value'); continue; }
  assert(p.ok, `print row ${input}: parse failed ${JSON.stringify(p)}`);
  const t1 = print(p.ast);
  assert(t1 === want, `print(parse(${JSON.stringify(input)})) expected ${JSON.stringify(want)}, got ${JSON.stringify(t1)}`);
  const p2 = parseInput(t1, { allowAssign: false });
  assert(p2.ok && print(p2.ast) === t1, `print(parse(${input})) is not stable: ${t1} -> ${p2.ok && print(p2.ast)}`);
}
// every parsable ROWS input is stable and keeps its value under print/parse
for (const [input, ck] of ROWS) {
  const p = parseInput(input, { allowAssign: false });
  if (!p.ok) continue;
  const t1 = print(p.ast);
  const p2 = parseInput(t1, { allowAssign: false });
  assert(p2.ok, `reparse of ${t1}`);
  assert(print(p2.ast) === t1, `print not stable for ${input}: ${t1} -> ${print(p2.ast)}`);
  const a = evaluate(p.ast, lookup, CTX[ck]);
  const b = evaluate(p2.ast, lookup, CTX[ck]);
  assert(a.ok === b.ok && (!a.ok ? a.code === b.code : near(a.v, b.v) && a.L === b.L && a.A === b.A), `round trip changes the value of ${input} (${t1})`);
  rows++;
}

// ── the assignment form `name = expression`: ONLY at the top level ──
const ASSIGN_OK = [
  ['width = 120', 'width', [], '120'], ['  gap  =  width / 4 + 2 mm ', 'gap', ['width'], 'width / 4 + 2 mm'], ['gap=1', 'gap', [], '1'],
  ['Width = 3', 'Width', [], '3'], ['D5 = 3', 'D5', [], '3'], ['d = 1', 'd', [], '1'], ['dx1 = 1', 'dx1', [], '1'], ['_a1 = 1', '_a1', [], '1'],
  ['x = max(a; b) + x', 'x', ['a', 'b', 'x'], 'max(a; b) + x'], ['n'.repeat(MAX_NAME_LENGTH) + ' = 1', 'n'.repeat(MAX_NAME_LENGTH), [], '1'],
];
for (const [input, name, deps, text] of ASSIGN_OK) {
  rows++;
  const p = parseInput(input);
  assert(p.ok && p.assign && p.assign.name === name, `assign ${input}: ${JSON.stringify(p)}`);
  assert(input.slice(p.assign.at.start, p.assign.at.end) === name, `assign ${input}: name span`);
  assert(JSON.stringify(dependencies(p)) === JSON.stringify(deps), `assign ${input}: deps ${JSON.stringify(dependencies(p))}`);
  assert(print(p.ast) === text, `assign ${input}: rhs ${print(p.ast)}`);
}
const ASSIGN_BAD = [
  ['x = ', 'SYNTAX@4,4'], ['= 3', 'ASSIGN_NOT_TOP@0,1'], ['(a = 3)', 'ASSIGN_NOT_TOP@3,4'], ['a = b = 3', 'ASSIGN_NOT_TOP@6,7'], ['a == 3', 'ASSIGN_NOT_TOP@3,4'],
  ['1 + a = 3', 'ASSIGN_NOT_TOP@6,7'], ['max(a = 3; 1)', 'ASSIGN_NOT_TOP@6,7'], ['a = (b = 2)', 'ASSIGN_NOT_TOP@7,8'], ['a = 1 = 2', 'ASSIGN_NOT_TOP@6,7'],
  ['mm = 3', 'RESERVED_NAME@0,2'], ['IN = 3', 'RESERVED_NAME@0,2'], ['sqrt = 2', 'RESERVED_NAME@0,4'], ['PI = 3', 'RESERVED_NAME@0,2'], ['d5 = 40', 'RESERVED_NAME@0,2'],
  ['deg = 1', 'RESERVED_NAME@0,3'], ['max = 1', 'RESERVED_NAME@0,3'],
  ['my width = 3', 'BAD_NAME@0,8'], ['2x = 3', 'BAD_NAME@0,2'], ['3 = 4', 'BAD_NAME@0,1'], ['a.b = 3', 'BAD_NAME@0,3'], ['n'.repeat(MAX_NAME_LENGTH + 1) + ' = 1', `BAD_NAME@0,${MAX_NAME_LENGTH + 1}`],
];
for (const [input, e] of ASSIGN_BAD) {
  rows++;
  const x = parseExpect(e);
  const p = parseInput(input);
  assert(!p.ok && p.code === x.code && p.at.start === x.start && p.at.end === x.end, `assign-bad ${JSON.stringify(input)}: expected ${e}, got ${p.ok ? 'ok' : `${p.code}@${p.at.start},${p.at.end}`}`);
}
{ rows++; const p = parseInput('width = 120', { allowAssign: false }); assert(!p.ok && p.code === 'ASSIGN_NOT_TOP' && p.at.start === 6, 'allowAssign:false refuses the form (a parameter Expression cell)'); }

// ── dependencies ──
const DEPS = [
  ['width', ['width']], ['width + gap * width', ['width', 'gap']], ['1 + 2', []], ['PI * r', ['r']], ['max(a; b) + sqrt(a)', ['a', 'b']], ['sin(ang)', ['ang']],
  ['d1 + d2', ['d1', 'd2']], ['-(width mm)', ['width']], ['(1/2) in', []], ['2 * PI', []], ['b ^ a', ['b', 'a']], ['sqrt(d1^2 + d2^2) + d1', ['d1', 'd2']],
];
for (const [input, deps] of DEPS) {
  rows++;
  const p = parseInput(input, { allowAssign: false });
  assert(p.ok && JSON.stringify(dependencies(p.ast)) === JSON.stringify(deps), `deps ${input}: ${JSON.stringify(dependencies(p.ast))}`);
}

// ── names ──
const NAMES = [
  ['width', 'parameter', true], ['_a', 'parameter', true], ['a1_b', 'parameter', true], ['d', 'parameter', true], ['dx1', 'parameter', true], ['d1x', 'parameter', true], ['D5', 'parameter', true],
  ['d12', 'dimension', true], ['my width', 'parameter', 'BAD_NAME'], ['', 'parameter', 'BAD_NAME'], ['1a', 'parameter', 'BAD_NAME'], ['a-b', 'parameter', 'BAD_NAME'],
  ['é', 'parameter', 'BAD_NAME'], ['a.b', 'parameter', 'BAD_NAME'], ['n'.repeat(MAX_NAME_LENGTH + 1), 'parameter', 'BAD_NAME'], ['n'.repeat(MAX_NAME_LENGTH), 'parameter', true],
  ['mm', 'parameter', 'RESERVED_NAME'], ['MM', 'parameter', 'RESERVED_NAME'], ['In', 'dimension', 'RESERVED_NAME'], ['cm', 'dimension', 'RESERVED_NAME'], ['deg', 'parameter', 'RESERVED_NAME'],
  ['rad', 'parameter', 'RESERVED_NAME'], ['sqrt', 'parameter', 'RESERVED_NAME'], ['max', 'dimension', 'RESERVED_NAME'], ['PI', 'parameter', 'RESERVED_NAME'], ['d12', 'parameter', 'RESERVED_NAME'],
  ['taken', 'parameter', 'NAME_TAKEN'], ['d2', 'dimension', 'NAME_TAKEN'],
];
for (const [name, kind, want] of NAMES) {
  rows++;
  const r = validateName(name, { kind, isTaken: (n) => n === 'taken' || n === 'd2' });
  if (want === true) assert(r.ok === true, `name ${JSON.stringify(name)} should be valid: ${JSON.stringify(r)}`);
  else assert(r.ok === false && r.code === want && r.at.start === 0 && r.at.end === name.length, `name ${JSON.stringify(name)} expected ${want}, got ${JSON.stringify(r)}`);
}

// ── the unit table (ONE table, in units.js) ──
{
  assert(UNIT_TABLE.mm.f === 1 && UNIT_TABLE.cm.f === 10 && UNIT_TABLE.in.f === 25.4, 'length factors');
  assert(UNIT_TABLE['"'].alias === 'in', '" is an alias of in');
  assert(UNIT_TABLE.deg.kind === 'angle' && UNIT_TABLE.deg.f === 1 && UNIT_TABLE.rad.f === 180 / Math.PI, 'angle factors (base degrees)');
  assert(unitInfo('"').name === 'in' && unitInfo('IN').f === 25.4 && unitInfo('RAD').kind === 'angle' && unitInfo('furlong') === null && unitInfo(5) === null, 'unitInfo');
  assert(basePer('in') === 25.4 && basePer('cm') === 10 && basePer('mm') === 1 && basePer('zz') === 1, 'basePer reads the table');
  assert(UNITS.join() === 'mm,cm,in', 'the document-unit list is unchanged (angle units are not document units)');
  rows += 5;
}

// ── units.parse and the evaluator never disagree on a plain number (slice 1a STOP condition) ──
const PARSE_STRINGS = ['5', '5mm', '0.25in', '5 mm', '.25in', '5MM', '-3mm', '5.', '+5', '2cm', '1in', '-0', '12.5', '0', '1e0mm'.replace('e0', ''), '-.5in', ' 7 cm '];
for (const s of PARSE_STRINGS) {
  for (const du of ['mm', 'cm', 'in']) {
    const want = unitsParse(s, du);
    if (want === null) continue;
    const r = evaluateText(s, lookup, { target: 'length', unit: du });
    assert(r.ok && r.v === want, `units.parse(${JSON.stringify(s)}, ${du}) = ${want} but the evaluator gives ${r.ok ? r.v : r.code}`);
    rows++;
  }
}

// ── errors are data: nothing a user can type throws ──
{
  const nasty = ['(('.repeat(500), '-'.repeat(1000) + '1', '1' + ' +1'.repeat(900), 'a'.repeat(5000), '\u0000', 'x'.repeat(100) + '(', '1'.repeat(400), '"', '""', ' = ', '=', 'sqrt(sqrt(sqrt(', '1e', '1e+', '..', '.'];
  for (const s of nasty) {
    for (const aa of [true, false]) {
      let r;
      try { r = parseInput(s, { allowAssign: aa }); if (r.ok) r = evaluate(r.ast, lookup, {}); } catch (e) { throw new Error(`threw on ${JSON.stringify(s.slice(0, 20))}: ${e.message}`); }
      assert(r.ok === true || (typeof r.code === 'string' && r.at && typeof r.at.start === 'number'), 'a result object either way');
      rows++;
    }
  }
  assert(parseInput('(('.repeat(500)).code === 'SYNTAX', 'deep nesting is a SYNTAX error, not a stack overflow');
  assert(parseInput(null).ok === false && parseInput(undefined).code === 'SYNTAX', 'non-text input is data');
  assert(evaluateText('1', null, {}).ok === true && evaluateText('x', null, {}).code === 'UNKNOWN_NAME', 'a missing lookup callback: names are unknown');
}

// ── PROPERTY TEST: random valid ASTs. evaluate(parse(print(ast))) == evaluate(ast); the stored text is unit-complete ──
{
  let seed = 535;
  const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const NUMS = [0, 1, 2, 3, 4, 0.5, 2.5, 10, 100, 7, 1e-7, 1e21];
  const NAMES_ = ['width', 'gap', 'holes', 'ang', 'd1', 'a', 'PI'];
  const UNITS_ = ['mm', 'cm', 'in', 'deg', 'rad'];
  const FN = { sqrt: 1, abs: 1, floor: 1, ceil: 1, round: 1, min: 2, max: 2, sin: 1, cos: 1, tan: 1, asin: 1, acos: 1, atan: 1 };
  const gen = (d) => {
    const r = rnd();
    if (d <= 0 || r < 0.22) return rnd() < 0.7 ? { t: 'num', value: pick(NUMS) } : { t: 'name', name: pick(NAMES_) };
    if (r < 0.40) return { t: 'unit', unit: pick(UNITS_), arg: gen(d - 1) };
    if (r < 0.46) return { t: 'neg', arg: gen(d - 1) };
    if (r < 0.80) return { t: 'bin', op: pick(['+', '-', '*', '/', '^']), left: gen(d - 1), right: gen(d - 1) };
    const fn = pick(Object.keys(FN));
    const n = FN[fn] === 1 ? 1 : 2 + Math.floor(rnd() * 2);
    return { t: 'call', fn, args: Array.from({ length: n }, () => gen(d - 1)) };
  };
  const same = (a, b) => a.ok === b.ok && (a.ok ? near(a.v, b.v) && a.L === b.L && a.A === b.A : a.code === b.code);
  let okCount = 0, total = 0;
  for (let i = 0; i < 4000; i++) {
    const ast = gen(1 + Math.floor(rnd() * 5));
    const text = print(ast);
    const p = parseInput(text, { allowAssign: false });
    assert(p.ok, `printed AST does not parse: ${text}: ${JSON.stringify(p)}`);
    assert(print(p.ast) === text, `print is not stable: ${text} -> ${print(p.ast)}`);
    for (const ctx of [{}, { unit: 'in' }, { target: 'length', unit: 'in' }, { target: 'angle' }]) {
      const a = evaluate(ast, lookup, ctx);
      const b = evaluate(p.ast, lookup, ctx);
      assert(same(a, b), `evaluate(parse(print(ast))) differs for ${text} ctx=${JSON.stringify(ctx)}: ${JSON.stringify(a.ok ? [a.v, a.L, a.A] : a.code)} vs ${JSON.stringify(b.ok ? [b.v, b.L, b.A] : b.code)}`);
      total++;
      if (a.ok) {
        okCount++;
        // O19: the stored text is unit-complete: it gives the same answer under a different document unit
        const c = canonicalize(p.ast, lookup, ctx);
        assert(c.ok, 'canonicalize ok when evaluate ok');
        const back = evaluate(parseInput(c.text, { allowAssign: false }).ast, lookup, { target: ctx.target, unit: ctx.unit === 'in' ? 'mm' : 'in' });
        assert(same(a, back), `stored text ${c.text} of ${text} changes meaning with the document unit`);
        const c2 = canonicalize(parseInput(c.text, { allowAssign: false }).ast, lookup, { target: ctx.target });
        assert(c2.ok && c2.text === c.text, `canonical text is not a fixed point: ${c.text} -> ${c2.text}`);
      }
    }
  }
  assert(okCount > 2000, `the property test must exercise many valid expressions (${okCount} of ${total})`);
  rows += 4000;
}

// ── declared decisions are single constants with the recommended values ──
assert(CASE_SENSITIVE_NAMES === true && RESERVE_AUTO_DIM_NAMES === true && ALWAYS_STORE_UNITS === true && FRACTION_UNIT_IS_ONE_NUMBER === true, 'O6 O7 O19 O20');
assert(ACCEPTED_ARG_SEPARATORS.join('') === ';,' && STORED_ARG_SEPARATOR === ';' && MAX_NAME_LENGTH === 64, 'O8 and the name length');

// ── PURE: no DOM, no #ui import, no dynamic code, no second unit table; importable in plain node ──
{
  assert(typeof document === 'undefined' && typeof window === 'undefined', 'this test runs without a DOM');
  const src = readFileSync(new URL('../packages/core/expression.js', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/ .*$/gm, '');
  const imports = [...code.matchAll(/^\s*import\s[^;]*from\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert(imports.length === 1 && imports[0] === '#core/units.js', `expression.js imports only units.js, got ${JSON.stringify(imports)}`);
  assert(!/#ui|packages\/ui|apps\//.test(code), 'no #ui / app reference');
  assert(!/\beval\s*\(|new\s+Function|\bFunction\s*\(|\bdocument\b|\bwindow\b|\blocalStorage\b|\bsetTimeout\b/.test(code), 'no eval, Function, DOM or timers');
  assert(!/25\.4|TO_MM/.test(code), 'no conversion factor outside units.js');
  const out = execFileSync(process.execPath, ['--input-type=module', '-e',
    "const m = await import('#core/expression.js'); const r = m.evaluateText('1/2 in', () => null, {}); console.log(typeof document, typeof window, r.ok, r.v);"],
  { cwd: new URL('..', import.meta.url), encoding: 'utf8' }).trim();
  assert(out === 'undefined undefined true 12.7', `plain-node import: ${out}`);
  rows += 6;
}

assert(rows >= 150, `table has ${rows} rows`);
console.log(`expression tests passed ✅ (${rows} rows)`);
