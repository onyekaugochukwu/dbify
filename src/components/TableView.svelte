<script lang="ts">
  import Icon from './Icon.svelte';
  import ResultsGrid, { type GridEditing } from './ResultsGrid.svelte';
  import FormView from './FormView.svelte';
  import { app, type Tab } from '../state.svelte';
  import { ENGINE_META, type ResultSet } from '../engines/types';
  import { countSql, displaySql, filterCondition, ident, literal, rowIdExpression, selectSql, type PageQuery } from '../lib/sql-gen';
  import { explainError } from '../lib/friendly-errors';
  import { exportResult } from '../lib/download';

  let { tab }: { tab: Tab } = $props();

  const PAGE = 200;
  const engineId = $derived(app.engineOf(tab.dbId));
  const st = $derived(app.dbs[tab.dbId]);
  const info = $derived(st?.schema.find((t) => t.name === tab.table));
  const pkIdx = $derived(info ? info.columns.map((c, i) => (c.pk ? i : -1)).filter((i) => i >= 0) : []);
  const useRowId = $derived(!!info && info.kind === 'table' && pkIdx.length === 0);
  const editable = $derived(!!info && info.kind === 'table');

  let offset = $state(0);
  let sort = $state<{ col: number; dir: 1 | -1 } | null>(null);
  let filters = $state<string[]>([]);
  let result = $state<ResultSet | null>(null);
  let keys = $state<unknown[]>([]);
  let total = $state(0);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let edits = $state<Record<number, Record<number, unknown>>>({});
  let deleted = $state<Record<number, boolean>>({});
  let newRows = $state<unknown[][]>([]);
  let mode = $state<'grid' | 'form'>('grid');
  let formRow = $state(0);
  let selected = $state<{ r: number; c: number } | null>(null);
  let showSql = $state(false);
  let saving = $state(false);

  const query = $derived.by((): PageQuery | null => {
    if (!info) return null;
    const where = filters.map((f, i) => (info.columns[i] ? filterCondition(info.columns[i], f ?? '', engineId) : null)).filter((x): x is string => !!x);
    return {
      table: info.name,
      rowIdExpr: useRowId ? rowIdExpression(engineId) : undefined,
      where,
      orderBy: sort && info.columns[sort.col] ? { column: info.columns[sort.col].name, dir: sort.dir === 1 ? 'ASC' : 'DESC' } : undefined,
      limit: PAGE,
      offset,
    };
  });

  const pending = $derived(Object.values(edits).reduce((n, e) => n + Object.keys(e).length, 0) > 0 || Object.values(deleted).some(Boolean) || newRows.length > 0);

  const display = $derived<ResultSet | null>(
    result ? { ...result, rows: [...result.rows, ...newRows], totalRows: result.rows.length + newRows.length } : null,
  );

  async function load() {
    if (!query) return;
    loading = true;
    error = null;
    try {
      const engine = await app.ensureDb(tab.dbId);
      const r = await engine.run(`${selectSql(query)};\n${countSql(query.table, query.where)};`);
      const bad = r.find((x) => x.error);
      if (bad) {
        error = bad.error!;
        return;
      }
      let rs = r[0].result!;
      if (useRowId) {
        keys = rs.rows.map((row) => row[0]);
        rs = { ...rs, columns: rs.columns.slice(1), rows: rs.rows.map((row) => row.slice(1)) };
      } else keys = rs.rows.map((row) => pkIdx.map((i) => row[i]));
      result = rs;
      total = Number(r[1].result?.rows[0]?.[0] ?? rs.rows.length);
      edits = {};
      deleted = {};
      newRows = [];
    } catch (e: any) {
      error = String(e?.message ?? e);
    } finally {
      loading = false;
    }
  }

  // Reload whenever the query (filters, sort, page) or the table definition changes.
  let lastKey = '';
  $effect(() => {
    const key = query ? selectSql(query) + '|' + (info?.columns.map((c) => c.name + c.type).join(',') ?? '') : '';
    if (st?.status === 'ready' && key && key !== lastKey) {
      lastKey = key;
      load();
    }
  });

  function confirmDiscard() {
    return !pending || window.confirm('You have unsaved changes in this table. Discard them?');
  }

  function setSort(col: number) {
    if (!confirmDiscard()) return;
    if (!sort || sort.col !== col) sort = { col, dir: 1 };
    else if (sort.dir === 1) sort = { col, dir: -1 };
    else sort = null;
    offset = 0;
  }

  function setFilter(col: number, value: string) {
    if (!confirmDiscard()) return;
    const next = [...filters];
    next[col] = value;
    filters = next;
    offset = 0;
  }

  const editing: GridEditing = {
    get edits() {
      return edits;
    },
    get deleted() {
      return deleted;
    },
    get newFrom() {
      return result?.rows.length ?? 0;
    },
    onEdit(row: number, col: number, value: unknown) {
      if (!result) return;
      if (row >= result.rows.length) {
        newRows[row - result.rows.length][col] = value;
        (edits[row] ??= {})[col] = value;
        return;
      }
      const orig = result.rows[row][col];
      const same = value === null ? orig === null : orig !== null && String(orig) === String(value);
      if (same) {
        if (edits[row]) {
          delete edits[row][col];
          if (!Object.keys(edits[row]).length) delete edits[row];
        }
      } else (edits[row] ??= {})[col] = value;
    },
  };

  function addRow() {
    if (!result) return;
    newRows.push(result.columns.map(() => null));
    const r = result.rows.length + newRows.length - 1;
    mode === 'form' ? (formRow = r) : (selected = { r, c: 0 });
  }

  function toggleDelete() {
    if (!result) return;
    const r = mode === 'form' ? formRow : selected?.r;
    if (r === undefined) return app.toast('info', 'Click a row first, then press Delete row.');
    if (r >= result.rows.length) {
      newRows.splice(r - result.rows.length, 1);
      delete edits[r];
      return;
    }
    deleted[r] = !deleted[r];
  }

  function setNull() {
    const s = mode === 'grid' ? selected : null;
    if (!s) return app.toast('info', 'Select a cell first.');
    editing.onEdit(s.r, s.c, null);
  }

  function keyCondition(row: number): string {
    const k = keys[row];
    if (useRowId) return engineId === 'postgres' ? `ctid = ${literal(String(k), 'text', engineId)}` : `rowid = ${k}`;
    return pkIdx.map((ci, j) => `${ident(info!.columns[ci].name)} = ${literal((k as unknown[])[j], info!.columns[ci].type, engineId)}`).join(' AND ');
  }

  const changeSql = $derived.by((): string[] => {
    if (!info || !result) return [];
    const out: string[] = [];
    const t = ident(info.name);
    for (const [r, cols] of Object.entries(edits)) {
      const row = Number(r);
      if (row >= result.rows.length || deleted[row]) continue;
      const sets = Object.entries(cols).map(([c, v]) => `${ident(info.columns[+c].name)} = ${literal(v, info.columns[+c].type, engineId)}`);
      if (sets.length) out.push(`UPDATE ${t}\nSET ${sets.join(', ')}\nWHERE ${keyCondition(row)};`);
    }
    for (const [r, d] of Object.entries(deleted)) if (d) out.push(`DELETE FROM ${t}\nWHERE ${keyCondition(Number(r))};`);
    for (const row of newRows) {
      const cols = info.columns.map((c, i) => ({ c, v: row[i] })).filter((x) => x.v !== null && x.v !== undefined);
      out.push(
        cols.length
          ? `INSERT INTO ${t} (${cols.map((x) => ident(x.c.name)).join(', ')})\nVALUES (${cols.map((x) => literal(x.v, x.c.type, engineId)).join(', ')});`
          : `INSERT INTO ${t} DEFAULT VALUES;`,
      );
    }
    return out;
  });

  async function save() {
    if (!changeSql.length) return;
    saving = true;
    try {
      const engine = await app.ensureDb(tab.dbId);
      const r = await engine.run(`BEGIN;\n${changeSql.join('\n')}\nCOMMIT;`);
      const bad = r.find((x) => x.error);
      if (bad) {
        await engine.run('ROLLBACK;').catch(() => {});
        const f = explainError(engineId, bad.error!, st.schema);
        app.toast('error', `Nothing was saved. ${f.message.replace(/`/g, '')}${f.hint ? ' ' + f.hint.replace(/`/g, '') : ''}`);
        return;
      }
      app.toast('success', `Saved ${changeSql.length} change${changeSql.length === 1 ? '' : 's'} to ${info?.name}.`);
      await app.afterChange(tab.dbId, engine);
      lastKey = '';
      await load();
    } finally {
      saving = false;
    }
  }

  function discard() {
    edits = {};
    deleted = {};
    newRows = [];
  }

  function openAsQuery(sql: string) {
    app.newQuery(tab.dbId, sql, `${tab.table} SQL`);
  }

  function page(delta: number) {
    if (!confirmDiscard()) return;
    offset = Math.max(0, offset + delta * PAGE);
  }
