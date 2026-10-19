/*
 * Test — LAB FIX 2C / C6: obiettivo di Produzione non impostato nei payload
 * MichelinAI M1 (runM1) e M2 (costruisciPayloadM2).
 *
 * Non impostato (0, vuoto, null) = null SOLO nel payload per l'AI; valori
 * impostati invariati; un solo campo impostato -> quel valore e null.
 * Lo snapshot di runM1, buildSnapshot, computeCurrentBaseline, le baseline
 * delle osservazioni L2 e la riconciliazione restano invariati: una modifica
 * all'obiettivo continua a rendere "divergent" le osservazioni.
 *
 * Codice REALE: runM1/costruisciPayloadM2 estratti da khub_mvp.html,
 * lib/baseline.js e lib/reconciliation.js, handler reale di api/chat.js per il
 * testo inviato all'AI (chiamata ad Anthropic intercettata: nessuna rete).
 * Solo dati sintetici.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
console.error = () => {};
const html = fs.readFileSync(path.join(ROOT, 'khub_mvp.html'), 'utf8');
const KhubBaseline = require(path.join(ROOT, 'lib', 'baseline.js'));
const KhubReconciliation = require(path.join(ROOT, 'lib', 'reconciliation.js'));
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ok - ' + name); passed++; }
  catch (e) { console.log('  FAIL - ' + name); console.log('    ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n    ') : e)); failed++; }
}
function extractFunction(m) { const s = html.indexOf(m); if (s === -1) throw new Error('marker ' + m); let d = 0; for (let i = html.indexOf('{', s); i < html.length; i++) { if (html[i] === '{') d++; else if (html[i] === '}') { d--; if (!d) return html.slice(s, i + 1); } } }
async function loadHandler() {
  const src = fs.readFileSync(path.join(ROOT, 'api/chat.js'), 'utf8');
  return (await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'))).default;
}
const clone = x => JSON.parse(JSON.stringify(x));

const SRC = ['function R(id)', 'function curLab(recipe)', 'function upRec(id,fn)', 'function upLab(id,fn)', 'function uid()', 'function hasM1(v)',
  'function parseLocaleNumber(value)', 'function labTargetIsSet(value)', 'function targetForAi(value)',
  'function costruisciPayloadM2(recipeId, message, classification)', 'async function runM1(recipeId)'].map(extractFunction).join('\n');

// Combinazioni richieste (85,5 anche come testo, come arriva dal DB) e casi limite.
const COMBOS = [
  [0, 0, null, null], [12, 0, 12, null], [0, 85.5, null, 85.5], [12, 85.5, 12, 85.5], [4, 200, 4, 200],
  ['12', '85.5', '12', '85.5'], [null, undefined, null, null], ['', '0', null, null],
];
function makeRecipe(p, g) {
  return { id: 'rM', name: 'Frolla M TEST', category: 'Dolci', currentLabIdx: 0, validatedVariants: [], l3Items: [{ id: 'l3a', distilledContent: 'burro freddo' }],
    labVersions: [{ id: 'lvM', label: 'Bozza 1', note: 'nota', portionsCount: p, gramsPerPortion: g, declaredYieldQty: '30', declaredYieldUnit: 'bignè',
      ingredients: [{ id: 'i1', name: 'Farina', qty: 500, unit: 'g', estimatedYieldPct: 70 }, { id: 'i2', name: 'Uova', qty: 3, unit: 'n', estimatedYieldPct: null }],
      steps: ['Impastare'], l2Items: [], intentionInitial: null, intentionCurrent: null, criteriaInitial: null, criteriaCurrent: null }] };
}
const M1_REPLY = 'Lettura sintetica.\n===M1_OBSERVATIONS===\n{"observations":[{"label":"Idratazione","content":"Osservazione sintetica"}]}';
function makeClient(recipe) {
  const log = { payloads: [], saves: 0 };
  const fetch = async (u, o) => { log.payloads.push(JSON.parse(o.body)); return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: M1_REPLY }] }) }; };
  const api = new Function('fetch', 'log', 'KhubBaseline', 'KhubReconciliation', `
    var S={recipes:[], m1Loading:false, m1LoadingKey:null, m1Error:{}};
    function render(){} function toast(){} function autosave(){} async function saveToSupabase(){ log.saves++; return true; }
    ${SRC}
    return { S, runM1, costruisciPayloadM2 };`)(fetch, log, KhubBaseline, KhubReconciliation);
  api.S.recipes = [recipe];
  return { api, log };
}

(async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase'; process.env.SUPABASE_ANON_KEY = 'anon'; process.env.ANTHROPIC_API_KEY = 'test-sintetico';
  const handler = await loadHandler();
  // Testo che il server invierebbe all'AI: chiamata ad Anthropic intercettata.
  async function aiUserMessage(payload) {
    let sent = null;
    globalThis.fetch = async (url, opts) => { if (!String(url).startsWith('https://api.anthropic.com/')) throw new Error('rete non ammessa: ' + url); sent = JSON.parse(opts.body); return { status: 200, json: async () => ({ content: [] }) }; };
    await handler({ method: 'POST', body: clone(payload) }, { status() { return this; }, json() { return this; } });
    return sent.messages[0].content;
  }
  const line = msg => msg.split('\n').find(l => l.startsWith('Porzioni: '));
  const shown = x => (x == null ? 'n/d' : String(x));

  console.log('LAB FIX 2C — C6: obiettivo non impostato nei payload MichelinAI');

  await test('P1. M1 (runM1): 0/0 -> null/null, 12/0 -> 12/null, 0/85,5 -> null/85,5, 12/85,5 e 4/200 invariati', async () => {
    for (const [p, g, eP, eG] of COMBOS) {
      const { api, log } = makeClient(makeRecipe(p, g));
      await api.runM1('rM');
      assert.strictEqual(log.payloads.length, 1);
      assert.ok(!api.S.m1Error.lvM, 'M1 completato: ' + api.S.m1Error.lvM);
      const v = log.payloads[0].variant;
      assert.ok('portionsCount' in v && 'gramsPerPortion' in v, 'chiavi presenti');
      assert.deepStrictEqual([v.portionsCount, v.gramsPerPortion], [eP, eG], p + '/' + g);
      assert.deepStrictEqual(v.ingredients, [{ name: 'Farina', qty: 500, unit: 'g' }, { name: 'Uova', qty: 3, unit: 'n' }], 'ingredienti invariati');
      assert.ok(!('declaredYieldQty' in v), 'resa dichiarata non aggiunta');
    }
  });

  await test('P2. M2 (costruisciPayloadM2): stessa regola; il resto del payload invariato', async () => {
    for (const [p, g, eP, eG] of COMBOS) {
      const { api } = makeClient(makeRecipe(p, g));
      const out = api.costruisciPayloadM2('rM', 'domanda', []);
      assert.deepStrictEqual([out.variant.portionsCount, out.variant.gramsPerPortion], [eP, eG], p + '/' + g);
      assert.deepStrictEqual(Object.keys(out.variant), ['id', 'ingredients', 'steps', 'portionsCount', 'gramsPerPortion', 'note']);
      assert.deepStrictEqual(out.variant.ingredients, [{ name: 'Farina', qty: 500, unit: 'g' }, { name: 'Uova', qty: 3, unit: 'n' }]);
    }
  });

  await test('P3. testo inviato all\'AI (server reale): non impostato = "n/d", mai "0"; valori impostati invariati', async () => {
    for (const [p, g, eP, eG] of COMBOS) {
      const { api, log } = makeClient(makeRecipe(p, g));
      await api.runM1('rM');
      const exp = 'Porzioni: ' + shown(eP) + ' — Grammi/porzione: ' + shown(eG);
      assert.strictEqual(line(await aiUserMessage(log.payloads[0])), exp, 'M1 ' + p + '/' + g);
      assert.strictEqual(line(await aiUserMessage(api.costruisciPayloadM2('rM', 'domanda', []))), exp, 'M2 ' + p + '/' + g);
    }
  });

  await test('B1. memoria: baseline delle L2 di M1 = computeCurrentBaseline della bozza (snapshot con i valori originali, mai null)', async () => {
    for (const [p, g] of COMBOS) {
      const rec = makeRecipe(p, g);
      const prima = clone(rec.labVersions[0]);
      const { api } = makeClient(rec);
      await api.runM1('rM');
      const lab = api.S.recipes[0].labVersions[0];
      assert.strictEqual(lab.l2Items.length, 1);
      const cur = KhubReconciliation.computeCurrentBaseline(lab);
      assert.strictEqual(lab.l2Items[0].baselineHash, cur.baseline_hash, p + '/' + g + ' hash');
      assert.deepStrictEqual(lab.l2Items[0].baselineContext, cur.baseline_context);
      assert.deepStrictEqual([lab.portionsCount, lab.gramsPerPortion, lab.declaredYieldQty, lab.declaredYieldUnit], [prima.portionsCount, prima.gramsPerPortion, '30', 'bignè'], 'bozza invariata');
      assert.deepStrictEqual(lab.ingredients, prima.ingredients, 'ingredienti invariati');
      if (p === 0 && g === 0) {
        const conNull = KhubBaseline.compute({ ...KhubReconciliation.buildSnapshot(lab), portionsCount: null, gramsPerPortion: null });
        assert.notStrictEqual(lab.l2Items[0].baselineHash, conNull.baseline_hash, 'il null del payload non entra nella baseline');
      }
    }
  });

  await test('B2. riconciliazione: obiettivo invariato -> "current"; impostato, cambiato o tolto -> "divergent" (comportamento previsto)', async () => {
    for (const [p, g, nuovo] of [[0, 0, [12, 0]], [0, 0, [0, 85.5]], [12, 85.5, [0, 85.5]], [12, 85.5, [12, 90]], [4, 200, [0, 0]]]) {
      const { api } = makeClient(makeRecipe(p, g));
      await api.runM1('rM');
      const lab = api.S.recipes[0].labVersions[0];
      const id = lab.l2Items[0].id;
      assert.deepStrictEqual(KhubReconciliation.classifyBaseline(lab.l2Items, KhubReconciliation.computeCurrentBaseline(lab).baseline_hash), [{ id, status: 'current' }], p + '/' + g);
      const cambiata = { ...lab, portionsCount: nuovo[0], gramsPerPortion: nuovo[1] };
      assert.deepStrictEqual(KhubReconciliation.classifyBaseline(lab.l2Items, KhubReconciliation.computeCurrentBaseline(cambiata).baseline_hash), [{ id, status: 'divergent' }], p + '/' + g + ' -> ' + nuovo);
      // M2 riceve lo stato dalla classificazione, non dal payload modificato
      api.S.recipes[0].labVersions[0] = cambiata;
      const cls = KhubReconciliation.classifyBaseline(cambiata.l2Items, KhubReconciliation.computeCurrentBaseline(cambiata).baseline_hash);
      assert.strictEqual(api.costruisciPayloadM2('rM', 'x', cls).l2[0].baselineStatus, 'divergent');
    }
  });

  await test('C1. codice: memoria MichelinAI e server invariati; null solo nei payload', async () => {
    const m1 = extractFunction('async function runM1(recipeId)');
    const snap = m1.slice(m1.indexOf('const snapshot={'), m1.indexOf('};', m1.indexOf('const snapshot={')) + 2);
    assert.ok(snap.includes('portionsCount:v.portionsCount,gramsPerPortion:v.gramsPerPortion,'), 'snapshot di runM1 invariato');
    assert.ok(m1.includes('const baseline=KhubBaseline.compute(snapshot);'));
    assert.ok(m1.includes('portionsCount:targetForAi(snapshot.portionsCount),gramsPerPortion:targetForAi(snapshot.gramsPerPortion)'));
    const lib = fs.readFileSync(path.join(ROOT, 'lib', 'reconciliation.js'), 'utf8');
    assert.ok(lib.includes('      portionsCount: v.portionsCount,\n      gramsPerPortion: v.gramsPerPortion,'), 'buildSnapshot invariato');
    assert.ok(!/targetForAi/.test(lib + fs.readFileSync(path.join(ROOT, 'api/chat.js'), 'utf8')));
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
