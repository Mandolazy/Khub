/*
 * Test — P0-c.1: salvataggio su PostgREST REALE (locale), non sul database fittizio.
 *
 * PostgreSQL locale e temporaneo + PostgREST locale (binario ufficiale) +
 * pagina reale (khub_mvp.html) + server reale (api/chat.js) nel browser
 * Chromium. Lo schema e' quello di base (scripts/db/p0c-schema-base-locale.sql)
 * con TUTTE le migrazioni del repository applicate in ordine, 0012 compresa.
 * Mai Supabase, nessuna AI reale (risposte simulate), nessuna rete esterna.
 *
 * Richiede:
 *   KHUB_PG_TEST       es. "host=/percorso/socket port=55432 user=postgres"
 *   KHUB_POSTGREST_BIN percorso del binario postgrest (v12)
 * Senza le due variabili il test si dichiara non eseguito (skip) e termina con 0.
 *
 * Prova prima/dopo: lo stesso scenario (Scheda importata + ingrediente aggiunto
 * nel LAB) e' eseguito con api/chat.js di 7e0604b (atteso: salvataggio
 * rifiutato da PostgREST, PGRST102) e con quello attuale (atteso: salvato).
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, spawnSync, execFileSync } = require('child_process');

const CONN = process.env.KHUB_PG_TEST, BIN = process.env.KHUB_POSTGREST_BIN;
if (!CONN || !BIN) { console.log('P0-c.1 — PostgREST locale: KHUB_PG_TEST o KHUB_POSTGREST_BIN non impostati, test non eseguito (skip)\n\n0 passed, 0 failed, 1 skipped'); process.exit(0); }
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { console.log('Playwright non disponibile'); process.exit(1); }

const ROOT = path.join(__dirname, '..');
const DB = 'khub_p0c1_' + process.pid;
const parti = Object.fromEntries(CONN.trim().split(/\s+/).map(x => x.split('=')));
const psql = (q, db = DB, file) => spawnSync('psql', [CONN + ' dbname=' + db, '-v', 'ON_ERROR_STOP=1', '-qtA'].concat(file ? ['-f', file] : ['-c', q]), { encoding: 'utf8' });
const sql = (q, db) => { const r = psql(q, db); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
const righe = q => { const t = sql('select coalesce(json_agg(t),\'[]\') from (' + q + ') t'); return JSON.parse(t); };
const portaLibera = () => new Promise(ok => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const attendi = async (cond, ms, cosa) => { const t0 = Date.now(); while (!(await cond())) { if (Date.now() - t0 > ms) throw new Error('timeout: ' + cosa); await new Promise(r => setTimeout(r, 100)); } };
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok - ' + name); } catch (e) { failed++; console.log('  FAIL - ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n    ')); } }

const ld = o => `<script type="application/ld+json">${JSON.stringify(o).replace(/<\//g, '<\\/')}</script>`;
const RIGHE = ['500 g di farina', "2 spicchi d'aglio", '1 baccello di vaniglia', 'Sale q.b.', 'Burro', '20–30 g acqua'];
const PAGINA = '<html><head>' + ld({ '@type': 'Recipe', name: 'Pane P0-c', recipeIngredient: RIGHE, recipeInstructions: ['Impastare.', 'Cuocere.'] }) + '</head><body></body></html>';

const figli = [];
let tmp;
(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'khub-p0c1-'));
  try {
    // ── Database locale: schema di base + migrazioni del repository in ordine ──
    sql('drop database if exists ' + DB, 'postgres'); sql('create database ' + DB, 'postgres');
    const applica = f => { const r = psql(null, DB, f); if (r.status !== 0) throw new Error(path.basename(f) + ': ' + r.stderr); };
    applica(path.join(ROOT, 'scripts/db/p0c-schema-base-locale.sql'));
    const migrazioni = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort();
    migrazioni.forEach(f => applica(path.join(ROOT, 'supabase/migrations', f)));
    sql("do $$ begin if not exists (select 1 from pg_roles where rolname='khub_test_anon') then create role khub_test_anon nologin; end if; end $$;" +
      ' grant usage on schema public to khub_test_anon; grant all on all tables in schema public to khub_test_anon;');
    // Scheda precedente a P0-c (nessun qty_kind), come i dati di KHUB Test.
    sql("insert into recipes (id,name,category,department,notes) values ('rL','Crema precedente','Dolci','Pasticceria','');" +
      "insert into variants (id,recipe_id,name,label,note,status,active,portions_count,grams_per_portion,steps) values ('lL','rL','Crema','Bozza 1','','lab',false,4,200,'[\"Scaldare.\"]');" +
      "insert into ingredients (id,variant_id,name,qty,unit,sort_order) values ('iL1','lL','Latte',500,'ml',0),('iL2','lL','Zucchero',150,'g',1);");

    // ── PostgREST locale ──
    const portaRest = await portaLibera();
    const uri = 'postgres://' + (parti.user || 'postgres') + '@/' + DB + '?host=' + encodeURIComponent(parti.host || '/tmp') + '&port=' + (parti.port || 5432);
    fs.writeFileSync(path.join(tmp, 'pgrst.conf'), `db-uri = "${uri}"\ndb-schemas = "public"\ndb-anon-role = "khub_test_anon"\nserver-host = "127.0.0.1"\nserver-port = ${portaRest}\n`);
    const pgrst = spawn(BIN, [path.join(tmp, 'pgrst.conf')], { stdio: ['ignore', 'pipe', 'pipe'] }); figli.push(pgrst);
    let logRest = ''; pgrst.stdout.on('data', d => { logRest += d; }); pgrst.stderr.on('data', d => { logRest += d; });
    const REST = 'http://127.0.0.1:' + portaRest;
    await attendi(async () => { try { return (await fetch(REST + '/')).ok; } catch (e) { return false; } }, 15000, 'PostgREST ' + logRest);
    const versione = (logRest.match(/PostgREST \d+\.\d+\.\d+/) || ['PostgREST'])[0];
    console.log('P0-c.1 — salvataggio su ' + versione + ' locale + ' + sql('show server_version').split(' ')[0] + ' (migrazioni ' + migrazioni.map(f => f.slice(0, 4)).join(', ') + ')');

    // ── Server reale dell'app collegato a PostgREST ──
    const avviaServer = async chat => {
      const porta = await portaLibera();
      const p = spawn(process.execPath, [path.join(ROOT, 'scripts/_p0c-postgrest-server.js'), String(porta), REST].concat(chat ? [chat] : []), { env: { PATH: process.env.PATH, HOME: process.env.HOME }, stdio: ['ignore', 'pipe', 'pipe'] });
      figli.push(p); let log = ''; p.stdout.on('data', d => { log += d; }); p.stderr.on('data', d => { log += d; });
      await attendi(() => /pronto/.test(log), 15000, 'server di test ' + log);
      return { origine: 'http://localhost:' + porta, ferma: () => p.kill(), log: () => log };
    };
    const browser = await chromium.launch();
    const nuovaPagina = async origine => {
      const context = await browser.newContext();
      await context.route('**/*', async route => {
        const u = new URL(route.request().url());
        if (u.origin !== origine) return route.abort();
        if (/^\/lib\/[a-z]+\.js$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(ROOT, u.pathname)) });
        if (u.pathname === '/api/chat') {
          let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) { /* vuoto */ }
          if (body.messages || body.mode) return route.fulfill({ status: 401, contentType: 'application/json', body: '{"type":"error","error":{"type":"authentication_error"}}' });
          if (body.fetchUrl !== undefined) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, html: PAGINA, finalUrl: body.fetchUrl, status: 200 }) });
        }
        return route.continue();
      });
      await context.addInitScript(() => { try { localStorage.setItem('khub_onboarded', '1'); } catch (e) { /* no */ } });
      const page = await context.newPage();
      const salvataggi = []; const errori = [];
      page.on('pageerror', e => errori.push(String(e && e.message || e)));
      page.on('response', async r => { try { if (/\/api\/chat$/.test(r.url()) && /"supabaseAction":"save"/.test(r.request().postData() || '')) salvataggi.push(await r.json()); } catch (e) { /* no */ } });
      const avvia = async () => { await page.goto(origine + '/khub_mvp.html?ui=classic'); await page.waitForFunction(() => typeof S !== 'undefined' && S.recipes.length > 0, null, { timeout: 15000 }); };
      await avvia();
      const ev = (f, a) => page.evaluate(f, a);
      const api = body => ev(async b => { const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return { status: r.status, json: await r.json().catch(() => null) }; }, body);
      return { page, context, ev, api, avvia, salvataggi, errori };
    };
    const registro = async origine => (await fetch(origine + '/test/registro')).json();
    // Importa la pagina, salva la Scheda e aggiunge un ingrediente nel LAB.
    const importaEAggiungi = async P => {
      await P.ev(() => { S.view = 'load'; S.loadTab = 'link'; S.loadUrl = 'https://x.test/pane'; render(); });
      await P.page.click('#btn-extract'); await P.page.waitForSelector('#btn-save-preview');
      await P.page.click('#btn-save-preview'); await P.page.waitForFunction(() => S.view === 'ricetta-madre-v2');
      await attendi(async () => P.salvataggi.length >= 1, 8000, 'primo salvataggio');
      const idScheda = await P.ev(() => S.selectedId), idBozza = await P.ev(id => R(id).labVersions[0].id, idScheda);
      await P.ev(id => { S.view = 'recipe'; S.mode = 'lab'; S.selectedId = id; S.addIngMode = 'ingrediente'; render(); }, idScheda);
      await P.page.waitForSelector('#new-ing-name');
      await P.ev(id => { document.getElementById('new-ing-name').value = 'Lievito'; document.getElementById('new-ing-qty').value = '10'; document.getElementById('new-ing-unit').value = 'g'; addIngredient(id); }, idScheda);
      await attendi(async () => P.salvataggi.length >= 2, 8000, 'salvataggio dopo l\'aggiunta nel LAB');
      return { idScheda, idBozza, esito: P.salvataggi[P.salvataggi.length - 1] };
    };
    const vista = vid => righe("select name, qty::float8 as qty, unit, qty_kind, qty_min::float8 as qty_min, qty_max::float8 as qty_max, source_text from ingredients where variant_id='" + vid + "' order by sort_order, id");

    await test('T0. PostgREST reale: un upsert multiplo con chiavi diverse e\' rifiutato per intero (PGRST102), nessuna riga scritta', async () => {
      const r = await fetch(REST + '/ingredients', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([{ id: 'x1', variant_id: 'lL', name: 'a', qty: 1, unit: 'g' }, { id: 'x2', variant_id: 'lL', name: 'b', qty: 0, unit: 'g', qty_kind: 'variabile', qty_min: null, qty_max: null, source_text: 'b q.b.' }]) });
      const j = await r.json();
      assert.strictEqual(r.status, 400); assert.strictEqual(j.code, 'PGRST102'); assert.strictEqual(j.message, 'All object keys must match');
      assert.strictEqual(sql("select count(*) from ingredients where id in ('x1','x2')"), '0');
    });

    // ── PRIMA: api/chat.js di 7e0604b ──
    const vecchio = path.join(tmp, 'chat-7e0604b.js');
    fs.writeFileSync(vecchio, execFileSync('git', ['show', '7e0604b:api/chat.js'], { cwd: ROOT, encoding: 'utf8' }));
    const sPrima = await avviaServer(vecchio);
    await test('T1. PRIMA (7e0604b): Scheda importata + ingrediente aggiunto nel LAB -> salvataggio rifiutato, ingrediente non salvato', async () => {
      const P = await nuovaPagina(sPrima.origine);
      const { idBozza, esito } = await importaEAggiungi(P);
      assert.notStrictEqual(esito && esito.ok, true, JSON.stringify(esito));
      assert.ok(/PGRST102|All object keys must match/.test(JSON.stringify(esito)), JSON.stringify(esito));
      assert.ok(!vista(idBozza).some(r => r.name === 'Lievito'), 'Lievito non salvato');
      await P.context.close();
    });
    sPrima.ferma();
    sql("delete from ingredients where variant_id in (select id from variants where recipe_id<>'rL'); delete from variants where recipe_id<>'rL'; delete from recipes where id<>'rL';");

    // ── DOPO: api/chat.js attuale ──
    const s = await avviaServer();
    const P = await nuovaPagina(s.origine);
    let idScheda, idBozza;

    await test('T2. Scheda precedente: modifica nel LAB salvata con UNA sola richiesta per gli ingredienti, senza campi P0-c', async () => {
      const n0 = (await registro(s.origine)).length;
      await P.ev(() => { S.view = 'recipe'; S.mode = 'lab'; S.selectedId = 'rL'; render(); });
      await P.ev(() => onIngQty('rL', 'iL1', '520'));
      await attendi(async () => P.salvataggi.length >= 1, 8000, 'salvataggio');
      assert.strictEqual(P.salvataggi[0].ok, true, JSON.stringify(P.salvataggi[0]));
      const ing = (await registro(s.origine)).slice(n0).filter(x => x.percorso === 'ingredients' && x.metodo === 'POST');
      assert.deepStrictEqual(ing.map(x => [x.stato, x.righe]), [[201, 2]], JSON.stringify(ing));
      assert.deepStrictEqual(vista('lL').map(r => [r.name, r.qty, r.unit, r.qty_kind, r.source_text]), [['Latte', 520, 'ml', null, null], ['Zucchero', 150, 'g', null, null]]);
    });

    await test('T3. DOPO: Scheda importata + ingrediente aggiunto nel LAB -> salvato; metadati P0-c intatti; due richieste con chiavi uniformi', async () => {
      const n0 = (await registro(s.origine)).length;
      const r = await importaEAggiungi(P); idScheda = r.idScheda; idBozza = r.idBozza;
      assert.strictEqual(r.esito.ok, true, JSON.stringify(r.esito));
      assert.deepStrictEqual(vista(idBozza), [
        { name: 'farina', qty: 500, unit: 'g', qty_kind: 'certa', qty_min: null, qty_max: null, source_text: '500 g di farina' },
        { name: 'aglio', qty: 2, unit: 'spicchio', qty_kind: 'certa', qty_min: null, qty_max: null, source_text: "2 spicchi d'aglio" },
        { name: 'vaniglia', qty: 1, unit: 'baccello', qty_kind: 'certa', qty_min: null, qty_max: null, source_text: '1 baccello di vaniglia' },
        { name: 'Sale', qty: 0, unit: 'g', qty_kind: 'variabile', qty_min: null, qty_max: null, source_text: 'Sale q.b.' },
        { name: 'Burro', qty: 0, unit: 'g', qty_kind: 'mancante', qty_min: null, qty_max: null, source_text: 'Burro' },
        { name: 'acqua', qty: 0, unit: 'g', qty_kind: 'intervallo', qty_min: 20, qty_max: 30, source_text: '20–30 g acqua' },
        { name: 'Lievito', qty: 10, unit: 'g', qty_kind: null, qty_min: null, qty_max: null, source_text: null }]);
      const post = (await registro(s.origine)).slice(n0).filter(x => x.percorso === 'ingredients' && x.metodo === 'POST');
      assert.ok(post.every(x => x.stato === 201), JSON.stringify(post));
      assert.deepStrictEqual(post.slice(-2).map(x => x.righe).sort(), [1, 6], 'ultimo salvataggio: 6 righe P0-c + 1 riga senza tipo');
    });

    await test('T4. ricaricamento: tipi, intervallo, unita\' originali e testo della fonte riletti; riga del LAB senza tipo; firma della bozza stabile', async () => {
      await P.avvia();
      const ings = await P.ev(id => R(id).labVersions[0].ingredients.map(i => [i.name, i.qty, i.unit, i.qtyKind || null, i.qtyMin == null ? null : i.qtyMin, i.qtyMax == null ? null : i.qtyMax]), idScheda);
      assert.deepStrictEqual(ings, [['farina', 500, 'g', 'certa', null, null], ['aglio', 2, 'spicchio', 'certa', null, null], ['vaniglia', 1, 'baccello', 'certa', null, null],
        ['Sale', null, 'g', 'variabile', null, null], ['Burro', null, 'g', 'mancante', null, null], ['acqua', null, 'g', 'intervallo', 20, 30], ['Lievito', 10, 'g', null, null, null]]);
      const hash = sql("select contenuto_hash from variants where id='" + idBozza + "'");
      assert.strictEqual(await P.ev(id => firmaContenutoBozza(R(id).labVersions[0]), idScheda), hash, 'firma identica a quella salvata');
    });

    await test('T5. riga aggiornata da un client senza campi P0-c (es. Preview P0-a): metadati P0-c conservati; modifica non coerente rifiutata dal database', async () => {
      const idSale = sql("select id from ingredients where variant_id='" + idBozza + "' and name='Sale'");
      const idBurro = sql("select id from ingredients where variant_id='" + idBozza + "' and name='Burro'");
      const riga = (id, name, qty) => ({ id, variant_id: idBozza, name, qty, unit: 'g', sort_order: 3, is_sub_recipe: false, sub_recipe_id: null, estimated_yield_pct: null, measured_yield_pct: null });
      let r = await P.api({ supabaseAction: 'save', data: { recipe: { id: idScheda, name: 'Pane P0-c', category: 'Pane', department: 'Cucina' }, variants: [], ingredients: [riga(idSale, 'Sale fino', 0)], deletedIngredients: [], l2Items: [], l3Items: [] } });
      assert.strictEqual(r.json && r.json.ok, true, JSON.stringify(r.json));
      assert.deepStrictEqual(righe("select name, qty_kind, source_text from ingredients where id='" + idSale + "'")[0], { name: 'Sale fino', qty_kind: 'variabile', source_text: 'Sale q.b.' });
      r = await P.api({ supabaseAction: 'save', data: { recipe: { id: idScheda, name: 'Pane P0-c', category: 'Pane', department: 'Cucina' }, variants: [], ingredients: [riga(idBurro, 'Burro', 100)], deletedIngredients: [], l2Items: [], l3Items: [] } });
      assert.notStrictEqual(r.json && r.json.ok, true, 'quantita\' su un segnaposto senza tipo: rifiutata');
      assert.ok(/ingredients_qty_segnaposto_chk/.test(JSON.stringify(r.json)), JSON.stringify(r.json));
      assert.deepStrictEqual(righe("select qty::float8 as qty, qty_kind from ingredients where id='" + idBurro + "'")[0], { qty: 0, qty_kind: 'mancante' }, 'nessuna modifica');
      sql("update ingredients set name='Sale' where id='" + idSale + "'");
    });

    await test('T6. LAB su PostgREST: quantita\' indicata, q.b. e intervallo scritti nel campo; NULL mai trasformato in 0, unita\' della fonte mai in g', async () => {
      await P.avvia();
      await P.ev(id => { S.view = 'recipe'; S.mode = 'lab'; S.selectedId = id; render(); }, idScheda);
      const id = await P.ev(x => Object.fromEntries(R(x).labVersions[0].ingredients.map(i => [i.name, i.id])), idScheda);
      const n0 = P.salvataggi.length;
      await P.ev(([s, a]) => onIngQtyTesto(s, a, '100'), [idScheda, id.Burro]);
      await P.ev(([s, a]) => onIngQtyTesto(s, a, '3-4'), [idScheda, id.aglio]);
      await P.ev(([s, a]) => onIngQtyTesto(s, a, 'qb'), [idScheda, id.vaniglia]);
      await attendi(async () => P.salvataggi.length > n0, 8000, 'salvataggio');
      assert.strictEqual(P.salvataggi[P.salvataggi.length - 1].ok, true);
      const v = Object.fromEntries(vista(idBozza).map(r => [r.name, [r.qty, r.unit, r.qty_kind, r.qty_min, r.qty_max]]));
      assert.deepStrictEqual(v.Burro, [100, 'g', 'certa', null, null]);
      assert.deepStrictEqual(v.aglio, [0, 'spicchio', 'intervallo', 3, 4]);
      assert.deepStrictEqual(v.vaniglia, [0, 'baccello', 'variabile', null, null]);
      assert.deepStrictEqual(v.Lievito, [10, 'g', null, null, null]);
    });

    // Ricetta Attiva costruita con il salvataggio del server (come V2 del test P0-c).
    const ING = (vid, k, name, qty, unit, extra) => Object.assign({ id: vid + '_' + name, variant_id: vid, name, qty, unit, sort_order: 0, is_sub_recipe: false, sub_recipe_id: null, estimated_yield_pct: null, measured_yield_pct: null }, k ? { qty_kind: k, qty_min: null, qty_max: null, source_text: null } : {}, extra || {});
    const VAR = (id, status, active) => ({ id, recipe_id: 'rP', name: 'Pane attivo', label: id, status, active, steps: JSON.stringify(['Impastare.']), steps_v2: [{ id: 's1', order: 0, text: 'Impastare.', expectedDurationSeconds: null }], portions_count: 10, grams_per_portion: 100 });
    const salva = (variants, ingredients) => P.api({ supabaseAction: 'save', data: { recipe: { id: 'rP', name: 'Pane P0-c attivo', category: 'Pane', department: 'Cucina' }, variants, ingredients, deletedIngredients: [], l2Items: [], l3Items: [] } });
    const INGS = [ING('vP', 'certa', 'farina', 500, 'g'), ING('vP', 'variabile', 'sale', 0, 'g'), ING('vP', 'intervallo', 'acqua', 0, 'g', { qty_min: 20, qty_max: 30 }), ING('vP', 'certa', 'aglio', 2, 'spicchio'), ING('vP', null, 'olio', 10, 'g'), ING('vP', 'mancante', 'burro', 0, 'g')];

    await test('T7. attivazione su PostgREST: rifiutata con quantita\' da indicare (lettura reale delle righe salvate), ammessa dopo averla indicata', async () => {
      assert.strictEqual((await salva([VAR('vP', 'lab', false)], INGS)).json.ok, true, 'righe miste salvate');
      assert.strictEqual((await salva([VAR('vP', 'validated', false)], INGS)).json.ok, true);
      const r = await salva([VAR('vP', 'validated', true)], []);
      assert.strictEqual(r.json.code, 'quantita_mancante', JSON.stringify(r.json));
      assert.strictEqual(sql("select active from variants where id='vP'"), 'f');
      sql("update ingredients set qty_kind='certa', qty=50 where id='vP_burro'");
      assert.strictEqual((await salva([VAR('vP', 'validated', true)], [])).json.ok, true);
    });

    await test('T8. Produzione su PostgREST: intervallo scelto, conversione confermata, Sessione e snapshot nel database; scelta azzerata al nuovo invio; Storico', async () => {
      await P.avvia();
      await P.ev(() => openMandaInProduzione('rP', 'vP', { portions: 20, gpp: 100 }));
      const etichetta = await P.page.textContent('.manda-intervalli');
      assert.ok(/formulazione base/.test(etichetta) && /20–30 g/.test(etichetta), etichetta);
      await P.ev(() => sceltaIntervalloProduzione('vP', 'vP_acqua', '25'));
      await P.ev(() => confirmMandaInProduzione()); await P.page.waitForTimeout(400);
      assert.deepStrictEqual(await P.ev(() => S.pendingConversionPreflight && S.pendingConversionPreflight.missing.map(m => m.ingredientName + ':' + m.currentUnit)), ['aglio:spicchio']);
      await P.ev(() => confirmConversionPreflightStep('5'));
      await attendi(async () => Number(sql("select count(*) from production_sessions where source_variant_id='vP'")) === 1, 8000, 'Sessione');
      assert.ok(Number(sql("select count(*) from ingredient_conversions")) >= 1, 'conversione salvata');
      const snap = JSON.parse(sql("select snapshot::text from production_sessions where source_variant_id='vP'"));
      const per = Object.fromEntries(snap.ingredients.map(i => [i.name, i]));
      assert.deepStrictEqual([per.acqua.baseQty, per.acqua.intervallo, per.acqua.qtyKind || null], [25, { min: 20, max: 30 }, null], 'valore scelto e intervallo nello snapshot');
      assert.strictEqual(per.acqua.operativeQty > 25, true, 'valore scalato sulla produzione: ' + per.acqua.operativeQty);
      assert.deepStrictEqual([per.sale.qtyKind, per.sale.baseQty, per.sale.operativeQty], ['variabile', null, null], 'q.b. senza quantita\'');
      assert.strictEqual(per.aglio.conversionSourceType, 'chef_confirmed');
      assert.strictEqual(per.olio.qtyKind, undefined, 'riga precedente: nessun campo nuovo');
      // Storico: la Sessione riletta dal database mostra q.b.
      const idSess = sql("select id from production_sessions where source_variant_id='vP'");
      await P.avvia();
      await P.ev(() => { S.view = 'attive'; render(); });
      await P.page.waitForFunction(x => (S.productionSessions || []).some(y => y.id === x), idSess, { timeout: 8000 });
      await P.ev(x => openHistorySession(x), idSess); await P.page.waitForTimeout(500);
      const testoSess = await P.ev(() => document.body.innerText);
      assert.ok(/sale[\s\S]{0,200}q\.b\./i.test(testoSess), 'Sessione riletta: sale q.b.');
      assert.ok(/acqua/.test(testoSess) && !/acqua[\s\S]{0,40}\b0 g/.test(testoSess), 'acqua con il valore scelto, mai 0 g');
      // Nuovo invio: nessun valore precompilato dalla Sessione precedente.
      await P.ev(() => openMandaInProduzione('rP', 'vP', { portions: 20, gpp: 100 }));
      assert.strictEqual(await P.ev(() => document.querySelector('.manda-intervallo').value), '', 'scelta non riportata nel nuovo invio');
      await P.ev(() => confirmMandaInProduzione()); await P.page.waitForTimeout(300);
      assert.ok(/Scegli la quantità di «acqua»/.test(await P.ev(() => S.pendingMandaInProduzione.error)));
      assert.deepStrictEqual(P.errori, []);
    });

    await browser.close();
  } finally {
    figli.forEach(p => { try { p.kill(); } catch (e) { /* gia' chiuso */ } });
    await new Promise(r => setTimeout(r, 300));
    psql('drop database if exists ' + DB + ' with (force)', 'postgres');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* no */ }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.log('ERRORE', e && e.stack || e); figli.forEach(p => { try { p.kill(); } catch (x) { /* no */ } }); process.exit(1); });
