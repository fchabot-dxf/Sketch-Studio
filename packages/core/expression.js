// packages/core/expression.js — TASK 535 slice 1a: the expression language of the parameter table.
// PURE: no DOM, no import from #ui, no dynamic code. A hand-written tokenizer + recursive-descent parser → AST, an evaluator over
// the AST with dimensional analysis, a printer for the stored (canonical) text, and dependency extraction.
// Design: docs/PARAMETERS-DESIGN.md section B. Errors are DATA: { ok:false, code, message, at:{start,end}, names? } — user input
// never makes any exported function throw.
//
// Grammar (section B):
//   input   = [NAME "="] expr                       ("=" ONLY here, once, at the top level)
//   expr    = term {("+"|"-") term}
//   term    = unary {("*"|"/") unary}
//   unary   = {"+"|"-"} power
//   power   = postfix ["^" unary]                    (right-associative; -2^2 = -4)
//   postfix = primary [UNIT]                         ("10 mm", "(1/2) in", "30 deg")
//   primary = NUMBER | FRACTION_UNIT | NAME | call | "(" expr ")"
//   call    = FUNC "(" expr {(";"|",") expr} ")"
//   FRACTION_UNIT = digits "/" digits UNIT           ("1/2 in" = 0.5 in, decision O20)
//
// AST nodes (all carry start/end, half-open character offsets, when they come from the parser):
//   { t:'num', value }  { t:'name', name }  { t:'unit', unit, arg }  { t:'neg', arg }
//   { t:'bin', op:'+'|'-'|'*'|'/'|'^', left, right }  { t:'call', fn, args }
//
// Values are quantities { v, L, A }: v in the BASE units (mm, degrees), L the length exponent, A the angle exponent.

import { unitInfo } from '#core/units.js';

// ── DECLARED DECISIONS (docs/PARAMETERS-DESIGN.md owner table). Each is ONE constant so the owner can flip it. ──
export const CASE_SENSITIVE_NAMES = true;            // O6  names are case-sensitive (Fusion). false: names are folded to lower case
export const RESERVE_AUTO_DIM_NAMES = true;          // O7  a USER PARAMETER cannot be called d<digits>
export const ACCEPTED_ARG_SEPARATORS = [';', ','];   // O8  both accepted in a call...
export const STORED_ARG_SEPARATOR = ';';             // O8  ...and ';' is what the printer writes
export const ALWAYS_STORE_UNITS = true;              // O19 canonicalize() writes the promoted units into the text ("width + 1 mm")
export const FRACTION_UNIT_IS_ONE_NUMBER = true;     // O20 "1/2 in" = 0.5 in (false: 1 / (2 in), a unit error)
// O18 (the units accepted: mm cm in " deg rad) is the UNIT_TABLE in units.js.
export const MAX_NAME_LENGTH = 64;
export const MAX_INPUT_LENGTH = 2000;                // keeps AST depth (and so recursion) bounded for any typed input
const MAX_NEST = 200;                                // nesting of "(" and prefix signs

// ── declared tables ──
const fold = (s) => (CASE_SENSITIVE_NAMES ? s : s.toLowerCase());
export { fold as foldName }; // TASK 535-1b: parameters.js keys its name tables the same way
const CONSTANTS = { PI: Math.PI };
const CONSTANT_NAMES = new Set(Object.keys(CONSTANTS).map(fold));
const foldedConstant = (name) => { for (const k of Object.keys(CONSTANTS)) if (fold(k) === name) return CONSTANTS[k]; return undefined; };
// arity [min, max]
const FUNCTIONS = {
  sqrt: [1, 1], abs: [1, 1], floor: [1, 1], ceil: [1, 1], round: [1, 1], min: [2, Infinity], max: [2, Infinity],
  sin: [1, 1], cos: [1, 1], tan: [1, 1], asin: [1, 1], acos: [1, 1], atan: [1, 1],
};
const FUNCTION_NAMES = new Set(Object.keys(FUNCTIONS).map(fold));
// functionTable() -> [{ name, min, max }] in declaration order: THE list of callable names (the autocomplete reads it, never a second list)
export const functionTable = () => Object.entries(FUNCTIONS).map(([name, [min, max]]) => ({ name, min, max }));
const funcKey = (name) => { for (const k of Object.keys(FUNCTIONS)) if (fold(k) === name) return k; return null; };

