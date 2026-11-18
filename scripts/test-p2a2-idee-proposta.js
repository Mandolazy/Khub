/*
 * Test — P2-a.2, blocco 2d: proposta di Ricetta dalla conversazione (ideaProposal)
 * e migrazione 0015. Server reale nello stesso processo con la sessione di test;
 * PostgreSQL + PostgREST locali con TUTTE le migrazioni; Anthropic SIMULATO
 * (nessuna chiamata AI reale, nessuna rete esterna).
 * Richiede KHUB_PG_TEST e KHUB_POSTGREST_BIN, altrimenti skip.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { spawn, spawnSync, execFileSync } = require('child_process');

const CONN = process.env.KHUB_PG_TEST, BIN = process.env.KHUB_POSTGREST_BIN;
if (!CONN || !BIN) { console.log('P2-a.2 — proposta: KHUB_PG_TEST o KHUB_POSTGREST_BIN non impostati, test non eseguito (skip)\n\n0 passed, 0 failed, 1 skipped'); process.exit(0); }

const ROOT = path.join(__dirname, '..');
const DB = 'khub_p2a2d_' + process.pid;
const parti = Object.fromEntries(CONN.trim().split(/\s+/).map(x => x.split('=')));
const psql = (q, db = DB, file) => spawnSync('psql', [CONN + ' dbname=' + db, '-v', 'ON_ERROR_STOP=1', '-qtA'].concat(file ? ['-f', file] : ['-c', q]), { encoding: 'utf8' });
const sql = (q, db) => { const r = psql(q, db); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
const righe = q => JSON.parse(sql('select coalesce(json_agg(t),\'[]\') from (' + q + ') t'));
const portaLibera = () => new Promise(ok => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const attendi = async (cond, ms, cosa) => { const t0 = Date.now(); while (!(await cond())) { if (Date.now() - t0 > ms) throw new Error('timeout: ' + cosa); await new Promise(r => setTimeout(r, 100)); } };
const sha = t => crypto.createHash('sha256').update(t, 'utf8').digest('hex');
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok - ' + name); } catch (e) { failed++; console.log('  FAIL - ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 8).join('\n    ')); } }

const SB_URL = 'https://khub-test-locale.supabase.co';
process.env.SUPABASE_URL = SB_URL;
process.env.SUPABASE_SECRET_KEY = 'sb_secret_test_locale_proposta_idee';
process.env.ANTHROPIC_API_KEY = 'chiave-anthropic-finta-solo-test-0000';
const FETCH_ORIGINALE = globalThis.fetch;
const IA = { modo: 'ok', testo: null, chiamate: [] };
const proposta = obj => JSON.stringify(obj);
const SCENARIO = { pronta: true, titolo: 'Semifreddo albicocche, rosmarino e noci', resa: { qty: 6, unit: 'porzioni', origine: 'chef', evidenza: 'per 6 persone' },
  ingredienti: [
    { nome: 'Albicocche', qty: 500, unit: 'g', qtyKind: 'certa', origine: 'chef', evidenza: 'userei 500 g di albicocche' },
    { nome: 'Panna fresca', qty: 250, unit: 'g', qtyKind: 'certa', origine: 'ai', evidenza: null },
    { nome: 'Noci', qty: 60, unit: 'grammi', qtyKind: 'certa', origine: 'chef', evidenza: '60 g di noci' }, // falso: lo chef non l'ha detto
    { nome: 'Zucchero', qty: 80, unit: 'g', qtyKind: 'certa', origine: 'chef', evidenza: 'userei 500 g di albicocche' }, // numero diverso
    { nome: 'Rosmarino', qtyKind: 'variabile', origine: 'ai' },
    { nome: 'Miele', qtyKind: 'intervallo', qtyMin: 20, qtyMax: 30, unit: 'g', origine: 'ai' },
    { nome: 'Burro', qty: 0, unit: 'g', qtyKind: 'certa', origine: 'ai' }, // non coerente
    { nome: '<b>Vaniglia</b>', qty: 1, unit: 'baccello', qtyKind: 'certa', origine: 'ai' }],
  passi: ['Cuocere le albicocche.', 'Montare la panna.', '   ', 'Unire le noci e congelare.'],
  scartate: ['muffin (rifiutati)', 'mandorle (sostituite dalle noci)'], note: null };
globalThis.fetch = async (url, o = {}) => {
  const u = String(url);
  if (u === 'https://api.anthropic.com/v1/messages') {
    const body = JSON.parse(o.body); IA.chiamate.push(body);
    if (IA.modo === 'errore') return { ok: false, status: 529, json: async () => ({ type: 'error', error: { type: 'overloaded_error' } }) };
    const t = /PREPARARE LA RICETTA/.test(body.system) ? (IA.testo != null ? IA.testo : proposta(SCENARIO)) : 'Risposta della conversazione';
    return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: t }] }) };
  }
  if (u.startsWith(SB_URL + '/rest/v1/')) {
    const h = Object.assign({}, o.headers || {}); Object.keys(h).forEach(k => { if (/^(apikey|authorization)$/i.test(k)) delete h[k]; });
    return FETCH_ORIGINALE(REST + u.slice((SB_URL + '/rest/v1').length), Object.assign({}, o, { headers: h }));
  }
  throw new Error('rete esterna vietata nel test: ' + u.split('?')[0]);
};
let REST = null;
const LOG = [];
for (const k of ['log', 'error', 'warn']) { const orig = console[k]; console[k] = (...a) => { LOG.push(a.map(String).join(' ')); if (k === 'log') orig(...a); }; }
const caricaHandler = async etichetta => (await import('data:text/javascript;base64,' + Buffer.from(fs.readFileSync(path.join(ROOT, 'api/chat.js'), 'utf8') + '\n// ' + etichetta).toString('base64'))).default;
const chiamaCon = h => async (body, headers) => { let st = 200, out; await h({ method: 'POST', headers: headers || {}, body: JSON.parse(JSON.stringify(body)) }, { status(c) { st = c; return this; }, json(o) { out = o; return this; }, setHeader() { return this; }, end() { return this; } }); return Object.assign({ st }, out || {}); };

const figli = []; let tmp;
(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'khub-p2a2d-'));
  try {
    sql("do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;" +
      " if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;" +
      " if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if; end $$;", 'postgres');
    sql('drop database if exists ' + DB, 'postgres'); sql('create database ' + DB, 'postgres');
    sql('grant usage on schema public to anon, authenticated, service_role;');
    const applica = f => { const r = psql(null, DB, f); if (r.status !== 0) throw new Error(path.basename(f) + ': ' + r.stderr); return r.stderr; };
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
    const porta = await portaLibera();
    const uri = 'postgres://' + (parti.user || 'postgres') + '@/' + DB + '?host=' + encodeURIComponent(parti.host || '/tmp') + '&port=' + (parti.port || 5432);
    fs.writeFileSync(path.join(tmp, 'p.conf'), `db-uri = "${uri}"\ndb-schemas = "public"\ndb-anon-role = "service_role"\nserver-host = "127.0.0.1"\nserver-port = ${porta}\n`);
    figli.push(spawn(BIN, [path.join(tmp, 'p.conf')], { stdio: 'ignore' })); REST = 'http://127.0.0.1:' + porta;
    await attendi(async () => { try { return (await FETCH_ORIGINALE(REST + '/')).ok; } catch (e) { return false; } }, 15000, 'PostgREST');
    console.log('P2-a.2 blocco 2d — proposta su PostgreSQL ' + sql('show server_version').split(' ')[0] + ' (migrazioni ' + migrazioni.map(f => f.slice(0, 4)).join(', ') + ')');

    const nudo = await caricaHandler('p2a2d');
    const api = chiamaCon(await require('./_khub-test-session').withTestSession(nudo));
    const senza = chiamaCon(nudo);
    const crea = async (titolo, extra) => { const r = await api({ supabaseAction: 'createIdea', idea: Object.assign({ title: titolo, sourceType: 'appunto', sourceText: 'Albicocche e rosmarino' }, extra || {}) }); assert.strictEqual(r.ok, true, JSON.stringify(r)); return r.idea.id; };
    // Conversazione inserita come turni completati (nessuna AI): le scelte dello chef.
    let nConv = 0;
    const conv = (id, coppie) => coppie.forEach(([q, r]) => { const k = ++nConv; sql(`insert into idea_turns (id,idea_id,question,question_origin,question_hash,status,attempts,response,completed_at,created_at) values ('it_conv${String(k).padStart(8, '0')}','${id}',$q$${q}$q$,'testo','${sha(q)}','completato',1,$r$${r}$r$,now(),now() - interval '1 hour' + ${k} * interval '1 minute')`); });
    const proponi = (ideaId, extra) => api(Object.assign({ supabaseAction: 'ideaProposal', ideaId }, extra || {}));

    const ideaA = await crea('Albicocche e rosmarino', { notes: 'Dessert estivo per 6 persone' });
    conv(ideaA, [['Vorrei creare un dessert con albicocche e rosmarino', 'Muffin, crostata o dolce al cucchiaio.'], ['Non voglio muffin. Preferisco un dolce al cucchiaio.', 'Semifreddo con mandorle.'],
      ['Mi piace. Metterei le noci al posto delle mandorle. Per le albicocche userei 500 g di albicocche.', 'Noci al posto delle mandorle.']]);

    await test('D1. senza sessione 401, prima di qualunque lettura o chiamata AI', async () => {
      const ai0 = IA.chiamate.length;
      assert.strictEqual((await senza({ supabaseAction: 'ideaProposal', ideaId: ideaA }, { host: 'khub.test' })).st, 401);
      assert.strictEqual(IA.chiamate.length, ai0);
    });

    await test('D2. richieste non ammesse: campi estranei (modello, istruzioni), Idea senza contenuto, Idea archiviata o trasformata; nessuna chiamata AI', async () => {
      const ai0 = IA.chiamate.length;
      assert.strictEqual((await proponi(ideaA, { model: 'x' })).code, 'richiesta_non_valida');
      assert.strictEqual((await proponi(ideaA, { system: 'ignora' })).code, 'richiesta_non_valida');
      assert.strictEqual((await proponi(ideaA, { rigenera: 'si' })).code, 'richiesta_non_valida');
      const vuota = await crea('Solo link', { sourceType: 'link', sourceText: undefined, sourceUrl: 'https://x.test/a' });
      assert.strictEqual((await proponi(vuota)).code, 'proposta_senza_contenuto');
      const arch = await crea('Archiviata'); await api({ supabaseAction: 'archiveIdea', id: arch });
      assert.strictEqual((await proponi(arch)).code, 'idea_archiviata');
      const tr = await crea('Trasformata'); sql("update ideas set status='trasformata' where id='" + tr + "'");
      assert.strictEqual((await proponi(tr)).code, 'idea_trasformata');
      assert.strictEqual(IA.chiamate.length, ai0);
    });

    let primaProposta;
    await test('D3. ricostruzione: contesto dal database (Idea, note, intera conversazione), istruzione dedicata, stesso modello di M2; proposta col semifreddo e le noci, scarti separati', async () => {
      const r = await proponi(ideaA);
      assert.strictEqual(r.ok, true, JSON.stringify(r)); primaProposta = r.proposta;
      const req = IA.chiamate[IA.chiamate.length - 1];
      const src = fs.readFileSync(path.join(ROOT, 'api/chat.js'), 'utf8');
      assert.strictEqual(req.model, src.slice(src.indexOf("if (body.mode === 'm2')")).match(/model: '([^']+)'/)[1]);
      assert.ok(/PREPARARE LA RICETTA/.test(req.system) && /Non attribuire mai allo chef una quantita'/.test(req.system) && /scartate/.test(req.system) && /"pronta": false/.test(req.system));
      assert.ok(!/===M2_UPDATE===/.test(req.system));
      const c = req.messages[0].content;
      for (const x of ['IDEA: Albicocche e rosmarino', 'Dessert estivo per 6 persone', 'CHEF: Non voglio muffin', 'CHEF: Mi piace. Metterei le noci', 'MICHELINAI: Semifreddo con mandorle.']) assert.ok(c.includes(x), x);
      assert.ok(c.indexOf('Non voglio muffin') < c.indexOf('Metterei le noci'), 'ordine cronologico');
      assert.strictEqual(r.proposta.nome, 'Semifreddo albicocche, rosmarino e noci');
      const nomi = r.proposta.ingredienti.map(i => i.nome);
      assert.ok(nomi.includes('Noci') && !nomi.some(n => /mandorl|muffin/i.test(n)), 'scarti fuori dagli ingredienti');
      assert.deepStrictEqual(r.proposta.scartate, ['muffin (rifiutati)', 'mandorle (sostituite dalle noci)']);
      assert.deepStrictEqual(r.proposta.passi, ['Cuocere le albicocche.', 'Montare la panna.', 'Unire le noci e congelare.'], 'passaggi vuoti tolti');
      assert.deepStrictEqual([r.salvata, r.riutilizzata], [true, false]);
    });

    await test('D4. provenienza verificata sul testo reale: «dello chef» solo con le sue parole e lo stesso numero; altrimenti proposta di MichelinAI; quantita\' incoerenti diventano «da indicare»', async () => {
      const ing = Object.fromEntries(primaProposta.ingredienti.map(i => [i.nome, i]));
      assert.deepStrictEqual([ing.Albicocche.origine, ing.Albicocche.evidenza, ing.Albicocche.qty], ['chef', 'userei 500 g di albicocche', 500]);
      assert.deepStrictEqual([ing.Noci.origine, ing.Noci.evidenza, ing.Noci.unit], ['ai', null, 'g'], 'evidenza inventata declassata; unita\' normalizzata');
      assert.deepStrictEqual([ing.Zucchero.origine, ing.Zucchero.qty], ['ai', 80], 'evidenza vera ma numero diverso');
      assert.deepStrictEqual([ing['Panna fresca'].origine], ['ai']);
      assert.deepStrictEqual([ing.Rosmarino.qtyKind, ing.Rosmarino.qty, ing.Rosmarino.origine], ['variabile', null, null], 'q.b. senza quantita\' ne\' provenienza');
      assert.deepStrictEqual([ing.Miele.qtyKind, ing.Miele.qtyMin, ing.Miele.qtyMax, ing.Miele.origine], ['intervallo', 20, 30, 'ai']);
      assert.deepStrictEqual([ing.Burro.qtyKind, ing.Burro.qty, ing.Burro.nonCoerente], ['mancante', null, true]);
      assert.strictEqual(ing['<b>Vaniglia</b>'].unit, 'baccello', 'unita\' della fonte conservata (testo, non HTML)');
      assert.deepStrictEqual(primaProposta.resa, { qty: 6, unit: 'porzioni', origine: 'chef', evidenza: 'per 6 persone' }, 'resa dalle note dello chef');
      // Fonte: un'Idea di tipo testo, con il passo davvero nel testo.
      const t = await crea('Da testo', { sourceType: 'testo', sourceText: 'Crema: 200 g di panna, 3 tuorli.' });
      IA.testo = proposta({ pronta: true, titolo: 'Crema', ingredienti: [{ nome: 'Panna', qty: 200, unit: 'g', qtyKind: 'certa', origine: 'fonte', evidenza: '200 g di panna' },
        { nome: 'Tuorli', qty: 4, unit: 'n', qtyKind: 'certa', origine: 'fonte', evidenza: '3 tuorli' }, { nome: 'Zucchero', qty: 50, unit: 'g', qtyKind: 'certa', origine: 'fonte', evidenza: '50 g di zucchero' }], passi: ['Cuocere.'], scartate: [] });
      const r = await proponi(t); IA.testo = null;
      assert.deepStrictEqual(r.proposta.ingredienti.map(i => i.origine), ['fonte', 'ai', 'ai']);
    });

    await test('D5. la proposta e\' conservata nell\'Idea (origine ai, anche per un appunto grazie alla 0015) e riaperta senza nuova chiamata AI se nulla e\' cambiato; nuova conversazione o «rigenera» = nuova proposta', async () => {
      const row = righe("select preview_origin, preview->>'tipo' as tipo, preview->>'nome' as nome, source_type from ideas where id='" + ideaA + "'")[0];
      assert.deepStrictEqual(row, { preview_origin: 'ai', tipo: 'proposta_michelinai', nome: 'Semifreddo albicocche, rosmarino e noci', source_type: 'appunto' });
      const ai0 = IA.chiamate.length;
      const r = await proponi(ideaA); assert.deepStrictEqual([r.ok, r.riutilizzata, IA.chiamate.length - ai0], [true, true, 0]);
      conv(ideaA, [['Aggiungerei un po\' di miele', 'Va bene, un filo di miele.']]); // nuovo scambio
      const r2 = await proponi(ideaA); assert.deepStrictEqual([r2.riutilizzata, IA.chiamate.length - ai0], [false, 1]);
      const r3 = await proponi(ideaA, { rigenera: true }); assert.deepStrictEqual([r3.riutilizzata, IA.chiamate.length - ai0], [false, 2]);
      assert.strictEqual(sql("select jsonb_array_length(preview->'base'->'generazioni') from ideas where id='" + ideaA + "'"), '3');
    });

    await test('D6. MichelinAI chiede un chiarimento: nessuna proposta, nessun salvataggio; risposte non utilizzabili rifiutate; errore dell\'AI senza effetti', async () => {
      const id = await crea('Ambigua'); conv(id, [['Qualcosa con le pere', 'Torta o sorbetto?']]);
      IA.testo = proposta({ pronta: false, domanda: 'Preferisci la torta o il sorbetto?' });
      const r = await proponi(id); assert.deepStrictEqual([r.ok, r.proposta, r.domanda], [true, null, 'Preferisci la torta o il sorbetto?']);
      for (const t of ['non e\' JSON', '{"pronta":true,"titolo":"X","ingredienti":[]}', '{"pronta":true,"ingredienti":[{"nome":"a"}]}', '```json\n{"pronta":"forse"}\n```']) {
        IA.testo = t; assert.strictEqual((await proponi(id)).code, 'risposta_non_valida', t);
      }
      IA.testo = '```json\n' + proposta({ pronta: true, titolo: 'Sorbetto', ingredienti: [{ nome: 'Pere', qty: 1, unit: 'kg', qtyKind: 'certa', origine: 'ai' }], passi: [] }) + '\n```';
      assert.strictEqual((await proponi(id)).ok, true, 'JSON in un blocco di codice accettato');
      sql("update ideas set preview = null, preview_origin = null where id='" + id + "'");
      IA.testo = null; IA.modo = 'errore';
      assert.strictEqual((await proponi(id)).code, 'ai_non_disponibile'); IA.modo = 'ok';
      assert.strictEqual(sql("select preview is null from ideas where id='" + id + "'"), 't');
    });

    await test('D7. senza la 0015 (vincolo della 0013) un appunto non puo\' conservare la proposta: la proposta arriva comunque allo chef con salvata=false; un\'anteprima strutturata non si sovrascrive', async () => {
      // Vincolo della 0013 ripristinato solo per le nuove scritture (NOT VALID): le righe gia' presenti restano.
      sql("alter table ideas drop constraint ideas_appunto_chk; alter table ideas add constraint ideas_appunto_chk check (source_type <> 'appunto' or (source_url is null and preview is null)) not valid");
      const id = await crea('Prima della 0015'); conv(id, [['Un sorbetto al limone', 'Ottimo.']]);
      const r = await proponi(id); assert.deepStrictEqual([r.ok, r.salvata], [true, false]);
      assert.strictEqual(sql("select preview is null from ideas where id='" + id + "'"), 't');
      applica(path.join(ROOT, 'supabase/migrations/0015_ideas_appunto_proposta.sql')); // riapplicata: idempotente
      const l = await crea('Con anteprima strutturata', { sourceType: 'link', sourceText: undefined, sourceUrl: 'https://x.test/r', preview: { name: 'Torta', ingredients: [{ name: 'farina', qty: 200, unit: 'g', qtyKind: 'certa' }], steps: ['Impastare.'] }, previewOrigin: 'strutturata' });
      conv(l, [['Facciamola senza glutine', 'Va bene.']]);
      const r2 = await proponi(l); assert.deepStrictEqual([r2.ok, r2.salvata], [true, false]);
      assert.strictEqual(sql("select preview_origin from ideas where id='" + l + "'"), 'strutturata');
    });

    await test('D8. nessuna Ricetta, Scheda o Sessione creata; conversazione intatta; log senza credenziali ne\' testi dello chef', async () => {
      assert.strictEqual(sommaRicette(), sommaIniziale);
      assert.strictEqual(sql('select count(*) from recipes'), '1');
      assert.strictEqual(sql("select count(*) from idea_turns where idea_id='" + ideaA + "' and status='completato'"), '4');
      const tutto = LOG.join('\n');
      for (const x of [process.env.ANTHROPIC_API_KEY, process.env.SUPABASE_SECRET_KEY, 'Non voglio muffin', 'userei 500 g']) assert.ok(!tutto.includes(x), x);
    });

    await test('D9. M1 e M2 del LAB invariati rispetto a 3d0a1ba; la conversazione continua a usare la sua istruzione', async () => {
      const prima = execFileSync('git', ['show', '3d0a1ba6a4ee85107a22f5ebcaffea30ec083381:api/chat.js'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1e8 });
      const ora = fs.readFileSync(path.join(ROOT, 'api/chat.js'), 'utf8');
      const pezzi = s => [s.match(/const M1_SYSTEM_PROMPT = `[\s\S]*?`;/)[0], s.match(/const M2_SYSTEM_PROMPT = `[\s\S]*?`;/)[0], s.match(/const IDEA_SYSTEM_PROMPT = `[\s\S]*?`;/)[0],
        s.match(/function buildM2UserMessage\(body\) \{[\s\S]*?\n\}/)[0], s.slice(s.indexOf("    if (body.mode === 'm1') {"), s.indexOf('    // Proxy Anthropic legacy'))];
      const a = pezzi(prima), b = pezzi(ora);
      ['M1', 'M2', 'istruzione della conversazione', 'messaggio M2', 'rami m1/m2'].forEach((n, i) => assert.strictEqual(sha(b[i]), sha(a[i]), n + ' invariato'));
      const id = await crea('Chat'); const r = await api({ supabaseAction: 'ideaChat', ideaId: id, turnId: 'it_chatprova0001', message: 'ciao' });
      assert.strictEqual(r.ok, true); assert.ok(/fase di IDEAZIONE/.test(IA.chiamate[IA.chiamate.length - 1].system) && IA.chiamate[IA.chiamate.length - 1].max_tokens === 1500);
    });

    await test('D10. migrazione 0015: idempotente; appunti con proposta solo di origine ai; rollback fermato se esistono appunti con proposta, eseguito senza', async () => {
      const r1 = psql(null, DB, path.join(ROOT, 'supabase/migrations/0015_ideas_appunto_proposta.sql')); assert.strictEqual(r1.status, 0, r1.stderr);
      const ko = psql("insert into ideas (id,title,source_type,source_text,preview,preview_origin) values ('idea_strutturata01','T','appunto','a','{}','strutturata')");
      assert.notStrictEqual(ko.status, 0, 'un appunto non accetta un\'anteprima strutturata');
      sql("insert into ideas (id,title,source_type,source_text,preview,preview_origin) values ('idea_conproposta01','T','appunto','a','{}','ai')");
      const RB = path.join(ROOT, 'supabase/rollback/PREPARED_NOT_EXECUTED__0015_ideas_appunto_proposta_rollback.sql');
      const r2 = psql(null, DB, RB); assert.notStrictEqual(r2.status, 0); assert.ok(/Rollback 0015 fermato/.test(r2.stderr), r2.stderr);
      sql("update ideas set preview = null, preview_origin = null where source_type = 'appunto'");
      const r3 = psql(null, DB, RB); assert.strictEqual(r3.status, 0, r3.stderr);
      assert.notStrictEqual(psql("update ideas set preview='{}', preview_origin='ai' where id='idea_conproposta01'").status, 0, 'vincolo della 0013 ripristinato');
    });
  } catch (e) {
    failed++; console.log('ERRORE', e && e.stack || e);
  } finally {
    globalThis.fetch = FETCH_ORIGINALE;
    figli.forEach(p => { try { p.kill(); } catch (e) { /* no */ } });
    await new Promise(r => setTimeout(r, 300));
    psql('drop database if exists ' + DB + ' with (force)', 'postgres');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* no */ }
  }
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
