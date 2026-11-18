<script lang="ts">
  import type { ResultSet } from '../engines/types';
  import type { GridEditing } from './ResultsGrid.svelte';

  let {
    result,
    row = $bindable(0),
    editing,
  }: {
    result: ResultSet;
    row?: number;
    editing?: GridEditing;
  } = $props();

  const total = $derived(result.rows.length);
  const valueOf = (c: number) => {
    const e = editing?.edits[row];
    return e && c in e ? e[c] : result.rows[row]?.[c];
  };
  const fmt = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v));
</script>

<div class="form">
  <div class="nav">
    <button class="btn small" disabled={row <= 0} onclick={() => (row = Math.max(0, row - 1))}>‹ Previous</button>
    <span>Row {Math.min(row + 1, total)} of {total}</span>
    <button class="btn small" disabled={row >= total - 1} onclick={() => (row = Math.min(total - 1, row + 1))}>Next ›</button>
    {#if editing}<span class="tip">Edit a field, then press Enter or click away. Leave it empty and tick NULL for no value.</span>{/if}
  </div>
  {#if total}
    <div class="fields">
      {#each result.columns as c, i}
        {@const v = valueOf(i)}
        {@const changed = !!editing?.edits[row] && i in editing.edits[row]}
        <label class="field" class:changed>
          <span class="name">{c.name}<small>{c.type}</small></span>
          {#if editing && !editing.deleted[row]}
            <span class="input">
              <input
                value={fmt(v)}
                placeholder={v === null ? 'NULL' : ''}
                onchange={(e) => editing.onEdit(row, i, (e.currentTarget as HTMLInputElement).value)}
              />
              <span class="nullbox" title="Set to NULL (no value)">
                <input type="checkbox" checked={v === null} onchange={(e) => editing.onEdit(row, i, (e.currentTarget as HTMLInputElement).checked ? null : '')} /> NULL
              </span>
            </span>
          {:else}
            <span class="value" class:null={v === null}>{v === null ? 'NULL' : fmt(v)}</span>
          {/if}
        </label>
      {/each}
    </div>
  {:else}
    <p class="empty">No rows.</p>
  {/if}
</div>

<style>
  .form {
    height: 100%;
    overflow: auto;
    padding: 10px 16px 20px;
  }
  .nav {
    display: flex;
    gap: 10px;
    align-items: center;
    font-size: 13px;
    color: var(--text-dim);
    margin-bottom: 12px;
    flex-wrap: wrap;
  }
  .tip {
    font-size: 12px;
    color: var(--text-faint);
  }
  .fields {
    display: grid;
    grid-template-columns: minmax(140px, 220px) minmax(200px, 640px);
    gap: 4px 16px;
  }
  .field {
    display: contents;
  }
  .name {
    font-weight: 600;
    font-size: 13px;
    padding: 6px 0;
    display: flex;
    flex-direction: column;
  }
  .name small {
    font-weight: 400;
    color: var(--text-faint);
    font-size: 11px;
  }
  .value {
    font-family: var(--mono);
    font-size: 13px;
    padding: 6px 0;
    word-break: break-word;
    white-space: pre-wrap;
  }
  .value.null {
    color: var(--text-faint);
    font-style: italic;
  }
  .input {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .input > input {
    flex: 1;
    font-family: var(--mono);
  }
  .changed .input > input {
    border-color: #e5b450;
  }
  .nullbox {
    font-size: 11.5px;
    color: var(--text-faint);
    display: flex;
    gap: 4px;
    align-items: center;
    white-space: nowrap;
  }
  .empty {
    color: var(--text-dim);
  }
</style>