// ── result helpers ──
const span = (n) => ({ start: n && n.start != null ? n.start : 0, end: n && n.end != null ? n.end : (n && n.start != null ? n.start : 0) });
const fail = (code, message, at, extra) => ({ ok: false, code, message, at: { start: at.start, end: at.end }, ...(extra || {}) });
class Bail { constructor(err) { this.err = err; } } // internal control flow only; always caught inside this module

// ── characters ──
const isDigit = (c) => c >= '0' && c <= '9';
const isLetter = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
const isWs = (c) => c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === ' ';
const OPS = '+-*/^()=;,';

// ── names ──
export function isAutoDimName(name) { // d<digits>
  if (name.length < 2 || name[0] !== 'd') return false;
  for (let i = 1; i < name.length; i++) if (!isDigit(name[i])) return false;
  return true;
}
function isValidNameSyntax(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > MAX_NAME_LENGTH) return false;
  if (!isLetter(name[0])) return false;
  for (let i = 1; i < name.length; i++) if (!isLetter(name[i]) && !isDigit(name[i])) return false;
  return true;
}

// validateName(name, { kind:'parameter'|'dimension', isTaken(foldedName)→bool }) → { ok:true } | error
export function validateName(name, { kind = 'parameter', isTaken = null } = {}) {
  const at = { start: 0, end: typeof name === 'string' ? name.length : 0 };
  if (!isValidNameSyntax(name)) {
    const why = typeof name === 'string' && name.length > MAX_NAME_LENGTH ? `longer than ${MAX_NAME_LENGTH} characters` : 'not a valid name';
    return fail('BAD_NAME', `'${name}' is ${why}`, at);
  }
  const f = fold(name);
  if (unitInfo(name)) return fail('RESERVED_NAME', `'${name}' is a unit name`, at);
  if (FUNCTION_NAMES.has(f)) return fail('RESERVED_NAME', `'${name}' is a function name`, at);
  if (CONSTANT_NAMES.has(f)) return fail('RESERVED_NAME', `'${name}' is a constant`, at);
  if (RESERVE_AUTO_DIM_NAMES && kind === 'parameter' && isAutoDimName(f)) return fail('RESERVED_NAME', `'${name}' is reserved for automatic dimension names`, at);
  if (typeof isTaken === 'function' && isTaken(f)) return fail('NAME_TAKEN', `'${name}' is already used`, at);
  return { ok: true };
}

// ── tokenizer ──
function tokenize(text) {
  const toks = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const ch = text[i];
    if (isWs(ch)) { i++; continue; }
    if (isDigit(ch) || (ch === '.' && isDigit(text[i + 1] || ''))) {
      const start = i;
      let wholeOnly = true;
      while (i < n && isDigit(text[i])) i++;
      if (text[i] === '.') { wholeOnly = false; i++; while (i < n && isDigit(text[i])) i++; }
      if (text[i] === 'e' || text[i] === 'E') {
        let j = i + 1;
        if (text[j] === '+' || text[j] === '-') j++;
        if (isDigit(text[j] || '')) { wholeOnly = false; while (j < n && isDigit(text[j])) j++; i = j; }
      }
      const value = Number(text.slice(start, i));
      if (!Number.isFinite(value)) throw new Bail(fail('NOT_FINITE', 'the number is too large', { start, end: i }));
      toks.push({ type: 'num', value, whole: wholeOnly, start, end: i });
      continue;
    }
    if (isLetter(ch)) {
      const start = i;
      while (i < n && (isLetter(text[i]) || isDigit(text[i]))) i++;
      const word = text.slice(start, i);
      toks.push({ type: unitInfo(word) ? 'unit' : 'ident', text: word, start, end: i });
      continue;
    }
    if (ch === '"') { toks.push({ type: 'unit', text: '"', start: i, end: i + 1 }); i++; continue; }
    if (OPS.includes(ch)) { toks.push({ type: 'op', text: ch, start: i, end: i + 1 }); i++; continue; }
    throw new Bail(fail('SYNTAX', `unexpected '${ch}' at ${i}`, { start: i, end: i + 1 }));
  }
  toks.push({ type: 'eof', start: n, end: n });
  return toks;
}

