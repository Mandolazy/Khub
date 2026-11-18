/*
 * Test — P2-a.2, blocco 2c: conversazione con MichelinAI nel dettaglio dell'Idea.
 *
 * Pagina reale (khub_mvp.html) in Chromium + server reale (api/chat.js) con
 * Anthropic SIMULATO nel server di test (KHUB_TEST_IA_SIMULATA=1) + PostgREST e
 * PostgreSQL locali con tutte le migrazioni (0014 compresa) e i privilegi come
 * su Supabase oggi. Nessuna chiamata AI reale, nessuna rete esterna.
 *
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
if (!CONN || !BIN) { console.log('P2-a.2 — chat Idee UI: KHUB_PG_TEST o KHUB_POSTGREST_BIN non impostati, test non eseguito (skip)\n\n0 passed, 0 failed, 1 skipped'); process.exit(0); }
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { console.log('Playwright non disponibile'); process.exit(1); }

const ROOT = path.join(__dirname, '..');
const DB = 'khub_p2a2c_' + process.pid;
const parti = Object.fromEntries(CONN.trim().split(/\s+/).map(x => x.split('=')));
const psql = (q, db = DB, file) => spawnSync('psql', [CONN + ' dbname=' + db, '-v', 'ON_ERROR_STOP=1', '-qtA'].concat(file ? ['-f', file] : ['-c', q]), { encoding: 'utf8' });
const sql = (q, db) => { const r = psql(q, db); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
const righe = q => JSON.parse(sql('select coalesce(json_agg(t),\'[]\') from (' + q + ') t'));
const portaLibera = () => new Promise(ok => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const attendi = async (cond, ms, cosa) => { const t0 = Date.now(); while (!(await cond())) { if (Date.now() - t0 > ms) throw new Error('timeout: ' + cosa); await new Promise(r => setTimeout(r, 100)); } };
const sha = t => crypto.createHash('sha256').update(t, 'utf8').digest('hex');
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok - ' + name); } catch (e) { failed++; console.log('  FAIL - ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 8).join('\n    ')); } }
const FOTO = process.env.KHUB_SCREENSHOT_DIR || null;

const VOCE_FINTA = () => {
  window.SpeechRecognition = function () {
    const self = this;
    self.start = function () { setTimeout(function () { const r = [{ transcript: 'metterei le noci al posto delle mandorle' }]; r.isFinal = true; if (self.onresult) self.onresult({ resultIndex: 0, results: [r] }); if (self.onend) self.onend(); }, 60); };
    self.stop = function () {};
  };
  window.webkitSpeechRecognition = window.SpeechRecognition;
};
const SENZA_VOCE = () => { window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined; };

const figli = []; let tmp;
(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'khub-p2a2c-'));
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
    const pgrst = spawn(BIN, [path.join(tmp, 'pgrst.conf')], { stdio: ['ignore', 'pipe', 'pipe'] }); figli.push(pgrst);
    let logRest = ''; pgrst.stdout.on('data', d => { logRest += d; }); pgrst.stderr.on('data', d => { logRest += d; });
    const REST = 'http://127.0.0.1:' + portaRest;
    await attendi(async () => { try { return (await fetch(REST + '/')).ok; } catch (e) { return false; } }, 15000, 'PostgREST ' + logRest);
    const portaApp = await portaLibera();
    const app = spawn(process.execPath, [path.join(ROOT, 'scripts/_p0c-postgrest-server.js'), String(portaApp), REST], { env: { PATH: process.env.PATH, HOME: process.env.HOME, KHUB_TEST_IA_SIMULATA: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    figli.push(app); let logApp = ''; app.stdout.on('data', d => { logApp += d; }); app.stderr.on('data', d => { logApp += d; });
    await attendi(() => /pronto/.test(logApp), 15000, 'server di test ' + logApp);
    const ORIGINE = 'http://localhost:' + portaApp;
    const ia = async impost => (await fetch(ORIGINE + '/test/ia', impost ? { method: 'POST', body: JSON.stringify(impost) } : {})).json();
    console.log('P2-a.2 blocco 2c — chat UI su ' + ((logRest.match(/PostgREST \d+\.\d+\.\d+/) || ['PostgREST'])[0]) + ' + PostgreSQL ' + sql('show server_version').split(' ')[0] + ' (migrazioni ' + migrazioni.map(f => f.slice(0, 4)).join(', ') + ')');

    const browser = await chromium.launch();
    const corpiChat = []; const azioni = [];
    const nuovaPagina = async (opz = {}) => {
      const context = await browser.newContext(opz.viewport ? { viewport: opz.viewport } : {});
      await context.route('**/*', async route => {
        const u = new URL(route.request().url());
        if (u.origin !== ORIGINE) return route.abort();
        if (/^\/lib\/[a-z]+\.js$/.test(u.pathname)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(ROOT, u.pathname)) });
        if (u.pathname === '/api/chat') {
          let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) { /* vuoto */ }
          if (body.supabaseAction) azioni.push(body.supabaseAction);
          if (body.supabaseAction === 'ideaChat') corpiChat.push(body);
          if (opz.intercetta) { const fatto = await opz.intercetta(route, body); if (fatto) return; }
        }
        return route.continue();
      });
      await context.addInitScript(() => { try { localStorage.setItem('khub_onboarded', '1'); } catch (e) { /* no */ } });
      if (opz.voce === 'finta') await context.addInitScript(VOCE_FINTA);
      if (opz.voce === 'assente') await context.addInitScript(SENZA_VOCE);
      const page = await context.newPage();
      const errori = [];
      page.on('pageerror', e => errori.push(String(e && e.message || e)));
      page.on('dialog', d => { errori.push('dialogo: ' + d.message()); d.dismiss(); });
      const avvia = async () => { await page.goto(ORIGINE + '/khub_mvp.html'); await page.waitForFunction(() => typeof S !== 'undefined' && S.recipes.length > 0, null, { timeout: 15000 }); };
      await avvia();
      const ev = (f, a) => page.evaluate(f, a);
      const api = body => ev(async b => (await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json(), body);
      const apri = async id => { await ev(() => caricaIdee()); await page.waitForFunction(i => S.idee && S.idee.stato === 'pronto' && S.idee.elenco.some(x => x.id === i), id); await ev(i => apriIdea(i), id); await page.waitForSelector('#idea-conversazione'); await page.waitForFunction(i => S.ideaChat && S.ideaChat[i] && S.ideaChat[i].stato === 'pronto', id); };
      return { page, context, ev, api, avvia, errori, apri };
    };
    const crea = async (P, titolo) => { const r = await P.api({ supabaseAction: 'createIdea', idea: { title: titolo, sourceType: 'appunto', sourceText: 'Spunto: ' + titolo } }); assert.strictEqual(r.ok, true, JSON.stringify(r)); return r.idea.id; };
    const bolle = P => P.page.$$eval('#idea-chat-elenco .idee-msg', l => l.map(e => [e.classList.contains('idee-msg-chef') ? 'chef' : e.classList.contains('idee-msg-errore') ? 'errore' : e.classList.contains('idee-msg-attesa') ? 'attesa' : 'ai', (e.querySelector('.idee-msg-testo') || {}).textContent]));
    const turniDb = id => righe("select id,status,attempts,question,question_origin,error_code from idea_turns where idea_id='" + id + "' order by created_at,id");
    const scrivi = async (P, testo) => { await P.page.fill('#idea-chat-testo', testo); };
    const invia = async (P, testo) => { await scrivi(P, testo); await P.page.click('#idea-chat-invia'); };
    const attendiRisposte = (P, n) => P.page.waitForFunction(n => document.querySelectorAll('#idea-chat-elenco .idee-msg-ai:not(.idee-msg-attesa)').length === n && !S.ideaChat[S.ideaAperta].invio, n, { timeout: 15000 });

    const P = await nuovaPagina({ voce: 'finta' });
    const ideaA = await crea(P, 'Albicocche e rosmarino');

    await test('K1. apertura: conversazione vuota con invito a scrivere liberamente, campo e microfono; nessuna domanda guidata; «Invia» disattivato senza testo', async () => {
      await P.apri(ideaA);
      assert.match(await P.page.textContent('#idea-chat-vuota'), /Puoi scrivere o dettare liberamente/);
      assert.ok(await P.page.$('#idea-chat-testo') && await P.page.$('#idea-mic-chat'));
      assert.strictEqual(await P.page.isDisabled('#idea-chat-invia'), true);
      assert.strictEqual(await P.page.$$eval('#idea-conversazione button', l => l.filter(b => !/Invia|Detta/.test(b.textContent)).length), 0, 'nessun pulsante di scelta guidata');
      assert.ok(!(await P.page.textContent('#idea-conversazione')).includes('Previsto'), 'niente piu\' segnaposto');
    });

    await test('K2. invio: durante l\'elaborazione «Invia» disattivato con l\'indicatore e il messaggio gia\' visibile; poi la risposta; un turno nel database; campo e bozza svuotati', async () => {
      await ia({ ritardo: 700, modo: 'ok', testo: null });
      await invia(P, 'Vorrei creare un dessert con albicocche e rosmarino');
      await P.page.waitForSelector('.idee-msg-attesa');
      assert.strictEqual(await P.page.isDisabled('#idea-chat-invia'), true);
      assert.match(await P.page.textContent('#idea-chat-invia'), /sta rispondendo/);
      assert.strictEqual(await P.page.inputValue('#idea-chat-testo'), '', 'il messaggio passa dal campo alla conversazione, senza doppioni a schermo');
      assert.strictEqual(JSON.parse(await P.ev(i => localStorage.getItem('khub_idea_chat_' + i), ideaA)).turnTesto, 'Vorrei creare un dessert con albicocche e rosmarino', 'testo e turnId conservati nel browser finche\' l\'esito non e\' certo');
      assert.deepStrictEqual((await bolle(P)).map(b => b[0]), ['chef', 'attesa']);
      await attendiRisposte(P, 1);
      const b = await bolle(P);
      assert.deepStrictEqual(b.map(x => x[0]), ['chef', 'ai']);
      assert.strictEqual(b[0][1], 'Vorrei creare un dessert con albicocche e rosmarino');
      assert.match(b[1][1], /muffin, una crostata morbida o un dolce al cucchiaio/);
      assert.deepStrictEqual(turniDb(ideaA).map(t => [t.status, t.attempts]), [['completato', 1]]);
      assert.strictEqual(await P.page.inputValue('#idea-chat-testo'), '');
      assert.strictEqual(await P.ev(i => localStorage.getItem('khub_idea_chat_' + i), ideaA), null, 'bozza locale svuotata');
      assert.deepStrictEqual(await P.page.$$eval('#idea-chat-elenco .idee-msg-chi', l => l.map(e => e.textContent)), ['Tu', 'MichelinAI'], 'chef e MichelinAI distinguibili anche a parole');
      await ia({ ritardo: 0 });
    });

    await test('K3. scenario completo: muffin rifiutati, semifreddo, noci al posto delle mandorle, ingredienti indicativi; il server invia all\'AI la cronologia con le scelte dello chef', async () => {
      await invia(P, 'Non voglio muffin. Preferisco un dolce al cucchiaio.'); await attendiRisposte(P, 2);
      await invia(P, 'Mi piace. Metterei le noci al posto delle mandorle.'); await attendiRisposte(P, 3);
      await invia(P, 'Quali ingredienti e quantità mi suggerisci?'); await attendiRisposte(P, 4);
      const b = await bolle(P);
      assert.deepStrictEqual(b.map(x => x[0]), ['chef', 'ai', 'chef', 'ai', 'chef', 'ai', 'chef', 'ai']);
      assert.match(b[7][1], /indicativa/);
      const ultima = (await ia()).chiamate.slice(-1)[0];
      assert.deepStrictEqual(ultima.messages.map(m => m.role), ['user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user']);
      const tutto = JSON.stringify(ultima.messages);
      assert.ok(tutto.includes('Non voglio muffin') && tutto.includes('noci al posto delle mandorle') && tutto.includes('IDEA: Albicocche e rosmarino'));
      assert.ok(/Non attribuire mai allo chef quantita'/.test(ultima.system) && /non va riproposto/.test(ultima.system), 'istruzione di Ideazione del server');
      assert.strictEqual(turniDb(ideaA).length, 4);
    });

    await test('K4. doppi invii: clic ripetuti e Ctrl+Invio insieme producono una sola richiesta, una sola chiamata AI, un solo turno', async () => {
      const idea = await crea(P, 'Doppi clic'); await P.apri(idea);
      await ia({ ritardo: 500 });
      const n0 = (await ia()).chiamate.length, c0 = corpiChat.length;
      await scrivi(P, 'Messaggio unico');
      await P.page.evaluate(() => { ideaChatInvia(); ideaChatInvia(); document.getElementById('idea-chat-invia').click(); });
      await P.page.keyboard.press('Control+Enter');
      await attendiRisposte(P, 1);
      await ia({ ritardo: 0 });
      assert.strictEqual(corpiChat.length - c0, 1, 'una sola richiesta ideaChat');
      assert.strictEqual((await ia()).chiamate.length - n0, 1);
      assert.strictEqual(turniDb(idea).length, 1);
      assert.deepStrictEqual(Object.keys(corpiChat[corpiChat.length - 1]).sort(), ['ideaId', 'message', 'origin', 'supabaseAction', 'turnId'], 'il browser non manda modello, istruzioni o cronologia');
      assert.match(corpiChat[corpiChat.length - 1].turnId, /^it_[0-9a-f]{24}$/);
    });

    await test('K5. secondo messaggio mentre MichelinAI risponde (altra scheda): «Idea occupata», testo conservato nel campo, nessun turno in piu\'', async () => {
      const idea = await crea(P, 'Due schede'); await P.apri(idea);
      const Q = await nuovaPagina(); await Q.apri(idea);
      await ia({ ritardo: 1500 });
      await invia(P, 'Primo dalla scheda 1');
      await P.page.waitForSelector('.idee-msg-attesa');
      await invia(Q, 'Secondo dalla scheda 2');
      await Q.page.waitForSelector('#idea-chat-avviso');
      assert.match(await Q.page.textContent('#idea-chat-avviso'), /sta ancora rispondendo a un altro messaggio/);
      assert.strictEqual(await Q.page.inputValue('#idea-chat-testo'), 'Secondo dalla scheda 2');
      await attendiRisposte(P, 1); await ia({ ritardo: 0 });
      assert.deepStrictEqual(turniDb(idea).map(t => t.question), ['Primo dalla scheda 1']);
      await Q.context.close();
    });

    await test('K6. ricaricamento: conversazione riletta dal database nello stesso ordine; testo non inviato ripristinato dal browser', async () => {
      await P.apri(ideaA);
      await scrivi(P, 'Bozza ancora da inviare');
      await P.avvia(); await P.apri(ideaA);
      assert.deepStrictEqual((await bolle(P)).map(x => x[0]), ['chef', 'ai', 'chef', 'ai', 'chef', 'ai', 'chef', 'ai']);
      assert.strictEqual(await P.page.inputValue('#idea-chat-testo'), 'Bozza ancora da inviare');
      await scrivi(P, '');
    });

    await test('K7. esito perso (la richiesta arriva al server ma la risposta non torna al browser): messaggio conservato con lo stesso turnId; il nuovo invio non chiama di nuovo l\'AI e non duplica; dopo ricarica il campo si svuota', async () => {
      const idea = await crea(P, 'Esito perso');
      let perdi = true;
      const R = await nuovaPagina({ intercetta: async (route, body) => { if (body.supabaseAction === 'ideaChat' && perdi) { perdi = false; await route.fetch(); await route.abort('connectionreset'); return true; } return false; } });
      await R.apri(idea);
      const n0 = (await ia()).chiamate.length;
      await invia(R, 'Messaggio con esito perso');
      await R.page.waitForSelector('#idea-chat-avviso');
      assert.match(await R.page.textContent('#idea-chat-avviso'), /Connessione non riuscita|Esito non chiaro/);
      const b = await R.ev(i => JSON.parse(localStorage.getItem('khub_idea_chat_' + i)), idea);
      assert.strictEqual(turniDb(idea).length, 1, 'il turno e\' arrivato al server');
      // La ricarica della conversazione dopo l'errore l'ha gia' trovato: campo svuotato, turno mostrato una volta.
      await R.page.waitForFunction(() => document.querySelectorAll('#idea-chat-elenco .idee-msg-chef').length === 1);
      assert.ok(b === null || b.turnId === turniDb(idea)[0].id, 'stesso turnId conservato finche\' l\'esito non e\' certo');
      // Caso senza ricarica riuscita: si rimette lo stesso testo con lo stesso turnId e si reinvia.
      await R.ev((a) => { ideaChatScriviBozza(a.i, { testo: 'Messaggio con esito perso', origine: 'testo', turnId: a.t, turnTesto: 'Messaggio con esito perso' }); render(); }, { i: idea, t: turniDb(idea)[0].id });
      await R.page.click('#idea-chat-invia'); await attendiRisposte(R, 1);
      assert.strictEqual((await ia()).chiamate.length - n0, 1, 'una sola chiamata AI in tutto');
      assert.strictEqual(turniDb(idea).length, 1);
      assert.deepStrictEqual((await bolle(R)).map(x => x[0]), ['chef', 'ai'], 'nessun turno mostrato due volte');
      await R.avvia(); await R.apri(idea);
      assert.strictEqual(await R.page.inputValue('#idea-chat-testo'), '');
      await R.context.close();
    });

    await test('K8. ricarica durante l\'elaborazione: dopo la riapertura il messaggio appare «in elaborazione» e la risposta arriva da sola (controllo periodico), senza doppioni', async () => {
      const idea = await crea(P, 'Ricarica in corso');
      await P.apri(idea);
      await ia({ ritardo: 3500 });
      await invia(P, 'Rispondi con calma');
      await P.page.waitForSelector('.idee-msg-attesa');
      await P.page.waitForTimeout(300);
      await P.avvia(); await P.apri(idea);
      await P.page.waitForSelector('.idee-msg-attesa');
      assert.deepStrictEqual((await bolle(P)).map(x => x[0]), ['chef', 'attesa']);
      await attendiRisposte(P, 1);
      await ia({ ritardo: 0 });
      assert.deepStrictEqual((await bolle(P)).map(x => x[0]), ['chef', 'ai']);
      assert.strictEqual(turniDb(idea).length, 1);
    });

    await test('K9. elaborazione interrotta (prenotazione scaduta): messaggio comprensibile e «Riprova»; il nuovo tentativo usa lo stesso turno', async () => {
      const idea = await crea(P, 'Interrotta');
      sql(`insert into idea_turns (id,idea_id,question,question_origin,question_hash,status,attempts,lease_until,created_at,updated_at) values ('it_interrotto0001','${idea}','Messaggio interrotto','testo','${sha('Messaggio interrotto')}','in_corso',1,now()-interval '1 minute',now()-interval '5 minutes',now()-interval '5 minutes')`);
      await P.apri(idea);
      const b = await bolle(P);
      assert.deepStrictEqual(b.map(x => x[0]), ['chef', 'errore']);
      assert.match(b[1][1], /si è interrotta/);
      await P.page.click('.idee-msg-riprova'); await attendiRisposte(P, 1);
      assert.deepStrictEqual(turniDb(idea).map(t => [t.id, t.status, t.attempts]), [['it_interrotto0001', 'completato', 2]]);
    });

    await test('K10. errore dell\'AI: messaggio salvato con l\'errore e «Riprova» (stesso turno, nessun doppione); dopo 3 tentativi «Riscrivi il messaggio» lo rimette nel campo', async () => {
      const idea = await crea(P, 'Errori'); await P.apri(idea);
      await ia({ modo: 'errore' });
      await invia(P, 'Prima prova');
      await P.page.waitForSelector('.idee-msg-errore');
      assert.match((await bolle(P))[1][1], /non era disponibile/);
      assert.strictEqual(await P.page.inputValue('#idea-chat-testo'), '', 'il messaggio e\' nella conversazione, non duplicato nel campo');
      await ia({ modo: 'ok' });
      await P.page.click('.idee-msg-riprova'); await attendiRisposte(P, 1);
      assert.deepStrictEqual(turniDb(idea).map(t => [t.status, t.attempts]), [['completato', 2]]);
      await ia({ modo: 'errore' });
      await invia(P, 'Sempre errore'); await P.page.waitForSelector('.idee-msg-riprova');
      for (let i = 0; i < 2; i++) { await P.page.click('.idee-msg-riprova'); await P.page.waitForFunction(() => !S.ideaChat[S.ideaAperta].invio); }
      await P.page.waitForSelector('text=Riscrivi il messaggio');
      assert.strictEqual(await P.page.$$eval('.idee-msg-riprova', l => l.length), 0);
      await ia({ modo: 'ok' });
      await P.page.click('text=Riscrivi il messaggio');
      assert.strictEqual(await P.page.inputValue('#idea-chat-testo'), 'Sempre errore');
      await P.page.click('#idea-chat-invia'); await attendiRisposte(P, 2);
      assert.deepStrictEqual(turniDb(idea).map(t => [t.question, t.status]), [['Prima prova', 'completato'], ['Sempre errore', 'fallito'], ['Sempre errore', 'completato']]);
    });

    await test('K11. Idea archiviata o trasformata: cronologia visibile in sola lettura, nessun campo ne\' «Invia» ne\' «Riprova»', async () => {
      assert.strictEqual((await P.api({ supabaseAction: 'archiveIdea', id: ideaA })).ok, true);
      await P.ev(() => caricaIdee()); await P.page.waitForTimeout(200);
      await P.apri(ideaA);
      assert.strictEqual((await bolle(P)).length, 8);
      assert.strictEqual(await P.page.$$eval('#idea-chat-testo,#idea-chat-invia,.idee-msg-riprova,#idea-mic-chat', l => l.length), 0);
      assert.match(await P.page.textContent('#idea-chat-sola-lettura'), /archiviata/);
      const t = await crea(P, 'Trasformata'); sql("update ideas set status='trasformata', linked_recipe_id='rA' where id='" + t + "'");
      await P.ev(() => caricaIdee()); await P.page.waitForTimeout(200); await P.apri(t);
      assert.match(await P.page.textContent('#idea-chat-sola-lettura'), /diventata una Ricetta/);
      assert.strictEqual(await P.page.$$eval('#idea-chat-testo', l => l.length), 0);
    });

    await test('K12. dettatura: testo aggiunto al campo e modificabile, nessun invio automatico, origine «voce» salvata; senza riconoscimento vocale nessun microfono e indicazione testuale', async () => {
      const idea = await crea(P, 'Dettatura'); await P.apri(idea);
      await scrivi(P, 'Mi piace.');
      const c0 = corpiChat.length;
      await P.page.click('#idea-mic-chat');
      await P.page.waitForFunction(() => document.querySelector('#idea-chat-testo').value === 'Mi piace. metterei le noci al posto delle mandorle');
      assert.strictEqual(corpiChat.length, c0, 'nessun invio automatico');
      await P.page.fill('#idea-chat-testo', 'Mi piace. Metterei le noci al posto delle mandorle.'); // correzione prima dell'invio
      await P.page.click('#idea-chat-invia'); await attendiRisposte(P, 1);
      assert.deepStrictEqual(turniDb(idea).map(t => [t.question, t.question_origin]), [['Mi piace. Metterei le noci al posto delle mandorle.', 'voce']]);
      assert.match(await P.page.textContent('#idea-chat-elenco .idee-msg-chef .idee-msg-chi'), /dettato/);
      const N = await nuovaPagina({ voce: 'assente' });
      try {
        await N.apri(idea);
        assert.strictEqual(await N.page.$$eval('#idea-mic-chat', l => l.length), 0);
        assert.match(await N.page.textContent('#idea-conversazione'), /Dettatura non disponibile in questo browser: puoi scrivere/);
      } finally { await N.context.close(); }
    });

    await test('K13. sicurezza: HTML e script nei messaggi dello chef e nelle risposte mostrati come testo; nessun elemento iniettato, nessuno script eseguito', async () => {
      const idea = await crea(P, 'Sicurezza'); await P.apri(idea);
      await ia({ testo: '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script><b>grassetto</b> fine' });
      await invia(P, '<svg onload="window.__xss=3"></svg><i>corsivo</i>'); await attendiRisposte(P, 1);
      await ia({ testo: null });
      const b = await bolle(P);
      assert.strictEqual(b[0][1], '<svg onload="window.__xss=3"></svg><i>corsivo</i>');
      assert.strictEqual(b[1][1], '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script><b>grassetto</b> fine');
      assert.strictEqual(await P.page.$$eval('#idea-conversazione img,#idea-conversazione script,#idea-conversazione svg,#idea-conversazione b,#idea-conversazione i:not(.ti)', l => l.length), 0);
      await P.page.waitForTimeout(150);
      assert.strictEqual(await P.ev(() => window.__xss), undefined);
    });

    await test('K14. smartphone (390 px): nessuno scorrimento orizzontale, bolle leggibili, campo e «Invia» raggiungibili, la pagina scorre sull\'ultimo scambio', async () => {
      const M = await nuovaPagina({ viewport: { width: 390, height: 844 } });
      try {
        const idea = await crea(M, 'Mobile');
        await M.apri(idea);
        for (const t of ['Vorrei un dessert con albicocche e rosmarino', 'Non voglio muffin. Preferisco un dolce al cucchiaio.', 'Quali ingredienti e quantità mi suggerisci?']) { await invia(M, t); await M.page.waitForFunction(() => !S.ideaChat[S.ideaAperta].invio); }
        await M.page.waitForTimeout(600);
        assert.ok(await M.ev(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'nessuno scorrimento orizzontale');
        const larghezze = await M.page.$$eval('#idea-chat-elenco .idee-msg', l => l.map(e => e.getBoundingClientRect().width));
        assert.ok(larghezze.every(w => w <= 390 * 0.9 + 1), JSON.stringify(larghezze));
        assert.ok(await M.ev(() => { const r = document.getElementById('idea-chat-testo').getBoundingClientRect(); return r.width > 250; }));
        // Dopo gli scambi la pagina (finestra o contenitore principale) e' scesa: «Invia» e' visibile senza scorrere a mano.
        assert.ok(await M.ev(() => { const r = document.getElementById('idea-chat-invia').getBoundingClientRect(); return r.top >= 0 && r.top < window.innerHeight; }), '«Invia» visibile dopo gli scambi');
        assert.ok(await M.ev(() => window.scrollY > 0 || (document.querySelector('.main') || {}).scrollTop > 0), 'la pagina e\' scesa verso l\'ultimo scambio');
        if (FOTO) {
          await M.ev(() => { document.getElementById('idea-chat-elenco').scrollIntoView({ block: 'start' }); window.scrollBy(0, -60); }); await M.page.waitForTimeout(200);
          await M.page.screenshot({ path: path.join(FOTO, 'mobile-chat.png') });
          await M.ev(() => document.getElementById('idea-chat-fondo').scrollIntoView({ block: 'end' })); await M.page.waitForTimeout(200);
          await M.page.screenshot({ path: path.join(FOTO, 'mobile-chat-campo.png') });
        }
        assert.deepStrictEqual(M.errori, []);
      } finally { await M.context.close(); }
    });

    if (FOTO) {
      const D = await nuovaPagina({ viewport: { width: 1280, height: 900 } });
      const idea = await crea(D, 'Albicocche e rosmarino');
      await D.apri(idea);
      for (const t of ['Vorrei creare un dessert con albicocche e rosmarino', 'Non voglio muffin. Preferisco un dolce al cucchiaio.', 'Mi piace. Metterei le noci al posto delle mandorle.', 'Quali ingredienti e quantità mi suggerisci?']) { await invia(D, t); await D.page.waitForFunction(() => !S.ideaChat[S.ideaAperta].invio); }
      await D.page.mouse.move(1270, 890); await D.page.waitForTimeout(400);
      await D.page.screenshot({ path: path.join(FOTO, 'desktop-chat.png'), fullPage: true });
      await ia({ ritardo: 4000 }); await scrivi(D, 'E per la decorazione?'); await D.page.click('#idea-chat-invia'); await D.page.waitForSelector('.idee-msg-attesa'); await D.page.waitForTimeout(300);
      await D.page.screenshot({ path: path.join(FOTO, 'desktop-chat-attesa.png'), fullPage: false });
      await D.page.waitForFunction(() => !S.ideaChat[S.ideaAperta].invio, null, { timeout: 15000 }); await ia({ ritardo: 0 });
      await D.context.close();
    }

    await test('K15. nessuna regressione: Home, LAB, Schede e Produzione si aprono come prima; solo le azioni delle Idee previste; nessuna Ricetta toccata; nessun errore JavaScript', async () => {
      for (const [id, vista] of [['#apphome-lab', 'lab-globale'], ['#apphome-schede', 'home'], ['#apphome-produzione', 'attive'], ['#apphome-idee', 'idee']]) {
        await P.ev(() => { S.view = 'app-home'; render(); }); await P.page.click(id); await P.page.waitForFunction(v => S.view === v, vista);
      }
      const ideeAzioni = [...new Set(azioni.filter(a => /idea/i.test(a)))].sort();
      assert.deepStrictEqual(ideeAzioni.filter(a => !['archiveIdea', 'createIdea', 'ideaChat', 'loadIdeaTurns', 'loadIdeas', 'updateIdeaNotes'].includes(a)), []);
      assert.ok(corpiChat.every(b => Object.keys(b).every(k => ['supabaseAction', 'ideaId', 'turnId', 'message', 'origin'].includes(k))));
      assert.strictEqual(sommaRicette(), sommaIniziale);
      assert.deepStrictEqual(P.errori, []);
      assert.ok(!/chiave-finta-solo-test/.test(logApp), 'nessuna chiave nei log');
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
