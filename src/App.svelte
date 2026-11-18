<script lang="ts">
  import Icon from './components/Icon.svelte';
  import Explorer from './components/Explorer.svelte';
  import Lessons from './components/Lessons.svelte';
  import History from './components/History.svelte';
  import Help from './components/Help.svelte';
  import QueryView from './components/QueryView.svelte';
  import TableView from './components/TableView.svelte';
  import DiagramView from './components/DiagramView.svelte';
  import Welcome from './components/Welcome.svelte';
  import Dialog from './components/Dialog.svelte';
  import { app } from './state.svelte';
  import { ENGINE_META } from './engines/types';

  let sideWidth = $state(300);
  let installPrompt = $state<any>(null);

  $effect(() => {
    document.documentElement.dataset.theme = app.settings.theme;
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
  });

  function showPanel(p: typeof app.panel) {
    if (app.panel === p && app.sideOpen) app.sideOpen = false;
    else {
      app.panel = p;
      app.sideOpen = true;
    }
  }

  function toggleTheme() {
    app.settings.theme = app.settings.theme === 'dark' ? 'light' : 'dark';
    app.saveSettings();
  }

  function dragSide(e: PointerEvent) {
    const move = (ev: PointerEvent) => (sideWidth = Math.max(220, Math.min(560, ev.clientX - 52)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    e.preventDefault();
  }

  // Files dropped outside the explorer: .sql opens in the editor, data files are imported
  // into the current tab's database (or a new one).
  function onDrop(e: DragEvent) {
    if ((e.target as HTMLElement).closest('.explorer')) return;
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (!files.length) return;
    e.preventDefault();
    const dbId = app.activeTab?.dbId;
    for (const f of files.filter((f) => /\.sql$/i.test(f.name))) {
      f.text().then((sql) => (dbId ? app.newQuery(dbId, sql, f.name.replace(/\.sql$/i, '')) : app.newQueryAnywhere(sql)));
    }
    const data = files.filter((f) => !/\.sql$/i.test(f.name));
    if (!data.length) return;
    if (dbId) app.importFiles(dbId, data);
    else app.importAsNewDatabase(app.settings.defaultEngine, data);
  }

  function middleClose(e: MouseEvent, id: string) {
    if (e.button === 1) {
      e.preventDefault();
      app.closeTab(id);
    }
  }

  const kindIcon = { query: 'file', table: 'table', diagram: 'link' } as const;
</script>

<svelte:window ondragover={(e) => e.preventDefault()} ondrop={onDrop} />

<div class="app">
  <nav class="rail" aria-label="Main">
    <button class="logo" title="Home" onclick={() => (app.activeTabId = null)}>
      <svg viewBox="0 0 64 64" width="30" height="30" aria-hidden="true"><ellipse cx="32" cy="16" rx="18" ry="7" fill="#4f9cf7" /><path d="M14 16v30c0 3.9 8 7 18 7s18-3.1 18-7V16c0 3.9-8 7-18 7s-18-3.1-18-7z" fill="#3577d4" /><path d="M14 31c0 3.9 8 7 18 7s18-3.1 18-7" fill="none" stroke="var(--rail)" stroke-width="3" /></svg>
    </button>
    <button class="rail-btn" class:on={app.sideOpen && app.panel === 'explorer'} onclick={() => showPanel('explorer')} title="Databases"><Icon name="database" size={21} /></button>
    <button class="rail-btn" class:on={app.sideOpen && app.panel === 'lessons'} onclick={() => showPanel('lessons')} title="Lessons & exercises"><Icon name="book" size={21} /></button>
    <button class="rail-btn" class:on={app.sideOpen && app.panel === 'history'} onclick={() => showPanel('history')} title="Query history"><Icon name="refresh" size={20} /></button>
    <span class="grow"></span>
    {#if installPrompt}
      <button class="rail-btn" onclick={async () => { await installPrompt.prompt(); installPrompt = null; }} title="Install dbify as an app"><Icon name="install" size={20} /></button>
    {/if}
    <button class="rail-btn" onclick={toggleTheme} title="Switch to {app.settings.theme === 'dark' ? 'light' : 'dark'} theme"><Icon name={app.settings.theme === 'dark' ? 'sun' : 'moon'} size={20} /></button>
    <button class="rail-btn" class:on={app.sideOpen && app.panel === 'help'} onclick={() => showPanel('help')} title="Help & settings"><Icon name="help" size={21} /></button>
  </nav>

  {#if app.sideOpen}
    <aside class="side" style="width:{sideWidth}px">
      {#if app.panel === 'explorer'}<Explorer />{:else if app.panel === 'lessons'}<Lessons />{:else if app.panel === 'history'}<History />{:else}<Help />{/if}
    </aside>
    <div class="vsplit" onpointerdown={dragSide} role="separator" aria-orientation="vertical" aria-label="Resize sidebar"></div>
  {/if}

  <main class="main">
    <div class="tabbar" role="tablist">
      <button class="tab-home" class:on={!app.activeTab} onclick={() => (app.activeTabId = null)} title="Home"><Icon name="database" size={14} /></button>
      {#each app.tabs as t (t.id)}
        {@const d = app.db(t.dbId)}
        <div class="tab" class:on={t.id === app.activeTabId} role="tab" aria-selected={t.id === app.activeTabId} onauxclick={(e) => middleClose(e, t.id)}>
          <button class="tab-title" onclick={() => { app.activeTabId = t.id; app.persistWorkspace(); }} title="{t.title} · {d?.name} ({d ? ENGINE_META[d.engine].label : ''})">
            {#if d}<span class="eng {d.engine}">{ENGINE_META[d.engine].short}</span>{/if}
            <Icon name={kindIcon[t.kind]} size={13} />
            <span class="tname">{t.title}</span>
            {#if t.running}<span class="spinner"></span>{/if}
          </button>
          <button class="tab-x" onclick={() => app.closeTab(t.id)} title="Close"><Icon name="x" size={12} /></button>
        </div>
      {/each}
      <button class="tab-new" onclick={() => app.newQueryAnywhere()} title="New query"><Icon name="plus" size={15} /></button>
    </div>

    <div class="content">
      {#if app.activeTab}
        {#key app.activeTab.id}
          {#if app.activeTab.kind === 'table'}
            <TableView tab={app.activeTab} />
          {:else if app.activeTab.kind === 'diagram'}
            <DiagramView tab={app.activeTab} />
          {:else}
            <QueryView tab={app.activeTab} />
          {/if}
        {/key}
      {:else if app.started}
        <div class="scroll"><Welcome /></div>
      {/if}
    </div>
  </main>

  {#if app.dialog}<Dialog />{/if}

  <div class="toasts" aria-live="polite">
    {#each app.toasts as t (t.id)}
      <div class="toast {t.kind}">
        <span>{t.text}</span>
        <button onclick={() => app.dismiss(t.id)} aria-label="Dismiss"><Icon name="x" size={12} /></button>
      </div>
    {/each}
  </div>
</div>

<style>
  .app {
    display: flex;
    height: 100vh;
    overflow: hidden;
  }
  .rail {
    width: 52px;
    flex: none;
    background: var(--rail);
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 10px 0;
    gap: 4px;
    border-right: 1px solid var(--border);
  }
  .logo {
    margin-bottom: 10px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px;
  }
  .rail-btn {
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--text-dim);
    border-radius: 8px;
    cursor: pointer;
    position: relative;
  }
  .rail-btn:hover {
    color: var(--text);
    background: var(--row-hover);
  }
  .rail-btn.on {
    color: var(--text);
  }
  .rail-btn.on::before {
    content: '';
    position: absolute;
    left: -6px;
    top: 9px;
    bottom: 9px;
    width: 3px;
    border-radius: 2px;
    background: var(--accent);
  }
  .grow {
    flex: 1;
  }
  .side {
    flex: none;
    background: var(--side);
    overflow: hidden;
  }
  .vsplit {
    width: 4px;
    cursor: col-resize;
    background: var(--border);
    flex: none;
  }
  .vsplit:hover {
    background: var(--accent);
  }
  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg);
  }
  .tabbar {
    display: flex;
    align-items: stretch;
    background: var(--side);
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
    min-height: 38px;
    scrollbar-width: thin;
  }
  .tab-home {
    background: none;
    border: none;
    border-right: 1px solid var(--border);
    color: var(--text-faint);
    padding: 0 12px;
    cursor: pointer;
    position: relative;
  }
  .tab-home.on {
    color: var(--text);
    background: var(--bg);
  }
  .tab {
    display: flex;
    align-items: center;
    border-right: 1px solid var(--border);
    max-width: 250px;
    flex: none;
    position: relative;
  }
  .tab.on {
    background: var(--panel);
  }
  .tab.on::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    height: 2px;
    background: var(--accent);
  }
  .tab-title {
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    color: var(--text-dim);
    font: inherit;
    font-size: 13px;
    padding: 0 4px 0 10px;
    height: 100%;
    cursor: pointer;
    min-width: 0;
  }
  .tab.on .tab-title {
    color: var(--text);
  }
  .tname {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tab-x {
    background: none;
    border: none;
    color: var(--text-faint);
    padding: 4px;
    margin-right: 6px;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
  }
  .tab-x:hover {
    background: var(--row-hover);
    color: var(--text);
  }
  .tab-new {
    background: none;
    border: none;
    color: var(--text-dim);
    padding: 0 12px;
    cursor: pointer;
  }
  .tab-new:hover {
    color: var(--text);
  }
  .spinner {
    width: 10px;
    height: 10px;
    border: 2px solid var(--text-faint);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .content {
    flex: 1;
    min-height: 0;
  }
  .scroll {
    height: 100%;
    overflow: auto;
  }
  .toasts {
    position: fixed;
    right: 16px;
    bottom: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 300;
    max-width: 440px;
  }
  .toast {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    background: var(--panel);
    border: 1px solid var(--border);
    border-left: 4px solid var(--accent);
    border-radius: 8px;
    padding: 10px 12px;
    box-shadow: var(--shadow);
    font-size: 13.5px;
    line-height: 1.45;
  }
  .toast.success {
    border-left-color: var(--ok);
  }
  .toast.error {
    border-left-color: var(--danger);
  }
  .toast span {
    flex: 1;
  }
  .toast button {
    background: none;
    border: none;
    color: var(--text-faint);
    cursor: pointer;
    padding: 2px;
  }
  @media (max-width: 760px) {
    .side {
      position: absolute;
      left: 52px;
      top: 0;
      bottom: 0;
      z-index: 40;
      box-shadow: var(--shadow);
    }
    .vsplit {
      display: none;
    }
  }
</style>
