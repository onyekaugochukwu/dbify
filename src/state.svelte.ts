import { createEngine, ENGINE_META, type Engine, type EngineId, type StatementResult, type TableData, type TableInfo } from './engines';
import { isReadOnly, splitStatements } from './engines/sql-split';
import { parseFile, tableNameFromFile } from './lib/import-file';
import { loadSaved, saveBytes, clearSaved, loadJson, saveJson } from './lib/persist';
import { downloadBytes } from './lib/download';
import { compareResults, type CheckOutcome } from './lib/check';
import { exercises, type Exercise } from './lessons/exercises';
import sample from './lessons/naija-mart.json';

export const ENGINE_IDS: EngineId[] = ['sqlite', 'duckdb', 'postgres'];

export interface EngineState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error?: string;
  schema: TableInfo[];
  busy?: string;
  lastSaved?: number;
}

export interface QueryTab {
  id: string;
  title: string;
  engine: EngineId;
  sql: string;
  results: StatementResult[] | null;
  running: boolean;
  activeResult: number;
  view: 'results' | 'messages';
  exerciseId?: string;
  /** Character offset of the text that was run, so errors can be underlined. */
  runOffset: number;
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

let tabCounter = 0;
const newId = () => `t${Date.now().toString(36)}${(tabCounter++).toString(36)}`;

class AppState {
  engines = $state<Record<EngineId, EngineState>>({
    sqlite: { status: 'idle', schema: [] },
    duckdb: { status: 'idle', schema: [] },
    postgres: { status: 'idle', schema: [] },
  });
  tabs = $state<QueryTab[]>([]);
  activeTabId = $state<string | null>(null);
  panel = $state<'explorer' | 'lessons' | 'help'>('explorer');
  settings = $state<Settings>(loadJson('settings', { upperKeywords: true, theme: 'dark', fontSize: 14, defaultEngine: 'sqlite' }));
  toasts = $state<Toast[]>([]);
  completed = $state<Record<string, boolean>>(loadJson('completed', {}));
  checks = $state<Record<string, CheckOutcome>>({});

  private instances = new Map<EngineId, Promise<Engine>>();
  private saveTimers = new Map<EngineId, ReturnType<typeof setTimeout>>();
  private toastId = 0;

  get activeTab(): QueryTab | undefined {
    return this.tabs.find((t) => t.id === this.activeTabId);
  }

  /* ---------------- startup ---------------- */

  async start() {
    const saved = loadJson<{ tabs: Pick<QueryTab, 'id' | 'title' | 'engine' | 'sql' | 'exerciseId'>[]; active: string | null; started: boolean }>('workspace', {
      tabs: [],
      active: null,
      started: false,
    });
    this.tabs = saved.tabs.map((t) => this.makeTab(t));
    this.activeTabId = saved.tabs.some((t) => t.id === saved.active) ? saved.active : (this.tabs[0]?.id ?? null);

    // Start engines that have saved databases, so the explorer shows their tables.
    const has = await Promise.all(ENGINE_IDS.map(async (id) => [id, !!(await loadSaved(id))] as const));
    const toStart = new Set(has.filter(([, v]) => v).map(([id]) => id));
    this.tabs.forEach((t) => toStart.add(t.engine));

    if (!saved.started) {
      // First visit: load the sample into SQLite and open a starter query.
      await this.loadSample('sqlite', true);
      this.newTab('sqlite', STARTER_SQL, 'Welcome');
      this.persistWorkspace(true);
    }
    for (const id of toStart) this.ensureEngine(id).catch(() => {});
  }

  /* ---------------- engines ---------------- */

  ensureEngine(id: EngineId): Promise<Engine> {
    if (!this.instances.has(id)) {
      this.engines[id].status = 'loading';
      this.engines[id].error = undefined;
      const p = (async () => {
        const engine = await createEngine(id);
        let saved = await loadSaved(id);
        try {
          await engine.init(saved);
        } catch (e) {
          if (!saved) throw e;
          // A corrupt autosave must not lock the user out: start empty instead.
          console.warn('Could not restore saved database', e);
          await clearSaved(id);
          await engine.reset();
          this.toast('error', `Your saved ${ENGINE_META[id].label} database could not be restored, so it was started empty.`);
          saved = null;
        }
        this.engines[id].status = 'ready';
        await this.refreshSchema(id, engine);
        return engine;
      })();
      p.catch((e) => {
        this.engines[id].status = 'error';
        this.engines[id].error = String(e?.message ?? e);
        this.instances.delete(id);
      });
      this.instances.set(id, p);
    }
    return this.instances.get(id)!;
  }

