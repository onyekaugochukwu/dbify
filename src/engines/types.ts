export type EngineId = 'sqlite' | 'duckdb' | 'postgres';

export interface Column {
  name: string;
  type: string;
}

export interface ResultSet {
  columns: Column[];
  rows: unknown[][];
  /** Total rows the query produced (rows may be truncated for display). */
  totalRows: number;
  truncated: boolean;
}

export interface StatementResult {
  sql: string;
  /** Character offset of this statement within the text that was run. */
  offset: number;
  ms: number;
  result?: ResultSet;
  rowsAffected?: number;
  error?: string;
  /** 1-based character position of the error inside `sql`, when the engine reports one. */
  errorPosition?: number;
}

export interface ColumnInfo {
  name: string;
  type: string;
  pk?: boolean;
  notNull?: boolean;
}

export interface ForeignKey {
  column: string;
  refTable: string;
  refColumn: string;
}

export interface TableInfo {
  name: string;
  kind: 'table' | 'view';
  columns: ColumnInfo[];
  foreignKeys: ForeignKey[];
  rowCount?: number;
}

/** Engine-neutral column types used when importing data. */
export type LogicalType = 'integer' | 'bigint' | 'real' | 'decimal' | 'boolean' | 'date' | 'timestamp' | 'text';

export interface ImportColumn {
  name: string;
  type: LogicalType;
  pk?: boolean;
  notNull?: boolean;
  references?: { table: string; column: string };
}

export interface TableData {
  name: string;
  columns: ImportColumn[];
  /** Values already normalised: numbers, booleans, ISO date strings, strings or null. */
  rows: unknown[][];
}

export interface Engine {
  readonly id: EngineId;
  init(saved?: Uint8Array | null): Promise<void>;
  run(sql: string): Promise<StatementResult[]>;
  schema(): Promise<TableInfo[]>;
  createTables(tables: TableData[]): Promise<void>;
  /** Engines with native file readers (DuckDB) can import some files directly. */
  importNative?(file: File, tableName: string): Promise<boolean>;
  exportBytes(): Promise<Uint8Array>;
  importBytes(bytes: Uint8Array): Promise<void>;
  reset(): Promise<void>;
  /** Shuts the engine down and frees its memory. */
  close(): Promise<void>;
}

/** One database the user created. Each database runs in its own engine instance. */
export interface DbMeta {
  id: string;
  engine: EngineId;
  name: string;
  /** Created from the lessons sample. */
  sample?: boolean;
  createdAt: number;
}

export const MAX_DISPLAY_ROWS = 10_000;

export const ENGINE_META: Record<EngineId, { label: string; short: string; fileExt: string; description: string }> = {
  sqlite: {
    label: 'SQLite',
    short: 'SQLite',
    fileExt: '.sqlite',
    description: 'The most widely used database engine. Small, simple and everywhere.',
  },
  duckdb: {
    label: 'DuckDB',
    short: 'DuckDB',
    fileExt: '.duckdb.tar.gz',
    description: 'Fast analytics on big tables. Great for data analysis and CSV files.',
  },
  postgres: {
    label: 'PostgreSQL',
    short: 'Postgres',
    fileExt: '.tar.gz',
    description: 'Real PostgreSQL 17, the industry-standard open-source database.',
  },
};
