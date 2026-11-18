<script lang="ts">
  import Icon from './Icon.svelte';
  import { app, ENGINE_IDS, sample } from '../state.svelte';
  import { ENGINE_META, type EngineId, type TableInfo } from '../engines/types';
  import { IMPORT_ACCEPT } from '../lib/import-file';
  import { pickFile } from '../lib/download';

  let open = $state<Record<string, boolean>>({ sqlite: true });
  let filter = $state('');
  let menuFor = $state<EngineId | null>(null);
  let dragOver = $state<EngineId | null>(null);

  function toggleEngine(id: EngineId) {
    open[id] = !open[id];
    if (open[id]) app.ensureEngine(id).catch(() => {});
  }

  function openTable(id: EngineId, t: TableInfo) {
    app.newTab(id, `SELECT *\nFROM ${/^[a-z_][a-z0-9_]*$/.test(t.name) ? t.name : `"${t.name.replace(/"/g, '""')}"`}\nLIMIT 100;`, t.name);
    const tab = app.activeTab;
    if (tab) app.run(tab, tab.sql, 0);
  }

  const matches = (t: TableInfo) => !filter || t.name.toLowerCase().includes(filter.toLowerCase()) || t.columns.some((c) => c.name.toLowerCase().includes(filter.toLowerCase()));

  async function importInto(id: EngineId) {
    menuFor = null;
    const files = await pickFile(IMPORT_ACCEPT, true);
    if (files.length) app.importFiles(id, files);
  }

  async function openDb(id: EngineId) {
    menuFor = null;
    const accept = id === 'sqlite' ? '.sqlite,.sqlite3,.db,.db3' : id === 'duckdb' ? '.gz,.tgz,.duckdb,.db' : '.gz,.tgz,.tar';
    const [f] = await pickFile(accept);
    if (f) app.openDatabaseFile(id, f);
  }

  function reset(id: EngineId) {
    menuFor = null;
    if (confirmReset(id)) app.resetEngine(id);
  }

  function confirmReset(id: EngineId) {
    return window.confirm(`Delete every table in the ${ENGINE_META[id].label} database? This cannot be undone. (Save the database first if you want a copy.)`);
  }

  function onDrop(e: DragEvent, id: EngineId) {
    e.preventDefault();
    dragOver = null;
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) {
      open[id] = true;
      app.importFiles(id, files);
    }
  }
</script>