</script>

<div class="tv">
  <div class="toolbar">
    <span class="title"><Icon name={info?.kind === 'view' ? 'view' : 'table'} size={15} /> {tab.table}</span>
    <span class="db">{app.db(tab.dbId)?.name} · {ENGINE_META[engineId].label}</span>
    <span class="sep"></span>
    <button class="btn ghost" onclick={() => confirmDiscard() && ((lastKey = ''), load())} title="Reload rows"><Icon name="refresh" size={14} /></button>
    {#if editable}
      <button class="btn" onclick={addRow}><Icon name="plus" size={14} /> Add row</button>
      <button class="btn" onclick={toggleDelete} title="Mark the selected row for deletion"><Icon name="trash" size={14} /> Delete row</button>
      <button class="btn ghost" onclick={setNull} title="Set the selected cell to NULL" disabled={mode !== 'grid'}>NULL</button>
    {/if}
    <span class="grow"></span>
    <div class="seg" role="radiogroup" aria-label="View">
      <button class:on={mode === 'grid'} onclick={() => (mode = 'grid')} role="radio" aria-checked={mode === 'grid'}>Grid</button>
      <button class:on={mode === 'form'} onclick={() => { formRow = selected?.r ?? 0; mode = 'form'; }} role="radio" aria-checked={mode === 'form'}>Form</button>
    </div>
    <button class="btn ghost" class:on={showSql} onclick={() => (showSql = !showSql)} title="Show the SQL behind this view"><Icon name="type" size={14} /> SQL</button>
    {#if display}
      <button class="btn ghost" onclick={() => exportResult(display, 'csv', tab.table ?? 'table')} title="Export these rows as CSV"><Icon name="download" size={14} /></button>
    {/if}
  </div>

  {#if !editable && info}
    <div class="banner">This is a view, so its rows can't be edited directly. Edit the tables it reads from instead.</div>
  {:else if useRowId && editable}
    <div class="banner subtle">This table has no primary key, so dbify identifies rows by their internal {engineId === 'postgres' ? 'ctid' : 'rowid'}. Adding a primary key is good practice.</div>
  {/if}

  {#if showSql && query}
    <div class="sqlbox">
      <div class="sqlhead">
        <span>The SQL behind this view</span>
        <button class="linkish" onclick={() => openAsQuery(displaySql(query))}>Open as a query</button>
      </div>
      <pre>{displaySql(query)}</pre>
      {#if changeSql.length}
        <div class="sqlhead"><span>Your unsaved changes, as SQL</span><button class="linkish" onclick={() => openAsQuery(changeSql.join('\n\n'))}>Open as a query</button></div>
        <pre>{changeSql.join('\n\n')}</pre>
      {/if}
    </div>
  {/if}

  <div class="body">
    {#if error}
      {@const f = explainError(engineId, error, st?.schema ?? [])}
      <div class="error"><b>{f.message.replace(/`/g, '')}</b>{#if f.hint}<br />{f.hint.replace(/`/g, '')}{/if}<details><summary>Original error</summary><pre>{error}</pre></details></div>
    {:else if !info}
      <div class="empty">{st?.status === 'ready' ? `The table ${tab.table} no longer exists.` : 'Loading…'}</div>
    {:else if display}
      {#if mode === 'grid'}
        <ResultsGrid
          result={display}
          serverSort
          {sort}
          onSort={setSort}
          {filters}
          onFilter={setFilter}
          editing={editable ? editing : undefined}
          bind:selected
          onOpenRow={(r) => {
            formRow = r;
            mode = 'form';
          }}
        />
      {:else}
        <FormView result={display} bind:row={formRow} editing={editable ? editing : undefined} />
      {/if}
    {:else}
      <div class="empty">Loading…</div>
    {/if}
  </div>

  <div class="footer">
    {#if pending}
      <span class="pending">{changeSql.length} unsaved change{changeSql.length === 1 ? '' : 's'}</span>
      <button class="btn primary small" onclick={save} disabled={saving}><Icon name="save" size={13} /> {saving ? 'Saving…' : 'Save changes'}</button>
      <button class="btn small" onclick={discard}>Discard</button>
      <button class="linkish small" onclick={() => (showSql = true)}>See the SQL</button>
    {:else if editable}
      <span class="hint">Double-click a cell (or start typing) to edit. Enter saves the cell, Esc cancels.</span>
    {/if}
    <span class="grow"></span>
    {#if loading}<span class="hint">Loading…</span>{/if}
    {#if result}
      <span class="range">
        {total ? `${(offset + 1).toLocaleString()}–${Math.min(offset + result.rows.length, total).toLocaleString()} of ${total.toLocaleString()}` : '0 rows'}
        {#if filters.some(Boolean)}(filtered){/if}
      </span>
      <button class="btn ghost small" disabled={offset === 0} onclick={() => page(-1)}>‹</button>
      <button class="btn ghost small" disabled={offset + PAGE >= total} onclick={() => page(1)}>›</button>
    {/if}
  </div>
</div>

<style>
  .tv {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    flex-wrap: wrap;
  }
  .title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
  }
  .db {
    font-size: 12px;
    color: var(--text-faint);
  }
  .sep {
    width: 1px;
    height: 20px;
    background: var(--border);
    margin: 0 4px;
  }
  .grow {
    flex: 1;
  }
  .btn.on {
    color: var(--accent);
  }
  .seg {
    display: flex;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }
  .seg button {
    background: var(--input-bg);
    color: var(--text-dim);
    border: none;
    padding: 5px 12px;
    font: inherit;
    font-size: 12.5px;
    cursor: pointer;
  }
  .seg button.on {
    background: var(--accent-strong);
    color: #fff;
  }
  .banner {
    font-size: 12.5px;
    padding: 7px 12px;
    background: var(--warn-bg);
    color: var(--warn-text);
  }
  .banner.subtle {
    background: var(--panel-2);
    color: var(--text-dim);
  }
  .sqlbox {
    border-bottom: 1px solid var(--border);
    background: var(--panel-2);
    padding: 6px 12px 10px;
    max-height: 40%;
    overflow: auto;
  }
  .sqlhead {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: var(--text-dim);
    margin-top: 6px;
  }
  .sqlbox pre {
    margin: 4px 0 0;
    font-family: var(--mono);
    font-size: 12.5px;
    white-space: pre-wrap;
    color: var(--text);
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .error {
    margin: 16px;
    padding: 12px 14px;
    border-radius: 8px;
    background: var(--warn-bg);
    color: var(--warn-text);
    font-size: 13.5px;
    line-height: 1.5;
  }
  .error pre {
    white-space: pre-wrap;
    font-size: 12px;
  }
  .empty {
    padding: 28px;
    text-align: center;
    color: var(--text-dim);
  }
  .footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-top: 1px solid var(--border);
    background: var(--panel);
    font-size: 12.5px;
    min-height: 38px;
  }
  .pending {
    color: var(--warn-text);
    font-weight: 600;
  }
  .hint {
    color: var(--text-faint);
  }
  .range {
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
  .linkish {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    padding: 0;
    font: inherit;
    font-size: 12px;
    text-decoration: underline;
  }
</style>
