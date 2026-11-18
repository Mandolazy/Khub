/*
 * Test — P2-a.2, blocco 2e: dalla proposta confermata alla Bozza nel LAB
 * (Scheda nuova o esistente, salvataggio atteso, collegamento, ripetizioni senza duplicati).
 *
 * Pagina reale in Chromium + server reale con Anthropic SIMULATO nel server di
 * test (KHUB_TEST_IA_SIMULATA=1) + PostgREST e PostgreSQL locali con tutte le
 * migrazioni (0015 compresa). Nessuna chiamata AI reale, nessuna rete esterna.
 * Richiede KHUB_PG_TEST e KHUB_POSTGREST_BIN, altrimenti skip.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const CONN = process.env.KHUB_PG_TEST, BIN = process.env.KHUB_POSTGREST_BIN;
if (!CONN || !BIN) { console.log('P2-a.2 — Scheda da Idea UI: KHUB_PG_TEST o KHUB_POSTGREST_BIN non impostati, test non eseguito (skip)\n\n0 passed, 0 failed, 1 skipped'); process.exit(0); }
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { console.log('Playwright non disponibile'); process.exit(1); }

const ROOT = path.join(__dirname, '..');
const DB = 'khub_p2a2eu_' + process.pid;
const parti = Object.fromEntries(CONN.trim().split(/\s+/).map(x => x.split('=')));
const psql = (q, db = DB, file) => spawnSync('psql', [CONN + ' dbname=' + db, '-v', 'ON_ERROR_STOP=1', '-qtA'].concat(file ? ['-f', file] : ['-c', q]), { encoding: 'utf8' });
const sql = (q, db) => { const r = psql(q, db); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
const portaLibera = () => new Promise(ok => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const attendi = async (cond, ms, cosa) => { const t0 = Date.now(); while (!(await cond())) { if (Date.now() - t0 > ms) throw new Error('timeout: ' + cosa); await new Promise(r => setTimeout(r, 100)); } };
const righe = q => JSON.parse(sql('select coalesce(json_agg(t),\'[]\') from (' + q + ') t'));
const sha = t => crypto.createHash('sha256').update(t, 'utf8').digest('hex');
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok - ' + name); } catch (e) { failed++; console.log('  FAIL - ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 8).join('\n    ')); } }
const FOTO = process.env.KHUB_SCREENSHOT_DIR || null;

const figli = []; let tmp;
(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'khub-p2a2eu-'));
  try {
    sql("do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;" +
      " if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;" +
      " if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if; end $$;", 'postgres');
    sql('drop database if exists ' + DB, 'postgres'); sql('create database ' + DB, 'postgres');
    sql('grant usage on schema public to anon, authenticated, service_role;');
    const applica = f => { const r = psql(null, DB, f); if (r.status !== 0) throw new Error(path.basename(f) + ': ' + r.stderr); };
    applica(path.join(ROOT, 'scripts/db/p0c-schema-base-locale.sql'));
    const migrazioni = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort();
    migrazioni.filter(f => f < '0013').forEach(f => applica(path.join(ROOT, 'supabase/migrations', f)));
    sql('grant all on all tables in schema public to service_role;');
    migrazioni.filter(f => f >= '0013').forEach(f => applica(path.join(ROOT, 'supabase/migrations', f)));
    sql("insert into recipes (id,name,category,department,notes) values ('rA','Crema pasticcera','Dolci','Pasticceria','');" +
      "insert into variants (id,recipe_id,name,label,note,status,active,portions_count,grams_per_portion,steps) values ('vA','rA','Crema','Bozza 1','','lab',false,4,200,'[\"Scaldare.\"]');" +
      "insert into ingredients (id,variant_id,name,qty,unit,sort_order) values ('ingA1','vA','Latte',500,'ml',0);");
    const sommaRicette = () => sql("select md5((select string_agg(concat_ws('|',id,name),'#' order by id) from recipes)||(select string_agg(concat_ws('|',id,recipe_id,status,active),'#' order by id) from variants)||(select string_agg(concat_ws('|',id,variant_id,qty,unit),'#' order by id) from ingredients))");
    const sommaIniziale = sommaRicette();

    const portaRest = await portaLibera();
    const uri = 'postgres://' + (parti.user || 'postgres') + '@/' + DB + '?host=' + encodeURIComponent(parti.host || '/tmp') + '&port=' + (parti.port || 5432);
    fs.writeFileSync(path.join(tmp, 'pgrst.conf'), `db-uri = "${uri}"\ndb-schemas = "public"\ndb-anon-role = "service_role"\nserver-host = "127.0.0.1"\nserver-port = ${portaRest}\n`);
    figli.push(spawn(BIN, [path.join(tmp, 'pgrst.conf')], { stdio: 'ignore' }));
    const REST = 'http://127.0.0.1:' + portaRest;
    await attendi(async () => { try { return (await fetch(REST + '/')).ok; } catch (e) { return false; } }, 15000, 'PostgREST');
    const portaApp = await portaLibera();
    const app = spawn(process.execPath, [path.join(ROOT, 'scripts/_p0c-postgrest-server.js'), String(portaApp), REST], { env: { PATH: process.env.PATH, HOME: process.env.HOME, KHUB_TEST_IA_SIMULATA: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    figli.push(app); let logApp = ''; app.stdout.on('data', d => { logApp += d; }); app.stderr.on('data', d => { logApp += d; });
    await attendi(() => /pronto/.test(logApp), 15000, 'server di test');
    const ORIGINE = 'http://localhost:' + portaApp;
    const ia = async impost => (await fetch(ORIGINE + '/test/ia', impost ? { method: 'POST', body: JSON.stringify(impost) } : {})).json();
    console.log('P2-a.2 blocco 2e — Scheda da Idea UI (migrazioni ' + migrazioni.map(f => f.slice(0, 4)).join(', ') + ')');

    const browser = await chromium.launch();
    const azioni = [], guasti = [];
    const nuovaPagina = async (opz = {}) => {
      const context = await browser.newContext(opz.viewport ? { viewport: opz.viewport } : {});
      await context.route('**/*', async route => {
        const u = new URL(route.request().url());
        if (u.origin !== ORIGINE) return route.abort();
        if (/^\/lib\/[a-z]+\.js$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(ROOT, u.pathname)) });
        if (u.pathname === '/api/chat') {
          let b = {}; try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) { /* no */ }
          if (b.supabaseAction) azioni.push(b);
          const g = guasti.find(x => x.azione === b.supabaseAction && x.volte > 0);
          if (g) {
            g.volte--;
            if (g.modo === 'ko') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, errors: ['guasto simulato'] }) });
            if (g.modo === 'rete') return route.abort();
            if (g.modo === 'perso') { await route.fetch(); return route.fulfill({ status: 502, contentType: 'text/plain', body: 'risposta persa' }); } // arrivata al server, risposta persa
          }
        }
        return route.continue();
      });
      await context.addInitScript(() => { try { localStorage.setItem('khub_onboarded', '1'); } catch (e) { /* no */ } });
      const page = await context.newPage();
      const errori = []; page.on('pageerror', e => errori.push(String(e && e.message || e)));
      await page.goto(ORIGINE + '/khub_mvp.html'); await page.waitForFunction(() => typeof S !== 'undefined' && S.recipes.length > 0, null, { timeout: 15000 });
      const ev = (f, a) => page.evaluate(f, a);
      const api = body => ev(async b => (await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json(), body);
      const apri = async id => { await ev(() => caricaIdee()); await page.waitForFunction(i => S.idee && S.idee.stato === 'pronto' && S.idee.elenco.some(x => x.id === i), id); await ev(i => apriIdea(i), id); await page.waitForFunction(i => S.ideaChat && S.ideaChat[i] && S.ideaChat[i].stato === 'pronto', id); };
      return { page, context, ev, api, apri, errori };
    };
    let nConv = 0;
    const conv = (id, coppie) => coppie.forEach(([q, r]) => { const k = ++nConv; sql(`insert into idea_turns (id,idea_id,question,question_origin,question_hash,status,attempts,response,completed_at,created_at) values ('it_uiconv${String(k).padStart(8, '0')}','${id}',$q$${q}$q$,'testo','${sha(q)}','completato',1,$r$${r}$r$,now(),now() - interval '1 hour' + ${k} * interval '1 minute')`); });
    const crea = async (P, titolo, extra) => { const r = await P.api({ supabaseAction: 'createIdea', idea: Object.assign({ title: titolo, sourceType: 'appunto', sourceText: 'Spunto: ' + titolo }, extra || {}) }); assert.strictEqual(r.ok, true); return r.idea.id; };
    const prepara = async P => { await P.page.click('#idea-prepara-ricetta'); await P.page.waitForFunction(() => S.view === 'preview' || (S.ideaProposta && S.ideaProposta[S.ideaAperta] && !S.ideaProposta[S.ideaAperta].carica && (S.ideaProposta[S.ideaAperta].domanda || S.ideaProposta[S.ideaAperta].avviso)), null, { timeout: 15000 }); };
    const nomiIng = P => P.page.$$eval('.preview-ing-name-input', l => l.map(e => e.value));

    const P = await nuovaPagina();
    const turniMd5 = id => sql("select md5(string_agg(concat_ws('|',id,question,response,status),'#' order by id)) from idea_turns where idea_id='" + id + "'");
    const conteggi = () => sql("select (select count(*) from recipes)||'/'||(select count(*) from variants)||'/'||(select count(*) from ingredients)");
    const PROPOSTA = { pronta: true, titolo: 'Semifreddo albicocche e rosmarino', resa: { qty: 6, unit: 'porzioni', origine: 'ai', evidenza: null },
      ingredienti: [
        { nome: 'Albicocche', qty: 500, unit: 'g', qtyKind: 'certa', origine: 'chef', evidenza: 'userei 500 g di albicocche' },
        { nome: 'Panna fresca', qty: 250, unit: 'g', qtyKind: 'certa', origine: 'ai', evidenza: null },
        { nome: 'Zucchero', qty: 80, unit: 'g', qtyKind: 'certa', origine: 'ai', evidenza: null },
        { nome: 'Miele', qtyKind: 'intervallo', qtyMin: 20, qtyMax: 30, unit: 'g', origine: 'ai', evidenza: null },
        { nome: 'Rosmarino', qtyKind: 'variabile', origine: null, evidenza: null }],
      passi: ['Cuocere le albicocche.', 'Montare la panna.', 'Unire e congelare.'], scartate: ['muffin (rifiutati)'], note: null };
    await ia({ proposta: JSON.stringify(PROPOSTA) });
    const nuovaIdea = async titolo => {
      const id = await crea(P, titolo);
      conv(id, [['Vorrei un semifreddo con albicocche e rosmarino', 'Semifreddo con noci.'], ['Per le albicocche userei 500 g di albicocche.', 'Perfetto.']]);
      return id;
    };
    const allAnteprima = async id => { await P.apri(id); await prepara(P); await P.page.waitForSelector('#btn-save-idea'); };
    const attendiLab = () => P.page.waitForFunction(() => S.mode === 'lab' && S.view === 'recipe', null, { timeout: 15000 });
    const idea = id => righe("select status,linked_recipe_id,linked_variant_id,preview->>'tipo' as tipo from ideas where id='" + id + "'")[0];

    let nuova;
    await test('E1. nuova Scheda: correzioni dello chef salvate; quantita\' confermate certe, non confermate «da indicare» con la proposta in nota; resa non confermata non salvata; poi collegamento e Bozza aperta nel LAB', async () => {
      const id = await nuovaIdea('Semifreddo estivo'); const t0 = turniMd5(id);
      await allAnteprima(id);
      assert.match(await P.page.textContent('#btn-save-idea'), /Crea la Scheda e apri nel LAB/);
      assert.ok(await P.page.$('#preview-idea-resa'), 'conferma della resa proposta');
      await P.page.fill('#prev-name', 'Semifreddo dello chef');
      await P.page.check('[data-idea-conferma="2"]'); await P.page.waitForFunction(() => S.loadPreview.ingredients[2].quantitaConfermata);   // Zucchero confermato
      const q = await P.page.$('[data-prev-ing="1"][data-field="qty"]'); await q.fill('300'); await q.dispatchEvent('change');            // Panna modificata
      await P.page.waitForFunction(() => S.loadPreview.ingredients[1].modificataDaChef);
      await P.page.fill('[data-idea-passo="1"]', 'Montare la panna ben fredda.');
      await P.page.click('#preview-idea-aggiungi-ing'); await P.page.fill('[data-idea-ing="5"]', 'Noci tostate');
      const ai0 = (await ia()).chiamate.length; const a0 = azioni.length;
      await P.page.click('#btn-save-idea'); await attendiLab();
      assert.strictEqual((await ia()).chiamate.length, ai0, 'nessuna chiamata AI per il salvataggio');
      const seq = azioni.slice(a0).map(x => x.supabaseAction);
      assert.deepStrictEqual(seq.filter(x => x === 'save' || x === 'linkIdeaToRecipe'), ['save', 'linkIdeaToRecipe'], seq.join(','));
      const i1 = idea(id); assert.strictEqual(i1.status, 'trasformata'); assert.strictEqual(i1.tipo, 'proposta_michelinai', 'proposta conservata nell\'Idea');
      nuova = { id, recipeId: i1.linked_recipe_id, variantId: i1.linked_variant_id };
      assert.deepStrictEqual(righe("select name from recipes where id='" + nuova.recipeId + "'"), [{ name: 'Semifreddo dello chef' }]);
      const v = righe("select status,active,declared_yield_qty,note,steps from variants where id='" + nuova.variantId + "' and recipe_id='" + nuova.recipeId + "'")[0];
      assert.strictEqual(v.status, 'lab'); assert.strictEqual(v.active, false);
      assert.strictEqual(v.declared_yield_qty, null, 'resa di MichelinAI non confermata: non salvata');
      assert.match(v.note, /Dall'Idea «Semifreddo estivo».*Resa proposta da MichelinAI, non confermata: 6 porzioni/);
      assert.deepStrictEqual(JSON.parse(v.steps), ['Cuocere le albicocche.', 'Montare la panna ben fredda.', 'Unire e congelare.']);
      const ings = righe("select name,qty,unit,qty_kind,qty_min,qty_max,source_text from ingredients where variant_id='" + nuova.variantId + "' order by sort_order");
      assert.deepStrictEqual(ings.map(x => [x.name, x.qty_kind, Number(x.qty), x.unit]), [['Albicocche', 'certa', 500, 'g'], ['Panna fresca', 'certa', 300, 'g'], ['Zucchero', 'certa', 80, 'g'], ['Miele', 'mancante', 0, 'g'], ['Rosmarino', 'variabile', 0, 'g'], ['Noci tostate', 'mancante', 0, 'g']]);
      assert.strictEqual(ings[0].source_text, 'userei 500 g di albicocche', 'citazione dello chef');
      assert.strictEqual(ings[1].source_text, null); assert.strictEqual(ings[2].source_text, null);
      assert.match(ings[3].source_text, /^Proposta di MichelinAI, non confermata: 20.30 g$/); assert.strictEqual(ings[3].qty_min, null);
      // LAB: proprio la nuova Bozza.
      assert.deepStrictEqual(await P.ev(() => ({ s: S.selectedId, v: curLab(R(S.selectedId)).id })), { s: nuova.recipeId, v: nuova.variantId });
      assert.strictEqual(turniMd5(id), t0, 'conversazione intatta');
    });

    await test('E2. Idea trasformata: conversazione conservata in sola lettura, collegamento alla Scheda, nessun «Prepara la Ricetta»', async () => {
      await P.apri(nuova.id);
      assert.match(await P.page.textContent('#idea-dettaglio'), /Trasformata nella Scheda «Semifreddo dello chef»/);
      assert.ok(await P.page.$('#idea-chat-sola-lettura')); assert.strictEqual(await P.page.$$eval('#idea-prepara-ricetta,#idea-riprendi-salvataggio', l => l.length), 0);
      assert.strictEqual(await P.page.$$eval('.idee-turno, .idee-msg, [data-turno]', l => l.length) > 0 || /Vorrei un semifreddo/.test(await P.page.textContent('#idea-conversazione')), true);
    });

    await test('E3. Scheda esistente: nuova Bozza nella Scheda scelta, Ricetta attiva e Bozza esistente invariate, LAB sulla nuova Bozza', async () => {
      sql("insert into variants (id,recipe_id,name,label,note,status,active,portions_count,grams_per_portion,steps) values ('vAttiva','rA','Crema','Ricetta','','validated',true,4,200,'[\"Scaldare.\"]') on conflict do nothing");
      const attiva = () => sql("select md5(string_agg(concat_ws('|',v.id,v.status,v.active,v.name,v.note,v.portions_count,v.steps,i.id,i.qty,i.unit),'#' order by v.id,i.id)) from variants v left join ingredients i on i.variant_id=v.id where v.id in ('vA','vAttiva')");
      await P.page.reload(); await P.page.waitForFunction(() => typeof S !== 'undefined' && S.recipes.length > 0);
      const a0 = attiva();
      const id = await nuovaIdea('Crema al rosmarino');
      await allAnteprima(id);
      await P.page.click('#preview-idea-dest-esistente'); await P.page.selectOption('#preview-idea-scheda', 'rA');
      assert.match(await P.page.textContent('#btn-save-idea'), /Aggiungi come Bozza e apri nel LAB/);
      await P.page.click('#preview-idea-conferma-tutte');
      await P.page.click('#btn-save-idea'); await attendiLab();
      const i1 = idea(id); assert.strictEqual(i1.linked_recipe_id, 'rA');
      assert.strictEqual(attiva(), a0, 'Ricetta attiva e Bozza esistente invariate');
      assert.strictEqual(sql("select count(*) from variants where recipe_id='rA' and status='lab'"), '2');
      assert.deepStrictEqual(righe("select qty_kind,qty from ingredients where variant_id='" + i1.linked_variant_id + "' and name='Panna fresca'").map(x => [x.qty_kind, Number(x.qty)]), [['certa', 250]], 'confermata = certa');
      assert.deepStrictEqual(await P.ev(() => ({ s: S.selectedId, v: curLab(R(S.selectedId)).id, n: R('rA').validatedVariants.length })), { s: 'rA', v: i1.linked_variant_id, n: 1 });
    });

    await test('E4. salvataggio fallito: nessun collegamento, nessuna Scheda visibile; «Riprova» (anche dopo una risposta persa) senza duplicati', async () => {
      const id = await nuovaIdea('Prova guasti salvataggio');
      await allAnteprima(id);
      const c0 = conteggi(), a0 = azioni.length;
      guasti.push({ azione: 'save', modo: 'ko', volte: 1 });
      await P.page.click('#btn-save-idea');
      await P.page.waitForSelector('#idea-salva-riprova');
      assert.strictEqual(await P.ev(() => document.querySelector('#preview-idea-salvataggio').dataset.stato), 'errore_salvataggio');
      assert.ok(!azioni.slice(a0).some(x => x.supabaseAction === 'linkIdeaToRecipe'), 'nessun collegamento prima della conferma');
      assert.strictEqual(idea(id).status, 'aperta'); assert.strictEqual(conteggi(), c0);
      const rid = await P.ev(i => ideaSalvaLeggi(i).recipeId, id);
      assert.strictEqual(await P.ev(r => !!R(r), rid), false, 'nessuna Scheda non salvata visibile');
      guasti.push({ azione: 'save', modo: 'perso', volte: 1 }); // arriva al database, la risposta si perde
      await P.page.click('#idea-salva-riprova');
      await P.page.waitForFunction(() => document.querySelector('#preview-idea-salvataggio') && document.querySelector('#preview-idea-salvataggio').dataset.stato === 'errore_salvataggio' && document.querySelector('#idea-salva-riprova'));
      const dopoPerso = conteggi(); assert.notStrictEqual(dopoPerso, c0, 'righe scritte nel database');
      assert.strictEqual(idea(id).status, 'aperta');
      await P.page.click('#idea-salva-riprova'); await attendiLab();
      assert.strictEqual(conteggi(), dopoPerso, 'ripetizione = stesse righe, nessun duplicato');
      assert.strictEqual(sql("select count(*) from recipes where name='Semifreddo albicocche e rosmarino'"), '1');
      assert.strictEqual(idea(id).status, 'trasformata');
    });

    await test('E5. collegamento fallito: Ricetta salvata, Idea aperta; «Collega di nuovo» collega senza salvare di nuovo; ricaricando la pagina si riprende senza duplicati', async () => {
      const id = await nuovaIdea('Prova guasti collegamento');
      await allAnteprima(id);
      const c0 = conteggi();
      guasti.push({ azione: 'linkIdeaToRecipe', modo: 'rete', volte: 1 });
      await P.page.click('#btn-save-idea');
      await P.page.waitForSelector('#idea-collega-riprova');
      const c1 = conteggi(); assert.notStrictEqual(c1, c0, 'Ricetta salvata');
      assert.strictEqual(idea(id).status, 'aperta');
      assert.ok(await P.page.$('#idea-apri-bozza'), 'la Bozza si puo\' aprire anche prima del collegamento');
      // Pagina ricaricata: il salvataggio da completare e' ricordato; nessun nuovo «Prepara la Ricetta».
      await P.page.reload(); await P.page.waitForFunction(() => typeof S !== 'undefined' && S.recipes.length > 0);
      await P.apri(id);
      assert.match(await P.page.textContent('#idea-salvataggio-da-riprendere'), /salvata ma non ancora collegata/);
      assert.strictEqual(await P.page.$$eval('#idea-prepara-ricetta', l => l.length), 0);
      await P.page.click('#idea-riprendi-salvataggio'); await P.page.waitForSelector('#idea-collega-riprova');
      const a0 = azioni.length;
      await P.page.click('#idea-collega-riprova'); await attendiLab();
      assert.deepStrictEqual(azioni.slice(a0).map(x => x.supabaseAction).filter(x => x === 'save' || x === 'linkIdeaToRecipe'), ['linkIdeaToRecipe'], 'nessun nuovo salvataggio');
      assert.strictEqual(conteggi(), c1); assert.strictEqual(idea(id).status, 'trasformata');
      assert.strictEqual(await P.ev(i => localStorage.getItem('khub.ideaSalvataggio.' + i), id), null, 'registro chiuso');
    });

    await test('E6. pagina chiusa durante il salvataggio: alla riapertura si riprova con gli stessi id (nessuna seconda Scheda)', async () => {
      const id = await nuovaIdea('Prova chiusura');
      await allAnteprima(id);
      guasti.push({ azione: 'save', modo: 'perso', volte: 1 });
      await P.page.click('#btn-save-idea'); await P.page.waitForSelector('#idea-salva-riprova');
      const reg = await P.ev(i => JSON.parse(localStorage.getItem('khub.ideaSalvataggio.' + i)), id);
      // simula la chiusura a meta' (stato in corso salvato nel browser)
      await P.ev(([i, r]) => localStorage.setItem('khub.ideaSalvataggio.' + i, JSON.stringify(Object.assign(r, { stato: 'salvataggio' }))), [id, reg]);
      const c1 = conteggi();
      await P.page.reload(); await P.page.waitForFunction(() => typeof S !== 'undefined' && S.recipes.length > 0);
      await P.apri(id); await P.page.click('#idea-riprendi-salvataggio'); await P.page.click('#idea-salva-riprova'); await attendiLab();
      assert.strictEqual(conteggi(), c1, 'stesse righe'); assert.strictEqual(idea(id).linked_recipe_id, reg.recipeId);
      assert.strictEqual(sql("select count(*) from recipes where id='" + reg.recipeId + "'"), '1');
    });

    await test('E7. controlli prima del salvataggio: nome vuoto o quantita\' senza unita\' fermano tutto, nessuna richiesta di salvataggio', async () => {
      const id = await nuovaIdea('Prova controlli');
      await allAnteprima(id);
      const a0 = azioni.length;
      await P.page.fill('#prev-name', '   ');
      await P.page.click('#btn-save-idea');
      await P.page.waitForTimeout(300);
      assert.ok(!azioni.slice(a0).some(x => x.supabaseAction === 'save'));
      assert.strictEqual(await P.ev(i => ideaSalvaLeggi(i), id), null, 'nessun registro');
      await P.page.fill('#prev-name', 'Con nome');
      await P.page.click('#preview-idea-aggiungi-ing'); await P.page.fill('[data-idea-ing="5"]', 'Sale');
      const q = await P.page.$('[data-prev-ing="5"][data-field="qty"]'); await q.fill('5'); await q.dispatchEvent('change');
      await P.page.waitForTimeout(100);
      await P.page.click('#btn-save-idea'); await P.page.waitForTimeout(300);
      assert.ok(!azioni.slice(a0).some(x => x.supabaseAction === 'save'), 'unita\' mancante');
      assert.strictEqual(idea(id).status, 'aperta');
      await P.ev(() => { S.loadPreview = null; S.view = 'app-home'; render(); });
    });

    await test('E8. Import Engine invariato: «Crea Scheda» dell\'importazione atterra sulla Scheda (non nel LAB) e salva come prima', async () => {
      await P.ev(() => { S.loadPreview = { name: 'Pane importato', category: 'Pane', portionsCount: 0, gramsPerPortion: 0, declaredYield: { qty: '', unit: '', source: '', range: null, toVerify: false }, ingredients: [{ id: 'x1', name: 'Farina', qty: 1000, unit: 'g' }], steps: ['Impastare.'], subRecipes: [] }; S.loadDestinazione = 'nuova'; S.view = 'preview'; render(); });
      assert.ok(await P.page.$('#btn-save-preview')); assert.strictEqual(await P.page.$$eval('#btn-save-idea,#preview-idea-fine', l => l.length), 0);
      await P.page.click('#btn-save-preview');
      await P.page.waitForFunction(() => S.view === 'ricetta-madre-v2');
      await attendi(() => sql("select count(*) from recipes where name='Pane importato'") === '1', 8000, 'salvataggio dell\'importazione');
      assert.strictEqual(sql("select note from variants v join recipes r on r.id=v.recipe_id where r.name='Pane importato'"), 'Importata');
    });

    await test('E9. smartphone: destinazione e salvataggio raggiungibili, nessuno scorrimento orizzontale', async () => {
      const M = await nuovaPagina({ viewport: { width: 375, height: 760 } });
      const id = await crea(M, 'Da telefono'); conv(id, [['Vorrei un semifreddo con albicocche', 'Semifreddo.']]);
      await M.apri(id); await prepara(M); await M.page.waitForSelector('#btn-save-idea');
      assert.ok(await M.ev(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'nessuno scorrimento orizzontale');
      await M.page.click('#preview-idea-dest-esistente');
      assert.ok(await M.ev(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      const box = await (await M.page.$('#btn-save-idea')).boundingBox(); assert.ok(box && box.x >= 0 && box.x + box.width <= 376);
      if (FOTO) await M.page.screenshot({ path: path.join(FOTO, 'p2a2e-telefono.png'), fullPage: true });
      assert.deepStrictEqual(M.errori, []); await M.context.close();
    });

    await test('E11. due dispositivi sulla stessa Idea: chi prenota per primo salva; l\'altro non salva nulla, torna all\'Idea con l\'avviso; una sola Ricetta', async () => {
      const id = await nuovaIdea('Due dispositivi');
      const B = await nuovaPagina(); // secondo dispositivo: altro browser, altro registro
      await allAnteprima(id);
      await B.apri(id); await prepara(B); await B.page.waitForSelector('#btn-save-idea');
      guasti.push({ azione: 'save', modo: 'ko', volte: 1 }); // il primo dispositivo prenota ma il salvataggio fallisce
      await P.page.click('#btn-save-idea'); await P.page.waitForSelector('#idea-salva-riprova');
      const c0 = conteggi();
      await B.page.click('#btn-save-idea');
      await B.page.waitForFunction(() => S.view === 'idea', null, { timeout: 15000 });
      assert.strictEqual(conteggi(), c0, 'il secondo dispositivo non salva nulla');
      assert.strictEqual(await B.ev(i => localStorage.getItem('khub.ideaSalvataggio.' + i), id), null);
      assert.strictEqual(idea(id).status, 'aperta');
      await P.page.click('#idea-salva-riprova'); await attendiLab();
      assert.strictEqual(idea(id).status, 'trasformata');
      assert.strictEqual(sql("select count(*) from recipes where id in (select linked_recipe_id from ideas where id='" + id + "')"), '1');
      assert.deepStrictEqual(B.errori, []); await B.context.close();
    });

    await test('E10. nessun errore JavaScript; solo le azioni previste; nessuna chiamata AI nei salvataggi; credenziali mai nella pagina', async () => {
      assert.deepStrictEqual(P.errori, []);
      const ammesse = ['load', 'loadConversions', 'loadFamilies', 'loadIdeas', 'loadIdeaTurns', 'createIdea', 'ideaProposal', 'claimIdeaRecipe', 'save', 'linkIdeaToRecipe'];
      const altre = [...new Set(azioni.map(a => a.supabaseAction))].filter(a => !ammesse.includes(a));
      assert.deepStrictEqual(altre.filter(a => !/^load/.test(a)), [], altre.join(','));
      const html = await P.page.content();
      assert.ok(!/sb_secret|ANTHROPIC_API_KEY/.test(html));
    });
    await browser.close();
  } catch (e) {
    failed++; console.log('ERRORE', e && e.stack || e);
  } finally {
    figli.forEach(p => { try { p.kill(); } catch (e) { /* no */ } });
    await new Promise(r => setTimeout(r, 300));
    psql('drop database if exists ' + DB + ' with (force)', 'postgres');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* no */ }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
