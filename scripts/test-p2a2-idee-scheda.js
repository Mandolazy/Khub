/*
 * Test — P2-a.2, blocco 2e: dalla proposta alla Bozza (linkIdeaToRecipe), salvataggio
 * con il normale sistema delle Schede senza duplicati, una sola proposta alla volta
 * (migrazione 0016). Server reale nello stesso processo con la sessione di test;
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
if (!CONN || !BIN) { console.log('P2-a.2 — Scheda da Idea: KHUB_PG_TEST o KHUB_POSTGREST_BIN non impostati, test non eseguito (skip)\n\n0 passed, 0 failed, 1 skipped'); process.exit(0); }

const ROOT = path.join(__dirname, '..');
const DB = 'khub_p2a2e_' + process.pid;
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
process.env.SUPABASE_SECRET_KEY = 'sb_secret_test_locale_scheda_idee';
process.env.ANTHROPIC_API_KEY = 'chiave-anthropic-finta-solo-test-0000';
const FETCH_ORIGINALE = globalThis.fetch;
const IA = { modo: 'ok', testo: null, chiamate: [], ritardo: 0 };
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
    if (IA.ritardo) await new Promise(r => setTimeout(r, IA.ritardo));
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
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'khub-p2a2e-'));
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
    console.log('P2-a.2 blocco 2e — Scheda da Idea su PostgreSQL ' + sql('show server_version').split(' ')[0] + ' (migrazioni ' + migrazioni.map(f => f.slice(0, 4)).join(', ') + ')');

    const nudo = await caricaHandler('p2a2e');
    const api = chiamaCon(await require('./_khub-test-session').withTestSession(nudo));
    const senza = chiamaCon(nudo);
    const crea = async (titolo, extra) => { const r = await api({ supabaseAction: 'createIdea', idea: Object.assign({ title: titolo, sourceType: 'appunto', sourceText: 'Albicocche e rosmarino' }, extra || {}) }); assert.strictEqual(r.ok, true, JSON.stringify(r)); return r.idea.id; };
    let nConv = 0;
    const conv = (id, coppie) => coppie.forEach(([q, r]) => { const k = ++nConv; sql(`insert into idea_turns (id,idea_id,question,question_origin,question_hash,status,attempts,response,completed_at,created_at) values ('it_conv${String(k).padStart(8, '0')}','${id}',$q$${q}$q$,'testo','${sha(q)}','completato',1,$r$${r}$r$,now(),now() - interval '1 hour' + ${k} * interval '1 minute')`); });
    const proponi = (ideaId, extra) => api(Object.assign({ supabaseAction: 'ideaProposal', ideaId }, extra || {}));
    const collega = (ideaId, recipeId, variantId, extra) => api(Object.assign({ supabaseAction: 'linkIdeaToRecipe', ideaId, recipeId, variantId }, extra || {}));
    // Stesso formato di saveToSupabase (pagina): Scheda, Bozza 'lab', ingredienti con i tipi di quantita'.
    const ing = (id, vId, name, qty, unit, kind, k, src) => ({ id, variant_id: vId, name, qty: kind === 'certa' ? qty : 0, unit: unit || 'g', qty_kind: kind, qty_min: null, qty_max: null, source_text: src || null, is_sub_recipe: false, sub_recipe_id: null, sort_order: k, estimated_yield_pct: null, measured_yield_pct: null });
    const bozza = (id, rId, nome) => ({ id, recipe_id: rId, name: nome, label: nome, note: "Dall'Idea", status: 'lab', portions_count: 6, grams_per_portion: 0, portion_unit: 'g', steps: JSON.stringify(['Cuocere.', 'Montare.']), steps_v2: null, media_url: null, video_url: null, primo_consulto: null, m1_reading_text: null, origin_variant_id: null, active: false, intention_initial: null, intention_current: null, criteria_initial: null, criteria_current: null });
    const salva = (rId, nome, variants, ingredients) => api({ supabaseAction: 'save', data: { recipe: { id: rId, name: nome, category: 'Dolci', department: 'Cucina', media_url: null, video_url: null, notes: '' }, variants, ingredients, deletedIngredients: [], l2Items: [], l3Items: [] } });
    const conteggi = () => sql("select (select count(*) from recipes)||'/'||(select count(*) from variants)||'/'||(select count(*) from ingredients)");
    const turni = id => sql("select md5(string_agg(concat_ws('|',id,question,response,status),'#' order by id)) from idea_turns where idea_id='" + id + "'");

    const ideaA = await crea('Albicocche e rosmarino', { notes: 'Dessert per 6' });
    conv(ideaA, [['Vorrei un semifreddo con albicocche', 'Semifreddo con noci.'], ['Userei 500 g di albicocche', 'Perfetto.']]);
    sql("update ideas set preview='{\"tipo\":\"proposta_michelinai\"}', preview_origin='ai' where id='" + ideaA + "'");
    const turniA = turni(ideaA);

    await test('S1. linkIdeaToRecipe: senza sessione 401, nessuna lettura ne\' scrittura', async () => {
      assert.strictEqual((await senza({ supabaseAction: 'linkIdeaToRecipe', ideaId: ideaA, recipeId: 'rX', variantId: 'lvX' }, { host: 'khub.test' })).st, 401);
      assert.strictEqual(sql("select status from ideas where id='" + ideaA + "'"), 'aperta');
    });

    await test('S2. richieste non ammesse: campi estranei, id non validi, Ricetta non salvata, Bozza di un\'altra Scheda, variante non in LAB; l\'Idea resta aperta', async () => {
      assert.strictEqual((await collega(ideaA, 'rX', 'lvX', { status: 'trasformata' })).code, 'richiesta_non_valida');
      assert.strictEqual((await collega(ideaA, '', 'lvX')).code, 'richiesta_non_valida');
      assert.strictEqual((await collega(ideaA, 'rX', 'x'.repeat(201))).code, 'richiesta_non_valida');
      assert.strictEqual((await collega('idea_inesistente01', 'rX', 'lvX')).ok, false);
      const nt = await collega(ideaA, 'rNonSalvata', 'lvNonSalvata');
      assert.strictEqual(nt.code, 'ricetta_non_trovata'); assert.strictEqual(nt.retry, true);
      assert.strictEqual((await collega(ideaA, 'rAltra', 'vA')).code, 'ricetta_non_valida', 'Bozza di un\'altra Scheda');
      sql("insert into variants (id,recipe_id,name,label,note,status,active,steps) values ('vValidata','rA','Crema','Ricetta','','validated',true,'[]')");
      assert.strictEqual((await collega(ideaA, 'rA', 'vValidata')).code, 'ricetta_non_valida', 'una Ricetta attiva non e\' una Bozza');
      assert.strictEqual(sql("select status||'|'||coalesce(linked_recipe_id,'-') from ideas where id='" + ideaA + "'"), 'aperta|-');
    });

    const c0 = conteggi();
    await test('S3. nuova Scheda: salvataggio col normale sistema delle Schede, poi collegamento; Idea trasformata con gli id; conversazione e proposta conservate', async () => {
      const rN = 'r1731000000001', vN = 'lv1731000000001';
      const r = await salva(rN, 'Semifreddo albicocche', [bozza(vN, rN, 'Semifreddo albicocche')],
        [ing(vN + '_1', vN, 'Albicocche', 500, 'g', 'certa', 0, 'Userei 500 g di albicocche'), ing(vN + '_2', vN, 'Panna', null, 'g', 'mancante', 1, 'Proposta di MichelinAI, non confermata: 250 g')]);
      assert.strictEqual(r.ok, true, JSON.stringify(r));
      const l = await collega(ideaA, rN, vN);
      assert.strictEqual(l.ok, true, JSON.stringify(l));
      assert.strictEqual(l.idea.status, 'trasformata'); assert.strictEqual(l.idea.linked_recipe_id, rN); assert.strictEqual(l.idea.linked_variant_id, vN);
      assert.ok(!('preview' in l.idea) || l.idea.preview); // forma pubblica dell'Idea
      assert.strictEqual(sql("select status||'|'||linked_recipe_id||'|'||linked_variant_id||'|'||(preview->>'tipo') from ideas where id='" + ideaA + "'"), 'trasformata|' + rN + '|' + vN + '|proposta_michelinai');
      assert.strictEqual(turni(ideaA), turniA, 'conversazione intatta');
      assert.strictEqual(sql("select qty_kind||'|'||source_text from ingredients where id='" + vN + "_2'"), 'mancante|Proposta di MichelinAI, non confermata: 250 g', 'quantita\' non confermata salvata da indicare');
      assert.strictEqual(sql("select status||'|'||active from variants where id='" + vN + "'"), 'lab|false');
    });

    await test('S4. ripetizioni: salvataggio ripetuto con gli stessi id = stesse righe (nessun duplicato); collegamento ripetuto = ok; un\'altra Ricetta = rifiutata', async () => {
      const prima = conteggi();
      const rN = 'r1731000000001', vN = 'lv1731000000001';
      for (let k = 0; k < 2; k++) {
        const r = await salva(rN, 'Semifreddo albicocche', [bozza(vN, rN, 'Semifreddo albicocche')],
          [ing(vN + '_1', vN, 'Albicocche', 500, 'g', 'certa', 0, 'Userei 500 g di albicocche'), ing(vN + '_2', vN, 'Panna', null, 'g', 'mancante', 1, 'Proposta di MichelinAI, non confermata: 250 g')]);
        assert.strictEqual(r.ok, true);
      }
      assert.strictEqual(conteggi(), prima, 'nessuna riga in piu\'');
      const ancora = await collega(ideaA, rN, vN);
      assert.strictEqual(ancora.ok, true); assert.strictEqual(ancora.ripetuto, true); assert.strictEqual(ancora.idea.linked_variant_id, vN);
      assert.strictEqual((await collega(ideaA, 'rA', 'vA')).code, 'idea_gia_trasformata');
      assert.strictEqual(sql("select linked_recipe_id from ideas where id='" + ideaA + "'"), rN);
      const [, nv] = c0.split('/'); assert.strictEqual(Number(conteggi().split('/')[1]), Number(nv) + 1, 'una sola Bozza in piu\' dall\'inizio');
    });

    await test('S5. Scheda esistente: nuova Bozza aggiunta, Ricetta attiva e Bozze esistenti invariate; collegamento alla Bozza nuova', async () => {
      const ideaB = await crea('Crema al rosmarino');
      const attiva = () => sql("select md5(string_agg(concat_ws('|',v.id,v.status,v.active,v.name,v.portions_count,i.id,i.qty,i.unit),'#' order by v.id,i.id)) from variants v left join ingredients i on i.variant_id=v.id where v.recipe_id='rA' and v.id in ('vA','vValidata')");
      const a0 = attiva();
      const vB = 'lv1731000000002';
      // Come saveToSupabase per una Scheda esistente: tutte le Bozze della Scheda, Ricette attive invariate non inviate.
      const r = await salva('rA', 'Crema pasticcera', [bozza('vA', 'rA', 'Crema'), bozza(vB, 'rA', 'Crema al rosmarino')].map(v => v.id === 'vA' ? Object.assign(v, { label: 'Bozza 1', note: '', portions_count: 4, grams_per_portion: 200, steps: '["Scaldare."]' }) : v),
        [ing('ingA1', 'vA', 'Latte', 500, 'ml', 'certa', 0), ing(vB + '_1', vB, 'Rosmarino', null, null, 'variabile', 0)]);
      assert.strictEqual(r.ok, true, JSON.stringify(r));
      assert.strictEqual(attiva(), a0, 'Ricetta attiva e Bozza esistente invariate');
      const l = await collega(ideaB, 'rA', vB);
      assert.strictEqual(l.ok, true, JSON.stringify(l)); assert.strictEqual(l.idea.linked_recipe_id, 'rA');
      assert.strictEqual(sql("select count(*) from variants where recipe_id='rA'"), '3');
    });

    await test('S6. Idea archiviata: collegamento rifiutato, nessuna modifica', async () => {
      const ideaC = await crea('Archiviata'); await api({ supabaseAction: 'archiveIdea', id: ideaC });
      assert.strictEqual((await collega(ideaC, 'r1731000000001', 'lv1731000000001')).code, 'idea_archiviata');
      assert.strictEqual(sql("select status||'|'||coalesce(linked_recipe_id,'-') from ideas where id='" + ideaC + "'"), 'archiviata|-');
    });

    await test('S7. una sola proposta alla volta: due richieste simultanee della stessa Idea = una chiamata AI, la seconda riceve proposta_in_corso; prenotazione rilasciata (anche dopo un errore AI)', async () => {
      const ideaD = await crea('Due schede del browser');
      conv(ideaD, [['Vorrei un semifreddo con albicocche', 'Semifreddo con noci.']]);
      IA.testo = JSON.stringify({ pronta: true, titolo: 'Semifreddo', resa: null, ingredienti: [{ nome: 'Albicocche', qtyKind: 'variabile', origine: 'ai' }], passi: ['Unire.'], scartate: [], note: null });
      IA.ritardo = 400;
      const ai0 = IA.chiamate.length;
      const [a, b] = await Promise.all([proponi(ideaD, { rigenera: true }), proponi(ideaD, { rigenera: true })]);
      IA.ritardo = 0;
      const esiti = [a, b].map(x => x.ok ? 'ok' : x.code).sort();
      assert.deepStrictEqual(esiti, ['ok', 'proposta_in_corso'], JSON.stringify([a, b]));
      assert.strictEqual(IA.chiamate.length, ai0 + 1, 'una sola chiamata AI');
      assert.strictEqual([a, b].find(x => !x.ok).retry, true);
      assert.ok(new Date(sql("select started_at from idea_proposal_locks where idea_id='" + ideaD + "'")).getTime() < Date.parse('2000-01-01'), 'prenotazione rilasciata');
      const r2 = await proponi(ideaD, { rigenera: true }); assert.strictEqual(r2.ok, true, 'dopo il rilascio si rigenera');
      IA.modo = 'errore';
      assert.strictEqual((await proponi(ideaD, { rigenera: true })).ok, false);
      IA.modo = 'ok';
      assert.ok(new Date(sql("select started_at from idea_proposal_locks where idea_id='" + ideaD + "'")).getTime() < Date.parse('2000-01-01'), 'rilasciata anche dopo un errore AI');
      // Prenotazione scaduta (funzione interrotta): si riprende; non scaduta: blocca.
      sql("update idea_proposal_locks set started_at = now() - interval '10 minutes' where idea_id='" + ideaD + "'");
      assert.strictEqual((await proponi(ideaD, { rigenera: true })).ok, true, 'scaduta = ripresa');
      sql("update idea_proposal_locks set started_at = now() where idea_id='" + ideaD + "'");
      const ai1 = IA.chiamate.length;
      assert.strictEqual((await proponi(ideaD, { rigenera: true })).code, 'proposta_in_corso');
      assert.strictEqual(IA.chiamate.length, ai1, 'nessuna chiamata AI con una prenotazione attiva');
      sql("update idea_proposal_locks set started_at = '1970-01-01' where idea_id='" + ideaD + "'");
      // La riapertura della proposta salvata (stessa impronta) non passa dalla prenotazione.
      sql("update idea_proposal_locks set started_at = now() where idea_id='" + ideaD + "'");
      const riaperta = await proponi(ideaD);
      assert.strictEqual(riaperta.ok, true); assert.strictEqual(riaperta.riutilizzata, true);
      sql("update idea_proposal_locks set started_at = '1970-01-01' where idea_id='" + ideaD + "'");
      IA.testo = null;
    });

    await test('S8. senza la 0016 (tabella assente) la proposta funziona come nel blocco 2d, senza errori nei log', async () => {
      const ideaE = await crea('Senza 0016');
      conv(ideaE, [['Vorrei un semifreddo con albicocche', 'Semifreddo con noci.']]);
      sql('drop table idea_proposal_locks'); sql("notify pgrst, 'reload schema'"); await new Promise(r => setTimeout(r, 600));
      const l0 = LOG.length;
      const r = await proponi(ideaE);
      assert.strictEqual(r.ok, true, JSON.stringify(r));
      assert.ok(!LOG.slice(l0).some(x => /Supabase error/.test(x)), LOG.slice(l0).join('\n'));
    });

    await test('S9. migrazione 0016: idempotente, privilegi del solo server, rollback; log senza credenziali ne\' testi dello chef', async () => {
      const M = path.join(ROOT, 'supabase/migrations/0016_idea_proposal_locks.sql');
      for (let k = 0; k < 2; k++) { const r = psql(null, DB, M); assert.strictEqual(r.status, 0, r.stderr); }
      assert.strictEqual(sql("select relrowsecurity from pg_class where oid='public.idea_proposal_locks'::regclass"), 't');
      assert.strictEqual(sql("select has_table_privilege('anon','public.idea_proposal_locks','select')||'|'||has_table_privilege('authenticated','public.idea_proposal_locks','insert')"), 'false|false');
      assert.strictEqual(sql("select has_table_privilege('service_role','public.idea_proposal_locks','insert')||'|'||has_table_privilege('service_role','public.idea_proposal_locks','delete')"), 'true|false');
      sql('alter table idea_proposal_locks add column extra text');
      const ko = psql(null, DB, M); assert.notStrictEqual(ko.status, 0); assert.ok(/colonne diverse/.test(ko.stderr));
      sql('alter table idea_proposal_locks drop column extra');
      const rb = psql(null, DB, path.join(ROOT, 'supabase/rollback/PREPARED_NOT_EXECUTED__0016_idea_proposal_locks_rollback.sql')); assert.strictEqual(rb.status, 0, rb.stderr);
      assert.strictEqual(sql("select to_regclass('public.idea_proposal_locks') is null"), 't');
      const tutto = LOG.join('\n');
      assert.ok(!tutto.includes(process.env.SUPABASE_SECRET_KEY) && !tutto.includes(process.env.ANTHROPIC_API_KEY), 'nessuna credenziale nei log');
      assert.ok(!/Userei 500 g|semifreddo con albicocche/i.test(tutto), 'nessun testo dello chef nei log');
    });

    await test('S10. M1, M2 e Import Engine (save/load) invariati rispetto al blocco 2d', async () => {
      const prima = execFileSync('git', ['show', 'adcf827:api/chat.js'], { cwd: ROOT, encoding: 'utf8' }), ora = fs.readFileSync(path.join(ROOT, 'api/chat.js'), 'utf8');
      const tra = (s, a, b) => { const i = s.indexOf(a); assert.ok(i !== -1, a); const j = s.indexOf(b, i + 1); assert.ok(j !== -1, b); return s.slice(i, j); };
      const pezzi = s => [tra(s, "    if (body.mode === 'm1') {", '    // Proxy Anthropic legacy'), tra(s, "    if (body.supabaseAction === 'save') {", "if (body.supabaseAction === 'updateDeclaredYield')"), s.match(/function buildM2UserMessage\(body\) \{[\s\S]*?\n\}/)[0]];
      const a = pezzi(prima), b = pezzi(ora);
      ['M1/M2', 'save', 'messaggio M2'].forEach((n, i) => assert.strictEqual(sha(b[i]), sha(a[i]), n + ' invariato'));
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
