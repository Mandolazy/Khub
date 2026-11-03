/*
 * Test — Demo locale della Direzione 3: isolamento da Supabase e dalla rete.
 * Avvia demo/direzione-3/server.js come processo separato con credenziali
 * finte ma "realistiche" nell'ambiente (URL *.supabase.co, chiave sb_secret_,
 * chiave Anthropic, proxy) e con una TRAPPOLA locale che registra qualunque
 * connessione: SUPABASE_URL, HTTPS_PROXY e HTTP_PROXY puntano alla trappola.
 * Verifica che:
 *   - le variabili sensibili vengano ignorate e nessuna connessione esca
 *     (trappola mai contattata, nemmeno con import da URL o MichelinAI);
 *   - lettura e scrittura funzionino solo sul database in memoria (dati
 *     sintetici), con ripristino;
 *   - il server risponda solo su 127.0.0.1 e solo con Host localhost;
 *   - la pagina servita sia khub_mvp.html invariato, piu' la sola fascia
 *     "DEMO LOCALE".
 * Nessuna rete reale, nessun Supabase.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ok - ' + name); passed++; }
  catch (e) { console.log('  FAIL - ' + name); console.log('    ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n    ') : e)); failed++; }
}

function richiesta(porta, metodo, percorso, corpo, headers = {}) {
  return new Promise((ok, ko) => {
    const dati = corpo == null ? null : Buffer.from(typeof corpo === 'string' ? corpo : JSON.stringify(corpo));
    const r = http.request({ host: '127.0.0.1', port: porta, method: metodo, path: percorso,
      headers: Object.assign({ Host: 'localhost:' + porta }, dati ? { 'Content-Type': 'application/json', 'Content-Length': dati.length } : {}, headers) }, res => {
      const parti = []; res.on('data', c => parti.push(c));
      res.on('end', () => { const testo = Buffer.concat(parti).toString('utf8'); let json = null; try { json = JSON.parse(testo); } catch (e) { /* non JSON */ } ok({ status: res.statusCode, headers: res.headers, testo, json }); });
    });
    r.on('error', ko); if (dati) r.write(dati); r.end();
  });
}
const portaLibera = () => new Promise(ok => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });

(async () => {
  // Trappola: qualunque connessione in arrivo viene registrata.
  const contatti = [];
  const trappola = net.createServer(sock => { contatti.push(new Date().toISOString()); sock.destroy(); });
  const portaTrappola = await portaLibera();
  await new Promise(ok => trappola.listen(portaTrappola, '127.0.0.1', ok));
  const porta = await portaLibera();
  const trappolaUrl = 'https://127.0.0.1:' + portaTrappola;
  const env = Object.assign({}, process.env, {
    SUPABASE_URL: trappolaUrl, SUPABASE_SECRET_KEY: 'sb_secret_SEMBRAVERA_produzione_123456',
    SUPABASE_ANON_KEY: 'eyJ_finta_anon', SUPABASE_SERVICE_ROLE_KEY: 'eyJ_finta_service',
    NEXT_PUBLIC_SUPABASE_URL: 'https://progetto-finto.supabase.co', ANTHROPIC_API_KEY: 'sk-ant-finta',
    KHUB_ACCESS_PASSWORD: 'password-finta-di-produzione', KHUB_SESSION_SECRET: 'x'.repeat(40),
    HTTPS_PROXY: 'http://127.0.0.1:' + portaTrappola, HTTP_PROXY: 'http://127.0.0.1:' + portaTrappola, NODE_USE_ENV_PROXY: '1',
  });
  const SERVER = process.env.KHUB_DEMO_SERVER_CONTROPROVA || path.join(ROOT, 'demo/direzione-3/server.js');
  const figlio = spawn(process.execPath, [SERVER, String(porta)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  figlio.stdout.on('data', d => { log += d; }); figlio.stderr.on('data', d => { log += d; });
  const t0 = Date.now();
  while (!/Apri nel browser/.test(log)) { if (Date.now() - t0 > 15000) { console.log(log); throw new Error('demo non avviata'); } await new Promise(r => setTimeout(r, 50)); }
  const api = body => richiesta(porta, 'POST', '/api/chat', body);
  console.log('Demo locale Direzione 3: isolamento');

  await test('I1. credenziali dell\'ambiente ignorate: nessuna variabile Supabase/Anthropic/KHUB del computer viene usata', async () => {
    const iso = (await richiesta(porta, 'GET', '/demo/isolamento')).json;
    for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'ANTHROPIC_API_KEY', 'KHUB_ACCESS_PASSWORD', 'KHUB_SESSION_SECRET'])
      assert.ok(iso.variabiliTolte.includes(k), 'tolta: ' + k);
    assert.strictEqual(iso.indirizzoDatabase, 'https://supabase-demo-locale.invalid');
    assert.ok(!/SEMBRAVERA|sk-ant-finta|password-finta/.test(log), 'nessun valore sensibile stampato');
  });

  await test('I2. lettura: 22 Schede sintetiche dal database in memoria', async () => {
    const r = await api({ supabaseAction: 'load' });
    assert.strictEqual(r.status, 200);
    const rec = r.json.recipes || r.json.data || r.json;
    const elenco = Array.isArray(rec) ? rec : rec.recipes;
    assert.strictEqual(elenco.length, 22);
    assert.ok(elenco.some(x => x.name === 'Tagliatelle ai funghi'));
  });

  await test('I3. scrittura: solo nel database in memoria; "Ripristina dati" torna ai dati iniziali', async () => {
    const r = await api({ supabaseAction: 'updateVariantName', recipeId: 'sTag', variantId: 'tA', name: 'Tagliatelle ai porcini (prova demo)' });
    assert.strictEqual(r.status, 200, r.testo); assert.ok(!r.json || !r.json.error, r.testo);
    const dopo = JSON.stringify((await api({ supabaseAction: 'load' })).json);
    assert.ok(dopo.includes('Tagliatelle ai porcini (prova demo)'));
    assert.ok((await richiesta(porta, 'GET', '/demo/isolamento')).json.scrittureNelFinto >= 1);
    assert.strictEqual((await richiesta(porta, 'POST', '/demo/ripristina')).status, 204);
    const ripristinato = JSON.stringify((await api({ supabaseAction: 'load' })).json);
    assert.ok(!ripristinato.includes('(prova demo)') && ripristinato.includes('Tagliatelle ai porcini'));
  });

  await test('I4. chiamate indirette bloccate: import da URL e MichelinAI non escono dal computer', async () => {
    const u = await api({ fetchUrl: 'https://esempio-ricette.example/ricetta' });
    const m = await api({ model: 'claude-sonnet-5-5', max_tokens: 10, messages: [{ role: 'user', content: 'ciao' }] });
    assert.ok(u.status >= 400 || (u.json && u.json.error) || /disabilitata/.test(u.testo), 'import da URL: ' + u.status + ' ' + u.testo.slice(0, 120));
    assert.ok(m.status >= 400 || (m.json && m.json.error) || /disabilitata/.test(m.testo), 'MichelinAI: ' + m.status + ' ' + m.testo.slice(0, 120));
    const iso = (await richiesta(porta, 'GET', '/demo/isolamento')).json;
    assert.ok(iso.connessioniBloccate.some(x => /esempio-ricette\.example/.test(x.cosa)), 'import bloccato');
    assert.ok(iso.connessioniBloccate.some(x => /api\.anthropic\.com/.test(x.cosa)), 'Anthropic bloccato');
    assert.ok(iso.connessioniBloccate.every(x => !/supabase-demo-locale|127\.0\.0\.1/.test(x.cosa)), 'il database in memoria non passa mai dalla rete');
  });

  await test('I5. solo questo computer: Host diverso da localhost rifiutato; ascolto solo su 127.0.0.1', async () => {
    assert.strictEqual((await richiesta(porta, 'GET', '/', null, { Host: 'khub.esempio.it' })).status, 403);
    assert.ok(/server\.listen\(PORTA, '127\.0\.0\.1'/.test(fs.readFileSync(path.join(ROOT, 'demo/direzione-3/server.js'), 'utf8')));
  });

  await test('I6. pagina: khub_mvp.html invariato piu\' la sola fascia DEMO LOCALE; si apre con la Direzione 3', async () => {
    const home = await richiesta(porta, 'GET', '/');
    assert.deepStrictEqual([home.status, home.headers.location], [302, '/khub_mvp.html?ui=d3']);
    const p = await richiesta(porta, 'GET', '/khub_mvp.html');
    const originale = fs.readFileSync(path.join(ROOT, 'khub_mvp.html'), 'utf8');
    assert.ok(p.testo.includes('DEMO LOCALE · dati sintetici<span class="demo-locale-lungo"> · nessun collegamento a Supabase'));
    const senzaFascia = p.testo.replace('<title>[DEMO LOCALE] ', '<title>').replace(/\n<div id="demo-locale"[\s\S]*?<\/script>\n/, '');
    assert.strictEqual(senzaFascia, originale, 'nessun\'altra differenza');
    assert.ok(!/supabase\.co/.test(originale), 'la pagina non contiene indirizzi Supabase');
  });

  await test('I7. TRAPPOLA: nessuna connessione verso l\'indirizzo Supabase o i proxy indicati dall\'ambiente', async () => {
    await new Promise(r => setTimeout(r, 200));
    assert.deepStrictEqual(contatti, []);
  });

  await test('I8. la demo non e\' pubblicabile: esclusa dal deployment (.vercelignore a elenco di ammessi) e dai percorsi del middleware', async () => {
    const ignore = fs.readFileSync(path.join(ROOT, '.vercelignore'), 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    assert.strictEqual(ignore[0], '/*', 'tutto escluso, poi solo gli ammessi');
    assert.ok(!ignore.some(l => /^!.*(demo|scripts)/.test(l)), 'demo/ e scripts/ mai riammessi');
    const mw = fs.readFileSync(path.join(ROOT, 'middleware.js'), 'utf8');
    const ammessi = mw.slice(mw.indexOf('ALLOWED_PATHS'), mw.indexOf(']', mw.indexOf('ALLOWED_PATHS')));
    assert.ok(!/demo/.test(ammessi) && !/demo/.test(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')), 'nessun percorso /demo in produzione');
    assert.ok(!/demo-locale|\/demo\/(ripristina|isolamento)|DEMO LOCALE/.test(fs.readFileSync(path.join(ROOT, 'khub_mvp.html'), 'utf8')), 'la pagina pubblicata non contiene la fascia o i comandi della demo');
  });

  figlio.kill(); trappola.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.log('ERRORE', e && e.stack); process.exit(1); });