// ── parser ──
function makeParser(toks, firstTok) {
  let p = firstTok;
  let depth = 0;
  const peek = (k = 0) => toks[Math.min(p + k, toks.length - 1)];
  const isOp = (t, c) => t.type === 'op' && t.text === c;
  const unexpected = (t) => {
    if (isOp(t, '=')) return new Bail(fail('ASSIGN_NOT_TOP', '"=" only as  name = value  at the start', t));
    const what = t.type === 'eof' ? 'the end of the input' : t.type === 'num' ? 'a number' : `'${t.text}'`;
    return new Bail(fail('SYNTAX', `unexpected ${what} at ${t.start}`, t));
  };
  const nest = () => { if (++depth > MAX_NEST) throw new Bail(fail('SYNTAX', 'too deeply nested', peek())); };
  const unnest = () => { depth--; };

  function parseExpr() {
    let left = parseTerm();
    for (;;) {
      const t = peek();
      if (isOp(t, '+') || isOp(t, '-')) {
        p++;
        const right = parseTerm();
        left = { t: 'bin', op: t.text, left, right, start: left.start, end: right.end };
      } else return left;
    }
  }
  function parseTerm() {
    let left = parseUnary();
    for (;;) {
      const t = peek();
      if (isOp(t, '*') || isOp(t, '/')) {
        p++;
        const right = parseUnary();
        left = { t: 'bin', op: t.text, left, right, start: left.start, end: right.end };
      } else return left;
    }
  }
  function parseUnary() {
    const t = peek();
    if (isOp(t, '+') || isOp(t, '-')) {
      nest(); p++;
      const arg = parseUnary();
      unnest();
      return t.text === '+' ? arg : { t: 'neg', arg, start: t.start, end: arg.end };
    }
    return parsePower();
  }
  function parsePower() {
    const base = parsePostfix();
    if (isOp(peek(), '^')) {
      p++;
      nest();
      const exp = parseUnary();
      unnest();
      return { t: 'bin', op: '^', left: base, right: exp, start: base.start, end: exp.end };
    }
    return base;
  }
  function parsePostfix() {
    const prim = parsePrimary();
    const t = peek();
    if (t.type === 'unit') {
      p++;
      return { t: 'unit', unit: unitInfo(t.text).name, arg: prim, start: prim.start, end: t.end };
    }
    return prim;
  }
  function parsePrimary() {
    const t = peek();
    if (t.type === 'num') {
      if (FRACTION_UNIT_IS_ONE_NUMBER && t.whole && isOp(peek(1), '/') && peek(2).type === 'num' && peek(2).whole && peek(3).type === 'unit') {
        const den = peek(2), u = peek(3);
        p += 4;
        const num = { t: 'num', value: t.value, start: t.start, end: t.end };
        const d = { t: 'num', value: den.value, start: den.start, end: den.end };
        if (den.value === 0) throw new Bail(fail('DIV_ZERO', 'division by zero', den));
        const frac = { t: 'bin', op: '/', left: num, right: d, start: t.start, end: den.end };
        return { t: 'unit', unit: unitInfo(u.text).name, arg: frac, start: t.start, end: u.end };
      }
      p++;
      return { t: 'num', value: t.value, start: t.start, end: t.end };
    }
    if (t.type === 'ident') {
      const f = fold(t.text);
      if (isOp(peek(1), '(')) {
        const key = funcKey(f);
        if (!key) throw new Bail(fail('UNKNOWN_NAME', `unknown function '${t.text}'`, t, { names: [t.text] }));
        return parseCall(t, key);
      }
      if (FUNCTION_NAMES.has(f)) throw new Bail(fail('SYNTAX', `function '${t.text}' needs ( ) after it`, t));
      p++;
      return { t: 'name', name: f, start: t.start, end: t.end };
    }
    if (isOp(t, '(')) {
      nest(); p++;
      const e = parseExpr();
      const close = peek();
      if (!isOp(close, ')')) throw unexpected(close);
      p++; unnest();
      return e;
    }
    throw unexpected(t);
  }
  function parseCall(nameTok, key) {
    p += 2; // name, "("
    nest();
    const args = [parseExpr()];
    for (;;) {
      const t = peek();
      if (t.type === 'op' && ACCEPTED_ARG_SEPARATORS.includes(t.text)) { p++; args.push(parseExpr()); continue; }
      if (isOp(t, ')')) { p++; break; }
      throw unexpected(t);
    }
    unnest();
    const end = toks[p - 1].end;
    const [lo, hi] = FUNCTIONS[key];
    if (args.length < lo || args.length > hi) {
      const need = lo === hi ? `${lo}` : hi === Infinity ? `at least ${lo}` : `${lo} to ${hi}`;
      throw new Bail(fail('SYNTAX', `${key} takes ${need} argument${hi === 1 ? '' : 's'}, not ${args.length}`, { start: nameTok.start, end }));
    }
    return { t: 'call', fn: key, args, start: nameTok.start, end };
  }
  return {
    parseAll() {
      const e = parseExpr();
      const t = peek();
      if (t.type !== 'eof') throw unexpected(t);
      return e;
    },
  };
}

