import { describe, expect, it } from 'vitest';
import { sampleWorkbench } from './sample';
import { decodeShare, encodeShare, linkSize } from './share';
import type { Document } from './document';

describe('share links', () => {
  it('round-trips the sample bench with its name', async () => {
    const doc: Document = { version: 2, parts: sampleWorkbench() };
    const hash = await encodeShare(doc, 'Shop bench');
    expect(hash.startsWith('m=1.')).toBe(true);
    expect(hash).toMatch(/^m=1\.[A-Za-z0-9_-]+$/);
    const back = await decodeShare(`#${hash}`);
    expect(back!.name).toBe('Shop bench');
    expect(back!.doc.parts).toHaveLength(doc.parts.length);
    expect(back!.doc.parts[0]).toEqual(doc.parts[0]);
  });

  it('compresses well', async () => {
    const doc: Document = { version: 2, parts: sampleWorkbench() };
    const hash = await encodeShare(doc, 'x');
    expect(hash.length).toBeLessThan(JSON.stringify(doc).length / 3);
  });

  it('rejects junk, other versions and a missing hash', async () => {
    expect(await decodeShare('')).toBeNull();
    expect(await decodeShare('#m=2.abc')).toBeNull();
    expect(await decodeShare('#m=1.not-really-deflate')).toBeNull();
    expect(await decodeShare('#other=1')).toBeNull();
  });

  it('falls back to a default name', async () => {
    const hash = await encodeShare({ version: 2, parts: [] }, '   ');
    expect((await decodeShare(hash))!.name).toBe('Shared model');
  });

  it('describes the link size', () => {
    expect(linkSize('x'.repeat(500))).toBe('500 B');
    expect(linkSize('x'.repeat(12 * 1024))).toBe('12 KB');
  });
});
