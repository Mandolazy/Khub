/*
 * Test — P0-c.1: quantita' P0-c per MichelinAI M1 (Primo Consulto) e M2 (Sviluppo)
 * e riconciliazione delle osservazioni L2.
 *
 * Codice REALE: runM1 e costruisciPayloadM2 estratti da khub_mvp.html,
 * lib/baseline.js e lib/reconciliation.js come moduli, api/chat.js come server
 * (la chiamata ad Anthropic e' intercettata: nessuna AI reale, nessuna rete).
 * Confronto delle impronte con lib/reconciliation.js di 7e0604b (git).
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'khub_mvp.html'), 'utf8');
const KhubBaseline = require(path.join(ROOT, 'lib', 'baseline.js'));
const KhubReconciliation = require(path.join(ROOT, 'lib', 'reconciliation.js'));
let RecPrima = null;
try {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'khub-rec-'));
  fs.writeFileSync(path.join(dir, 'baseline.js'), execFileSync('git', ['show', '7e0604b:lib/baseline.js'], { cwd: ROOT, encoding: 'utf8' }));
  fs.writeFileSync(path.join(dir, 'reconciliation.js'), execFileSync('git', ['show', '7e0604b:lib/reconciliation.js'], { cwd: ROOT, encoding: 'utf8' }));
  RecPrima = require(path.join(dir, 'reconciliation.js'));
} catch (e) { RecPrima = null; }

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ok - ' + name); } catch (e) { failed++; console.log('  FAIL - ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n    ')); } }
function extractFunction(m) { const s = html.indexOf(m); if (s === -1) throw new Error('marker ' + m); let d = 0; for (let i = html.indexOf('{', s); i < html.length; i++) { if (html[i] === '{') d++; else if (html[i] === '}') { d--; if (!d) return html.slice(s, i + 1); } } }
const clone = x => JSON.parse(JSON.stringify(x));
const CONST = [/var SESSION_SCALING_MASS_TO_GRAMS=\{[^}]*\};/, /var SESSION_SCALING_VOLUME_TO_ML=\{[^}]*\};/, /const UNITS = \[[^\]]*\];/].map(r => (html.match(r) || [''])[0]).join('\n');
const SRC = ['function R(id)', 'function curLab(recipe)', 'function upRec(id,fn)', 'function upLab(id,fn)', 'function uid()', 'function hasM1(v)',
  'function parseLocaleNumber(value)', 'function labTargetIsSet(value)', 'function targetForAi(value)',
  // Motore dei pesi (per "conversione in grammi da confermare"), con le sue dipendenze.
  'function cnum(n)', 'function sessionScalingUnitFamily(unit)', 'function sessionScalingGenericFamilyTable(family)', 'function resolveSessionScalingConversionToGrams(unit,conversionFact)',
  'function chooseConversionAskUnit(unit)', 'function normalizeIngredientName(name)', 'function resolveKnownProductionConversionFact(normalizedName,unit)', 'function computeFormulationWeights(ingredients,resolveFact)',
  'function costruisciPayloadM2(recipeId, message, classification)', 'async function runM1(recipeId)'].map(extractFunction).join('\n');
const M1_REPLY = 'Lettura sintetica.\n===M1_OBSERVATIONS===\n{"observations":[{"label":"Idratazione","content":"Osservazione sintetica"}]}';
function client(recipe, facts) {
  const log = { payloads: [] };
  const fetch = async (u, o) => { log.payloads.push(JSON.parse(o.body)); return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: M1_REPLY }] }) }; };
  const api = new Function('fetch', 'log', 'KhubBaseline', 'KhubReconciliation', 'FACTS', `
    var S={recipes:[], m1Loading:false, m1LoadingKey:null, m1Error:{}, unitWeights:{uova:55}, unitWeightFacts:{uova:{id:'f1',sourceType:'chef_confirmed'}}, productionConversionFacts:FACTS};
    function render(){} function toast(){} function autosave(){} async function saveToSupabase(){ return true; }
    ${CONST}
    ${SRC}
    return { S, runM1, costruisciPayloadM2 };`)(fetch, log, KhubBaseline, KhubReconciliation, facts || {});
  api.S.recipes = [recipe];
  return { api, log };
}
const I = (id, name, qty, unit, k, extra) => Object.assign({ id, name, qty, unit, estimatedYieldPct: null, measuredYieldPct: null }, k ? { qtyKind: k } : {}, extra || {});
const P0C = () => [I('i1', 'farina', 500, 'g', 'certa', { sourceText: '500 g di farina' }), I('i2', 'aglio', 2, 'spicchio', 'certa', { sourceText: "2 spicchi d'aglio" }),
  I('i3', 'Sale', null, null, 'variabile', { sourceText: 'Sale q.b.' }), I('i4', 'Burro', null, null, 'mancante', { sourceText: 'Burro' }),
  I('i5', 'acqua', null, 'g', 'intervallo', { qtyMin: 20, qtyMax: 30, sourceText: '20–30 g acqua' }), I('i6', 'Lievito', 10, 'g')];
const LEGACY = () => [I('l1', 'Farina', 500, 'g'), I('l2', 'Uova', 3, 'n'), I('l3', 'Sale', 0, 'g'), I('l4', 'Latte', 250, 'ml')];
const ricetta = ings => ({ id: 'rM', name: 'Pane', category: 'Pane', currentLabIdx: 0, validatedVariants: [], l3Items: [],
  labVersions: [{ id: 'lvM', label: 'Bozza 1', note: '', portionsCount: 10, gramsPerPortion: 100, ingredients: ings, steps: ['Impastare'], l2Items: [], intentionInitial: null, intentionCurrent: null, criteriaInitial: null, criteriaCurrent: null }] });

(async () => {
  process.env.SUPABASE_URL = 'https://fake.supabase'; process.env.SUPABASE_ANON_KEY = 'anon'; process.env.ANTHROPIC_API_KEY = 'test-sintetico';
  const src = fs.readFileSync(path.join(ROOT, 'api/chat.js'), 'utf8');
  const handler = await require('./_khub-test-session').withTestSession((await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'))).default);
  let chiamateAI = 0;
  async function inviato(payload) {
    let sent = null;
    globalThis.fetch = async (url, opts) => { if (!String(url).startsWith('https://api.anthropic.com/')) throw new Error('rete non ammessa: ' + url); chiamateAI++; sent = JSON.parse(opts.body); return { status: 200, json: async () => ({ content: [] }) }; };
    await handler({ method: 'POST', body: clone(payload) }, { status() { return this; }, json() { return this; } });
    return sent;
  }
  const righeIng = msg => msg.split('\n').filter(l => /^- /.test(l));

  console.log('P0-c.1 — MichelinAI M1/M2: rappresentazione delle quantita\'');
  const ATTESI = [{ name: 'farina', qty: 500, unit: 'g', qtyKind: 'certa' }, { name: 'aglio', qty: 2, unit: 'spicchio', qtyKind: 'certa', conversioneGrammi: 'da_confermare' },
    { name: 'Sale', qty: null, unit: 'g', qtyKind: 'variabile' }, { name: 'Burro', qty: null, unit: 'g', qtyKind: 'mancante' },
    { name: 'acqua', qty: null, unit: 'g', qtyKind: 'intervallo', qtyMin: 20, qtyMax: 30 }, { name: 'Lievito', qty: 10, unit: 'g' }];

  await test('A1. payload M1 e M2: certa con unita\' originale, conversione in grammi mancante, q.b., da indicare, intervallo completo; nessuno 0', async () => {
    const { api, log } = client(ricetta(P0C()));
    await api.runM1('rM');
    assert.deepStrictEqual(log.payloads[0].variant.ingredients, ATTESI, 'M1');
    assert.deepStrictEqual(api.costruisciPayloadM2('rM', 'domanda', []).variant.ingredients, ATTESI, 'M2');
    const conFatto = client(ricetta(P0C()), { 'aglio|spicchio|g': { id: 'c1', factor: 5, sourceType: 'chef_confirmed' } });
    assert.ok(!('conversioneGrammi' in conFatto.api.costruisciPayloadM2('rM', 'x', []).variant.ingredients[1]), 'conversione confermata: nessuna nota');
  });

  await test('A2. Ricette precedenti: payload M1/M2 identico a prima ({name, qty, unit}, 0 compreso)', async () => {
    const { api, log } = client(ricetta(LEGACY()));
    await api.runM1('rM');
    const atteso = LEGACY().map(i => ({ name: i.name, qty: i.qty, unit: i.unit }));
    assert.deepStrictEqual(log.payloads[0].variant.ingredients, atteso);
    assert.deepStrictEqual(api.costruisciPayloadM2('rM', 'x', []).variant.ingredients, atteso);
  });

  await test('A3. testo inviato all\'AI dal server reale (M1 e M2): righe corrette; precedenti identiche a prima; una sola chiamata per richiesta', async () => {
    const { api, log } = client(ricetta(P0C().concat(LEGACY())));
    await api.runM1('rM');
    const attese = ['- 500 g farina', "- 2 spicchio aglio (unita' originale; peso in grammi non confermato)", "- Sale: q.b. (quantita' variabile, non un peso)", "- Burro: quantita' da indicare",
      '- acqua: 20–30 g (intervallo, nessun valore scelto)', '- 10g Lievito', '- 500g Farina', '- 3n Uova', '- 0g Sale', '- 250ml Latte'];
    for (const [nome, payload] of [['M1', log.payloads[0]], ['M2', api.costruisciPayloadM2('rM', 'domanda', [])]]) {
      const n0 = chiamateAI;
      const sent = await inviato(payload);
      assert.strictEqual(chiamateAI - n0, 1, nome + ': una chiamata');
      assert.deepStrictEqual(righeIng(sent.messages[0].content), attese, nome);
    }
  });

  await test('A4. istruzione nei prompt di M1 e M2: q.b. e da indicare non sono zero; nessun valore scelto negli intervalli; nessun peso inventato', async () => {
    const { api, log } = client(ricetta(P0C()));
    await api.runM1('rM');
    for (const p of [log.payloads[0], api.costruisciPayloadM2('rM', 'x', [])]) {
      const sys = (await inviato(p)).system;
      assert.ok(/QUANTITA' DEGLI INGREDIENTI/.test(sys) && /non e' zero/.test(sys) && /non scegliere tu un valore/.test(sys) && /non inventarlo/.test(sys), p.mode);
    }
    assert.ok(/Sei MichelinAI, un collega tecnico/.test((await inviato(log.payloads[0])).system), 'ruolo M1 invariato');
    assert.ok(/modalita' SVILUPPO/.test((await inviato(api.costruisciPayloadM2('rM', 'x', []))).system), 'ruolo M2 invariato');
  });

  console.log('P0-c.1 — impronte e riconciliazione delle osservazioni L2');
  await test('B1. impronte delle Ricette precedenti identiche a 7e0604b (300 bozze sintetiche): osservazioni esistenti restano "current"', async () => {
    if (!RecPrima) return;
    let seme = 11; const rnd = n => { seme = (seme * 1103515245 + 12345) % 2147483648; return seme % n; };
    for (let r = 0; r < 300; r++) {
      const v = { ingredients: Array.from({ length: rnd(8) }, (_, k) => ({ name: ['Farina', 'Uova', 'Sale', 'Latte'][rnd(4)], qty: [0, 1, 2.5, 500, null, '12'][rnd(6)], unit: ['g', 'n', 'ml', null, 'kg'][rnd(5)] })),
        steps: ['a', 'b'].slice(0, rnd(3)), portionsCount: [0, 4, null][rnd(3)], gramsPerPortion: [0, 200, 85.5][rnd(3)], note: ['', 'nota'][rnd(2)] };
      assert.deepStrictEqual(KhubReconciliation.computeCurrentBaseline(v), RecPrima.computeCurrentBaseline(v), 'bozza ' + r);
    }
  });

  await test('B2. runM1 e buildSnapshot hanno la stessa forma: baseline delle L2 di M1 = baseline corrente (anche con quantita\' P0-c)', async () => {
    const rec = ricetta(P0C());
    const { api } = client(rec);
    await api.runM1('rM');
    const lab = api.S.recipes[0].labVersions[0];
    assert.strictEqual(lab.l2Items.length, 1);
    assert.strictEqual(lab.l2Items[0].baselineHash, KhubReconciliation.computeCurrentBaseline(lab).baseline_hash);
  });

  await test('B3. M2 riconosce i cambi di tipo e di intervallo ("divergent"); nessun falso allarme dopo il ricaricamento o al cambio di una conversione', async () => {
    const { api } = client(ricetta(P0C()));
    await api.runM1('rM');
    const lab = api.S.recipes[0].labVersions[0];
    const stato = ings => KhubReconciliation.classifyBaseline(lab.l2Items, KhubReconciliation.computeCurrentBaseline(Object.assign({}, lab, { ingredients: ings })).baseline_hash)[0].status;
    const cambia = (n, patch) => lab.ingredients.map((i, k) => k === n ? Object.assign({}, i, patch) : i);
    assert.strictEqual(stato(lab.ingredients), 'current', 'invariata');
    assert.strictEqual(stato(cambia(2, { qtyKind: 'mancante' })), 'divergent', 'q.b. -> da indicare');
    assert.strictEqual(stato(cambia(3, { qtyKind: 'certa', qty: 100, unit: 'g' })), 'divergent', 'quantita\' indicata');
    assert.strictEqual(stato(cambia(4, { qtyMin: 30, qtyMax: 40 })), 'divergent', 'intervallo cambiato');
    assert.strictEqual(stato(cambia(4, { qtyKind: 'certa', qty: 25, qtyMin: null, qtyMax: null })), 'divergent', 'intervallo -> certa');
    assert.strictEqual(stato(cambia(0, { qty: 600 })), 'divergent', 'quantita\' certa');
    // Dopo il ricaricamento q.b. e da indicare hanno unita' "g" (NOT NULL DEFAULT 'g'): stessa baseline.
    assert.strictEqual(stato(cambia(3, { unit: 'g' }).map((i, k) => k === 2 ? Object.assign({}, i, { unit: 'g' }) : i)), 'current', 'ricaricamento');
    assert.strictEqual(stato(lab.ingredients.map(i => Object.assign({}, i, { sourceText: 'altro' }))), 'current', 'testo della fonte: informativo');
    const conFatto = client(ricetta(P0C()), { 'aglio|spicchio|g': { id: 'c1', factor: 5, sourceType: 'chef_confirmed' } });
    assert.strictEqual(KhubReconciliation.computeCurrentBaseline(conFatto.api.S.recipes[0].labVersions[0]).baseline_hash, KhubReconciliation.computeCurrentBaseline(lab).baseline_hash, 'conversione: non e\' contenuto della Ricetta');
  });

  await test('B4. M2: le osservazioni superate dal cambio di tipo arrivano all\'AI come "divergent" (baselineStatus), le altre "current"', async () => {
    const { api } = client(ricetta(P0C()));
    await api.runM1('rM');
    const lab = api.S.recipes[0].labVersions[0];
    lab.l2Items.push(Object.assign({}, lab.l2Items[0], { id: 'l2vecchia', baselineHash: 'impronta_precedente' }));
    lab.ingredients = lab.ingredients.map(i => i.name === 'Burro' ? Object.assign({}, i, { qtyKind: 'certa', qty: 100, unit: 'g' }) : i);
    const cls = KhubReconciliation.classifyBaseline(lab.l2Items, KhubReconciliation.computeCurrentBaseline(lab).baseline_hash);
    const out = api.costruisciPayloadM2('rM', 'domanda', cls);
    assert.deepStrictEqual(out.l2.map(x => x.baselineStatus), ['divergent', 'divergent']);
    lab.ingredients = lab.ingredients.map(i => i.name === 'Burro' ? Object.assign({}, i, { qtyKind: 'mancante', qty: null, unit: null }) : i);
    const cls2 = KhubReconciliation.classifyBaseline(lab.l2Items, KhubReconciliation.computeCurrentBaseline(lab).baseline_hash);
    assert.deepStrictEqual(api.costruisciPayloadM2('rM', 'domanda', cls2).l2.map(x => x.baselineStatus), ['current', 'divergent'], 'tornata come prima');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.log('ERRORE', e && e.stack || e); process.exit(1); });
