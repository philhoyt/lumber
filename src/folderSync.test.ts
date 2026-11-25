import { describe, expect, it } from 'vitest';
import { fileNameFor, FolderSync, type DirHandle, type HandleStore } from './folderSync';

/** A directory that lives in a Map. */
function fakeDir(
  name = 'Lumber projects',
  perm = 'granted',
): DirHandle & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    name,
    files,
    queryPermission: async () => perm,
    requestPermission: async () => {
      perm = 'granted';
      return perm;
    },
    getFileHandle: async (file, opts) => {
      if (!files.has(file) && !opts?.create) throw new Error('not found');
      return {
        createWritable: async () => {
          let buf = '';
          return {
            write: async (d: string) => {
              buf += d;
            },
            close: async () => {
              files.set(file, buf);
            },
          };
        },
      };
    },
    removeEntry: async (file) => {
      files.delete(file);
    },
    values: () =>
      (async function* () {
        for (const [n, text] of files)
          yield {
            kind: 'file',
            name: n,
            getFile: async () => ({ text: async () => text }) as File,
          };
      })(),
  };
}
const memStore = (): HandleStore & { h: DirHandle | null } => {
  const s = {
    h: null as DirHandle | null,
    get: async () => s.h,
    set: async (h: DirHandle) => {
      s.h = h;
    },
    clear: async () => {
      s.h = null;
    },
  };
  return s;
};

describe('fileNameFor', () => {
  it('keeps names safe for a file system', () => {
    expect(fileNameFor('Shop bench')).toBe('Shop bench.json');
    expect(fileNameFor('a/b:c*?"<>|')).toBe('a_b_c_.json');
    expect(fileNameFor('   ')).toBe('project.json');
  });
});

describe('FolderSync', () => {
  it('is unsupported where the API is missing', async () => {
    const fs = new FolderSync(memStore(), async () => fakeDir(), false);
    expect(fs.state).toBe('unsupported');
    expect(await fs.link()).toBe(false);
    expect(await fs.write('x', '{}')).toBe(false);
  });

  it('links a folder, writes, renames and lists', async () => {
    const dir = fakeDir();
    const store = memStore();
    const fs = new FolderSync(store, async () => dir, true);
    await fs.init();
    expect(fs.state).toBe('none');
    expect(await fs.link()).toBe(true);
    expect(fs.state).toBe('ready');
    expect(store.h).toBe(dir);
    expect(await fs.write('Bench', '{"a":1}')).toBe(true);
    expect(dir.files.get('Bench.json')).toBe('{"a":1}');
    await fs.remove('Bench');
    expect(dir.files.has('Bench.json')).toBe(false);
    await fs.write('Shed', '{}');
    expect(await fs.listFiles()).toEqual([{ name: 'Shed', text: '{}' }]);
  });

  it('needs permission after a restart and reconnects on request', async () => {
    const dir = fakeDir('Docs', 'prompt');
    const store = memStore();
    store.h = dir;
    const fs = new FolderSync(store, async () => dir, true);
    await fs.init();
    expect(fs.state).toBe('needs-permission');
    expect(fs.folderName).toBe('Docs');
    expect(await fs.write('x', '{}')).toBe(false);
    expect(await fs.reconnect()).toBe(true);
    expect(await fs.write('x', '{}')).toBe(true);
    await fs.unlink();
    expect(fs.state).toBe('none');
    expect(store.h).toBeNull();
  });

  it('treats a cancelled picker as no change', async () => {
    const fs = new FolderSync(
      memStore(),
      async () => {
        throw new DOMException('cancelled', 'AbortError');
      },
      true,
    );
    expect(await fs.link()).toBe(false);
    expect(fs.state).toBe('none');
  });
});
