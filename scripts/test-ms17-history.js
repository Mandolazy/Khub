/*
 * Test Sprint Produzione — MS17a: motore dati dello Storico Produzioni.
 * Nessun framework: Node puro + assert.
 *
 * Funzioni REALI estratte da khub_mvp.html (motore puro: nessuna UI, nessuna
 * rete). Fuso orario fissato a Europe/Rome perche' il filtro temporale usa il
 * giorno LOCALE di completed_at: i casi a cavallo della mezzanotte sono
 * costruiti apposta su istanti UTC che cadono nel giorno locale successivo.
 */
process.env.TZ = 'Europe/Rome';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'khub_mvp.html'), 'utf8');
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ok - ' + name); passed++; }
  catch (e) { console.log('  FAIL - ' + name); console.log('    ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n    ') : e)); failed++; }
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

const SRC = [
  'function sessionDurationSeconds(startedIso,completedIso)',
  'function historyNormalizeText(value)', 'function historyLocalDayKey(iso)', 'function historyNormalizePeriod(period)',
  'function historyNumberOrNull(v)', 'function buildHistoryRecord(sess)', 'function historyMatchesQuery(record,query)',
  'function historyMatchesPeriod(record,period)', 'function selectHistoryRecords(sessions,filters)',
  'function aggregateHistoryRecords(records)', 'function groupHistoryByPreparation(records)',
].map(extractFunction).join('\n');
// Il motore non deve leggere S: lo si passa come oggetto vuoto e "avvelenato".
const S = new Proxy({}, { get() { throw new Error('il motore dello Storico non deve leggere S'); } });
const H = new Function('S', SRC + `
  return { historyNormalizeText, historyLocalDayKey, historyNormalizePeriod, buildHistoryRecord, historyMatchesQuery,
    historyMatchesPeriod, selectHistoryRecords, aggregateHistoryRecords, groupHistoryByPreparation };`)(S);

// Sessione nella forma di S.productionSessions (loadProductionSessions).
let seq = 0;
function sess(o = {}) {
  seq++;
  return {
    id: o.id || ('ps' + String(seq).padStart(3, '0')),
    recipeId: 'recipeId' in o ? o.recipeId : 'r-tiramisu',
    sourceVariantId: 'sourceVariantId' in o ? o.sourceVariantId : 'v-tiramisu-1',
    status: o.status || 'completed',
    snapshotVersion: 1,
    snapshot: {
      snapshotVersion: 1,
      recipe: { recipeId: 'recipeId' in o ? o.recipeId : 'r-tiramisu', recipeName: o.recipeName || 'Tiramisù',
        variantId: 'sourceVariantId' in o ? o.sourceVariantId : 'v-tiramisu-1', variantName: o.variantName || 'Classico v1' },
      target: { targetPortions: 10, targetGramsPerPortion: 500, targetFinishedTotal: o.target != null ? o.target : 5000, normalizationUnit: 'g' },
      ingredients: [], steps: [],
    },
    targetFinishedTotal: o.target != null ? o.target : 5000,
    createdAt: '2026-10-01T06:00:00.000Z',
    startedAt: 'startedAt' in o ? o.startedAt : '2026-10-07T07:00:00.000Z',
    completedAt: 'completedAt' in o ? o.completedAt : '2026-10-07T09:00:00.000Z',
    actualYieldQty: 'actual' in o ? o.actual : null,
    actualYieldUnit: 'actual' in o && o.actual != null ? (o.unit || 'g') : null,
  };
}
const ids = (r) => r.records.map(x => x.sessionId);
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, (msg || '') + ' atteso ' + b + ', ottenuto ' + a);

console.log('MS17a — Storico Produzioni: motore dati');

// ── Selezione ──────────────────────────────────────────────
test('1-3. solo completed: pending e in_progress escluse', () => {
  const out = H.selectHistoryRecords([sess({ id: 'p', status: 'pending', startedAt: null, completedAt: null }),
    sess({ id: 'i', status: 'in_progress', completedAt: null }), sess({ id: 'c' })], {});
  assert.deepStrictEqual(ids(out), ['c']);
  assert.strictEqual(H.buildHistoryRecord(sess({ status: 'in_progress' })), null);
});

