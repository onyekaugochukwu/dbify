import { loadAsset } from '../lib/assets';
import { WorkerEngine } from './worker-engine';
import SqliteWorker from './sqlite.worker.ts?worker&inline';
import PostgresWorker from './postgres.worker.ts?worker&inline';
import type { Engine, EngineId } from './types';

export async function createEngine(id: EngineId): Promise<Engine> {
  switch (id) {
    case 'sqlite':
      return new WorkerEngine('sqlite', new SqliteWorker(), async (saved) => [await loadAsset('sqljs_wasm'), saved ?? null]);
    case 'postgres':
      return new WorkerEngine('postgres', new PostgresWorker(), async (saved) => {
        const [wasm, initdb, data] = await Promise.all([
          loadAsset('pglite_wasm'),
          loadAsset('initdb_wasm'),
          loadAsset('pglite_data'),
        ]);
        return [wasm, initdb, data, saved ?? null];
      });
    case 'duckdb': {
      const { DuckDBEngine } = await import('./duckdb');
      return new DuckDBEngine();
    }
  }
}

export * from './types';
