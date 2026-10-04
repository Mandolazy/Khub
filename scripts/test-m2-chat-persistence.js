/*
 * Test MichelinAI — cronologia M2 persistente (m2_turns) + input vocale.
 * Nessun framework: Node puro + assert, stesso stile degli altri test.
 *
 * Codice REALE: api/chat.js (handler importato come modulo) contro un finto
 * PostgREST in memoria (Max rows 1000, FK m2_turns.variant_id -> variants
 * con ON DELETE CASCADE come in 0010, insert con ignore-duplicates), e le
 * funzioni client ESTRATTE da khub_mvp.html (inviaMichelinAI, runM2,
 * costruisciPayloadM2, cronologia, dettatura). KhubReconciliation reale.
 * Mock solo ai confini: Anthropic (contato), applyM2Persistence (L2/L3,
 * testato altrove), render/toast, window.SpeechRecognition, document.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
console.error = () => {}; // errori attesi (fallimenti simulati) loggati dal handler: l'esito si legge da ok/FAIL
const MAX_ROWS = 1000;
let passed = 0, failed = 0;

async function test(name, fn) {
  try { await fn(); console.log('  ok - ' + name); passed++; }
  catch (e) { console.log('  FAIL - ' + name); console.log('    ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n    ') : e)); failed++; }
}

const KhubReconciliation = require(path.join(ROOT, 'lib', 'reconciliation.js'));
const html = fs.readFileSync(path.join(ROOT, 'khub_mvp.html'), 'utf8');
const chatSrc = fs.readFileSync(path.join(ROOT, 'api/chat.js'), 'utf8');
const migration = fs.readFileSync(path.join(ROOT, 'supabase/migrations/0010_m2_turns.sql'), 'utf8');

function extractFunction(startMarker) {
  const start = html.indexOf(startMarker);
  if (start === -1) throw new Error('marker non trovato: ' + startMarker);
  const braceStart = html.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error('graffe non bilanciate a partire da: ' + startMarker);
}

// ══════════════════════════════════════════════════════════
// Finto PostgREST
// ══════════════════════════════════════════════════════════
function makeFakeSupabase() {
  const tables = { variants: [], m2_turns: [] };
  const calls = [];
  const fail = new Set(); // 'table:METHOD'
  const matches = (row, filters) => filters.every(([col, op, val]) => {
    const v = row[col] == null ? null : String(row[col]);
    if (op === 'eq') return v === val;
    throw new Error('filtro non supportato: ' + op);
  });
  const compare = (a, b, order) => {
    for (const [col, dir] of order) {
      const x = a[col], y = b[col];
      if (x === y) continue;
      const c = String(x) < String(y) ? -1 : 1;
      return dir === 'desc' ? -c : c;
    }
    return 0;
  };
  const reply = (status, data) => ({ ok: status < 400, status, json: async () => JSON.parse(JSON.stringify(data)), text: async () => JSON.stringify(data) });
  async function fetch(url, opts = {}) {
    const u = new URL(url);
    const table = u.pathname.replace('/rest/v1/', '');
    const method = opts.method || 'GET';
    let order = [], limit = null, offset = 0;
    const filters = [];
    for (const [k, raw] of u.searchParams) {
      if (k === 'select') continue;
      if (k === 'order') { order = raw.split(',').map(s => s.split('.')); continue; }
      if (k === 'limit') { limit = parseInt(raw, 10); continue; }
      if (k === 'offset') { offset = parseInt(raw, 10); continue; }
      const dot = raw.indexOf('.');
      filters.push([k, raw.slice(0, dot), raw.slice(dot + 1)]);
    }
    calls.push({ method, table, limit, offset });
    if (fail.has(table + ':' + method)) return reply(500, { message: 'boom ' + table });
    const rows = tables[table] = tables[table] || [];
    if (method === 'GET') {
      const sorted = rows.filter(r => matches(r, filters)).sort((a, b) => compare(a, b, order));
      return reply(200, sorted.slice(offset, offset + Math.min(limit == null ? Infinity : limit, MAX_ROWS)));
    }
    if (method === 'POST') {
      const prefer = (opts.headers && opts.headers.Prefer) || '';
      for (const row0 of [].concat(JSON.parse(opts.body))) {
        const row = { ...row0 };
        if (table === 'm2_turns') {
          if (!tables.variants.some(v => v.id === row.variant_id)) return reply(409, { code: '23503', message: 'fk' });
          if (!row.created_at) row.created_at = new Date().toISOString();
        }
        const i = rows.findIndex(r => r.id === row.id);
        if (i >= 0) {
          if (prefer.includes('ignore-duplicates')) continue;
          if (!prefer.includes('merge-duplicates')) return reply(409, { code: '23505' });
          rows[i] = { ...rows[i], ...row };
        } else rows.push(row);
      }
      return reply(201, null);
    }
    if (method === 'DELETE') {
      const gone = rows.filter(r => matches(r, filters)).map(r => r.id);
      tables[table] = rows.filter(r => !matches(r, filters));
      if (table === 'variants') tables.m2_turns = tables.m2_turns.filter(t => !gone.includes(t.variant_id)); // ON DELETE CASCADE (0010)
      return reply(204, null);
    }
    throw new Error('metodo non supportato: ' + method);
  }
  return { tables, calls, fetch, fail: (k) => fail.add(k), heal: (k) => fail.delete(k) };
}

async function loadHandler() {
  return (await import('data:text/javascript;base64,' + Buffer.from(chatSrc).toString('base64'))).default;
}

// ══════════════════════════════════════════════════════════
// Client reale (funzioni estratte)
// ══════════════════════════════════════════════════════════
const CLIENT_SRC = [
  'function R(id)', 'function curLab(recipe)', 'function uid()', 'function escAttr(s)',
  'function costruisciPayloadM2(recipeId, message, classification)', 'async function runM2(recipeId, message)',
  'async function inviaMichelinAI(recipeId)',
  'function m2TurnsEntry(variantId)', 'function sortM2Turns(turns)', 'function recordM2Turn(variantId,question,response)',
  'async function persistM2Turn(variantId,turnId)', 'function riprovaSalvataggioTurnoM2(variantId,turnId)',
  'async function loadM2Turns(variantId,force)', 'function renderM2Turns(variantId)',
  'function startDictation(opts)', 'function stopDictation()', 'function toggleRecording(recipeId)', 'function toggleDictationM2()',
  'function upRec(id,fn)', 'function addHistory(variantId,event,label)', 'function activeVariants(recipe)',
  'function getStructuredSteps(legacySteps,stepsV2)', 'function creaBozzaDaSorgente(recipeId,attiva)',
  'function duplicaVersioneLAB(recipeId)', 'function rendiAttiva(recipeId)', 'function retireVariant(recipeId,variantId)',
].map(extractFunction).join('\n');

const M2_OK = (prosa) => prosa + '\n===M2_UPDATE===\n{"l2_updates":[],"l2_new":[],"l3_candidates":[],"intention_change":null,"criteria_change":null}';

function makeRecipe(id, variantId, name) {
  return {
    id, name, category: 'Salato', l3Items: [],
    labVersions: [{ id: variantId, label: 'Bozza 1', name, note: '', ingredients: [{ id: 'i' + variantId, name: 'Pecorino', qty: 200, unit: 'g' }],
      steps: ['Mantecare.'], stepsV2: null, portionsCount: 2, gramsPerPortion: 260, portionUnit: 'g', l2Items: [],
      intentionInitial: null, intentionCurrent: null, criteriaInitial: null, criteriaCurrent: null }],
    validatedVariants: [], currentLabIdx: 0,
  };
}

// opts.anthropic: (body) => testo risposta | Error ; opts.apply: risultato applyM2Persistence
function makeClient(handler, opts = {}) {
  const doc = { values: { 'mai-q-input': { value: opts.input || '' } }, getElementById(id) { return this.values[id] || null; } };
  const anthropicCalls = [], apiCalls = [], toasts = [], applyCalls = [];
  const clientFetch = async (url, init) => {
    const body = JSON.parse(init.body);
    if (body.mode === 'm2') {
      anthropicCalls.push(body);
      const out = (opts.anthropic || (() => M2_OK('Risposta di MichelinAI.')))(body);
      if (out instanceof Error) return { ok: false, status: 500, json: async () => ({ error: out.message }) };
      return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: out }] }) };
    }
    apiCalls.push(body.supabaseAction);
    if (opts.beforeApi) await opts.beforeApi(body);
    let status = 200, out;
    await handler({ method: 'POST', body }, { status(c) { status = c; return this; }, json(o) { out = o; return this; } });
    return { ok: status < 400, status, json: async () => out };
  };
  const win = opts.window || {};
  const factory = new Function('S', 'KhubReconciliation', 'fetch', 'render', 'toast', 'document', 'window', 'applyM2Persistence', 'confirm', 'autosave', 'console', `
    ${CLIENT_SRC}
    return { inviaMichelinAI, runM2, costruisciPayloadM2, recordM2Turn, persistM2Turn, riprovaSalvataggioTurnoM2, loadM2Turns,
      renderM2Turns, startDictation, stopDictation, toggleRecording, toggleDictationM2, duplicaVersioneLAB, rendiAttiva, retireVariant, R, curLab };
  `);
  const S = {
    recipes: opts.recipes || [makeRecipe('r1', 'v1', 'Cacio e pepe'), makeRecipe('r2', 'v2', 'Carbonara')],
    m2Result: {}, m2Loading: false, m2LoadingKey: null, m2Error: {}, m2SaveFailed: {}, michelinAIQuestion: '',
    m2TurnsByVariant: {}, recording: false, recordingTarget: null, pendingVoiceText: {}, variantHistory: {}, view: 'recipe',
    pendingDuplicaSceltaRecipeId: null,
  };
  const api = factory(S, KhubReconciliation, clientFetch, () => {}, (m) => toasts.push(m), doc, win,
    async (recipeId, o) => { applyCalls.push({ recipeId, o }); const r = opts.apply ? await opts.apply(S, recipeId) : { ok: true }; return r; },
    () => true, () => {}, { error() {}, warn() {}, log() {} }); // errori attesi nei test: console silenziata
  return { S, api, doc, anthropicCalls, apiCalls, toasts, applyCalls };
}

(async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase';
  process.env.SUPABASE_ANON_KEY = 'anon';
  const handler = await loadHandler();
  const flush = () => new Promise(r => setTimeout(r, 0));
  function freshDb() {
    const fake = makeFakeSupabase();
    fake.tables.variants = [{ id: 'v1', recipe_id: 'r1' }, { id: 'v2', recipe_id: 'r2' }];
    globalThis.fetch = fake.fetch;
    return fake;
  }
  async function ask(c, question) {
    c.doc.values['mai-q-input'].value = question;
    await c.api.inviaMichelinAI('r1');
    await flush(); await flush();
  }
  const turnsOf = (fake, vid) => fake.tables.m2_turns.filter(t => t.variant_id === vid);

  console.log('CHAT 1-7. persistenza, isolamento, lifecycle');

  await test('1: turno completato -> persistito (domanda + risposta, stessa riga, variant corretta)', async () => {
    const fake = freshDb();
    const c = makeClient(handler, { anthropic: () => M2_OK('Usa acqua di cottura fredda.') });
    await ask(c, 'Come evito i grumi?');
    const rows = turnsOf(fake, 'v1');
    assert.strictEqual(rows.length, 1);
    assert.deepStrictEqual([rows[0].question, rows[0].response], ['Come evito i grumi?', 'Usa acqua di cottura fredda.']);
    assert.match(rows[0].id, /^m2t/);
    assert.strictEqual(c.S.m2TurnsByVariant.v1.turns[0].saveState, 'saved');
  });

  await test('2+3: reload / uscita e rientro -> cronologia presente, in ordine', async () => {
    const fake = freshDb();
    const c = makeClient(handler, { anthropic: (b) => M2_OK('R: ' + b.message) });
    await ask(c, 'prima'); await ask(c, 'seconda');
    // uscita e rientro nella stessa sessione: stato per variant intatto
    assert.ok(c.api.renderM2Turns('v1').indexOf('prima') < c.api.renderM2Turns('v1').indexOf('seconda'));
    // reload: nuovo client, cronologia letta dal DB
    const c2 = makeClient(handler);
    await c2.api.loadM2Turns('v1');
    assert.deepStrictEqual(c2.S.m2TurnsByVariant.v1.turns.map(t => [t.question, t.response]), [['prima', 'R: prima'], ['seconda', 'R: seconda']]);
    assert.match(c2.api.renderM2Turns('v1'), /R: seconda/);
  });

  await test('4: un\'altra Ricetta non vede la cronologia (niente piu\' coppia globale)', async () => {
    const fake = freshDb();
    const c = makeClient(handler);
    await ask(c, 'domanda su cacio e pepe');
    await c.api.loadM2Turns('v2');
    assert.deepStrictEqual(c.S.m2TurnsByVariant.v2.turns, []);
    assert.strictEqual(c.api.renderM2Turns('v2'), '');
    assert.doesNotMatch(c.api.renderM2Turns('v2'), /cacio e pepe/);
    assert.ok(!/michelinAILastQuestion|michelinAILastResponse/.test(html), 'stato globale rimosso dal codice');
  });

  await test('5: nuova Bozza (nuovo variant.id) -> cronologia vuota, nessuna copia', async () => {
    const fake = freshDb();
    const c = makeClient(handler);
    await ask(c, 'domanda sulla bozza 1');
    c.api.duplicaVersioneLAB('r1');
    const nuova = c.api.curLab(c.api.R('r1'));
    assert.notStrictEqual(nuova.id, 'v1');
    fake.tables.variants.push({ id: nuova.id, recipe_id: 'r1' });
    await c.api.loadM2Turns(nuova.id);
    assert.deepStrictEqual(c.S.m2TurnsByVariant[nuova.id].turns, []);
    assert.strictEqual(turnsOf(fake, 'v1').length, 1, 'la cronologia originale resta della sua variant');
  });

  await test('6: lifecycle dello stesso variant (Bozza -> Attiva -> Archiviata) -> cronologia conservata', async () => {
    const fake = freshDb();
    const c = makeClient(handler);
    await ask(c, 'domanda prima di attivare');
    c.api.rendiAttiva('r1');
    const attiva = c.api.R('r1').validatedVariants[0];
    assert.strictEqual(attiva.id, 'v1', 'stesso variant.id (D3)');
    c.api.retireVariant('r1', 'v1');
    assert.strictEqual(c.api.R('r1').validatedVariants[0].status, 'retired');
    const c2 = makeClient(handler);
    await c2.api.loadM2Turns('v1');
    assert.deepStrictEqual(c2.S.m2TurnsByVariant.v1.turns.map(t => t.question), ['domanda prima di attivare']);
  });

  await test('7: eliminazione della Ricetta -> m2_turns eliminati (ON DELETE CASCADE)', async () => {
    assert.match(migration, /variant_id\s+text not null references variants\(id\) on delete cascade/);
    const fake = freshDb();
    const c = makeClient(handler);
    await ask(c, 'domanda da eliminare');
    await c.api.loadM2Turns('v2');
    let status = 200;
    await handler({ method: 'POST', body: { supabaseAction: 'delete', table: 'variants', id: 'v1' } }, { status(s) { status = s; return this; }, json() { return this; } });
    assert.strictEqual(turnsOf(fake, 'v1').length, 0);
    assert.ok(fake.tables.variants.some(v => v.id === 'v2'));
  });

  console.log('');
  console.log('CHAT 8-12. solo turni validi, idempotenza, isolamento errori');

  await test('8: errore M2 -> nessun turno', async () => {
    const fake = freshDb();
    const c = makeClient(handler, { anthropic: () => new Error('overloaded') });
    await ask(c, 'domanda che fallisce');
    assert.strictEqual(fake.tables.m2_turns.length, 0);
    assert.ok(!c.S.m2TurnsByVariant.v1 || c.S.m2TurnsByVariant.v1.turns.length === 0);
    assert.ok(c.S.m2Error.v1);
  });

  await test('9: risposta scartata (blocco strutturato invalido / bozza cambiata / coda pending precedente) -> nessun turno', async () => {
    let fake = freshDb();
    let c = makeClient(handler, { anthropic: () => 'prosa senza blocco strutturato' });
    await ask(c, 'risposta malformata');
    assert.strictEqual(fake.tables.m2_turns.length, 0);

    fake = freshDb();
    c = makeClient(handler, { anthropic: (b) => { c.S.recipes[0].labVersions[0].ingredients[0].qty = 999; return M2_OK('ok'); } });
    await ask(c, 'bozza cambiata durante la chiamata');
    assert.strictEqual(fake.tables.m2_turns.length, 0, 'risultato stale scartato da runM2');

    fake = freshDb();
    c = makeClient(handler, { anthropic: () => new Error('down') });
    c.S.m2Result.v1 = { response: 'risposta VECCHIA ancora in coda', l2Updates: { applied: [], rejected: [] }, l2New: [], intentionChange: { x: 1 }, criteriaChange: null, l3Candidates: [] };
    await ask(c, 'nuova domanda che fallisce');
    assert.strictEqual(fake.tables.m2_turns.length, 0, 'mai la risposta di un turno precedente attribuita alla nuova domanda');
    assert.strictEqual(c.applyCalls.length, 0);
  });

  await test('10: doppio click / retry -> nessun duplicato', async () => {
    let fake = freshDb();
    let c = makeClient(handler);
    c.doc.values['mai-q-input'].value = 'una volta sola';
    await Promise.all([c.api.inviaMichelinAI('r1'), c.api.inviaMichelinAI('r1')]);
    await flush(); await flush();
    assert.strictEqual(c.anthropicCalls.length, 1);
    assert.strictEqual(fake.tables.m2_turns.length, 1);

    fake = freshDb();
    c = makeClient(handler);
    fake.fail('m2_turns:POST');
    await ask(c, 'salvataggio da riprovare');
    const t = c.S.m2TurnsByVariant.v1.turns[0];
    assert.strictEqual(t.saveState, 'failed');
    assert.match(c.api.renderM2Turns('v1'), /Non salvato/);
    fake.heal('m2_turns:POST');
    await Promise.all([c.api.riprovaSalvataggioTurnoM2('v1', t.id), c.api.riprovaSalvataggioTurnoM2('v1', t.id)]);
    assert.strictEqual(fake.tables.m2_turns.length, 1);
    assert.strictEqual(fake.tables.m2_turns[0].id, t.id, 'stesso id');
    assert.strictEqual(t.saveState, 'saved');
    // retry di un turno gia' presente sul DB (risposta persa): ignore-duplicates, nessuna copia
    t.saveState = 'failed';
    assert.strictEqual(await c.api.riprovaSalvataggioTurnoM2('v1', t.id), true);
    assert.strictEqual(fake.tables.m2_turns.length, 1);
    assert.strictEqual(c.anthropicCalls.length, 1, 'il retry non richiama Anthropic');
  });

  await test('11: salvataggio chat fallito -> L2/L3 (applyM2Persistence) procede, nessun m2SaveFailed', async () => {
    const fake = freshDb();
    const c = makeClient(handler, { apply: async () => ({ ok: true }) });
    fake.fail('m2_turns:POST');
    await ask(c, 'domanda');
    assert.strictEqual(c.applyCalls.length, 1);
    assert.deepStrictEqual(c.applyCalls[0].o, {});
    assert.strictEqual(c.S.m2SaveFailed.v1, undefined);
    assert.strictEqual(c.S.m2TurnsByVariant.v1.turns[0].saveState, 'failed', 'turno visibile, segnalato non salvato');
    // e viceversa: L2 fallito non impedisce di salvare il turno
    const fake2 = freshDb();
    const c2 = makeClient(handler, { apply: async () => ({ ok: false }) });
    await ask(c2, 'domanda 2');
    assert.strictEqual(c2.S.m2SaveFailed.v1, true);
    assert.strictEqual(fake2.tables.m2_turns.length, 1);
  });

  await test('12: caricamento cronologia fallito -> Ricette caricate comunque, errore isolato con retry', async () => {
    assert.doesNotMatch(chatSrc.slice(chatSrc.indexOf("body.supabaseAction === 'load'"), chatSrc.indexOf("body.supabaseAction === 'save'")), /m2_turns/, 'la load principale non legge m2_turns');
    const fake = freshDb();
    fake.tables.recipes = [{ id: 'r1', name: 'Cacio e pepe', created_at: '2026-01-01' }];
    let status, out;
    fake.fail('m2_turns:GET');
    await handler({ method: 'POST', body: { supabaseAction: 'load' } }, { status(s) { status = s; return this; }, json(o) { out = o; return this; } });
    assert.strictEqual(status, 200);
    assert.strictEqual(out.recipes.length, 1);
    const c = makeClient(handler);
    await c.api.loadM2Turns('v1');
    assert.strictEqual(c.S.m2TurnsByVariant.v1.status, 'error');
    assert.match(c.api.renderM2Turns('v1'), /Riprova/);
    const before = fake.calls.length;
    await c.api.loadM2Turns('v1'); // nessun loop automatico dopo un errore
    assert.strictEqual(fake.calls.length, before);
    fake.heal('m2_turns:GET');
    await c.api.loadM2Turns('v1', true);
    assert.strictEqual(c.S.m2TurnsByVariant.v1.status, 'loaded');
  });

  console.log('');
  console.log('CHAT 13-16. paginazione, ordine, nessun contesto ad Anthropic');

  await test('13: >1000 turni -> letti tutti, a pagine', async () => {
    const fake = freshDb();
    fake.tables.m2_turns = Array.from({ length: 2345 }, (_, i) => ({ id: 'm2t' + String(i).padStart(5, '0'), variant_id: 'v1', question: 'q' + i, response: 'r' + i,
      created_at: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString() }));
    const c = makeClient(handler);
    await c.api.loadM2Turns('v1');
    const turns = c.S.m2TurnsByVariant.v1.turns;
    assert.strictEqual(turns.length, 2345);
    assert.strictEqual(turns[2344].question, 'q2344');
    assert.ok(fake.calls.filter(x => x.table === 'm2_turns' && x.method === 'GET').length >= 3);
  });

  await test('14: ordine stabile created_at + id (anche per un turno salvato in ritardo da un retry)', async () => {
    const fake = freshDb();
    const T = '2026-02-01T10:00:00.000Z';
    fake.tables.m2_turns = [
      { id: 'm2tB', variant_id: 'v1', question: 'B', response: 'b', created_at: T },
      { id: 'm2tA', variant_id: 'v1', question: 'A', response: 'a', created_at: T },
      { id: 'm2t0', variant_id: 'v1', question: 'prima', response: 'p', created_at: '2026-01-01T00:00:00.000Z' },
    ];
    let c = makeClient(handler);
    await c.api.loadM2Turns('v1');
    assert.deepStrictEqual(c.S.m2TurnsByVariant.v1.turns.map(t => t.question), ['prima', 'A', 'B']);
    // turno 1 non salvato, turno 2 salvato, retry del turno 1: dopo reload resta primo
    const fake2 = freshDb();
    c = makeClient(handler);
    fake2.fail('m2_turns:POST');
    await ask(c, 'turno uno');
    fake2.heal('m2_turns:POST');
    await new Promise(r => setTimeout(r, 5));
    await ask(c, 'turno due');
    await c.api.riprovaSalvataggioTurnoM2('v1', c.S.m2TurnsByVariant.v1.turns[0].id);
    const c2 = makeClient(handler);
    await c2.api.loadM2Turns('v1');
    assert.deepStrictEqual(c2.S.m2TurnsByVariant.v1.turns.map(t => t.question), ['turno uno', 'turno due']);
  });

  await test('15+16: payload M2 senza cronologia; una sola chiamata Anthropic per invio, zero per load/salvataggio/retry', async () => {
    const fake = freshDb();
    const c = makeClient(handler);
    await ask(c, 'DOMANDA-UNO-UNICA');
    await ask(c, 'DOMANDA-DUE');
    assert.strictEqual(c.anthropicCalls.length, 2);
    const secondo = JSON.stringify(c.anthropicCalls[1]);
    assert.doesNotMatch(secondo, /DOMANDA-UNO-UNICA/, 'la domanda precedente non arriva al modello');
    assert.doesNotMatch(secondo, /Risposta di MichelinAI/, 'la risposta precedente non arriva al modello');
    assert.deepStrictEqual(Object.keys(c.anthropicCalls[1]).sort(), ['criteria', 'intention', 'l2', 'l3', 'message', 'mode', 'recipe', 'variant']);
    const payload = c.api.costruisciPayloadM2('r1', 'x', []);
    assert.doesNotMatch(JSON.stringify(payload), /DOMANDA-UNO-UNICA|m2t/);
    assert.doesNotMatch(extractFunction('function costruisciPayloadM2(recipeId, message, classification)'), /m2Turns|m2_turns/);
    const c2 = makeClient(handler);
    await c2.api.loadM2Turns('v1');
    await c2.api.riprovaSalvataggioTurnoM2('v1', c2.S.m2TurnsByVariant.v1.turns[0].id);
    assert.strictEqual(c2.anthropicCalls.length, 0);
    assert.doesNotMatch(chatSrc.slice(chatSrc.indexOf("body.mode === 'm2'"), chatSrc.indexOf('// Proxy Anthropic legacy')), /m2_turns|history/, 'il ramo m2 del server non legge la cronologia');
  });

  console.log('');
  console.log('VOICE 17-22. dettatura nell\'input M2');

  function makeSpeech() {
    const instances = [];
    class FakeRec {
      constructor() { this.started = false; this.stopped = false; instances.push(this); }
      start() { this.started = true; }
      stop() { this.stopped = true; }
      emit(text, isFinal) { this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal })] }); }
    }
    return { instances, window: { webkitSpeechRecognition: FakeRec } };
  }

  await test('17+19: testo dettato -> nell\'input M2; nessun invio automatico', async () => {
    freshDb();
    const sp = makeSpeech();
    const c = makeClient(handler, { window: sp.window });
    c.doc.values['mai-voice-preview'] = { textContent: '' };
    c.api.toggleDictationM2();
    assert.strictEqual(sp.instances.length, 1);
    assert.deepStrictEqual([c.S.recording, c.S.recordingTarget], [true, 'm2']);
    sp.instances[0].emit('aggiungo più pepe', false);
    assert.strictEqual(c.doc.values['mai-voice-preview'].textContent, 'aggiungo più pepe');
    sp.instances[0].emit('aggiungo più pepe', true);
    c.api.toggleDictationM2(); // stop
    sp.instances[0].onend();
    assert.strictEqual(c.S.michelinAIQuestion, 'aggiungo più pepe');
    assert.strictEqual(c.anthropicCalls.length, 0, 'nessun invio');
    assert.deepStrictEqual(c.apiCalls, []);
    assert.deepStrictEqual([c.S.recording, c.S.recordingTarget], [false, null]);
  });

  await test('18: il testo dettato si aggiunge a quanto gia\' scritto', async () => {
    freshDb();
    const sp = makeSpeech();
    const c = makeClient(handler, { window: sp.window, input: 'Ho ridotto il burro.' });
    c.api.toggleDictationM2();
    sp.instances[0].emit('Come compenso la cremosità?', true);
    sp.instances[0].onend();
    assert.strictEqual(c.S.michelinAIQuestion, 'Ho ridotto il burro. Come compenso la cremosità?');
  });

  await test('20: browser senza SpeechRecognition -> toast, nessun crash, nessuna registrazione', async () => {
    freshDb();
    const c = makeClient(handler, { window: {} });
    c.api.toggleDictationM2();
    c.api.toggleRecording('r1');
    assert.deepStrictEqual(c.toasts, ['Registrazione vocale non supportata da questo browser', 'Registrazione vocale non supportata da questo browser']);
    assert.strictEqual(c.S.recording, false);
  });

  await test('21: un solo microfono attivo', async () => {
    freshDb();
    const sp = makeSpeech();
    const c = makeClient(handler, { window: sp.window });
    c.api.toggleDictationM2();
    c.api.toggleRecording('r1');
    assert.strictEqual(sp.instances.length, 1);
    assert.strictEqual(c.S.recordingTarget, 'm2');
    assert.match(c.toasts[0], /già un microfono attivo/);
    // mentre il precedente si sta chiudendo (stop chiesto, onend non ancora arrivato) non ne parte un altro
    c.api.toggleDictationM2();
    assert.strictEqual(c.api.startDictation({ target: 'notes', previewId: 'x', onFinal() {} }), false);
    assert.strictEqual(sp.instances.length, 1);
    sp.instances[0].onend();
    c.api.toggleRecording('r1');
    assert.strictEqual(sp.instances.length, 2, 'dopo la chiusura si puo\' ripartire');
  });

  await test('22: note vocali invariate (it-IT, continuo, anteprima, testo in attesa per Ingredienti/Procedimento/Appunti)', async () => {
    freshDb();
    const sp = makeSpeech();
    const c = makeClient(handler, { window: sp.window });
    c.doc.values['voice-preview'] = { textContent: '' };
    c.api.toggleRecording('r1');
    const rec = sp.instances[0];
    assert.deepStrictEqual([rec.lang, rec.continuous, rec.interimResults, rec.started], ['it-IT', true, true, true]);
    assert.deepStrictEqual([c.S.recording, c.S.recordingTarget], [true, 'notes']);
    rec.emit('200 grammi di pecorino', true);
    assert.strictEqual(c.doc.values['voice-preview'].textContent, '200 grammi di pecorino');
    c.api.toggleRecording('r1');
    assert.strictEqual(rec.stopped, true);
    assert.strictEqual(c.S.recording, false);
    rec.onend();
    assert.strictEqual(c.S.pendingVoiceText.r1, '200 grammi di pecorino');
    assert.strictEqual(c.S.michelinAIQuestion, '', 'l\'input M2 non viene toccato');
    // errore microfono: stesso toast di prima
    c.api.toggleRecording('r1');
    sp.instances[1].onerror({ error: 'not-allowed' });
    assert.strictEqual(c.toasts.at(-1), 'Errore microfono: not-allowed');
    assert.strictEqual(c.S.recording, false);
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
