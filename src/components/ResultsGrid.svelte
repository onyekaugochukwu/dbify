<script lang="ts" module>
  export interface GridEditing {
    /** rowIndex → columnIndex → new value (null = SQL NULL). */
    edits: Record<number, Record<number, unknown>>;
    deleted: Record<number, boolean>;
    /** Rows at or after this index are new, unsaved rows. */
    newFrom: number;
    onEdit: (row: number, col: number, value: unknown) => void;
  }
</script>

<script lang="ts">
  import type { ResultSet } from '../engines/types';

  let {
    result,
    sort = $bindable(null),
    serverSort = false,
    onSort,
    filters,
    onFilter,
    quickFilter = '',
    editing,
    selected = $bindable(null),
    onOpenRow,
  }: {
    result: ResultSet;
    sort?: { col: number; dir: 1 | -1 } | null;
    /** Sorting is done by the caller (e.g. ORDER BY in SQL). */
    serverSort?: boolean;
    onSort?: (col: number) => void;
    filters?: string[];
    onFilter?: (col: number, value: string) => void;
    quickFilter?: string;
    editing?: GridEditing;
    selected?: { r: number; c: number } | null;
    onOpenRow?: (rowIndex: number) => void;
  } = $props();

  const ROW_H = 28;
  const HEAD_H = 44;
  const FILTER_H = $derived(filters ? 32 : 0);
  let scrollTop = $state(0);
  let viewportH = $state(400);
  let scroller: HTMLDivElement;
  let editingCell = $state<{ r: number; c: number; value: string } | null>(null);

  // Reset scroll when a new result arrives.
  let lastResult: ResultSet | undefined;
  $effect(() => {
    if (result !== lastResult) {
      lastResult = result;
      if (!serverSort) sort = null;
      editingCell = null;
      if (scroller && !serverSort) scroller.scrollTop = 0;
    }
  });

  const NUMERIC = /int|double|float|real|numeric|decimal|number/i;
  const isNumericCol = $derived(
    result.columns.map((c, i) => NUMERIC.test(c.type) || (result.rows.length > 0 && result.rows.slice(0, 50).every((r) => r[i] === null || typeof r[i] === 'number'))),
  );

  const widths = $derived(
    result.columns.map((c, i) => {
      let w = Math.max(c.name.length + 3, (c.type || '').length * 0.85, filters ? 9 : 0);
      for (const r of result.rows.slice(0, 200)) {
        const v = r[i];
        const len = v === null ? 4 : String(v).length;
        if (len > w) w = len;
      }
      return Math.max(70, Math.min(380, w * 7.6 + 24));
    }),
  );
  const totalW = $derived(widths.reduce((a, b) => a + b, 0) + 56);

  const order = $derived.by(() => {
    let idx = result.rows.map((_, i) => i);
    const q = quickFilter.trim().toLowerCase();
    if (q) idx = idx.filter((i) => result.rows[i].some((v) => v !== null && String(v).toLowerCase().includes(q)));
    if (!sort || serverSort) return idx;
    const { col, dir } = sort;
    const num = isNumericCol[col];
    return idx.sort((a, b) => {
      const x = result.rows[a][col], y = result.rows[b][col];
      if (x === null) return y === null ? 0 : 1;
      if (y === null) return -1;
      if (num) return (Number(x) - Number(y)) * dir;
      return String(x).localeCompare(String(y), undefined, { numeric: true }) * dir;
    });
  });

  const top0 = $derived(HEAD_H + FILTER_H);
  const first = $derived(Math.max(0, Math.floor(scrollTop / ROW_H) - 5));
  const last = $derived(Math.min(order.length, Math.ceil((scrollTop + viewportH) / ROW_H) + 5));
  const visible = $derived(order.slice(first, last));

  // Keep the selected cell in view (e.g. after "Add row" selects the new last row).
  $effect(() => {
    const sel = selected;
    if (!sel || !scroller) return;
    const top = sel.r * ROW_H;
    if (top < scroller.scrollTop) scroller.scrollTop = top;
    else if (top + ROW_H + top0 > scroller.scrollTop + viewportH) scroller.scrollTop = top + ROW_H * 2 + top0 - viewportH;
  });

  function toggleSort(i: number) {
    if (onSort) return onSort(i);
    if (!sort || sort.col !== i) sort = { col: i, dir: 1 };
    else if (sort.dir === 1) sort = { col: i, dir: -1 };
    else sort = null;
  }

  function cellValue(rowIdx: number, c: number): unknown {
    const e = editing?.edits[rowIdx];
    if (e && c in e) return e[c];
    return result.rows[rowIdx][c];
  }

  function fmt(v: unknown): string {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    return String(v);
  }

  function startEdit(r: number, c: number) {
    if (!editing) return;
    const rowIdx = order[r];
    if (editing.deleted[rowIdx]) return;
    const v = cellValue(rowIdx, c);
    editingCell = { r, c, value: v === null || v === undefined ? '' : fmt(v) };
  }

  function commitEdit(move?: [number, number]) {
    if (!editingCell || !editing) return;
    const { r, c, value } = editingCell;
    const rowIdx = order[r];
    const old = cellValue(rowIdx, c);
    const isNew = rowIdx >= editing.newFrom;
    const next = value === '' && (old === null || isNew) ? null : value;
    if (fmt(next) !== fmt(old) || (next === null) !== (old === null)) editing.onEdit(rowIdx, c, next);
    editingCell = null;
    if (move) {
      selected = { r: Math.max(0, Math.min(order.length - 1, r + move[0])), c: Math.max(0, Math.min(result.columns.length - 1, c + move[1])) };
    }
    scroller.focus();
  }

  function onKey(e: KeyboardEvent) {
    if (editingCell || !selected) return;
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      const v = cellValue(order[selected.r], selected.c);
      navigator.clipboard?.writeText(v === null ? '' : fmt(v));
      e.preventDefault();
      return;
    }
    if (editing && (e.key === 'Enter' || e.key === 'F2')) {
      e.preventDefault();
      return startEdit(selected.r, selected.c);
    }
    if (editing && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Typing starts editing, like a spreadsheet.
      startEdit(selected.r, selected.c);
      const ec = editingCell as { value: string } | null;
      if (ec) ec.value = e.key;
      e.preventDefault();
      return;
    }
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    const r = Math.max(0, Math.min(order.length - 1, selected.r + m[0]));
    const c = Math.max(0, Math.min(result.columns.length - 1, selected.c + m[1]));
    selected = { r, c };
    const top = r * ROW_H;
    if (top < scroller.scrollTop) scroller.scrollTop = top;
    else if (top + ROW_H * 2 + top0 > scroller.scrollTop + viewportH) scroller.scrollTop = top + ROW_H * 2 + top0 - viewportH;
  }

  function focusInput(node: HTMLInputElement) {
    node.focus();
    const len = node.value.length;
    node.setSelectionRange(len, len);
  }

  /** Row index (in result.rows) of the selected cell. */
  export function selectedRowIndex(): number | undefined {
    return selected ? order[selected.r] : undefined;
  }