// ── Ricerca ────────────────────────────────────────────────
test('4-7. ricerca case/accent-insensitive su recipeName e variantName, parole in AND', () => {
  const list = [sess({ id: 't', recipeName: 'Tiramisù', variantName: 'Classico v1' }),
    sess({ id: 'r', recipeName: 'Risotto ai funghi', variantName: 'Porcini' })];
  for (const q of ['tiramisu', 'TIRAMISÙ', 'tIrAmIsù', '  tiramisu  ']) assert.deepStrictEqual(ids(H.selectHistoryRecords(list, { query: q })), ['t'], q);
  assert.deepStrictEqual(ids(H.selectHistoryRecords(list, { query: 'porcini' })), ['r'], 'variantName');
  assert.deepStrictEqual(ids(H.selectHistoryRecords(list, { query: 'tiramisu classico' })), ['t'], 'parole su nome + versione');
  assert.deepStrictEqual(ids(H.selectHistoryRecords(list, { query: 'tiramisu porcini' })), [], 'parole in AND');
  assert.deepStrictEqual(ids(H.selectHistoryRecords(list, { query: '' })).length, 2, 'query vuota');
  assert.strictEqual(H.historyNormalizeText('Crème  BRÛLÉE'), 'creme brulee');
});

// ── Periodo (completed_at, giorno locale) ──────────────────
const days = () => [
  sess({ id: 'd06', completedAt: '2026-10-06T21:59:59.000Z' }), // 06/10 23:59:59 Roma
  sess({ id: 'd07a', completedAt: '2026-10-06T22:00:00.000Z' }), // 07/10 00:00:00 Roma
  sess({ id: 'd07b', completedAt: '2026-10-07T21:59:59.000Z' }), // 07/10 23:59:59 Roma
  sess({ id: 'd08', completedAt: '2026-10-07T22:00:00.000Z' }), // 08/10 00:00:00 Roma
  sess({ id: 'd31', completedAt: '2026-10-31T10:00:00.000Z' }),
];
test('8. nessun limite temporale: tutte le completed', () => {
  assert.strictEqual(H.selectHistoryRecords(days(), {}).records.length, 5);
  assert.strictEqual(H.selectHistoryRecords(days(), { period: { from: '', to: null } }).records.length, 5);
});
test('9. singola data = giorno locale di completed_at (inizio e fine giornata inclusi)', () => {
  assert.deepStrictEqual(ids(H.selectHistoryRecords(days(), { period: { date: '2026-10-07' } })).sort(), ['d07a', 'd07b']);
  assert.deepStrictEqual(ids(H.selectHistoryRecords(days(), { period: { from: '2026-10-07', to: '2026-10-07' } })).sort(), ['d07a', 'd07b']);
});
test('10-13. intervallo inclusivo: estremi inclusi, fuori intervallo escluso; limiti aperti', () => {
  assert.deepStrictEqual(ids(H.selectHistoryRecords(days(), { period: { from: '2026-10-07', to: '2026-10-08' } })).sort(), ['d07a', 'd07b', 'd08']);
  assert.ok(!ids(H.selectHistoryRecords(days(), { period: { from: '2026-10-07', to: '2026-10-08' } })).includes('d06'), 'prima: esclusa');
  assert.ok(!ids(H.selectHistoryRecords(days(), { period: { from: '2026-10-07', to: '2026-10-08' } })).includes('d31'), 'dopo: esclusa');
  assert.deepStrictEqual(ids(H.selectHistoryRecords(days(), { period: { from: '2026-10-08' } })).sort(), ['d08', 'd31'], 'solo from');
  assert.deepStrictEqual(ids(H.selectHistoryRecords(days(), { period: { to: '2026-10-06' } })), ['d06'], 'solo to');
});
test('14. iniziata il 07/10 23:30 e completata l\'08/10 01:15 -> appartiene all\'8 ottobre', () => {
  const s = sess({ id: 'night', startedAt: '2026-10-07T21:30:00.000Z', completedAt: '2026-10-07T23:15:00.000Z' });
  assert.deepStrictEqual(ids(H.selectHistoryRecords([s], { period: { date: '2026-10-08' } })), ['night']);
  assert.deepStrictEqual(ids(H.selectHistoryRecords([s], { period: { date: '2026-10-07' } })), []);
  const r = H.buildHistoryRecord(s);
  assert.deepStrictEqual([r.startedAt, r.completedAt, r.completedDay], ['2026-10-07T21:30:00.000Z', '2026-10-07T23:15:00.000Z', '2026-10-08']);
  assert.strictEqual(r.durationSeconds, 105 * 60);
});
test('15. ricerca + periodo = AND', () => {
  const list = [sess({ id: 'tOct', completedAt: '2026-10-15T10:00:00.000Z' }), sess({ id: 'tNov', completedAt: '2026-11-02T10:00:00.000Z' }),
    sess({ id: 'rOct', recipeId: 'r-risotto', recipeName: 'Risotto', variantName: 'Base', completedAt: '2026-10-15T10:00:00.000Z' })];
  assert.deepStrictEqual(ids(H.selectHistoryRecords(list, { query: 'tiramisù', period: { from: '2026-10-01', to: '2026-10-31' } })), ['tOct']);
});
test('extra. periodo non valido: errore esplicito e nessun risultato, mai un filtro ignorato', () => {
  for (const p of [{ from: '2026-10-08', to: '2026-10-07' }, { date: '07/10/2026' }, { from: '2026-02-30' }, { to: 'ieri' }]) {
    const out = H.selectHistoryRecords(days(), { period: p });
    assert.deepStrictEqual(out.records, [], JSON.stringify(p));
    assert.ok(out.error === 'invalid_range' || out.error === 'invalid_date', JSON.stringify(p));
  }
  assert.strictEqual(H.selectHistoryRecords(days(), {}).error, null);
});
test('extra. completed senza completed_at valido: presente senza periodo, esclusa da qualsiasi periodo', () => {
  const s = sess({ id: 'nodate', completedAt: null });
  assert.deepStrictEqual(ids(H.selectHistoryRecords([s], {})), ['nodate']);
  assert.deepStrictEqual(ids(H.selectHistoryRecords([s], { period: { from: '2000-01-01' } })), []);
  assert.strictEqual(H.buildHistoryRecord(s).durationSeconds, null);
});
test('extra. ordinamento: completed_at piu\' recente prima, id come criterio stabile', () => {
  const out = H.selectHistoryRecords([sess({ id: 'a', completedAt: '2026-10-07T09:00:00.000Z' }), sess({ id: 'c', completedAt: '2026-10-08T09:00:00.000Z' }),
    sess({ id: 'b', completedAt: '2026-10-07T09:00:00.000Z' })], {});
  assert.deepStrictEqual(ids(out), ['c', 'b', 'a']);
});

