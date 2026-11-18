<script lang="ts">
  import Icon from './Icon.svelte';
  import { app, ENGINE_IDS, exercises, sample } from '../state.svelte';
  import { ENGINE_META, type EngineId } from '../engines/types';
  import type { Exercise } from '../lessons/exercises';

  let engine = $state<EngineId>(app.settings.defaultEngine);
  let selectedId = $state<string | null>(null);
  const selected = $derived(exercises.find((e) => e.id === selectedId) ?? null);
  let showHint = $state(false);
  let showSolution = $state(false);

  const levels = [...new Set(exercises.map((e) => e.level))];
  const done = $derived(exercises.filter((e) => app.completed[e.id]).length);
  const sampleDb = $derived(app.sampleDb(engine));
  const hasSample = (id: EngineId) => {
    const d = app.sampleDb(id);
    return !!d && (app.dbs[d.id]?.status !== 'ready' || app.dbs[d.id].schema.some((t) => t.name === 'order_items'));
  };
  let loading = $state(false);
  async function load() {
    loading = true;
    try {
      await app.loadSample(engine);
    } finally {
      loading = false;
    }
  }

  function select(ex: Exercise) {
    selectedId = ex.id;
    showHint = false;
    showSolution = false;
  }

  function useSolution(ex: Exercise) {
    const tab = app.tabs.find((t) => t.exerciseId === ex.id && app.engineOf(t.dbId) === engine);
    const code = `-- Reference answer for: ${ex.title}\n${ex.solution}\n`;
    if (tab) {
      tab.sql = code;
      app.activeTabId = tab.id;
    } else if (sampleDb) app.newQuery(sampleDb.id, code, ex.title, ex.id);
  }
</script>

