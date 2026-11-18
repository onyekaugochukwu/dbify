import { createEngine, ENGINE_META, type DbMeta, type Engine, type EngineId, type StatementResult, type TableData, type TableInfo } from './engines';
import { isReadOnly, splitStatements } from './engines/sql-split';
import { parseFile, safeIdentifier, tableNameFromFile } from './lib/import-file';
import { loadSaved, saveBytes, clearSaved, loadJson, saveJson } from './lib/persist';
import { downloadBytes } from './lib/download';
import { compareResults, type CheckOutcome } from './lib/check';
import { decodeShare, type SharePayload } from './lib/share';
import { exercises, type Exercise } from './lessons/exercises';
import sample from './lessons/naija-mart.json';

export const ENGINE_IDS: EngineId[] = ['sqlite', 'duckdb', 'postgres'];
export const SAMPLE_DB_NAME = 'naija_mart';

export interface DbState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error?: string;
  schema: TableInfo[];
  busy?: string;
}

export type TabKind = 'query' | 'table' | 'diagram';

export interface Tab {
  id: string;
  kind: TabKind;
  dbId: string;
  title: string;
  sql: string;
  /** Table name, for table-data tabs. */
  table?: string;
  results: StatementResult[] | null;
  running: boolean;
  activeResult: number;
  view: 'results' | 'messages';
  exerciseId?: string;
  /** Character offset of the text that was run, so errors can be underlined. */
  runOffset: number;
}

export interface HistoryEntry {
  sql: string;
  dbId: string;
  dbName: string;
  engine: EngineId;
  at: number;
  ok: boolean;
  ms: number;
}

export interface Settings {
  upperKeywords: boolean;
  theme: 'dark' | 'light';
  fontSize: number;
  defaultEngine: EngineId;
}

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  text: string;
}

export interface Dialog {
  kind: 'new-database' | 'rename-database';
  engine?: EngineId;
  dbId?: string;
  /** Run after a database is created (e.g. import files into it). */
  then?: (db: DbMeta) => void;
  title?: string;
}

let counter = 0;
const newId = (p: string) => `${p}${Date.now().toString(36)}${(counter++).toString(36)}`;

type SavedTab = Pick<Tab, 'id' | 'kind' | 'dbId' | 'title' | 'sql' | 'exerciseId' | 'table'> & { engine?: EngineId };

class AppState {
  databases = $state<DbMeta[]>([]);
  dbs = $state<Record<string, DbState>>({});
  tabs = $state<Tab[]>([]);
  activeTabId = $state<string | null>(null);
  panel = $state<'explorer' | 'lessons' | 'history' | 'help'>('explorer');
  sideOpen = $state(true);
  settings = $state<Settings>(loadJson('settings', { upperKeywords: true, theme: 'dark', fontSize: 14, defaultEngine: 'sqlite' }));
  toasts = $state<Toast[]>([]);
  completed = $state<Record<string, boolean>>(loadJson('completed', {}));
  checks = $state<Record<string, CheckOutcome>>({});
  history = $state<HistoryEntry[]>(loadJson('history', []));
  dialog = $state<Dialog | null>(null);
  started = $state(false);

  private instances = new Map<string, Promise<Engine>>();
  private saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private toastId = 0;

  get activeTab(): Tab | undefined {
    return this.tabs.find((t) => t.id === this.activeTabId);
  }

  db(id: string | undefined): DbMeta | undefined {
    return this.databases.find((d) => d.id === id);
  }

  engineOf(dbId: string): EngineId {
    return this.db(dbId)?.engine ?? 'sqlite';
  }

  dbsOf(engine: EngineId): DbMeta[] {
    return this.databases.filter((d) => d.engine === engine);
  }

  sampleDb(engine: EngineId): DbMeta | undefined {
    return this.databases.find((d) => d.engine === engine && d.sample);
  }

  /* ---------------- startup ---------------- */