// parseInput(text, { allowAssign = true }) → { ok:true, assign: null | { name, at:{start,end} }, ast } | error
// `name = expr` is recognised ONLY as the whole input's first two tokens; "=" anywhere else is ASSIGN_NOT_TOP.
export function parseInput(text, { allowAssign = true } = {}) {
  try {
    if (typeof text !== 'string') return fail('SYNTAX', 'the input is not text', { start: 0, end: 0 });
    if (text.length > MAX_INPUT_LENGTH) return fail('SYNTAX', `the input is longer than ${MAX_INPUT_LENGTH} characters`, { start: MAX_INPUT_LENGTH, end: text.length });
    let firstTok = 0;
    let assign = null;
    if (allowAssign) {
      const eq = text.indexOf('=');
      if (eq >= 0) {
        const lhs = text.slice(0, eq);
        let simple = true;
        for (const c of lhs) if (!(isLetter(c) || isDigit(c) || c === ' ' || c === '\t' || c === '.' || c === ' ')) { simple = false; break; }
        const name = lhs.trim();
        if (simple && name !== '') {
          const start = lhs.indexOf(name);
          const at = { start, end: start + name.length };
          const v = validateName(name, { kind: 'parameter' });
          if (!v.ok) return { ...v, at };
          assign = { name: fold(name), at };
          firstTok = 2; // the name token and the "="
        }
      }
    }
    const toks = tokenize(text);
    if (toks.length === 1) return fail('SYNTAX', 'nothing to evaluate', toks[0]);
    const ast = makeParser(toks, firstTok).parseAll();
    return { ok: true, assign, ast };
  } catch (e) {
    if (e instanceof Bail) return e.err;
    throw e;
  }
}

