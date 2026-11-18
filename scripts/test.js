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
/** Evaluate and return plain JSON (Svelte state proxies don't serialise directly). */
const json = async (page, fn, arg) => JSON.parse(await page.evaluate(`(async () => JSON.stringify(await (${fn})(${JSON.stringify(arg)})))()`));
const clickText = async (page, selector, text) => {
  for (const h of await page.$$(selector)) if ((await h.evaluate((e) => e.textContent)).includes(text)) return h.click();
  throw new Error(`no ${selector} containing "${text}"`);
};
const dbByName = (page, engine, name) => page.evaluate(([e, n]) => window.dbify.app.databases.find((d) => d.engine === e && d.name === n)?.id, [engine, name]);
const selectAll = async (page) => {
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
};
const DATA_ROWS = '.tv .grid .row:not(.head):not(.filter-row)';

async function suite(browser, url, label) {
  console.log(`\n=== ${label}: ${url}`);
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1366, height: 820 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto(url);
  await until(page, () => window.dbify?.app?.started);
  await sleep(400);

  // ---------- landing page ----------
  const landing = await json(page, () => ({ tabs: window.dbify.app.tabs.length, dbs: window.dbify.app.databases.length, welcome: !!document.querySelector('.welcome'), panel: window.dbify.app.panel }));
  ok(landing.tabs === 0 && landing.dbs === 0 && landing.welcome && landing.panel === 'explorer', `first visit opens a clean home page: no tabs, no databases, no exercise (${JSON.stringify(landing)})`);
  await page.screenshot({ path: `test-output/${label}-landing.png` });

  // ---------- create databases through the dialog ----------
  for (const [engine, name] of [['sqlite', 'shop'], ['duckdb', 'shop'], ['postgres', 'shop'], ['sqlite', 'school']]) {
    await page.evaluate(() => (window.dbify.app.activeTabId = null));
    await sleep(150);
    await clickText(page, '.card', 'Create a database');
    await page.waitForSelector('.dialog');
    await page.click(`.dialog input[value="${engine}"]`);
    await page.click('.dialog .field input');
    await selectAll(page);
    await page.keyboard.type(name);
    if (label === 'hosted' && engine === 'sqlite' && name === 'shop') await page.screenshot({ path: `test-output/${label}-dialog.png` });
    await page.click('.dialog button[type="submit"]');
    await until(page, ([e, n]) => window.dbify.app.databases.some((d) => d.engine === e && d.name === n) && !document.querySelector('.dialog'), [engine, name]);
  }
  const created = await json(page, () => window.dbify.app.databases.map((d) => `${d.engine}:${d.name}`));
  ok(created.join(',') === 'sqlite:shop,duckdb:shop,postgres:shop,sqlite:school', `created 4 databases via the dialog: ${created.join(', ')}`);

  const shop = await dbByName(page, 'sqlite', 'shop');
  const school = await dbByName(page, 'sqlite', 'school');
  await page.evaluate(async ([a, b]) => {
    const { app } = window.dbify;
    const t1 = app.newQuery(a, "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO items VALUES (1, 'pen');");
    await app.run(app.tabs.find((t) => t.id === t1.id), t1.sql, 0);
    const t2 = app.newQuery(b, 'CREATE TABLE pupils (id INTEGER PRIMARY KEY, name TEXT);');
    await app.run(app.tabs.find((t) => t.id === t2.id), t2.sql, 0);
  }, [shop, school]);
  const sep = await json(page, ([a, b]) => [window.dbify.app.dbs[a].schema.map((t) => t.name), window.dbify.app.dbs[b].schema.map((t) => t.name)], [shop, school]);
  ok(sep[0].join() === 'items' && sep[1].join() === 'pupils', `two SQLite databases keep separate tables (${JSON.stringify(sep)})`);
  for (const engine of ['duckdb', 'postgres']) {
    const id = await dbByName(page, engine, 'shop');
    const r = await json(page, async (id) => (await (await window.dbify.app.ensureDb(id)).run('CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (7); SELECT x FROM t;')).at(-1).result.rows, id);
    ok(JSON.stringify(r) === '[[7]]', `${engine} database "shop" works`);
  }

  // ---------- sample database from the landing page ----------
  await page.evaluate(() => (window.dbify.app.activeTabId = null));
  await sleep(150);
  await clickText(page, '.card', 'Try the sample database');
  await until(page, () => window.dbify.app.activeTab?.results?.length && !window.dbify.app.activeTab.running);
  const sampleTab = await json(page, () => ({ db: window.dbify.app.db(window.dbify.app.activeTab.dbId).name, rows: window.dbify.app.activeTab.results.at(-1).result?.totalRows, ex: window.dbify.app.activeTab.exerciseId ?? null }));
  ok(sampleTab.db === 'naija_mart' && sampleTab.rows === 7 && sampleTab.ex === null, `"Try the sample database" creates naija_mart and runs a first query, not an exercise (${JSON.stringify(sampleTab)})`);
  await page.screenshot({ path: `test-output/${label}-sample.png` });
  const naija = await dbByName(page, 'sqlite', 'naija_mart');

  // ---------- editor ----------
  await page.evaluate((id) => window.dbify.app.newQuery(id, '', 'typing'), naija);
  await sleep(300);
  await page.click('.cm-content');
  await page.keyboard.type('select name, count(*) from products where unit_price > 1000 group by name;', { delay: 2 });
  const typed = await page.evaluate(() => window.dbify.app.activeTab.sql);
  ok(typed === 'SELECT name, COUNT(*) FROM products WHERE unit_price > 1000 GROUP BY name;', `keywords capitalised as you type → ${typed}`);
  await page.keyboard.press('Enter');
  await page.keyboard.type('SELECT unit_p', { delay: 5 });
  await page.waitForSelector('.cm-tooltip-autocomplete', { timeout: 5000 }).catch(() => {});
  const options = await page.$$eval('.cm-tooltip-autocomplete li', (els) => els.map((e) => e.textContent));
  ok(options.some((o) => o.includes('unit_price')), 'autocomplete suggests columns');
  await page.keyboard.press('Escape');
  await page.evaluate(() => (window.dbify.app.activeTab.sql = 'SELECT nmae, unit_price\nFROM products;'));
  await sleep(200);
  await page.click('.toolbar .btn.primary');
  await until(page, () => window.dbify.app.activeTab.results?.length && !window.dbify.app.activeTab.running);
  await sleep(300);
  const friendly = await page.$eval('.friendly', (e) => e.textContent).catch(() => '');
  ok(/no column called/.test(friendly) && (await page.$$('.cm-lintRange-error')).length > 0, 'friendly error with underline');

  // ---------- result search + form view ----------
  await page.evaluate(() => (window.dbify.app.activeTab.sql = 'SELECT * FROM customers ORDER BY customer_id;'));
  await sleep(150);
  await page.click('.toolbar .btn.primary');
  await until(page, () => window.dbify.app.activeTab.results?.at(-1)?.result && !window.dbify.app.activeTab.running);
  await page.type('.search', 'kano');
  await sleep(300);
  const visibleRows = await page.$$eval('.grid .row:not(.head):not(.filter-row)', (r) => r.length);
  ok(visibleRows > 0 && visibleRows < 20, `searching result rows narrows the grid (${visibleRows} rows contain "kano")`);
  await clickText(page, '.seg button', 'Form');
  await sleep(200);
  ok((await page.$$('.form .field')).length === 8, 'form view shows one row as 8 fields');

  // ---------- table data view: filter, sort, edit, insert, delete ----------
  for (const engine of ['sqlite', 'duckdb', 'postgres']) {
    if (engine !== 'sqlite') await page.evaluate((e) => window.dbify.app.loadSample(e, true), engine);
    const id = await dbByName(page, engine, 'naija_mart');
    await until(page, (id) => window.dbify.app.dbs[id]?.schema.length === 5, id);
    await page.evaluate((id) => window.dbify.app.openTable(id, 'products'), id);
    await page.waitForSelector(DATA_ROWS);
    await sleep(300);
    const inputs = await page.$$('.tv .fcell input');
    await inputs[2].type('phones');
    await page.keyboard.press('Enter');
    await until(page, () => /of 7\b/.test(document.querySelector('.tv .range')?.textContent ?? ''));
    await clickText(page, '.tv .hcell', 'unit_price');
    await sleep(300);
    await clickText(page, '.tv .hcell', 'unit_price');
    await sleep(500);
    const first = await page.$$eval(DATA_ROWS, (rows) => rows[0].innerText.split('\n').join('|'));
    ok(first.includes('iPhone 13'), `${engine}: filter (category contains "phones") + sort by price ↓ shows the iPhone first`);
    // A product that orders still point at can't be deleted: expect a clear explanation.
    let rows = await page.$$(`${DATA_ROWS}:not(.new-row)`);
    await (await rows[1].$('.cell[role="gridcell"]')).click();
    await clickText(page, '.tv .toolbar .btn', 'Delete row');
    await clickText(page, '.tv .footer .btn', 'Save changes');
    await until(page, () => window.dbify.app.toasts.some((t) => t.kind === 'error'), null, 20000).catch(() => {});
    const fkToast = await page.evaluate(() => window.dbify.app.toasts.find((t) => t.kind === 'error')?.text ?? '');
    ok(/Nothing was saved/.test(fkToast) && /foreign key/i.test(fkToast), `${engine}: deleting a product that has orders is refused and explained ("${fkToast.slice(0, 90)}…")`);
    await page.evaluate(() => window.dbify.app.toasts.splice(0));
    await clickText(page, '.tv .footer .btn', 'Discard');
    await sleep(200);
    // edit the stock of the second row
    const cells = await page.$$(`${DATA_ROWS} .cell[role="gridcell"]`);
    await cells[9].click({ count: 2 });
    await selectAll(page);
    await page.keyboard.type('999');
    await page.keyboard.press('Enter');
    // add a row, typing into each cell
    await clickText(page, '.tv .toolbar .btn', 'Add row');
    await sleep(150);
    const values = ['500', 'Test Phone', 'Phones', '12345.5', '3'];
    for (let i = 0; i < values.length; i++) {
      const cell = (await (await page.$('.tv .row.new-row')).$$('.cell'))[i + 1];
      await cell.click({ count: 2 });
      await page.keyboard.type(values[i]);
      await page.keyboard.press('Enter');
      await sleep(60);
    }
    // delete the first row (the refurbished iPhone, which nobody has ordered)
    rows = await page.$$(`${DATA_ROWS}:not(.new-row)`);
    await (await rows[0].$('.cell[role="gridcell"]')).click();
    await clickText(page, '.tv .toolbar .btn', 'Delete row');
    await sleep(150);
    const preview = await page.$eval('.tv .footer .pending', (e) => e.textContent).catch(() => '');
    await clickText(page, '.tv .footer .btn', 'Save changes');
    await until(page, () => !document.querySelector('.tv .footer .pending'), null, 30000).catch(() => {});
    await sleep(500);
    const check = await json(page, async (id) => {
      const r = await (await window.dbify.app.ensureDb(id)).run("SELECT (SELECT COUNT(*) FROM products WHERE stock = 999), (SELECT COUNT(*) FROM products WHERE product_id = 500), (SELECT COUNT(*) FROM products WHERE name LIKE 'iPhone%'), (SELECT COUNT(*) FROM products WHERE category = 'Phones')");
      return r[0].result?.rows[0] ?? r[0].error;
    }, id);
    ok(JSON.stringify(check) === '[1,1,0,7]', `${engine}: edited a cell, added a row, deleted a row, saved (${preview} → ${JSON.stringify(check)})`);
    if (engine === 'postgres') await page.screenshot({ path: `test-output/${label}-table-edit.png` });
  }

  // ---------- table without a primary key (rowid / ctid) ----------
  for (const engine of ['sqlite', 'duckdb', 'postgres']) {
    const id = await dbByName(page, engine, 'shop');
    await page.evaluate(async (id) => {
      const e = await window.dbify.app.ensureDb(id);
      await e.run("CREATE TABLE notes (body TEXT, n INTEGER); INSERT INTO notes VALUES ('a', 1), ('b', 2);");
      await window.dbify.app.refreshSchema(id);
      window.dbify.app.openTable(id, 'notes');
    }, id);
    await page.waitForSelector(DATA_ROWS);
    await sleep(300);
    const cells = await page.$$(`${DATA_ROWS} .cell[role="gridcell"]`);
    await cells[3].click({ count: 2 });
    await selectAll(page);
    await page.keyboard.type('42');
    await page.keyboard.press('Enter');
    await clickText(page, '.tv .footer .btn', 'Save changes');
    await sleep(800);
    const r = await json(page, async (id) => (await (await window.dbify.app.ensureDb(id)).run("SELECT n FROM notes WHERE body = 'b'"))[0].result?.rows, id);
    ok(JSON.stringify(r) === '[[42]]', `${engine}: editing a table without a primary key works (${JSON.stringify(r)})`);
  }

  // ---------- ER diagram ----------
  await page.evaluate((id) => window.dbify.app.openDiagram(id), naija);
  await page.waitForSelector('.dv g.table');
  await sleep(500);
  const diagram = await page.evaluate(() => ({ tables: document.querySelectorAll('.dv g.table').length, links: document.querySelectorAll('.dv path.link').length }));
  ok(diagram.tables === 5 && diagram.links === 4, `ER diagram shows 5 tables and 4 relationships (${JSON.stringify(diagram)})`);
  await page.screenshot({ path: `test-output/${label}-diagram.png` });

  // ---------- history ----------
  const hist = await json(page, () => window.dbify.app.history.length);
  ok(hist >= 3, `query history recorded ${hist} entries`);

  // ---------- file import into a database ----------
  const files = ['fraud_data.csv', 'fraud.xlsx', 'people.json', 'scores.parquet'];
  for (const engine of ['sqlite', 'duckdb', 'postgres']) {
    const id = await dbByName(page, engine, 'shop');
    for (const f of files) {
      const before = await page.evaluate((id) => window.dbify.app.dbs[id].schema.length, id);
      const [chooser] = await Promise.all([
        page.waitForFileChooser(),
        page.evaluate((id) => {
          const input = document.createElement('input');
          input.type = 'file';
          input.onchange = () => window.dbify.app.importFiles(id, Array.from(input.files));
          input.click();
        }, id),
      ]);
      await chooser.accept([join(FILES, f)]);
      await until(page, ([id, n]) => window.dbify.app.dbs[id].schema.length > n && !window.dbify.app.dbs[id].busy, [id, before]);
    }
    const tables = await json(page, (id) => window.dbify.app.dbs[id].schema.map((t) => `${t.name}(${t.rowCount})`), id);
    ok(['fraud_data(50)', 'fraud_fraud(50)', 'fraud_other(2)', 'people(2)', 'scores(3)'].every((t) => tables.includes(t)), `${engine}: imported CSV, Excel, JSON, Parquet → ${tables.join(' ')}`);
  }

  // ---------- every exercise on every engine ----------
  const results = await json(page, async () => {
    const { app } = window.dbify;
    const lines = [];
    for (const engine of ['sqlite', 'duckdb', 'postgres']) {
      const db = await app.loadSample(engine, true); // fresh copy (the edit test changed it)
      for (const e of window.dbify.exercises) {
        if (e.checkable === false) continue;
        const tab = app.newQuery(db.id, e.solution, 'chk', e.id);
        await app.checkExercise(e, app.tabs.find((t) => t.id === tab.id));
        if (!app.checks[e.id]?.ok) lines.push(`${engine}/${e.id}: ${app.checks[e.id]?.message}`);
        app.closeTab(tab.id);
      }
    }
    return lines;
  });
  ok(results.length === 0, `every exercise passes its check on all 3 engines${results.length ? '\n      ' + results.join('\n      ') : ''}`);

  // ---------- reload keeps everything; delete works ----------
  await sleep(3500); // let autosave finish
  await page.reload();
  await until(page, () => window.dbify?.app?.started);
  for (const id of await page.evaluate(() => window.dbify.app.databases.map((d) => d.id))) await page.evaluate((id) => window.dbify.app.ensureDb(id), id);
  await until(page, () => window.dbify.app.databases.every((d) => window.dbify.app.dbs[d.id].status === 'ready'), null, 120000);
  const after = await json(page, () => window.dbify.app.databases.map((d) => `${d.engine}:${d.name}=${window.dbify.app.dbs[d.id].schema.length}`));
  ok(after.length === 7 && after.includes('postgres:shop=7') && after.includes('sqlite:school=1'), `all 7 databases and their tables survive a reload: ${after.join(' ')}`);
  await page.evaluate(async (id) => window.dbify.app.deleteDatabase(id), school);
  ok(!(await page.evaluate((id) => !!window.dbify.app.db(id), school)), 'deleting a database removes it');
  ok(errors.length === 0, `no uncaught page errors ${errors.join(' | ')}`);

  // ---------- a share link opens in a fresh browser ----------
  const url2 = await page.evaluate(() => {
    const payload = { e: 'duckdb', q: 'SELECT COUNT(*) AS n FROM customers;', s: 1, t: 'Shared!' };
    const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return location.href.split('#')[0] + '#share=' + b64;
  });
  const ctx2 = await browser.createBrowserContext();
  const p2 = await ctx2.newPage();
  await p2.goto(url2);
  await until(p2, () => window.dbify?.app?.activeTab?.title === 'Shared!', null, 120000);
  const shared = await json(p2, () => ({ db: window.dbify.app.db(window.dbify.app.activeTab.dbId), sql: window.dbify.app.activeTab.sql }));
  ok(shared.db.engine === 'duckdb' && shared.db.sample && shared.sql.startsWith('SELECT COUNT'), 'a shared link opens the query, with the sample database, in a fresh browser');
  await ctx2.close();
  await ctx.close();
}

