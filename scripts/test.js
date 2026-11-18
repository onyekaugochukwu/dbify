// End-to-end tests in real Chrome, for both builds:
//   - dist/          served over http (the GitHub Pages version)
//   - dist-single/   opened from disk with file:// (the double-click version)
// Run `npm run build` first. Set CHROME=/path/to/chrome if needed.
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';

const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome';
const FILES = resolve('test-output/files');
mkdirSync('test-output', { recursive: true });
let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ✓' : '  ✗'} ${msg}`);
  if (!cond) failures++;
};

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
function serve(dir) {
  return new Promise((done) => {
    const s = http
      .createServer((req, res) => {
        let p = join(dir, decodeURIComponent(req.url.split('?')[0]));
        if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
        if (!existsSync(p)) return res.writeHead(404).end();
        res.setHeader('Content-Type', types[extname(p)] ?? 'application/octet-stream');
        res.end(readFileSync(p));
      })
      .listen(0, () => done(s));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = (page, fn, arg, timeout = 90000) => page.waitForFunction(fn, { timeout, polling: 100 }, arg);

async function suite(browser, url, label) {
  console.log(`\n=== ${label}: ${url}`);
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1366, height: 820 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await until(page, () => window.dbify?.app?.engines.sqlite.status === 'ready' && window.dbify.app.tabs.length > 0);
  await sleep(500);
  ok(await page.evaluate(() => window.dbify.app.engines.sqlite.schema.length === 5), 'first visit loads the Naija Mart sample into SQLite');

  // --- typing with keyword capitalisation ---
  await page.evaluate(() => window.dbify.app.newTab('sqlite', '', 'typing'));
  await sleep(300);
  await page.click('.cm-content');
  await page.keyboard.type('select name, count(*) from products where unit_price > 1000 group by name;', { delay: 2 });
  const typed = await page.evaluate(() => window.dbify.app.activeTab.sql);
  ok(typed === 'SELECT name, COUNT(*) FROM products WHERE unit_price > 1000 GROUP BY name;', `keywords capitalised as you type → ${typed}`);
  await page.keyboard.type(" -- select from 'where'", { delay: 2 });
  ok((await page.evaluate(() => window.dbify.app.activeTab.sql)).endsWith("-- select from 'where'"), 'comments are left alone');

  // --- autocomplete offers schema columns ---
  await page.keyboard.press('Enter');
  await page.keyboard.type('SELECT unit_p', { delay: 5 });
  await page.waitForSelector('.cm-tooltip-autocomplete', { timeout: 5000 }).catch(() => {});
  const options = await page.$$eval('.cm-tooltip-autocomplete li', (els) => els.map((e) => e.textContent));
  ok(options.some((o) => o.includes('unit_price')), `autocomplete suggests columns (${options.slice(0, 3).join(' | ')})`);
  await page.keyboard.press('Escape');

  // --- friendly errors ---
  await page.evaluate(() => {
    const a = window.dbify.app;
    const t = a.activeTab;
    t.sql = 'SELECT nmae, unit_price\nFROM products;';
  });
  await sleep(200);
  await page.click('.toolbar .btn.primary');
  await until(page, () => window.dbify.app.activeTab.results?.length && !window.dbify.app.activeTab.running);
  await sleep(300);
  const friendly = await page.$eval('.friendly', (e) => e.textContent).catch(() => '');
  const hint = await page.$eval('.hint', (e) => e.textContent).catch(() => '');
  ok(/no column called/.test(friendly) && /Did you mean name/.test(hint), `friendly error: "${friendly}" / "${hint.trim()}"`);
  ok((await page.$$('.cm-lintRange-error')).length > 0, 'the bad column is underlined in the editor');
  await page.screenshot({ path: `test-output/${label}-error.png` });

  // --- all three engines: sample + every exercise solution ---
  for (const id of ['duckdb', 'postgres']) {
    await page.evaluate((id) => window.dbify.app.loadSample(id, true), id);
    await until(page, (id) => window.dbify.app.engines[id].schema.length === 5 && !window.dbify.app.engines[id].busy, id);
    const counts = await page.evaluate((id) => window.dbify.app.engines[id].schema.map((t) => `${t.name}:${t.rowCount}`).join(' '), id);
    ok(counts === 'customers:120 order_items:1629 orders:650 payments:539 products:42', `${id} sample loaded (${counts})`);
  }
  // run every exercise's solution through the real check flow on each engine
  const results = await page.evaluate(async () => {
    const { app } = window.dbify;
    const lines = [];
    for (const engine of ['sqlite', 'duckdb', 'postgres']) {
      for (const e of window.dbify.exercises) {
        if (e.checkable === false) continue;
        const tab = app.newTab(engine, e.solution, 'chk', e.id);
        await app.checkExercise(e, app.tabs.find((t) => t.id === tab.id));
        const c = app.checks[e.id];
        if (!c?.ok) lines.push(`${engine}/${e.id}: ${c?.message}`);
        app.closeTab(tab.id);
      }
    }
    return lines;
  });
  ok(results.length === 0, `every exercise solution passes its own check on all 3 engines${results.length ? '\n      ' + results.join('\n      ') : ''}`);

  // same answers across engines
  const cross = await page.evaluate(async () => {
    const { app } = window.dbify;
    const eng = {};
    for (const id of ['sqlite', 'duckdb', 'postgres']) eng[id] = await app.ensureEngine(id);
    const bad = [];
    for (const e of window.dbify.exercises) {
      if (e.checkable === false) continue;
      const r = {};
      for (const id of Object.keys(eng)) r[id] = (await eng[id].run(e.solution)).at(-1);
      const ordered = /ORDER\s+BY/i.test(e.solution);
      const n = (rs) => {
        const rows = rs.result.rows.map((row) => JSON.stringify(row.map((v) => (v === null ? null : typeof v === 'boolean' ? +v : /^-?\d+(\.\d+)?$/.test(String(v)) ? Number(Number(v).toFixed(2)) : v))));
        return (ordered ? rows : rows.sort()).join('|');
      };
      if (n(r.sqlite) !== n(r.duckdb) || n(r.sqlite) !== n(r.postgres)) bad.push(e.id);
    }
    return bad;
  });
  ok(cross.length === 0, `SQLite, DuckDB and Postgres give identical answers for every exercise ${cross.length ? cross.join(',') : ''}`);

  // --- run a query on each engine through the UI ---
  for (const id of ['duckdb', 'postgres']) {
    await page.evaluate((id) => window.dbify.app.newTab(id, "SELECT c.state, COUNT(*) AS orders\nFROM orders o JOIN customers c ON c.customer_id = o.customer_id\nGROUP BY c.state ORDER BY orders DESC LIMIT 5;", id), id);
    await sleep(300);
    await page.click('.cm-content');
    await page.keyboard.down('Control');
    await page.keyboard.press('Enter');
    await page.keyboard.up('Control');
    await until(page, () => window.dbify.app.activeTab.results?.length && !window.dbify.app.activeTab.running);
    const rows = JSON.parse(await page.evaluate(() => JSON.stringify(window.dbify.app.activeTab.results.at(-1).result?.rows)));
    ok(rows?.length === 5 && rows[0][0] === 'Lagos', `${id} query via the UI → ${JSON.stringify(rows?.[0])}`);
  }
  await page.screenshot({ path: `test-output/${label}-postgres.png` });

  // --- file import through the real file picker ---
  const files = ['fraud_data.csv', 'fraud.xlsx', 'people.json', 'scores.parquet'];
  for (const id of ['sqlite', 'duckdb', 'postgres']) {
    for (const f of files) {
      const before = await page.evaluate((id) => window.dbify.app.engines[id].schema.length, id);
      await page.evaluate(() => (window.dbify.app.panel = 'explorer'));
      const [chooser] = await Promise.all([page.waitForFileChooser(), page.evaluate((id) => {
        // same code path as the explorer's "Import file" menu item
        const input = document.createElement('input');
        input.type = 'file';
        input.onchange = () => window.dbify.app.importFiles(id, Array.from(input.files));
        input.click();
      }, id)]);
      await chooser.accept([join(FILES, f)]);
      await until(page, ([id, n]) => window.dbify.app.engines[id].schema.length > n && !window.dbify.app.engines[id].busy, [id, before]);
      await sleep(300);
    }
    const tables = await page.evaluate((id) => window.dbify.app.engines[id].schema.filter((t) => !['customers', 'orders', 'order_items', 'payments', 'products'].includes(t.name)).map((t) => `${t.name}(${t.rowCount}):${t.columns.map((c) => c.name + ' ' + c.type.toLowerCase()).join(',')}`), id);
    ok(tables.length === 5 && tables.every((t) => !/\(0\)/.test(t)), `${id} imported CSV, Excel (2 sheets), JSON, Parquet:\n      ${tables.join('\n      ')}`);
  }
  await page.screenshot({ path: `test-output/${label}-import.png` });

  // --- autosave & reload ---
  await page.evaluate(() => window.dbify.app.newTab('postgres', 'CREATE TABLE persisted (id INTEGER); INSERT INTO persisted VALUES (42);', 'persist'));
  await sleep(200);
  await page.evaluate(() => window.dbify.app.run(window.dbify.app.activeTab, window.dbify.app.activeTab.sql, 0));
  await sleep(4000); // autosave runs ~1.2 s after a change; Postgres dumps take a moment
  await page.reload();
  await until(page, () => ['sqlite', 'duckdb', 'postgres'].every((id) => window.dbify.app.engines[id].status === 'ready'), null, 120000);
  await sleep(1000);
  const after = await page.evaluate(() => Object.fromEntries(['sqlite', 'duckdb', 'postgres'].map((id) => [id, window.dbify.app.engines[id].schema.map((t) => t.name)])));
  ok(after.sqlite.includes('fraud_data') && after.duckdb.includes('scores') && after.postgres.includes('persisted'), `databases survive a reload: ${JSON.stringify(Object.fromEntries(Object.entries(after).map(([k, v]) => [k, v.length])))}`);
  ok(await page.evaluate(() => window.dbify.app.tabs.some((t) => t.title === 'persist')), 'open tabs survive a reload');

  // --- save to file and open again (DuckDB format round-trip) ---
  const roundtrip = await page.evaluate(async () => {
    const { app } = window.dbify;
    const out = {};
    for (const id of ['sqlite', 'duckdb', 'postgres']) {
      const e = await app.ensureEngine(id);
      const bytes = await e.exportBytes();
      await e.reset();
      await e.importBytes(bytes);
      out[id] = (await e.run('SELECT COUNT(*) FROM order_items'))[0].result?.rows[0][0] + ` (${Math.round(bytes.length / 1024)} KB)`;
    }
    return out;
  });
  ok(Object.values(roundtrip).every((v) => String(v).startsWith('1629')), `save database → open database round-trip ${JSON.stringify(roundtrip)}`);

  ok(errors.length === 0, `no uncaught page errors ${errors.join(' | ')}`);
  await ctx.close();
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'], protocolTimeout: 900000 });
try {
  const server = await serve('dist');
  await suite(browser, `http://localhost:${server.address().port}/`, 'hosted');
  server.close();
  await suite(browser, 'file://' + resolve('dist-single/index.html'), 'single-file');
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
