// "Copy link": a query packed into the URL hash. Nothing is uploaded; the
// whole query lives in the link itself.
import type { EngineId } from '../engines/types';

export interface SharePayload {
  engine: EngineId;
  sql: string;
  /** Open on the lessons sample database. */
  sample?: boolean;
  title?: string;
}

/** Links always point at the hosted site, even when copied from dbify.html on disk. */
export const HOSTED_URL = 'https://onyekaugochukwu.github.io/dbify/';

function toBase64Url(s: string) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function shareUrl(p: SharePayload): string {
  const base = location.protocol.startsWith('http') ? location.origin + location.pathname : HOSTED_URL;
  const body = { e: p.engine, q: p.sql, s: p.sample ? 1 : undefined, t: p.title };
  return `${base}#share=${toBase64Url(JSON.stringify(body))}`;
}

export function decodeShare(hash: string): SharePayload | null {
  const m = /[#&]share=([A-Za-z0-9_-]+)/.exec(hash);
  if (!m) return null;
  try {
    const o = JSON.parse(fromBase64Url(m[1]));
    if (!['sqlite', 'duckdb', 'postgres'].includes(o.e) || typeof o.q !== 'string') return null;
    return { engine: o.e, sql: o.q, sample: !!o.s, title: typeof o.t === 'string' ? o.t : undefined };
  } catch {
    return null;
  }
}
