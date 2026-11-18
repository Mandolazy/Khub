/*
 * Test — P2-a.2, blocco 2d: «Prepara la Ricetta» e anteprima della proposta.
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
if (!CONN || !BIN) { console.log('P2-a.2 — proposta UI: KHUB_PG_TEST o KHUB_POSTGREST_BIN non impostati, test non eseguito (skip)\n\n0 passed, 0 failed, 1 skipped'); process.exit(0); }
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { console.log('Playwright non disponibile'); process.exit(1); }

const ROOT = path.join(__dirname, '..');
const DB = 'khub_p2a2du_' + process.pid;
const parti = Object.fromEntries(CONN.trim().split(/\s+/).map(x => x.split('=')));
const psql = (q, db = DB, file) => spawnSync('psql', [CONN + ' dbname=' + db, '-v', 'ON_ERROR_STOP=1', '-qtA'].concat(file ? ['-f', file] : ['-c', q]), { encoding: 'utf8' });
const sql = (q, db) => { const r = psql(q, db); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
const portaLibera = () => new Promise(ok => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const attendi = async (cond, ms, cosa) => { const t0 = Date.now(); while (!(await cond())) { if (Date.now() - t0 > ms) throw new Error('timeout: ' + cosa); await new Promise(r => setTimeout(r, 100)); } };
const sha = t => crypto.createHash('sha256').update(t, 'utf8').digest('hex');
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok - ' + name); } catch (e) { failed++; console.log('  FAIL - ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 8).join('\n    ')); } }
const FOTO = process.env.KHUB_SCREENSHOT_DIR || null;

const figli = []; let tmp;
(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'khub-p2a2du-'));
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
    console.log('P2-a.2 blocco 2d — proposta UI (migrazioni ' + migrazioni.map(f => f.slice(0, 4)).join(', ') + ')');

    const browser = await chromium.launch();
    const azioni = [];
    const nuovaPagina = async (opz = {}) => {
      const context = await browser.newContext(opz.viewport ? { viewport: opz.viewport } : {});
      await context.route('**/*', async route => {
        const u = new URL(route.request().url());
        if (u.origin !== ORIGINE) return route.abort();
        if (/^\/lib\/[a-z]+\.js$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(ROOT, u.pathname)) });
        if (u.pathname === '/api/chat') { let b = {}; try { b = JSON.parse(route.request().postData() || '{}'); } catch (e) { /* no */ } if (b.supabaseAction) azioni.push(b); }
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
    const ideaA = await crea(P, 'Albicocche e rosmarino');
    conv(ideaA, [['Vorrei creare un dessert con albicocche e rosmarino', 'Muffin, crostata o dolce al cucchiaio.'], ['Non voglio muffin. Preferisco un dolce al cucchiaio.', 'Semifreddo con mandorle.'], ['Mi piace. Metterei le noci al posto delle mandorle.', 'Noci al posto delle mandorle.']]);

    await test('U1. «Prepara la Ricetta» nel dettaglio di un\'Idea aperta con conversazione o testo; assente senza contenuto e nelle Idee chiuse', async () => {
      await P.apri(ideaA);
      assert.match(await P.page.textContent('#idea-prepara-ricetta'), /^Prepara la Ricetta$/);
      const soloLink = await crea(P, 'Solo link', { sourceType: 'link', sourceText: undefined, sourceUrl: 'https://x.test/a' });
      await P.apri(soloLink); assert.strictEqual(await P.page.$$eval('#idea-prepara-ricetta', l => l.length), 0);
      const arch = await crea(P, 'Archiviata'); conv(arch, [['Ciao', 'Ciao']]); await P.api({ supabaseAction: 'archiveIdea', id: arch });
      await P.apri(arch); assert.strictEqual(await P.page.$$eval('#idea-prepara-ricetta', l => l.length), 0);
    });

    await test('U2. preparazione: attesa visibile, poi l\'anteprima esistente dell\'Import Engine con la proposta (semifreddo e noci); scarti solo nel riepilogo; nessun salvataggio ne\' destinazione in questo blocco', async () => {
      await P.apri(ideaA);
      await ia({ ritardo: 600 });
      await P.page.click('#idea-prepara-ricetta');
      await P.page.waitForFunction(() => /preparando la proposta/.test(document.querySelector('#idea-prepara-ricetta').textContent) && document.querySelector('#idea-prepara-ricetta').disabled);
      await P.page.waitForFunction(() => S.view === 'preview', null, { timeout: 15000 }); await ia({ ritardo: 0 });
      assert.strictEqual(await P.page.inputValue('#prev-name'), 'Semifreddo albicocche, rosmarino e noci');
      const nomi = await nomiIng(P);
      assert.deepStrictEqual(nomi, ['Albicocche', 'Panna fresca', 'Zucchero', 'Noci', 'Rosmarino']);
      assert.match(await P.page.textContent('#preview-idea-scartate'), /muffin \(rifiutati\).*mandorle \(sostituite dalle noci\)/);
      assert.strictEqual(await P.page.$$eval('#btn-save-preview,#prev-scheda-esistente', l => l.length), 0, 'salvataggio e destinazione arrivano con il blocco 2e');
      assert.strictEqual(await P.ev(() => document.body.getAttribute('data-d3-amb')), 'idee', 'navigazione: sezione Idee');
      assert.deepStrictEqual(await P.page.$$eval('#sidebar .active', l => l.map(e => e.id)), ['sb-idee']);
      assert.strictEqual(await P.page.inputValue('#prev-yield-qty'), '6'); assert.strictEqual(await P.page.inputValue('#prev-yield-unit'), 'porzioni');
      assert.match(await P.page.textContent('#preview-fonte-idea'), /Proposta di MichelinAI/);
    });

    await test('U3. provenienza delle quantita\': «Indicata da te», «Dalla fonte», «Proposta di MichelinAI · da confermare»; il conteggio da confermare nel riepilogo', async () => {
      const id = await crea(P, 'Provenienze', { sourceType: 'testo', sourceText: 'Base: 200 g di panna e 3 tuorli.' });
      conv(id, [['Per lo zucchero metterei 90 g di zucchero di canna', 'Va bene.']]);
      await ia({ proposta: JSON.stringify({ pronta: true, titolo: 'Crema', ingredienti: [
        { nome: 'Panna', qty: 200, unit: 'g', qtyKind: 'certa', origine: 'fonte', evidenza: '200 g di panna' },
        { nome: 'Zucchero di canna', qty: 90, unit: 'g', qtyKind: 'certa', origine: 'chef', evidenza: 'metterei 90 g di zucchero di canna' },
        { nome: 'Latte', qty: 150, unit: 'ml', qtyKind: 'certa', origine: 'chef', evidenza: '150 ml di latte' },
        { nome: 'Tuorli', qty: 3, unit: 'n', qtyKind: 'certa', origine: 'ai' }], passi: ['Cuocere.'], scartate: [] }) });
      await P.apri(id); await prepara(P); await ia({ proposta: null });
      const orig = await P.page.$$eval('.idea-prev-origine', l => l.map(e => [e.dataset.origine, e.querySelector('.idea-orig').textContent.trim()]));
      assert.deepStrictEqual(orig, [['fonte', 'Dalla fonte'], ['chef', 'Indicata da te'], ['ai', 'Proposta di MichelinAI · da confermare'], ['ai', 'Proposta di MichelinAI · da confermare']]);
      assert.match(await P.page.textContent('#preview-idea-quantita'), /^2 quantità proposte da MichelinAI da confermare/);
      assert.match(await P.page.textContent('.idea-prev-origine[data-origine="chef"]'), /«metterei 90 g di zucchero di canna»/);
    });

    await test('U4. consenso esplicito: conferma singola, «Conferma tutte», ritiro della conferma; una quantita\' non confermata resta tale', async () => {
      await P.page.check('[data-idea-conferma="2"]');
      assert.match(await P.page.textContent('#preview-idea-quantita'), /^1 quantità proposta da MichelinAI da confermare/);
      assert.strictEqual(await P.ev(() => S.loadPreview.ingredients[2].quantitaConfermata), true);
      await P.page.click('#preview-idea-conferma-tutte');
      assert.match(await P.page.textContent('#preview-idea-quantita'), /Nessuna quantità di MichelinAI da confermare/);
      assert.strictEqual(await P.page.$$eval('#preview-idea-conferma-tutte', l => l.length), 0);
      await P.page.uncheck('[data-idea-conferma="3"]');
      assert.deepStrictEqual(await P.ev(() => S.loadPreview.ingredients.map(i => [i.origineQuantita, i.quantitaConfermata])), [['fonte', true], ['chef', true], ['ai', true], ['ai', false]]);
      const righeOrig = await P.page.$$eval('.idea-prev-origine', l => l.map(e => e.textContent));
      assert.match(righeOrig[3], /da confermare/, 'la quantità ritirata torna «da confermare»');
    });

    await test('U5. correzioni manuali: titolo, nomi, quantita\' (diventa «Modificata da te» con la proposta originale visibile), unita\', passaggi, resa e porzioni; ingredienti e passaggi aggiunti o tolti; nulla si perde ai ridisegni', async () => {
      await P.apri(ideaA); await prepara(P);
      await P.page.fill('#prev-name', 'Semifreddo di albicocche alle noci');
      await P.page.fill('[data-idea-ing="1"]', 'Panna fresca 35%');
      await P.page.fill('[data-prev-ing="0"][data-field="qty"]', '450'); await P.page.dispatchEvent('[data-prev-ing="0"][data-field="qty"]', 'change');
      await P.page.waitForSelector('.idea-orig-chef');
      assert.match(await P.page.textContent('.idea-prev-origine'), /Modificata da te\s+proposta di MichelinAI: 400 g/);
      await P.page.selectOption('[data-prev-ing="2"][data-field="unit"]', 'kg');
      await P.page.fill('[data-idea-passo="1"]', 'Montare la panna a neve morbida.');
      await P.page.fill('#prev-portions', '8'); await P.page.fill('#prev-yield-qty', '8');
      await P.page.click('#preview-idea-aggiungi-ing'); await P.page.fill('[data-idea-ing="5"]', 'Miele');
      await P.page.click('#preview-idea-aggiungi-passo'); await P.page.fill('[data-idea-passo="3"]', 'Servire con miele.');
      await P.page.click('.preview-ing-row:nth-of-type(5) .preview-ing-rimuovi').catch(async () => { await P.ev(() => ideaPrevRimuoviIng(4)); });
      await P.page.click('#preview-idea-conferma-tutte'); // ridisegno
      assert.strictEqual(await P.page.inputValue('#prev-name'), 'Semifreddo di albicocche alle noci');
      assert.strictEqual(await P.page.inputValue('#prev-portions'), '8');
      assert.strictEqual(await P.page.inputValue('#prev-yield-qty'), '8');
      const st = await P.ev(() => ({ n: S.loadPreview.ingredients.map(i => [i.name, i.qty, i.unit, i.origineQuantita, i.quantitaConfermata]), p: S.loadPreview.steps }));
      assert.deepStrictEqual(st.n.map(x => x[0]), ['Albicocche', 'Panna fresca 35%', 'Zucchero', 'Noci', 'Miele']);
      assert.deepStrictEqual(st.n[0].slice(1), [450, 'g', 'chef', true]);
      assert.strictEqual(st.n[2][2], 'kg');
      assert.deepStrictEqual(st.p, ['Cuocere le albicocche con lo zucchero e il rosmarino.', 'Montare la panna a neve morbida.', 'Aggiungere le noci tostate e congelare.', 'Servire con miele.']);
      // Torna all'Idea e riapre: stessa proposta (nessuna nuova chiamata AI) con le correzioni.
      const ai0 = (await ia()).chiamate.length;
      await P.page.click('#btn-back-idea'); await P.page.waitForSelector('#idea-prepara-ricetta');
      assert.match(await P.page.textContent('#idea-prepara-ricetta'), /aggiornata/);
      await prepara(P);
      assert.strictEqual((await ia()).chiamate.length, ai0, 'nessuna nuova chiamata AI');
      assert.strictEqual(await P.page.inputValue('#prev-name'), 'Semifreddo di albicocche alle noci', 'correzioni conservate nella sessione');
    });

    await test('U5b. quantita\' modificata e subito dopo un altro comando (il campo viene sostituito dal ridisegno): valore conservato, nessun errore JavaScript', async () => {
      const e0 = P.errori.length;
      await P.page.fill('[data-prev-ing="3"][data-field="qty"]', '75');
      await P.page.click('#preview-idea-rigenera').catch(() => {}); // qualunque comando che ridisegna
      await P.page.waitForFunction(() => S.view === 'preview' && !(S.ideaProposta[S.loadPreview.importFonte.ideaId] || {}).carica, null, { timeout: 15000 });
      await P.ev(i => { /* torna alla proposta corretta per il resto dei test */ }, null);
      assert.deepStrictEqual(P.errori.slice(e0), [], 'nessun errore JavaScript');
      // Caso diretto: modifica + comando che ridisegna subito (Conferma tutte).
      await P.page.fill('[data-prev-ing="1"][data-field="qty"]', '275');
      await P.ev(() => ideaPrevConfermaTutte());
      await P.page.waitForTimeout(100);
      assert.strictEqual(await P.ev(() => S.loadPreview.ingredients[1].qty), 275, 'la quantita\' scritta non va persa');
      assert.strictEqual(await P.page.inputValue('[data-prev-ing="1"][data-field="qty"]'), '275');
      assert.deepStrictEqual(P.errori.slice(e0), []);
    });

    await test('U6. chiarimento richiesto da MichelinAI: domanda nel dettaglio dell\'Idea, nessuna anteprima; errore dell\'AI: avviso comprensibile e pulsante di nuovo disponibile', async () => {
      const id = await crea(P, 'Ambigua'); conv(id, [['Qualcosa con le pere', 'Torta o sorbetto?']]);
      await ia({ proposta: JSON.stringify({ pronta: false, domanda: 'Preferisci la torta o il sorbetto?' }) });
      await P.apri(id); await prepara(P);
      assert.strictEqual(await P.ev(() => S.view), 'idea');
      assert.match(await P.page.textContent('#idea-ricetta-domanda'), /Preferisci la torta o il sorbetto\?.*Rispondi nella conversazione/s);
      await ia({ proposta: null, modo: 'errore' });
      await prepara(P);
      assert.match(await P.page.textContent('#idea-ricetta-avviso'), /non è disponibile/);
      assert.strictEqual(await P.page.isDisabled('#idea-prepara-ricetta'), false);
      await ia({ modo: 'ok' });
    });

    await test('U7. sicurezza: HTML e script in titolo, ingredienti, passaggi e scarti mostrati come testo; nessun elemento iniettato', async () => {
      const id = await crea(P, 'Ostile'); conv(id, [['Prova', 'Ok']]);
      await ia({ proposta: JSON.stringify({ pronta: true, titolo: '<img src=x onerror="window.__xss=1">Titolo', ingredienti: [{ nome: '<script>window.__xss=2</script>Sale', qtyKind: 'variabile' }],
        passi: ['<b onclick="window.__xss=3">Passo</b>'], scartate: ['<svg onload="window.__xss=4"></svg>muffin'] }) });
      await P.apri(id); await prepara(P); await ia({ proposta: null });
      assert.strictEqual(await P.page.inputValue('#prev-name'), '<img src=x onerror="window.__xss=1">Titolo');
      assert.deepStrictEqual(await nomiIng(P), ['<script>window.__xss=2</script>Sale']);
      assert.strictEqual(await P.page.inputValue('[data-idea-passo="0"]'), '<b onclick="window.__xss=3">Passo</b>');
      assert.match(await P.page.textContent('#preview-idea-scartate'), /<svg onload="window.__xss=4"><\/svg>muffin/);
      assert.strictEqual(await P.page.$$eval('.preview-da-idea img, .preview-da-idea script, .preview-da-idea svg:not([class]), .preview-da-idea b', l => l.length), 0);
      await P.page.waitForTimeout(150);
      assert.strictEqual(await P.ev(() => window.__xss), undefined);
    });

    await test('U8. importazione invariata: un\'anteprima di importazione ha ancora destinazione e «Crea Scheda», nessun elemento delle Idee', async () => {
      await P.ev(() => { S.loadPreview = { name: 'Importata', category: '', portionsCount: 0, gramsPerPortion: 0, declaredYield: { qty: '', unit: '', source: '', range: null, toVerify: false }, ingredients: [{ id: 'x1', name: 'Farina', qty: 500, unit: 'g', qtyKind: 'certa' }], steps: ['Impastare.'], subRecipes: [], importFonte: { tipo: 'strutturata' } }; S.loadDestinazione = 'nuova'; S.view = 'preview'; render(); });
      assert.strictEqual(await P.page.$$eval('#btn-save-preview', l => l.length), 1);
      assert.strictEqual(await P.page.$$eval('.preview-fonte-idea,.preview-ing-name-input,.idea-prev-origine,#btn-back-idea,[data-idea-passo]', l => l.length), 0);
      assert.strictEqual(await P.ev(() => document.body.getAttribute('data-d3-amb')), 'schede');
      await P.ev(() => { S.loadPreview = null; S.view = 'app-home'; render(); });
    });

    await test('U9. smartphone (390 px): anteprima della proposta senza scorrimento orizzontale', async () => {
      const M = await nuovaPagina({ viewport: { width: 390, height: 844 } });
      try {
        await M.apri(ideaA); await prepara(M);
        assert.ok(await M.ev(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
        if (FOTO) { await M.page.screenshot({ path: path.join(FOTO, 'mobile-anteprima.png') }); }
        assert.deepStrictEqual(M.errori, []);
      } finally { await M.context.close(); }
    });

    if (FOTO) {
      const D = await nuovaPagina({ viewport: { width: 1280, height: 900 } });
      await D.apri(ideaA); await D.page.mouse.move(1270, 890); await D.page.waitForTimeout(300);
      await D.ev(() => document.getElementById('idea-ricetta').scrollIntoView({ block: 'center' })); await D.page.waitForTimeout(200);
      await D.page.screenshot({ path: path.join(FOTO, 'desktop-idea-prepara.png') });
      await prepara(D); await D.page.waitForTimeout(300);
      await D.page.screenshot({ path: path.join(FOTO, 'desktop-anteprima.png'), fullPage: true });
      await D.context.close();
    }

    await test('U10. nessuna Ricetta o Scheda creata, conversazione intatta, solo le azioni previste, nessun errore JavaScript', async () => {
      assert.strictEqual(sommaRicette(), sommaIniziale);
      assert.strictEqual(sql("select count(*) from idea_turns where idea_id='" + ideaA + "'"), '3');
      const nomi = [...new Set(azioni.map(b => b.supabaseAction))].filter(a => /idea/i.test(a)).sort();
      assert.deepStrictEqual(nomi.filter(a => !['archiveIdea', 'createIdea', 'ideaProposal', 'loadIdeaTurns', 'loadIdeas'].includes(a)), []);
      assert.ok(azioni.filter(b => b.supabaseAction === 'ideaProposal').every(b => Object.keys(b).every(k => ['supabaseAction', 'ideaId', 'rigenera'].includes(k))), 'il browser non sceglie modello ne\' istruzioni');
      assert.ok(!azioni.some(b => b.supabaseAction === 'save' || b.supabaseAction === 'linkIdeaToRecipe'), 'nessun salvataggio nelle Schede (blocco 2e)');
      assert.deepStrictEqual(P.errori, []);
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
