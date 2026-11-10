/*
 * Test — P0-c.2: salvataggi coerenti e quantita' inserite a mano, su PostgREST REALE (locale).
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
 * Copre: salvataggio atomico di ingredienti misti; fallimento forzato di una
 * scrittura (trigger locale); conservazione dei metadati P0-c; Schede
 * precedenti; coerenza fra firma della bozza e formulazione salvata; nuovo
 * ingrediente senza quantita'; quantita' cancellata; q.b. e intervalli;
 * attivazione bloccata; Produzione senza falsi 0 g; Ricette precedenti invariate.
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
const DB = 'khub_p0c2_' + process.pid;
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
      "insert into ingredients (id,variant_id,name,qty,unit,sort_order) values ('ingL1','lL','Latte',500,'ml',0),('ingL2','lL','Zucchero',150,'g',1),('ingL3','lL','Sale',0,'g',2);");

    // ── PostgREST locale ──
    const portaRest = await portaLibera();
    const uri = 'postgres://' + (parti.user || 'postgres') + '@/' + DB + '?host=' + encodeURIComponent(parti.host || '/tmp') + '&port=' + (parti.port || 5432);
    fs.writeFileSync(path.join(tmp, 'pgrst.conf'), `db-uri = "${uri}"\ndb-schemas = "public"\ndb-anon-role = "khub_test_anon"\nserver-host = "127.0.0.1"\nserver-port = ${portaRest}\n`);
    const pgrst = spawn(BIN, [path.join(tmp, 'pgrst.conf')], { stdio: ['ignore', 'pipe', 'pipe'] }); figli.push(pgrst);
    let logRest = ''; pgrst.stdout.on('data', d => { logRest += d; }); pgrst.stderr.on('data', d => { logRest += d; });
    const REST = 'http://127.0.0.1:' + portaRest;
    await attendi(async () => { try { return (await fetch(REST + '/')).ok; } catch (e) { return false; } }, 15000, 'PostgREST ' + logRest);
    const versione = (logRest.match(/PostgREST \d+\.\d+\.\d+/) || ['PostgREST'])[0];
    console.log('P0-c.2 — salvataggi e quantita\' manuali su ' + versione + ' locale + ' + sql('show server_version').split(' ')[0] + ' (migrazioni ' + migrazioni.map(f => f.slice(0, 4)).join(', ') + ')');

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


    const s = await avviaServer();
    const P = await nuovaPagina(s.origine);
    const reg = async () => (await registro(s.origine));
    const sommaRighe = vid => sql("select md5(string_agg(concat_ws('|',id,name,qty,unit,sort_order,is_sub_recipe,sub_recipe_id,qty_kind,qty_min,qty_max,source_text),'#' order by id)) from ingredients where variant_id='" + vid + "'");
    const hash = vid => sql("select coalesce(contenuto_hash,'') from variants where id='" + vid + "'");
    const salvaOra = async id => { const k = P.salvataggi.length; await P.ev(x => saveToSupabase(R(x)), id); await attendi(async () => P.salvataggi.length > k, 8000, 'salvataggio'); return P.salvataggi[P.salvataggi.length - 1]; };
    const attendiAutosave = async k => { await attendi(async () => P.salvataggi.length > k, 8000, 'autosave'); return P.salvataggi[P.salvataggi.length - 1]; };
    const firmaCoerente = async (id, vid) => { await P.avvia(); return (await P.ev(x => firmaContenutoBozza(R(x).labVersions[0]), id)) === hash(vid); };
    const lab = async id => { await P.ev(x => { S.view = 'recipe'; S.mode = 'lab'; S.selectedId = x; S.addIngMode = 'ingrediente'; render(); }, id); await P.page.waitForSelector('#new-ing-name'); };
    const aggiungi = async (id, nome, qty, unit) => { const k = P.salvataggi.length; await P.ev(([x, n, q, u]) => { document.getElementById('new-ing-name').value = n; document.getElementById('new-ing-qty').value = q; document.getElementById('new-ing-unit').value = u || 'g'; addIngredient(x); }, [id, nome, qty, unit]); return k; };
    const memoria = id => P.ev(x => R(x).labVersions[0].ingredients.map(i => [i.name, i.qty, i.qtyKind || null, i.qtyMin == null ? null : i.qtyMin, i.qtyMax == null ? null : i.qtyMax]), id);
    const VAR = (id, rid, status, active) => ({ id, recipe_id: rid, name: 'Ricetta ' + id, label: id, status, active, steps: JSON.stringify(['Impastare.']), steps_v2: [{ id: 's1', order: 0, text: 'Impastare.', expectedDurationSeconds: null }], portions_count: 10, grams_per_portion: 100 });
    const salvaApi = (rid, variants, ingredients) => P.api({ supabaseAction: 'save', data: { recipe: { id: rid, name: 'Scheda ' + rid, category: 'Pane', department: 'Cucina' }, variants, ingredients, deletedIngredients: [], l2Items: [], l3Items: [] } });
    const ING = (vid, k, name, qty, unit, extra) => Object.assign({ id: vid + '_' + name, variant_id: vid, name, qty, unit, sort_order: 0, is_sub_recipe: false, sub_recipe_id: null, estimated_yield_pct: null, measured_yield_pct: null }, k ? { qty_kind: k, qty_min: null, qty_max: null, source_text: null } : {}, extra || {});

    const sommaPrecedente = sommaRighe('lL'), hashPrecedente = hash('lL');

    await test('Q11/Q4. Scheda precedente: salvataggio senza modifiche -> righe identiche, una sola richiesta senza campi P0-c, zeri storici non convertiti', async () => {
      const n0 = (await reg()).length;
      const e = await salvaOra('rL');
      assert.strictEqual(e.ok, true, JSON.stringify(e));
      const ing = (await reg()).slice(n0).filter(x => x.percorso === 'ingredients' && x.metodo === 'POST');
      assert.strictEqual(ing.length, 1); assert.strictEqual(ing[0].righe, 3);
      assert.ok(!ing[0].chiavi.some(k => /^(qty_kind|qty_min|qty_max|source_text)$/.test(k)), 'nessun campo P0-c: ' + ing[0].chiavi.join(','));
      assert.strictEqual(sommaRighe('lL'), sommaPrecedente, 'righe identiche');
      assert.deepStrictEqual(await memoria('rL'), [['Latte', 500, null, null, null], ['Zucchero', 150, null, null, null], ['Sale', 0, null, null, null]], 'lo zero storico resta 0 (nessuna conversione al caricamento)');
      assert.ok(hashPrecedente === '' ? hash('lL').length > 0 : true);
      assert.ok(await firmaCoerente('rL', 'lL'), 'Q5: firma = formulazione salvata');
    });

    await test('Q1. ingredienti misti (Scheda precedente + nuovo ingrediente): UNA sola richiesta atomica con i campi P0-c espliciti; righe precedenti invariate', async () => {
      await P.avvia(); await lab('rL');
      const n0 = (await reg()).length;
      const e = await attendiAutosave(await aggiungi('rL', 'Vaniglia', '2', 'g'));
      assert.strictEqual(e.ok, true, JSON.stringify(e));
      const r = (await reg()).slice(n0);
      const ing = r.filter(x => x.percorso === 'ingredients' && x.metodo === 'POST');
      assert.deepStrictEqual(ing.map(x => [x.stato, x.righe]), [[201, 4]], JSON.stringify(ing));
      assert.ok(['qty_kind', 'qty_min', 'qty_max', 'source_text'].every(k => ing[0].chiavi.includes(k)));
      assert.deepStrictEqual(righe("select name, qty::float8 as qty, qty_kind from ingredients where variant_id='lL' order by sort_order"),
        [{ name: 'Latte', qty: 500, qty_kind: null }, { name: 'Zucchero', qty: 150, qty_kind: null }, { name: 'Sale', qty: 0, qty_kind: null }, { name: 'Vaniglia', qty: 2, qty_kind: 'certa' }]);
      const variants = r.filter(x => x.percorso === 'variants' && x.metodo === 'POST');
      assert.deepStrictEqual(variants.map(x => x.firma), [false, true], 'firma scritta dopo gli ingredienti');
      assert.ok(r.findIndex(x => x.percorso === 'variants' && x.firma) > r.findIndex(x => x.percorso === 'ingredients'), 'ordine: ingredienti, poi firma');
      assert.ok(await firmaCoerente('rL', 'lL'), 'Q5');
    });

    await test('Q6. nuovo ingrediente con quantita\' vuota -> da indicare (DB: qty_kind mancante, qty 0 segnaposto); pesi non calcolabili; avviso nel LAB', async () => {
      await lab('rL');
      const e = await attendiAutosave(await aggiungi('rL', 'Pepe', '', 'g'));
      assert.strictEqual(e.ok, true, JSON.stringify(e));
      assert.deepStrictEqual(righe("select qty::float8 as qty, unit, qty_kind from ingredients where variant_id='lL' and name='Pepe'"), [{ qty: 0, unit: 'g', qty_kind: 'mancante' }]);
      const w = await P.ev(() => { const x = computeFormulationWeights(R('rL').labVersions[0].ingredients); return { status: x.status, unresolved: (x.unresolved || []).map(u => u.name) }; });
      assert.deepStrictEqual(w, { status: 'unresolved', unresolved: ['Pepe'] });
      assert.ok(/non ha la quantità|non hanno la quantità/.test(await P.ev(() => document.body.innerText)), 'avviso visibile');
      await P.avvia();
      assert.deepStrictEqual((await memoria('rL')).find(x => x[0] === 'Pepe'), ['Pepe', null, 'mancante', null, null], 'dopo il ricaricamento');
      assert.ok(await firmaCoerente('rL', 'lL'), 'Q5');
    });

    await test('Q7. quantita\' cancellata dallo chef (riga precedente e riga con tipo) -> da indicare; uno 0 scritto -> da indicare; zeri storici non toccati', async () => {
      await lab('rL');
      let k = P.salvataggi.length;
      await P.ev(() => onIngQtyTesto('rL', 'ingL2', ''));                           // Zucchero: riga precedente svuotata
      await P.ev(id => onIngQtyTesto('rL', R(id).labVersions[0].ingredients.find(i => i.name === 'Vaniglia').id, ''), 'rL'); // riga certa svuotata
      assert.strictEqual((await attendiAutosave(k)).ok, true);
      await P.page.waitForTimeout(1800);
      const v = Object.fromEntries(righe("select name, qty::float8 as qty, qty_kind from ingredients where variant_id='lL'").map(x => [x.name, [x.qty, x.qty_kind]]));
      assert.deepStrictEqual([v.Zucchero, v.Vaniglia, v.Sale, v.Latte], [[0, 'mancante'], [0, 'mancante'], [0, null], [500, null]], JSON.stringify(v));
      // onIngQty diretto (gestore precedente) con campo vuoto: stesso risultato.
      k = P.salvataggi.length;
      await P.ev(() => onIngQty('rL', 'ingL1', ''));
      assert.strictEqual((await attendiAutosave(k)).ok, true);
      assert.deepStrictEqual(righe("select qty::float8 as qty, qty_kind from ingredients where id='ingL1'")[0], { qty: 0, qty_kind: 'mancante' });
      // Uno 0 scritto su una riga precedente: mai 0 g operativo.
      sql("insert into ingredients (id,variant_id,name,qty,unit,sort_order) values ('ingL9','lL','Burro',50,'g',9)");
      await P.avvia(); await lab('rL');
      k = P.salvataggi.length;
      await P.ev(() => onIngQtyTesto('rL', 'ingL9', '0'));
      assert.strictEqual((await attendiAutosave(k)).ok, true);
      assert.deepStrictEqual(righe("select qty::float8 as qty, qty_kind from ingredients where id='ingL9'")[0], { qty: 0, qty_kind: 'mancante' });
      // La stessa riga, ora "da indicare", riceve un numero: quantita' certa.
      k = P.salvataggi.length;
      await P.ev(() => onIngQtyTesto('rL', 'ingL9', '2,5'));
      assert.strictEqual((await attendiAutosave(k)).ok, true);
      assert.deepStrictEqual(righe("select qty::float8 as qty, qty_kind from ingredients where id='ingL9'")[0], { qty: 2.5, qty_kind: 'certa' });
      // Numero con virgola su una riga precedente: 2,5 (non 2) e la riga resta senza tipo.
      sql("insert into ingredients (id,variant_id,name,qty,unit,sort_order) values ('ingL8','lL','Olio',10,'g',8)");
      await P.avvia(); await lab('rL');
      k = P.salvataggi.length;
      await P.ev(() => onIngQtyTesto('rL', 'ingL8', '2,5'));
      assert.strictEqual((await attendiAutosave(k)).ok, true);
      assert.deepStrictEqual(righe("select qty::float8 as qty, qty_kind from ingredients where id='ingL8'")[0], { qty: 2.5, qty_kind: null });
    });

    await test('Q8. q.b. e intervalli: nuovo ingrediente "q.b." e "20-30", riga precedente "q.b."; intervallo non valido rifiutato; riletti dopo il ricaricamento', async () => {
      await P.avvia(); await lab('rL');
      assert.strictEqual((await attendiAutosave(await aggiungi('rL', 'Cannella', 'q.b.', 'g'))).ok, true);
      await P.page.waitForTimeout(200);
      assert.strictEqual((await attendiAutosave(await aggiungi('rL', 'Acqua', '20-30', 'g'))).ok, true);
      const n = P.salvataggi.length;
      await aggiungi('rL', 'Errato', '30-20', 'g'); await P.page.waitForTimeout(1800);
      assert.strictEqual(P.salvataggi.length, n, 'intervallo non valido: nessuna modifica');
      assert.ok(!(await memoria('rL')).some(x => x[0] === 'Errato'));
      const k = P.salvataggi.length;
      await P.ev(() => onIngQtyTesto('rL', 'ingL3', 'q.b.'));                        // Sale: riga precedente
      assert.strictEqual((await attendiAutosave(k)).ok, true);
      await P.avvia();
      const m = Object.fromEntries((await memoria('rL')).map(x => [x[0], x.slice(1)]));
      assert.deepStrictEqual([m.Cannella, m.Acqua, m.Sale], [[null, 'variabile', null, null], [null, 'intervallo', 20, 30], [null, 'variabile', null, null]]);
      assert.ok(await firmaCoerente('rL', 'lL'), 'Q5');
    });

    await test('Q3. metadati P0-c conservati: riga senza campi (client precedente) in una richiesta mista -> riportati dal database; incoerente -> rifiutata prima di scrivere', async () => {
      const idSale = 'ingL3';
      const somma = sommaRighe('lL');
      const legacy = (id, name, qty) => ({ id, variant_id: 'lL', name, qty, unit: 'g', sort_order: 2, is_sub_recipe: false, sub_recipe_id: null, estimated_yield_pct: null, measured_yield_pct: null });
      const conTipo = ING('lL', 'certa', 'Nuovo', 7, 'g');
      let r = await salvaApi('rL', [], [legacy(idSale, 'Sale fino', 0), conTipo]);
      assert.strictEqual(r.json.ok, true, JSON.stringify(r.json));
      assert.deepStrictEqual(righe("select name, qty_kind from ingredients where id='ingL3'")[0], { name: 'Sale fino', qty_kind: 'variabile' }, 'q.b. conservato');
      const prima = sommaRighe('lL');
      r = await salvaApi('rL', [], [legacy(idSale, 'Sale', 5), ING('lL', 'certa', 'Nuovo', 8, 'g')]);
      assert.strictEqual(r.json.code, 'quantita_non_valida', JSON.stringify(r.json));
      assert.strictEqual(sommaRighe('lL'), prima, 'nessuna riga modificata (nemmeno "Nuovo")');
      sql("update ingredients set name='Sale' where id='ingL3'; delete from ingredients where id='lL_Nuovo'");
      // Righe tutte con campi P0-c ma non gli stessi (solo qty_kind; intervallo con min/max): campi completati, una richiesta.
      const parziale = (name, extra) => Object.assign({ id: 'lL_' + name, variant_id: 'lL', name, qty: 0, unit: 'g', sort_order: 20, is_sub_recipe: false, sub_recipe_id: null, estimated_yield_pct: null, measured_yield_pct: null }, extra);
      r = await salvaApi('rL', [], [parziale('P1', { qty: 4, qty_kind: 'certa' }), parziale('P2', { qty_kind: 'intervallo', qty_min: 5, qty_max: 9 })]);
      assert.strictEqual(r.json.ok, true, JSON.stringify(r.json));
      assert.deepStrictEqual(righe("select name, qty_kind, qty_min::float8 as qty_min, source_text from ingredients where id in ('lL_P1','lL_P2') order by id"),
        [{ name: 'P1', qty_kind: 'certa', qty_min: null, source_text: null }, { name: 'P2', qty_kind: 'intervallo', qty_min: 5, source_text: null }]);
      sql("delete from ingredients where id in ('lL_P1','lL_P2')");
      assert.notStrictEqual(somma, null);
    });

    await test('Q2/Q5. fallimento forzato di una scrittura: nessuna modifica parziale agli ingredienti; firma mai avanzata; errore chiaro; recupero completo', async () => {
      await P.avvia(); await lab('rL');
      const prima = sommaRighe('lL'), firmaPrima = hash('lL');
      sql("create function guasto_p0c2() returns trigger language plpgsql as $$ begin if new.name='Guasto' then raise exception 'guasto simulato'; end if; return new; end $$;" +
        "create trigger t_guasto before insert or update on ingredients for each row execute function guasto_p0c2();");
      let k = P.salvataggi.length;
      await P.ev(() => onIngQtyTesto('rL', 'ingL1', '600'));                        // riga resa "da indicare" in Q7
      await P.ev(id => onIngQtyTesto(id, R(id).labVersions[0].ingredients.find(i => i.name === 'Pepe').id, '3'), 'rL'); // riga con tipo
      await aggiungi('rL', 'Guasto', '1', 'g');                                    // riga rifiutata dal database
      const e = await attendiAutosave(k);
      assert.notStrictEqual(e.ok, true); assert.ok(/guasto simulato/.test(JSON.stringify(e)), JSON.stringify(e));
      assert.ok(/Salvataggio non riuscito/.test(await P.ev(() => document.body.innerText)), 'errore visibile');
      assert.strictEqual(sommaRighe('lL'), prima, 'ingredienti: nessuna modifica parziale');
      assert.strictEqual(hash('lL'), firmaPrima, 'firma non avanzata');
      // Fallimento DOPO gli ingredienti (cancellazione rifiutata): la firma resta quella precedente.
      sql("drop trigger t_guasto on ingredients; create function guasto_del() returns trigger language plpgsql as $$ begin raise exception 'cancellazione rifiutata (simulata)'; end $$;" +
        "create trigger t_guasto_del before delete on ingredients for each row execute function guasto_del();");
      k = P.salvataggi.length;
      await P.ev(id => delIngredient(id, R(id).labVersions[0].ingredients.find(i => i.name === 'Guasto').id), 'rL');
      await P.ev(id => delIngredient(id, R(id).labVersions[0].ingredients.find(i => i.name === 'Cannella').id), 'rL');
      const e2 = await attendiAutosave(k);
      assert.notStrictEqual(e2.ok, true); assert.ok(/cancellazione rifiutata/.test(JSON.stringify(e2)), JSON.stringify(e2));
      assert.strictEqual(hash('lL'), firmaPrima, 'firma non avanzata dopo una cancellazione fallita');
      // Recupero: guasto rimosso, salvataggio successivo dalla stessa pagina.
      sql('drop trigger t_guasto_del on ingredients; drop function guasto_del(); drop function guasto_p0c2();');
      const e3 = await salvaOra('rL');
      assert.strictEqual(e3.ok, true, JSON.stringify(e3));
      const v = Object.fromEntries(righe("select name, qty::float8 as qty, qty_kind from ingredients where variant_id='lL'").map(x => [x.name, [x.qty, x.qty_kind]]));
      assert.deepStrictEqual([v.Latte, v.Pepe, v.Cannella, v.Guasto], [[600, 'certa'], [3, 'certa'], undefined, undefined], JSON.stringify(v)); // Latte: svuotato in Q7 (da indicare), ora 600 -> certa
      assert.ok(await firmaCoerente('rL', 'lL'), 'firma = formulazione salvata dopo il recupero');
    });

    await test('Q12. validazione dall\'interfaccia: tipi delle quantita\' inserite a mano conservati nella Ricetta validata; "Rendi attiva" rifiutato con quantita\' da indicare', async () => {
      await P.avvia();
      await P.ev(() => { S.selectedId = 'rL'; S.view = 'recipe'; S.mode = 'lab'; render(); });
      await P.ev(() => onValidate()); await P.page.waitForTimeout(200);
      await P.ev(() => confirmValidate());
      await attendi(async () => sql("select status from variants where id='lL'") !== 'lab', 8000, 'validazione salvata');
      const v = Object.fromEntries(righe("select name, qty_kind from ingredients where variant_id='lL'").map(x => [x.name, x.qty_kind]));
      assert.deepStrictEqual([v.Zucchero, v.Sale, v.Acqua, v.Olio], ['mancante', 'variabile', 'intervallo', null], JSON.stringify(v));
      await P.avvia();
      const k = P.salvataggi.length;
      await P.ev(() => rendiAttivaPronta('rL', 'lL')); await P.page.waitForTimeout(1800);
      assert.ok(/Prima di renderla attiva indica la quantità di «Zucchero», «Vaniglia»/.test(await P.ev(() => document.body.innerText)), 'messaggio chiaro');
      assert.strictEqual(await P.ev(() => R('rL').validatedVariants.find(v => v.id === 'lL').active), false, 'mai mostrata attiva');
      assert.strictEqual(P.salvataggi.length, k, 'nessun tentativo di salvataggio');
      assert.strictEqual(sql("select active from variants where id='lL'"), 'f');
      // Il server resta l'ultima difesa (client modificato o precedente).
      const r = await salvaApi('rL', [VAR('lL', 'rL', 'validated', true)], []);
      assert.strictEqual(r.json.code, 'quantita_mancante', JSON.stringify(r.json));
    });

    await test('Q9. attivazione: rifiutata dal server con una quantita\' da indicare inserita a mano; ammessa dopo averla indicata', async () => {
      const ings = [ING('vA', 'certa', 'farina', 500, 'g'), ING('vA', 'mancante', 'Pepe', 0, 'g'), ING('vA', null, 'Sale', 0, 'g')];
      assert.strictEqual((await salvaApi('rA', [VAR('vA', 'rA', 'lab', false)], ings)).json.ok, true);
      assert.strictEqual((await salvaApi('rA', [VAR('vA', 'rA', 'validated', false)], ings)).json.ok, true, 'validazione ammessa');
      const r = await salvaApi('rA', [VAR('vA', 'rA', 'validated', true)], []);
      assert.strictEqual(r.json.code, 'quantita_mancante', JSON.stringify(r.json)); assert.ok(/Pepe/.test(r.json.errors[0]));
      assert.strictEqual(sql("select active from variants where id='vA'"), 'f');
      sql("update ingredients set qty_kind='variabile' where id='vA_Pepe'");
      assert.strictEqual((await salvaApi('rA', [VAR('vA', 'rA', 'validated', true)], [])).json.ok, true);
    });

    await test('Q10. Produzione: nessun falso 0 g per le quantita\' inserite a mano (q.b. mostrato come q.b.); lo zero storico resta quello di prima', async () => {
      await P.avvia();
      await P.ev(() => openMandaInProduzione('rA', 'vA', { portions: 10, gpp: 100 }));
      await P.ev(() => confirmMandaInProduzione());
      await attendi(async () => Number(sql("select count(*) from production_sessions where source_variant_id='vA'")) === 1, 8000, 'Sessione');
      const snap = JSON.parse(sql("select snapshot::text from production_sessions where source_variant_id='vA'"));
      const per = Object.fromEntries(snap.ingredients.map(i => [i.name, [i.qtyKind || null, i.baseQty, i.operativeQty]]));
      assert.deepStrictEqual(per.Pepe, ['variabile', null, null]);
      assert.deepStrictEqual(per.Sale, [null, 0, 0], 'zero storico: invariato (nessuna conversione retroattiva)');
      await P.ev(x => apriSessioneOperativa(x, 'attive'), sql("select id from production_sessions where source_variant_id='vA'")); await P.page.waitForTimeout(500);
      const t = await P.ev(() => document.body.innerText);
      assert.ok(/Pepe\s*\n?\s*q\.b\./.test(t), 'Pepe q.b.');
      // Una Ricetta con una quantita' da indicare non arriva mai in Produzione.
      sql("insert into recipes (id,name) values ('rB','B'); insert into variants (id,recipe_id,name,label,status,active,portions_count,grams_per_portion,steps) values ('vB','rB','B','B','validated',true,10,100,'[\"x\"]');" +
        "insert into ingredients (id,variant_id,name,qty,unit,sort_order,qty_kind) values ('vB1','vB','farina',500,'g',0,'certa'),('vB2','vB','Pepe',0,'g',1,'mancante');");
      await P.avvia();
      await P.ev(() => openMandaInProduzione('rB', 'vB', { portions: 10, gpp: 100 }));
      await P.ev(() => confirmMandaInProduzione()); await P.page.waitForTimeout(300);
      assert.ok(/Manca la quantità di «Pepe»/.test(await P.ev(() => S.pendingMandaInProduzione.error)));
      assert.strictEqual(sql("select count(*) from production_sessions where source_variant_id='vB'"), '0');
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