// ── Record singolo ─────────────────────────────────────────
test('16-17. durata derivata; resa prevista = target_finished_total congelato', () => {
  const r = H.buildHistoryRecord(sess({ startedAt: '2026-10-07T07:00:00.000Z', completedAt: '2026-10-07T09:15:30.000Z', target: 3200 }));
  assert.strictEqual(r.durationSeconds, 2 * 3600 + 15 * 60 + 30);
  assert.strictEqual(r.expectedYield, 3200);
  assert.strictEqual(r.expectedYieldUnit, 'g');
  assert.strictEqual(H.buildHistoryRecord(sess({ startedAt: null })).durationSeconds, null, 'senza started_at');
});
test('18+20-21. resa effettiva presente: scostamento assoluto e % (5000 -> 4720 = -280 g, -5,6%)', () => {
  const r = H.buildHistoryRecord(sess({ target: 5000, actual: 4720 }));
  assert.deepStrictEqual([r.actualYield, r.actualYieldUnit], [4720, 'g']);
  assert.strictEqual(r.absoluteDeviation, -280);
  close(r.percentageDeviation, -5.6);
  const up = H.buildHistoryRecord(sess({ target: 2000, actual: '2150' }));
  assert.strictEqual(up.actualYield, 2150, 'numeric da PostgREST come stringa');
  close(up.percentageDeviation, 7.5);
});
test('19+22. resa effettiva assente: nessuno scostamento, null mai trattato come zero', () => {
  const r = H.buildHistoryRecord(sess({ target: 5000 }));
  assert.strictEqual(r.actualYield, null);
  assert.strictEqual(r.actualYieldUnit, null);
  assert.strictEqual(r.absoluteDeviation, null);
  assert.strictEqual(r.percentageDeviation, null);
  const zero = H.buildHistoryRecord(sess({ target: 5000, actual: 0 }));
  assert.strictEqual(zero.actualYield, 0, 'uno zero esplicito resta zero');
});
test('extra. resa in unita\' diversa dalla prevista o prevista non valida: niente confronto', () => {
  const r = H.buildHistoryRecord(sess({ target: 5000, actual: 5, unit: 'kg' }));
  assert.strictEqual(r.absoluteDeviation, null);
  const bad = H.buildHistoryRecord(sess({ target: 0, actual: 100 }));
  assert.strictEqual(bad.percentageDeviation, null);
  assert.strictEqual(bad.absoluteDeviation, null);
});

