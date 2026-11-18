<script lang="ts">
  import { app, ENGINE_IDS } from '../state.svelte';
  import { ENGINE_META, type EngineId } from '../engines/types';
  import { safeIdentifier } from '../lib/import-file';

  const d = $derived(app.dialog!);
  let engine = $state<EngineId>(app.dialog?.engine ?? app.settings.defaultEngine);
  let name = $state('');
  let busy = $state(false);
  let input: HTMLInputElement | undefined = $state();
  let touched = false;

  // Suggest a name, but never overwrite one the user typed.
  $effect(() => {
    if (d.kind === 'rename-database') name = app.db(d.dbId)?.name ?? '';
    else if (!touched) name = app.nextDbName(engine);
  });
  $effect(() => {
    input?.focus();
    input?.select();
  });

  const cleaned = $derived(safeIdentifier(name, ''));

  async function submit(e: Event) {
    e.preventDefault();
    if (!cleaned) return;
    if (d.kind === 'rename-database') {
      app.renameDatabase(d.dbId!, cleaned);
      app.dialog = null;
      return;
    }
    busy = true;
    try {
      const then = d.then;
      const db = await app.createDatabase(engine, cleaned);
      app.dialog = null;
      if (then) then(db);
      else app.newQuery(db.id, '', `${db.name} query`);
    } catch (err: any) {
      app.toast('error', `Could not create the database: ${err?.message ?? err}`);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (app.dialog = null)} />

<div class="backdrop" onpointerdown={(e) => e.target === e.currentTarget && (app.dialog = null)} role="presentation">
  <form class="dialog" onsubmit={submit} aria-labelledby="dlg-title">
    <h2 id="dlg-title">{d.kind === 'rename-database' ? 'Rename database' : (d.title ?? 'New database')}</h2>

    {#if d.kind === 'new-database'}
      <div class="engines" role="radiogroup" aria-label="Engine">
        {#each ENGINE_IDS as id}
          <label class="engine" class:on={engine === id}>
            <input type="radio" name="engine" value={id} bind:group={engine} />
            <span class="eng {id}">{ENGINE_META[id].short}</span>
            <span class="ename">{ENGINE_META[id].label}</span>
            <span class="edesc">{ENGINE_META[id].description}</span>
          </label>
        {/each}
      </div>
    {/if}

    <label class="field">
      <span>Name</span>
      <input bind:this={input} bind:value={name} oninput={() => (touched = true)} spellcheck="false" autocomplete="off" />
    </label>
    {#if name && cleaned !== name}
      <p class="note">Will be saved as <code>{cleaned || '…'}</code> (lower case letters, numbers and underscores).</p>
    {/if}

    <div class="actions">
      <button type="button" class="btn" onclick={() => (app.dialog = null)}>Cancel</button>
      <button type="submit" class="btn primary" disabled={!cleaned || busy}>{busy ? 'Creating…' : d.kind === 'rename-database' ? 'Rename' : 'Create database'}</button>
    </div>
  </form>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
    padding: 16px;
  }
  .dialog {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: var(--shadow);
    width: min(560px, 100%);
    padding: 20px 22px;
  }
  h2 {
    margin: 0 0 14px;
    font-size: 18px;
  }
  .engines {
    display: grid;
    gap: 8px;
    margin-bottom: 14px;
  }
  .engine {
    display: grid;
    grid-template-columns: auto auto 1fr;
    grid-template-rows: auto auto;
    column-gap: 10px;
    align-items: center;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    cursor: pointer;
  }
  .engine.on {
    border-color: var(--accent);
    background: var(--row-hover);
  }
  .engine input {
    grid-row: span 2;
    margin: 0;
  }
  .ename {
    font-weight: 600;
  }
  .edesc {
    grid-column: 2 / span 2;
    font-size: 12.5px;
    color: var(--text-dim);
    margin-top: 2px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;
    color: var(--text-dim);
  }
  .field input {
    font-size: 15px;
    padding: 8px 10px;
    font-family: var(--mono);
  }
  .note {
    font-size: 12.5px;
    color: var(--text-faint);
    margin: 6px 0 0;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 18px;
  }
</style>
