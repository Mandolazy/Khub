/*
 * Test — P2-a.2, blocco 2a: interfaccia delle Idee (elenco, nuova Idea, dettaglio).
 *
 * Pagina reale (khub_mvp.html) nel browser Chromium + server reale
 * (api/chat.js) + PostgREST e PostgreSQL locali con TUTTE le migrazioni del
 * repository (0013 compresa) e i privilegi come su Supabase oggi: le tabelle
 * nuove non sono concesse in automatico, il ruolo del server (service_role)
 * riceve da 0013 SELECT, INSERT, UPDATE su ideas.
 * Mai Supabase, nessuna AI (le richieste AI sono intercettate e contate: devono
 * essere zero), nessuna rete esterna.
 *
 * Richiede KHUB_PG_TEST e KHUB_POSTGREST_BIN (come gli altri test PostgREST),
 * altrimenti si dichiara non eseguito (skip) e termina con 0.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, spawnSync } = require('child_process');

const CONN = process.env.KHUB_PG_TEST, BIN = process.env.KHUB_POSTGREST_BIN;
if (!CONN || !BIN) { console.log('P2-a.2 — Idee UI: KHUB_PG_TEST o KHUB_POSTGREST_BIN non impostati, test non eseguito (skip)\n\n0 passed, 0 failed, 1 skipped'); process.exit(0); }
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { console.log('Playwright non disponibile'); process.exit(1); }

const ROOT = path.join(__dirname, '..');
const DB = 'khub_p2a2_' + process.pid;
const parti = Object.fromEntries(CONN.trim().split(/\s+/).map(x => x.split('=')));
const psql = (q, db = DB, file) => spawnSync('psql', [CONN + ' dbname=' + db, '-v', 'ON_ERROR_STOP=1', '-qtA'].concat(file ? ['-f', file] : ['-c', q]), { encoding: 'utf8' });
const sql = (q, db) => { const r = psql(q, db); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
const righe = q => JSON.parse(sql('select coalesce(json_agg(t),\'[]\') from (' + q + ') t'));
const portaLibera = () => new Promise(ok => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const attendi = async (cond, ms, cosa) => { const t0 = Date.now(); while (!(await cond())) { if (Date.now() - t0 > ms) throw new Error('timeout: ' + cosa); await new Promise(r => setTimeout(r, 100)); } };
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok - ' + name); } catch (e) { failed++; console.log('  FAIL - ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 8).join('\n    ')); } }

// Riconoscimento vocale simulato (il browser di test non ne ha uno): una frase finale, poi fine.
const VOCE_FINTA = () => {
  window.SpeechRecognition = function () {
    const self = this;
    self.start = function () { setTimeout(function () {
      const ris = [{ transcript: 'con miele di castagno' }]; ris.isFinal = true;
      if (self.onresult) self.onresult({ resultIndex: 0, results: [ris] });
      if (self.onend) self.onend();
    }, 60); };
    self.stop = function () {};
  };
  window.webkitSpeechRecognition = window.SpeechRecognition;
};
const SENZA_VOCE = () => { try { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; } catch (e) { /* no */ } window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined; };

