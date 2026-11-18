<script lang="ts">
  import { app } from '../state.svelte';

  const isSingleFile = import.meta.env.MODE === 'single';
  const hosted = location.protocol.startsWith('http');
</script>

<div class="help">
  <div class="head"><h2>Help & settings</h2></div>

  <section>
    <h3>Settings</h3>
    <label class="row">
      <input type="checkbox" bind:checked={app.settings.upperKeywords} onchange={() => app.saveSettings()} />
      Capitalise SQL keywords as I type
    </label>
    <label class="row">
      Theme
      <select bind:value={app.settings.theme} onchange={() => app.saveSettings()}>
        <option value="dark">Dark</option>
        <option value="light">Light</option>
      </select>
    </label>
    <label class="row">
      Editor text size
      <select bind:value={app.settings.fontSize} onchange={() => app.saveSettings()}>
        {#each [12, 13, 14, 15, 16, 18, 20, 24] as s}<option value={s}>{s}px</option>{/each}
      </select>
    </label>
    <label class="row">
      New queries use
      <select bind:value={app.settings.defaultEngine} onchange={() => app.saveSettings()}>
        <option value="sqlite">SQLite</option>
        <option value="duckdb">DuckDB</option>
        <option value="postgres">PostgreSQL</option>
      </select>
    </label>
  </section>

  <section>
    <h3>Keyboard shortcuts</h3>
    <dl>
      <dt><kbd>Ctrl</kbd>+<kbd>Enter</kbd></dt><dd>Run everything (or the selected text)</dd>
      <dt><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd></dt><dd>Run the statement under the cursor</dd>
      <dt><kbd>Shift</kbd>+<kbd>Alt</kbd>+<kbd>F</kbd></dt><dd>Format SQL</dd>
      <dt><kbd>Ctrl</kbd>+<kbd>/</kbd></dt><dd>Comment / uncomment lines</dd>
      <dt><kbd>Ctrl</kbd>+<kbd>Space</kbd></dt><dd>Show suggestions</dd>
      <dt>Double-click a cell</dt><dd>Edit it (in a table's data view). Enter saves the cell, Esc cancels.</dd>
    </dl>
    <p class="small">On a Mac, use <kbd>Cmd</kbd> instead of <kbd>Ctrl</kbd>.</p>
  </section>

  <section>
    <h3>Your data</h3>
    <p>Everything runs inside your browser. Nothing you type or import is uploaded anywhere.</p>
    <p>You can have as many SQLite, DuckDB and PostgreSQL databases as you like. Each one is saved automatically in this browser, so it's still there next time.</p>
    <p>To keep a copy or move a database to another computer, use <b>Save to a file</b> from the ⋯ menu next to it. Open it again with <b>Open a saved database file</b> from the ⋯ menu next to the engine.</p>
  </section>

  <section>
    <h3>Use dbify offline</h3>
    {#if isSingleFile}
      <p>You're using the single-file version. It works without internet: just double-click <code>dbify.html</code>.</p>
    {:else if hosted}
      <p><b>Install it as an app:</b> in Chrome or Edge, click the install icon at the right end of the address bar. dbify then opens from your desktop or Start menu and works offline.</p>
      <p><b>Or download one file:</b> <a href="./dbify.html" download>dbify.html</a> (about 20 MB) runs when you double-click it, with no internet.</p>
    {:else}
      <p>This page is running from your computer.</p>
    {/if}
  </section>

  <section>
    <h3>About</h3>
    <p class="small">dbify runs SQLite (sql.js), DuckDB (duckdb-wasm) and PostgreSQL (PGlite) compiled to WebAssembly. Open source under the MIT licence.</p>
  </section>
</div>

<style>
  .help {
    height: 100%;
    overflow: auto;
    padding-bottom: 20px;
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
  section {
    padding: 4px 16px 8px;
  }
  h3 {
    font-size: 13.5px;
    margin: 12px 0 8px;
  }
  p {
    font-size: 13px;
    line-height: 1.55;
    color: var(--text-dim);
    margin: 0 0 8px;
  }
  .small {
    font-size: 12px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    margin-bottom: 8px;
    justify-content: space-between;
  }
  .row:has(input[type='checkbox']) {
    justify-content: flex-start;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 10px;
    font-size: 12.5px;
    margin: 0;
  }
  dt {
    white-space: nowrap;
  }
  dd {
    margin: 0;
    color: var(--text-dim);
  }
  kbd {
    font-family: var(--mono);
    font-size: 11px;
    border: 1px solid var(--border);
    border-bottom-width: 2px;
    border-radius: 4px;
    padding: 0 4px;
    background: var(--input-bg);
  }
  a {
    color: var(--accent);
  }
  code {
    font-family: var(--mono);
    font-size: 12px;
  }
</style>