  async start() {
    const stored = loadJson<DbMeta[]>('databases', []);
    const ws = loadJson<{ tabs: SavedTab[]; active: string | null; started: boolean }>('workspace', { tabs: [], active: null, started: false });

    let dbs = stored;
    if (!localStorage.getItem('dbify:databases')) {
      // Upgrade from the one-database-per-engine version: its databases
      // were saved under the engine's name.
      dbs = [];
      for (const engine of ENGINE_IDS) {
        const used = ws.tabs.some((t) => (t.engine ?? 'sqlite') === engine);
        if (used || (await loadSaved(engine))) dbs.push({ id: engine, engine, name: 'main', createdAt: Date.now() });
      }
    }
    this.databases = dbs;
    for (const d of dbs) this.dbs[d.id] = { status: 'idle', schema: [] };

    this.tabs = ws.tabs
      .map((t) => ({ ...t, dbId: t.dbId ?? t.engine ?? 'sqlite', kind: t.kind ?? 'query' }))
      .filter((t) => this.db(t.dbId))
      .map((t) => this.makeTab(t));
    this.activeTabId = this.tabs.some((t) => t.id === ws.active) ? ws.active : (this.tabs[0]?.id ?? null);
    this.persistDatabases();
    this.started = true;

    const share = decodeShare(location.hash);
    if (share) {
      history.replaceState(null, '', location.pathname + location.search);
      await this.openShared(share);
    }
    for (const id of new Set(this.tabs.map((t) => t.dbId))) this.ensureDb(id).catch(() => {});
  }

  /* ---------------- databases ---------------- */

  private persistDatabases() {
    saveJson('databases', this.databases);
  }

  uniqueDbName(engine: EngineId, wanted: string): string {
    const base = safeIdentifier(wanted, 'database');
    const taken = new Set(this.dbsOf(engine).map((d) => d.name));
    let n = base, i = 2;
    while (taken.has(n)) n = `${base}_${i++}`;
    return n;
  }

  nextDbName(engine: EngineId): string {
    return this.uniqueDbName(engine, `database_${this.dbsOf(engine).length + 1}`);
  }

  async createDatabase(engine: EngineId, name: string, opts: { sample?: boolean; bytes?: Uint8Array } = {}): Promise<DbMeta> {
    const meta: DbMeta = { id: newId('db_'), engine, name: this.uniqueDbName(engine, name), createdAt: Date.now(), sample: opts.sample };
    if (opts.bytes) await saveBytes(meta.id, opts.bytes);
    this.databases.push(meta);
    this.dbs[meta.id] = { status: 'idle', schema: [] };
    this.persistDatabases();
    try {
      await this.ensureDb(meta.id);
    } catch (e) {
      if (opts.bytes) {
        await this.deleteDatabase(meta.id, true);
        throw e;
      }
    }
    return this.db(meta.id)!;
  }

  renameDatabase(id: string, name: string) {
    const d = this.db(id);
    if (!d) return;
    const clean = safeIdentifier(name, d.name);
    if (clean === d.name) return;
    d.name = this.uniqueDbName(d.engine, clean);
    this.persistDatabases();
  }

  async deleteDatabase(id: string, quiet = false) {
    const d = this.db(id);
    if (!d) return;
    for (const t of this.tabs.filter((t) => t.dbId === id)) this.closeTab(t.id);
    const inst = this.instances.get(id);
    this.instances.delete(id);
    clearTimeout(this.saveTimers.get(id));
    inst?.then((e) => e.close()).catch(() => {});
    await clearSaved(id);
    this.databases = this.databases.filter((x) => x.id !== id);
    delete this.dbs[id];
    this.persistDatabases();
    if (!quiet) this.toast('info', `Deleted the ${ENGINE_META[d.engine].label} database ${d.name}.`);
  }

  ensureDb(id: string): Promise<Engine> {
    const meta = this.db(id);
    if (!meta) return Promise.reject(new Error('That database no longer exists.'));
    if (!this.instances.has(id)) {
      const st = (this.dbs[id] ??= { status: 'idle', schema: [] });
      st.status = 'loading';
      st.error = undefined;
      const p = (async () => {
        const engine = await createEngine(meta.engine);
        const saved = await loadSaved(id);
        try {
          await engine.init(saved);
        } catch (e) {
          if (!saved) throw e;
          console.warn('Could not restore saved database', e);
          await engine.reset().catch(() => engine.init(null));
          this.toast('error', `The saved copy of ${meta.name} could not be restored, so it was started empty.`);
        }
        this.dbs[id].status = 'ready';
        await this.refreshSchema(id, engine);
        return engine;
      })();
      p.catch((e) => {
        if (!this.dbs[id]) return;
        this.dbs[id].status = 'error';
        this.dbs[id].error = String(e?.message ?? e);
        this.instances.delete(id);
      });
      this.instances.set(id, p);
    }
    return this.instances.get(id)!;
  }

  async refreshSchema(id: string, engine?: Engine) {
    try {
      const e = engine ?? (await this.ensureDb(id));
      if (this.dbs[id]) this.dbs[id].schema = await e.schema();
    } catch (e) {
      console.warn('schema', e);
    }
  }

