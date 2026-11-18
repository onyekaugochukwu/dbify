<script lang="ts">
  import type { ResultSet } from '../engines/types';

  let { result }: { result: ResultSet } = $props();

  const ROW_H = 28;
  const HEAD_H = 44;
  let scrollTop = $state(0);
  let viewportH = $state(400);
  let sort = $state<{ col: number; dir: 1 | -1 } | null>(null);
  let selected = $state<{ r: number; c: number } | null>(null);
  let scroller: HTMLDivElement;

  // Reset view state when a new result arrives.
  $effect(() => {
    result;
    sort = null;
    selected = null;
    scrollTop = 0;
    if (scroller) scroller.scrollTop = 0;
  });

  const NUMERIC = /int|double|float|real|numeric|decimal|number/i;
  const isNumericCol = $derived(
    result.columns.map((c, i) => NUMERIC.test(c.type) || (result.rows.length > 0 && result.rows.slice(0, 50).every((r) => r[i] === null || typeof r[i] === 'number'))),
  );

  const widths = $derived(
    result.columns.map((c, i) => {
      let w = Math.max(c.name.length + 3, (c.type || '').length * 0.85);
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
    const idx = result.rows.map((_, i) => i);
    if (!sort) return idx;
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

  const first = $derived(Math.max(0, Math.floor(scrollTop / ROW_H) - 5));
  const last = $derived(Math.min(order.length, Math.ceil((scrollTop + viewportH) / ROW_H) + 5));
  const visible = $derived(order.slice(first, last));

  function toggleSort(i: number) {
    if (!sort || sort.col !== i) sort = { col: i, dir: 1 };
    else if (sort.dir === 1) sort = { col: i, dir: -1 };
    else sort = null;
  }

  function fmt(v: unknown): string {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    return String(v);
  }

  function onKey(e: KeyboardEvent) {
    if (!selected) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      const v = result.rows[order[selected.r]][selected.c];
      navigator.clipboard?.writeText(v === null ? '' : fmt(v));
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
    else if (top + ROW_H * 2 > scroller.scrollTop + viewportH) scroller.scrollTop = top + ROW_H * 2 - viewportH;
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
  <div class="inner" style="width:{totalW}px; height:{order.length * ROW_H + HEAD_H}px">
    <div class="row head" style="width:{totalW}px">
      <div class="cell num-col">#</div>
      {#each result.columns as c, i}
        <button class="cell hcell" class:right={isNumericCol[i]} style="width:{widths[i]}px" onclick={() => toggleSort(i)} title="{c.name} · {c.type || 'unknown type'} — click to sort">
          <span class="hname">{c.name}{#if sort?.col === i}<span class="arrow">{sort.dir === 1 ? ' ▲' : ' ▼'}</span>{/if}</span>
          <span class="htype">{c.type || '\u00a0'}</span>
        </button>
      {/each}
    </div>
    {#each visible as rowIdx, k (rowIdx)}
      {@const r = first + k}
      <div class="row" class:odd={r % 2 === 1} style="top:{r * ROW_H + HEAD_H}px; width:{totalW}px">
        <div class="cell num-col">{r + 1}</div>
        {#each result.rows[rowIdx] as v, c}
          <div
            class="cell"
            class:null={v === null}
            class:right={isNumericCol[c]}
            class:sel={selected?.r === r && selected?.c === c}
            style="width:{widths[c]}px"
            title={v === null ? 'NULL' : fmt(v).length > 40 ? fmt(v) : undefined}
            onmousedown={() => (selected = { r, c })}
            role="gridcell"
            tabindex="-1"
          >
            {fmt(v)}
          </div>
        {/each}
      </div>
    {/each}
  </div>
  {#if result.rows.length === 0}
    <div class="empty">The query ran successfully but returned no rows.</div>
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
  .head {
    height: 44px;
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
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
  .cell.sel {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
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
  .head .num-col {
    line-height: 44px;
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
  }
  .arrow {
    font-size: 9px;
    color: var(--accent);
  }
  .empty {
    position: absolute;
    top: 48px;
    left: 0;
    right: 0;
    text-align: center;
    color: var(--text-dim);
  }
</style>