// Facoltativo: cartella in cui salvare alcune schermate per il controllo visivo.
const FOTO = process.env.KHUB_SCREENSHOT_DIR || null;
const figli = [];
let tmp;
(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'khub-p2a2-'));
  try {
    // ── Database: ruoli come Supabase, nessun privilegio automatico sulle nuove tabelle ──
    sql("do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;" +
      " if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;" +
      " if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if; end $$;", 'postgres');
    sql('drop database if exists ' + DB, 'postgres'); sql('create database ' + DB, 'postgres');
    sql('grant usage on schema public to anon, authenticated, service_role;');
    const applica = f => { const r = psql(null, DB, f); if (r.status !== 0) throw new Error(path.basename(f) + ': ' + r.stderr); };
    applica(path.join(ROOT, 'scripts/db/p0c-schema-base-locale.sql'));
    const migrazioni = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort();
    migrazioni.filter(f => f < '0013').forEach(f => applica(path.join(ROOT, 'supabase/migrations', f)));
    sql('grant all on all tables in schema public to service_role;'); // tabelle preesistenti: privilegi gia' presenti
    migrazioni.filter(f => f >= '0013').forEach(f => applica(path.join(ROOT, 'supabase/migrations', f)));
    sql("insert into recipes (id,name,category,department,notes) values ('rA','Crema pasticcera','Dolci','Pasticceria','');" +
      "insert into variants (id,recipe_id,name,label,note,status,active,portions_count,grams_per_portion,steps) values ('vA','rA','Crema','Bozza 1','','lab',false,4,200,'[\"Scaldare.\"]');" +
      "insert into ingredients (id,variant_id,name,qty,unit,sort_order) values ('ingA1','vA','Latte',500,'ml',0);");
    const sommaRicette = () => sql("select md5((select string_agg(concat_ws('|',id,name,category),'#' order by id) from recipes)||(select string_agg(concat_ws('|',id,recipe_id,name,status,active),'#' order by id) from variants)||(select string_agg(concat_ws('|',id,variant_id,name,qty,unit),'#' order by id) from ingredients))");
    const sommaIniziale = sommaRicette();

    // ── PostgREST (ruolo del server) + server reale dell'app ──
    const portaRest = await portaLibera();
    const uri = 'postgres://' + (parti.user || 'postgres') + '@/' + DB + '?host=' + encodeURIComponent(parti.host || '/tmp') + '&port=' + (parti.port || 5432);
    fs.writeFileSync(path.join(tmp, 'pgrst.conf'), `db-uri = "${uri}"\ndb-schemas = "public"\ndb-anon-role = "service_role"\nserver-host = "127.0.0.1"\nserver-port = ${portaRest}\n`);
    const pgrst = spawn(BIN, [path.join(tmp, 'pgrst.conf')], { stdio: ['ignore', 'pipe', 'pipe'] }); figli.push(pgrst);
    let logRest = ''; pgrst.stdout.on('data', d => { logRest += d; }); pgrst.stderr.on('data', d => { logRest += d; });
    const REST = 'http://127.0.0.1:' + portaRest;
    await attendi(async () => { try { return (await fetch(REST + '/')).ok; } catch (e) { return false; } }, 15000, 'PostgREST ' + logRest);
    const portaApp = await portaLibera();
    const app = spawn(process.execPath, [path.join(ROOT, 'scripts/_p0c-postgrest-server.js'), String(portaApp), REST], { env: { PATH: process.env.PATH, HOME: process.env.HOME }, stdio: ['ignore', 'pipe', 'pipe'] });
    figli.push(app); let logApp = ''; app.stdout.on('data', d => { logApp += d; }); app.stderr.on('data', d => { logApp += d; });
    await attendi(() => /pronto/.test(logApp), 15000, 'server di test ' + logApp);
    const ORIGINE = 'http://localhost:' + portaApp;
    console.log('P2-a.2 — Idee UI su ' + ((logRest.match(/PostgREST \d+\.\d+\.\d+/) || ['PostgREST'])[0]) + ' + PostgreSQL ' + sql('show server_version').split(' ')[0] + ' (migrazioni ' + migrazioni.map(f => f.slice(0, 4)).join(', ') + ')');

    const browser = await chromium.launch();
    const richiesteAI = []; const azioni = [];
    const nuovaPagina = async (opz = {}) => {
      const context = await browser.newContext(opz.viewport ? { viewport: opz.viewport } : {});
      await context.route('**/*', async route => {
        const u = new URL(route.request().url());
        if (u.origin !== ORIGINE) return route.abort(); // nessuna rete esterna (font, CDN, link delle Idee)
        if (/^\/lib\/[a-z]+\.js$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(ROOT, u.pathname)) });
        if (u.pathname === '/api/chat') {
          let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) { /* vuoto */ }
          if (body.messages || body.mode || body.model) { richiesteAI.push(body); return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"AI vietata nel test"}' }); }
          if (body.supabaseAction) azioni.push(body.supabaseAction);
          if (opz.guasto && opz.guasto(body)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'idee_non_disponibili', error: 'Idee non disponibili' }) });
        }
        return route.continue();
      });
      await context.addInitScript(() => { try { localStorage.setItem('khub_onboarded', '1'); } catch (e) { /* no */ } });
      if (opz.voce === 'finta') await context.addInitScript(VOCE_FINTA);
      if (opz.voce === 'assente') await context.addInitScript(SENZA_VOCE);
      const page = await context.newPage();
      const errori = [];
      page.on('pageerror', e => errori.push(String(e && e.message || e)));
      page.on('dialog', d => { errori.push('dialogo inatteso: ' + d.message()); d.dismiss(); });
      const avvia = async () => {
        await page.goto(ORIGINE + '/khub_mvp.html' + (opz.ui ? '?ui=' + opz.ui : ''));
        await page.waitForFunction(() => typeof S !== 'undefined' && S.recipes.length > 0, null, { timeout: 15000 });
      };
      await avvia();
      const ev = (f, a) => page.evaluate(f, a);
      const api = body => ev(async b => { const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return r.json(); }, body);
      const home = async () => { await ev(() => { S.view = 'app-home'; render(); }); await page.waitForSelector('#apphome-idee'); };
      return { page, context, ev, api, avvia, errori, home };
    };
    const ideeDB = () => righe('select id,title,status,source_type,source_url,source_text,notes from ideas order by created_at, id');

    const P = await nuovaPagina({ voce: 'finta' }); // Direzione 3: grafica predefinita, quella della Preview
    const idee = {};

    await test('H1. Home (Direzione 3, grafica predefinita): quattro aree, Idee compresa; Nuova Scheda e Carica Scheda invariate; conteggio delle Idee aperte', async () => {
      assert.strictEqual(await P.ev(() => S.uiD3), true, 'la Preview usa la Direzione 3');
      await P.home();
      const carte = await P.page.$$eval('.d3-home-grid > .d3-home-card', l => l.map(e => e.id));
      assert.deepStrictEqual(carte, ['apphome-idee', 'apphome-lab', 'apphome-schede', 'apphome-produzione']);
      const azioni_ = await P.page.$$eval('.d3-home-azioni button', l => l.map(e => e.textContent.trim()));
      assert.deepStrictEqual(azioni_.slice(0, 2), ['+ Nuova Scheda', 'Carica Scheda']);
      await P.page.waitForFunction(() => /0 Idee aperte/.test(document.querySelector('#apphome-idee').textContent));
    });

    await test('H2. Home classica: riga «Idee» accanto a Produzione, Schede e LAB; Nuova Ricetta e Carica Ricetta invariate; apre l\'elenco', async () => {
      const C = await nuovaPagina({ ui: 'classic' });
      try {
        await C.home();
        const righe_ = await C.page.$$eval('.apphome-row', l => l.map(e => e.textContent.trim()));
        assert.deepStrictEqual(righe_, ['Produzione', 'Schede', 'LAB', 'Idee']);
        assert.deepStrictEqual(await C.page.$$eval('.apphome-action', l => l.map(e => e.textContent.trim())), ['Nuova Ricetta', 'Carica Ricetta']);
        await C.page.click('#apphome-idee');
        await C.page.waitForSelector('#idee-elenco #idee-vuoto');
        assert.strictEqual(await C.ev(() => S.view), 'idee');
        assert.deepStrictEqual(C.errori, []);
      } finally { await C.context.close(); }
      assert.strictEqual(await P.ev(() => S.uiD3), true, 'la scelta della grafica e\' per browser: P resta in Direzione 3');
    });

    await test('N1. Nuova Idea (appunto): Salva bloccato finche\' mancano titolo e spunto; salvata con a capo e caratteri speciali; si apre il dettaglio', async () => {
      await P.home(); await P.page.click('#apphome-idee');
      await P.page.waitForSelector('#idee-vuoto');
      assert.match(await P.page.textContent('#idee-vuoto'), /Nessuna Idea aperta/);
      await P.page.click('#idee-nuova'); await P.page.waitForSelector('#idea-nuova-form');
      assert.strictEqual(await P.page.isDisabled('#idea-salva'), true);
      await P.page.fill('#idea-titolo', 'Albicocche e rosmarino');
      assert.strictEqual(await P.page.isDisabled('#idea-salva'), true, 'manca lo spunto');
      await P.page.fill('#idea-spunto', 'Dessert estivo: albicocche & rosmarino.\nForse con "crumble" <croccante>.');
      assert.strictEqual(await P.page.isDisabled('#idea-salva'), false);
      await P.page.click('#idea-salva');
      await P.page.waitForSelector('#idea-dettaglio');
      const db = ideeDB(); assert.strictEqual(db.length, 1);
      idee.appunto = db[0].id;
      assert.deepStrictEqual([db[0].title, db[0].status, db[0].source_type, db[0].source_url, db[0].source_text, db[0].notes],
        ['Albicocche e rosmarino', 'aperta', 'appunto', null, 'Dessert estivo: albicocche & rosmarino.\nForse con "crumble" <croccante>.', null]);
      assert.strictEqual(await P.page.textContent('#idea-titolo-dettaglio'), 'Albicocche e rosmarino');
      assert.strictEqual(await P.page.textContent('#idea-spunto-testo'), 'Dessert estivo: albicocche & rosmarino.\nForse con "crumble" <croccante>.');
      assert.strictEqual(await P.page.$eval('#idea-spunto-testo', e => getComputedStyle(e).whiteSpace), 'pre-wrap', 'a capo visibili');
    });

    await test('N2. Nuova Idea da link: link non http(s) rifiutato senza richieste; link salvato senza leggere la pagina e senza AI; note facoltative', async () => {
      await P.page.click('#idea-dettaglio .d3-crumb button:nth-of-type(2)'); await P.page.waitForSelector('#idee-elenco');
      await P.page.click('#idee-nuova'); await P.page.click('#idea-tipo-link'); await P.page.waitForSelector('#idea-url');
      assert.match(await P.page.textContent('#idea-nuova-form'), /non legge la pagina e non usa l'AI/);
      await P.page.fill('#idea-titolo', 'Torta di un blog');
      const prima = azioni.length;
      await P.page.fill('#idea-url', 'javascript:alert(1)');
      assert.strictEqual(await P.page.isDisabled('#idea-salva'), true);
      await P.ev(() => salvaNuovaIdea()); // anche forzando il salvataggio
      await P.page.waitForSelector('#idea-nuova-errore');
      assert.match(await P.page.textContent('#idea-nuova-errore'), /http:\/\/ o https:\/\//);
      assert.strictEqual(azioni.slice(prima).filter(a => a === 'createIdea').length, 0, 'nessuna richiesta');
      await P.page.fill('#idea-url', 'https://blog.esempio.test/torta?id=7&x=1');
      await P.page.fill('#idea-nuova-note', 'Base per una crostata.');
      await P.page.click('#idea-salva'); await P.page.waitForSelector('#idea-link');
      const r = ideeDB().find(i => i.source_type === 'link'); idee.link = r.id;
      assert.deepStrictEqual([r.title, r.source_url, r.source_text, r.notes], ['Torta di un blog', 'https://blog.esempio.test/torta?id=7&x=1', null, 'Base per una crostata.']);
      const a = await P.page.$eval('#idea-link', e => ({ href: e.getAttribute('href'), target: e.target, rel: e.rel, testo: e.textContent }));
      assert.deepStrictEqual(a, { href: 'https://blog.esempio.test/torta?id=7&x=1', target: '_blank', rel: 'noopener noreferrer nofollow', testo: 'blog.esempio.test' });
      assert.match(await P.page.textContent('#idea-dettaglio'), /KHUB non ha letto la pagina/);
      assert.strictEqual(await P.page.inputValue('#idea-note'), 'Base per una crostata.');
      assert.ok(!azioni.includes('fetchUrl'), 'nessuna lettura della pagina');
    });

    await test('S1. Sicurezza: titolo, testo, note e link ostili mostrati come testo; nessuno script eseguito, nessun elemento iniettato; link pericoloso del database non cliccabile', async () => {
      const ostile = { title: '<img src=x onerror="window.__xss=1">Titolo', sourceType: 'testo', sourceText: '<script>window.__xss=2</script><b>grassetto</b>', sourceUrl: 'https://esempio.test/?q="><svg onload=window.__xss=3>' };
      const c = await P.api({ supabaseAction: 'createIdea', idea: ostile }); assert.strictEqual(c.ok, true, JSON.stringify(c)); idee.ostile = c.idea.id;
      await P.api({ supabaseAction: 'updateIdeaNotes', id: idee.ostile, notes: '</textarea><img src=x onerror="window.__xss=4">' });
      // Una riga scritta direttamente nel database (fuori dal server) con un link non http.
      sql("insert into ideas (id,title,source_type,source_url) values ('idea_vecchialink01','Link strano','link','https://x.test/ok')");
      sql("alter table ideas drop constraint if exists ideas_source_url_check; update ideas set source_url='javascript:window.__xss=5' where id='idea_vecchialink01'");
      await P.ev(() => apriIdee()); await P.page.waitForSelector('.idee-riga');
      await P.page.waitForFunction(n => document.querySelectorAll('.idee-riga').length === n, 4);
      for (const id of [idee.ostile, 'idea_vecchialink01']) {
        await P.ev(i => apriIdea(i), id); await P.page.waitForSelector('#idea-dettaglio[data-idea-id="' + id + '"]');
        const iniettati = await P.page.$$eval('.idee-env img, .idee-env script, .idee-env svg[onload], .idee-env b', l => l.length);
        assert.strictEqual(iniettati, 0, 'nessun elemento dal testo');
        assert.strictEqual(await P.page.$$eval('.idee-env a', l => l.filter(a => !/^https?:/i.test(a.getAttribute('href') || '')).length), 0, 'solo link http(s)');
      }
      await P.ev(i => apriIdea(i), idee.ostile); await P.page.waitForSelector('#idea-note');
      assert.strictEqual(await P.page.textContent('#idea-titolo-dettaglio'), ostile.title);
      assert.strictEqual(await P.page.textContent('#idea-spunto-testo'), ostile.sourceText);
      assert.strictEqual(await P.page.inputValue('#idea-note'), '</textarea><img src=x onerror="window.__xss=4">');
      assert.strictEqual(await P.page.getAttribute('#idea-link', 'href'), 'https://esempio.test/?q=%22%3E%3Csvg%20onload=window.__xss=3%3E');
      await P.page.waitForTimeout(200);
      assert.strictEqual(await P.ev(() => window.__xss), undefined);
      sql("delete from ideas where id='idea_vecchialink01'");
      sql("alter table ideas add constraint ideas_source_url_check check (source_url is null or (char_length(source_url) <= 2000 and source_url ~* '^https?://[^\\s]+$'))");
      await P.ev(() => caricaIdee());
    });

    await test('D1. Note: Salva attivo solo con modifiche; salvate; dettatura aggiunta al testo (mai salvata da sola); bozza conservata se il salvataggio fallisce', async () => {
      await P.ev(i => apriIdea(i), idee.appunto); await P.page.waitForSelector('#idea-note');
      assert.strictEqual(await P.page.isDisabled('#idea-note-salva'), true);
      await P.page.fill('#idea-note', 'Provare il rosmarino in infusione');
      assert.strictEqual(await P.page.isDisabled('#idea-note-salva'), false);
      const prima = azioni.length;
      await P.page.click('#idea-mic-note');
      await P.page.waitForFunction(() => document.querySelector('#idea-note').value === 'Provare il rosmarino in infusione con miele di castagno');
      assert.strictEqual(azioni.slice(prima).filter(a => a === 'updateIdeaNotes').length, 0, 'la dettatura non salva');
      assert.strictEqual(await P.ev(() => S.recording), false);
      await P.page.click('#idea-note-salva');
      await P.page.waitForFunction(() => document.querySelector('#idea-note-salva') && document.querySelector('#idea-note-salva').disabled && !S.ideaSalvaNote);
      assert.strictEqual(sql("select notes from ideas where id='" + idee.appunto + "'"), 'Provare il rosmarino in infusione con miele di castagno');
      // Guasto del server: il testo resta nel campo.
      const G = await nuovaPagina({ guasto: b => b.supabaseAction === 'updateIdeaNotes' });
      try {
        await G.ev(i => { S.view = 'idea'; S.ideaAperta = i; render(); }, idee.appunto);
        await G.page.waitForSelector('#idea-note');
        await G.page.fill('#idea-note', 'Testo non salvato');
        await G.page.click('#idea-note-salva');
        await G.page.waitForFunction(() => !S.ideaSalvaNote && /Idee non disponibili/.test((S.toast && S.toast.msg) || document.body.textContent));
        assert.strictEqual(await G.page.inputValue('#idea-note'), 'Testo non salvato');
        assert.deepStrictEqual(G.errori, []);
      } finally { await G.context.close(); }
      assert.strictEqual(sql("select notes from ideas where id='" + idee.appunto + "'"), 'Provare il rosmarino in infusione con miele di castagno');
    });

    await test('V1. Dettatura nella Nuova Idea: testo aggiunto allo spunto, nessun salvataggio automatico; senza riconoscimento vocale nessun pulsante e indicazione testuale', async () => {
      await P.ev(() => apriNuovaIdea()); await P.page.waitForSelector('#idea-mic-spunto');
      await P.page.fill('#idea-spunto', 'Gelato');
      const prima = azioni.length;
      await P.page.click('#idea-mic-spunto');
      await P.page.waitForFunction(() => document.querySelector('#idea-spunto') && document.querySelector('#idea-spunto').value === 'Gelato con miele di castagno');
      assert.strictEqual(azioni.slice(prima).filter(a => a === 'createIdea').length, 0);
      await P.page.click('#idea-annulla'); await P.page.waitForSelector('#idee-elenco');
      const N = await nuovaPagina({ voce: 'assente' });
      try {
        await N.ev(() => apriNuovaIdea()); await N.page.waitForSelector('#idea-spunto');
        assert.strictEqual(await N.page.$$eval('.idee-mic', l => l.length), 0);
        assert.match(await N.page.textContent('#idea-nuova-form'), /Dettatura non disponibile in questo browser: puoi scrivere/);
        await N.ev(i => apriIdea(i), idee.appunto); await N.page.waitForSelector('#idea-note');
        assert.strictEqual(await N.page.$$eval('.idee-mic', l => l.length), 0);
        assert.deepStrictEqual(N.errori, []);
      } finally { await N.context.close(); }
    });

    await test('A1. Archiviazione con conferma: esce dalle Aperte, compare tra le Archiviate, dettaglio in sola lettura; conteggi dei filtri', async () => {
      await P.ev(i => apriIdea(i), idee.link); await P.page.waitForSelector('#idea-archivia');
      await P.page.click('#idea-archivia'); await P.page.waitForSelector('#idea-conferma-archivio');
      assert.strictEqual(sql("select status from ideas where id='" + idee.link + "'"), 'aperta', 'nulla senza conferma');
      await P.page.click('#idea-archivia-conferma'); await P.page.waitForSelector('#idea-archiviata-avviso');
      assert.strictEqual(sql("select status from ideas where id='" + idee.link + "'"), 'archiviata');
      assert.strictEqual(await P.page.$$eval('#idea-note,#idea-note-salva,#idea-archivia,.idee-mic', l => l.length), 0, 'sola lettura');
      assert.strictEqual(await P.page.textContent('#idea-note-testo'), 'Base per una crostata.');
      await P.ev(() => apriIdee()); await P.page.waitForSelector('#idee-filtro-aperte');
      const conta = async () => P.page.$$eval('.idee-filtro-n', l => l.map(e => e.textContent));
      await P.page.waitForFunction(() => S.idee.stato === 'pronto');
      assert.deepStrictEqual(await conta(), ['2', '0', '1']);
      assert.ok(!(await P.page.$$eval('.idee-riga', l => l.map(e => e.dataset.ideaId))).includes(idee.link));
      await P.page.click('#idee-filtro-archiviate');
      assert.deepStrictEqual(await P.page.$$eval('.idee-riga', l => l.map(e => e.dataset.ideaId)), [idee.link]);
    });

    await test('T1. Idea trasformata (scritta nel database come fara\' il blocco 2e): filtro Trasformate, nome della Scheda, «Apri la Scheda» apre la Scheda reale', async () => {
      sql("insert into ideas (id,title,source_type,source_text,status,linked_recipe_id,linked_variant_id) values ('idea_trasformata01','Crema al limone','appunto','Crema profumata','trasformata','rA','vA')");
      await P.ev(() => caricaIdee()); await P.page.waitForFunction(() => S.idee.elenco.some(i => i.id === 'idea_trasformata01'));
      await P.ev(() => apriIdee()); await P.page.click('#idee-filtro-trasformate');
      assert.match(await P.page.textContent('.idee-riga'), /→ Crema pasticcera/);
      await P.page.click('.idee-riga'); await P.page.waitForSelector('#idea-dettaglio');
      assert.strictEqual(await P.page.$$eval('#idea-note,#idea-archivia', l => l.length), 0, 'trasformata: sola lettura');
      await P.page.click('text=Apri la Scheda');
      await P.page.waitForFunction(() => S.view === 'ricetta-madre-v2' && S.selectedId === 'rA');
    });

    await test('R1. Persistenza dopo il ricaricamento: Idee, note, stati e filtri riletti dal database', async () => {
      await P.page.reload(); await P.page.waitForFunction(() => typeof S !== 'undefined' && S.recipes.length > 0);
      await P.home(); await P.page.waitForFunction(() => /2 Idee aperte/.test(document.querySelector('#apphome-idee').textContent));
      await P.page.click('#apphome-idee'); await P.page.waitForSelector('.idee-riga');
      assert.deepStrictEqual(await P.page.$$eval('.idee-filtro-n', l => l.map(e => e.textContent)), ['2', '1', '1']);
      await P.page.click('.idee-riga[data-idea-id="' + idee.appunto + '"]'); await P.page.waitForSelector('#idea-note');
      assert.strictEqual(await P.page.inputValue('#idea-note'), 'Provare il rosmarino in infusione con miele di castagno');
    });

    await test('B1. Tasto Indietro del browser: dal dettaglio all\'elenco e alla Home', async () => {
      await P.page.goBack(); await P.page.waitForFunction(() => S.view === 'idee');
      await P.page.goForward(); await P.page.waitForFunction(() => S.view === 'idea' && document.querySelector('#idea-dettaglio'));
      await P.page.goBack(); await P.page.goBack(); await P.page.waitForFunction(() => S.view === 'app-home');
    });

    await test('E1. Server non disponibile: elenco con messaggio e «Riprova» reale; nessun errore nella pagina', async () => {
      let guasto = true;
      const G = await nuovaPagina({ guasto: b => guasto && b.supabaseAction === 'loadIdeas' });
      try {
        await G.ev(() => apriIdee()); await G.page.waitForSelector('#idee-errore');
        assert.match(await G.page.textContent('#idee-errore'), /Idee non disponibili/);
        guasto = false;
        await G.page.click('#idee-errore button'); await G.page.waitForSelector('.idee-riga');
        assert.deepStrictEqual(G.errori, []);
      } finally { await G.context.close(); }
    });

    await test('M1. Mobile (390 px): Home in una colonna con quattro aree, nessuno scorrimento orizzontale; elenco e dettaglio leggibili', async () => {
      const M = await nuovaPagina({ viewport: { width: 390, height: 844 } });
      try {
        await M.home();
        const colonne = await M.page.$eval('.d3-home-grid', e => getComputedStyle(e).gridTemplateColumns.split(' ').length);
        assert.strictEqual(colonne, 1);
        for (const vista of [() => { S.view = 'app-home'; render(); }, () => apriIdee(), () => apriNuovaIdea()]) {
          await M.ev(vista); await M.page.waitForTimeout(150);
          assert.ok(await M.ev(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'nessuno scorrimento orizzontale');
        }
        await M.ev(i => apriIdea(i), idee.appunto); await M.page.waitForSelector('#idea-dettaglio');
        assert.ok(await M.ev(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
        if (FOTO) await M.page.screenshot({ path: path.join(FOTO, 'mobile-dettaglio.png'), fullPage: true });
        assert.deepStrictEqual(M.errori, []);
      } finally { await M.context.close(); }
    });

    await test('G1. Navigazione principale (Direzione 3): voce «Idee» prima di LAB nella barra laterale e in quella in basso; apre l\'elenco; evidenziata in elenco, creazione e dettaglio; fascia d\'intestazione gialla; grafica classica invariata', async () => {
      const ordine = async (sel, re) => P.page.$$eval(sel, (l, r) => l.map(e => e.id).filter(id => new RegExp(r).test(id)), re);
      await P.home();
      assert.deepStrictEqual(await ordine('#sidebar button', '^sb-'), ['sb-idee', 'sb-lab', 'sb-ricette', 'sb-produzione']);
      assert.strictEqual(await P.page.$$eval('#sidebar .active', l => l.length), 0, 'in Home nessuna voce attiva');
      await P.page.click('#sb-idee'); await P.page.waitForSelector('#idee-elenco');
      for (const vista of [() => apriIdee(), () => apriNuovaIdea(), i => apriIdea(i)]) {
        await P.ev(vista, idee.appunto); await P.page.waitForTimeout(150);
        assert.deepStrictEqual(await P.page.$$eval('#sidebar .active', l => l.map(e => e.id)), ['sb-idee'], 'solo Idee attiva in ' + await P.ev(() => S.view));
        const [fondo, testo] = await P.page.$eval('#sb-idee', e => [getComputedStyle(e).backgroundColor, getComputedStyle(e).color]);
        assert.deepStrictEqual([fondo, testo], ['rgb(233, 185, 73)', 'rgb(35, 27, 20)'], 'voce attiva gialla, testo inchiostro');
        assert.strictEqual(await P.page.$eval('.topbar', e => getComputedStyle(e).backgroundColor), 'rgb(233, 185, 73)', 'fascia dell\'ambiente Idee');
        assert.ok(await P.page.$eval('.d3-amb-testa-voce[data-amb="idee"]', e => e.offsetParent !== null || getComputedStyle(e).display === 'contents'), 'nome e icona Idee nella fascia');
      }
      assert.match(await P.page.$eval('#idea-note-salva', e => e.className), /d3-btn-primary/, '«Salva note» e\' l\'azione primaria del dettaglio');
      // Disattivato leggibile: niente trasparenza, testo a contrasto AA sul fondo del pulsante.
      const dis = await P.page.$eval('#idea-note-salva', e => { const c = getComputedStyle(e); return { d: e.disabled, o: c.opacity, bg: c.backgroundColor, col: c.color }; });
      assert.deepStrictEqual([dis.d, dis.o, dis.bg, dis.col], [true, '1', 'rgb(251, 241, 214)', 'rgb(107, 95, 85)'], 'Salva note disattivato: tinta chiara, testo grigio scuro');
      await P.page.click('#sb-lab'); await P.page.waitForFunction(() => S.view === 'lab-globale');
      assert.deepStrictEqual(await P.page.$$eval('#sidebar .active', l => l.map(e => e.id)), ['sb-lab'], 'le altre voci funzionano come prima');
      const M = await nuovaPagina({ viewport: { width: 390, height: 844 } });
      try {
        await M.ev(() => { S.view = 'lab-globale'; render(); });
        assert.deepStrictEqual(await M.page.$$eval('#bottom-nav button', l => l.map(e => e.id)), ['bnav-idee', 'bnav-lab', 'bnav-ricette', 'bnav-produzione']);
        assert.strictEqual(await M.page.$eval('#bottom-nav', e => getComputedStyle(e).gridTemplateColumns.split(' ').length), 4);
        await M.page.click('#bnav-idee'); await M.page.waitForSelector('#idee-elenco');
        assert.deepStrictEqual(await M.page.$$eval('#bottom-nav .active', l => l.map(e => e.id)), ['bnav-idee']);
        assert.ok(await M.ev(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'nessuno scorrimento orizzontale');
        if (FOTO) await M.page.screenshot({ path: path.join(FOTO, 'mobile-elenco.png') });
        assert.deepStrictEqual(M.errori, []);
      } finally { await M.context.close(); }
      const C = await nuovaPagina({ ui: 'classic' });
      try {
        await C.ev(() => { S.view = 'home'; render(); });
        assert.strictEqual(await C.page.$$eval('#sb-idee,#bnav-idee', l => l.length), 0, 'grafica classica: navigazione invariata');
      } finally { await C.context.close(); }
    });

    await test('C1. Colore delle Idee: giallo miele #E9B949 (banda, pulsante primario, filtro selezionato); testi e icone leggibili (contrasto WCAG); colori di LAB, Schede e Produzione invariati; con la grafica classica i token restano dentro le Idee', async () => {
      // Contrasto WCAG fra due colori rgb(...) calcolati dal browser.
      const contrasto = (a, b) => { const L = c => { const v = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map(x => x / 255).map(x => x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
        const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      const stile = (sel, props, pseudo) => P.page.$eval(sel, (e, a) => { const cs = getComputedStyle(e, a[1] || null); return a[0].map(k => cs.getPropertyValue(k)); }, [props, pseudo]);
      await P.home();
      const token = await P.ev(() => { const cs = getComputedStyle(document.body); return ['--d3-amb-idee', '--d3-amb-idee-testo', '--d3-amb-idee-tinta', '--d3-amb-lab', '--d3-amb-schede', '--d3-amb-produzione', '--d3-terra', '--d3-ink', '--d3-bg', '--d3-card'].map(k => cs.getPropertyValue(k).trim()); });
      assert.deepStrictEqual(token, ['#E9B949', '#7A5A12', '#FBF1D6', '#24533F', '#94661C', '#B4501C', '#B4501C', '#231B14', '#F4EEE2', '#FFFDF9']);
      // Colori pieni (b2ac4af): la carta Idee e' gialla, testi in inchiostro.
      const [cartaFondo] = await stile('#apphome-idee', ['background-color']); assert.strictEqual(cartaFondo, 'rgb(233, 185, 73)', 'carta Idee a colore pieno');
      for (const sel of ['.d3-home-card-titolo', '.d3-home-card-descr', '.d3-home-card-conteggio', '.d3-home-card-freccia']) {
        const [col] = await stile('#apphome-idee ' + sel, ['color']);
        assert.ok(contrasto(col, cartaFondo) >= 4.5, sel + ' leggibile sul giallo: ' + contrasto(col, cartaFondo).toFixed(2));
      }
      const [icona, iconaFondo] = await stile('#apphome-idee .d3-home-card-icona', ['color', 'background-color']);
      assert.ok(contrasto(icona, iconaFondo) >= 3, 'icona: ' + contrasto(icona, iconaFondo).toFixed(2));
      for (const [id, colore] of [['#apphome-lab', 'rgb(36, 83, 63)'], ['#apphome-schede', 'rgb(148, 102, 28)'], ['#apphome-produzione', 'rgb(180, 80, 28)']]) {
        assert.strictEqual((await stile(id, ['background-color']))[0], colore, id + ': colore pieno invariato');
        assert.strictEqual((await stile(id + ' .d3-home-card-titolo', ['color']))[0], 'rgb(255, 255, 255)', id + ': testo bianco invariato');
      }
      // Sezione Idee: pulsante primario giallo con testo inchiostro; filtro selezionato con il segno giallo.
      await P.ev(() => { apriIdee(); setIdeeFiltro('aperte'); }); await P.page.waitForSelector('#idee-nuova'); await P.page.waitForSelector('.idee-riga');
      assert.strictEqual(await P.ev(() => document.body.getAttribute('data-d3-amb')), 'idee');
      const [pb, pc] = await stile('#idee-nuova', ['background-color', 'color']);
      assert.deepStrictEqual([pb, pc], ['rgb(233, 185, 73)', 'rgb(35, 27, 20)']);
      assert.ok(contrasto(pb, pc) >= 7, 'testo sul giallo: ' + contrasto(pb, pc).toFixed(2));
      assert.match((await stile('#idee-filtro-aperte', ['box-shadow']))[0], /rgb\(233, 185, 73\)/);
      const [freccia] = await stile('.idee-riga .idee-riga-freccia', ['color']); const [rigaFondo] = await stile('.idee-lista', ['background-color']);
      assert.ok(contrasto(freccia, rigaFondo) >= 4.5);
      await P.ev(i => apriIdea(i), idee.appunto); await P.page.waitForSelector('.idee-pill-aperta');
      const [pt, pf] = await stile('.idee-pill-aperta', ['color', 'background-color']); assert.ok(contrasto(pt, pf) >= 4.5, 'pillola: ' + contrasto(pt, pf).toFixed(2));
      // Fuori dalle Idee il primario resta quello dell'ambiente (es. LAB verde, testo bianco).
      await P.ev(() => { S.view = 'lab-globale'; render(); });
      assert.strictEqual(await P.ev(() => document.body.getAttribute('data-d3-amb')), 'lab');
      // Grafica classica: nessun token D3 sul body; dentro le Idee i token ci sono.
      const C = await nuovaPagina({ ui: 'classic' });
      try {
        assert.deepStrictEqual(await C.ev(() => ['--d3-amb-idee', '--d3-ink', '--d3-bg'].map(k => getComputedStyle(document.body).getPropertyValue(k).trim())), ['', '', ''], 'classica: token non applicati fuori dalle Idee');
        await C.ev(() => apriIdee()); await C.page.waitForSelector('#idee-nuova');
        assert.strictEqual(await C.ev(() => getComputedStyle(document.querySelector('.idee-env')).getPropertyValue('--d3-amb-idee').trim()), '#E9B949');
        assert.deepStrictEqual(await C.page.$eval('#idee-nuova', e => [getComputedStyle(e).backgroundColor, getComputedStyle(e).color]), ['rgb(233, 185, 73)', 'rgb(35, 27, 20)']);
      } finally { await C.context.close(); }
    });

    if (FOTO) {
      await P.page.setViewportSize({ width: 1280, height: 860 });
      await P.page.mouse.move(1270, 850); // nessun effetto di passaggio del puntatore nelle schermate
      for (const [nome, f] of [['home', () => { S.view = 'app-home'; render(); }], ['elenco', () => { apriIdee(); setIdeeFiltro('aperte'); }], ['nuova', () => apriNuovaIdea()]]) {
        await P.ev(f); await P.page.waitForTimeout(250); await P.page.screenshot({ path: path.join(FOTO, 'desktop-' + nome + '.png'), fullPage: true });
      }
      await P.ev(i => apriIdea(i), idee.appunto); await P.page.waitForSelector('#idea-dettaglio'); await P.page.waitForTimeout(200);
      await P.page.screenshot({ path: path.join(FOTO, 'desktop-dettaglio.png'), fullPage: true });
    }

    await test('X1. Nessuna regressione di navigazione: LAB, Schede e Produzione si aprono dalla Home come prima; nessuna Ricetta toccata', async () => {
      for (const [id, vista] of [['#apphome-lab', 'lab-globale'], ['#apphome-schede', 'home'], ['#apphome-produzione', 'attive']]) {
        await P.home(); await P.page.click(id); await P.page.waitForFunction(v => S.view === v, vista);
      }
      assert.strictEqual(sommaRicette(), sommaIniziale, 'Schede, Ricette e ingredienti invariati');
      assert.strictEqual(sql('select count(*) from recipes'), '1');
    });

    await test('Z1. Contratto: solo azioni gia\' collaudate di P2-a.1 per le Idee, nessuna richiesta AI, nessun errore JavaScript', async () => {
      const ideeAzioni = [...new Set(azioni.filter(a => /idea/i.test(a)))].sort();
      assert.deepStrictEqual(ideeAzioni.filter(a => !['archiveIdea', 'createIdea', 'loadIdeas', 'updateIdeaNotes'].includes(a)), []);
      assert.deepStrictEqual(richiesteAI.length, 0, 'nessuna chiamata AI');
      assert.deepStrictEqual(P.errori, []);
      assert.ok(!/Supabase error \[ideas\]/.test(logApp), 'nessun errore del database: ' + logApp.slice(-300));
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
