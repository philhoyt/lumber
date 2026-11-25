/**
 * Named projects kept in the browser. Each project is one saved document under a
 * generated id, plus an index of names and dates. Storage is injectable so tests can
 * use a fake; the app passes localStorage.
 */
import { sampleWorkbench } from './sample';
import { parseDocument, type Document } from './store';

export interface ProjectMeta {
  id: string;
  name: string;
  /** Last saved, ms since the epoch. */
  updated: number;
  parts: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const INDEX_KEY = 'lumber.projects';
const CURRENT_KEY = 'lumber.currentProject';
const LEGACY_AUTOSAVE = 'lumber.autosave.v2';
const docKey = (id: string) => `lumber.project.${id}`;

export class ProjectStore {
  constructor(
    private storage: StorageLike,
    private now: () => number = () => Date.now(),
  ) {}

  /** Every project, most recently saved first. */
  list(): ProjectMeta[] {
    try {
      const raw = this.storage.getItem(INDEX_KEY);
      const list = raw ? (JSON.parse(raw) as ProjectMeta[]) : [];
      return list.sort((a, b) => b.updated - a.updated);
    } catch {
      return [];
    }
  }
  get(id: string): ProjectMeta | undefined {
    return this.list().find((p) => p.id === id);
  }
  private writeIndex(list: ProjectMeta[]): void {
    this.storage.setItem(INDEX_KEY, JSON.stringify(list));
  }

  load(id: string): Document | null {
    const raw = this.storage.getItem(docKey(id));
    if (!raw) return null;
    try {
      return parseDocument(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  /** Write a project's document and refresh its index entry. Throws if storage is full. */
  save(id: string, doc: Document): ProjectMeta {
    const list = this.list();
    const meta = list.find((p) => p.id === id);
    if (!meta) throw new Error(`No project ${id}`);
    this.storage.setItem(docKey(id), JSON.stringify(doc));
    meta.updated = this.now();
    meta.parts = doc.parts.length;
    this.writeIndex(list);
    return meta;
  }

  create(name: string, doc: Document): ProjectMeta {
    const id = `${this.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const meta: ProjectMeta = {
      id,
      name: uniqueName(name, this.list()),
      updated: this.now(),
      parts: doc.parts.length,
    };
    this.writeIndex([...this.list(), meta]);
    this.storage.setItem(docKey(id), JSON.stringify(doc));
    return meta;
  }

  rename(id: string, name: string): void {
    const list = this.list();
    const meta = list.find((p) => p.id === id);
    const next = name.trim();
    if (!meta || !next) return;
    meta.name = uniqueName(
      next,
      list.filter((p) => p.id !== id),
    );
    this.writeIndex(list);
  }

  duplicate(id: string): ProjectMeta | null {
    const meta = this.get(id);
    const doc = this.load(id);
    if (!meta || !doc) return null;
    return this.create(`${meta.name} copy`, doc);
  }

  remove(id: string): void {
    this.writeIndex(this.list().filter((p) => p.id !== id));
    this.storage.removeItem(docKey(id));
    if (this.current() === id) this.storage.removeItem(CURRENT_KEY);
  }

  current(): string | null {
    return this.storage.getItem(CURRENT_KEY);
  }
  setCurrent(id: string): void {
    this.storage.setItem(CURRENT_KEY, id);
  }

  /**
   * Make sure there is something to open: adopt the old single autosave as a project,
   * or start with the sample workbench. Returns the project to open.
   */
  ensureFirst(): ProjectMeta {
    const current = this.current();
    const existing = (current && this.get(current)) || this.list()[0];
    if (existing) return existing;
    const legacy = this.storage.getItem(LEGACY_AUTOSAVE);
    if (legacy) {
      try {
        const snap = JSON.parse(legacy) as Partial<Document>;
        const doc = parseDocument({ version: 2, ...snap });
        if (doc) {
          this.storage.removeItem(LEGACY_AUTOSAVE);
          return this.create('My project', doc);
        }
      } catch {
        /* unreadable: fall through to the sample */
      }
    }
    return this.create('Workbench (sample)', { version: 2, parts: sampleWorkbench() });
  }
}

/** "Name", then "Name 2", "Name 3"... so two projects never share a name. */
export function uniqueName(name: string, others: readonly ProjectMeta[]): string {
  const taken = new Set(others.map((p) => p.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** "just now", "5 min ago", "yesterday", or a date. */
export function timeAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 14) return `${d} days ago`;
  return new Date(ms).toLocaleDateString();
}
