/*
 * Test — P0-a: lettura sicura di una pagina web per l'importazione da link
 * (api/chat.js, acquisisciPagina + ramo fetchUrl dell'handler).
 *
 * Offline: server HTTP locale su 127.0.0.1 e resolver DNS simulato. Per
 * raggiungere il server locale i test "positivi" sostituiscono SOLO la regola
 * degli indirizzi ammessi (consentito) con "solo 127.0.0.1"; la regola reale
 * (paginaIndirizzoPubblico) e' verificata a parte e respinge 127.0.0.1.
 * Nessuna rete esterna, nessuna AI, nessun database.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const { withTestSession } = require('./_khub-test-session.js');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ok - ' + name); }
  catch (e) { failed++; console.log('  FAIL - ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 5).join('\n    ')); }
}

(async () => {
  const mod = await import('data:text/javascript;base64,' + Buffer.from(fs.readFileSync(path.join(ROOT, 'api/chat.js'), 'utf8')).toString('base64'));
  const { acquisisciPagina, paginaIndirizzoPubblico } = mod;
  const handler = await withTestSession(mod.default);

  // ── Server locale ──────────────────────────────────────
  const visite = [];
  const PAGINA = '<!doctype html><html><head><title>Crema</title></head><body><h1>Crema pasticcera — àèìòù</h1><p>500 g latte, 6 tuorli.</p></body></html>';
  const srv = http.createServer((q, s) => {
    visite.push({ url: q.url, headers: q.headers });
    const u = new URL(q.url, 'http://x');
    const p = u.pathname;
    if (p === '/ok') { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return s.end(PAGINA); }
    if (p === '/xhtml') { s.writeHead(200, { 'content-type': 'application/xhtml+xml' }); return s.end(PAGINA); }
    if (p === '/senza-tipo') { s.writeHead(200); return s.end('﻿  ' + PAGINA); }
    if (p === '/senza-tipo-binario') { s.writeHead(200); return s.end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 1, 2])); }
    if (p === '/html-binario') { s.writeHead(200, { 'content-type': 'text/html' }); return s.end(Buffer.concat([Buffer.from('<html>'), Buffer.alloc(64, 0)])); }
    if (p === '/gzip') { s.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }); return s.end(zlib.gzipSync(PAGINA)); }
    if (p === '/br') { s.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'br' }); return s.end(zlib.brotliCompressSync(PAGINA)); }
    if (p === '/deflate') { s.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'deflate' }); return s.end(zlib.deflateSync(PAGINA)); }
    if (p === '/bomba') { s.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }); return s.end(zlib.gzipSync(Buffer.from('<html>' + 'a'.repeat(30 * 1024 * 1024)))); }
    if (p === '/codifica-ignota') { s.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'compress' }); return s.end('x'); }
    if (p === '/grande') { s.writeHead(200, { 'content-type': 'text/html' }); return s.end('<html>' + 'x'.repeat(20 * 1024 * 1024)); }
    if (p === '/lenta') { setTimeout(() => { try { s.writeHead(200, { 'content-type': 'text/html' }); s.end(PAGINA); } catch (e) { /* chiusa */ } }, 3000); return; }
    if (p === '/goccia') { s.writeHead(200, { 'content-type': 'text/html' }); s.write('<html>'); const t = setInterval(() => { try { s.write('a'); } catch (e) { clearInterval(t); } }, 100); s.on('close', () => clearInterval(t)); return; }
    if (/^\/stato\/\d{3}$/.test(p)) { const st = Number(p.slice(7)); s.writeHead(st, { 'content-type': 'text/html' }); return s.end('<html><body>Access denied</body></html>'); }
    if (/^\/tipo\//.test(p)) { s.writeHead(200, { 'content-type': decodeURIComponent(p.slice(6)) }); return s.end('%PDF-1.4 dati'); }
    if (p === '/redirect') { s.writeHead(302, { location: u.searchParams.get('a') }); return s.end(); }
    if (/^\/catena\/\d+$/.test(p)) { const n = Number(p.slice(8)); if (n > 0) { s.writeHead(301, { location: '/catena/' + (n - 1) }); return s.end(); } s.writeHead(200, { 'content-type': 'text/html' }); return s.end(PAGINA); }
    s.writeHead(404); s.end();
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const PORTA = srv.address().port;
  // Il server locale e' raggiungibile solo dai test che lo ammettono esplicitamente.
  const soloLocale = ip => ip === '127.0.0.1';
  // Risolutore simulato: nomi di prova -> indirizzi scelti dal test; conta le chiamate.
  const chiamateDns = [];
  const MAPPA = { 'pagina.test': ['127.0.0.1'], 'interno.test': ['10.0.0.7'], 'metadati.test': ['169.254.169.254'], 'misto.test': ['127.0.0.1', '192.168.1.1'],
    'v6locale.test': ['::1'], 'mappato.test': ['::ffff:127.0.0.1'], 'ula.test': ['fd12::1'], 'cgnat.test': ['100.64.3.4'] };
  const risolvi = async host => { chiamateDns.push(host); if (!(host in MAPPA)) { const e = new Error('nx'); e.code = 'ENOTFOUND'; throw e; } return MAPPA[host].map(a => ({ address: a, family: a.includes(':') ? 6 : 4 })); };

  console.log('P0-a — acquisizione pagina (api/chat.js)');

  await test('F1. regola reale degli indirizzi: pubblici ammessi; loopback, privati, metadati, CGNAT, link-local, riservati, multicast, IPv6 locali e mappati respinti', async () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '151.101.1.69', '2a00:1450:4002:80a::200e', '2606:4700::6810:84e5'])
      assert.strictEqual(paginaIndirizzoPubblico(ip), true, 'pubblico ' + ip);
    for (const ip of ['127.0.0.1', '127.255.255.254', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.10', '169.254.169.254', '100.64.0.1', '0.0.0.0',
      '192.0.0.1', '198.18.0.1', '224.0.0.1', '255.255.255.255', '::', '::1', 'fe80::1', 'fd00::1', 'fc00::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1',
      '::ffff:169.254.169.254', '64:ff9b::7f00:1', '2002:7f00:1::', '2001:db8::1', 'non-un-ip', ''])
      assert.strictEqual(paginaIndirizzoPubblico(ip), false, 'vietato ' + ip);
  });

  await test('F2. schemi, credenziali, porte e URL non validi respinti senza alcuna connessione', async () => {
    const n0 = visite.length; chiamateDns.length = 0;
    const casi = [['file:///etc/passwd', 'url_non_valido'], ['ftp://pagina.test/x', 'url_non_valido'], ['javascript:alert(1)', 'url_non_valido'], ['data:text/html,<b>x</b>', 'url_non_valido'],
      ['gopher://pagina.test/', 'url_non_valido'], ['http://utente:pw@pagina.test/', 'url_non_valido'], ['http://pagina.test:8080/', 'host_non_consentito'], ['http://pagina.test:22/', 'host_non_consentito'],
      ['non è un url', 'url_non_valido'], ['', 'url_non_valido'], ['   ', 'url_non_valido'], ['http://' + 'a'.repeat(2100) + '.test/', 'url_non_valido'], [null, 'url_non_valido'], [42, 'url_non_valido'], [{ url: 'x' }, 'url_non_valido']];
    for (const [u, code] of casi) assert.deepStrictEqual(await acquisisciPagina(u, { risolvi }), { ok: false, code }, String(u).slice(0, 40));
    assert.strictEqual(visite.length, n0, 'nessuna connessione'); assert.strictEqual(chiamateDns.length, 0, 'nessuna risoluzione DNS');
  });

  await test('F3. IP letterali vietati (anche in forme numeriche alternative) respinti senza connessione', async () => {
    const n0 = visite.length;
    for (const u of ['http://127.0.0.1/', 'http://127.0.0.1:80/', 'https://127.0.0.1/', 'http://2130706433/', 'http://0x7f.1/', 'http://0177.0.0.1/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/',
      'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.1/', 'http://192.168.1.1/', 'http://[fd00::1]/', 'http://0.0.0.0/'])
      assert.strictEqual((await acquisisciPagina(u)).code, 'host_non_consentito', u);
    assert.strictEqual((await acquisisciPagina('http://localhost/', { risolvi: async () => [{ address: '127.0.0.1', family: 4 }] })).code, 'host_non_consentito');
    assert.strictEqual(visite.length, n0, 'nessuna connessione');
  });

  await test('F4. DNS: nomi che risolvono verso reti vietate (anche uno solo tra piu\' indirizzi) respinti; nome inesistente = dns', async () => {
    const n0 = visite.length;
    for (const h of ['interno.test', 'metadati.test', 'misto.test', 'v6locale.test', 'mappato.test', 'ula.test', 'cgnat.test'])
      assert.strictEqual((await acquisisciPagina('http://' + h + '/', { risolvi })).code, 'host_non_consentito', h);
    assert.strictEqual((await acquisisciPagina('http://non-esiste.test/', { risolvi })).code, 'dns');
    assert.strictEqual((await acquisisciPagina('http://vuoto.test/', { risolvi: async () => [] })).code, 'dns');
    assert.strictEqual((await acquisisciPagina('http://errore.test/', { risolvi: async () => { throw new Error('x'); } })).code, 'rete');
    assert.strictEqual(visite.length, n0, 'nessuna connessione');
  });

  // Test positivi: il server locale ascolta su una porta diversa da 80/443 e su
  // 127.0.0.1; solo questi test ammettono quell'indirizzo e quella porta.
  const base = 'http://127.0.0.1:' + PORTA;
  async function leggi(pth, extra) { return acquisisciPagina(base + pth, Object.assign({ consentito: soloLocale, risolvi, porte: [String(PORTA)] }, extra || {})); }

  await test('F5. pagina valida: contenuto identico (UTF-8), stato, URL finale; stesse intestazioni di prima verso il sito', async () => {
    const r = await leggi('/ok');
    assert.deepStrictEqual(r, { ok: true, html: PAGINA, finalUrl: base + '/ok', status: 200, troncato: false });
    const h = visite[visite.length - 1].headers;
    assert.strictEqual(h['user-agent'], 'Mozilla/5.0'); assert.strictEqual(h.accept, 'text/html'); assert.strictEqual(h['accept-language'], 'it-IT,it;q=0.9');
    assert.strictEqual((await leggi('/xhtml')).html, PAGINA);
    assert.strictEqual((await leggi('/senza-tipo')).ok, true, 'tipo assente ma HTML');
  });

  await test('F6. compressione gzip, br, deflate decodificata; codifica sconosciuta respinta', async () => {
    for (const p of ['/gzip', '/br', '/deflate']) assert.strictEqual((await leggi(p)).html, PAGINA, p);
    assert.strictEqual((await leggi('/codifica-ignota')).code, 'non_html');
  });

  await test('F7. MIME non consentiti e contenuti binari respinti (PDF, immagini, JSON, ottetti, NUL in HTML, binario senza tipo)', async () => {
    for (const t of ['application/pdf', 'image/png', 'application/json', 'application/octet-stream', 'text/plain', 'video/mp4'])
      assert.strictEqual((await leggi('/tipo/' + encodeURIComponent(t))).code, 'non_html', t);
    assert.strictEqual((await leggi('/html-binario')).code, 'non_html');
    assert.strictEqual((await leggi('/senza-tipo-binario')).code, 'non_html');
  });

  await test('F8. errori HTTP della fonte restituiti come codice (403, 404, 410, 429, 500, 503): la pagina d\'errore non viene mai restituita', async () => {
    for (const st of [401, 403, 404, 410, 429, 500, 503]) { const r = await leggi('/stato/' + st); assert.deepStrictEqual(r, { ok: false, code: 'http_' + st, status: st }); }
  });

  await test('F9. dimensione massima: risposta da 20 MB troncata al limite (3,5 MB); compressione "bomba" fermata dopo la decompressione', async () => {
    const r = await leggi('/grande');
    assert.strictEqual(r.ok, true); assert.strictEqual(r.troncato, true); assert.strictEqual(Buffer.byteLength(r.html), Math.floor(3.5 * 1024 * 1024));
    const b = await leggi('/bomba', { maxBytes: 1024 * 1024 });
    assert.strictEqual(b.troncato, true); assert.strictEqual(Buffer.byteLength(b.html), 1024 * 1024);
  });

  await test('F10. tempo massimo: risposta lenta e flusso infinito interrotti', async () => {
    let t0 = Date.now(); assert.strictEqual((await leggi('/lenta', { timeoutMs: 600 })).code, 'timeout'); assert.ok(Date.now() - t0 < 2000, 'interrotta in tempo');
    t0 = Date.now(); assert.strictEqual((await leggi('/goccia', { timeoutMs: 700 })).code, 'timeout'); assert.ok(Date.now() - t0 < 2000);
  });

  await test('F11. redirect: seguiti fino a 5, il sesto respinto; ogni destinazione rivalidata (verso rete privata, metadati, file:, porta non ammessa)', async () => {
    assert.strictEqual((await leggi('/catena/5')).ok, true);
    assert.strictEqual((await leggi('/catena/6')).code, 'troppi_redirect');
    const verso = a => leggi('/redirect?a=' + encodeURIComponent(a));
    assert.strictEqual((await verso('http://interno.test/admin')).code, 'host_non_consentito');
    assert.strictEqual((await verso('http://169.254.169.254/latest/meta-data/')).code, 'host_non_consentito');
    assert.strictEqual((await verso('http://[::1]/')).code, 'host_non_consentito');
    assert.strictEqual((await verso('file:///etc/passwd')).code, 'url_non_valido');
    assert.strictEqual((await verso('http://pagina.test:8080/')).code, 'host_non_consentito');
    assert.strictEqual((await verso('/ok')).html, PAGINA, 'redirect relativo');
  });

  await test('F12. connessione fissata agli indirizzi validati: una sola risoluzione per salto, nessuna seconda risoluzione (rebinding)', async () => {
    let n = 0;
    const cambia = async () => { n++; return n === 1 ? [{ address: '127.0.0.1', family: 4 }] : [{ address: '10.0.0.9', family: 4 }]; };
    const r = await acquisisciPagina('http://pagina.test:' + PORTA + '/ok', { risolvi: cambia, consentito: soloLocale, porte: [String(PORTA)] });
    assert.strictEqual(r.ok, true, JSON.stringify(r)); assert.strictEqual(n, 1, 'risolto una sola volta');
    assert.strictEqual(visite[visite.length - 1].headers.host, 'pagina.test:' + PORTA, 'Host del nome richiesto, connessione all\'indirizzo validato');
  });

  await test('F13. handler: con sessione valida respinge destinazioni locali (422), nessun dettaglio interno nella risposta; senza sessione 401', async () => {
    const chiama = async (body, sessione = true) => { const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; } };
      await (sessione ? handler : mod.default)({ method: 'POST', headers: sessione ? {} : { host: 'khub.example', origin: 'https://khub.example' }, body }, res); return res; };
    const n0 = visite.length;
    for (const u of [base + '/ok', 'http://127.0.0.1/', 'http://169.254.169.254/', 'file:///etc/passwd', '']) {
      const r = await chiama({ fetchUrl: u });
      assert.strictEqual(r.statusCode, 422, u); assert.deepStrictEqual(Object.keys(r.body).sort(), ['code', 'error', 'ok']); assert.strictEqual(r.body.ok, false);
    }
    assert.strictEqual(visite.length, n0, 'nessuna connessione verso il server locale');
    assert.strictEqual((await chiama({ fetchUrl: 'http://127.0.0.1/' }, false)).statusCode, 401);
  });

  srv.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
