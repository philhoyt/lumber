/**
 * Lengths are stored in inches everywhere. These helpers convert between inches and
 * the ways a woodworker types and reads them: fractions, feet and inches, millimetres.
 */

/** Parse a typed length into inches. Returns null when the text is not a length. */
export function parseLen(str: string | null | undefined): number | null {
  if (str == null) return null;
  let s = String(str)
    .trim()
    .toLowerCase()
    .replace(/[”"]/g, '')
    .replace(/\s*in(ch(es)?)?$/, '')
    .trim();
  if (!s) return null;
  let total = 0;
  const ft = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|’|ft)\s*(.*)$/);
  if (ft) {
    total = parseFloat(ft[1]!) * 12;
    s = ft[2]!.trim();
    if (!s) return total;
  }
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*mm$/))) return total + parseFloat(m[1]!) / 25.4;
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*cm$/))) return total + parseFloat(m[1]!) / 2.54;
  if ((m = s.match(/^(\d+)[\s-]+(\d+)\s*\/\s*(\d+)$/))) return total + +m[1]! + +m[2]! / +m[3]!;
  if ((m = s.match(/^(\d+)\s*\/\s*(\d+)$/))) return total + +m[1]! / +m[2]!;
  const d = Number(s);
  return isNaN(d) ? null : total + d;
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

export const money = (x: number): string => '$' + x.toFixed(2);
