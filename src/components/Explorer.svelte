<script lang="ts">
  import Icon from './Icon.svelte';
  import { app, ENGINE_IDS } from '../state.svelte';
  import { ENGINE_META, type DbMeta, type EngineId, type TableInfo } from '../engines/types';
  import { IMPORT_ACCEPT } from '../lib/import-file';
  import { pickFile } from '../lib/download';
  import { ident } from '../lib/sql-gen';

  let openEngines = $state<Record<string, boolean>>({ sqlite: true, duckdb: true, postgres: true });
  let openDbs = $state<Record<string, boolean>>({});
  let filter = $state('');
  let menu = $state<{ kind: 'engine' | 'db'; id: string } | null>(null);
  let dragOver = $state<string | null>(null);

  // Expand the database of the active tab so students see where they are.
  $effect(() => {
    const id = app.activeTab?.dbId;
    if (id && openDbs[id] === undefined) openDbs[id] = true;
  });

  function toggleDb(d: DbMeta) {
    openDbs[d.id] = !openDbs[d.id];
    if (openDbs[d.id]) app.ensureDb(d.id).catch(() => {});
  }

  const matches = (t: TableInfo) => !filter || t.name.toLowerCase().includes(filter.toLowerCase()) || t.columns.some((c) => c.name.toLowerCase().includes(filter.toLowerCase()));

  async function importInto(d: DbMeta) {
    menu = null;
    const files = await pickFile(IMPORT_ACCEPT, true);
    if (files.length) {
      openDbs[d.id] = true;
      app.importFiles(d.id, files);
    }
  }

  async function importAsNew(engine: EngineId) {
    menu = null;
    const files = await pickFile(IMPORT_ACCEPT, true);
    if (files.length) app.importAsNewDatabase(engine, files);
  }

  async function openFile(engine: EngineId) {
    menu = null;
    const accept = engine === 'sqlite' ? '.sqlite,.sqlite3,.db,.db3' : engine === 'duckdb' ? '.gz,.tgz,.duckdb,.db' : '.gz,.tgz,.tar';
    const [f] = await pickFile(accept);
    if (f) app.openDatabaseFile(engine, f);
  }

  function action(fn: () => void) {
    menu = null;
    fn();
  }

  function onDrop(e: DragEvent, target: { db?: DbMeta; engine?: EngineId }) {
    e.preventDefault();
    e.stopPropagation();
    dragOver = null;
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (!files.length) return;
    if (target.db) {
      openDbs[target.db.id] = true;
      app.importFiles(target.db.id, files);
    } else if (target.engine) app.importAsNewDatabase(target.engine, files);
  }

  const dragProps = (key: string) => ({
    ondragover: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragOver = key;
    },
    ondragleave: () => (dragOver = null),
  });
</script>