  scheduleSave(id: string) {
    clearTimeout(this.saveTimers.get(id));
    this.saveTimers.set(
      id,
      setTimeout(async () => {
        if (!this.db(id)) return;
        try {
          const engine = await this.ensureDb(id);
          await saveBytes(id, await engine.exportBytes());
        } catch (e) {
          console.warn('autosave failed', e);
        }
      }, 1200),
    );
  }

  /* ---------------- tabs ---------------- */

  private makeTab(t: Partial<Tab> & Pick<Tab, 'dbId'>): Tab {
    return {
      id: t.id ?? newId('t'),
      kind: t.kind ?? 'query',
      dbId: t.dbId,
      title: t.title ?? 'Query',
      sql: t.sql ?? '',
      table: t.table,
      exerciseId: t.exerciseId,
      results: null,
      running: false,
      activeResult: 0,
      view: 'results',
      runOffset: 0,
    };
  }

  private addTab(t: Partial<Tab> & Pick<Tab, 'dbId'>): Tab {
    this.tabs.push(this.makeTab(t));
    const tab = this.tabs[this.tabs.length - 1];
    this.activeTabId = tab.id;
    this.ensureDb(t.dbId).catch(() => {});
    this.persistWorkspace();
    return tab;
  }

  newQuery(dbId: string, sql = '', title?: string, exerciseId?: string): Tab {
    const n = this.tabs.filter((t) => /^Query \d+$/.test(t.title)).length + 1;
    return this.addTab({ kind: 'query', dbId, sql, title: title ?? `Query ${n}`, exerciseId });
  }

  /** New query on whatever database makes sense right now. */
  newQueryAnywhere(sql = '') {
    const db = this.db(this.activeTab?.dbId) ?? this.dbsOf(this.settings.defaultEngine)[0] ?? this.databases[0];
    if (db) return this.newQuery(db.id, sql);
    this.dialog = { kind: 'new-database', engine: this.settings.defaultEngine, then: (d) => this.newQuery(d.id, sql) };
  }

  openTable(dbId: string, table: string) {
    const existing = this.tabs.find((t) => t.kind === 'table' && t.dbId === dbId && t.table === table);
    if (existing) {
      this.activeTabId = existing.id;
      return existing;
    }
    return this.addTab({ kind: 'table', dbId, table, title: table });
  }

  openDiagram(dbId: string) {
    const existing = this.tabs.find((t) => t.kind === 'diagram' && t.dbId === dbId);
    if (existing) {
      this.activeTabId = existing.id;
      return existing;
    }
    return this.addTab({ kind: 'diagram', dbId, title: `${this.db(dbId)?.name} diagram` });
  }

