<script lang="ts">
  import Icon from './Icon.svelte';
  import { app, ENGINE_IDS, exercises, sample } from '../state.svelte';
  import { ENGINE_META, type EngineId } from '../engines/types';
  import { IMPORT_ACCEPT } from '../lib/import-file';
  import { pickFile } from '../lib/download';

  let engine = $state<EngineId>(app.settings.defaultEngine);
  let busy = $state<string | null>(null);

  async function trySample() {
    busy = 'sample';
    try {
      await app.trySample(engine);
    } finally {
      busy = null;
    }
  }

  async function importFile() {
    const files = await pickFile(IMPORT_ACCEPT, true);
    if (!files.length) return;
    busy = 'import';
    try {
      await app.importAsNewDatabase(engine, files);
    } finally {
      busy = null;
    }
  }

  const recent = $derived([...app.databases].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6));
  const isSingleFile = import.meta.env.MODE === 'single';
</script>

<div class="welcome">
  <header>
    <svg viewBox="0 0 64 64" width="52" height="52" aria-hidden="true"><ellipse cx="32" cy="16" rx="18" ry="7" fill="#4f9cf7" /><path d="M14 16v30c0 3.9 8 7 18 7s18-3.1 18-7V16c0 3.9-8 7-18 7s-18-3.1-18-7z" fill="#3577d4" /><path d="M14 31c0 3.9 8 7 18 7s18-3.1 18-7" fill="none" stroke="var(--bg)" stroke-width="3" /></svg>
    <div>
      <h1>dbify</h1>
      <p>Practise SQL with real databases, right in your browser. Nothing to install, and your data never leaves this computer.</p>
    </div>
  </header>

  <div class="engine-pick">
    <span>Engine</span>
    <div class="seg" role="radiogroup" aria-label="Database engine">
      {#each ENGINE_IDS as id}
        <button role="radio" aria-checked={engine === id} class:on={engine === id} onclick={() => (engine = id)}>{ENGINE_META[id].label}</button>
      {/each}
    </div>
    <small>{ENGINE_META[engine].description}</small>
  </div>

  <div class="cards">
    <button class="card" onclick={trySample} disabled={!!busy}>
      <span class="ci"><Icon name="sparkle" size={22} /></span>
      <span class="ct">Try the sample database</span>
      <span class="cd">{sample.name}: a made-up online store with customers, products, orders and payments.</span>
      <span class="cta">{busy === 'sample' ? 'Opening…' : 'Open sample →'}</span>
    </button>
    <button class="card" onclick={() => (app.dialog = { kind: 'new-database', engine })} disabled={!!busy}>
      <span class="ci"><Icon name="plus" size={22} /></span>
      <span class="ct">Create a database</span>
      <span class="cd">Start empty, then build your own tables with CREATE TABLE.</span>
      <span class="cta">New database →</span>
    </button>
    <button class="card" onclick={importFile} disabled={!!busy}>
      <span class="ci"><Icon name="upload" size={22} /></span>
      <span class="ct">Import a file</span>
      <span class="cd">A CSV, Excel, JSON or Parquet file becomes a table you can query.</span>
      <span class="cta">{busy === 'import' ? 'Importing…' : 'Choose a file →'}</span>
    </button>
  </div>

  {#if recent.length}
    <section class="recent">
      <h2>Your databases</h2>
      <div class="chips">
        {#each recent as d (d.id)}
          <button class="chip" onclick={() => app.newQuery(d.id)} title="New query on {d.name}">
            <span class="eng {d.engine}">{ENGINE_META[d.engine].short}</span>{d.name}
          </button>
        {/each}
      </div>
    </section>
  {/if}

  <footer>
    <button class="link" onclick={() => { app.panel = 'lessons'; app.sideOpen = true; }}><Icon name="book" size={15} /> Lessons: {exercises.length} exercises with automatic checking</button>
    <button class="link" onclick={() => { app.panel = 'help'; app.sideOpen = true; }}><Icon name="help" size={15} /> Shortcuts and {isSingleFile ? 'settings' : 'using dbify offline'}</button>
  </footer>
</div>

<style>
  .welcome {
    max-width: 920px;
    margin: 0 auto;
    padding: 56px 32px 40px;
  }
  header {
    display: flex;
    gap: 18px;
    align-items: center;
    margin-bottom: 34px;
  }
  h1 {
    font-size: 34px;
    margin: 0;
    letter-spacing: -0.02em;
  }
  header p {
    margin: 4px 0 0;
    color: var(--text-dim);
    font-size: 15.5px;
    line-height: 1.5;
  }
  .engine-pick {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 14px;
    flex-wrap: wrap;
    font-size: 13px;
    color: var(--text-dim);
  }
  .engine-pick small {
    font-size: 12.5px;
    color: var(--text-faint);
  }
  .seg {
    display: flex;
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }
  .seg button {
    background: var(--input-bg);
    color: var(--text-dim);
    border: none;
    padding: 6px 14px;
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .seg button + button {
    border-left: 1px solid var(--border);
  }
  .seg button.on {
    background: var(--accent-strong);
    color: #fff;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 14px;
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    text-align: left;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 18px;
    color: var(--text);
    font: inherit;
    cursor: pointer;
    transition:
      border-color 0.15s,
      transform 0.15s;
  }
  .card:hover:not(:disabled) {
    border-color: var(--accent);
    transform: translateY(-2px);
  }
  .card:disabled {
    opacity: 0.7;
    cursor: progress;
  }
  .ci {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--row-hover);
    color: var(--accent);
  }
  .ct {
    font-weight: 600;
    font-size: 15px;
  }
  .cd {
    color: var(--text-dim);
    font-size: 13px;
    line-height: 1.5;
    flex: 1;
  }
  .cta {
    color: var(--accent);
    font-size: 13px;
    font-weight: 600;
  }
  .recent {
    margin-top: 30px;
  }
  h2 {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-dim);
    margin: 0 0 10px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .chip {
    display: flex;
    align-items: center;
    gap: 7px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 6px 12px 6px 8px;
    color: var(--text);
    font: inherit;
    font-size: 13px;
    font-family: var(--mono);
    cursor: pointer;
  }
  .chip:hover {
    border-color: var(--accent);
  }
  footer {
    margin-top: 34px;
    padding-top: 18px;
    border-top: 1px solid var(--border);
    display: flex;
    gap: 22px;
    flex-wrap: wrap;
  }
  .link {
    display: flex;
    gap: 7px;
    align-items: center;
    background: none;
    border: none;
    color: var(--text-dim);
    font: inherit;
    font-size: 13.5px;
    cursor: pointer;
    padding: 0;
  }
  .link:hover {
    color: var(--accent);
  }
</style>
