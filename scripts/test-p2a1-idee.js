/*
 * Test — P2-a.1: fondazione delle Idee (tabella public.ideas, azioni server).
 *
 * Parte A (sempre eseguita): server reale (api/chat.js) con un database
 * simulato che registra le richieste. Autenticazione, validazione,
 * normalizzazione dell'anteprima, nessuna scrittura per dati non validi.
 *
 * Parte B (richiede KHUB_PG_TEST e KHUB_POSTGREST_BIN, altrimenti skip):
 * PostgreSQL locale con ruoli come in Supabase (anon, authenticated,
 * service_role, privilegi predefiniti su public), schema di base e TUTTE le
 * migrazioni del repository, 0013 compresa. Due PostgREST locali:
 *   - "server": ruolo service_role (come la chiave secret usata da KHUB);
 *   - "pubblico": ruolo anon, con JWT per authenticated e service_role.
 * Il server reale dell'app gira collegato al PostgREST "server".
 * B1-B9 usano i vecchi privilegi predefiniti di Supabase (ALL ai ruoli
 * dell'API); B10-B11 il nuovo comportamento, in cui le nuove tabelle di
 * public non sono concesse a nessuno: service_role deve ricevere dalla
 * migrazione SELECT, INSERT, UPDATE espliciti (e nessun DELETE).
 * Mai Supabase, nessuna AI, nessuna rete esterna.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0, skipped = 0;
async function test(name, fn) { try { const r = await fn(); if (r === 'skip') { skipped++; console.log('  skip - ' + name); return; } passed++; console.log('  ok - ' + name); } catch (e) { failed++; console.log('  FAIL - ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n    ')); } }
const clone = x => JSON.parse(JSON.stringify(x));
const FETCH_ORIGINALE = globalThis.fetch;
const caricaHandler = async () => (await import('data:text/javascript;base64,' + Buffer.from(fs.readFileSync(path.join(ROOT, 'api/chat.js'), 'utf8')).toString('base64'))).default;

// Anteprima nel formato di S.loadPreview (importazione strutturata P1-b + P0-c).
const ANTEPRIMA = {
  name: 'Ganache al caramello salato', category: '', portionsCount: 0, gramsPerPortion: 0,
  declaredYield: { qty: '', unit: '', source: '', range: null, toVerify: false },
  ingredients: [
    { id: 'x1', name: 'panna fresca liquida', qty: 200, unit: 'g', qtyKind: 'certa', qtyMin: null, qtyMax: null, sourceText: '200 g di panna fresca liquida', statoImport: 'estratto' },
    { id: 'x2', name: 'fior di sale', qty: null, unit: null, qtyKind: 'variabile', qtyMin: null, qtyMax: null, sourceText: 'fior di sale q.b.' },
    { id: 'x3', name: 'vaniglia', qty: 1, unit: 'baccello', qtyKind: 'certa', qtyMin: null, qtyMax: null, sourceText: '1 baccello di vaniglia' },
    { id: 'x4', name: 'acqua', qty: null, unit: 'g', qtyKind: 'intervallo', qtyMin: 20, qtyMax: 30, sourceText: '20–30 g di acqua' },
    { id: 'x5', name: 'Burro per lo stampo', qty: null, unit: null, qtyKind: 'mancante', qtyMin: null, qtyMax: null, sourceText: 'Burro per lo stampo' }],
  steps: ['Caramello — Scaldate la panna fino a 80 °C.', 'Ganache — Versate sul cioccolato ed emulsionate.'],
  subRecipes: [],
  importFonte: { tipo: 'strutturata', url: 'https://www.soniaperonaci.it/ganache-al-caramello-salato/', descrizione: 'Una ganache golosa.',
    tempi: { preparazione: { minuti: 30, originale: 'PT30M' }, cottura: { minuti: 15, originale: 'PT15M' }, totale: { minuti: 765, originale: 'PT12H45M' } },
    tempiTesto: 'Preparazione: 30 min · Cottura: 15 min · Totale: 12 h 45 min', notaTempi: 'Il tempo totale dichiarato (12 h 45 min) supera di 12 h preparazione + cottura (45 min; differenza calcolata da KHUB): la fonte non indica a cosa corrisponda.',
    notaResa: '', notaPorzioni: '', notaPassi: '', sezioni: [{ nome: 'Caramello', da: 1, a: 1 }], segreto: 'non deve passare' },
  campoSconosciuto: 'non deve passare',
};
const ANTEPRIMA_NORMALIZZATA = {
  versione: 1, nome: 'Ganache al caramello salato',
  ingredienti: [
    { nome: 'panna fresca liquida', qty: 200, unit: 'g', qtyKind: 'certa', qtyMin: null, qtyMax: null, testoFonte: '200 g di panna fresca liquida' },
    { nome: 'fior di sale', qty: null, unit: null, qtyKind: 'variabile', qtyMin: null, qtyMax: null, testoFonte: 'fior di sale q.b.' },
    { nome: 'vaniglia', qty: 1, unit: 'baccello', qtyKind: 'certa', qtyMin: null, qtyMax: null, testoFonte: '1 baccello di vaniglia' },
    { nome: 'acqua', qty: null, unit: 'g', qtyKind: 'intervallo', qtyMin: 20, qtyMax: 30, testoFonte: '20–30 g di acqua' },
    { nome: 'Burro per lo stampo', qty: null, unit: null, qtyKind: 'mancante', qtyMin: null, qtyMax: null, testoFonte: 'Burro per lo stampo' }],
  passi: ['Caramello — Scaldate la panna fino a 80 °C.', 'Ganache — Versate sul cioccolato ed emulsionate.'],
  resa: null,
  tempi: { preparazione: { minuti: 30, originale: 'PT30M' }, cottura: { minuti: 15, originale: 'PT15M' }, totale: { minuti: 765, originale: 'PT12H45M' } },
  note: ['Il tempo totale dichiarato (12 h 45 min) supera di 12 h preparazione + cottura (45 min; differenza calcolata da KHUB): la fonte non indica a cosa corrisponda.'],
  fonte: { url: 'https://www.soniaperonaci.it/ganache-al-caramello-salato/', descrizione: 'Una ganache golosa.' },
};

(async () => {
  // ══ PARTE A — server reale, database simulato ═════════════════════════════
  console.log('P2-a.1 — Parte A: server reale, database simulato (autenticazione, validazione, normalizzazione)');
  process.env.SUPABASE_URL = 'https://simulato.supabase.co'; process.env.SUPABASE_SECRET_KEY = 'sb_secret_simulata_per_i_test';
  const nudo = await caricaHandler();
  const conSessione = await require('./_khub-test-session').withTestSession(nudo);
  let richieste = [], risposteDb = () => ({ status: 201, body: [] });
  globalThis.fetch = async (url, o) => { richieste.push({ url: String(url), method: (o && o.method) || 'GET', body: o && o.body ? JSON.parse(o.body) : null });
    const r = risposteDb(String(url), o); return { ok: r.status < 300, status: r.status, json: async () => r.body, text: async () => JSON.stringify(r.body) }; };
  const chiama = async (h, body, headers) => { let st = 200, out; await h({ method: 'POST', headers: headers || {}, body: clone(body) }, { status(c) { st = c; return this; }, json(o) { out = o; return this; }, setHeader() { return this; }, end() { return this; } }); return { st, out }; };
  const crea = idea => chiama(conSessione, { supabaseAction: 'createIdea', idea });
  const scritture = () => richieste.filter(r => r.method !== 'GET');

  await test('A1. senza sessione: tutte le azioni delle Idee rifiutate (401) e nessuna richiesta al database', async () => {
    richieste = [];
    for (const b of [{ supabaseAction: 'loadIdeas' }, { supabaseAction: 'createIdea', idea: { title: 'x', sourceType: 'appunto', sourceText: 'y' } }, { supabaseAction: 'updateIdeaNotes', id: 'idea_abcdefgh', notes: 'n' }, { supabaseAction: 'archiveIdea', id: 'idea_abcdefgh' }]) {
      const r = await chiama(nudo, b, { host: 'khub.test' });
      assert.strictEqual(r.st, 401, b.supabaseAction);
    }
    assert.strictEqual(richieste.length, 0);
  });

  await test('A2. dati non validi rifiutati prima di scrivere: titolo, tipo, link, appunto, anteprima e origine, campi estranei, limiti, quantita\' incoerenti', async () => {
    const lungo = n => 'x'.repeat(n);
    const casi = [
      [{ sourceType: 'appunto', sourceText: 'a' }, 'titolo mancante'], [{ title: '   ', sourceType: 'appunto', sourceText: 'a' }, 'titolo mancante'],
      [{ title: lungo(201), sourceType: 'appunto', sourceText: 'a' }, 'titolo troppo lungo'], [{ title: 'T', sourceType: 'video', sourceUrl: 'https://x.test' }, 'tipo di fonte'],
      [{ title: 'T', sourceType: 'link' }, 'link mancante'], [{ title: 'T', sourceType: 'link', sourceUrl: 'javascript:alert(1)' }, 'solo http o https'],
      [{ title: 'T', sourceType: 'link', sourceUrl: 'https://u:p@x.test/a' }, 'credenziali'], [{ title: 'T', sourceType: 'link', sourceUrl: 'non un indirizzo' }, 'indirizzo non valido'],
      [{ title: 'T', sourceType: 'link', sourceUrl: 'https://x.test/' + lungo(2000) }, 'troppo lungo'],
      [{ title: 'T', sourceType: 'testo' }, 'testo mancante'], [{ title: 'T', sourceType: 'testo', sourceText: lungo(20001) }, 'testo troppo lungo'],
      [{ title: 'T', sourceType: 'appunto', sourceText: 'a', sourceUrl: 'https://x.test' }, 'un appunto non ha link'], [{ title: 'T', sourceType: 'appunto', sourceText: 'a', preview: clone(ANTEPRIMA), previewOrigin: 'strutturata' }, 'un appunto non ha link'],
      [{ title: 'T', sourceType: 'link', sourceUrl: 'https://x.test', preview: clone(ANTEPRIMA) }, 'vanno indicate insieme'], [{ title: 'T', sourceType: 'link', sourceUrl: 'https://x.test', previewOrigin: 'ai' }, 'vanno indicate insieme'],
      [{ title: 'T', sourceType: 'link', sourceUrl: 'https://x.test', preview: clone(ANTEPRIMA), previewOrigin: 'manuale' }, 'origine'],
      [{ title: 'T', sourceType: 'appunto', sourceText: 'a', status: 'trasformata' }, 'campi non ammessi: status'], [{ title: 'T', sourceType: 'appunto', sourceText: 'a', linkedRecipeId: 'r1', id: 'idea_xxxxxxxx' }, 'campi non ammessi'],
      [{ title: 'T', sourceType: 'appunto', sourceText: 'a', notes: lungo(5001) }, 'note troppo lungo'],
      [{ title: 'T', sourceType: 'link', sourceUrl: 'https://x.test', preview: [], previewOrigin: 'ai' }, 'anteprima non valida'],
      [{ title: 'T', sourceType: 'link', sourceUrl: 'https://x.test', preview: { ingredients: [{ name: 'farina', qty: 0, qtyKind: 'certa' }] }, previewOrigin: 'ai' }, 'non coerente'],
      [{ title: 'T', sourceType: 'link', sourceUrl: 'https://x.test', preview: { ingredients: [{ name: 'sale', qty: 5, qtyKind: 'variabile' }] }, previewOrigin: 'ai' }, 'non coerente'],
      [{ title: 'T', sourceType: 'link', sourceUrl: 'https://x.test', preview: { ingredients: [{ name: 'acqua', qtyKind: 'intervallo', qtyMin: 30, qtyMax: 20 }] }, previewOrigin: 'ai' }, 'non coerente'],
      [{ title: 'T', sourceType: 'link', sourceUrl: 'https://x.test', preview: { ingredients: [{ name: 'x', qtyKind: 'stimata' }] }, previewOrigin: 'ai' }, 'tipo di quantita'],
      [{ title: 'T', sourceType: 'link', sourceUrl: 'https://x.test', preview: { ingredients: [{ qty: 1, unit: 'g' }] }, previewOrigin: 'ai' }, 'senza nome'],
      [{ title: 'T', sourceType: 'link', sourceUrl: 'https://x.test', preview: { ingredients: Array.from({ length: 201 }, () => ({ name: 'a' })) }, previewOrigin: 'ai' }, 'ingredienti non validi'],
      [{ title: 'T', sourceType: 'link', sourceUrl: 'https://x.test', preview: { steps: [lungo(5001)] }, previewOrigin: 'ai' }, 'troppo lungo'],
      ['non un oggetto', 'idea non valida']];
    richieste = [];
    for (const [idea, atteso] of casi) {
      const r = await crea(idea);
      assert.strictEqual(r.out && r.out.code, 'idea_non_valida', JSON.stringify(idea).slice(0, 80));
      assert.ok(r.out.error.includes(atteso), atteso + ' <> ' + r.out.error);
    }
    assert.strictEqual(scritture().length, 0, 'nessuna scrittura');
  });

  await test('A3. normalizzazione: solo i campi noti, nulla inventato, id e stato decisi dal server, caratteri di controllo tolti', async () => {
    richieste = []; risposteDb = () => ({ status: 201, body: [{ id: 'idea_finta' }] });
    const r = await crea({ title: '  Ganache\u0007 salata\n', sourceType: 'link', sourceUrl: 'https://www.soniaperonaci.it/ganache-al-caramello-salato/', preview: clone(ANTEPRIMA), previewOrigin: 'strutturata', notes: 'Prova\u0000 con\nnote' });
    assert.strictEqual(r.out.ok, true, JSON.stringify(r.out));
    const post = scritture(); assert.strictEqual(post.length, 1); assert.ok(post[0].url.endsWith('/rest/v1/ideas'));
    const b = post[0].body;
    assert.ok(/^idea_[0-9a-f]{32}$/.test(b.id), b.id);
    assert.deepStrictEqual([b.title, b.status, b.source_type, b.source_text, b.preview_origin, b.notes], ['Ganache salata', 'aperta', 'link', null, 'strutturata', 'Prova con\nnote']);
    assert.deepStrictEqual(b.preview, ANTEPRIMA_NORMALIZZATA);
    assert.ok(!('linked_recipe_id' in b) && !('created_at' in b), 'nessun riferimento o data dal client');
    // Anteprima con resa: copiata com'e', senza inventare porzioni o grammi.
    richieste = [];
    await crea({ title: 'Tiramisù', sourceType: 'link', sourceUrl: 'https://ricette.giallozafferano.it/Tiramisu.html', previewOrigin: 'strutturata',
      preview: { name: 'Tiramisù', ingredients: [], steps: [], declaredYield: { qty: '10', unit: 'porzioni', source: '10 persone', range: null, toVerify: false } } });
    const p = scritture()[0].body.preview;
    assert.deepStrictEqual([p.resa, p.tempi, p.ingredienti, p.passi, p.note], [{ qty: '10', unit: 'porzioni', fonte: '10 persone', intervallo: null, daVerificare: false }, null, [], [], []]);
  });

  await test('A4. id e note: id con formato non valido rifiutato senza letture; note troppo lunghe rifiutate senza scrivere', async () => {
    richieste = [];
    for (const id of ['', 'r123', 'idea_', 'idea_abc', 'idea_abcdefgh;drop', 'idea_' + 'a'.repeat(65)]) {
      for (const a of ['updateIdeaNotes', 'archiveIdea']) { const r = await chiama(conSessione, { supabaseAction: a, id, notes: 'x' }); assert.strictEqual(r.out.code, 'idea_non_valida', a + ' ' + id); }
    }
    assert.strictEqual(richieste.length, 0);
    risposteDb = (u, o) => (o && o.method === 'PATCH') ? { status: 200, body: [{}] } : { status: 200, body: [{ id: 'idea_abcdefgh', status: 'aperta' }] };
    const r = await chiama(conSessione, { supabaseAction: 'updateIdeaNotes', id: 'idea_abcdefgh', notes: 'x'.repeat(5001) });
    assert.strictEqual(r.out.code, 'idea_non_valida'); assert.strictEqual(scritture().length, 0);
  });

  await test('A5. azioni generiche: update e delete non ammettono la tabella ideas', async () => {
    richieste = [];
    const d = await chiama(conSessione, { supabaseAction: 'delete', table: 'ideas', id: 'idea_abcdefgh' });
    const u = await chiama(conSessione, { supabaseAction: 'update', table: 'ideas', data: { id: 'idea_abcdefgh', status: 'trasformata' } });
    assert.ok(d.out.code === 'not_allowed' || /non ammessa/.test(d.out.error), JSON.stringify(d.out));
    assert.ok(/non ammessa|tabella/.test(JSON.stringify(u.out)), JSON.stringify(u.out));
    assert.strictEqual(scritture().length, 0);
  });

  // ══ PARTE B — PostgreSQL + PostgREST locali ═══════════════════════════════
  const CONN = process.env.KHUB_PG_TEST, BIN = process.env.KHUB_POSTGREST_BIN;
  if (!CONN || !BIN) {
    globalThis.fetch = FETCH_ORIGINALE;
    console.log('P2-a.1 — Parte B: KHUB_PG_TEST o KHUB_POSTGREST_BIN non impostati, parte non eseguita (skip)');
    skipped++;
    console.log('\n' + passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped');
    process.exit(failed ? 1 : 0);
  }
  const DB = 'khub_p2a1_' + process.pid;
  const parti = Object.fromEntries(CONN.trim().split(/\s+/).map(x => x.split('=')));
  const psql = (q, db = DB, file) => spawnSync('psql', [CONN + ' dbname=' + db, '-v', 'ON_ERROR_STOP=1', '-qtA'].concat(file ? ['-f', file] : ['-c', q]), { encoding: 'utf8' });
  const sql = (q, db) => { const r = psql(q, db); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
  const sqlKo = q => { const r = psql(q); assert.notStrictEqual(r.status, 0, 'doveva fallire: ' + q.slice(0, 120)); return r.stderr; };
  const righe = q => JSON.parse(sql('select coalesce(json_agg(t),\'[]\') from (' + q + ') t'));
  const portaLibera = () => new Promise(ok => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
  const attendi = async (cond, ms, cosa) => { const t0 = Date.now(); while (!(await cond())) { if (Date.now() - t0 > ms) throw new Error('timeout: ' + cosa); await new Promise(r => setTimeout(r, 100)); } };
  const MIG = path.join(ROOT, 'supabase/migrations/0013_ideas.sql'), RB = path.join(ROOT, 'supabase/rollback/PREPARED_NOT_EXECUTED__0013_ideas_rollback.sql');
  const JWT_SECRET = 'khub-test-jwt-secret-locale-almeno-32-caratteri';
  const jwt = ruolo => { const b = o => Buffer.from(JSON.stringify(o)).toString('base64url'); const h = b({ alg: 'HS256', typ: 'JWT' }) + '.' + b({ role: ruolo, exp: Math.floor(Date.now() / 1000) + 3600 });
    return h + '.' + crypto.createHmac('sha256', JWT_SECRET).update(h).digest('base64url'); };
  const figli = []; const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'khub-p2a1-'));
  globalThis.fetch = FETCH_ORIGINALE; // fetch reale di Node per la parte B
  try {
    // Ruoli come in Supabase (a livello di cluster: creati solo se assenti).
    sql("do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;" +
      " if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;" +
      " if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if; end $$;", 'postgres');
    sql('drop database if exists ' + DB, 'postgres'); sql('create database ' + DB, 'postgres');
    // Privilegi predefiniti come in Supabase: le nuove tabelle di public sono concesse ai ruoli dell'API.
    sql('grant usage on schema public to anon, authenticated, service_role;' +
      ' alter default privileges in schema public grant all on tables to anon, authenticated, service_role;' +
      ' alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;');
    const applica = f => { const r = psql(null, DB, f); if (r.status !== 0) throw new Error(path.basename(f) + ': ' + r.stderr); return r.stderr; };
    applica(path.join(ROOT, 'scripts/db/p0c-schema-base-locale.sql'));
    const migrazioni = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort();
    migrazioni.forEach(f => applica(path.join(ROOT, 'supabase/migrations', f)));
    sql("insert into recipes (id,name,category,department,notes) values ('rA','Crema','Dolci','Pasticceria','');" +
      "insert into variants (id,recipe_id,name,label,note,status,active,portions_count,grams_per_portion,steps) values ('vA','rA','Crema','Bozza 1','','lab',false,4,200,'[\"Scaldare.\"]');" +
      "insert into ingredients (id,variant_id,name,qty,unit,sort_order) values ('ingA1','vA','Latte',500,'ml',0);");
    const somma = () => sql("select md5((select coalesce(string_agg(concat_ws('|',id,name,category),'#' order by id),'') from recipes)||(select coalesce(string_agg(concat_ws('|',id,recipe_id,name,status,active),'#' order by id),'') from variants)||(select coalesce(string_agg(concat_ws('|',id,variant_id,name,qty,unit),'#' order by id),'') from ingredients)||(select count(*)::text from production_sessions))");
    const sommaIniziale = somma();

    const avviaRest = async (ruoloAnonimo, conJwt, db = DB) => {
      const porta = await portaLibera();
      const uri = 'postgres://' + (parti.user || 'postgres') + '@/' + db + '?host=' + encodeURIComponent(parti.host || '/tmp') + '&port=' + (parti.port || 5432);
      const conf = path.join(tmp, 'pgrst-' + db + '-' + ruoloAnonimo + '.conf');
      fs.writeFileSync(conf, `db-uri = "${uri}"\ndb-schemas = "public"\ndb-anon-role = "${ruoloAnonimo}"\nserver-host = "127.0.0.1"\nserver-port = ${porta}\n` + (conJwt ? `jwt-secret = "${JWT_SECRET}"\n` : ''));
      const p = spawn(BIN, [conf], { stdio: ['ignore', 'pipe', 'pipe'] }); figli.push(p); let log = ''; p.stdout.on('data', d => { log += d; }); p.stderr.on('data', d => { log += d; });
      const url = 'http://127.0.0.1:' + porta;
      await attendi(async () => { try { return (await fetch(url + '/')).status < 500; } catch (e) { return false; } }, 15000, 'PostgREST ' + log);
      return url;
    };
    const REST_SERVER = await avviaRest('service_role', false);
    const REST_PUBBLICO = await avviaRest('anon', true);
    // Server reale dell'app collegato a un PostgREST locale; restituisce la funzione di chiamata e il log.
    const avviaApp = async rest => {
      const portaApp = await portaLibera();
      const app = spawn(process.execPath, [path.join(ROOT, 'scripts/_p0c-postgrest-server.js'), String(portaApp), rest], { env: { PATH: process.env.PATH, HOME: process.env.HOME }, stdio: ['ignore', 'pipe', 'pipe'] });
      figli.push(app); const stato = { log: '' }; app.stdout.on('data', d => { stato.log += d; }); app.stderr.on('data', d => { stato.log += d; });
      await attendi(() => /pronto/.test(stato.log), 15000, 'server di test ' + stato.log);
      const chiama = async body => { const r = await fetch('http://localhost:' + portaApp + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return r.json(); };
      return { chiama, stato };
    };
    const api = (await avviaApp(REST_SERVER)).chiama;
    // Privilegi effettivi su public.ideas (per ruolo), in un database a scelta.
    const PRIV = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
    const privilegi = (ruolo, db = DB) => PRIV.filter(p => sql(`select has_table_privilege('${ruolo}','public.ideas','${p}')`, db) === 't');
    console.log('P2-a.1 — Parte B: ' + sql('show server_version').split(' ')[0] + ' + PostgREST locale (migrazioni ' + migrazioni.map(f => f.slice(0, 4)).join(', ') + ')');

    const ids = {};
    await test('B1. link non leggibile: Idea aperta con solo titolo e link, nessun contenuto inventato', async () => {
      const r = await api({ supabaseAction: 'createIdea', idea: { title: 'Torta della nonna', sourceType: 'link', sourceUrl: 'https://esempio.test/ricetta?id=7' } });
      assert.strictEqual(r.ok, true, JSON.stringify(r)); ids.link = r.idea.id;
      assert.deepStrictEqual(righe("select title, status, source_type, source_url, source_text, preview, preview_origin, notes, linked_recipe_id from ideas where id='" + ids.link + "'")[0],
        { title: 'Torta della nonna', status: 'aperta', source_type: 'link', source_url: 'https://esempio.test/ricetta?id=7', source_text: null, preview: null, preview_origin: null, notes: null, linked_recipe_id: null });
    });
    await test('B2. testo breve e appunto: salvati senza AI, a capo conservati, nessuna anteprima', async () => {
      let r = await api({ supabaseAction: 'createIdea', idea: { title: 'Crema al limone', sourceType: 'testo', sourceText: 'Latte 500 g\nScorza di limone\nZucchero q.b.', sourceUrl: 'https://esempio.test/crema' } });
      assert.strictEqual(r.ok, true); ids.testo = r.idea.id;
      r = await api({ supabaseAction: 'createIdea', idea: { title: 'Idea per il menù', sourceType: 'appunto', sourceText: 'Provare la ganache con miso bianco.' } });
      assert.strictEqual(r.ok, true); ids.appunto = r.idea.id;
      assert.deepStrictEqual(righe("select source_type, source_text, source_url, preview from ideas where id in ('" + ids.testo + "','" + ids.appunto + "') order by source_type"),
        [{ source_type: 'appunto', source_text: 'Provare la ganache con miso bianco.', source_url: null, preview: null }, { source_type: 'testo', source_text: 'Latte 500 g\nScorza di limone\nZucchero q.b.', source_url: 'https://esempio.test/crema', preview: null }]);
    });
    await test('B3. anteprima strutturata: conservata normalizzata (tipi P0-c, unita\' della fonte, tempi, provenienza); campi sconosciuti scartati', async () => {
      const r = await api({ supabaseAction: 'createIdea', idea: { title: 'Ganache al caramello salato', sourceType: 'link', sourceUrl: 'https://www.soniaperonaci.it/ganache-al-caramello-salato/', preview: clone(ANTEPRIMA), previewOrigin: 'strutturata' } });
      assert.strictEqual(r.ok, true, JSON.stringify(r)); ids.anteprima = r.idea.id;
      const row = righe("select preview, preview_origin from ideas where id='" + ids.anteprima + "'")[0];
      assert.deepStrictEqual(row.preview, ANTEPRIMA_NORMALIZZATA); assert.strictEqual(row.preview_origin, 'strutturata');
      assert.strictEqual(sql("select count(*) from ingredients where name in ('fior di sale','vaniglia')"), '0', 'nessun ingrediente scritto nelle Ricette');
    });
    await test('B4. vincoli del database (difesa anche senza il server): provenienza, coerenza, limiti, formato id', async () => {
      for (const [c, v] of [[',', ",'video'"], [',', ",'link'"], [',source_url', ",'link','javascript:alert(1)'"], [',source_url', ",'link','ftp://x.test'"], [',', ",'testo'"], [',source_text', ",'appunto',''"],
        [',source_text,source_url', ",'appunto','a','https://x.test'"], [',source_text,preview,preview_origin', ",'appunto','a','{}','strutturata'"] /* 0015: un appunto ammette solo una proposta di origine ai */, [',source_url,preview', ",'link','https://x.test','{}'"],
        [',source_url,preview_origin', ",'link','https://x.test','ai'"], [',source_url,preview,preview_origin', ",'link','https://x.test','[]','ai'"],
        [',source_text', ",'testo','" + 'x'.repeat(20001) + "'"], [',source_text,notes', ",'appunto','a','" + 'x'.repeat(5001) + "'"], [',source_text,status', ",'appunto','a','analizzata'"],
        [',source_text,linked_variant_id', ",'appunto','a','variante_inesistente'"]]) {
        sqlKo(`insert into ideas (id,title,source_type${c.slice(1) ? c : ''}) values ('idea_vincolo${Math.random().toString(36).slice(2, 10)}','T'${v})`);
      }
      sqlKo("insert into ideas (id,title,source_type,source_text) values ('r_non_idea','T','appunto','a')");
      sqlKo("insert into ideas (id,title,source_type,source_text) values ('idea_vuotoxx','   ','appunto','a')");
      assert.strictEqual(sql("select count(*) from ideas where id like 'idea_vincolo%'"), '0');
    });
    await test('B5. note: modificate solo le note e la data; limiti; Idea inesistente', async () => {
      const prima = righe("select * from ideas where id='" + ids.testo + "'")[0];
      const r = await api({ supabaseAction: 'updateIdeaNotes', id: ids.testo, notes: 'Da provare con limoni di Amalfi.\nMeno zucchero.' });
      assert.strictEqual(r.ok, true, JSON.stringify(r));
      const dopo = righe("select * from ideas where id='" + ids.testo + "'")[0];
      assert.strictEqual(dopo.notes, 'Da provare con limoni di Amalfi.\nMeno zucchero.');
      assert.ok(new Date(dopo.updated_at) >= new Date(prima.updated_at));
      for (const k of ['title', 'status', 'source_type', 'source_url', 'source_text', 'preview', 'preview_origin', 'created_at']) assert.deepStrictEqual(dopo[k], prima[k], k);
      assert.strictEqual((await api({ supabaseAction: 'updateIdeaNotes', id: ids.testo, notes: 'x'.repeat(5001) })).code, 'idea_non_valida');
      assert.strictEqual((await api({ supabaseAction: 'updateIdeaNotes', id: 'idea_inesistente00', notes: 'x' })).code, 'idea_non_trovata');
      assert.strictEqual((await api({ supabaseAction: 'updateIdeaNotes', id: ids.testo, notes: '' })).idea.notes, null, 'note svuotate');
    });
    await test('B6. archiviazione: stato archiviata, ripetibile, note bloccate; elenco senza archiviate salvo richiesta', async () => {
      let r = await api({ supabaseAction: 'archiveIdea', id: ids.appunto }); assert.strictEqual(r.ok, true); assert.strictEqual(r.idea.status, 'archiviata');
      r = await api({ supabaseAction: 'archiveIdea', id: ids.appunto }); assert.strictEqual(r.ok, true, 'ripetibile');
      assert.strictEqual((await api({ supabaseAction: 'updateIdeaNotes', id: ids.appunto, notes: 'x' })).code, 'idea_archiviata');
      const aperte = (await api({ supabaseAction: 'loadIdeas' })).ideas.map(i => i.id), tutte = (await api({ supabaseAction: 'loadIdeas', includeArchived: true })).ideas.map(i => i.id);
      assert.ok(!aperte.includes(ids.appunto) && aperte.includes(ids.link) && tutte.includes(ids.appunto) && tutte.length === 4, JSON.stringify([aperte, tutte]));
      assert.strictEqual(sql("select status from ideas where id='" + ids.appunto + "'"), 'archiviata');
    });
    await test('B7. accesso diretto dall\'API pubblica negato: anon e authenticated non leggono, non scrivono, non modificano, non cancellano; il ruolo del server si', async () => {
      const prova = async (token, metodo, percorso, corpo) => { const h = { 'Content-Type': 'application/json' }; if (token) h.Authorization = 'Bearer ' + token;
        const r = await fetch(REST_PUBBLICO + percorso, { method: metodo, headers: h, body: corpo ? JSON.stringify(corpo) : undefined }); return [r.status, await r.text()]; };
      const nuova = { id: 'idea_esterna00', title: 'X', source_type: 'appunto', source_text: 'x' };
      for (const [nome, token] of [['anon', null], ['authenticated', jwt('authenticated')]]) {
        for (const [m, p, c] of [['GET', '/ideas?select=id', null], ['POST', '/ideas', nuova], ['PATCH', '/ideas?id=eq.' + ids.link, { title: 'Y' }], ['DELETE', '/ideas?id=eq.' + ids.link, null]]) {
          const [st, txt] = await prova(token, m, p, c);
          assert.ok(st === 401 || st === 403, nome + ' ' + m + ': ' + st + ' ' + txt.slice(0, 120));
          assert.ok(/42501|permission denied/i.test(txt), nome + ' ' + m + ': ' + txt.slice(0, 120));
        }
      }
      const [st, txt] = await prova(jwt('service_role'), 'GET', '/ideas?select=id', null);
      assert.strictEqual(st, 200); assert.strictEqual(JSON.parse(txt).length, 4);
      assert.strictEqual(sql("select title from ideas where id='" + ids.link + "'"), 'Torta della nonna');
      assert.strictEqual(sql("select count(*) from ideas where id='idea_esterna00'"), '0');
      assert.deepStrictEqual([sql("select relrowsecurity from pg_class where oid='public.ideas'::regclass"), sql("select count(*) from pg_policies where tablename='ideas'")], ['t', '0']);
      for (const ruolo of ['anon', 'authenticated']) assert.strictEqual(sql(`select has_table_privilege('${ruolo}','public.ideas','SELECT') or has_table_privilege('${ruolo}','public.ideas','INSERT') or has_table_privilege('${ruolo}','public.ideas','UPDATE') or has_table_privilege('${ruolo}','public.ideas','DELETE')`), 'f', ruolo);
      for (const ruolo of ['anon', 'authenticated']) assert.deepStrictEqual(privilegi(ruolo), [], ruolo + ': nessun privilegio');
      // Vecchio comportamento di Supabase (privilegi predefiniti = ALL): la migrazione toglie DELETE e il resto.
      assert.deepStrictEqual(privilegi('service_role'), ['SELECT', 'INSERT', 'UPDATE'], 'service_role: solo lettura, inserimento, modifica');
      const [stDel, txtDel] = await prova(jwt('service_role'), 'DELETE', '/ideas?id=eq.' + ids.link, null);
      assert.ok(stDel === 401 || stDel === 403, 'service_role DELETE: ' + stDel + ' ' + txtDel.slice(0, 120));
      assert.ok(/42501|permission denied/i.test(txtDel), txtDel.slice(0, 120));
      assert.strictEqual(sql("select count(*) from ideas where id='" + ids.link + "'"), '1', 'nessuna Idea cancellata');
    });
    await test('B8. isolamento dalle Ricette: nessuna Scheda, bozza, ingrediente o Sessione toccata; la lettura delle Schede non contiene Idee; Scheda eliminata -> riferimento NULL', async () => {
      assert.strictEqual(somma(), sommaIniziale, 'Ricette invariate');
      const load = await api({ supabaseAction: 'load' });
      assert.ok(!('ideas' in load) && !JSON.stringify(load).includes('idea_'), 'la load delle Schede non legge le Idee');
      sql("update ideas set linked_recipe_id='rA', linked_variant_id='vA' where id='" + ids.link + "'");
      sql("delete from recipes where id='rA'"); // non bloccata da un'Idea collegata (variants in cascata)
      assert.deepStrictEqual(righe("select linked_recipe_id, linked_variant_id, title from ideas where id='" + ids.link + "'")[0], { linked_recipe_id: null, linked_variant_id: null, title: 'Torta della nonna' });
    });
    await test('B9. migrazione idempotente; ferma se public.ideas esiste con colonne diverse; rollback fermato con dati, eseguito senza dati', async () => {
      const r1 = psql(null, DB, MIG); assert.strictEqual(r1.status, 0, r1.stderr); assert.ok(/gia' presente con le colonne attese/.test(r1.stderr));
      const DB2 = DB + '_b'; sql('drop database if exists ' + DB2, 'postgres'); sql('create database ' + DB2, 'postgres');
      sql("create table recipes (id text primary key); create table variants (id text primary key); create table ideas (id text primary key, title text);", DB2);
      const r2 = psql(null, DB2, MIG); assert.notStrictEqual(r2.status, 0); assert.ok(/esiste gia' con colonne diverse/.test(r2.stderr), r2.stderr);
      assert.strictEqual(sql("select count(*) from information_schema.columns where table_name='ideas'", DB2), '2', 'nessuna modifica');
      sql('drop database ' + DB2, 'postgres');
      // P2-a.2: con la 0014 applicata il rollback 0013 si ferma e chiede prima il rollback 0014.
      if (sql("select to_regclass('public.idea_turns') is not null") === 't') {
        const r0 = psql(null, DB, RB); assert.notStrictEqual(r0.status, 0); assert.ok(/Eseguire prima il rollback 0014/.test(r0.stderr), r0.stderr);
        const rb14 = psql(null, DB, path.join(ROOT, 'supabase/rollback/PREPARED_NOT_EXECUTED__0014_idea_turns_rollback.sql')); assert.strictEqual(rb14.status, 0, rb14.stderr);
      }
      const r3 = psql(null, DB, RB); assert.notStrictEqual(r3.status, 0); assert.ok(/Rollback 0013 fermato: public.ideas contiene 4 righe/.test(r3.stderr), r3.stderr);
      sql('delete from ideas'); const r4 = psql(null, DB, RB); assert.strictEqual(r4.status, 0, r4.stderr);
      assert.strictEqual(sql("select to_regclass('public.ideas') is null"), 't');
    });

    // ══ Nuovo comportamento di Supabase: le nuove tabelle di public NON sono concesse in automatico ai ruoli
    // dell'API (anon, authenticated, service_role). Le tabelle preesistenti mantengono i loro privilegi.
    const DB_NUOVO = DB + '_nuovo';
    await test('B10. nuovo comportamento di Supabase (nessun privilegio automatico): service_role riceve solo SELECT, INSERT, UPDATE; percorso completo delle Idee dal server; anon e authenticated esclusi', async () => {
      sql('drop database if exists ' + DB_NUOVO, 'postgres'); sql('create database ' + DB_NUOVO, 'postgres');
      sql('grant usage on schema public to anon, authenticated, service_role;', DB_NUOVO); // nessun "alter default privileges"
      const applicaN = f => { const r = psql(null, DB_NUOVO, f); if (r.status !== 0) throw new Error(path.basename(f) + ': ' + r.stderr); return r.stderr; };
      applicaN(path.join(ROOT, 'scripts/db/p0c-schema-base-locale.sql'));
      migrazioni.filter(f => f < '0013').forEach(f => applicaN(path.join(ROOT, 'supabase/migrations', f)));
      // Tabelle create prima del cambiamento: privilegi gia' presenti (come su KHUB Test e Production).
      sql('grant all on all tables in schema public to anon, authenticated, service_role;', DB_NUOVO);
      assert.strictEqual(sql("select count(*) from pg_default_acl", DB_NUOVO), '0', 'nessun privilegio predefinito');
      applicaN(MIG);
      assert.deepStrictEqual(privilegi('service_role', DB_NUOVO), ['SELECT', 'INSERT', 'UPDATE']);
      assert.deepStrictEqual(privilegi('anon', DB_NUOVO), []); assert.deepStrictEqual(privilegi('authenticated', DB_NUOVO), []);
      assert.deepStrictEqual([sql("select relrowsecurity from pg_class where oid='public.ideas'::regclass", DB_NUOVO), sql("select count(*) from pg_policies where tablename='ideas'", DB_NUOVO)], ['t', '0']);
      sql("insert into recipes (id,name,category,department,notes) values ('rN','Bavarese','Dolci','Pasticceria','');" +
        "insert into variants (id,recipe_id,name,label,note,status,active,portions_count,grams_per_portion,steps) values ('vN','rN','Bavarese','Bozza 1','','lab',false,4,200,'[]');", DB_NUOVO);
      const restN = await avviaRest('service_role', false, DB_NUOVO), restPubN = await avviaRest('anon', true, DB_NUOVO);
      const { chiama, stato } = await avviaApp(restN);
      // Il caso del collaudo: appunto creato dalla Console della Preview.
      const c = await chiama({ supabaseAction: 'createIdea', idea: { title: 'Albicocche e rosmarino - Test', sourceType: 'appunto', sourceText: 'Vorrei creare un dessert con albicocche e rosmarino.' } });
      assert.strictEqual(c.ok, true, JSON.stringify(c) + ' ' + stato.log.slice(-300));
      assert.strictEqual(c.idea.status, 'aperta'); assert.strictEqual(c.idea.source_type, 'appunto');
      const id = c.idea.id;
      let l = await chiama({ supabaseAction: 'loadIdeas' }); assert.strictEqual(l.ok, true); assert.deepStrictEqual(l.ideas.map(i => i.id), [id]);
      const n = await chiama({ supabaseAction: 'updateIdeaNotes', id, notes: 'Provare con miele di castagno.' });
      assert.strictEqual(n.ok, true, JSON.stringify(n)); assert.strictEqual(n.idea.notes, 'Provare con miele di castagno.');
      const a = await chiama({ supabaseAction: 'archiveIdea', id }); assert.strictEqual(a.ok, true); assert.strictEqual(a.idea.status, 'archiviata');
      l = await chiama({ supabaseAction: 'loadIdeas' }); assert.deepStrictEqual(l.ideas, [], 'archiviata esclusa dall\'elenco ordinario');
      l = await chiama({ supabaseAction: 'loadIdeas', includeArchived: true }); assert.deepStrictEqual(l.ideas.map(i => [i.id, i.status]), [[id, 'archiviata']], 'archiviata recuperabile');
      assert.strictEqual((await chiama({ supabaseAction: 'updateIdeaNotes', id, notes: 'x' })).code, 'idea_archiviata');
      assert.strictEqual(sql("select notes from ideas where id='" + id + "'", DB_NUOVO), 'Provare con miele di castagno.');
      assert.ok(!/Supabase error \[ideas\]|Idee:/.test(stato.log), 'nessun errore del database: ' + stato.log.slice(-300));
      // service_role non cancella le Idee (privilegio assente) ...
      const del = await fetch(restN + '/ideas?id=eq.' + id, { method: 'DELETE' });
      assert.ok(del.status === 401 || del.status === 403, 'DELETE ' + del.status); assert.ok(/42501/.test(await del.text()));
      assert.strictEqual(sql("select count(*) from ideas", DB_NUOVO), '1');
      // ... ma l'eliminazione di una Scheda collegata dal ruolo del server non e' bloccata (riferimento a NULL).
      sql("update ideas set linked_recipe_id='rN', linked_variant_id='vN' where id='" + id + "'", DB_NUOVO);
      const delR = await fetch(restN + '/recipes?id=eq.rN', { method: 'DELETE' }); assert.ok(delR.status === 204 || delR.status === 200, 'DELETE recipes ' + delR.status + ' ' + await delR.text());
      assert.strictEqual(sql("select coalesce(linked_recipe_id,'NULL')||'/'||coalesce(linked_variant_id,'NULL') from ideas where id='" + id + "'", DB_NUOVO), 'NULL/NULL');
      // anon e authenticated: accesso negato in ogni operazione.
      const nuova = { id: 'idea_esterna01', title: 'X', source_type: 'appunto', source_text: 'x' };
      for (const [nome, token] of [['anon', null], ['authenticated', jwt('authenticated')]]) {
        for (const [m, p, corpo] of [['GET', '/ideas?select=id', null], ['POST', '/ideas', nuova], ['PATCH', '/ideas?id=eq.' + id, { title: 'Y' }], ['DELETE', '/ideas?id=eq.' + id, null]]) {
          const h = { 'Content-Type': 'application/json' }; if (token) h.Authorization = 'Bearer ' + token;
          const r = await fetch(restPubN + p, { method: m, headers: h, body: corpo ? JSON.stringify(corpo) : undefined }); const t = await r.text();
          assert.ok((r.status === 401 || r.status === 403) && /42501|permission denied/i.test(t), nome + ' ' + m + ': ' + r.status + ' ' + t.slice(0, 120));
        }
      }
      assert.strictEqual(sql("select count(*) from ideas", DB_NUOVO), '1');
    });

    await test('B11. tabella gia\' esistente con lo schema previsto: la migrazione ripetuta porta sempre service_role a SELECT, INSERT, UPDATE senza toccare i dati', async () => {
      const dati = () => sql("select md5(string_agg(concat_ws('|',id,title,status,source_type,source_text,notes,created_at,updated_at),'#' order by id)) from ideas", DB_NUOVO);
      const prima = dati();
      for (const [caso, stato] of [
        ['come KHUB Test prima della correzione (nessun privilegio)', 'revoke all on public.ideas from service_role;'],
        ['vecchia 0013 con privilegi predefiniti (ALL, DELETE compreso)', 'grant all on public.ideas to service_role;'],
        ['come KHUB Test dopo la correzione manuale', 'revoke all on public.ideas from service_role; grant select, insert, update on public.ideas to service_role;'],
        ['privilegi parziali (solo SELECT)', 'revoke all on public.ideas from service_role; grant select on public.ideas to service_role;']]) {
        sql(stato, DB_NUOVO);
        const r = psql(null, DB_NUOVO, MIG); assert.strictEqual(r.status, 0, caso + ': ' + r.stderr);
        assert.ok(/gia' presente con le colonne attese/.test(r.stderr), caso + ': tabella riconosciuta come esistente');
        assert.deepStrictEqual(privilegi('service_role', DB_NUOVO), ['SELECT', 'INSERT', 'UPDATE'], caso);
        assert.deepStrictEqual(privilegi('anon', DB_NUOVO), [], caso); assert.deepStrictEqual(privilegi('authenticated', DB_NUOVO), [], caso);
        assert.strictEqual(dati(), prima, caso + ': dati invariati');
      }
      // Anche se anon/authenticated avessero ricevuto privilegi per errore, la migrazione li toglie.
      sql('grant all on public.ideas to anon, authenticated;', DB_NUOVO);
      assert.strictEqual(psql(null, DB_NUOVO, MIG).status, 0);
      assert.deepStrictEqual([privilegi('anon', DB_NUOVO), privilegi('authenticated', DB_NUOVO)], [[], []]);
    });

    // Diagnosi (non asserzioni): permessi effettivi di m2_turns e delle tabelle senza RLS nella REPLICA locale.
    console.log('P2-a.1 — Diagnosi della replica locale (Supabase simulato: privilegi predefiniti ai ruoli dell\'API)');
    const leggi = async (token, tabella) => { const h = token ? { Authorization: 'Bearer ' + token } : {}; const r = await fetch(REST_PUBBLICO + '/' + tabella + '?select=*&limit=1', { headers: h }); return r.status; };
    for (const t of ['m2_turns', 'recipes', 'production_sessions']) {
      const rls = sql(`select relrowsecurity from pg_class where oid='public.${t}'::regclass`), pol = sql(`select coalesce(string_agg(policyname||' ('||array_to_string(roles,',')||', '||cmd||')',' ; '),'-') from pg_policies where tablename='${t}'`);
      console.log(`    ${t}: RLS ${rls === 't' ? 'attivo' : 'non attivo'}; policy: ${pol}; anon lettura HTTP ${await leggi(null, t)}; anon scrittura possibile: ${sql(`select has_table_privilege('anon','public.${t}','INSERT')`)}`);
    }
  } finally {
    figli.forEach(p => { try { p.kill(); } catch (e) { /* no */ } });
    await new Promise(r => setTimeout(r, 300));
    psql('drop database if exists ' + DB + ' with (force)', 'postgres');
    psql('drop database if exists ' + DB + '_nuovo with (force)', 'postgres');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* no */ }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed' + (skipped ? ', ' + skipped + ' skipped' : ''));
  process.exit(failed ? 1 : 0);
})().catch(e => { console.log('ERRORE', e && e.stack || e); process.exit(1); });