  closeTab(id: string) {
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i === -1) return;
    this.tabs.splice(i, 1);
    if (this.activeTabId === id) this.activeTabId = this.tabs[Math.min(i, this.tabs.length - 1)]?.id ?? null;
    this.persistWorkspace();
  }

  private persistTimer?: ReturnType<typeof setTimeout>;
  persistWorkspace(now = false) {
    clearTimeout(this.persistTimer);
    const write = () =>
      saveJson('workspace', {
        tabs: this.tabs.map(({ id, kind, dbId, title, sql, exerciseId, table }) => ({ id, kind, dbId, title, sql, exerciseId, table })),
        active: this.activeTabId,
        started: true,
      });
    if (now) write();
    else this.persistTimer = setTimeout(write, 400);
  }

  saveSettings() {
    saveJson('settings', this.settings);
  }

  /* ---------------- running SQL ---------------- */

  async run(tab: Tab, text: string, offset: number) {
    if (tab.running) return;
    if (!splitStatements(text).length) {
      this.toast('info', 'There is no SQL to run yet.');
      return;
    }
    tab.running = true;
    tab.runOffset = offset;
    try {
      const engine = await this.ensureDb(tab.dbId);
      const results = await engine.run(text);
      tab.results = results;
      const lastRows = results.map((r, i) => (r.result ? i : -1)).filter((i) => i >= 0);
      const failed = results.some((r) => r.error);
      tab.activeResult = lastRows.length ? lastRows[lastRows.length - 1] : 0;
      tab.view = failed || !lastRows.length ? 'messages' : 'results';
      this.addHistory(tab, text, !failed, results.reduce((a, r) => a + r.ms, 0));
      if (results.some((r) => !r.error && !isReadOnly(r.sql))) await this.afterChange(tab.dbId, engine);
    } catch (e: any) {
      tab.results = [{ sql: text, offset: 0, ms: 0, error: String(e?.message ?? e) }];
      tab.view = 'messages';
    } finally {
      tab.running = false;
    }
  }

  /** Call after anything that may have changed a database. */
  async afterChange(dbId: string, engine?: Engine) {
    await this.refreshSchema(dbId, engine);
    this.scheduleSave(dbId);
  }

  private addHistory(tab: Tab, sql: string, ok: boolean, ms: number) {
    const d = this.db(tab.dbId);
    if (!d) return;
    const trimmed = sql.trim();
    if (this.history[0]?.sql === trimmed && this.history[0].dbId === d.id) this.history.shift();
    this.history.unshift({ sql: trimmed, dbId: d.id, dbName: d.name, engine: d.engine, at: Date.now(), ok, ms });
    if (this.history.length > 300) this.history.length = 300;
    saveJson('history', this.history);
  }

  clearHistory() {
    this.history = [];
    saveJson('history', []);
  }

  /* ---------------- data in and out ---------------- */

  async importFiles(dbId: string, files: File[]) {
    if (!files.length) return;
    const engine = await this.ensureDb(dbId);
    const st = this.dbs[dbId];
    st.busy = 'Importing…';
    try {
      for (const file of files) {
        const existing = new Set(st.schema.map((t) => t.name));
        const unique = (name: string) => {
          let n = name, i = 2;
          while (existing.has(n)) n = `${name}_${i++}`;
          existing.add(n);
          return n;
        };
        const base = unique(tableNameFromFile(file.name));
        let created: string[] = [];
        if (engine.importNative && (await engine.importNative(file, base).catch((e) => (console.warn('native import failed, using fallback', e), false)))) {
          created = [base];
        } else {
          const tables = (await parseFile(file, base)).map((t) => ({ ...t, name: t.name === base ? base : unique(t.name) }));
          await engine.createTables(tables);
          created = tables.map((t) => t.name);
        }
        await this.refreshSchema(dbId, engine);
        const counts = created.map((n) => `${n} (${st.schema.find((t) => t.name === n)?.rowCount?.toLocaleString() ?? '?'} rows)`);
        this.toast('success', `Imported ${file.name} as ${counts.join(', ')}.`);
        if (created.length) this.openTable(dbId, created[0]);
      }
      this.scheduleSave(dbId);
    } catch (e: any) {
      this.toast('error', `Import failed: ${e?.message ?? e}`);
    } finally {
      st.busy = undefined;
    }
  }

  async importAsNewDatabase(engine: EngineId, files: File[]) {
    if (!files.length) return;
    const db = await this.createDatabase(engine, tableNameFromFile(files[0].name));
    await this.importFiles(db.id, files);
  }

  /** Creates (or refreshes) the lessons sample database for an engine. */
  async loadSample(engine: EngineId, quiet = false): Promise<DbMeta | undefined> {
    let db = this.sampleDb(engine);
    if (!db) db = await this.createDatabase(engine, SAMPLE_DB_NAME, { sample: true });
    const instance = await this.ensureDb(db.id);
    const st = this.dbs[db.id];
    st.busy = 'Loading sample…';
    try {
      const names = (sample.tables as TableData[]).map((t) => t.name);
      for (const n of [...names].reverse()) if (st.schema.some((t) => t.name === n)) await instance.run(`DROP TABLE IF EXISTS ${n}`);
      await instance.createTables(sample.tables as TableData[]);
      await this.afterChange(db.id, instance);
      if (!quiet) this.toast('success', `The ${sample.name} sample database is ready in ${ENGINE_META[engine].label} (${db.name}).`);
      return db;
    } catch (e: any) {
      this.toast('error', `Could not load the sample: ${e?.message ?? e}`);
    } finally {
      st.busy = undefined;
    }
  }

  /** Landing-page action: sample database plus a friendly first query. */
  async trySample(engine: EngineId = this.settings.defaultEngine) {
    const db = this.sampleDb(engine) ?? (await this.loadSample(engine, true));
    if (!db) return;
    this.newQuery(db.id, STARTER_SQL, 'First query');
    const tab = this.activeTab;
    if (tab) this.run(tab, tab.sql, 0);
  }

  async saveDatabaseFile(dbId: string) {
    const d = this.db(dbId)!;
    const engine = await this.ensureDb(dbId);
    this.dbs[dbId].busy = 'Saving…';
    try {
      downloadBytes(await engine.exportBytes(), `${d.name}${ENGINE_META[d.engine].fileExt}`);
    } catch (e: any) {
      this.toast('error', `Could not save: ${e?.message ?? e}`);
    } finally {
      this.dbs[dbId].busy = undefined;
    }
  }

  async openDatabaseFile(engine: EngineId, file: File) {
    const name = file.name.replace(/(\.tar)?\.(gz|tgz|sqlite3?|db3?|duckdb)$/i, '').replace(/\.(duckdb|tar)$/i, '');
    try {
      const db = await this.createDatabase(engine, name, { bytes: new Uint8Array(await file.arrayBuffer()) });
      this.toast('success', `Opened ${file.name} as the ${ENGINE_META[engine].label} database ${db.name}.`);
    } catch (e: any) {
      this.toast('error', `Could not open ${file.name} as a ${ENGINE_META[engine].label} database: ${e?.message ?? e}`);
    }
  }

  async clearDatabase(dbId: string) {
    const engine = await this.ensureDb(dbId);
    await engine.reset();
    await this.afterChange(dbId, engine);
  }

  /* ---------------- sharing ---------------- */

  private async openShared(s: SharePayload) {
    let db: DbMeta | undefined;
    if (s.sample) db = this.sampleDb(s.engine) ?? (await this.loadSample(s.engine, true));
    db ??= this.dbsOf(s.engine)[0] ?? (await this.createDatabase(s.engine, 'main'));
    if (!db) return;
    this.newQuery(db.id, s.sql, s.title ?? 'Shared query');
    this.toast('info', `Opened a shared query in ${ENGINE_META[s.engine].label} (${db.name}). Press Run to try it.`);
  }

  /* ---------------- exercises ---------------- */

  async openExercise(ex: Exercise, engine: EngineId) {
    const existing = this.tabs.find((t) => t.exerciseId === ex.id && this.engineOf(t.dbId) === engine);
    if (existing) {
      this.activeTabId = existing.id;
      return;
    }
    const db = this.sampleDb(engine) ?? (await this.loadSample(engine, true));
    if (!db) return;
    const prompt = ex.prompt.replace(/(.{1,78})(\s|$)/g, '-- $1\n');
    this.newQuery(db.id, `-- Exercise: ${ex.title}\n${prompt}\n`, ex.title, ex.id);
  }

  async checkExercise(ex: Exercise, tab: Tab) {
    const engine = await this.ensureDb(tab.dbId);
    const mine = await engine.run(tab.sql);
    tab.results = mine;
    tab.runOffset = 0;
    if (mine.find((r) => r.error)) {
      tab.view = 'messages';
      this.checks[ex.id] = { ok: false, message: 'Your SQL has an error. Fix it first (see Messages).' };
      return;
    }
    const lastIdx = mine.map((r, i) => (r.result ? i : -1)).filter((i) => i >= 0).pop();
    if (lastIdx !== undefined) {
      tab.activeResult = lastIdx;
      tab.view = 'results';
    }
    const expected = await engine.run(ex.solution);
    const exp = expected.find((r) => r.error);
    if (exp) {
      this.checks[ex.id] = {
        ok: false,
        message: /no such table|does not exist/i.test(exp.error!) ? `This exercise needs the ${sample.name} sample database. Open it from the Lessons panel.` : `Could not run the reference answer: ${exp.error}`,
      };
      return;
    }
    const want = [...expected].reverse().find((r) => r.result)!.result!;
    const outcome = compareResults(lastIdx !== undefined ? mine[lastIdx].result : undefined, want, /ORDER\s+BY/i.test(ex.solution));
    this.checks[ex.id] = outcome;
    if (outcome.ok) {
      this.completed[ex.id] = true;
      saveJson('completed', this.completed);
    }
  }

  /* ---------------- toasts ---------------- */

  toast(kind: Toast['kind'], text: string) {
    const id = ++this.toastId;
    this.toasts.push({ id, kind, text });
    if (this.toasts.length > 3) this.toasts.splice(0, this.toasts.length - 3);
    setTimeout(() => this.dismiss(id), kind === 'error' ? 9000 : 5000);
  }

  dismiss(id: number) {
    const i = this.toasts.findIndex((t) => t.id === id);
    if (i >= 0) this.toasts.splice(i, 1);
  }
}

export const app = new AppState();
export { exercises, sample };

const STARTER_SQL = `-- This is the Naija Mart sample database: a made-up online store.
-- Press Ctrl+Enter (or Run) to see how many products each category has.

SELECT category, COUNT(*) AS products, MIN(unit_price) AS cheapest
FROM products
GROUP BY category
ORDER BY products DESC;
`;