// ── Aggregati ──────────────────────────────────────────────
const sample = () => H.selectHistoryRecords([
  sess({ id: 'a', target: 5000, actual: 4720 }),
  sess({ id: 'b', target: 3000, actual: 3150 }),
  sess({ id: 'c', target: 2000 }), // nessuna resa
], {}).records;
test('23-29. conteggio, totali, confrontabili sullo STESSO insieme, scostamento aggregato e copertura', () => {
  const a = H.aggregateHistoryRecords(sample());
  assert.strictEqual(a.count, 3);
  assert.strictEqual(a.totalExpected, 10000);
  assert.strictEqual(a.actualCount, 2);
  assert.strictEqual(a.totalActual, 7870);
  assert.strictEqual(a.comparableCount, 2);
  assert.strictEqual(a.totalExpectedComparable, 8000, 'solo le Sessioni con resa effettiva');
  assert.strictEqual(a.totalActualComparable, 7870);
  assert.strictEqual(a.aggregateDeviation, -130);
  close(a.aggregateDeviationPct, -1.625);
  assert.deepStrictEqual(a.coverage, { withActual: 2, total: 3 });
  assert.notStrictEqual(a.aggregateDeviation, a.totalActual - a.totalExpected, 'mai previsto di 3 vs effettivo di 2');
});
test('30. dataset vuoto', () => {
  const out = H.selectHistoryRecords([], {});
  assert.deepStrictEqual(out, { records: [], error: null });
  const a = H.aggregateHistoryRecords([]);
  assert.deepStrictEqual([a.count, a.totalExpected, a.actualCount, a.totalActual, a.aggregateDeviation, a.aggregateDeviationPct], [0, 0, 0, 0, null, null]);
  assert.deepStrictEqual(a.coverage, { withActual: 0, total: 0 });
  assert.deepStrictEqual(H.groupHistoryByPreparation([]), []);
  assert.deepStrictEqual(H.selectHistoryRecords(null, null).records, []);
});
test('31. una sola produzione (con e senza resa)', () => {
  const a = H.aggregateHistoryRecords(H.selectHistoryRecords([sess({ target: 5000, actual: 4720 })], {}).records);
  assert.deepStrictEqual([a.count, a.totalExpected, a.totalActual, a.aggregateDeviation], [1, 5000, 4720, -280]);
  close(a.aggregateDeviationPct, -5.6);
  const b = H.aggregateHistoryRecords(H.selectHistoryRecords([sess({ target: 5000 })], {}).records);
  assert.deepStrictEqual([b.count, b.totalExpected, b.actualCount, b.totalActual, b.aggregateDeviation, b.aggregateDeviationPct], [1, 5000, 0, 0, null, null]);
  assert.deepStrictEqual(b.coverage, { withActual: 0, total: 1 });
});

