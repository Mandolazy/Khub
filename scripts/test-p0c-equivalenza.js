/*
 * Test — P0-c: equivalenza delle funzioni protette sulle Ricette precedenti.
 *
 * Le funzioni che P0-c modifica (e che hanno un'impronta nei test esistenti)
 * sono eseguite nella versione attuale e in quella di partenza (76d6e5a, letta
 * da git) sugli STESSI dati: ingredienti senza qty_kind, cioe' tutte le Ricette
 * salvate prima di P0-c. Il risultato deve essere identico: pesi, scalatura,
 * snapshot di Produzione, firma delle bozze, payload di salvataggio e rilettura.
 * Nessuna rete, nessun database.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const BASE = '76d6e5a';
const ORA = fs.readFileSync(path.join(ROOT, 'khub_mvp.html'), 'utf8');
let PRIMA = null;
try { PRIMA = execFileSync('git', ['show', BASE + ':khub_mvp.html'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch (e) { PRIMA = null; }
let passed = 0, failed = 0, skipped = 0;
function test(name, fn) { try { if (fn() === 'skip') { skipped++; console.log('  skip - ' + name); return; } passed++; console.log('  ok - ' + name); } catch (e) { failed++; console.log('  FAIL - ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 5).join('\n    ')); } }
function fn(src, m) { const s = src.indexOf(m); if (s === -1) throw new Error('marker ' + m); let d = 0; for (let i = src.indexOf('{', s); i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) return src.slice(s, i + 1); } } }
const DEP = ['function cnum(n)', 'function sessionScalingUnitFamily(unit)', 'function sessionScalingGenericFamilyTable(family)', 'function resolveSessionScalingConversionToGrams(unit,conversionFact)',
  'function chooseConversionAskUnit(unit)', 'function normalizeIngredientName(name)', 'function resolveKnownProductionConversionFact(normalizedName,unit)', 'function parseLocaleNumber(value)',
  'function parseSteps(raw)', 'function getStructuredSteps(legacySteps,stepsV2)', 'function stepsV2ToLegacyArray(stepsV2)'];
const CONST = src => [/var SESSION_SCALING_MASS_TO_GRAMS=\{[^}]*\};/, /var SESSION_SCALING_VOLUME_TO_ML=\{[^}]*\};/, /const UNITS = \[[^\]]*\];/].map(r => (src.match(r) || [''])[0]).join('\n');
const SOTTO = ['function computeFormulationWeights(ingredients,resolveFact)', 'function computeSessionScaling(input)', 'function buildSessionSnapshotV1(meta,computed)',
  'function firmaContenutoBozza(v)', 'function buildPreparedInputDaRicettaAttiva(recipe,vv,targetPortions,targetGramsPerPortion)'];
function carica(src) {
  const S = { unitWeights: { uova: 55, tuorli: 18 }, unitWeightFacts: { uova: { id: 'f1', sourceType: 'chef_confirmed' }, tuorli: { id: 'f2', sourceType: 'reference_data' } },
    productionConversionFacts: { 'latte|ml|g': { id: 'f3', factor: 1.03, sourceType: 'chef_confirmed' }, 'olio|tbsp|g': { id: 'f4', factor: 13.5, sourceType: 'reference_data' } } };
  return new Function('S', CONST(src) + '\n' + DEP.map(m => fn(ORA, m)).join('\n') + '\n' + SOTTO.map(m => fn(src, m)).join('\n')
    + ';return {computeFormulationWeights,computeSessionScaling,buildSessionSnapshotV1,firmaContenutoBozza,buildPreparedInputDaRicettaAttiva};')(S);
}
// Corpus deterministico di formulazioni precedenti a P0-c (nessun qty_kind).
function corpus() {
  let seme = 7; const rnd = n => { seme = (seme * 1103515245 + 12345) % 2147483648; return seme % n; };
  const NOMI = ['Farina', 'Uova', 'Latte', 'Burro', 'Zucchero', 'Tuorli', 'Olio', 'Sale', 'Panna', 'Cacao'];
  const UNITA = ['g', 'kg', 'ml', 'l', 'cl', 'n', 'tbsp', 'tsp'];
  const out = [];
  for (let r = 0; r < 120; r++) {
    const n = 1 + rnd(9);
    out.push(Array.from({ length: n }, (_, k) => ({ id: 'i' + r + '_' + k, name: NOMI[rnd(NOMI.length)], qty: [0, 1, 2.5, 30, 125, 0.333, 1000][rnd(7)],
      unit: UNITA[rnd(UNITA.length)], estimatedYieldPct: [null, 100, 80, 0, 120][rnd(5)], measuredYieldPct: null, isSubRecipe: false, subRecipeId: null })));
  }
  return out;
}

(async () => {
  console.log('P0-c — equivalenza sulle Ricette precedenti (attuale vs ' + BASE + ')');
  if (!PRIMA) { test('storia git con ' + BASE + ' necessaria', () => 'skip'); console.log('\n0 passed, 0 failed, 1 skipped'); process.exit(0); }
  const a = carica(PRIMA), b = carica(ORA);
  const C = corpus();
  const prova = f => { try { return { ok: f() }; } catch (e) { return { errore: e.message }; } };

  test('Q1. pesi della formulazione (computeFormulationWeights): identici su 120 formulazioni', () => {
    C.forEach((ings, i) => assert.deepStrictEqual(prova(() => b.computeFormulationWeights(ings)), prova(() => a.computeFormulationWeights(ings)), 'formulazione ' + i));
  });
  test('Q2. preparazione della Produzione, scalatura e snapshot: identici (stessi errori quando non calcolabile)', () => {
    C.forEach((ings, i) => {
      const vv = { id: 'v' + i, name: 'R' + i, ingredients: ings, steps: ['Impastare.'], stepsV2: [] };
      const rec = { id: 'r' + i, name: 'Scheda', category: 'Dolci' };
      const pa = a.buildPreparedInputDaRicettaAttiva(rec, vv, 10, 120), pb = b.buildPreparedInputDaRicettaAttiva(rec, vv, 10, 120);
      assert.deepStrictEqual(pb, pa, 'input ' + i);
      const sa = prova(() => a.computeSessionScaling(pa)), sb = prova(() => b.computeSessionScaling(pb));
      assert.deepStrictEqual(sb, sa, 'scalatura ' + i);
      if (sa.ok) assert.deepStrictEqual(b.buildSessionSnapshotV1({ recipeId: 'r', variantId: 'v', recipeName: 'R' }, sb.ok), a.buildSessionSnapshotV1({ recipeId: 'r', variantId: 'v', recipeName: 'R' }, sa.ok), 'snapshot ' + i);
    });
  });
  test('Q3. firma delle bozze (firmaContenutoBozza): identica, nessuna bozza precedente risulta modificata', () => {
    C.forEach((ings, i) => { const v = { name: 'R' + i, portionsCount: 4, gramsPerPortion: 200, portionUnit: 'g', steps: ['x'], ingredients: ings };
      assert.strictEqual(b.firmaContenutoBozza(v), a.firmaContenutoBozza(v), 'firma ' + i); });
  });
  test('Q4. salvataggio e rilettura: nessun campo nuovo inviato o letto per gli ingredienti senza tipo (codice)', () => {
    const save = fn(ORA, 'async function saveToSupabase(recipe)'), val = fn(ORA, 'function buildValidatedVariantPayload(recipeId,vv)'), load = fn(ORA, 'async function loadFromSupabase()');
    // Campi P0-c solo dentro un ramo condizionato al tipo di quantita'; qty identica per le righe senza tipo.
    for (const s of [save, val]) {
      assert.ok(/\.\.\.\(\(ing\.qtyKind==='certa'\|\|ing\.qtyKind==='variabile'\|\|ing\.qtyKind==='mancante'\|\|ing\.qtyKind==='intervallo'\)\?\{qty_kind:/.test(s), 'payload condizionato');
      assert.ok(s.includes(":(parseFloat(ing.qty)||0)"), 'qty come prima per le righe senza tipo');
    }
    assert.ok(/const quantitaDaRiga=i=>\(i\.qty_kind==='certa'[\s\S]*?:\{\};/.test(load) && load.includes(':(parseFloat(i.qty)||0)'), 'rilettura invariata per le righe senza tipo');
    // Esecuzione della stessa espressione su righe precedenti: nessuna chiave in piu'.
    const espr = save.match(/\.\.\.(\(\(ing\.qtyKind[\s\S]*?:\{\}\))/)[1];
    const campi = new Function('ing', 'return ' + espr + ';');
    C.flat().forEach(ing => assert.deepStrictEqual(campi(ing), {}, ing.id));
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed' + (skipped ? ', ' + skipped + ' skipped' : ''));
  process.exit(failed ? 1 : 0);
})();
