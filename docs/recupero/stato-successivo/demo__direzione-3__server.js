#!/usr/bin/env node
/*
 * KHUB — Demo locale della Direzione 3, isolata e con dati sintetici.
 *
 * Avvio:   node demo/direzione-3/server.js
 * Poi:     http://localhost:4173  (si apre gia' con la Direzione 3)
 *
 * Usa la pagina REALE (khub_mvp.html) e il server REALE (api/chat.js), ma il
 * database e' un finto Supabase in memoria con dati inventati. Isolamento,
 * attivo PRIMA di caricare qualsiasi codice dell'app:
 *   1. dall'ambiente del processo vengono tolte tutte le credenziali
 *      (Supabase, Anthropic, KHUB, Vercel, database), qualunque cosa sia
 *      configurata sul computer;
 *   2. ogni connessione in uscita e' bloccata (fetch, http, https, socket,
 *      DNS, WebSocket): l'unico "database" raggiungibile e' quello in memoria;
 *   3. l'indirizzo del database e' su un dominio .invalid, che per standard
 *      non esiste su Internet;
 *   4. il server ascolta solo su 127.0.0.1 (questo computer) e rifiuta
 *      richieste con un Host diverso da localhost.
 * Le modifiche restano in memoria e spariscono alla chiusura (Ctrl+C).
 */
'use strict';

const [maggiore] = process.versions.node.split('.').map(Number);
if (maggiore < 18) {
  console.error('Serve Node.js 18 o successivo (trovato ' + process.versions.node + '). Installa la versione LTS da https://nodejs.org');
  process.exit(1);
}

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ── 1. Ambiente ripulito ─────────────────────────────────
const DA_TOGLIERE = /SUPABASE|ANTHROPIC|KHUB|VERCEL|DATABASE|POSTGRES|PG(HOST|USER|PASSWORD|DATABASE|PORT)|OPENAI|API_KEY|SECRET|TOKEN/i;
const tolte = Object.keys(process.env).filter(k => DA_TOGLIERE.test(k));
tolte.forEach(k => { delete process.env[k]; });
const SUPABASE_FINTO = 'https://supabase-demo-locale.invalid';
process.env.SUPABASE_URL = SUPABASE_FINTO;
process.env.SUPABASE_SECRET_KEY = 'sb_secret_demo_locale_non_valida';
process.env.KHUB_SESSION_SECRET = crypto.randomBytes(32).toString('hex');
process.env.KHUB_ACCESS_PASSWORD = crypto.randomBytes(16).toString('hex');

// ── 2. Barriera di rete ──────────────────────────────────
const bloccate = [];
function blocca(cosa) {
  const msg = 'Rete esterna disabilitata nella demo locale: ' + cosa;
  bloccate.push({ cosa: String(cosa).slice(0, 200), quando: new Date().toISOString() });
  console.log('  [BLOCCATA] ' + String(cosa).slice(0, 200));
  return msg;
}
const net = require('net'), tls = require('tls'), http = require('http'), https = require('https'), dns = require('dns'), dgram = require('dgram');
const lancia = cosa => function () { throw new Error(blocca(cosa)); };
net.connect = net.createConnection = lancia('net.connect');
net.Socket.prototype.connect = lancia('socket.connect');
tls.connect = lancia('tls.connect');
http.request = http.get = lancia('http.request');
https.request = https.get = lancia('https.request');
dgram.createSocket = lancia('udp');
// La risoluzione dei nomi resta possibile solo per gli indirizzi locali (serve
// al server per mettersi in ascolto su 127.0.0.1); ogni altro nome e' bloccato.
const LOCALI = new Set(['127.0.0.1', '::1', 'localhost']);
const lookupOriginale = dns.lookup;
dns.lookup = function (host, ...resto) {
  if (LOCALI.has(String(host))) return lookupOriginale.call(dns, host, ...resto);
  throw new Error(blocca('dns.lookup ' + host));
};
if (dns.promises) {
  const lookupPromesso = dns.promises.lookup;
  dns.promises.lookup = function (host, ...resto) {
    if (LOCALI.has(String(host))) return lookupPromesso.call(dns.promises, host, ...resto);
    return Promise.reject(new Error(blocca('dns.lookup ' + host)));
  };
}
for (const k of ['resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCname', 'resolveMx', 'resolveTxt', 'resolveSrv', 'resolveNs', 'reverse']) {
  if (typeof dns[k] === 'function') dns[k] = lancia('dns.' + k);
  if (dns.promises && typeof dns.promises[k] === 'function') dns.promises[k] = lancia('dns.' + k);
}
for (const k of ['WebSocket', 'EventSource']) { try { delete globalThis[k]; } catch (e) { /* assente */ } }

const { creaFintoSupabase } = require('./finto-supabase');
const { creaDatiSintetici } = require('./dati-sintetici');
const db = creaFintoSupabase(creaDatiSintetici());

