/**
 * Lengths are stored in inches everywhere. These helpers convert between inches and
 * the ways a woodworker types and reads them: fractions, feet and inches, millimetres.
 */

/**
 * Parse a typed length into inches: a number, a fraction or mixed number ("1 1/2",
 * "1-1/2"), feet and inches ("2'6", "8 ft 3"), millimetres or centimetres, and arithmetic
 * over any of those with + - * / and parentheses, so "48 - 3/4", "(96 - 2 * 1.5) / 3"
 * and "2 ft + 3 1/2" all work. A slash with no spaces between whole numbers is a fraction;
 * with spaces around it, it divides. Returns null when the text is not a length.
 */
export function parseLen(str: string | null | undefined): number | null {
  if (str == null) return null;
  const s = str
    .toLowerCase()
    .replace(/[”″]/g, '"')
    .replace(/[’′]/g, "'")
    .replace(/[×·]/g, '*')
    .replace(/÷/g, ' / ');
  if (!s.trim()) return null;
  const p = new LenParser(s);
  try {
    const v = p.expr();
    p.skipSpace();
    if (!p.done() || !Number.isFinite(v)) return null;
    return v;
  } catch {
    return null;
  }
}

/** What typing into a length field means: a new value, or a change to what is there. */
export type LenEdit =
  | { relative: false; value: number }
  | { relative: true; apply: (current: number) => number | null };

/**
 * Read a field's text the way Figma does: a leading `+`, `*` or `/` changes what the
 * field holds (`+1/2`, `*2`, `/3`), and so does a leading `-` when the field cannot be
 * negative (a length, not a position). A leading "Mixed" is skipped, so a field showing
 * several parts' values can be edited in place. Anything else is a plain length.
 */
export function parseLenEdit(
  str: string | null | undefined,
  minusIsRelative: boolean,
): LenEdit | null {
  if (str == null) return null;
  const s = str.trim().replace(/^mixed\s*/i, '');
  const op = s[0];
  const relative = op === '+' || op === '*' || op === '/' || (op === '-' && minusIsRelative);
  if (!relative) {
    const value = parseLen(s);
    return value === null ? null : { relative: false, value };
  }
  const rest = s.slice(1);
  if (parseLen(rest) === null) return null;
  return { relative: true, apply: (current) => parseLen(`(${current}) ${op} (${rest})`) };
}

/** Sticky patterns for the pieces of a length, matched at the parser's position. */
const FEET = /(\d+(?:\.\d+)?|\.\d+)\s*(?:'|ft\b)/y;
const MIXED = /(\d+)(?:-|\s+)(\d+)\/(\d+)/y;
const FRACTION = /(\d+)\/(\d+)/y;
const NUMBER = /(\d+(?:\.\d+)?|\.\d+)/y;
const UNIT = /\s*(mm|cm|in(?:ch(?:es)?)?|")(?![a-z])/y;

/** Recursive descent over `expr := term (('+'|'-') term)*`, `term := factor (('*'|'x'|'/') factor)*`. */
class LenParser {
  private i = 0;
  constructor(private readonly s: string) {}

  done(): boolean {
    return this.i >= this.s.length;
  }
  skipSpace(): void {
    while (/\s/.test(this.s[this.i] ?? '')) this.i++;
  }
  private peek(): string {
    this.skipSpace();
    return this.s[this.i] ?? '';
  }
  private match(re: RegExp): RegExpExecArray | null {
    re.lastIndex = this.i;
    const m = re.exec(this.s);
    if (m) this.i = re.lastIndex;
    return m;
  }

  expr(): number {
    let v = this.term();
    for (;;) {
      const c = this.peek();
      if (c !== '+' && c !== '-') return v;
      this.i++;
      const r = this.term();
      v = c === '+' ? v + r : v - r;
    }
  }
  private term(): number {
    let v = this.factor();
    for (;;) {
      const c = this.peek();
      if (c !== '*' && c !== 'x' && c !== '/') return v;
      this.i++;
      const r = this.factor();
      v = c === '/' ? v / r : v * r;
    }
  }
  private factor(): number {
    const c = this.peek();
    if (c === '-' || c === '+') {
      this.i++;
      const v = this.factor();
      return c === '-' ? -v : v;
    }
    if (c === '(') {
      this.i++;
      const v = this.expr();
      if (this.peek() !== ')') throw new Error('expected )');
      this.i++;
      return v;
    }
    return this.atom();
  }
  /** Feet with inches that follow directly ("2'6 1/2", "8 ft 3"), or inches alone. */
  private atom(): number {
    this.skipSpace();
    const ft = this.match(FEET);
    if (!ft) return this.inches();
    let v = +ft[1]! * 12;
    this.skipSpace();
    if (/\d/.test(this.s[this.i] ?? '')) v += this.inches();
    return v;
  }
  /** A mixed number, fraction or decimal, with an optional unit. */
  private inches(): number {
    this.skipSpace();
    let m: RegExpExecArray | null;
    let v: number;
    if ((m = this.match(MIXED))) v = +m[1]! + +m[2]! / +m[3]!;
    else if ((m = this.match(FRACTION))) v = +m[1]! / +m[2]!;
    else if ((m = this.match(NUMBER))) v = +m[1]!;
    else throw new Error('expected a length');
    const u = this.match(UNIT);
    if (u?.[1] === 'mm') v /= 25.4;
    else if (u?.[1] === 'cm') v /= 2.54;
    return v;
  }
}

/** Format inches as a fraction to the nearest sixteenth, e.g. 33.25 -> 33 1/4". */
export function fmt(x: number): string {
  const neg = x < 0;
  x = Math.abs(x);
  let whole = Math.floor(x + 1e-9);
  let n = Math.round((x - whole) * 16);
  let d = 16;
  if (n === 16) {
    whole++;
    n = 0;
  }
  while (n && n % 2 === 0) {
    n /= 2;
    d /= 2;
  }
  const s = n ? (whole ? `${whole} ${n}/${d}` : `${n}/${d}`) : `${whole}`;
  return (neg ? '-' : '') + s + '"';
}

/** Whole feet read as feet ("8 ft"); anything else falls back to inches. */
export const fmtFt = (x: number): string => (x % 12 === 0 ? `${x / 12} ft` : fmt(x));

/** Round to the nearest 1/32" so cuts that differ by float noise group together. */
export const r32 = (x: number): number => Math.round(x * 32) / 32;

/** A sheet size: "4×8 ft" when both sides are whole feet, otherwise in inches. */
export function fmtSheet(w: number, l: number): string {
  if (w % 12 === 0 && l % 12 === 0) return `${w / 12}×${l / 12} ft`;
  return `${fmt(w)} × ${fmt(l)}`;
}

export const money = (x: number): string => '$' + x.toFixed(2);