// ── dependencies: the names an expression reads, distinct, in order of first appearance (constants like PI excluded) ──
export function dependencies(astOrParsed) {
  const root = astOrParsed && astOrParsed.ast ? astOrParsed.ast : astOrParsed;
  const seen = new Set();
  const out = [];
  (function visit(n) {
    if (!n) return;
    switch (n.t) {
      case 'name': if (!CONSTANT_NAMES.has(n.name) && !seen.has(n.name)) { seen.add(n.name); out.push(n.name); } break;
      case 'unit': case 'neg': visit(n.arg); break;
      case 'bin': visit(n.left); visit(n.right); break;
      case 'call': n.args.forEach(visit); break;
      default: break;
    }
  })(root);
  return out;
}

// ── printer (the canonical stored text of an AST, exactly as given: promotion is canonicalize's job) ──
const LV = { add: 1, mul: 2, neg: 3, pow: 4, unit: 5, atom: 6 };
function levelOf(n) {
  switch (n.t) {
    case 'num': return n.value < 0 ? LV.neg : LV.atom;
    case 'name': case 'call': return LV.atom;
    case 'unit': return LV.unit;
    case 'neg': return LV.neg;
    case 'bin': return n.op === '+' || n.op === '-' ? LV.add : n.op === '*' || n.op === '/' ? LV.mul : LV.pow;
    default: return LV.atom;
  }
}
// does the printed text of n BEGIN with "digits unit" (e.g. "2 in", "2 in ^ 2")? After a "/" that would be read as a FRACTION_UNIT.
function startsWithUnitOnWholeNumber(n) {
  if (n.t === 'bin') return startsWithUnitOnWholeNumber(n.left);
  return n.t === 'unit' && n.arg.t === 'num' && /^[0-9]+$/.test(String(n.arg.value));
}
function pr(n, min) { const s = raw(n); return levelOf(n) < min ? `(${s})` : s; }
function raw(n) {
  switch (n.t) {
    case 'num': return String(n.value);
    case 'name': return n.name;
    case 'unit': return `${pr(n.arg, LV.atom)} ${n.unit}`;
    case 'neg': return `-${pr(n.arg, LV.neg)}`;
    case 'call': return `${n.fn}(${n.args.map((a) => pr(a, LV.add)).join(`${STORED_ARG_SEPARATOR} `)})`;
    case 'bin': {
      if (n.op === '+' || n.op === '-') return `${pr(n.left, LV.add)} ${n.op} ${pr(n.right, LV.mul)}`;
      if (n.op === '*') return `${pr(n.left, LV.mul)} * ${pr(n.right, LV.neg)}`;
      if (n.op === '/') {
        // "digits / digits unit" would be read back as the O20 fraction: keep a unit on a whole number apart from the slash
        const r = FRACTION_UNIT_IS_ONE_NUMBER && startsWithUnitOnWholeNumber(n.right) ? `(${raw(n.right)})` : pr(n.right, LV.neg);
        return `${pr(n.left, LV.mul)} / ${r}`;
      }
      return `${pr(n.left, LV.unit)} ^ ${pr(n.right, LV.neg)}`;
    }
    default: return '';
  }
}
export function print(ast) { return raw(ast); }

// ── evaluator ──
// lookup(name) → undefined/null (unknown name) | number (a unitless value) | { v, L, A } (base units) | { ok:false, code, message } (a refusal, e.g. REFERENCE_DIM)
// ctx: { target?: 'length'|'angle'|'none', unit?: 'mm'|'cm'|'in' (the document unit, default mm), angleUnit?: 'deg'|'rad' (default deg) }
const dimsEqual = (a, b) => a.L === b.L && a.A === b.A;
const unitless = (q) => q.L === 0 && q.A === 0;
const isLength = (q) => q.L === 1 && q.A === 0;
const isAngle = (q) => q.L === 0 && q.A === 1;
const kindName = (q) => (unitless(q) ? 'a plain number' : isLength(q) ? 'a length' : isAngle(q) ? 'an angle' : `a quantity (length^${q.L}, angle^${q.A})`);

