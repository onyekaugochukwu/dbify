<script lang="ts">
  import Icon from './Icon.svelte';
  import { app, type Tab } from '../state.svelte';
  import { ENGINE_META, type TableInfo } from '../engines/types';
  import { loadJson, saveJson } from '../lib/persist';
  import { downloadBytes } from '../lib/download';

  let { tab }: { tab: Tab } = $props();

  const W = 230;
  const HEAD = 34;
  const ROW = 22;
  const st = $derived(app.dbs[tab.dbId]);
  const tables = $derived(st?.schema ?? []);
  const engineId = $derived(app.engineOf(tab.dbId));

  type Pos = Record<string, { x: number; y: number }>;
  let pos = $state<Pos>(loadJson<Pos>(`diagram:${tab.dbId}`, {}));
  let view = $state({ x: 20, y: 20, k: 1 });
  let svg: SVGSVGElement;
  let host: HTMLDivElement;
  let hover = $state<string | null>(null);

  const height = (t: TableInfo) => HEAD + t.columns.length * ROW + 8;

  /** Parents (referenced tables) on the left, tables that point at them to the right. */
  function autoLayout() {
    const level = new Map<string, number>();
    const byName = new Map(tables.map((t) => [t.name, t]));
    const depth = (t: TableInfo, seen = new Set<string>()): number => {
      if (level.has(t.name)) return level.get(t.name)!;
      if (seen.has(t.name)) return 0;
      seen.add(t.name);
      const refs = t.foreignKeys.map((f) => byName.get(f.refTable)).filter((x): x is TableInfo => !!x && x !== t);
      const d = refs.length ? 1 + Math.max(...refs.map((r) => depth(r, seen))) : 0;
      level.set(t.name, d);
      return d;
    };
    tables.forEach((t) => depth(t));
    const cols = new Map<number, TableInfo[]>();
    for (const t of tables) {
      const l = t.foreignKeys.length || tables.some((o) => o.foreignKeys.some((f) => f.refTable === t.name)) ? level.get(t.name)! : -1;
      cols.set(l, [...(cols.get(l) ?? []), t]);
    }
    const next: Pos = {};
    const keys = [...cols.keys()].sort((a, b) => a - b);
    keys.forEach((l, ci) => {
      let y = 0;
      for (const t of cols.get(l)!) {
        next[t.name] = { x: ci * (W + 90), y };
        y += height(t) + 36;
      }
    });
    pos = next;
    saveJson(`diagram:${tab.dbId}`, pos);
    fit();
  }

  $effect(() => {
    if (tables.length && tables.some((t) => !pos[t.name])) autoLayout();
  });

  function fit() {
    if (!host || !tables.length) return;
    const xs = tables.map((t) => pos[t.name]).filter(Boolean);
    if (!xs.length) return;
    const maxX = Math.max(...tables.map((t) => (pos[t.name]?.x ?? 0) + W));
    const maxY = Math.max(...tables.map((t) => (pos[t.name]?.y ?? 0) + height(t)));
    const minX = Math.min(...xs.map((p) => p.x));
    const minY = Math.min(...xs.map((p) => p.y));
    const k = Math.min(1.2, (host.clientWidth - 60) / (maxX - minX), (host.clientHeight - 60) / (maxY - minY));
    view = { k, x: 30 - minX * k, y: 30 - minY * k };
  }

  // Dragging tables and panning the canvas.
  function dragTable(e: PointerEvent, name: string) {
    e.stopPropagation();
    const start = { mx: e.clientX, my: e.clientY, x: pos[name].x, y: pos[name].y };
    const move = (ev: PointerEvent) => {
      pos[name] = { x: start.x + (ev.clientX - start.mx) / view.k, y: start.y + (ev.clientY - start.my) / view.k };
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      saveJson(`diagram:${tab.dbId}`, pos);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function pan(e: PointerEvent) {
    const start = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    const move = (ev: PointerEvent) => {
      view.x = start.vx + ev.clientX - start.x;
      view.y = start.vy + ev.clientY - start.y;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function wheel(e: WheelEvent) {
    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const k = Math.max(0.2, Math.min(3, view.k * (e.deltaY < 0 ? 1.1 : 0.9)));
    view = { k, x: mx - ((mx - view.x) * k) / view.k, y: my - ((my - view.y) * k) / view.k };
  }

  function zoom(f: number) {
    const k = Math.max(0.2, Math.min(3, view.k * f));
    const cx = host.clientWidth / 2, cy = host.clientHeight / 2;
    view = { k, x: cx - ((cx - view.x) * k) / view.k, y: cy - ((cy - view.y) * k) / view.k };
  }

  const links = $derived(
    tables.flatMap((t) =>
      t.foreignKeys
        .map((f) => {
          const target = tables.find((x) => x.name === f.refTable);
          const a = pos[t.name], b = target && pos[target.name];
          if (!target || !a || !b) return null;
          const ci = Math.max(0, t.columns.findIndex((c) => c.name === f.column));
          const ti = Math.max(0, target.columns.findIndex((c) => c.name === f.refColumn));
          const y1 = a.y + HEAD + ci * ROW + ROW / 2;
          const y2 = b.y + HEAD + ti * ROW + ROW / 2;
          const right = b.x >= a.x + W / 2;
          const x1 = right ? a.x + W : a.x;
          const x2 = right ? b.x : b.x + W;
          const dx = Math.max(40, Math.abs(x2 - x1) / 2) * (right ? 1 : -1);
          return { id: `${t.name}.${f.column}`, from: t.name, to: target.name, d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`, x1, y1, x2, y2, right, label: `${t.name}.${f.column} → ${target.name}.${f.refColumn}` };
        })
        .filter((x): x is NonNullable<typeof x> => !!x),
    ),
  );

  function exportSvg(): string {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    // Copy computed styles inline so the file looks the same outside dbify.
    const src = svg.querySelectorAll('*');
    clone.querySelectorAll('*').forEach((el, i) => {
      const cs = getComputedStyle(src[i]);
      const props = ['fill', 'stroke', 'stroke-width', 'font-size', 'font-weight', 'font-family'];
      (el as SVGElement).setAttribute('style', props.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';'));
    });
    const minX = Math.min(...tables.map((t) => pos[t.name].x)) - 20, minY = Math.min(...tables.map((t) => pos[t.name].y)) - 20;
    const maxX = Math.max(...tables.map((t) => pos[t.name].x + W)) + 20, maxY = Math.max(...tables.map((t) => pos[t.name].y + height(t))) + 20;
    clone.setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
    clone.setAttribute('width', String(maxX - minX));
    clone.setAttribute('height', String(maxY - minY));
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.querySelector('g.world')?.setAttribute('transform', '');
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(minX));
    rect.setAttribute('y', String(minY));
    rect.setAttribute('width', '100%');
    rect.setAttribute('height', '100%');
    rect.setAttribute('fill', bg);
    clone.insertBefore(rect, clone.querySelector('g.world'));
    // Marker colours use CSS variables; resolve them.
    const root = getComputedStyle(document.documentElement);
    return new XMLSerializer().serializeToString(clone).replace(/var\((--[\w-]+)\)/g, (_m, v) => root.getPropertyValue(v).trim() || '#888');
  }

  function downloadSvg() {
    downloadBytes(exportSvg(), `${app.db(tab.dbId)?.name ?? 'diagram'}.svg`, 'image/svg+xml');
  }

  async function downloadPng() {
    const text = exportSvg();
    const img = new Image();
    const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width * 2;
    canvas.height = img.height * 2;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    canvas.toBlob(async (b) => b && downloadBytes(new Uint8Array(await b.arrayBuffer()), `${app.db(tab.dbId)?.name ?? 'diagram'}.png`, 'image/png'));
  }
</script>

<div class="dv">
  <div class="toolbar">
    <span class="title"><Icon name="link" size={15} /> Diagram of {app.db(tab.dbId)?.name}</span>
    <span class="db">{ENGINE_META[engineId].label} · {tables.length} table{tables.length === 1 ? '' : 's'}</span>
    <span class="grow"></span>
    <button class="btn ghost" onclick={() => zoom(1.2)} title="Zoom in">＋</button>
    <button class="btn ghost" onclick={() => zoom(1 / 1.2)} title="Zoom out">－</button>
    <button class="btn" onclick={fit}>Fit</button>
    <button class="btn" onclick={autoLayout}>Tidy up</button>
    <button class="btn" onclick={() => app.refreshSchema(tab.dbId)} title="Reload tables"><Icon name="refresh" size={14} /></button>
    <button class="btn" onclick={downloadPng} disabled={!tables.length}><Icon name="download" size={14} /> PNG</button>
    <button class="btn" onclick={downloadSvg} disabled={!tables.length}><Icon name="download" size={14} /> SVG</button>
  </div>
  <div class="canvas" bind:this={host}>
    {#if !tables.length}
      <div class="empty">{st?.status === 'ready' ? 'This database has no tables yet.' : 'Loading…'}</div>
    {/if}
    <svg bind:this={svg} width="100%" height="100%" onpointerdown={pan} onwheel={wheel} role="img" aria-label="Entity-relationship diagram">
      <defs>
        <marker id="one" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="12" markerHeight="12" orient="auto-start-reverse">
          <path d="M8 1v10M11 1v10" stroke="var(--accent)" stroke-width="1.5" fill="none" />
        </marker>
        <marker id="many" viewBox="0 0 12 12" refX="1" refY="6" markerWidth="12" markerHeight="12" orient="auto-start-reverse">
          <path d="M1 6L11 1M1 6L11 11M1 6H11" stroke="var(--accent)" stroke-width="1.5" fill="none" />
        </marker>
      </defs>
      <g class="world" transform="translate({view.x},{view.y}) scale({view.k})">
        {#each links as l (l.id)}
          <path class="link" class:hl={hover === l.from || hover === l.to} d={l.d} marker-start="url(#many)" marker-end="url(#one)"><title>{l.label}</title></path>
        {/each}
        {#each tables as t (t.name)}
          {@const p = pos[t.name]}
          {#if p}
            <g
              class="table"
              class:hl={hover === t.name}
              transform="translate({p.x},{p.y})"
              onpointerdown={(e) => dragTable(e, t.name)}
              onpointerenter={() => (hover = t.name)}
              onpointerleave={() => (hover = null)}
              ondblclick={() => app.openTable(tab.dbId, t.name)}
              role="button"
              tabindex="-1"
            >
              <rect class="box" width={W} height={height(t)} rx="8" />
              <path class="head" d="M0 8a8 8 0 0 1 8-8h{W - 16}a8 8 0 0 1 8 8v{HEAD - 8}h-{W}z" />
              <text class="tname" x="12" y="22">{t.name}</text>
              {#if t.rowCount !== undefined}<text class="tcount" x={W - 10} y="22" text-anchor="end">{t.rowCount.toLocaleString()} rows</text>{/if}
              {#each t.columns as c, i}
                {@const fk = t.foreignKeys.some((f) => f.column === c.name)}
                <text class="cname" class:pk={c.pk} class:fk x="26" y={HEAD + i * ROW + 15}>{c.name}</text>
                <text class="ctype" x={W - 10} y={HEAD + i * ROW + 15} text-anchor="end">{c.type.toLowerCase().slice(0, 18)}</text>
                {#if c.pk}<text class="badge pkb" x="10" y={HEAD + i * ROW + 15}>PK</text>{:else if fk}<text class="badge fkb" x="10" y={HEAD + i * ROW + 15}>FK</text>{/if}
              {/each}
            </g>
          {/if}
        {/each}
      </g>
    </svg>
    <div class="legend">Drag tables to arrange them · scroll to zoom · drag the background to move · double-click a table to open its rows</div>
  </div>
</div>

<style>
  .dv {
    display: flex;
    flex-direction: column;
    height: 100%;
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
  .title {
    display: flex;
    gap: 6px;
    align-items: center;
    font-weight: 600;
  }
  .db {
    font-size: 12px;
    color: var(--text-faint);
  }
  .grow {
    flex: 1;
  }
  .canvas {
    position: relative;
    flex: 1;
    min-height: 0;
    background-color: var(--bg);
    background-image: radial-gradient(var(--grid-line) 1px, transparent 1px);
    background-size: 22px 22px;
    overflow: hidden;
  }
  svg {
    display: block;
    cursor: grab;
    touch-action: none;
  }
  .table {
    cursor: move;
  }
  .box {
    fill: var(--panel);
    stroke: var(--border);
    stroke-width: 1.2;
  }
  .table.hl .box {
    stroke: var(--accent);
    stroke-width: 2;
  }
  .head {
    fill: var(--panel-2);
  }
  .tname {
    fill: var(--text);
    font-weight: 700;
    font-size: 13.5px;
  }
  .tcount {
    fill: var(--text-faint);
    font-size: 10.5px;
  }
  .cname {
    fill: var(--text);
    font-size: 12.5px;
  }
  .cname.pk {
    font-weight: 700;
  }
  .ctype {
    fill: var(--text-faint);
    font-size: 10.5px;
  }
  .badge {
    font-size: 8.5px;
    font-weight: 700;
  }
  .pkb {
    fill: #e5b450;
  }
  .fkb {
    fill: #5fb3e8;
  }
  .link {
    fill: none;
    stroke: var(--text-faint);
    stroke-width: 1.5;
  }
  .link.hl {
    stroke: var(--accent);
    stroke-width: 2.5;
  }
  .empty {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-dim);
    pointer-events: none;
  }
  .legend {
    position: absolute;
    left: 12px;
    bottom: 10px;
    font-size: 11.5px;
    color: var(--text-faint);
    background: var(--panel);
    border: 1px solid var(--border);
    padding: 4px 10px;
    border-radius: 6px;
    pointer-events: none;
  }
</style>
