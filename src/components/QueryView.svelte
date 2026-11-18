<script lang="ts">
  import { format } from 'sql-formatter';
  import type { Diagnostic } from '@codemirror/lint';
  import Editor, { type EditorApi } from './Editor.svelte';
  import ResultsGrid from './ResultsGrid.svelte';
  import FormView from './FormView.svelte';
  import Icon from './Icon.svelte';
  import { app, ENGINE_IDS, exercises } from '../state.svelte';
  import { shareUrl } from '../lib/share';
  import { ENGINE_META, type StatementResult } from '../engines/types';
  import { explainError } from '../lib/friendly-errors';
  import { exportResult, downloadBytes, pickFile } from '../lib/download';
  import type { Tab } from '../state.svelte';

  let { tab }: { tab: Tab } = $props();

  let editor: Editor | undefined = $state();
  let api: EditorApi | undefined = $state();
  let split = $state(46); // editor height in %
  let container: HTMLDivElement;
  let exportOpen = $state(false);
  let search = $state('');
  let resultMode = $state<'grid' | 'form'>('grid');
  let formRow = $state(0);
  let selectedCell = $state<{ r: number; c: number } | null>(null);

  const engineId = $derived(app.engineOf(tab.dbId));
  const engineState = $derived(app.dbs[tab.dbId] ?? { status: 'idle' as const, schema: [] });
  const schema = $derived(engineState.schema);
  const results = $derived(tab.results ?? []);
  const rowResults = $derived(results.map((r, i) => ({ r, i })).filter((x) => x.r.result));
  const current = $derived(results[tab.activeResult]?.result);
  const failed = $derived(results.find((r) => r.error));
  const totalMs = $derived(results.reduce((a, r) => a + r.ms, 0));
  const exercise = $derived(tab.exerciseId ? exercises.find((e) => e.id === tab.exerciseId) : undefined);

  function explain(r: StatementResult) {
    return explainError(engineId, r.error ?? '', schema, r.errorPosition);
  }

  // Underline the error in the editor.
  const diagnostics = $derived.by((): Diagnostic[] => {
    if (!failed) return [];
    const f = explain(failed);
    const base = tab.runOffset + failed.offset;
    const stmt = failed.sql;
    let from = base, to = base + Math.min(stmt.length, stmt.indexOf('\n') === -1 ? stmt.length : stmt.indexOf('\n'));
    if (f.position && f.position > 0 && f.position <= stmt.length) {
      from = base + f.position - 1;
      const m = /^[\w$."']+/.exec(stmt.slice(f.position - 1));
      to = from + Math.max(1, m?.[0].length ?? 1);
    } else if (f.token) {
      const esc = f.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const m = new RegExp(`(^|[^\\w])(${esc})(?![\\w])`, 'i').exec(stmt);
      if (m) {
        from = base + m.index + m[1].length;
        to = from + m[2].length;
      }
    }
    return [{ from, to, severity: 'error', message: f.message + (f.hint ? '\n' + f.hint.replace(/`/g, '') : '') }];
  });

  function runAll() {
    editor?.run('auto');
  }

  function doFormat() {
    try {
      const lang = engineId === 'postgres' ? 'postgresql' : engineId === 'duckdb' ? 'duckdb' : 'sqlite';
      const out = format(tab.sql, { language: lang as any, keywordCase: app.settings.upperKeywords ? 'upper' : 'preserve', tabWidth: 2 });
      api?.replaceAll(out);
    } catch (e: any) {
      app.toast('error', 'Could not format: the SQL has a syntax error. ' + (e?.message ?? '').split('\n')[0]);
    }
  }

  async function openSql() {
    const [f] = await pickFile('.sql,.txt');
    if (!f) return;
    tab.sql = await f.text();
    tab.title = f.name.replace(/\.[^.]+$/, '');
    app.persistWorkspace();
  }

  async function copyLink() {
    const url = shareUrl({ engine: engineId, sql: tab.sql, sample: !!app.db(tab.dbId)?.sample, title: tab.title });
    try {
      await navigator.clipboard.writeText(url);
      app.toast('success', 'Link copied. Anyone who opens it gets this query in dbify' + (app.db(tab.dbId)?.sample ? ', with the sample database.' : '.'));
    } catch {
      window.prompt('Copy this link:', url);
    }
  }

  function saveSql() {
    downloadBytes(tab.sql, `${tab.title.replace(/[^\w-]+/g, '_') || 'query'}.sql`, 'text/plain');
  }

  function startDrag(e: PointerEvent) {
    const rect = container.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      split = Math.max(15, Math.min(85, ((ev.clientY - rect.top) / rect.height) * 100));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    e.preventDefault();
  }

  function fmtMs(ms: number) {
    return ms < 1000 ? `${Math.max(1, Math.round(ms))} ms` : `${(ms / 1000).toFixed(2)} s`;
  }

  function firstLine(sql: string) {
    const l = sql.replace(/--[^\n]*\n/g, '').trim().split('\n')[0];
    return l.length > 90 ? l.slice(0, 90) + '…' : l;
  }

  function richText(s: string) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/`([^`]+)`/g, '<code>$1</code>');
  }
</script>

<div class="query" bind:this={container}>
  <div class="toolbar">
    <button class="btn primary" onclick={runAll} disabled={tab.running} title="Run (Ctrl+Enter). Runs the selection if you have selected text.">
      <Icon name="play" size={14} />
      {tab.running ? 'Running…' : 'Run'}
    </button>
    <button class="btn" onclick={() => editor?.run('statement')} disabled={tab.running} title="Run only the statement under the cursor (Ctrl+Shift+Enter)">
      <Icon name="statement" size={14} /> Run statement
    </button>
    <button class="btn" onclick={doFormat} title="Format SQL (Shift+Alt+F)"><Icon name="format" size={14} /> Format</button>
    <span class="sep"></span>
    <button class="btn ghost" onclick={openSql} title="Open a .sql file"><Icon name="folder" size={14} /></button>
    <button class="btn ghost" onclick={saveSql} title="Download this query as a .sql file"><Icon name="save" size={14} /></button>
    <button class="btn ghost" onclick={copyLink} title="Copy a link that opens this query in dbify"><Icon name="link" size={14} /></button>
    <span class="grow"></span>
    {#if exercise && exercise.checkable !== false}
      <button class="btn check" onclick={() => app.checkExercise(exercise, tab)}><Icon name="check" size={14} /> Check answer</button>
    {/if}
    <label class="engine-pick" title="The database this query runs on">
      <span class="dot {engineState.status}"></span>
      <span class="eng {engineId}">{ENGINE_META[engineId].short}</span>
      <select
        value={tab.dbId}
        onchange={(e) => {
          tab.dbId = (e.currentTarget as HTMLSelectElement).value;
          tab.results = null;
          app.ensureDb(tab.dbId).catch(() => {});
          app.persistWorkspace();
        }}
      >
        {#each ENGINE_IDS as id}
          {#if app.dbsOf(id).length}
            <optgroup label={ENGINE_META[id].label}>
              {#each app.dbsOf(id) as d}<option value={d.id}>{d.name}</option>{/each}
            </optgroup>
          {/if}
        {/each}
      </select>
    </label>
  </div>

  {#if exercise && app.checks[exercise.id]}
    {@const c = app.checks[exercise.id]}
    <div class="check-banner" class:ok={c.ok}>
      <Icon name={c.ok ? 'check' : 'info'} size={15} />
      {c.message}
    </div>
  {/if}

  <div class="editor-wrap" style="height:{split}%">
    {#key tab.id}
      <Editor
        bind:this={editor}
        bind:api
        doc={tab.sql}
        engine={engineId}
        {schema}
        dark={app.settings.theme === 'dark'}
        upperKeywords={app.settings.upperKeywords}
        fontSize={app.settings.fontSize}
        {diagnostics}
        onChange={(d) => {
          tab.sql = d;
          app.persistWorkspace();
        }}
        onRun={(text, offset) => app.run(tab, text, offset)}
        onFormat={doFormat}
      />
    {/key}
    {#if engineState.status === 'loading'}
      <div class="engine-loading">Starting {ENGINE_META[engineId].label}…</div>
    {:else if engineState.status === 'error'}
      <div class="engine-loading err">{ENGINE_META[engineId].label} failed to start: {engineState.error}</div>
    {/if}
  </div>

  <div class="splitter" onpointerdown={startDrag} role="separator" aria-orientation="horizontal" aria-label="Resize editor"></div>

  <div class="results">
    <div class="rtabs">
      <button class="rtab" class:on={tab.view === 'results'} onclick={() => (tab.view = 'results')}>
        Results{#if rowResults.length}<span class="n">{current ? current.totalRows.toLocaleString() : 0}</span>{/if}
      </button>
      <button class="rtab" class:on={tab.view === 'messages'} class:bad={!!failed} onclick={() => (tab.view = 'messages')}>
        Messages{#if results.length}<span class="n">{results.length}</span>{/if}
        {#if failed}<span class="badge">!</span>{/if}
      </button>
      {#if tab.view === 'results' && rowResults.length > 1}
        <span class="sep"></span>
        {#each rowResults as { i }, k}
          <button class="chip" class:on={tab.activeResult === i} onclick={() => (tab.activeResult = i)}>Result {k + 1}</button>
        {/each}
      {/if}
      <span class="grow"></span>
      {#if current && tab.view === 'results'}
        <input class="search" placeholder="Search rows…" bind:value={search} aria-label="Search the result rows" />
        <div class="seg" role="radiogroup" aria-label="Result view">
          <button class:on={resultMode === 'grid'} role="radio" aria-checked={resultMode === 'grid'} onclick={() => (resultMode = 'grid')}>Grid</button>
          <button class:on={resultMode === 'form'} role="radio" aria-checked={resultMode === 'form'} onclick={() => { formRow = selectedCell?.r ?? 0; resultMode = 'form'; }}>Form</button>
        </div>
      {/if}
      {#if results.length}
        <span class="status">{fmtMs(totalMs)}</span>
      {/if}
      {#if current && tab.view === 'results'}
        <div class="export">
          <button class="btn ghost small" onclick={() => (exportOpen = !exportOpen)}><Icon name="download" size={13} /> Export</button>
          {#if exportOpen}
            <div class="menu" role="menu">
              {#each ['csv', 'json', 'xlsx'] as f}
                <button
                  role="menuitem"
                  onclick={() => {
                    exportOpen = false;
                    exportResult(current, f as 'csv' | 'json' | 'xlsx', tab.title.replace(/[^\w-]+/g, '_'));
                  }}>{f.toUpperCase()}{f === 'xlsx' ? ' (Excel)' : ''}</button
                >
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <div class="rbody">
      {#if tab.view === 'results'}
        {#if current}
          {#if current.truncated}
            <div class="note">Showing the first {current.rows.length.toLocaleString()} of {current.totalRows.toLocaleString()} rows. Add LIMIT, or export to get everything.</div>
          {/if}
          {#if resultMode === 'grid'}
            <ResultsGrid result={current} quickFilter={search} bind:selected={selectedCell} onOpenRow={(r) => { formRow = r; resultMode = 'form'; }} />
          {:else}
            <FormView result={current} bind:row={formRow} />
          {/if}
        {:else if tab.running}
          <div class="placeholder">Running…</div>
        {:else if failed}
          <div class="placeholder">The query failed. See <button class="linkish" onclick={() => (tab.view = 'messages')}>Messages</button> for what went wrong.</div>
        {:else if results.length}
          <div class="placeholder">Done. The statements ran but none returned rows.</div>
        {:else}
          <div class="placeholder">
            Press <kbd>Ctrl</kbd>+<kbd>Enter</kbd> to run. <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd> runs just the statement under the cursor.
          </div>
        {/if}
      {:else}
        <div class="messages">
          {#each results as r}
            <div class="msg" class:err={!!r.error}>
              <span class="mi"><Icon name={r.error ? 'warning' : 'check'} size={14} /></span>
              <div class="mbody">
                <code class="msql">{firstLine(r.sql)}</code>
                {#if r.error}
                  {@const f = explain(r)}
                  <div class="friendly">{@html richText(f.message)}</div>
                  {#if f.hint}<div class="hint"><Icon name="lightbulb" size={13} /> {@html richText(f.hint)}</div>{/if}
                  <details>
                    <summary>Original error from {ENGINE_META[engineId].label}</summary>
                    <pre>{r.error}</pre>
                  </details>
                {:else if r.result}
                  <div class="mmeta">{r.result.totalRows.toLocaleString()} row{r.result.totalRows === 1 ? '' : 's'} returned · {fmtMs(r.ms)}</div>
                {:else}
                  <div class="mmeta">
                    {r.rowsAffected ? `${r.rowsAffected.toLocaleString()} row${r.rowsAffected === 1 ? '' : 's'} affected` : 'Done'} · {fmtMs(r.ms)}
                  </div>
                {/if}
              </div>
            </div>
          {:else}
            <div class="placeholder">Nothing has run yet.</div>
          {/each}
          {#if failed && results.indexOf(failed) < results.length - 1}
            <div class="mmeta">Statements after the error were not run.</div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>

<svelte:window onclick={(e) => { if (exportOpen && !(e.target as HTMLElement).closest('.export')) exportOpen = false; }} />

<style>
  .query {
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
  .sep {
    width: 1px;
    height: 20px;
    background: var(--border);
    margin: 0 4px;
  }
  .grow {
    flex: 1;
  }
  .engine-pick {
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--input-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0 4px 0 10px;
  }
  .engine-pick select {
    background: transparent;
    color: var(--text);
    border: none;
    padding: 6px 4px;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .engine-pick select option {
    background: var(--panel);
  }
  .search {
    width: 160px;
    padding: 4px 8px;
    font-size: 12.5px;
    margin-right: 6px;
  }
  .seg {
    display: flex;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
    margin-right: 8px;
  }
  .seg button {
    background: var(--input-bg);
    color: var(--text-dim);
    border: none;
    padding: 3px 10px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .seg button.on {
    background: var(--accent-strong);
    color: #fff;
  }
  .check-banner {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 8px 14px;
    background: var(--warn-bg);
    color: var(--warn-text);
    border-bottom: 1px solid var(--border);
    font-size: 13.5px;
  }
  .check-banner.ok {
    background: var(--ok-bg);
    color: var(--ok-text);
  }
  .editor-wrap {
    position: relative;
    min-height: 60px;
  }
  .engine-loading {
    position: absolute;
    right: 12px;
    bottom: 10px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 12.5px;
    color: var(--text-dim);
  }
  .engine-loading.err {
    color: var(--danger);
  }
  .splitter {
    height: 6px;
    cursor: row-resize;
    background: var(--border);
    border-top: 2px solid var(--bg);
    border-bottom: 2px solid var(--bg);
    flex: none;
  }
  .splitter:hover {
    background: var(--accent);
  }
  .results {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .rtabs {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 8px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    min-height: 38px;
  }
  .rtab {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-dim);
    padding: 9px 12px 7px;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .rtab.on {
    color: var(--text);
    border-bottom-color: var(--accent);
  }
  .n {
    font-size: 11px;
    background: var(--input-bg);
    color: var(--text-dim);
    padding: 0 6px;
    border-radius: 8px;
    font-variant-numeric: tabular-nums;
  }
  .badge {
    background: var(--danger);
    color: #fff;
    border-radius: 8px;
    font-size: 10px;
    padding: 0 5px;
    font-weight: 700;
  }
  .chip {
    background: var(--input-bg);
    border: 1px solid var(--border);
    color: var(--text-dim);
    border-radius: 12px;
    padding: 2px 10px;
    font-size: 12px;
    cursor: pointer;
  }
  .chip.on {
    border-color: var(--accent);
    color: var(--text);
  }
  .status {
    color: var(--text-faint);
    font-size: 12px;
    margin-right: 6px;
  }
  .export {
    position: relative;
  }
  .menu {
    position: absolute;
    right: 0;
    top: 100%;
    z-index: 20;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 4px;
    box-shadow: var(--shadow);
    display: flex;
    flex-direction: column;
    min-width: 130px;
  }
  .menu button {
    background: none;
    border: none;
    color: var(--text);
    text-align: left;
    padding: 7px 10px;
    border-radius: 5px;
    cursor: pointer;
    font: inherit;
    font-size: 13px;
  }
  .menu button:hover {
    background: var(--row-hover);
  }
  .rbody {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .note {
    font-size: 12.5px;
    padding: 6px 12px;
    background: var(--warn-bg);
    color: var(--warn-text);
  }
  .placeholder {
    color: var(--text-dim);
    padding: 28px;
    text-align: center;
    font-size: 13.5px;
  }
  .messages {
    overflow: auto;
    padding: 8px 12px 16px;
  }
  .msg {
    display: flex;
    gap: 10px;
    padding: 10px 4px;
    border-bottom: 1px solid var(--grid-line);
  }
  .mi {
    color: var(--ok);
    padding-top: 1px;
  }
  .msg.err .mi {
    color: var(--danger);
  }
  .mbody {
    min-width: 0;
    flex: 1;
  }
  .msql {
    font-family: var(--mono);
    font-size: 12.5px;
    color: var(--text-dim);
    display: block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mmeta {
    font-size: 12.5px;
    color: var(--text-faint);
    margin-top: 3px;
  }
  .friendly {
    margin-top: 6px;
    font-size: 14px;
    color: var(--text);
  }
  .hint {
    margin-top: 6px;
    font-size: 13.5px;
    color: var(--warn-text);
    display: flex;
    gap: 6px;
    align-items: flex-start;
  }
  .friendly :global(code),
  .hint :global(code) {
    font-family: var(--mono);
    background: var(--input-bg);
    padding: 1px 5px;
    border-radius: 4px;
    font-size: 0.92em;
  }
  details {
    margin-top: 8px;
    font-size: 12.5px;
    color: var(--text-faint);
  }
  summary {
    cursor: pointer;
  }
  pre {
    white-space: pre-wrap;
    font-family: var(--mono);
    font-size: 12px;
    background: var(--input-bg);
    padding: 8px 10px;
    border-radius: 6px;
    margin: 6px 0 0;
    color: var(--text-dim);
  }
  .linkish {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font: inherit;
    padding: 0;
    text-decoration: underline;
  }
  kbd {
    font-family: var(--mono);
    font-size: 11.5px;
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: 4px;
    padding: 0 5px;
    background: var(--input-bg);
  }
</style>