function makeEnv(lookup, ctx) {
  const lenUnit = (ctx && unitInfo(ctx.unit) && unitInfo(ctx.unit).kind === 'length' ? unitInfo(ctx.unit) : unitInfo('mm'));
  const angUnit = (ctx && unitInfo(ctx.angleUnit) && unitInfo(ctx.angleUnit).kind === 'angle' ? unitInfo(ctx.angleUnit) : unitInfo('deg'));
  return { lookup, lenUnit, angUnit };
}
const unitNode = (unit, arg) => ({ t: 'unit', unit, arg, start: arg.start, end: arg.end });
// promote a unitless quantity to a length / angle in the context unit; a negative sign stays outside the unit ("-5 mm")
function wrapUnit(node, unit) {
  if (node.t === 'neg') return { ...node, arg: wrapUnit(node.arg, unit) };
  return unitNode(unit, node);
}
function promote(q, kind, env) {
  const u = kind === 'length' ? env.lenUnit : env.angUnit;
  return { v: q.v * u.f, L: kind === 'length' ? 1 : 0, A: kind === 'angle' ? 1 : 0, bare: false, node: wrapUnit(q.node, u.name) };
}
// make two operands the same kind: a bare number next to a length / angle takes the context unit
function unify(a, b, env, at, what) {
  if (dimsEqual(a, b)) return [a, b];
  if (a.bare && (isLength(b) || isAngle(b))) return [promote(a, isLength(b) ? 'length' : 'angle', env), b];
  if (b.bare && (isLength(a) || isAngle(a))) return [a, promote(b, isLength(a) ? 'length' : 'angle', env)];
  throw new Bail(fail('UNIT_MISMATCH', `${what}: ${kindName(a)} and ${kindName(b)} do not match`, at));
}
function finite(q, at) {
  if (!Number.isFinite(q.v)) throw new Bail(fail('NOT_FINITE', 'the result is not a number', at));
  return q;
}
// floor / ceil / round (Fusion, measured): they round in the unit the ARGUMENT IS WRITTEN IN, never the document's or the parameter's.
// Returns { n (the written number, sign applied), f (the written unit's factor) } for a single literal with a unit
// (optionally signed, optionally the O20 fraction form), else null.
function writtenUnitLiteral(node) {
  let sign = 1;
  let x = node;
  while (x.t === 'neg') { sign = -sign; x = x.arg; }
  if (x.t !== 'unit') return null;
  const u = unitInfo(x.unit);
  if (x.arg.t === 'num') return { n: sign * x.arg.value, f: u.f };
  if (x.arg.t === 'bin' && x.arg.op === '/' && x.arg.left.t === 'num' && x.arg.right.t === 'num') return { n: (sign * x.arg.left.value) / x.arg.right.value, f: u.f };
  return null;
}

function walk(n, env) {
  const at = span(n);
  switch (n.t) {
    case 'num': return finite({ v: n.value, L: 0, A: 0, bare: true, node: n }, at);
    case 'name': {
      const k = foldedConstant(n.name);
      if (k !== undefined) return { v: k, L: 0, A: 0, bare: true, node: n };
      const r = env.lookup ? env.lookup(n.name) : undefined;
      if (r == null) throw new Bail(fail('UNKNOWN_NAME', `unknown parameter '${n.name}' (type ${n.name} = 30 to create it)`, at, { names: [n.name] }));
      if (typeof r === 'number') return finite({ v: r, L: 0, A: 0, bare: false, node: n }, at);
      if (r.ok === false) throw new Bail(fail(r.code || 'UNKNOWN_NAME', r.message || `'${n.name}' cannot be used here`, at, { names: [n.name] }));
      return finite({ v: r.v, L: r.L || 0, A: r.A || 0, bare: false, node: n }, at);
    }
    case 'unit': {
      const a = walk(n.arg, env);
      if (!unitless(a)) throw new Bail(fail('UNIT_MISMATCH', `a unit cannot follow ${kindName(a)}`, at));
      const u = unitInfo(n.unit);
      return finite({ v: a.v * u.f, L: u.kind === 'length' ? 1 : 0, A: u.kind === 'angle' ? 1 : 0, bare: false, node: { ...n, arg: a.node } }, at);
    }
    case 'neg': {
      const a = walk(n.arg, env);
      return { ...a, v: 0 - a.v, node: { ...n, arg: a.node } };
    }
    case 'bin': return walkBin(n, env, at);
    case 'call': return walkCall(n, env, at);
    default: throw new Bail(fail('SYNTAX', 'unknown node', at));
  }
}

