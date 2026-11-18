// Loads the gzip-compressed engine binaries, from a URL (hosted build) or
// from base64 embedded in the page (single-file build).
const loaders = {
  sqljs_wasm: () => import('virtual:dbify-asset/sqljs_wasm'),
  duckdb_wasm: () => import('virtual:dbify-asset/duckdb_wasm'),
  duckdb_worker: () => import('virtual:dbify-asset/duckdb_worker'),
  pglite_wasm: () => import('virtual:dbify-asset/pglite_wasm'),
  pglite_data: () => import('virtual:dbify-asset/pglite_data'),
  initdb_wasm: () => import('virtual:dbify-asset/initdb_wasm'),
};
export type AssetName = keyof typeof loaders;

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const cache = new Map<AssetName, Promise<Uint8Array>>();

export function loadAsset(name: AssetName): Promise<Uint8Array> {
  if (!cache.has(name)) {
    cache.set(
      name,
      (async () => {
        const mod = (await loaders[name]()).default;
        let gz: Uint8Array;
        if (mod.inline) gz = fromBase64(mod.inline);
        else {
          const res = await fetch(new URL(mod.url!, document.baseURI));
          if (!res.ok) throw new Error(`Could not download ${name} (${res.status})`);
          gz = new Uint8Array(await res.arrayBuffer());
        }
        return gunzip(gz);
      })(),
    );
  }
  return cache.get(name)!;
}

export async function assetBlobUrl(name: AssetName, type: string): Promise<string> {
  const bytes = await loadAsset(name);
  return URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
}
