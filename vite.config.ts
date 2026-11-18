import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';

/**
 * Engine binaries (WASM files, DuckDB's worker script, Postgres's data bundle)
 * are always shipped gzip-compressed and decompressed in the browser with
 * DecompressionStream. That keeps downloads small on any static host.
 *
 *  - web build:    emitted as files under engines/*.gz and fetched on demand
 *  - single build: embedded as base64 strings so one .html file holds everything
 */
const ASSETS: Record<string, string> = {
  sqljs_wasm: 'node_modules/sql.js/dist/sql-wasm-browser.wasm',
  duckdb_wasm: 'node_modules/@duckdb/duckdb-wasm/dist/duckdb-eh.wasm',
  duckdb_worker: 'node_modules/@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js',
  pglite_wasm: 'node_modules/@electric-sql/pglite/dist/pglite.wasm',
  pglite_data: 'node_modules/@electric-sql/pglite/dist/pglite.data',
  initdb_wasm: 'node_modules/@electric-sql/pglite/dist/initdb.wasm',
};

const PREFIX = 'virtual:dbify-asset/';
const RESOLVED = '\0' + PREFIX;

function engineAssets(single: boolean): Plugin {
  const cache = new Map<string, Buffer>();
  const gz = (name: string) => {
    if (!cache.has(name)) cache.set(name, gzipSync(readFileSync(resolve(ASSETS[name])), { level: 9 }));
    return cache.get(name)!;
  };
  return {
    name: 'dbify-engine-assets',
    resolveId(id) {
      if (id.startsWith(PREFIX)) return '\0' + id;
    },
    load(id) {
      if (!id.startsWith(RESOLVED)) return;
      const name = id.slice(RESOLVED.length);
      if (!(name in ASSETS)) throw new Error(`Unknown engine asset ${name}`);
      if (single) return `export default { inline: ${JSON.stringify(gz(name).toString('base64'))} };`;
      return `export default { url: ${JSON.stringify(`engines/${name}.gz`)} };`;
    },
    generateBundle() {
      if (single) return;
      for (const name of Object.keys(ASSETS)) {
        this.emitFile({ type: 'asset', fileName: `engines/${name}.gz`, source: gz(name) });
      }
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = req.url?.match(/\/engines\/(\w+)\.gz$/);
        if (!m || !(m[1] in ASSETS)) return next();
        res.setHeader('Content-Type', 'application/octet-stream');
        res.end(gz(m[1]));
      });
    },
  };
}

/**
 * PGlite points at its own .wasm/.data files with new URL(..., import.meta.url).
 * dbify hands PGlite those binaries itself (compressed), so strip the
 * references to stop Vite bundling a second, uncompressed copy.
 */
function stripPgliteAssetUrls(): Plugin {
  return {
    name: 'dbify-strip-pglite-asset-urls',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('@electric-sql/pglite/dist/')) return;
      const out = code.replace(/new URL\("(\.\/)?(pglite\.wasm|pglite\.data|initdb\.wasm)",import\.meta\.url\)/g, 'new URL("data:,dbify-provides-$2")');
      return out === code ? undefined : { code: out, map: null };
    },
  };
}

export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    plugins: [
      svelte(),
      stripPgliteAssetUrls(),
      engineAssets(single),
      single
        ? viteSingleFile({ removeViteModuleLoader: true })
        : VitePWA({
            registerType: 'autoUpdate',
            injectRegister: null,
            includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
            manifest: {
              name: 'dbify — SQL in your browser',
              short_name: 'dbify',
              description: 'Learn and practise SQL with SQLite, DuckDB and PostgreSQL. Runs entirely in your browser, works offline.',
              theme_color: '#1b1f27',
              background_color: '#1b1f27',
              display: 'standalone',
              start_url: './',
              scope: './',
              icons: [
                { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
                { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
                { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
              ],
            },
            workbox: {
              globPatterns: ['**/*.{js,css,html,svg,png,gz,webmanifest}'],
              globIgnores: ['**/dbify.html'],
              maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
              navigateFallback: 'index.html',
            },
          }),
    ],
    // Classic (iife) workers: Chrome refuses module workers on pages opened from disk.
    worker: {
      format: 'iife',
      plugins: () => [stripPgliteAssetUrls()],
      rollupOptions: { output: { codeSplitting: false } },
    },
    build: {
      outDir: single ? 'dist-single' : 'dist',
      target: 'es2022',
      chunkSizeWarningLimit: 4000,
      assetsInlineLimit: single ? 100_000_000 : 4096,
    },
    optimizeDeps: { exclude: ['@electric-sql/pglite', '@duckdb/duckdb-wasm', 'sql.js'] },
  };
});
