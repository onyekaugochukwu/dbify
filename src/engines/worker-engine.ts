import { rpcClient } from './common';
import type { Engine, EngineId, StatementResult, TableData, TableInfo } from './types';

/** An engine whose database lives in a dedicated Web Worker. */
export class WorkerEngine implements Engine {
  private call: ReturnType<typeof rpcClient>;

  constructor(
    readonly id: EngineId,
    worker: Worker,
    private initArgs: (saved?: Uint8Array | null) => Promise<unknown[]>,
  ) {
    this.call = rpcClient(worker);
  }

  async init(saved?: Uint8Array | null) {
    await this.call('init', ...(await this.initArgs(saved)));
  }
  run(sql: string) {
    return this.call<StatementResult[]>('run', sql);
  }
  schema() {
    return this.call<TableInfo[]>('schema');
  }
  createTables(tables: TableData[]) {
    return this.call<void>('createTables', tables);
  }
  exportBytes() {
    return this.call<Uint8Array>('exportBytes');
  }
  importBytes(bytes: Uint8Array) {
    return this.call<void>('importBytes', bytes);
  }
  reset() {
    return this.call<void>('reset');
  }
}
