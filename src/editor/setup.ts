import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor, rectangularSelection, highlightSpecialChars, placeholder } from '@codemirror/view';
import { EditorState, Compartment, Prec, type Extension, type TransactionSpec } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab, toggleComment } from '@codemirror/commands';
import { bracketMatching, indentOnInput, syntaxHighlighting, HighlightStyle, syntaxTree, foldGutter } from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type Completion, type CompletionContext } from '@codemirror/autocomplete';
import { lintGutter } from '@codemirror/lint';
import { sql, SQLite, PostgreSQL, StandardSQL, type SQLNamespace } from '@codemirror/lang-sql';
import { tags as t } from '@lezer/highlight';
import type { EngineId, TableInfo } from '../engines/types';

export const KEYWORDS = new Set(
  `SELECT FROM WHERE AND OR NOT IN IS NULL LIKE ILIKE GLOB BETWEEN JOIN INNER LEFT RIGHT FULL OUTER CROSS ON USING
   GROUP BY ORDER HAVING LIMIT OFFSET AS DISTINCT UNION ALL INTERSECT EXCEPT CASE WHEN THEN ELSE END
   INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE VIEW INDEX DROP ALTER ADD COLUMN PRIMARY KEY FOREIGN
   REFERENCES UNIQUE DEFAULT CHECK CONSTRAINT WITH RECURSIVE ASC DESC EXISTS ANY SOME TRUE FALSE BEGIN COMMIT
   ROLLBACK TRANSACTION IF REPLACE OVER PARTITION ROWS RANGE PRECEDING FOLLOWING UNBOUNDED CURRENT ROW WINDOW
   FILTER RETURNING EXPLAIN ANALYZE NULLS FIRST LAST LATERAL NATURAL INTERVAL TRUNCATE RENAME TO COLLATE ESCAPE
   PRAGMA VACUUM AUTOINCREMENT CASCADE RESTRICT TEMPORARY TEMP SEQUENCE TRIGGER FOR EACH RECURSIVE QUALIFY
   INTEGER INT BIGINT SMALLINT VARCHAR BOOLEAN REAL NUMERIC DECIMAL DOUBLE PRECISION FLOAT CHAR SERIAL BLOB JSONB`
    .split(/\s+/)
    .filter(Boolean),
);

/** Function names are capitalised only when followed by "(". */
export const FUNCTIONS = new Set(
  `COUNT SUM AVG MIN MAX ROUND COALESCE UPPER LOWER LENGTH SUBSTR SUBSTRING CAST NULLIF ABS TRIM LTRIM RTRIM
   REPLACE RANK DENSE_RANK ROW_NUMBER NTILE LAG LEAD FIRST_VALUE LAST_VALUE NOW DATE_TRUNC EXTRACT STRFTIME
   CONCAT IFNULL INSTR DATE_PART STRING_AGG GROUP_CONCAT CEIL CEILING FLOOR POWER SQRT MOD`
    .split(/\s+/)
    .filter(Boolean),
);

const dialects = { sqlite: SQLite, postgres: PostgreSQL, duckdb: PostgreSQL } satisfies Record<EngineId, unknown>;

export function sqlLanguage(engine: EngineId, schema: TableInfo[]): Extension {
  const ns: SQLNamespace = {};
  for (const tbl of schema) {
    ns[tbl.name] = tbl.columns.map(
      (c): Completion => ({ label: c.name, type: 'property', detail: c.type.toLowerCase() + (c.pk ? ' · key' : ''), boost: 1 }),
    );
  }
  const support = sql({ dialect: dialects[engine] ?? StandardSQL, schema: ns, upperCaseKeywords: true });
  return [support, support.language.data.of({ autocomplete: columnSource(schema) })];
}

/**
 * Beginners type column names before they've written FROM, so offer every
 * column of every table (lang-sql only suggests them once a table is known).
 */
function columnSource(schema: TableInfo[]) {
  const byName = new Map<string, { type: string; tables: string[] }>();
  for (const t of schema)
    for (const c of t.columns) {
      const e = byName.get(c.name) ?? { type: c.type.toLowerCase(), tables: [] };
      e.tables.push(t.name);
      byName.set(c.name, e);
    }
  const options: Completion[] = [...byName].map(([name, e]) => ({
    label: name,
    type: 'property',
    detail: `${e.type} · ${e.tables.length > 2 ? e.tables.length + ' tables' : e.tables.join(', ')}`,
    boost: -1,
  }));
  return (ctx: CompletionContext) => {
    const word = ctx.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    if (ctx.state.sliceDoc(word.from - 1, word.from) === '.') return null;
    const node = syntaxTree(ctx.state).resolveInner(ctx.pos, -1);
    if (/String|Comment|QuotedIdentifier/i.test(node.name)) return null;
    return { from: word.from, options, validFor: /^[A-Za-z0-9_]*$/ };
  };
}

/**
 * Capitalises SQL keywords as you type, once the word is finished (space,
 * newline, comma, bracket or semicolon). Skips strings, comments, quoted
 * names, words after a dot (alias.column) and words that are names of your
 * own tables or columns (a column called "date" stays "date").
 */
