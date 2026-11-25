/**
 * Ties the store to the project list: the current project autosaves a moment after
 * every change, switching projects saves first and resets undo, and the window title
 * and status follow along.
 */
import { ProjectStore, type ProjectMeta } from './projects';
import { sampleWorkbench } from './sample';
import { parseDocument, type Document, type Store } from './store';

export type SaveStatus = 'saved' | 'saving' | 'error';

const EMPTY: Document = { version: 2, parts: [] };

export class ProjectManager {
  current: ProjectMeta;
  onStatus: ((status: SaveStatus) => void) | null = null;
  onProject: ((meta: ProjectMeta) => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private loading = false;

  constructor(
    private store: Store,
    private projects: ProjectStore,
  ) {
    this.current = projects.ensureFirst();
    this.loadInto(this.current);
    store.subscribe((kind) => {
      if (!this.loading && (kind === 'model' || kind === 'settings')) this.scheduleSave();
    });
    window.addEventListener('beforeunload', () => this.flush());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.flush();
    });
  }

  list(): ProjectMeta[] {
    return this.projects.list();
  }

  private loadInto(meta: ProjectMeta): void {
    this.loading = true;
    try {
      this.store.loadDocument(this.projects.load(meta.id) ?? EMPTY);
      this.store.clearHistory();
    } finally {
      this.loading = false;
    }
    this.dirty = false;
    this.projects.setCurrent(meta.id);
    this.current = meta;
    document.title = `${meta.name} — Lumber`;
    this.onProject?.(meta);
    this.onStatus?.('saved');
  }

  private scheduleSave(): void {
    this.dirty = true;
    this.onStatus?.('saving');
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }

  /** Write the current project now (the debounce otherwise waits a moment). */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty) return;
    this.dirty = false;
    try {
      this.current = this.projects.save(this.current.id, this.store.toDocument());
      this.onStatus?.('saved');
    } catch {
      this.dirty = true;
      this.onStatus?.('error');
    }
  }

  open(id: string): void {
    if (id === this.current.id) return;
    const meta = this.projects.get(id);
    if (!meta) return;
    this.flush();
    this.loadInto(meta);
  }

  newProject(name = 'Untitled', doc: Document = EMPTY): ProjectMeta {
    this.flush();
    const meta = this.projects.create(name, doc);
    this.loadInto(meta);
    return meta;
  }

  newFromSample(): ProjectMeta {
    return this.newProject('Workbench (sample)', { version: 2, parts: sampleWorkbench() });
  }

  rename(id: string, name: string): void {
    this.projects.rename(id, name);
    if (id === this.current.id) {
      this.current = this.projects.get(id)!;
      document.title = `${this.current.name} — Lumber`;
      this.onProject?.(this.current);
    }
  }

  duplicate(id: string): void {
    this.flush();
    const copy = this.projects.duplicate(id);
    if (copy) this.loadInto(copy);
  }

  remove(id: string): void {
    this.projects.remove(id);
    if (id !== this.current.id) return;
    const next = this.projects.list()[0];
    if (next) this.loadInto(next);
    else this.newProject();
  }

  /** Import a JSON file as a new project named after the file. */
  async importFile(file: File): Promise<boolean> {
    let doc: Document | null = null;
    try {
      doc = parseDocument(JSON.parse(await file.text()));
    } catch {
      /* not JSON */
    }
    if (!doc) return false;
    this.newProject(file.name.replace(/\.json$/i, '') || 'Imported', doc);
    return true;
  }

  /** The current project as a JSON download. */
  exportCurrent(download: (name: string, text: string, type: string) => void): void {
    this.flush();
    const safe = this.current.name.replace(/[^\w.-]+/g, '_') || 'lumber-model';
    download(`${safe}.json`, JSON.stringify(this.store.toDocument(), null, 1), 'application/json');
  }
}