// ── Identita' della preparazione ───────────────────────────
test('32-33. stessa Scheda, piu\' versioni: 30 v1 + 20 v2 = 50 Tiramisù, versioni distinte per source_variant_id', () => {
  const list = [];
  for (let i = 0; i < 30; i++) list.push(sess({ sourceVariantId: 'v-tiramisu-1', variantName: 'Classico v1' }));
  for (let i = 0; i < 20; i++) list.push(sess({ sourceVariantId: 'v-tiramisu-2', variantName: 'Classico v2' }));
  list.push(sess({ recipeId: 'r-risotto', recipeName: 'Risotto', sourceVariantId: 'v-ris', variantName: 'Base' }));
  const groups = H.groupHistoryByPreparation(H.selectHistoryRecords(list, { query: 'tiramisu' }).records);
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].preparationId, 'r-tiramisu');
  assert.strictEqual(groups[0].count, 50);
  assert.deepStrictEqual(groups[0].variants.map(v => [v.sourceVariantId, v.count]), [['v-tiramisu-1', 30], ['v-tiramisu-2', 20]]);
  const all = H.groupHistoryByPreparation(H.selectHistoryRecords(list, {}).records);
  assert.deepStrictEqual(all.map(g => [g.preparationId, g.count]), [['r-tiramisu', 50], ['r-risotto', 1]]);
  const rec = H.buildHistoryRecord(list[0]);
  assert.deepStrictEqual([rec.preparationId, rec.sourceVariantId], ['r-tiramisu', 'v-tiramisu-1']);
});
test('extra. identita\' = recipe_id, mai il nome: Schede omonime separate, Scheda rinominata unita', () => {
  const list = [sess({ recipeId: 'r-a', recipeName: 'Crema', sourceVariantId: 'va' }), sess({ recipeId: 'r-b', recipeName: 'Crema', sourceVariantId: 'vb' }),
    sess({ recipeId: 'r-a', recipeName: 'Crema pasticcera', sourceVariantId: 'va', completedAt: '2026-10-09T09:00:00.000Z' })];
  const groups = H.groupHistoryByPreparation(H.selectHistoryRecords(list, {}).records);
  assert.deepStrictEqual(groups.map(g => [g.preparationId, g.count]), [['r-a', 2], ['r-b', 1]]);
  assert.strictEqual(groups[0].recipeName, 'Crema pasticcera', 'nome dello snapshot piu\' recente');
  assert.deepStrictEqual(groups[0].recipeNames.sort(), ['Crema', 'Crema pasticcera'], 'nomi storici conservati');
});
test('extra. senza recipe_id: fallback a snapshot.recipe.recipeId; senza nessuno dei due, gruppo per singola Sessione', () => {
  const s1 = sess({ recipeId: 'r-x' }); s1.recipeId = null; // solo nello snapshot
  assert.strictEqual(H.buildHistoryRecord(s1).preparationId, 'r-x');
  const n1 = sess({ id: 'n1', recipeId: null, recipeName: 'Senza Scheda' }), n2 = sess({ id: 'n2', recipeId: null, recipeName: 'Senza Scheda' });
  const groups = H.groupHistoryByPreparation(H.selectHistoryRecords([n1, n2], {}).records);
  assert.strictEqual(groups.length, 2, 'mai raggruppate per nome');
});
test('extra. aggregati per preparazione e per versione: confronto solo sulle Sessioni con resa', () => {
  const list = [sess({ sourceVariantId: 'v1', target: 5000, actual: 4800 }), sess({ sourceVariantId: 'v1', target: 5000 }),
    sess({ sourceVariantId: 'v2', target: 4000, actual: 4100 })];
  const g = H.groupHistoryByPreparation(H.selectHistoryRecords(list, {}).records)[0];
  assert.deepStrictEqual([g.aggregate.count, g.aggregate.totalExpected, g.aggregate.totalExpectedComparable, g.aggregate.aggregateDeviation], [3, 14000, 9000, -100]);
  assert.deepStrictEqual(g.aggregate.coverage, { withActual: 2, total: 3 });
  const v1 = g.variants.find(v => v.sourceVariantId === 'v1');
  assert.deepStrictEqual([v1.count, v1.aggregate.totalExpectedComparable, v1.aggregate.aggregateDeviation], [2, 5000, -200]);
});
test('34. nome storico dallo snapshot, indipendente dalla Ricetta corrente; motore senza accesso a S', () => {
  const s = sess({ recipeName: 'Tiramisù', variantName: 'Classico v1', target: 5000 });
  // la Ricetta "corrente" (fuori dal motore) puo' essere rinominata/riscalata: il record non cambia
  const r = H.buildHistoryRecord(s);
  assert.deepStrictEqual([r.recipeName, r.variantName, r.expectedYield], ['Tiramisù', 'Classico v1', 5000]);
  const prima = JSON.stringify(s);
  H.selectHistoryRecords([s], { query: 'tiramisu', period: { date: '2026-10-07' } });
  H.groupHistoryByPreparation([r]);
  assert.strictEqual(JSON.stringify(s), prima, 'nessuna mutazione dell\'input');
});

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