  async refreshSchema(id: EngineId, engine?: Engine) {
    try {
      const e = engine ?? (await this.ensureEngine(id));
      this.engines[id].schema = await e.schema();
    } catch (e) {
      console.warn('schema', e);
    }
  }

  private scheduleSave(id: EngineId) {
    clearTimeout(this.saveTimers.get(id));
    this.saveTimers.set(
      id,
      setTimeout(async () => {
        try {
          const engine = await this.ensureEngine(id);
          const bytes = await engine.exportBytes();
          if (await saveBytes(id, bytes)) this.engines[id].lastSaved = Date.now();
        } catch (e) {
          console.warn('autosave failed', e);
        }
      }, 1200),
    );
  }

  /* ---------------- tabs ---------------- */

  private makeTab(t: Partial<QueryTab> & Pick<QueryTab, 'engine' | 'sql'>): QueryTab {
    return {
      id: t.id ?? newId(),
      title: t.title ?? 'Query',
      engine: t.engine,
      sql: t.sql,
      exerciseId: t.exerciseId,
      results: null,
      running: false,
      activeResult: 0,
      view: 'results',
      runOffset: 0,
    };
  }

  newTab(engine: EngineId = this.settings.defaultEngine, sql = '', title?: string, exerciseId?: string): QueryTab {
    const n = this.tabs.filter((t) => /^Query \d+$/.test(t.title)).length + 1;
    const tab = this.makeTab({ engine, sql, title: title ?? `Query ${n}`, exerciseId });
    this.tabs.push(tab);
    this.activeTabId = tab.id;
    this.ensureEngine(engine).catch(() => {});
    this.persistWorkspace();
    return this.tabs[this.tabs.length - 1];
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
        tabs: this.tabs.map(({ id, title, engine, sql, exerciseId }) => ({ id, title, engine, sql, exerciseId })),
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

  async run(tab: QueryTab, text: string, offset: number) {
    if (tab.running) return;
    if (!splitStatements(text).length) {
      this.toast('info', 'There is no SQL to run yet.');
      return;
    }
    tab.running = true;
    tab.runOffset = offset;
    try {
      const engine = await this.ensureEngine(tab.engine);
      const results = await engine.run(text);
      tab.results = results;
      const lastRows = results.map((r, i) => (r.result ? i : -1)).filter((i) => i >= 0);
      const failed = results.some((r) => r.error);
      tab.activeResult = lastRows.length ? lastRows[lastRows.length - 1] : 0;
      tab.view = failed || !lastRows.length ? 'messages' : 'results';
      if (results.some((r) => !r.error && !isReadOnly(r.sql))) {
        await this.refreshSchema(tab.engine, engine);
        this.scheduleSave(tab.engine);
      }
    } catch (e: any) {
      tab.results = [{ sql: text, offset: 0, ms: 0, error: String(e?.message ?? e) }];
      tab.view = 'messages';
    } finally {
      tab.running = false;
    }
  }

  /* ---------------- data in and out ---------------- */

  async importFiles(id: EngineId, files: File[]) {
    if (!files.length) return;
    const engine = await this.ensureEngine(id);
    this.engines[id].busy = 'Importing…';
    try {
      for (const file of files) {
        const existing = new Set(this.engines[id].schema.map((t) => t.name));
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
        await this.refreshSchema(id, engine);
        const counts = created.map((n) => `${n} (${this.engines[id].schema.find((t) => t.name === n)?.rowCount ?? '?'} rows)`);
        this.toast('success', `Imported ${file.name} into ${ENGINE_META[id].label} as ${counts.join(', ')}.`);
        if (created.length) this.newTab(id, `SELECT *\nFROM ${created[0]}\nLIMIT 100;`, created[0]);
        const tab = this.activeTab;
        if (tab) this.run(tab, tab.sql, 0);
      }
      this.scheduleSave(id);
    } catch (e: any) {
      this.toast('error', `Import failed: ${e?.message ?? e}`);
    } finally {
      this.engines[id].busy = undefined;
    }
  }

  async loadSample(id: EngineId, quiet = false) {
    const engine = await this.ensureEngine(id);
    this.engines[id].busy = 'Loading sample…';
    try {
      const names = (sample.tables as TableData[]).map((t) => t.name);
      const clash = this.engines[id].schema.filter((t) => names.includes(t.name));
      if (clash.length) {
        // Drop in reverse dependency order so foreign keys don't block it.
        for (const n of [...names].reverse()) if (clash.some((t) => t.name === n)) await engine.run(`DROP TABLE IF EXISTS ${n}`);
      }
      await engine.createTables(sample.tables as TableData[]);
      await this.refreshSchema(id, engine);
      this.scheduleSave(id);
      if (!quiet) this.toast('success', `Loaded the ${sample.name} sample database into ${ENGINE_META[id].label}.`);
    } catch (e: any) {
      this.toast('error', `Could not load the sample: ${e?.message ?? e}`);
    } finally {
      this.engines[id].busy = undefined;
    }
  }

  async saveDatabaseFile(id: EngineId) {
    const engine = await this.ensureEngine(id);
    this.engines[id].busy = 'Saving…';
    try {
      const bytes = await engine.exportBytes();
      const stamp = new Date().toISOString().slice(0, 10);
      downloadBytes(bytes, `dbify-${id}-${stamp}${ENGINE_META[id].fileExt}`);
    } catch (e: any) {
      this.toast('error', `Could not save: ${e?.message ?? e}`);
    } finally {
      this.engines[id].busy = undefined;
    }
  }

  async openDatabaseFile(id: EngineId, file: File) {
    const engine = await this.ensureEngine(id);
    this.engines[id].busy = 'Opening…';
    try {
      await engine.importBytes(new Uint8Array(await file.arrayBuffer()));
      await this.refreshSchema(id, engine);
      this.scheduleSave(id);
      this.toast('success', `Opened ${file.name} in ${ENGINE_META[id].label}.`);
    } catch (e: any) {
      this.toast('error', `Could not open ${file.name}: ${e?.message ?? e}`);
      await engine.reset().catch(() => {});
      await this.refreshSchema(id, engine);
    } finally {
      this.engines[id].busy = undefined;
    }
  }

  async resetEngine(id: EngineId) {
    const engine = await this.ensureEngine(id);
    await engine.reset();
    await clearSaved(id);
    await this.refreshSchema(id, engine);
    this.toast('info', `${ENGINE_META[id].label} database cleared.`);
  }

  /* ---------------- exercises ---------------- */

  openExercise(ex: Exercise, engine: EngineId) {
    const existing = this.tabs.find((t) => t.exerciseId === ex.id);
    if (existing) {
      this.activeTabId = existing.id;
      return;
    }
    const prompt = ex.prompt.replace(/(.{1,78})(\s|$)/g, '-- $1\n');
    this.newTab(engine, `-- Exercise: ${ex.title}\n${prompt}\n`, ex.title, ex.id);
  }

  async checkExercise(ex: Exercise, tab: QueryTab) {
    const engine = await this.ensureEngine(tab.engine);
    const mine = await engine.run(tab.sql);
    tab.results = mine;
    tab.runOffset = 0;
    const err = mine.find((r) => r.error);
    if (err) {
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
        message: /no such table|does not exist/i.test(exp.error!) ? `Load the ${sample.name} sample into ${ENGINE_META[tab.engine].label} first (Lessons panel).` : `Could not run the reference answer: ${exp.error}`,
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

const STARTER_SQL = `-- Welcome to dbify!
-- The Naija Mart sample database is loaded. Try running this query:
-- press Ctrl+Enter (or the Run button).

SELECT category, COUNT(*) AS products, MIN(unit_price) AS cheapest
FROM products
GROUP BY category
ORDER BY products DESC;
`;