async function migration(browser, url) {
  console.log('\n=== upgrade from Phase 1 storage');
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.goto(url);
  await until(page, () => window.dbify?.app?.started);
  // Recreate what Phase 1 left behind: a SQLite database saved under "sqlite", old-style tabs.
  await page.evaluate(async () => {
    const e = await window.dbify.createEngine('sqlite');
    await e.init(null);
    await e.run('CREATE TABLE old_table (x INTEGER); INSERT INTO old_table VALUES (1);');
    const bytes = await e.exportBytes();
    await new Promise((res) => {
      const r = indexedDB.open('dbify', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('databases');
      r.onsuccess = () => {
        const tx = r.result.transaction('databases', 'readwrite');
        tx.objectStore('databases').put(bytes, 'sqlite');
        tx.oncomplete = () => res();
      };
    });
    localStorage.removeItem('dbify:databases');
    localStorage.setItem('dbify:workspace', JSON.stringify({ tabs: [{ id: 'old1', title: 'Old query', engine: 'sqlite', sql: 'SELECT * FROM old_table;' }], active: 'old1', started: true }));
  });
  await page.reload();
  await until(page, () => window.dbify?.app?.started && window.dbify.app.dbs.sqlite?.status === 'ready');
  const m = await json(page, () => ({ dbs: window.dbify.app.databases.map((d) => d.name), tables: window.dbify.app.dbs.sqlite.schema.map((t) => t.name), tab: window.dbify.app.tabs[0]?.title }));
  ok(m.dbs.join() === 'main' && m.tables.join() === 'old_table' && m.tab === 'Old query', `Phase 1 data becomes a database called "main" (${JSON.stringify(m)})`);
  await ctx.close();
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'], protocolTimeout: 900000 });
try {
  const server = await serve('dist');
  const base = `http://localhost:${server.address().port}/`;
  await suite(browser, base, 'hosted');
  await migration(browser, base);
  server.close();
  await suite(browser, 'file://' + resolve('dist-single/index.html'), 'single-file');
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
