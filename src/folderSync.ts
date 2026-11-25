/**
 * Mirror projects into a folder on disk through the File System Access API (Chrome and
 * Edge). The folder handle is remembered in IndexedDB; after a restart the browser asks
 * once, on a click, before the folder can be written again.
 */

/** The little we need from a directory handle, so tests can pass a fake. */
export interface DirHandle {
  name: string;
  queryPermission?(opts: { mode: 'readwrite' }): Promise<string>;
  requestPermission?(opts: { mode: 'readwrite' }): Promise<string>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandleLike>;
  removeEntry(name: string): Promise<void>;
  values(): AsyncIterable<{ kind: string; name: string; getFile?(): Promise<File> }>;
}
export interface FileHandleLike {
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}
export interface HandleStore {
  get(): Promise<DirHandle | null>;
  set(h: DirHandle): Promise<void>;
  clear(): Promise<void>;
}

export type FolderState = 'unsupported' | 'none' | 'needs-permission' | 'ready';

export const folderSupported = (): boolean =>
  typeof window !== 'undefined' && 'showDirectoryPicker' in window;

/** A project file name: the project name with anything awkward replaced. */
export const fileNameFor = (name: string): string =>
  `${name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'project'}.json`;

export class FolderSync {
  state: FolderState = 'none';
  handle: DirHandle | null = null;
  onChange: (() => void) | null = null;

  constructor(
    private store: HandleStore,
    private pick: () => Promise<DirHandle>,
    supported = folderSupported(),
  ) {
    if (!supported) this.state = 'unsupported';
  }

  get folderName(): string {
    return this.handle?.name ?? '';
  }

  private set(state: FolderState): void {
    this.state = state;
    this.onChange?.();
  }

  /** Recall the remembered folder, if any, and whether it can be written now. */
  async init(): Promise<void> {
    if (this.state === 'unsupported') return;
    try {
      this.handle = await this.store.get();
    } catch {
      this.handle = null;
    }
    if (!this.handle) return this.set('none');
    const perm = this.handle.queryPermission
      ? await this.handle.queryPermission({ mode: 'readwrite' })
      : 'granted';
    this.set(perm === 'granted' ? 'ready' : 'needs-permission');
  }

  /** Ask the person for a folder. Resolves false if they cancel. */
  async link(): Promise<boolean> {
    if (this.state === 'unsupported') return false;
    try {
      this.handle = await this.pick();
    } catch {
      return false; // cancelled
    }
    await this.store.set(this.handle);
    this.set('ready');
    return true;
  }

  /** After a restart: ask the browser to allow writing to the remembered folder again. */
  async reconnect(): Promise<boolean> {
    if (!this.handle) return false;
    const perm = this.handle.requestPermission
      ? await this.handle.requestPermission({ mode: 'readwrite' })
      : 'granted';
    this.set(perm === 'granted' ? 'ready' : 'needs-permission');
    return this.state === 'ready';
  }

  async unlink(): Promise<void> {
    this.handle = null;
    await this.store.clear();
    this.set('none');
  }

  /** Write a project file. Returns false when there is no folder to write to. */
  async write(name: string, text: string): Promise<boolean> {
    if (this.state !== 'ready' || !this.handle) return false;
    try {
      const file = await this.handle.getFileHandle(fileNameFor(name), { create: true });
      const w = await file.createWritable();
      await w.write(text);
      await w.close();
      return true;
    } catch {
      this.set('needs-permission');
      return false;
    }
  }

  /** Remove a project file, for example the old name after a rename. */
  async remove(name: string): Promise<void> {
    if (this.state !== 'ready' || !this.handle) return;
    try {
      await this.handle.removeEntry(fileNameFor(name));
    } catch {
      /* already gone */
    }
  }

  /** Every .json file in the folder with its text. */
  async listFiles(): Promise<{ name: string; text: string }[]> {
    if (this.state !== 'ready' || !this.handle) return [];
    const out: { name: string; text: string }[] = [];
    for await (const entry of this.handle.values()) {
      if (entry.kind !== 'file' || !/\.json$/i.test(entry.name) || !entry.getFile) continue;
      try {
        const file = await entry.getFile();
        out.push({ name: entry.name.replace(/\.json$/i, ''), text: await file.text() });
      } catch {
        /* unreadable: skip */
      }
    }
    return out;
  }
}

// ---- the real browser plumbing ----

const DB = 'lumber';
const STORE = 'kv';
const KEY = 'folder';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

/** Keeps the folder handle in IndexedDB, the only place a handle can be stored. */
export const idbHandleStore: HandleStore = {
  get: () => tx<DirHandle | undefined>('readonly', (s) => s.get(KEY)).then((h) => h ?? null),
  set: (h) => tx('readwrite', (s) => s.put(h, KEY)).then(() => undefined),
  clear: () => tx('readwrite', (s) => s.delete(KEY)).then(() => undefined),
};

export const browserPicker = (): Promise<DirHandle> =>
  (window as unknown as { showDirectoryPicker(o: object): Promise<DirHandle> }).showDirectoryPicker(
    { mode: 'readwrite', id: 'lumber-projects' },
  );
