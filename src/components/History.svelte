<script lang="ts">
  import Icon from './Icon.svelte';
  import { app, type HistoryEntry } from '../state.svelte';
  import { ENGINE_META } from '../engines/types';

  let q = $state('');
  const list = $derived(app.history.filter((h) => !q || h.sql.toLowerCase().includes(q.toLowerCase())).slice(0, 200));

  function open(h: HistoryEntry) {
    const db = app.db(h.dbId) ?? app.dbsOf(h.engine)[0];
    if (!db) return app.toast('info', `The ${h.dbName} database no longer exists. Create a ${ENGINE_META[h.engine].label} database first.`);
    const tab = app.activeTab;
    if (tab && tab.kind === 'query' && tab.dbId === db.id && !tab.sql.trim()) tab.sql = h.sql;
    else app.newQuery(db.id, h.sql);
  }

  function when(t: number) {
    const s = (Date.now() - t) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return new Date(t).toLocaleDateString();
  }
</script>

<div class="history">
  <div class="head">
    <h2>History</h2>
    {#if app.history.length}<button class="linkish" onclick={() => window.confirm('Clear your query history?') && app.clearHistory()}>Clear</button>{/if}
  </div>
  <div class="filter"><input placeholder="Search history…" bind:value={q} /></div>
  <div class="list">
    {#each list as h}
      <button class="item" onclick={() => open(h)} title="Open in the editor">
        <div class="meta">
          <span class="dot" class:ready={h.ok} class:error={!h.ok}></span>
          <span class="eng {h.engine}">{ENGINE_META[h.engine].short}</span>
          <span class="dbname">{h.dbName}</span>
          <span class="when">{when(h.at)}</span>
        </div>
        <pre>{h.sql.length > 300 ? h.sql.slice(0, 300) + '…' : h.sql}</pre>
      </button>
    {:else}
      <p class="empty"><Icon name="info" size={14} /> {q ? 'Nothing matches.' : 'Queries you run will appear here.'}</p>
    {/each}
  </div>
</div>

<style>
  .history {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .head {
    padding: 14px 14px 6px;
    display: flex;
    justify-content: space-between;
    align-items: center;
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
  .list {
    flex: 1;
    overflow: auto;
    padding: 0 8px 12px;
  }
  .item {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: 1px solid transparent;
    border-radius: 8px;
    padding: 8px;
    color: var(--text);
    cursor: pointer;
    font: inherit;
  }
  .item:hover {
    background: var(--row-hover);
    border-color: var(--border);
  }
  .meta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11.5px;
    color: var(--text-faint);
  }
  .dbname {
    color: var(--text-dim);
  }
  .when {
    margin-left: auto;
  }
  pre {
    margin: 6px 0 0;
    font-family: var(--mono);
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 90px;
    overflow: hidden;
    color: var(--text-dim);
  }
  .empty {
    color: var(--text-dim);
    font-size: 13px;
    padding: 8px;
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .linkish {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    padding: 0;
    font-size: 12px;
  }
</style>
