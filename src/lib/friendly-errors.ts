// Turns raw engine errors into explanations a beginner can act on.
import type { EngineId, TableInfo } from '../engines/types';

export interface FriendlyError {
  /** Plain-language explanation. */
  message: string;
  /** Optional suggestion ("Did you mean ...?"). */
  hint?: string;
  /** Text inside the statement to underline. */
  token?: string;
  /** 1-based position inside the statement, when known. */
  position?: number;
}

function distance(a: string, b: string): number {
  a = a.toLowerCase();
  b = b.toLowerCase();
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

function closest(word: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestD = Infinity;
  for (const c of new Set(candidates)) {
    const dd = distance(word, c);
    if (dd < bestD) {
      bestD = dd;
      best = c;
    }
  }
  const limit = Math.max(2, Math.floor(word.length / 3));
  return best && bestD > 0 && bestD <= limit ? best : undefined;
}

const didYouMean = (word: string, options: string[]) => {
  const c = closest(word, options);
  return c ? `Did you mean \`${c}\`?` : undefined;
};

export function explainError(engine: EngineId, raw: string, schema: TableInfo[], position?: number): FriendlyError {
  const tables = schema.map((t) => t.name);
  const columns = schema.flatMap((t) => t.columns.map((c) => c.name));
  const first = raw.split('\n')[0].replace(/^(Error: )?/, '');
  let m: RegExpExecArray | null;

  // ----- unknown table -----
  if (
    (m = /no such table: (?:\w+\.)?(\S+)/i.exec(raw)) ||
    (m = /relation "([^"]+)" does not exist/i.exec(raw)) ||
    (m = /Table with name (\S+) does not exist/i.exec(raw))
  ) {
    const name = m[1].replace(/[!"]/g, '');
    const hint =
      didYouMean(name, tables) ??
      (tables.length ? `Tables in this database: ${tables.slice(0, 8).join(', ')}${tables.length > 8 ? ', …' : ''}.` : 'This database has no tables yet. Import a file or load the sample data first.');
    return { message: `There is no table called \`${name}\` in this ${label(engine)} database.`, hint, token: name, position };
  }

  // ----- unknown column -----
  if (
    (m = /no such column: (\S+)/i.exec(raw)) ||
    (m = /column "([^"]+)" does not exist/i.exec(raw)) ||
    (m = /Referenced column "([^"]+)" not found/i.exec(raw)) ||
    (m = /column (\S+) does not exist/i.exec(raw))
  ) {
    const full = m[1];
    const name = full.includes('.') ? full.split('.').pop()! : full;
    const msg = `There is no column called \`${name}\`${full.includes('.') ? ` in \`${full.split('.')[0]}\`` : ''}.`;
    let hint = didYouMean(name, columns);
    if (!hint && /^'.*'$|^".*"$/.test(name)) hint = 'Text values go in single quotes: \'like this\'. Double quotes are for column names.';
    if (!hint && engine === 'postgres' && /[A-Z]/.test(raw.slice(raw.indexOf('"') + 1, raw.lastIndexOf('"'))))
      hint = 'PostgreSQL folds unquoted names to lower case. Check the spelling and capitalisation.';
    return { message: msg, hint, token: name, position };
  }

  // ----- GROUP BY -----
  if (/must appear in the GROUP BY clause|must be part of an aggregate function|not in GROUP BY|GROUP BY clause or be used in an aggregate/i.test(raw)) {
    m = /column "([^"]+)"/i.exec(raw);
    return {
      message: 'When you use GROUP BY, every column in SELECT must either be listed in GROUP BY or be inside an aggregate like COUNT(), SUM() or AVG().',
      hint: m ? `Add \`${m[1].split('.').pop()}\` to GROUP BY, or wrap it in an aggregate function.` : undefined,
      token: m?.[1].split('.').pop(),
      position,
    };
  }

  // ----- aggregate misuse -----
  if (/misuse of aggregate|aggregate functions are not allowed in WHERE|WHERE clause cannot contain aggregates/i.test(raw)) {
    return {
      message: 'Aggregate functions like COUNT(), SUM() and AVG() cannot be used in WHERE. WHERE filters rows before grouping.',
      hint: 'To filter on an aggregate, use HAVING after GROUP BY.',
      position,
    };
  }

  // ----- ambiguous column -----
  if ((m = /ambiguous column name: (\S+)/i.exec(raw)) || (m = /column reference "([^"]+)" is ambiguous/i.exec(raw)) || (m = /Ambiguous reference to column name "([^"]+)"/i.exec(raw))) {
    return {
      message: `The column \`${m[1]}\` exists in more than one of the joined tables, so the database doesn't know which one you mean.`,
      hint: `Prefix it with the table name or alias, e.g. \`orders.${m[1]}\`.`,
      token: m[1],
      position,
    };
  }

  // ----- Postgres ROUND(double, int) -----
  if (/function round\(double precision, integer\) does not exist/i.test(raw)) {
    return {
      message: 'In PostgreSQL, ROUND(value, digits) only works on NUMERIC values, not floating-point ones.',
      hint: 'Cast it first: `ROUND(value::numeric, 2)`.',
      token: 'round',
      position,
    };
  }

  // ----- type mismatch -----
  if (/operator does not exist: (\w[\w ]*) [^ ]+ (\w[\w ]*)/i.test(raw) || /Cannot compare values of type|Could not convert string|invalid input syntax for type/i.test(raw)) {
    return {
      message: 'The values being compared or combined have different types (for example, text and a number).',
      hint: "Check quotes: numbers have no quotes (42), text uses single quotes ('Lagos'). You can also convert with CAST(value AS type).",
      position,
    };
  }

  // ----- constraint violations -----
  if (/UNIQUE constraint failed|duplicate key value|Duplicate key/i.test(raw)) {
    return { message: 'This would create a duplicate in a column that must be unique (often the primary key).', hint: 'Use a different key value, or UPDATE the existing row instead.', position };
  }
  if (/NOT NULL constraint failed|null value in column|NOT NULL constraint/i.test(raw)) {
    return { message: 'A required column was left empty (NULL).', hint: 'Provide a value for every column marked NOT NULL.', position };
  }
  if (/FOREIGN KEY constraint failed|violates foreign key constraint|foreign key constraint/i.test(raw)) {
    return {
      message: 'This breaks a foreign key: the row points at something that does not exist, or something else still points at this row.',
      hint: 'Insert the parent row first, or delete the child rows before the parent.',
      position,
    };
  }
  if (/already exists/i.test(raw)) {
    m = /(?:table|relation|Table with name) "?(\w+)"? already exists/i.exec(raw);
    return { message: `${m ? `\`${m[1]}\`` : 'That object'} already exists.`, hint: 'Use CREATE TABLE IF NOT EXISTS, or DROP it first.', position };
  }

  // ----- syntax errors -----
  if ((m = /near "([^"]*)": syntax error/i.exec(raw)) || (m = /syntax error at or near "([^"]*)"/i.exec(raw)) || (m = /syntax error at or near "?([^"\n]*)"?/i.exec(raw))) {
    const near = m[1];
    let hint = 'Check for a missing comma, an unclosed bracket or quote, or a misspelled keyword.';
    if (/^(FROM|WHERE|GROUP|ORDER|HAVING|LIMIT)$/i.test(near)) hint = `Look just before \`${near.toUpperCase()}\`: a trailing comma or a missing column is common.`;
    else if (closest(near, KEYWORDS)) hint = `\`${near}\` looks like a misspelled keyword. ${didYouMean(near, KEYWORDS)}`;
    return { message: `The database could not understand the SQL near \`${near || 'the end'}\`.`, hint, token: near || undefined, position };
  }
  if (/incomplete input|syntax error at end of input|unterminated/i.test(raw)) {
    return { message: 'The statement ends too early.', hint: 'Check for an unclosed bracket, quote or a missing part of the clause.', position };
  }
  if (/division by zero|Division by zero/i.test(raw)) {
    return { message: 'The query divided by zero.', hint: 'Use NULLIF(divisor, 0) to avoid it.', position };
  }

  return { message: first, position };
}

const KEYWORDS = ['SELECT', 'FROM', 'WHERE', 'GROUP', 'ORDER', 'HAVING', 'LIMIT', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'TABLE', 'VALUES', 'DISTINCT', 'BETWEEN', 'UNION', 'OFFSET'];

const label = (e: EngineId) => ({ sqlite: 'SQLite', duckdb: 'DuckDB', postgres: 'PostgreSQL' })[e];
