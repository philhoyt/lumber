/**
 * Share links: the whole document, deflated and base64url-encoded, after the page's
 * hash as `#m=1.<data>`. Nothing is uploaded; the link carries the model.
 */
import { parseDocument, type Document } from './document';

const VERSION = '1';

async function pipe(bytes: Uint8Array, stream: GenericTransformStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** The document as the hash fragment of a share link, e.g. `m=1.eJyr...`. */
export async function encodeShare(doc: Document, name: string): Promise<string> {
  const json = JSON.stringify({ ...doc, name });
  const raw = new TextEncoder().encode(json);
  const packed = await pipe(raw, new CompressionStream('deflate-raw'));
  return `m=${VERSION}.${toBase64Url(packed)}`;
}

/** The document in a share link's hash, with the sender's project name, or null. */
export async function decodeShare(hash: string): Promise<{ doc: Document; name: string } | null> {
  const m = /(?:^|[#&])m=(\d+)\.([A-Za-z0-9_-]+)/.exec(hash);
  if (m?.[1] !== VERSION) return null;
  try {
    const packed = fromBase64Url(m[2]!);
    const raw = await pipe(packed, new DecompressionStream('deflate-raw'));
    const parsed = JSON.parse(new TextDecoder().decode(raw)) as { name?: unknown };
    const doc = parseDocument(parsed);
    if (!doc) return null;
    const name =
      typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : 'Shared model';
    return { doc, name };
  } catch {
    return null;
  }
}

/** Rough size for the toast: "12 KB". */
export const linkSize = (link: string): string =>
  link.length < 1024 ? `${link.length} B` : `${Math.round(link.length / 1024)} KB`;