export function uppercaseKeywords(isSchemaName: (word: string) => boolean): Extension {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged || !tr.isUserEvent('input')) return tr;
    const extra: { from: number; to: number; insert: string }[] = [];
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      if (fromA !== toA) return;
      const text = inserted.toString();
      if (!/^[\s(),;]/.test(text)) return;
      const line = tr.startState.doc.lineAt(fromA);
      const before = line.text.slice(0, fromA - line.from);
      const m = /(^|[^A-Za-z0-9_."'`$])([A-Za-z_]+)$/.exec(before);
      if (!m) return;
      const word = m[2];
      const upper = word.toUpperCase();
      if (word === upper) return;
      const isKw = KEYWORDS.has(upper) || (text[0] === '(' && FUNCTIONS.has(upper));
      if (!isKw || isSchemaName(word.toLowerCase())) return;
      const node = syntaxTree(tr.startState).resolveInner(fromA, -1);
      if (/String|Comment|QuotedIdentifier/i.test(node.name)) return;
      extra.push({ from: fromA - word.length, to: fromA, insert: upper });
    });
    if (!extra.length) return tr;
    return [tr, { changes: extra, sequential: true } as TransactionSpec];
  });
}

function highlight(dark: boolean) {
  const c = dark
    ? { kw: '#c792ea', fn: '#82aaff', str: '#c3e88d', num: '#f78c6c', cmt: '#6b7689', op: '#89ddff', type: '#ffcb6b', name: '#e6e9ef' }
    : { kw: '#7c3aed', fn: '#1d4ed8', str: '#15803d', num: '#c2410c', cmt: '#8a94a6', op: '#0e7490', type: '#a16207', name: '#1f2430' };
  return HighlightStyle.define([
    { tag: t.keyword, color: c.kw, fontWeight: '600' },
    { tag: [t.typeName, t.standard(t.name)], color: c.type },
    { tag: [t.function(t.variableName), t.standard(t.variableName)], color: c.fn },
    { tag: [t.string, t.special(t.string)], color: c.str },
    { tag: [t.number, t.bool, t.null], color: c.num },
    { tag: [t.lineComment, t.blockComment], color: c.cmt, fontStyle: 'italic' },
    { tag: [t.operator, t.punctuation], color: c.op },
    { tag: [t.name, t.propertyName, t.special(t.name)], color: c.name },
  ]);
}

export function themeExtension(dark: boolean): Extension {
  return [
    EditorView.theme(
      {
        '&': { height: '100%', backgroundColor: 'var(--editor-bg)', color: 'var(--text)' },
        '.cm-content': { caretColor: 'var(--accent)', fontFamily: 'var(--mono)' },
        '.cm-gutters': { backgroundColor: 'var(--editor-bg)', color: 'var(--text-faint)', border: 'none' },
        '.cm-activeLine': { backgroundColor: 'var(--active-line)' },
        '.cm-activeLineGutter': { backgroundColor: 'var(--active-line)', color: 'var(--text-dim)' },
        '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
        '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--selection) !important' },
        '.cm-tooltip': { backgroundColor: 'var(--panel)', border: '1px solid var(--border)', color: 'var(--text)' },
        '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--accent)', color: '#fff' },
        '.cm-completionDetail': { opacity: 0.7, fontStyle: 'normal', marginLeft: '1em' },
        '.cm-placeholder': { color: 'var(--text-faint)' },
        '.cm-diagnostic-error': { borderLeft: '3px solid var(--danger)' },
        '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--danger)', textUnderlineOffset: '3px' },
        '.cm-matchingBracket': { backgroundColor: 'var(--selection)', outline: 'none' },
      },
      { dark },
    ),
    syntaxHighlighting(highlight(dark)),
  ];
}

export interface EditorOptions {
  doc: string;
  engine: EngineId;
  schema: TableInfo[];
  dark: boolean;
  upperKeywords: boolean;
  fontSize: number;
  isSchemaName: (w: string) => boolean;
  onChange: (doc: string) => void;
  onRun: (mode: 'auto' | 'statement') => void;
  onFormat: () => void;
}

export const compartments = {
  language: new Compartment(),
  theme: new Compartment(),
  upper: new Compartment(),
  font: new Compartment(),
};

export const fontSize = (px: number) => EditorView.theme({ '&': { fontSize: px + 'px' } });

export function createEditor(parent: HTMLElement, o: EditorOptions): EditorView {
  const runKeys = Prec.highest(
    keymap.of([
      { key: 'Mod-Enter', run: () => (o.onRun('auto'), true) },
      { key: 'Shift-Mod-Enter', run: () => (o.onRun('statement'), true) },
      { key: 'F5', run: () => (o.onRun('auto'), true) },
      { key: 'Shift-Alt-f', run: () => (o.onFormat(), true) },
      { key: 'Mod-/', run: toggleComment },
    ]),
  );
  return new EditorView({
    parent,
    state: EditorState.create({
      doc: o.doc,
      extensions: [
        runKeys,
        lineNumbers(),
        highlightActiveLineGutter(),
        foldGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion({ activateOnTyping: true, icons: false }),
        rectangularSelection(),
        highlightActiveLine(),
        lintGutter(),
        placeholder('Write SQL here, then press Ctrl+Enter to run it.'),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
        compartments.language.of(sqlLanguage(o.engine, o.schema)),
        compartments.theme.of(themeExtension(o.dark)),
        compartments.upper.of(o.upperKeywords ? uppercaseKeywords(o.isSchemaName) : []),
        compartments.font.of(fontSize(o.fontSize)),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) o.onChange(u.state.doc.toString());
        }),
      ],
    }),
  });
}