function walkBin(n, env, at) {
  let a = walk(n.left, env);
  let b = walk(n.right, env);
  const mk = (q) => finite({ ...q, node: { ...n, left: a.node, right: b.node } }, at);
  switch (n.op) {
    case '+': case '-': {
      [a, b] = unify(a, b, env, at, n.op === '+' ? 'cannot add' : 'cannot subtract');
      return mk({ v: n.op === '+' ? a.v + b.v : a.v - b.v, L: a.L, A: a.A, bare: a.bare && b.bare });
    }
    case '*': return mk({ v: a.v * b.v, L: a.L + b.L, A: a.A + b.A, bare: a.bare && b.bare });
    case '/': {
      if (b.v === 0) throw new Bail(fail('DIV_ZERO', 'division by zero', span(n.right)));
      return mk({ v: a.v / b.v, L: a.L - b.L, A: a.A - b.A, bare: a.bare && b.bare });
    }
    case '^': {
      if (!unitless(b)) throw new Bail(fail('UNIT_MISMATCH', `an exponent must be a plain number, not ${kindName(b)}`, span(n.right)));
      const e = b.v;
      if (!unitless(a) && !Number.isInteger(e)) throw new Bail(fail('UNIT_MISMATCH', `${kindName(a)} needs a whole-number exponent`, span(n.right)));
      if (a.v === 0 && e < 0) throw new Bail(fail('DIV_ZERO', 'division by zero', at));
      return mk({ v: Math.pow(a.v, e), L: a.L * e, A: a.A * e, bare: a.bare && b.bare });
    }
    default: throw new Bail(fail('SYNTAX', `unknown operator ${n.op}`, at));
  }
}