<div class="explorer">
  <div class="head">
    <h2>Databases</h2>
    <button class="btn primary small" onclick={() => (app.dialog = { kind: 'new-database' })}><Icon name="plus" size={13} /> New</button>
  </div>
  {#if app.databases.length}
    <div class="filter"><input placeholder="Filter tables and columns…" bind:value={filter} /></div>
  {/if}

  <div class="tree">
    {#each ENGINE_IDS as engine}
      {@const dbs = app.dbsOf(engine)}
      <section class="engine" class:drop={dragOver === engine} {...dragProps(engine)} ondrop={(e) => onDrop(e, { engine })}>
        <div class="row">
          <button class="node engine-node" onclick={() => (openEngines[engine] = !openEngines[engine])} aria-expanded={!!openEngines[engine]}>
            <span class="chev" class:open={openEngines[engine]}><Icon name="chevron" size={12} /></span>
            <span class="eng {engine}">{ENGINE_META[engine].short}</span>
            <span class="label">{ENGINE_META[engine].label}</span>
            <span class="count">{dbs.length || ''}</span>
          </button>
          <button class="icon-btn" title="New {ENGINE_META[engine].label} database" onclick={() => (app.dialog = { kind: 'new-database', engine })}><Icon name="plus" size={14} /></button>
          <button class="icon-btn" title="More" onclick={() => (menu = menu?.id === engine ? null : { kind: 'engine', id: engine })}>⋯</button>
          {#if menu?.kind === 'engine' && menu.id === engine}
            <div class="menu" role="menu">
              <button role="menuitem" onclick={() => action(() => (app.dialog = { kind: 'new-database', engine }))}><Icon name="plus" size={14} /> New {ENGINE_META[engine].label} database</button>
              <button role="menuitem" onclick={() => importAsNew(engine)}><Icon name="upload" size={14} /> Import a file as a new database…</button>
              <button role="menuitem" onclick={() => openFile(engine)}><Icon name="folder" size={14} /> Open a saved database file…</button>
              <button role="menuitem" onclick={() => action(() => app.loadSample(engine))}><Icon name="sparkle" size={14} /> {app.sampleDb(engine) ? 'Reset' : 'Add'} the Naija Mart sample</button>
            </div>
          {/if}
        </div>

        {#if openEngines[engine]}
          <div class="children">
            {#if !dbs.length}
              <button class="add-db" onclick={() => (app.dialog = { kind: 'new-database', engine })}><Icon name="plus" size={13} /> New database</button>
            {/if}
            {#each dbs as d (d.id)}
              {@const st = app.dbs[d.id] ?? { status: 'idle', schema: [] }}
              <div class="db" class:drop={dragOver === d.id} class:current={app.activeTab?.dbId === d.id} {...dragProps(d.id)} ondrop={(e) => onDrop(e, { db: d })} role="group">
                <div class="row">
                  <button class="node db-node" onclick={() => toggleDb(d)} aria-expanded={!!openDbs[d.id]} title={d.name}>
                    <span class="chev" class:open={openDbs[d.id]}><Icon name="chevron" size={11} /></span>
                    <span class="dot {st.status}" title={st.status === 'idle' ? 'Not started yet' : st.status}></span>
                    <Icon name="database" size={14} />
                    <span class="label">{d.name}</span>
                    {#if d.sample}<span class="tag">sample</span>{/if}
                  </button>
                  <button class="icon-btn" title="New query on {d.name}" onclick={() => app.newQuery(d.id)}><Icon name="file" size={13} /></button>
                  <button class="icon-btn" title="Database actions" onclick={() => (menu = menu?.id === d.id ? null : { kind: 'db', id: d.id })}>⋯</button>
                  {#if menu?.kind === 'db' && menu.id === d.id}
                    <div class="menu" role="menu">
                      <button role="menuitem" onclick={() => action(() => app.newQuery(d.id))}><Icon name="file" size={14} /> New query</button>
                      <button role="menuitem" onclick={() => action(() => app.openDiagram(d.id))}><Icon name="link" size={14} /> Diagram (ER)</button>
                      <button role="menuitem" onclick={() => importInto(d)}><Icon name="upload" size={14} /> Import a file into {d.name}…</button>
                      <hr />
                      <button role="menuitem" onclick={() => action(() => app.saveDatabaseFile(d.id))}><Icon name="save" size={14} /> Save to a file</button>
                      <button role="menuitem" onclick={() => action(() => (app.dialog = { kind: 'rename-database', dbId: d.id }))}><Icon name="type" size={14} /> Rename</button>
                      <button role="menuitem" onclick={() => action(() => app.refreshSchema(d.id))}><Icon name="refresh" size={14} /> Refresh</button>
                      <hr />
                      <button role="menuitem" class="danger" onclick={() => action(() => window.confirm(`Delete every table in ${d.name}? This can't be undone.`) && app.clearDatabase(d.id))}><Icon name="trash" size={14} /> Empty this database</button>
                      <button role="menuitem" class="danger" onclick={() => action(() => window.confirm(`Delete the database ${d.name} completely? This can't be undone. (Save it to a file first if you want a copy.)`) && app.deleteDatabase(d.id))}><Icon name="x" size={14} /> Delete database</button>
                    </div>
                  {/if}
                </div>

                {#if openDbs[d.id]}
                  <div class="tables">
                    {#if st.busy}<div class="info">{st.busy}</div>{/if}
                    {#if st.status === 'loading'}
                      <div class="info">Starting {ENGINE_META[engine].label}…</div>
                    {:else if st.status === 'error'}
                      <div class="info err">Could not start: {st.error}</div>
                    {:else if st.status === 'ready' && !st.schema.length}
                      <div class="info">
                        No tables yet. <button class="linkish" onclick={() => app.newQuery(d.id, 'CREATE TABLE my_table (\n  id INTEGER PRIMARY KEY,\n  name TEXT\n);\n')}>Create one with SQL</button>,
                        <button class="linkish" onclick={() => importInto(d)}>import a file</button>, or drop one here.
                      </div>
                    {/if}
                    {#each st.schema.filter(matches) as t (t.name)}
                      <details class="table" open={!!filter}>
                        <summary class="node" ondblclick={(e) => { e.preventDefault(); app.openTable(d.id, t.name); }} title="Double-click to open the rows">
                          <span class="chev"><Icon name="chevron" size={10} /></span>
                          <Icon name={t.kind === 'view' ? 'view' : 'table'} size={14} />
                          <span class="label">{t.name}</span>
                          {#if t.rowCount !== undefined}<span class="count">{t.rowCount.toLocaleString()}</span>{/if}
                          <span class="peek">
                            <button title="Open rows (edit, filter)" onclick={(e) => { e.preventDefault(); app.openTable(d.id, t.name); }}><Icon name="table" size={13} /></button>
                            <button title="New query on this table" onclick={(e) => { e.preventDefault(); app.newQuery(d.id, `SELECT *\nFROM ${ident(t.name)}\nLIMIT 100;`, t.name); }}><Icon name="file" size={13} /></button>
                          </span>
                        </summary>
                        <div class="cols">
                          {#each t.columns as c}
                            {@const fk = t.foreignKeys.find((f) => f.column === c.name)}
                            <div class="col" title={fk ? `References ${fk.refTable}(${fk.refColumn})` : c.type}>
                              <span class="ci" class:pk={c.pk} class:fk={!!fk}><Icon name={c.pk ? 'key' : fk ? 'link' : 'column'} size={12} /></span>
                              <span class="cname">{c.name}</span>
                              <span class="ctype">{c.type.toLowerCase()}</span>
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
        {/if}
      </section>
    {/each}
  </div>
  <p class="tip">Drop a CSV, Excel, JSON or Parquet file on a database to import it, or on an engine to make a new database from it.</p>
</div>

<svelte:window onclick={(e) => { if (menu && !(e.target as HTMLElement).closest('.row')) menu = null; }} />

<style>
  .explorer {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .head {
    padding: 12px 12px 6px 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
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
    padding: 4px 12px 8px;
  }
  .filter input {
    width: 100%;
  }
  .tree {
    flex: 1;
    overflow: auto;
    padding: 2px 6px 12px;
  }
  .engine {
    border-radius: 8px;
    margin-bottom: 4px;
  }
  .engine.drop,
  .db.drop {
    outline: 2px dashed var(--accent);
    background: var(--row-hover);
    border-radius: 8px;
  }
  .row {
    display: flex;
    align-items: center;
    position: relative;
  }
  .node {
    display: flex;
    align-items: center;
    gap: 7px;
    flex: 1;
    min-width: 0;
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
    font-size: 12.5px;
    color: var(--text-dim);
  }
  .db.current > .row .db-node {
    color: var(--text);
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
  .tag {
    font-size: 10px;
    color: var(--ok-text);
    background: var(--ok-bg);
    border-radius: 4px;
    padding: 0 5px;
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
  .icon-btn {
    background: none;
    border: none;
    color: var(--text-faint);
    font-size: 16px;
    line-height: 1;
    padding: 4px 6px;
    border-radius: 6px;
    cursor: pointer;
    display: inline-flex;
  }
  .icon-btn:hover {
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
    padding-left: 12px;
  }
  .add-db {
    display: flex;
    gap: 6px;
    align-items: center;
    background: none;
    border: 1px dashed var(--border);
    color: var(--text-dim);
    border-radius: 6px;
    padding: 5px 10px;
    margin: 2px 0 6px 10px;
    font: inherit;
    font-size: 12.5px;
    cursor: pointer;
  }
  .add-db:hover {
    color: var(--text);
    border-color: var(--accent);
  }
  .tables {
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
    display: none;
    gap: 2px;
  }
  .table summary:hover .peek {
    display: inline-flex;
  }
  .table summary:hover .count {
    display: none;
  }
  .peek button {
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    padding: 0 3px;
    display: inline-flex;
  }
  .peek button:hover {
    color: var(--accent);
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
    line-height: 1.45;
  }
</style>
