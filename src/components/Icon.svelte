<script lang="ts">
  // Small stroke icon set (24×24 grid).
  const paths: Record<string, string> = {
    play: 'M7 4.5v15l12-7.5z',
    database: 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
    table: 'M3 5h18v14H3zM3 10h18M3 15h18M9 10v9',
    view: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
    column: 'M8 4v16M16 4v16M4 4h16v16H4z',
    key: 'M15 7a4 4 0 1 1-3.9 4.8L4 19v-3h2v-2h2l1.1-1.1A4 4 0 0 1 15 7zm1.5 2.5h.01',
    link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
    book: 'M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5zM4 21.5A2.5 2.5 0 0 1 6.5 19H20v3H6.5',
    help: 'M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
    sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
    moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
    plus: 'M12 5v14M5 12h14',
    x: 'M6 6l12 12M18 6L6 18',
    refresh: 'M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6',
    save: 'M5 3h11l4 4v14H4V3zM8 3v5h8V3M8 21v-7h8v7',
    download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
    upload: 'M12 21V9M7 14l5-5 5 5M5 3h14',
    folder: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    chevron: 'M9 6l6 6-6 6',
    format: 'M4 6h16M4 10h10M4 14h16M4 18h10',
    file: 'M14 3H6v18h12V7zM14 3v4h4',
    sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
    lightbulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z',
    eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
    copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
    type: 'M4 7V4h16v3M9 20h6M12 4v16',
    statement: 'M5 4h14M5 9h9M5 14h14M5 19h9',
    install: 'M12 3v10M8 9l4 4 4-4M4 15v4h16v-4',
    warning: 'M12 3l10 18H2zM12 10v5M12 18h.01',
    info: 'M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20zM12 11v6M12 7h.01',
  };
  let { name, size = 16, title = '' }: { name: string; size?: number; title?: string } = $props();
</script>

<svg
  class="icon"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill={name === 'play' ? 'currentColor' : 'none'}
  stroke="currentColor"
  stroke-width="1.8"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden={title ? undefined : 'true'}
  role={title ? 'img' : undefined}
>
  {#if title}<title>{title}</title>{/if}
  <path d={paths[name] ?? ''} />
</svg>

<style>
  .icon {
    flex: none;
    display: inline-block;
    vertical-align: middle;
  }
</style>
