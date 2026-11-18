<script lang="ts" module>
  export interface EditorApi {
    replaceAll(text: string): void;
    focus(): void;
    insert(text: string): void;
  }
</script>

<script lang="ts">
  import { splitStatements } from '../engines/sql-split';
  import { onMount, onDestroy } from 'svelte';
  import type { EditorView } from '@codemirror/view';
  import { setDiagnostics, type Diagnostic } from '@codemirror/lint';
  import { createEditor, compartments, sqlLanguage, themeExtension, uppercaseKeywords, fontSize as fontSizeExt } from '../editor/setup';
  import type { EngineId, TableInfo } from '../engines/types';

  let {
    doc,
    engine,
    schema,
    dark,
    upperKeywords,
    fontSize,
    diagnostics = [],
    onChange,
    onRun,
    onFormat,
    api = $bindable(),
  }: {
    doc: string;
    engine: EngineId;
    schema: TableInfo[];
    dark: boolean;
    upperKeywords: boolean;
    fontSize: number;
    diagnostics?: Diagnostic[];
    onChange: (doc: string) => void;
    onRun: (text: string, offset: number) => void;
    onFormat: () => void;
    api?: EditorApi;
  } = $props();

  let host: HTMLDivElement;
  let view: EditorView | undefined;
  let names = new Set<string>();

  $effect(() => {
    names = new Set(schema.flatMap((t) => [t.name.toLowerCase(), ...t.columns.map((c) => c.name.toLowerCase())]));
  });

  function runText(mode: 'auto' | 'statement') {
    if (!view) return;
    const state = view.state;
    const sel = state.selection.main;
    const text = state.doc.toString();
    if (mode === 'auto' && !sel.empty) return onRun(state.sliceDoc(sel.from, sel.to), sel.from);
    if (mode === 'statement') {
      // Run the statement under the cursor (or the one just before it).
      const stmts = splitStatements(text);
      let pick = stmts[0];
      for (const s of stmts) if (s.offset <= sel.head) pick = s;
      if (pick) return onRun(pick.sql, pick.offset);
    }
    onRun(text, 0);
  }

  onMount(() => {
    view = createEditor(host, {
      doc,
      engine,
      schema,
      dark,
      upperKeywords,
      fontSize,
      isSchemaName: (w) => names.has(w),
      onChange: (d) => onChange(d),
      onRun: runText,
      onFormat: () => onFormat(),
    });
    api = {
      replaceAll(text: string) {
        view!.dispatch({ changes: { from: 0, to: view!.state.doc.length, insert: text } });
      },
      focus() {
        view!.focus();
      },
      insert(text: string) {
        const { from, to } = view!.state.selection.main;
        view!.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
        view!.focus();
      },
    };
    view.focus();
  });

  onDestroy(() => view?.destroy());

  // Keep the document in sync when the tab's SQL changes from outside.
  $effect(() => {
    const d = doc;
    if (view && d !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: d } });
    }
  });
  $effect(() => {
    view?.dispatch({ effects: compartments.language.reconfigure(sqlLanguage(engine, schema)) });
  });
  $effect(() => {
    view?.dispatch({ effects: compartments.theme.reconfigure(themeExtension(dark)) });
  });
  $effect(() => {
    view?.dispatch({ effects: compartments.upper.reconfigure(upperKeywords ? uppercaseKeywords((w) => names.has(w)) : []) });
  });
  $effect(() => {
    view?.dispatch({ effects: compartments.font.reconfigure(fontSizeExt(fontSize)) });
  });
  $effect(() => {
    const d = diagnostics;
    if (view) view.dispatch(setDiagnostics(view.state, d.filter((x) => x.to <= view!.state.doc.length)));
  });

  export function run(mode: 'auto' | 'statement' = 'auto') {
    runText(mode);
  }
</script>

<div class="editor" bind:this={host}></div>

<style>
  .editor {
    height: 100%;
    overflow: hidden;
  }
  .editor :global(.cm-editor) {
    height: 100%;
  }
  .editor :global(.cm-editor.cm-focused) {
    outline: none;
  }
  .editor :global(.cm-scroller) {
    line-height: 1.55;
  }
</style>