</script>

<div
  class="grid"
  bind:this={scroller}
  bind:clientHeight={viewportH}
  onscroll={() => (scrollTop = scroller.scrollTop)}
  tabindex="0"
  role="grid"
  aria-rowcount={order.length}
  onkeydown={onKey}
>
  <div class="inner" style="width:{totalW}px; height:{order.length * ROW_H + top0}px">
    <div class="sticky" style="width:{totalW}px">
      <div class="row head" style="width:{totalW}px">
        <div class="cell num-col">#</div>
        {#each result.columns as c, i}
          <button class="cell hcell" class:right={isNumericCol[i]} style="width:{widths[i]}px" onclick={() => toggleSort(i)} title="{c.name} · {c.type || 'unknown type'}. Click to sort.">
            <span class="hname">{c.name}{#if sort?.col === i}<span class="arrow">{sort.dir === 1 ? ' ▲' : ' ▼'}</span>{/if}</span>
            <span class="htype">{c.type || ' '}</span>
          </button>
        {/each}
      </div>
      {#if filters}
        <div class="row filter-row" style="width:{totalW}px">
          <div class="cell num-col filter-icon" title="Filter: type text to search, or =, !=, >, <, >=, <=, null, not null">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 4h18l-7 9v6l-4 2v-8z" /></svg>
          </div>
          {#each result.columns as c, i}
            <div class="cell fcell" style="width:{widths[i]}px">
              <input
                class:active={!!filters[i]}
                value={filters[i] ?? ''}
                placeholder="filter"
                aria-label="Filter {c.name}"
                onkeydown={(e) => {
                  if (e.key === 'Enter') onFilter?.(i, (e.currentTarget as HTMLInputElement).value);
                  if (e.key === 'Escape') {
                    (e.currentTarget as HTMLInputElement).value = '';
                    onFilter?.(i, '');
                  }
                }}
                onblur={(e) => {
                  const v = (e.currentTarget as HTMLInputElement).value;
                  if (v !== (filters[i] ?? '')) onFilter?.(i, v);
                }}
              />
            </div>
          {/each}
        </div>
      {/if}
    </div>
    {#each visible as rowIdx, k (rowIdx)}
      {@const r = first + k}
      {@const isNew = !!editing && rowIdx >= editing.newFrom}
      {@const isDeleted = !!editing?.deleted[rowIdx]}
      <div class="row" class:odd={r % 2 === 1} class:new-row={isNew} class:deleted={isDeleted} style="top:{r * ROW_H + top0}px; width:{totalW}px">
        <div class="cell num-col" ondblclick={() => onOpenRow?.(rowIdx)} role="rowheader" tabindex="-1" title={onOpenRow ? 'Double-click to open this row as a form' : undefined}>{isNew ? '+' : r + 1}</div>
        {#each result.columns as _c, c}
          {@const v = cellValue(rowIdx, c)}
          {@const changed = !!editing?.edits[rowIdx] && c in editing.edits[rowIdx]}
          {#if editingCell && editingCell.r === r && editingCell.c === c}
            <div class="cell editing" style="width:{widths[c]}px">
              <input
                use:focusInput
                bind:value={editingCell.value}
                onkeydown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitEdit([1, 0]);
                  } else if (e.key === 'Tab') {
                    e.preventDefault();
                    commitEdit([0, e.shiftKey ? -1 : 1]);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    editingCell = null;
                    scroller.focus();
                  }
                }}
                onblur={() => commitEdit()}
              />
            </div>
          {:else}
            <div
              class="cell"
              class:null={v === null}
              class:right={isNumericCol[c]}
              class:changed
              class:sel={selected?.r === r && selected?.c === c}
              style="width:{widths[c]}px"
              title={v === null ? 'NULL' : fmt(v).length > 40 ? fmt(v) : undefined}
              onmousedown={() => (selected = { r, c })}
              ondblclick={() => startEdit(r, c)}
              role="gridcell"
              tabindex="-1"
            >
              {fmt(v)}
            </div>
          {/if}
        {/each}
      </div>
    {/each}
  </div>
  {#if order.length === 0}
    <div class="empty" style="top:{top0 + 20}px">
      {result.rows.length ? 'No rows match the search.' : 'No rows.'}
    </div>
  {/if}
</div>

<style>
  .grid {
    position: relative;
    overflow: auto;
    height: 100%;
    outline: none;
    font-size: 13px;
  }
  .inner {
    position: relative;
  }
  .sticky {
    position: sticky;
    top: 0;
    z-index: 2;
  }
  .row {
    position: absolute;
    left: 0;
    display: flex;
    height: 28px;
  }
  .row.odd {
    background: var(--row-alt);
  }
  .row:hover {
    background: var(--row-hover);
  }
  .row.new-row {
    background: var(--ok-bg);
  }
  .row.deleted .cell:not(.num-col) {
    text-decoration: line-through;
    color: var(--danger);
    opacity: 0.7;
  }
  .head,
  .filter-row {
    position: relative;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
  }
  .head {
    height: 44px;
  }
  .filter-row {
    height: 32px;
  }
  .cell {
    flex: none;
    padding: 0 10px;
    line-height: 28px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    border-right: 1px solid var(--grid-line);
    font-family: var(--mono);
    font-size: 12.5px;
    cursor: default;
  }
  .cell.right {
    text-align: right;
  }
  .cell.null {
    color: var(--text-faint);
    font-style: italic;
  }
  .cell.changed {
    background: var(--warn-bg);
    color: var(--warn-text);
  }
  .cell.sel {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .cell.editing {
    padding: 0;
  }
  .cell.editing input {
    width: 100%;
    height: 28px;
    border-radius: 0;
    border: 2px solid var(--accent);
    font-family: var(--mono);
    font-size: 12.5px;
    padding: 0 8px;
  }
  .num-col {
    width: 56px;
    text-align: right;
    color: var(--text-faint);
    position: sticky;
    left: 0;
    background: var(--panel);
    z-index: 1;
  }
  .head .num-col {
    line-height: 44px;
  }
  .filter-icon {
    line-height: 32px;
    text-align: center;
  }
  .fcell {
    padding: 3px 4px;
    line-height: normal;
  }
  .fcell input {
    width: 100%;
    height: 25px;
    font-size: 12px;
    padding: 2px 7px;
    font-family: var(--mono);
  }
  .fcell input.active {
    border-color: var(--accent);
  }
  .hcell {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: flex-start;
    line-height: 1.25;
    gap: 1px;
    background: none;
    border: none;
    border-right: 1px solid var(--grid-line);
    color: var(--text);
    font-family: var(--sans);
    font-weight: 600;
    font-size: 12.5px;
    cursor: pointer;
    text-align: left;
  }
  .hcell.right {
    align-items: flex-end;
  }
  .hcell:hover {
    background: var(--row-hover);
  }
  .hname {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .htype {
    color: var(--text-faint);
    font-weight: 400;
    font-size: 10.5px;
    text-transform: lowercase;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .arrow {
    font-size: 9px;
    color: var(--accent);
  }
  .empty {
    position: absolute;
    left: 0;
    right: 0;
    text-align: center;
    color: var(--text-dim);
  }
</style>
