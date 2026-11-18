// Minimal ustar writer/reader plus gzip, used to package DuckDB exports.

export interface TarEntry {
  name: string;
  data: Uint8Array;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function writeString(buf: Uint8Array, offset: number, len: number, s: string) {
  buf.set(enc.encode(s).subarray(0, len), offset);
}

function writeOctal(buf: Uint8Array, offset: number, len: number, n: number) {
  writeString(buf, offset, len, n.toString(8).padStart(len - 1, '0') + '\0');
}

export function tar(entries: TarEntry[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const e of entries) {
    const h = new Uint8Array(512);
    writeString(h, 0, 100, e.name);
    writeOctal(h, 100, 8, 0o644);
    writeOctal(h, 108, 8, 0);
    writeOctal(h, 116, 8, 0);
    writeOctal(h, 124, 12, e.data.length);
    writeOctal(h, 136, 12, Math.floor(Date.now() / 1000));
    h.fill(32, 148, 156); // checksum placeholder (spaces)
    h[156] = 48; // '0' regular file
    writeString(h, 257, 8, 'ustar\u000000');
    let sum = 0;
    for (const b of h) sum += b;
    writeString(h, 148, 8, sum.toString(8).padStart(6, '0') + '\0 ');
    blocks.push(h, e.data);
    const pad = (512 - (e.data.length % 512)) % 512;
    if (pad) blocks.push(new Uint8Array(pad));
  }
  blocks.push(new Uint8Array(1024));
  const out = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
  let o = 0;
  for (const b of blocks) {
    out.set(b, o);
    o += b.length;
  }
  return out;
}

export function untar(bytes: Uint8Array): TarEntry[] {
  const out: TarEntry[] = [];
  let o = 0;
  while (o + 512 <= bytes.length) {
    const h = bytes.subarray(o, o + 512);
    if (h.every((b) => b === 0)) break;
    const name = dec.decode(h.subarray(0, 100)).replace(/\0.*$/s, '');
    const prefix = dec.decode(h.subarray(345, 500)).replace(/\0.*$/s, '');
    const size = parseInt(dec.decode(h.subarray(124, 136)).replace(/\0.*$/s, '').trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    o += 512;
    if (type === '0' || type === '\0') out.push({ name: prefix ? `${prefix}/${name}` : name, data: bytes.slice(o, o + size) });
    o += Math.ceil(size / 512) * 512;
  }
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const s = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(s).arrayBuffer());
}

export const gzip = (b: Uint8Array) => pipe(b, new CompressionStream('gzip'));
export const gunzip = (b: Uint8Array) => pipe(b, new DecompressionStream('gzip'));
export const isGzip = (b: Uint8Array) => b[0] === 0x1f && b[1] === 0x8b;