const fetchIsolato = async function (url, opts) {
  const u = String(url && url.url ? url.url : url);
  if (u.startsWith(SUPABASE_FINTO + '/rest/v1/')) return db.fetch(u, opts);
  const msg = blocca('fetch ' + u.split('?')[0]);
  return { ok: false, status: 503, json: async () => ({ error: msg }), text: async () => msg };
};
Object.defineProperty(globalThis, 'fetch', { value: fetchIsolato, writable: false, configurable: false });

// ── 3. Server reale dell'app (api/chat.js) ───────────────
const ROOT = path.join(__dirname, '..', '..');
const PAGINA = path.join(ROOT, 'khub_mvp.html');
const PORTA = Number(process.env.PORT_DEMO || process.argv[2] || 4173);

const BANNER = `
<div id="demo-locale" style="position:relative;z-index:2147483000;height:22px;display:flex;align-items:center;justify-content:center;gap:10px;background:#231B14;color:#FAF6EE;font:600 11px/1 -apple-system,system-ui,sans-serif;letter-spacing:.02em;pointer-events:auto">
  <span>DEMO LOCALE · dati sintetici<span class="demo-locale-lungo"> · nessun collegamento a Supabase</span></span>
  <button type="button" onclick="if(confirm('Ripristinare i dati sintetici iniziali? Le modifiche fatte nella demo andranno perse.'))fetch('/demo/ripristina',{method:'POST'}).then(function(){location.reload();})" style="font:inherit;color:#231B14;background:#FAF6EE;border:0;border-radius:4px;padding:3px 7px;cursor:pointer">Ripristina dati</button>
</div>
<style>#demo-locale{white-space:nowrap;overflow:hidden}@media(max-width:600px){.demo-locale-lungo{display:none}}</style>
<script>try{if(!localStorage.getItem('khub_onboarded'))localStorage.setItem('khub_onboarded','1');}catch(e){}</script>
`;

function leggiCorpo(req, max = 5 * 1024 * 1024) {
  return new Promise((ok, ko) => {
    let n = 0; const parti = [];
    req.on('data', c => { n += c.length; if (n > max) { ko(new Error('richiesta troppo grande')); req.destroy(); } else parti.push(c); });
    req.on('end', () => ok(Buffer.concat(parti).toString('utf8')));
    req.on('error', ko);
  });
}

async function avvia() {
  const sorgente = fs.readFileSync(path.join(ROOT, 'api', 'chat.js'), 'utf8');
  const mod = await import('data:text/javascript;base64,' + Buffer.from(sorgente).toString('base64'));
  const { withTestSession } = require(path.join(ROOT, 'scripts', '_khub-test-session.js'));
  const handler = await withTestSession(mod.default);

  const server = http.createServer(async (req, res) => {
    const host = String(req.headers.host || '').replace(/:\d+$/, '');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) { res.writeHead(403); return res.end('Solo localhost'); }
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(302, { Location: '/khub_mvp.html?ui=d3' }); return res.end();
      }
      if (req.method === 'GET' && url.pathname === '/khub_mvp.html') {
        const html = fs.readFileSync(PAGINA, 'utf8')
          .replace('<title>', '<title>[DEMO LOCALE] ')
          .replace(/<body([^>]*)>/, m => m + BANNER);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(html);
      }
      if (req.method === 'POST' && url.pathname === '/api/chat') {
        let body;
        try { body = JSON.parse(await leggiCorpo(req) || '{}'); } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end('{"error":"JSON non valido"}'); }
        let stato = 200, uscita;
        const r = { status(c) { stato = c; return r; }, json(o) { uscita = o; return r; }, setHeader() { return r; }, end() { return r; } };
        await handler({ method: 'POST', headers: {}, body }, r);
        res.writeHead(stato, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify(uscita === undefined ? null : uscita));
      }
      if (req.method === 'POST' && url.pathname === '/demo/ripristina') {
        db.ripristina(); res.writeHead(204); return res.end();
      }
      if (req.method === 'GET' && url.pathname === '/demo/isolamento') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({ database: 'in memoria (dati sintetici)', indirizzoDatabase: SUPABASE_FINTO, variabiliTolte: tolte, connessioniBloccate: bloccate, scrittureNelFinto: db.registro.filter(x => x.method !== 'GET').length }, null, 2));
      }
      res.writeHead(404); res.end('Non trovato');
    } catch (e) {
      console.error('  errore:', e && e.message);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Errore nella demo locale' }));
    }
  });
  server.listen(PORTA, '127.0.0.1', () => {
    console.log('');
    console.log('  KHUB — Demo locale Direzione 3 (dati sintetici, nessun collegamento a Supabase)');
    console.log('  Variabili sensibili ignorate: ' + (tolte.length ? tolte.join(', ') : 'nessuna presente'));
    console.log('  Apri nel browser:  http://localhost:' + PORTA);
    console.log('  Per chiudere:      Ctrl+C (le modifiche della demo vengono perse)');
    console.log('');
  });
  server.on('error', e => {
    if (e.code === 'EADDRINUSE') console.error('La porta ' + PORTA + ' e\' occupata: chiudi l\'altra demo o avvia con  node demo/direzione-3/server.js 4180');
    else console.error(e.message);
    process.exit(1);
  });
  return server;
}

if (require.main === module) avvia();
module.exports = { avvia, db, bloccate };

