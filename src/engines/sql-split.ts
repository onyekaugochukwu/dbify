export interface Statement {
  sql: string;
  offset: number;
}

/**
 * Splits a script into statements on top-level semicolons. Understands
 * quotes, comments and PostgreSQL dollar-quoted bodies. Statements that are
 * only whitespace or comments are dropped. CREATE TRIGGER ... BEGIN ... END
 * blocks (SQLite) are kept together.
 */
export function splitStatements(text: string): Statement[] {
  const out: Statement[] = [];
  let start = 0;
  let i = 0;
  let beginDepth = 0;
  const n = text.length;

  const push = (end: number) => {
    const raw = text.slice(start, end);
    if (stripComments(raw).trim()) {
      const lead = raw.length - raw.trimStart().length;
      out.push({ sql: raw.trim(), offset: start + lead });
    }
  };

  while (i < n) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '-' && next === '-') {
      const e = text.indexOf('\n', i);
      i = e === -1 ? n : e + 1;
    } else if (c === '/' && next === '*') {
      const e = text.indexOf('*/', i + 2);
      i = e === -1 ? n : e + 2;
    } else if (c === "'" || c === '"' || c === '`') {
      // Postgres E'...' strings allow backslash escapes.
      const escapes = c === "'" && /[eE]/.test(text[i - 1] ?? '') && !/[A-Za-z0-9_]/.test(text[i - 2] ?? '');
      i++;
      while (i < n) {
        if (escapes && text[i] === '\\') i += 2;
        else if (text[i] === c) {
          if (text[i + 1] === c) i += 2;
          else break;
        } else i++;
      }
      i++;
    } else if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(i, i + 64));
      if (m && !/[A-Za-z0-9_]/.test(text[i - 1] ?? '')) {
        const tag = m[0];
        const e = text.indexOf(tag, i + tag.length);
        i = e === -1 ? n : e + tag.length;
      } else i++;
    } else if (/[A-Za-z]/.test(c) && !/[A-Za-z0-9_]/.test(text[i - 1] ?? '')) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i, i + 32))!;
      const w = m[0].toUpperCase();
      if (w === 'BEGIN' && /CREATE\s+(TEMP\w*\s+)?TRIGGER/i.test(text.slice(start, i))) beginDepth++;
      else if ((w === 'END' || w === 'CASE') && beginDepth > 0) {
        if (w === 'CASE') beginDepth++;
        else beginDepth--;
      }
      i += m[0].length;
    } else if (c === ';' && beginDepth === 0) {
      push(i);
      start = i + 1;
      i++;
    } else i++;
  }
  push(n);
  return out;
}

export function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** First keyword of a statement, upper-cased (WITH queries report the main verb). */
export function leadingKeyword(sql: string): string {
  const s = stripComments(sql).trim().replace(/^\(+/, '');
  const first = (/^[A-Za-z]+/.exec(s)?.[0] ?? '').toUpperCase();
  return first;
}

export function isReadOnly(sql: string): boolean {
  const k = leadingKeyword(sql);
  if (['SELECT', 'VALUES', 'SHOW', 'DESCRIBE', 'EXPLAIN', 'SUMMARIZE', 'TABLE', 'FROM'].includes(k)) return true;
  if (k === 'PRAGMA') return !/=/.test(sql);
  if (k === 'WITH') return !/\b(INSERT|UPDATE|DELETE|MERGE)\b/i.test(stripComments(sql));
  return false;
}