function walkCall(n, env, at) {
  const args = n.args.map((x) => walk(x, env));
  const done = (q, as) => finite({ ...q, node: { ...n, args: (as || args).map((x) => x.node) } }, at);
  const a = args[0];
  switch (n.fn) {
    case 'abs': return done({ v: Math.abs(a.v), L: a.L, A: a.A, bare: a.bare });
    case 'floor': case 'ceil': case 'round': {
      if (unitless(a)) return done({ v: Math[n.fn](a.v), L: 0, A: 0, bare: a.bare }); // plain rounding
      const lit = writtenUnitLiteral(a.node);
      if (!lit || !(isLength(a) || isAngle(a))) {
        throw new Bail(fail('UNIT_MISMATCH', `${n.fn} of ${kindName(a)} needs a number written with its unit, e.g. ${n.fn}(2.7 mm); to round a name or a sum write ${n.fn}(gap / 1 mm) * 1 mm`, at));
      }
      return done({ v: Math[n.fn](lit.n) * lit.f, L: a.L, A: a.A, bare: false });
    }
    case 'sqrt': {
      if (a.L % 2 !== 0 || a.A % 2 !== 0) throw new Bail(fail('UNIT_MISMATCH', `sqrt of ${kindName(a)} has no whole-number unit`, at));
      if (a.v < 0) throw new Bail(fail('NOT_FINITE', 'the result is not a number', at));
      return done({ v: Math.sqrt(a.v), L: a.L / 2, A: a.A / 2, bare: a.bare });
    }
    case 'min': case 'max': {
      // the first argument that is not a bare number sets the kind; a bare number next to a length / angle takes the context unit
      const ref = args.find((x) => !x.bare) || args[0];
      const out = args.map((x) => {
        if (dimsEqual(x, ref)) return x;
        if (x.bare && (isLength(ref) || isAngle(ref))) return promote(x, isLength(ref) ? 'length' : 'angle', env);
        throw new Bail(fail('UNIT_MISMATCH', `${n.fn} needs matching arguments: ${kindName(x)} and ${kindName(ref)} do not match`, at));
      });
      const vs = out.map((x) => x.v);
      return done({ v: n.fn === 'min' ? Math.min(...vs) : Math.max(...vs), L: ref.L, A: ref.A, bare: out.every((x) => x.bare) }, out);
    }
    case 'sin': case 'cos': case 'tan': {
      let arg = a;
      if (!isAngle(a)) {
        if (!unitless(a)) throw new Bail(fail('UNIT_MISMATCH', `${n.fn} needs an angle, not ${kindName(a)}`, at));
        arg = { v: a.v, L: 0, A: 1, bare: false, node: wrapUnit(a.node, 'deg') }; // a unitless argument is degrees
      }
      return done({ v: Math[n.fn]((arg.v * Math.PI) / 180), L: 0, A: 0, bare: a.bare }, [arg]);
    }
    case 'asin': case 'acos': case 'atan': {
      if (!unitless(a)) throw new Bail(fail('UNIT_MISMATCH', `${n.fn} needs a plain number, not ${kindName(a)}`, at));
      return done({ v: (Math[n.fn](a.v) * 180) / Math.PI, L: 0, A: 1, bare: false });
    }
    default: throw new Bail(fail('UNKNOWN_NAME', `unknown function '${n.fn}'`, at, { names: [n.fn] }));
  }
}

// evaluate(ast, lookup, ctx) → { ok:true, v, L, A, ast (the AST with the promoted units written in) } | error
// With ctx.target the result must be that kind: a unitless result is taken in the context unit (7 in a length box = 7 mm / 7 in).
export function evaluate(ast, lookup, ctx = {}) {
  try {
    const env = makeEnv(lookup, ctx);
    let q = walk(ast, env);
    const at = span(ast);
    const target = ctx && ctx.target;
    if (target === 'length' || target === 'angle') {
      if (unitless(q)) q = promote(q, target, env);
      if (!(target === 'length' ? isLength(q) : isAngle(q))) throw new Bail(fail('UNIT_MISMATCH', `${target === 'length' ? 'a length' : 'an angle'} cannot be ${kindName(q)}`, at));
    } else if (target === 'none') {
      if (!unitless(q)) throw new Bail(fail('UNIT_MISMATCH', `a plain number cannot be ${kindName(q)}`, at));
    }
    return { ok: true, v: q.v, L: q.L, A: q.A, ast: q.node };
  } catch (e) {
    if (e instanceof Bail) return e.err;
    throw e;
  }
}

// evaluateText(text, lookup, ctx) — parse (no assignment) then evaluate
export function evaluateText(text, lookup, ctx) {
  const p = parseInput(text, { allowAssign: false });
  return p.ok ? evaluate(p.ast, lookup, ctx) : p;
}

// canonicalize(ast, lookup, ctx) → { ok:true, text, v, L, A, ast } | error. `text` is the STORED form: units written in
// (decision O19), so it means the same thing under any document unit. With ALWAYS_STORE_UNITS false it is just print(ast).
export function canonicalize(ast, lookup, ctx = {}) {
  const r = evaluate(ast, lookup, ctx);
  if (!r.ok) return r;
  return { ...r, text: print(ALWAYS_STORE_UNITS ? r.ast : ast) };
}
