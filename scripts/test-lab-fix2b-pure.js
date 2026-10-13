/*
 * Test — LAB FIX 2B / I1: funzioni pure per resa dichiarata, pesi della
 * formulazione e conversioni reversibili.
 *
 * Esegue codice REALE estratto da khub_mvp.html (stessa tecnica degli altri
 * test): le nuove funzioni e le primitive del motore di Produzione che
 * riusano. Solo dati sintetici, nessuna rete, nessun DB.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'khub_mvp.html'), 'utf8');
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ok - ' + name); passed++; }
  catch (e) { console.log('  FAIL - ' + name); console.log('    ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n    ') : e)); failed++; }
}
function extractFunction(startMarker) {
  const start = html.indexOf(startMarker);
  if (start === -1) throw new Error('marker non trovato: ' + startMarker);
  const braceStart = html.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error('graffe non bilanciate: ' + startMarker);
}
function extractVar(regex) { const m = html.match(regex); if (!m) throw new Error('var non trovata: ' + regex); return m[0]; }

const SRC = [
  'function cnum(n)', 'function normalizeIngredientName(name)', 'function getStructuredSteps(legacySteps,stepsV2)',
  'function sessionScalingUnitFamily(unit)', 'function sessionScalingGenericFamilyTable(family)',
  'function resolveSessionScalingConversionToGrams(unit,conversionFact)', 'function chooseConversionAskUnit(unit)',
  'function resolveKnownProductionConversionFact(normalizedName,unit)',
  'function buildPreparedInputDaRicettaAttiva(recipe,vv,targetPortions,targetGramsPerPortion)',
  'function computeSessionScaling(input)',
  // I1
  'function parseLocaleNumber(value)', 'function normalizeDeclaredYield(qty,unit)', 'function classifyYieldUnit(unit)',
  'function computeFormulationWeights(ingredients,resolveFact)', 'function deriveYieldPerUnit(weights,declared)',
  'function ingredientGramsPerUnit(unit,ingredientName,resolver)', 'function convertIngredientQty(qty,fromUnit,toUnit,ingredientName,resolveFact)',
  'function canonicalQty(x)',
].map(extractFunction).concat(html.match(/var SESSION_SCALING_[A-Z_]+=\{[^}]*\};/g), [
  extractVar(/var DECLARED_YIELD_UNIT_MAX_LENGTH=\d+;/),
  extractVar(/var DECLARED_YIELD_UNIT_ALIASES=\{[\s\S]*?\n\};/),
]).join('\n');

// Stato sintetico delle conversioni (stesse strutture caricate da loadFromSupabase).
function makeS() {
  return {
    // pesi di riferimento cablati (nessuna fact): 'reference_data'
    unitWeights: { 'uova': 55, 'tuorli': 18, 'uova confermate': 55.37 },
    // fact n->g confermate dallo chef
    unitWeightFacts: { 'uova confermate': { id: 'icU', sourceType: 'chef_confirmed', sourceDetail: null } },
    // fact non 'n': chiave nome|askUnit|g
    productionConversionFacts: {
      'latte|ml|g': { id: 'icL', factor: 1.03, sourceType: 'chef_confirmed', sourceDetail: null },
      'zucchero|tbsp|g': { id: 'icZ', factor: 12.5, sourceType: 'chef_confirmed', sourceDetail: null },
      'miele|tsp|g': { id: 'icM', factor: 7, sourceType: 'chef_confirmed', sourceDetail: null },
      'uova confermate|ml|g': { id: 'icUM', factor: 1.035, sourceType: 'chef_confirmed', sourceDetail: null },
    },
  };
}
const S = makeS();
const api = new Function('S', SRC + `; return { parseLocaleNumber, normalizeDeclaredYield, classifyYieldUnit, computeFormulationWeights,
  deriveYieldPerUnit, convertIngredientQty, canonicalQty, buildPreparedInputDaRicettaAttiva, computeSessionScaling };`)(S);

const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const ing = (id, name, qty, unit, y = null, extra = {}) => ({ id, name, qty, unit, estimatedYieldPct: y, ...extra });
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const BISCOTTI = [ing('a', 'Farina', 500, 'g', 70), ing('b', 'Burro', 0.25, 'kg', 70), ing('c', 'Zucchero', 150, 'g', 70)];

console.log('I1 — pesi della formulazione');

test('W1. g e kg con resa: Farina 500 g, Burro 0,25 kg, Zucchero 150 g, resa 70% -> crudo 900, finito 630', () => {
  const w = api.computeFormulationWeights(BISCOTTI);
  assert.strictEqual(w.status, 'complete');
  assert.ok(near(w.raw, 900) && near(w.finished, 630), `${w.raw} / ${w.finished}`);
  assert.ok(near(w.byId.b.rawGrams, 250) && near(w.byId.b.finishedGrams, 175));
});

test('W2. rese diverse: null = 100%, 0 = evapora, 150% = aumenta', () => {
  const w = api.computeFormulationWeights([ing('a', 'Riso', 1000, 'g'), ing('b', 'Vino', 200, 'g', 0), ing('c', 'Legumi', 300, 'g', 150)]);
  assert.strictEqual(w.status, 'complete');
  assert.ok(near(w.raw, 1500) && near(w.finished, 1450));
});

test('W3. conversioni mancanti: risultato esplicitamente incompleto, nessun totale', () => {
  const w = api.computeFormulationWeights([ing('a', 'Farina', 500, 'g'), ing('b', 'Uova bio', 3, 'n'), ing('c', 'Panna', 200, 'ml'), ing('d', 'Sale', 1, 'tsp')]);
  assert.strictEqual(w.status, 'incomplete');
  assert.deepStrictEqual(w.missing.map(m => [m.name, m.unit, m.askUnit]), [['Uova bio', 'n', 'n'], ['Panna', 'ml', 'ml'], ['Sale', 'tsp', 'tsp']]);
  assert.ok(!('raw' in w) && !('finished' in w));
});

test('W4. dati non validi: resa negativa o testo, quantita\' negativa, unita\' mancante', () => {
  const w = api.computeFormulationWeights([ing('a', 'A', 100, 'g', -5), ing('b', 'B', 100, 'g', '70'), ing('c', 'C', -1, 'g'), ing('d', 'D', 5, '')]);
  assert.strictEqual(w.status, 'invalid');
  assert.deepStrictEqual(w.invalid.map(x => x.reason), ['invalid_yield', 'invalid_yield', 'negative_qty', 'missing_unit']);
});

test('W5. formulazione vuota', () => {
  assert.deepStrictEqual(api.computeFormulationWeights([]), { status: 'empty' });
  assert.deepStrictEqual(api.computeFormulationWeights(null), { status: 'empty' });
});

test('W6. pesi di riferimento cablati riconoscibili (reference_data), fact confermate no', () => {
  const w = api.computeFormulationWeights([ing('a', 'Uova', 3, 'n'), ing('b', 'Uova confermate', 2, 'n')]);
  assert.strictEqual(w.status, 'complete');
  assert.ok(near(w.raw, 3 * 55 + 2 * 55.37));
  assert.deepStrictEqual(w.referenceDataUsed.map(r => r.name), ['Uova']);
  assert.strictEqual(w.byId.b.conversionSourceType, 'chef_confirmed');
});

console.log('I1 — parita\' con il motore di Produzione (12 formulazioni)');
const FORMULATIONS = [
  ['solo g', [ing('1', 'Farina', 500, 'g'), ing('2', 'Acqua', 300, 'g')]],
  ['g + kg', [ing('1', 'Farina', 1.2, 'kg'), ing('2', 'Sale', 24, 'g')]],
  ['n con peso di riferimento', [ing('1', 'Uova', 4, 'n'), ing('2', 'Zucchero', 120, 'g')]],
  ['n con fact confermata', [ing('1', 'Uova confermate', 7, 'n', 90), ing('2', 'Farina', 250, 'g')]],
  ['ml con fact', [ing('1', 'Latte', 500, 'ml', 90), ing('2', 'Amido', 40, 'g')]],
  ['l con fact ml->g', [ing('1', 'Latte', 1.5, 'l', 85)]],
  ['cl con fact ml->g', [ing('1', 'Latte', 25, 'cl'), ing('2', 'Zucchero', 0.1, 'kg')]],
  ['tbsp e tsp con fact', [ing('1', 'Zucchero', 3, 'tbsp'), ing('2', 'Miele', 2, 'tsp', 100)]],
  ['rese null/0/70/100/150', [ing('1', 'A', 100, 'g'), ing('2', 'B', 100, 'g', 0), ing('3', 'C', 100, 'g', 70), ing('4', 'D', 100, 'g', 100), ing('5', 'E', 100, 'g', 150)]],
  ['mattoncino', [ing('1', 'Frolla TEST', 200, 'g', null, { isSubRecipe: true, subRecipeId: 'vaF' }), ing('2', 'Crema', 0.3, 'kg', 95)]],
  ['quantita\' 0 e decimali', [ing('1', 'Sale', 0.37, 'g'), ing('2', 'Lievito', 0, 'g'), ing('3', 'Farina', 1234.5, 'g', 88)]],
  ['tutte le unita\'', [ing('1', 'Farina', 0.5, 'kg', 70), ing('2', 'Latte', 0.2, 'l', 90), ing('3', 'Uova', 3, 'n', 85), ing('4', 'Zucchero', 2, 'tbsp'), ing('5', 'Miele', 1, 'tsp'), ing('6', 'Burro', 125.25, 'g', 80)]],
];
FORMULATIONS.forEach(([label, ingredients], k) => {
  test(`P${k + 1}. ${label}: crudo e finito identici al motore (stesso valore binario)`, () => {
    const vv = { id: 'v', name: 'X', ingredients, steps: [], stepsV2: [] };
    const engine = api.computeSessionScaling(api.buildPreparedInputDaRicettaAttiva({ id: 'r', name: 'R' }, vv, 1, 1));
    const w = api.computeFormulationWeights(ingredients);
    assert.strictEqual(w.status, 'complete');
    assert.strictEqual(w.raw, engine.baseRawTotal);
    assert.strictEqual(w.finished, engine.baseExpectedFinishedTotal);
    engine.ingredients.forEach(e => { assert.strictEqual(w.byId[e.itemKey].rawGrams, e.rawGrams); assert.strictEqual(w.byId[e.itemKey].finishedGrams, e.finishedGrams); });
  });
});

console.log('I1 — resa dichiarata');

test('Y1. 900 g crudi / 630 g finiti: 30 pz -> 30 / 21 g; 32 pz -> 28,125 / 19,6875 g; ingredienti invariati', () => {
  const ingredients = deepFreeze(JSON.parse(JSON.stringify(BISCOTTI)));
  const before = JSON.stringify(ingredients);
  const w = api.computeFormulationWeights(ingredients);
  const y30 = api.deriveYieldPerUnit(w, api.normalizeDeclaredYield(30, 'pz').value);
  const y32 = api.deriveYieldPerUnit(w, api.normalizeDeclaredYield(32, 'pz').value);
  assert.ok(near(y30.rawPerUnit, 30) && near(y30.finishedPerUnit, 21));
  assert.ok(near(y32.rawPerUnit, 28.125) && near(y32.finishedPerUnit, 19.6875));
  assert.ok(near(w.raw, 900) && near(w.finished, 630), 'i totali non cambiano con la resa');
  assert.strictEqual(JSON.stringify(ingredients), before);
});

test('Y2. unita\' personalizzate e classi (contabile, massa, volume)', () => {
  const w = api.computeFormulationWeights(BISCOTTI);
  const teglia = api.deriveYieldPerUnit(w, api.normalizeDeclaredYield(2, '  teglia   30×40 ').value);
  assert.strictEqual(teglia.kind, 'count'); assert.strictEqual(teglia.unit, 'teglia 30×40'); assert.ok(near(teglia.finishedPerUnit, 315));
  const vasetti = api.deriveYieldPerUnit(w, api.normalizeDeclaredYield('6', 'vasetti').value);
  assert.ok(near(vasetti.finishedPerUnit, 105));
  const kg = api.deriveYieldPerUnit(w, api.normalizeDeclaredYield('0,6', 'Kg.').value);
  assert.strictEqual(kg.kind, 'mass'); assert.ok(near(kg.declaredGrams, 600) && near(kg.deltaGrams, -30));
  const litri = api.deriveYieldPerUnit(w, api.normalizeDeclaredYield(1.5, 'litri').value);
  assert.strictEqual(litri.kind, 'volume'); assert.ok(near(litri.declaredMl, 1500)); assert.ok(!('finishedPerUnit' in litri));
  assert.deepStrictEqual(['GR', 'chili', 'LT', 'cl', 'pz', 'porzioni'].map(u => api.classifyYieldUnit(u).kind), ['mass', 'mass', 'volume', 'volume', 'count', 'count']);
});

test('Y3. resa con pesi incompleti o assente', () => {
  const inc = api.computeFormulationWeights([ing('a', 'Uova bio', 3, 'n')]);
  assert.deepStrictEqual(api.deriveYieldPerUnit(inc, { qty: 30, unit: 'pz' }), { status: 'incomplete', kind: 'count' });
  assert.strictEqual(api.deriveYieldPerUnit(api.computeFormulationWeights(BISCOTTI), null), null);
});

test('Y4. normalizeDeclaredYield: validi, non dichiarata, rifiuti', () => {
  const ok = (q, u) => api.normalizeDeclaredYield(q, u);
  assert.deepStrictEqual(ok(30, 'pz'), { ok: true, value: { qty: 30, unit: 'pz' } });
  assert.deepStrictEqual(ok('30', 'pz'), { ok: true, value: { qty: 30, unit: 'pz' } });
  assert.deepStrictEqual(ok('2,5', 'kg'), { ok: true, value: { qty: 2.5, unit: 'kg' } });
  assert.deepStrictEqual(ok(null, null), { ok: true, value: null });
  assert.deepStrictEqual(ok('  ', ' '), { ok: true, value: null });
  const err = (q, u) => api.normalizeDeclaredYield(q, u).error;
  assert.strictEqual(err(0, 'pz'), 'invalid_qty');
  assert.strictEqual(err(-1, 'pz'), 'invalid_qty');
  assert.strictEqual(err('abc', 'pz'), 'invalid_qty');
  assert.strictEqual(err(Infinity, 'pz'), 'invalid_qty');
  assert.strictEqual(err('1.234,5', 'g'), 'invalid_qty');
  assert.strictEqual(err(30, ''), 'missing_unit');
  assert.strictEqual(err('', 'pz'), 'missing_qty');
  assert.strictEqual(err(30, 'x'.repeat(41)), 'unit_too_long');
  assert.strictEqual(err(30, 5), 'invalid_unit');
});

console.log('I1 — conversioni reversibili');
const conv = (q, a, b, name) => api.convertIngredientQty(q, a, b, name);

test('C1. g <-> kg e ml <-> cl <-> l esatti, senza fact', () => {
  assert.deepStrictEqual(conv(1234, 'g', 'kg', 'Farina'), { ok: true, qty: 1.234, usedFacts: [] });
  assert.strictEqual(conv(1.234, 'kg', 'g', 'Farina').qty, 1234);
  assert.strictEqual(conv(3, 'g', 'kg', 'Lievito').qty, 0.003);
  assert.strictEqual(conv(0.003, 'kg', 'g', 'Lievito').qty, 3);
  assert.strictEqual(conv(250, 'ml', 'l', 'Acqua').qty, 0.25);
  assert.strictEqual(conv(0.25, 'l', 'cl', 'Acqua').qty, 25);
  assert.strictEqual(conv(25, 'cl', 'ml', 'Acqua').qty, 250);
});

test('C2. pezzi <-> g con la stessa fact, in entrambi i versi; peso di riferimento segnalato', () => {
  const g = conv(3, 'n', 'g', 'Uova');
  assert.strictEqual(g.qty, 165);
  assert.deepStrictEqual(g.usedFacts, [{ sourceType: 'reference_data', factId: null }]);
  assert.strictEqual(conv(165, 'g', 'n', 'Uova').qty, 3);
  assert.strictEqual(conv(0.165, 'kg', 'n', 'Uova').qty, 3);
  const c = conv(7, 'n', 'g', 'Uova confermate');
  assert.ok(near(c.qty, 387.59, 1e-9));
  assert.deepStrictEqual(c.usedFacts, [{ sourceType: 'chef_confirmed', factId: 'icU' }]);
  assert.strictEqual(api.canonicalQty(conv(c.qty, 'g', 'n', 'Uova confermate').qty), 7);
});

test('C3. ml / l / tbsp / tsp <-> g solo con fact dell\'ingrediente', () => {
  assert.ok(near(conv(250, 'ml', 'g', 'Latte').qty, 257.5));
  assert.ok(near(conv(257.5, 'g', 'ml', 'Latte').qty, 250));
  assert.ok(near(conv(1.5, 'l', 'g', 'Latte').qty, 1545));
  assert.strictEqual(conv(2, 'tbsp', 'g', 'Zucchero').qty, 25);
  assert.strictEqual(conv(25, 'g', 'tbsp', 'Zucchero').qty, 2);
});

test('C4. conversione mancante: richiesta esplicita, mai un cambio della sola etichetta', () => {
  assert.deepStrictEqual(conv(250, 'ml', 'g', 'Panna'), { ok: false, error: 'missing_conversion', needs: [{ unit: 'ml', askUnit: 'ml' }] });
  assert.deepStrictEqual(conv(2, 'tbsp', 'g', 'Sale'), { ok: false, error: 'missing_conversion', needs: [{ unit: 'tbsp', askUnit: 'tbsp' }] });
  assert.deepStrictEqual(conv(165, 'g', 'n', 'Uova bio'), { ok: false, error: 'missing_conversion', needs: [{ unit: 'n', askUnit: 'n' }] });
  assert.deepStrictEqual(conv(100, 'g', 'ml', 'Farina'), { ok: false, error: 'missing_conversion', needs: [{ unit: 'ml', askUnit: 'ml' }] });
});

test('C5. unita\' non di massa tra loro: via grammi solo con entrambe le fact', () => {
  const r = conv(3, 'n', 'ml', 'Uova confermate');
  assert.strictEqual(r.ok, true); assert.ok(near(r.qty, 3 * 55.37 / 1.035));
  assert.strictEqual(r.usedFacts.length, 2);
  assert.deepStrictEqual(conv(3, 'n', 'ml', 'Uova').needs, [{ unit: 'ml', askUnit: 'ml' }]);
  assert.deepStrictEqual(conv(3, 'n', 'tsp', 'Uova bio').needs, [{ unit: 'n', askUnit: 'n' }, { unit: 'tsp', askUnit: 'tsp' }]);
});

test('C6. input non validi e stessa unita\'', () => {
  assert.strictEqual(conv(-1, 'g', 'kg', 'X').error, 'invalid_qty');
  assert.strictEqual(conv('abc', 'g', 'kg', 'X').error, 'invalid_qty');
  assert.strictEqual(conv(5, '', 'kg', 'X').error, 'invalid_unit');
  assert.deepStrictEqual(conv('2,5', 'pz', 'pz', 'X'), { ok: true, qty: 2.5, usedFacts: [] });
});

console.log('I1 — precisione: andata e ritorno ripetuti');

test('R1. 1000 andate e ritorni g <-> kg e n <-> g: con canonicalQty al salvataggio nessuna deriva', () => {
  const values = [0.37, 3, 1234, 387.59, 0.001, 98765.4321];
  values.forEach(v0 => {
    let v = v0;
    for (let k = 0; k < 1000; k++) v = api.canonicalQty(conv(api.canonicalQty(conv(v, 'g', 'kg', 'X').qty), 'kg', 'g', 'X').qty);
    assert.strictEqual(v, v0, `g/kg ${v0} -> ${v}`);
  });
  let n = 7;
  for (let k = 0; k < 1000; k++) n = api.canonicalQty(conv(api.canonicalQty(conv(n, 'n', 'g', 'Uova confermate').qty), 'g', 'n', 'Uova confermate').qty);
  assert.strictEqual(n, 7);
});

test('R2. senza canonicalQty la deriva resta sotto 1e-12 relativo (solo residui binari)', () => {
  let v = 387.59, n = 7;
  for (let k = 0; k < 1000; k++) { v = conv(conv(v, 'g', 'kg', 'X').qty, 'kg', 'g', 'X').qty; n = conv(conv(n, 'n', 'g', 'Uova confermate').qty, 'g', 'n', 'Uova confermate').qty; }
  assert.ok(Math.abs(v - 387.59) / 387.59 < 1e-12, String(v));
  assert.ok(Math.abs(n - 7) / 7 < 1e-12, String(n));
});

test('R3. canonicalQty: idempotente, non tronca decimali significativi', () => {
  [0.000123456, 12345.6789, 0.37, 1 / 3, 1e-9, 123456789012345].forEach(x => { const c = api.canonicalQty(x); assert.strictEqual(api.canonicalQty(c), c); assert.ok(Math.abs(c - x) / Math.abs(x) < 1e-14); });
  assert.strictEqual(api.canonicalQty(7.000000000000001), 7);
  assert.strictEqual(api.canonicalQty(0.1 + 0.2), 0.3);
  assert.strictEqual(api.canonicalQty(0.000123456), 0.000123456);
});

console.log('I1 — nessuna mutazione degli input');

test('M1. ingredienti, resa e stato delle conversioni invariati dopo tutte le chiamate', () => {
  const ingredients = deepFreeze(JSON.parse(JSON.stringify(FORMULATIONS[11][1])));
  const declared = deepFreeze({ qty: 30, unit: 'pz' });
  const sBefore = JSON.stringify(S);
  const w = api.computeFormulationWeights(ingredients);
  api.deriveYieldPerUnit(deepFreeze(w), declared);
  api.normalizeDeclaredYield('30', 'pz');
  ingredients.forEach(i => conv(i.qty, i.unit, 'g', i.name));
  assert.strictEqual(JSON.stringify(S), sBefore);
  assert.deepStrictEqual(ingredients, JSON.parse(JSON.stringify(FORMULATIONS[11][1])));
});

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