<div class="lessons">
  <div class="head">
    <h2>Lessons</h2>
  </div>

  {#if !selected}
    <section class="sample">
      <div class="title"><Icon name="sparkle" size={15} /> {sample.name} sample database</div>
      <p>{sample.description}</p>
      <div class="engine-row">
        <span>Practise with</span>
        <select bind:value={engine}>
          {#each ENGINE_IDS as id}<option value={id}>{ENGINE_META[id].label}</option>{/each}
        </select>
      </div>
      {#if hasSample(engine)}
        <p class="ok"><Icon name="check" size={13} /> Ready as <code>{sampleDb?.name}</code> in {ENGINE_META[engine].label}.
          <button class="linkish" onclick={load}>{loading ? 'Resetting…' : 'Reset to a fresh copy'}</button></p>
      {:else}
        <button class="btn primary full" disabled={loading} onclick={load}>
          {loading ? 'Loading…' : `Add it to ${ENGINE_META[engine].label}`}
        </button>
      {/if}
    </section>

    <div class="progress">
      <div class="bar"><div class="fill" style="width:{(done / exercises.length) * 100}%"></div></div>
      <span>{done} / {exercises.length} done</span>
    </div>

    <div class="list">
      {#each levels as level}
        <h3>{level}</h3>
        {#each exercises.filter((e) => e.level === level) as ex, i}
          <button class="ex" onclick={() => select(ex)}>
            <span class="num" class:done={app.completed[ex.id]}>
              {#if app.completed[ex.id]}<Icon name="check" size={12} />{:else}{exercises.indexOf(ex) + 1}{/if}
            </span>
            <span class="extitle">{ex.title}</span>
          </button>
        {/each}
      {/each}
    </div>
  {:else}
    {@const ex = selected}
    <div class="detail">
      <button class="back linkish" onclick={() => (selectedId = null)}>← All exercises</button>
      <div class="level">{ex.level} · Exercise {exercises.indexOf(ex) + 1}</div>
      <h3 class="dtitle">{ex.title}</h3>
      <p class="prompt">{ex.prompt}</p>

      {#if !hasSample(engine)}
        <p class="warn">"Write my answer" will add the sample database to {ENGINE_META[engine].label} first.</p>
      {/if}

      <div class="actions">
        <button class="btn primary" onclick={() => app.openExercise(ex, engine)}><Icon name="file" size={14} /> Write my answer</button>
        {#if ex.checkable !== false}
          {@const tab = app.tabs.find((t) => t.exerciseId === ex.id && app.engineOf(t.dbId) === engine)}
          <button class="btn" disabled={!tab} title={tab ? 'Run your SQL and compare it with the expected result' : 'Open the exercise first'} onclick={() => tab && app.checkExercise(ex, tab)}>
            <Icon name="check" size={14} /> Check answer
          </button>
        {/if}
      </div>

      {#if app.checks[ex.id]}
        <div class="result" class:ok={app.checks[ex.id].ok}>{app.checks[ex.id].message}</div>
      {/if}
      {#if ex.checkable === false}
        <p class="note">This exercise changes data, so it isn't checked automatically. Reload the sample afterwards to undo your changes.</p>
      {/if}

      <button class="reveal" onclick={() => (showHint = !showHint)}><Icon name="lightbulb" size={14} /> {showHint ? 'Hide hint' : 'Show a hint'}</button>
      {#if showHint}<p class="hint">{ex.hint}</p>{/if}

      <button class="reveal" onclick={() => (showSolution = !showSolution)}><Icon name="eye" size={14} /> {showSolution ? 'Hide answer' : 'Show the answer'}</button>
      {#if showSolution}
        <pre class="solution">{ex.solution}</pre>
        <button class="linkish" onclick={() => useSolution(ex)}>Put the answer in the editor</button>
      {/if}

      <div class="nav">
        {#if exercises.indexOf(ex) > 0}
          <button class="btn ghost small" onclick={() => select(exercises[exercises.indexOf(ex) - 1])}>← Previous</button>
        {/if}
        <span class="grow"></span>
        {#if exercises.indexOf(ex) < exercises.length - 1}
          <button class="btn ghost small" onclick={() => select(exercises[exercises.indexOf(ex) + 1])}>Next →</button>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .lessons {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: auto;
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
  .sample {
    margin: 6px 12px 10px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--panel-2);
  }
  .sample .title {
    font-weight: 600;
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .sample p {
    font-size: 12.5px;
    color: var(--text-dim);
    margin: 6px 0 10px;
    line-height: 1.5;
  }
  .sample p.ok {
    color: var(--ok-text);
    display: flex;
    gap: 5px;
    align-items: center;
    flex-wrap: wrap;
    margin: 0;
  }
  .engine-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    margin-bottom: 10px;
  }
  .engine-row select {
    flex: 1;
  }
  .full {
    width: 100%;
    justify-content: center;
  }
  .progress {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 14px 6px;
    font-size: 12px;
    color: var(--text-dim);
  }
  .bar {
    flex: 1;
    height: 6px;
    background: var(--input-bg);
    border-radius: 3px;
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--ok);
    transition: width 0.3s;
  }
  .list {
    padding: 0 8px 16px;
  }
  h3 {
    font-size: 12px;
    color: var(--text-dim);
    margin: 14px 8px 4px;
    font-weight: 600;
  }
  .ex {
    display: flex;
    gap: 10px;
    align-items: center;
    width: 100%;
    background: none;
    border: none;
    color: var(--text);
    font: inherit;
    font-size: 13.5px;
    padding: 6px 8px;
    border-radius: 6px;
    cursor: pointer;
    text-align: left;
  }
  .ex:hover {
    background: var(--row-hover);
  }
  .num {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--input-bg);
    color: var(--text-dim);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    flex: none;
  }
  .num.done {
    background: var(--ok);
    color: #fff;
  }
  .detail {
    padding: 4px 16px 20px;
  }
  .back {
    margin-bottom: 10px;
  }
  .level {
    font-size: 11.5px;
    color: var(--text-faint);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .dtitle {
    font-size: 17px;
    color: var(--text);
    margin: 4px 0 8px;
  }
  .prompt {
    font-size: 14px;
    line-height: 1.55;
    margin: 0 0 12px;
  }
  .warn {
    font-size: 12.5px;
    color: var(--warn-text);
    background: var(--warn-bg);
    padding: 8px 10px;
    border-radius: 6px;
  }
  .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 10px;
  }
  .result {
    font-size: 13px;
    padding: 8px 10px;
    border-radius: 6px;
    background: var(--warn-bg);
    color: var(--warn-text);
    margin-bottom: 10px;
  }
  .result.ok {
    background: var(--ok-bg);
    color: var(--ok-text);
  }
  .note {
    font-size: 12.5px;
    color: var(--text-dim);
  }
  .reveal {
    display: flex;
    gap: 6px;
    align-items: center;
    background: none;
    border: none;
    color: var(--accent);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
    padding: 6px 0;
  }
  .hint {
    font-size: 13px;
    color: var(--text-dim);
    margin: 0 0 6px 20px;
    line-height: 1.5;
  }
  .solution {
    font-family: var(--mono);
    font-size: 12.5px;
    background: var(--editor-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px;
    white-space: pre-wrap;
    margin: 4px 0 6px;
  }
  code {
    font-family: var(--mono);
    font-size: 12px;
  }
  .linkish {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    padding: 0;
    font: inherit;
    font-size: 13px;
    text-decoration: underline;
  }
  .nav {
    display: flex;
    margin-top: 18px;
  }
  .grow {
    flex: 1;
  }
</style>