<div class="explorer">
  <div class="head">
    <h2>Databases</h2>
  </div>
  <div class="filter">
    <input placeholder="Filter tables and columns…" bind:value={filter} />
  </div>

  <div class="tree">
    {#each ENGINE_IDS as id}
      {@const st = app.engines[id]}
      <div
        class="engine"
        class:drop={dragOver === id}
        ondragover={(e) => {
          e.preventDefault();
          dragOver = id;
        }}
        ondragleave={() => (dragOver = null)}
        ondrop={(e) => onDrop(e, id)}
        role="group"
      >
        <div class="engine-row">
          <button class="node engine-node" onclick={() => toggleEngine(id)} aria-expanded={!!open[id]}>
            <span class="chev" class:open={open[id]}><Icon name="chevron" size={12} /></span>
            <span class="dot {st.status}" title={st.status}></span>
            <Icon name="database" size={15} />
            <span class="label">{ENGINE_META[id].label}</span>
            {#if st.status === 'ready'}<span class="count">{st.schema.length}</span>{/if}
          </button>
          <button class="more" title="Database actions" onclick={() => (menuFor = menuFor === id ? null : id)}>⋯</button>
          {#if menuFor === id}
            <div class="menu" role="menu">
              <button role="menuitem" onclick={() => { menuFor = null; app.newTab(id); }}><Icon name="plus" size={14} /> New query</button>
              <button role="menuitem" onclick={() => importInto(id)}><Icon name="upload" size={14} /> Import file (CSV, Excel, JSON, Parquet)…</button>
              <button role="menuitem" onclick={() => { menuFor = null; app.loadSample(id); }}><Icon name="sparkle" size={14} /> Load {sample.name} sample</button>
              <hr />
              <button role="menuitem" onclick={() => { menuFor = null; app.saveDatabaseFile(id); }}><Icon name="save" size={14} /> Save database to file</button>
              <button role="menuitem" onclick={() => openDb(id)}><Icon name="folder" size={14} /> Open database file…</button>
              <button role="menuitem" onclick={() => { menuFor = null; app.refreshSchema(id); }}><Icon name="refresh" size={14} /> Refresh</button>
              <hr />
              <button role="menuitem" class="danger" onclick={() => reset(id)}><Icon name="trash" size={14} /> Clear database</button>
            </div>
          {/if}
        </div>

        {#if open[id]}
          <div class="children">
            {#if st.busy}
              <div class="info">{st.busy}</div>
            {/if}
            {#if st.status === 'loading'}
              <div class="info">Starting {ENGINE_META[id].label}…</div>
            {:else if st.status === 'error'}
              <div class="info err">Could not start: {st.error}</div>
            {:else if st.status === 'ready' && st.schema.length === 0}
              <div class="info empty">
                No tables yet.
                <button class="linkish" onclick={() => importInto(id)}>Import a file</button>,
                drop one here, or
                <button class="linkish" onclick={() => app.loadSample(id)}>load the sample</button>.
              </div>
            {/if}
            {#each st.schema.filter(matches) as t (t.name)}
              <details class="table" open={!!filter}>
                <summary class="node" ondblclick={(e) => { e.preventDefault(); openTable(id, t); }} title="Double-click to view rows">
                  <span class="chev"><Icon name="chevron" size={11} /></span>
                  <Icon name={t.kind === 'view' ? 'view' : 'table'} size={14} />
                  <span class="label">{t.name}</span>
                  {#if t.rowCount !== undefined}<span class="count">{t.rowCount.toLocaleString()}</span>{/if}
                  <button class="peek" title="View rows" onclick={(e) => { e.preventDefault(); openTable(id, t); }}><Icon name="eye" size={13} /></button>
                </summary>
                <div class="cols">
                  {#each t.columns as c}
                    {@const fk = t.foreignKeys.find((f) => f.column === c.name)}
                    <div class="col" title={fk ? `References ${fk.refTable}(${fk.refColumn})` : c.type}>
                      <span class="ci" class:pk={c.pk} class:fk={!!fk}>
                        <Icon name={c.pk ? 'key' : fk ? 'link' : 'column'} size={12} />
                      </span>
                      <span class="cname">{c.name}</span>
                      <span class="ctype">{c.type.toLowerCase()}{c.notNull && !c.pk ? ' · not null' : ''}</span>
                    </div>
                  {/each}
                </div>
              </details>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>
  <p class="tip">Tip: drag a CSV, Excel, JSON or Parquet file onto a database to import it.</p>
</div>

<svelte:window onclick={(e) => { if (menuFor && !(e.target as HTMLElement).closest('.engine-row')) menuFor = null; }} />

<style>
  .explorer {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .head {
    padding: 14px 14px 6px;
  }
  h2 {
    margin: 0;
    font-size: 11.5px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-dim);
    font-weight: 700;
  }
  .filter {
    padding: 6px 12px 8px;
  }
  .filter input {
    width: 100%;
  }
  .tree {
    flex: 1;
    overflow: auto;
    padding: 0 6px 12px;
  }
  .engine {
    border-radius: 8px;
    margin-bottom: 2px;
  }
  .engine.drop {
    outline: 2px dashed var(--accent);
    background: var(--row-hover);
  }
  .engine-row {
    display: flex;
    align-items: center;
    position: relative;
  }
  .node {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    background: none;
    border: none;
    color: var(--text);
    font: inherit;
    font-size: 13.5px;
    padding: 5px 6px;
    border-radius: 6px;
    cursor: pointer;
    text-align: left;
    list-style: none;
  }
  .node::-webkit-details-marker {
    display: none;
  }
  .node:hover {
    background: var(--row-hover);
  }
  .engine-node {
    font-weight: 600;
  }
  .label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    font-size: 11px;
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }
  .chev {
    display: inline-flex;
    color: var(--text-faint);
    transition: transform 0.12s;
  }
  .chev.open,
  details[open] > summary .chev {
    transform: rotate(90deg);
  }
  .more {
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 18px;
    line-height: 1;
    padding: 2px 8px 6px;
    border-radius: 6px;
    cursor: pointer;
  }
  .more:hover {
    background: var(--row-hover);
    color: var(--text);
  }
  .menu {
    position: absolute;
    right: 0;
    top: 100%;
    z-index: 30;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 4px;
    box-shadow: var(--shadow);
    width: 270px;
  }
  .menu button {
    display: flex;
    gap: 9px;
    align-items: center;
    width: 100%;
    background: none;
    border: none;
    color: var(--text);
    text-align: left;
    padding: 7px 9px;
    border-radius: 5px;
    cursor: pointer;
    font: inherit;
    font-size: 13px;
  }
  .menu button:hover {
    background: var(--row-hover);
  }
  .menu .danger {
    color: var(--danger);
  }
  .menu hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 4px 0;
  }
  .children {
    padding-left: 16px;
  }
  .info {
    font-size: 12.5px;
    color: var(--text-dim);
    padding: 4px 8px 8px;
    line-height: 1.5;
  }
  .info.err {
    color: var(--danger);
  }
  .linkish {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    padding: 0;
    font: inherit;
    text-decoration: underline;
  }
  .table summary {
    font-size: 13px;
    padding: 4px 6px;
  }
  .peek {
    opacity: 0;
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    padding: 0 2px;
    display: inline-flex;
  }
  .table summary:hover .peek {
    opacity: 1;
  }
  .cols {
    padding: 2px 0 6px 24px;
  }
  .col {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12.5px;
    padding: 2px 4px;
    white-space: nowrap;
  }
  .ci {
    color: var(--text-faint);
    display: inline-flex;
  }
  .ci.pk {
    color: #e5b450;
  }
  .ci.fk {
    color: #5fb3e8;
  }
  .cname {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ctype {
    color: var(--text-faint);
    font-size: 11px;
    margin-left: auto;
    padding-left: 8px;
  }
  .tip {
    font-size: 11.5px;
    color: var(--text-faint);
    padding: 8px 14px 12px;
    margin: 0;
    border-top: 1px solid var(--border);
  }
</style>
