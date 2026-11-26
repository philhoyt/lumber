/**
 * The saved file format: what a project, a share link or an exported file holds, and
 * the check that turns parsed JSON back into one, migrating older versions and
 * dropping anything malformed part by part rather than refusing the file.
 */
import { normalizeStep } from './assembly';
import { isFace, isFastenerKind, type Fastener } from './fastener';
import {
  CUT_KINDS,
  GRAINS,
  MAX_MITER,
  migrateFromYUp,
  type Cut,
  type Group,
  type Part,
} from './model';
import { sanitizeStock, type Stock } from './stock';

/** The saved file format. Version 1 was Y-up; version 2 is Z-up and may carry groups. */
export interface Document {
  version: 2;
  parts: Part[];
  groups?: Group[];
  /** The stock library as edited for this model; absent means the defaults. */
  stock?: Stock[];
  stockLen?: Record<string, number>;
  /** Price overrides from older files; folded into `stock` on load. */
  prices?: Record<string, number>;
}

/** Check a parsed JSON value is a saved model, migrating older versions. */
export function parseDocument(o: unknown): Document | null {
  if (!o || typeof o !== 'object') return null;
  const d = o as {
    version?: unknown;
    parts?: unknown;
    groups?: unknown;
    stock?: unknown;
    stockLen?: unknown;
    prices?: unknown;
  };
  if (!Array.isArray(d.parts)) return null;
  for (const p of d.parts as unknown[]) {
    if (!p || typeof p !== 'object') return null;
    const x = p as Partial<Part>;
    if (
      typeof x.id !== 'number' ||
      typeof x.stock !== 'string' ||
      typeof x.len !== 'number' ||
      !Array.isArray(x.pos) ||
      x.pos.length !== 3 ||
      !Array.isArray(x.q) ||
      x.q.length !== 4
    )
      return null;
    if (x.cuts !== undefined) {
      const ok = Array.isArray(x.cuts)
        ? (x.cuts as unknown[]).filter((c): c is Cut => {
            if (!c || typeof c !== 'object') return false;
            const k = (c as Cut).kind;
            if (!CUT_KINDS.includes(k)) return false;
            const o = c as Record<string, unknown>;
            const onEdge = k === 'rabbet' || k === 'chamfer';
            const nums = onEdge ? ['width', 'depth'] : ['at', 'width', 'depth'];
            if (!nums.every((f) => typeof o[f] === 'number' && o[f] >= 0)) return false;
            if (k === 'notch') return o.edge === 'front' || o.edge === 'back';
            if (o.face !== 'top' && o.face !== 'bottom') return false;
            if (onEdge) return ['endA', 'endB', 'front', 'back'].includes(o.edge as string);
            return true;
          })
        : [];
      if (ok.length) x.cuts = ok;
      else delete x.cuts;
    }
    if (x.t !== undefined && !(typeof x.t === 'number' && x.t > 0)) delete x.t;
    if (x.step !== undefined) {
      const s = normalizeStep(typeof x.step === 'number' ? x.step : null);
      if (s === undefined) delete x.step;
      else x.step = s;
    }
    if (x.fasteners !== undefined) {
      const ok = Array.isArray(x.fasteners)
        ? (x.fasteners as unknown[]).flatMap((f): Fastener[] => {
            if (!f || typeof f !== 'object') return [];
            const o = f as Record<string, unknown>;
            if (!isFastenerKind(o.kind) || !isFace(o.face)) return [];
            const at = o.at;
            if (!Array.isArray(at) || at.length !== 2 || !at.every((n) => typeof n === 'number'))
              return [];
            const out: Fastener = {
              kind: o.kind,
              face: o.face,
              at: [at[0]!, at[1]!],
            };
            if (typeof o.size === 'string' && o.size.trim()) out.size = o.size.trim();
            return [out];
          })
        : [];
      if (ok.length) x.fasteners = ok;
      else delete x.fasteners;
    }
    if (x.grain !== undefined && !GRAINS.includes(x.grain)) delete x.grain;
    if (x.grain === 'any') delete x.grain;
    const clear = (part: Partial<Part>, key: 'miter' | 'bevel' | 'edgeBevel') => {
      if (key === 'miter') delete part.miter;
      else if (key === 'bevel') delete part.bevel;
      else delete part.edgeBevel;
    };
    // Miters and bevels must be a pair of angles within range; anything else reads as square.
    for (const key of ['miter', 'bevel', 'edgeBevel'] as const) {
      if (x[key] === undefined) continue;
      const m = x[key] as unknown;
      if (
        Array.isArray(m) &&
        m.length === 2 &&
        m.every((n) => typeof n === 'number' && Math.abs(n) <= MAX_MITER)
      ) {
        if (m[0] === 0 && m[1] === 0) clear(x, key);
      } else clear(x, key);
    }
  }
  let parts = d.parts as Part[];
  if (d.version !== 2) parts = migrateFromYUp(parts);
  const groups = Array.isArray(d.groups)
    ? (d.groups as unknown[]).filter(
        (g): g is Group =>
          !!g &&
          typeof g === 'object' &&
          typeof (g as Group).id === 'number' &&
          typeof (g as Group).name === 'string',
      )
    : [];
  const stock = sanitizeStock(d.stock) ?? undefined;
  return {
    version: 2,
    parts,
    groups,
    stock: stock?.length ? stock : undefined,
    stockLen: d.stockLen as Record<string, number> | undefined,
    prices: d.prices as Record<string, number> | undefined,
  };
}
