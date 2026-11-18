/*
 * Test Fase 1A — Conoscenze consolidate (L3) in sola lettura e Storico di
 * Produzione per singola Ricetta. Node puro + assert.
 * Estrae da khub_mvp.html le funzioni reali (nuove e preesistenti) e le
 * esegue in un contesto isolato. La modalita' «Elenco» e le funzioni di
 * motore, salvataggio e MichelinAI sono confrontate con il codice al commit
 * f13b6d1 (stato prima della Fase 1A, letto con git show).
 * Uso: node scripts/test-fase1a-l3-storico.js
 */
process.env.TZ = 'Europe/Rome';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'khub_mvp.html'), 'utf8');
const htmlBase = execSync('git show f13b6d1:khub_mvp.html', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ok - ' + name); passed++; }
  catch (e) { console.log('  FAIL - ' + name + '\n    ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n    ') : e)); failed++; }
}
function extract(src, marker) {
  const start = src.indexOf(marker);
  if (start === -1) throw new Error('marker non trovato: ' + marker);
  const b = src.indexOf('{', start); let d = 0;
  for (let i = b; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) return src.slice(start, i + 1); } }
  throw new Error('graffe: ' + marker);
}

const COMUNI = [
  'function escAttr(s)', 'function historyNormalizeText(value)', 'function historyLocalDayKey(iso)', 'function historyNormalizePeriod(period)',
  'function historyNumberOrNull(v)', 'function buildHistoryRecord(sess)', 'function historyMatchesQuery(record,query)',
  'function historyMatchesPeriod(record,period)', 'function selectHistoryRecords(sessions,filters)', 'function aggregateHistoryRecords(records)',
  'function groupHistoryByPreparation(records)', 'function historyPeriodFromFilters(filters,now)', 'function historyErrorMessage(code)',
  'function formatHistoryQty(grams)', 'function formatHistorySigned(grams)', 'function formatHistoryPct(pct)', 'function formatHistoryWhen(iso)',
  'function historyVariantAddsInfo(recipeName,variantName)', 'function renderHistoryCount(count)', 'function renderHistoryCard(r)',
  'function renderStoricoProduzioni()', 'function sessionDurationSeconds(startedIso,completedIso)', 'function formatSessionDuration(seconds)',
  'function formatSessionTime(iso)', 'function resetHistoryFilters()', 'function onHistoryQueryInput(value)', 'function setHistoryPreset(preset)',
  'function goToStoricoProduzioni()', 'function openHistorySession(sessionId)',
];
const NUOVE = [
  'function groupHistoryByRecipeVersion(records)', 'function historySchedaDiRicetta(variantId)', 'function historySchedaVariantIds(recipeId)',
  'function apriProduzioniScheda(recipeId)', 'function togliFiltroSchedaStorico()', 'function azzeraFiltriStoricoConScheda()', 'function setHistoryView(v)',
  'function renderHistoryRicettaBlock(g)', 'function renderHistoryPerRicetta(records)',
  'function l3TestoValore(v,depth)', 'function l3Html(v)', 'function l3TrovaOrigine(recipe,l2Id)', 'function l3DataTesto(iso)',
  'function l3ConfermaTesto(origine)', 'function l3ProvenienzaTesto(p)', 'function toggleConoscenzeConsolidate(recipeId)',
  'function toggleDettaglioConoscenza(l3Id)', 'function renderConoscenzeConsolidate(recipe,ui)',
];

function client(src, conNuove) {
  const code = COMUNI.concat(conNuove ? NUOVE : []).map(m => extract(src, m)).join('\n');
  const S = { view: 'storico-produzioni', productionSessions: [], productionSessionsLoad: 'loaded', recipes: [],
    historyFilters: { query: '', preset: 'all', from: '', to: '' }, historyView: 'elenco', historyScheda: null,
    l3SezioneAperta: {}, l3DettaglioAperto: {} };
  const log = { renders: 0, loads: 0, opened: [] };
  const api = new Function('S', '__log', `
    function historyNow(){ return new Date('2026-10-07T10:00:00.000Z'); }
    function render(){ __log.renders++; }
    function loadProductionSessions(){ __log.loads++; }
    function apriSessioneOperativa(id,ret){ __log.opened.push([id,ret]); }
    ${code}
    return { renderStoricoProduzioni, selectHistoryRecords, groupHistoryByPreparation, resetHistoryFilters, openHistorySession,
      ${conNuove ? 'groupHistoryByRecipeVersion, historySchedaVariantIds, apriProduzioniScheda, togliFiltroSchedaStorico, azzeraFiltriStoricoConScheda, setHistoryView, renderConoscenzeConsolidate, toggleConoscenzeConsolidate, toggleDettaglioConoscenza, l3TestoValore,' : ''} };`)(S, log);
  return { S, api, log };
}

let seq = 0;
function sess(o) {
  seq++;
  const unit = o.unit || 'g';
  return {
    id: o.id || ('ps' + String(seq).padStart(3, '0')), recipeId: o.recipeId === undefined ? 'rA' : o.recipeId,
    sourceVariantId: o.variantId === undefined ? 'vA1' : o.variantId, status: o.status || 'completed', snapshotVersion: 1,
    snapshot: { snapshotVersion: 1, recipe: { recipeId: o.recipeId === undefined ? 'rA' : o.recipeId, recipeName: o.recipeName || 'Focaccia',
      variantId: o.variantId === undefined ? 'vA1' : o.variantId, variantName: o.variantName || 'Focaccia alta' },
      target: { targetFinishedTotal: o.target, normalizationUnit: unit } },
    targetFinishedTotal: o.target == null ? null : o.target, startedAt: o.startedAt || '2026-10-0' + (o.day || 5) + 'T07:00:00.000Z',
    completedAt: o.status && o.status !== 'completed' ? null : '2026-10-0' + (o.day || 5) + 'T08:30:00.000Z',
    actualYieldQty: o.actual == null ? null : o.actual, actualYieldUnit: o.actual == null ? null : 'g',
  };
}
const vis = h => h.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const senzaSelettore = h => h.replace(/\n    <div class="pg-tabs ms17-view-tabs"[\s\S]*?<\/button>\n    <\/div>/, '');

function datasetMisto() {
  seq = 0;
  return [
    sess({ id: 'a1', variantId: 'vA1', target: 5000, actual: 4700, day: 1 }),
    sess({ id: 'a2', variantId: 'vA1', target: 3000, actual: 3000, day: 3 }),
    sess({ id: 'a3', variantId: 'vA1', target: 2000, actual: null, day: 4 }),           // senza resa
    sess({ id: 'b1', variantId: 'vA2', variantName: 'Focaccia bassa', target: 1000, actual: 1200, day: 2 }), // altra Ricetta, stessa Scheda
    sess({ id: 'c1', recipeId: 'rC', recipeName: 'Tiramisù', variantId: 'vC1', variantName: 'Classico', target: 800, actual: 760, day: 6 }), // altra Scheda
    sess({ id: 'm1', recipeId: 'rVecchia', recipeName: 'Focaccia (vecchia Scheda)', variantId: 'vA3', variantName: 'Focaccia unita', target: 1000, actual: 900, day: 2 }), // Ricetta spostata con Unisci
    sess({ id: 'm2', recipeId: 'rA', recipeName: 'Focaccia', variantId: 'vA3', variantName: 'Focaccia unita', target: 1000, actual: 950, day: 7 }),
    sess({ id: 'x1', recipeId: null, variantId: null, recipeName: 'Senza id', variantName: 'Senza id', target: 500, actual: 400, day: 2 }), // dati storici incompleti
    sess({ id: 'p1', variantId: 'vA1', target: 5000, status: 'pending' }),
    sess({ id: 'u1', recipeId: 'rU', recipeName: 'Brodo', variantId: 'vU1', variantName: 'Brodo', target: 2000, unit: 'ml', actual: 1900, day: 3 }), // unità non confrontabile
  ];
}
const RICETTE = [
  { id: 'rA', name: 'Focaccia', labVersions: [{ id: 'lA', name: 'Bozza focaccia', l2Items: [] }],
    validatedVariants: [{ id: 'vA1', name: 'Focaccia alta', l2Items: [] }, { id: 'vA2', name: 'Focaccia bassa', l2Items: [] }, { id: 'vA3', name: 'Focaccia unita', l2Items: [] }], l3Items: [] },
  { id: 'rC', name: 'Tiramisù', labVersions: [], validatedVariants: [{ id: 'vC1', name: 'Classico', l2Items: [] }], l3Items: [] },
  { id: 'rU', name: 'Brodo', labVersions: [], validatedVariants: [{ id: 'vU1', name: 'Brodo', l2Items: [] }], l3Items: [] },
];

console.log('Fase 1A — Storico per singola Ricetta');

test('S1. Elenco invariato: con qualunque filtro, uscita identica a f13b6d1 (tolto solo il selettore Elenco | Per ricetta)', () => {
  const casi = [{ query: '', preset: 'all' }, { query: 'focaccia', preset: 'all' }, { query: 'zzz', preset: 'all' }, { query: '', preset: 'today' },
    { query: '', preset: 'custom', from: '2026-10-02', to: '2026-10-04' }, { query: '', preset: 'custom', from: '2026-10-09', to: '2026-10-01' }];
  for (const f of casi) {
    const n = client(html, true), o = client(htmlBase, false);
    for (const k of [n, o]) { k.S.productionSessions = datasetMisto(); k.S.recipes = RICETTE; k.S.historyFilters = Object.assign({ from: '', to: '' }, f); }
    const hn = n.api.renderStoricoProduzioni(), ho = o.api.renderStoricoProduzioni();
    assert.ok(hn.includes('data-history-view="elenco"') && hn.includes('data-history-view="ricetta"'), 'selettore presente');
    const an = senzaSelettore(hn).split('\n'), ao = ho.split('\n');
    const i = an.findIndex((l, k) => l !== ao[k]);
    assert.ok(i === -1 && an.length === ao.length, 'Elenco identico per ' + JSON.stringify(f) + (i === -1 ? '' : '\n      riga ' + i + '\n      nuova: ' + JSON.stringify(an[i]).slice(0, 220) + '\n      orig.: ' + JSON.stringify(ao[i]).slice(0, 220)));
  }
  for (const stato of ['loading', 'error', 'idle']) {
    const n = client(html, true), o = client(htmlBase, false);
    for (const k of [n, o]) { k.S.productionSessions = []; k.S.productionSessionsLoad = stato; }
    assert.strictEqual(senzaSelettore(n.api.renderStoricoProduzioni()), o.api.renderStoricoProduzioni(), 'stato ' + stato);
  }
});

test('S2. Stato vuoto invariato in entrambe le viste', () => {
  const n = client(html, true); n.S.productionSessions = [sess({ status: 'pending', target: 100 })];
  assert.ok(vis(n.api.renderStoricoProduzioni()).includes('Non ci sono ancora produzioni completate.'));
  n.S.historyView = 'ricetta';
  assert.ok(vis(n.api.renderStoricoProduzioni()).includes('Non ci sono ancora produzioni completate.'));
});

test('S3. Per ricetta: un gruppo per Ricetta (variant id); Ricette della stessa Scheda separate; Unisci non divide la Ricetta', () => {
  const n = client(html, true);
  const recs = n.api.selectHistoryRecords(datasetMisto(), {}).records;
  const g = n.api.groupHistoryByRecipeVersion(recs);
  const byKey = Object.fromEntries(g.map(x => [x.key, x]));
  assert.deepStrictEqual(Object.keys(byKey).sort(), ['s:x1', 'v:vA1', 'v:vA2', 'v:vA3', 'v:vC1', 'v:vU1'].sort());
  assert.deepStrictEqual(byKey['v:vA1'].records.map(r => r.sessionId), ['a3', 'a2', 'a1'], 'piu\' recente prima; pending escluso');
  assert.deepStrictEqual(byKey['v:vA3'].records.map(r => r.sessionId).sort(), ['m1', 'm2'], 'Ricetta unita: un solo gruppo nonostante recipe_id diversi');
  // La funzione esistente invece la divide (motivo per cui non e' usata qui).
  const vecchia = n.api.groupHistoryByPreparation(recs);
  const conVA3 = vecchia.filter(gr => gr.variants.some(v => v.sourceVariantId === 'vA3'));
  assert.strictEqual(conVA3.length, 2, 'groupHistoryByPreparation divide la Ricetta unita fra due Schede');
});

test('S4. Totali solo per singola Ricetta e solo su produzioni confrontabili; scostamento % ponderato, non media delle %', () => {
  const n = client(html, true);
  const g = n.api.groupHistoryByRecipeVersion(n.api.selectHistoryRecords(datasetMisto(), {}).records);
  const a1 = g.find(x => x.key === 'v:vA1');
  assert.strictEqual(a1.count, 3); assert.strictEqual(a1.withActual, 2);
  assert.strictEqual(a1.aggregate.comparableCount, 2);
  assert.strictEqual(a1.aggregate.totalExpectedComparable, 8000, 'la produzione senza resa non entra nei totali');
  assert.strictEqual(a1.aggregate.totalActualComparable, 7700);
  assert.strictEqual(a1.aggregate.aggregateDeviation, -300);
  assert.ok(Math.abs(a1.aggregate.aggregateDeviationPct - (-3.75)) < 1e-9, 'ponderato: -300/8000 = -3,75% (mostrato −3,7% con il formattatore esistente formatHistoryPct)');
  const mediaSemplice = ((4700 - 5000) / 5000 * 100 + 0) / 2; // -3%
  assert.notStrictEqual(Math.round(a1.aggregate.aggregateDeviationPct * 100), Math.round(mediaSemplice * 100));
  n.S.productionSessions = datasetMisto(); n.S.recipes = RICETTE; n.S.historyView = 'ricetta';
  const t = vis(n.api.renderStoricoProduzioni());
  assert.ok(t.includes('Prevista 8 kg → Effettiva 7,7 kg Scostamento −300 g · −3,7%'), t.slice(0, 600));
  assert.ok(t.includes('3 produzioni · 2 con resa effettiva registrata'));
  assert.ok(t.includes('Totali sulle 2 produzioni con resa confrontabile'));
  assert.ok(t.includes('Effettiva Non registrata'), 'produzione senza resa mostrata come non registrata, mai zero');
  // Nessun totale che mescoli Ricette: 8 kg + 1 kg (vA2) non compare mai.
  for (const somma of ['Prevista 9 kg', 'Prevista 10 kg', 'Prevista 11 kg', 'Prevista 11,5 kg', 'Prevista 12 kg']) assert.ok(!t.includes(somma), 'nessuna somma fra Ricette diverse: ' + somma);
});

test('S5. Unità non confrontabili: nessun totale e nessuno scostamento inventato', () => {
  const n = client(html, true);
  n.S.productionSessions = datasetMisto(); n.S.recipes = RICETTE; n.S.historyView = 'ricetta';
  const h = n.api.renderStoricoProduzioni();
  const blocco = h.slice(h.indexOf('data-variant-id="vU1"'));
  const t = vis(blocco.slice(0, blocco.indexOf('ms17-scheda-sez') > 0 ? blocco.indexOf('ms17-scheda-sez') : blocco.length));
  assert.ok(t.includes('Nessuna produzione con resa effettiva confrontabile.'), t.slice(0, 300));
  assert.ok(!/Scostamento/.test(t), 'nessuno scostamento per unità diverse');
});

test('S6. Produzione senza Ricetta identificata: gruppo a sé, mai aggregata', () => {
  const n = client(html, true);
  n.S.productionSessions = datasetMisto(); n.S.recipes = RICETTE; n.S.historyView = 'ricetta';
  const t = vis(n.api.renderStoricoProduzioni());
  assert.ok(t.includes('Ricetta non identificata nella produzione: non raggruppata con altre.'));
});

test('S7. Intestazioni: Scheda attuale della Ricetta (anche dopo Unisci); nessun totale di Scheda', () => {
  const n = client(html, true);
  n.S.productionSessions = datasetMisto(); n.S.recipes = RICETTE; n.S.historyView = 'ricetta';
  const h = n.api.renderStoricoProduzioni();
  const titoli = [...h.matchAll(/ms17-scheda-titolo">([^<]*)/g)].map(m => m[1].trim());
  assert.strictEqual(titoli.filter(x => x === 'Focaccia').length, 1, 'Focaccia una sola volta: vA1, vA2, vA3 sotto la Scheda attuale');
  assert.ok(!titoli.includes('Focaccia (vecchia Scheda)'));
  const focaccia = h.slice(h.indexOf('ms17-scheda-titolo">Focaccia'));
  const sez = focaccia.slice(0, focaccia.indexOf('ms17-scheda-sez', 10) > 0 ? focaccia.indexOf('ms17-scheda-sez', 10) : focaccia.length);
  assert.strictEqual((sez.match(/ms17-ricetta-group/g) || []).length, 3, 'tre Ricette distinte nella Scheda');
});

test('S8. Filtro «Produzioni di questa Scheda»: per variant id attuali, include Ricette unite, esclude altre Schede e produzioni senza id', () => {
  const n = client(html, true);
  n.S.productionSessions = datasetMisto(); n.S.recipes = RICETTE;
  n.api.apriProduzioniScheda('rA');
  assert.strictEqual(n.S.historyView, 'ricetta'); assert.strictEqual(n.log.loads, 1, 'ricarica le produzioni come la navigazione esistente');
  assert.deepStrictEqual(n.S.historyScheda.variantIds.sort(), ['lA', 'vA1', 'vA2', 'vA3']);
  const h = n.api.renderStoricoProduzioni();
  const ids = [...h.matchAll(/ms17-history-card" data-session-id="([^"]*)"/g)].map(m => m[1]).sort();
  assert.deepStrictEqual(ids, ['a1', 'a2', 'a3', 'b1', 'm1', 'm2']);
  assert.ok(vis(h).includes('Solo la Scheda Focaccia'));
  assert.ok(vis(h).includes('6 produzioni'));
  // Elenco con lo stesso filtro: stesse produzioni.
  n.api.setHistoryView('elenco');
  const ids2 = [...n.api.renderStoricoProduzioni().matchAll(/ms17-history-card" data-session-id="([^"]*)"/g)].map(m => m[1]).sort();
  assert.deepStrictEqual(ids2, ids);
  // Filtro tolto / Azzera filtri.
  n.api.togliFiltroSchedaStorico(); assert.strictEqual(n.S.historyScheda, null);
  n.api.apriProduzioniScheda('rC');
  assert.ok(n.api.renderStoricoProduzioni().includes('onclick="azzeraFiltriStoricoConScheda()"'), 'Azzera filtri toglie anche la Scheda');
  n.api.azzeraFiltriStoricoConScheda(); assert.strictEqual(n.S.historyScheda, null);
  assert.deepStrictEqual(n.S.historyFilters, { query: '', preset: 'all', from: '', to: '' });
});

test('S9. Filtro Scheda combinato con ricerca e periodo esistenti', () => {
  const n = client(html, true);
  n.S.productionSessions = datasetMisto(); n.S.recipes = RICETTE;
  n.api.apriProduzioniScheda('rA');
  n.S.historyFilters = { query: 'bassa', preset: 'all', from: '', to: '' };
  let ids = [...n.api.renderStoricoProduzioni().matchAll(/data-session-id="([^"]*)"/g)].map(m => m[1]);
  assert.deepStrictEqual(ids, ['b1']);
  n.S.historyFilters = { query: '', preset: 'custom', from: '2026-10-09', to: '2026-10-01' };
  assert.ok(vis(n.api.renderStoricoProduzioni()).includes('La data di inizio è successiva alla data di fine.'));
});

test('S10. Dettaglio: «Apri produzione» invariato anche nella vista per ricetta', () => {
  const n = client(html, true);
  n.S.productionSessions = datasetMisto(); n.S.recipes = RICETTE; n.S.historyView = 'ricetta';
  const h = n.api.renderStoricoProduzioni();
  assert.ok(h.includes(`onclick="openHistorySession('a1')"`));
  n.api.openHistorySession('a1');
  assert.deepStrictEqual(n.log.opened, [['a1', 'storico-produzioni']]);
});

test('S11. Nessuna modifica ai dati delle Sessioni', () => {
  const n = client(html, true);
  const dati = datasetMisto(); const copia = JSON.parse(JSON.stringify(dati));
  n.S.productionSessions = dati; n.S.recipes = RICETTE;
  for (const v of ['elenco', 'ricetta']) { n.S.historyView = v; n.api.renderStoricoProduzioni(); }
  n.api.apriProduzioniScheda('rA'); n.api.renderStoricoProduzioni();
  assert.deepStrictEqual(dati, copia);
});

console.log('\nFase 1A — Conoscenze consolidate (L3)');

const XSS = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>"\'&';
function ricettaL3(l3Items, extraL2) {
  return {
    id: 'rL', name: 'Ragù', labVersions: [{ id: 'lL', name: 'Bozza ragù', l2Items: [] }],
    validatedVariants: [{ id: 'vL1', name: 'Ragù classico', l2Items: [
      { id: 'l2a', content: { label: 'Riduzione', text: 'Riduzione lenta\nsu due righe' }, evidence: 'Chef: confermato dopo 3 prove', decisionState: 'confirmed', provenanceType: 'm2', createdAt: '2026-09-01T10:00:00Z' },
      { id: 'l2p', content: { label: 'Acidità', text: 'Pomodoro acido' }, evidence: null, decisionState: 'probable', provenanceType: 'm1' },
    ].concat(extraL2 || []) }],
    l3Items,
  };
}

test('L1. Scheda senza L3: sezione omessa in entrambe le grafiche', () => {
  const n = client(html, true);
  for (const ui of ['d3', 'classic']) {
    assert.strictEqual(n.api.renderConoscenzeConsolidate(ricettaL3([]), ui), '');
    assert.strictEqual(n.api.renderConoscenzeConsolidate({ id: 'z' }, ui), '');
  }
});

test('L2. Una L3: titolo con conteggio, inizialmente chiusa, contenuto solo dopo apertura', () => {
  const n = client(html, true);
  const r = ricettaL3([{ id: 'k1', distilledContent: { label: 'Tempo', text: 'Cottura lunga migliora la consistenza' }, contextConditions: null, knownLimits: null, originL2ItemId: 'l2a', createdAt: '2026-09-02T10:00:00Z' }]);
  for (const ui of ['d3', 'classic']) {
    n.S.l3SezioneAperta = {};
    const chiusa = n.api.renderConoscenzeConsolidate(r, ui);
    assert.ok(vis(chiusa).includes(ui === 'd3' ? 'Conoscenze consolidate (1)' : 'Conoscenze consolidate 1'), ui + ': ' + vis(chiusa));
    assert.ok(!chiusa.includes('Cottura lunga'), 'chiusa all\'inizio');
    assert.ok(chiusa.includes('aria-expanded="false"'));
    n.api.toggleConoscenzeConsolidate('rL');
    const aperta = vis(n.api.renderConoscenzeConsolidate(r, ui));
    assert.ok(aperta.includes('Tempo — Cottura lunga migliora la consistenza'));
    assert.ok(aperta.includes('Dalla Ricetta Ragù classico'));
    assert.ok(aperta.includes('Conferma Confermata dallo chef'));
    assert.ok(aperta.includes('Creata il 2 settembre 2026'));
    assert.ok(!aperta.includes('Valida se') && !aperta.includes('Limiti noti'), 'campi assenti non mostrati');
    assert.ok(aperta.includes('In sola lettura'));
    assert.ok(!aperta.includes('Riduzione lenta'), 'origine chiusa');
    n.api.toggleDettaglioConoscenza('k1');
    const det = vis(n.api.renderConoscenzeConsolidate(r, ui));
    assert.ok(det.includes('Osservazione originale Riduzione — Riduzione lenta su due righe'));
    assert.ok(det.includes('Evidenza Chef: confermato dopo 3 prove'));
    assert.ok(det.includes('MichelinAI — Sviluppo'));
    n.S.l3DettaglioAperto = {};
  }
});

test('L3. Più L3: ordinate dalla più recente, quelle senza data in fondo; condizioni e limiti mostrati', () => {
  const n = client(html, true); n.S.l3SezioneAperta = { rL: true };
  const r = ricettaL3([
    { id: 'k1', distilledContent: 'Prima', originL2ItemId: 'l2a', createdAt: '2026-01-01T10:00:00Z' },
    { id: 'k2', distilledContent: 'Senza data', originL2ItemId: 'l2a', createdAt: null },
    { id: 'k3', distilledContent: 'Più recente', contextConditions: ['pentola di ghisa', 'fuoco minimo'], knownLimits: { nota: 'non provato con manzo' }, originL2ItemId: 'l2a', createdAt: '2026-05-01T10:00:00Z' },
  ]);
  const h = n.api.renderConoscenzeConsolidate(r, 'd3');
  const ordine = [...h.matchAll(/data-l3-id="([^"]*)"/g)].map(m => m[1]);
  assert.deepStrictEqual(ordine, ['k3', 'k1', 'k2']);
  const t = vis(h);
  assert.ok(t.includes('Conoscenze consolidate (3)'));
  assert.ok(t.includes('Valida se • pentola di ghisa • fuoco minimo'));
  assert.ok(t.includes('Limiti noti nota: non provato con manzo'));
  const k2 = h.slice(h.indexOf('data-l3-id="k2"'));
  assert.ok(!vis(k2).includes('Creata il'), 'data mancante: nessuna data inventata');
});

test('L4. Contenuti pericolosi e caratteri speciali: sempre testo, mai HTML', () => {
  const n = client(html, true); n.S.l3SezioneAperta = { rL: true }; n.S.l3DettaglioAperto = { kx: true };
  const r = ricettaL3([{ id: 'kx', distilledContent: { label: XSS, text: XSS }, contextConditions: XSS, knownLimits: [XSS], originL2ItemId: 'l2x', createdAt: '2026-02-02T00:00:00Z' }],
    [{ id: 'l2x', content: { label: XSS, text: XSS }, evidence: { fonte: XSS }, decisionState: 'confirmed', provenanceType: XSS }]);
  r.validatedVariants[0].name = XSS;
  for (const ui of ['d3', 'classic']) {
    const h = n.api.renderConoscenzeConsolidate(r, ui);
    assert.ok(!/<img|<script|<svg|<iframe|\son[a-z]+="window/i.test(h), ui + ': nessun tag o attributo eseguibile');
    assert.ok(h.includes('&lt;img src=x onerror=&quot;window.__xss=1&quot;&gt;'), 'testo con escaping');
    assert.ok(h.includes('&#39;&amp;'));
  }
});

test('L5. Id con caratteri speciali nei gestori: escaping negli attributi', () => {
  const n = client(html, true); n.S.l3SezioneAperta = {};
  const r = ricettaL3([{ id: "k'1", distilledContent: 'x', originL2ItemId: 'l2a' }]);
  r.id = "r'L\"<";
  const h = n.api.renderConoscenzeConsolidate(r, 'd3');
  assert.ok(h.includes('data-l3-recipe-toggle="r&#39;L&quot;&lt;"'), 'id solo in attributo data- con escaping HTML');
  assert.ok(!/onclick="[^"]*r(&#39;|')L/.test(h), 'id mai dentro il codice JavaScript di onclick');
  n.S.l3SezioneAperta = { [r.id]: true };
  const h2 = n.api.renderConoscenzeConsolidate(r, 'classic');
  assert.ok(h2.includes('data-l3-toggle="k&#39;1"') && !/onclick="[^"]*k(&#39;|')1/.test(h2));
});

test('L6. Osservazione d\'origine mancante: nessuna conferma o Ricetta inventata', () => {
  const n = client(html, true); n.S.l3SezioneAperta = { rL: true }; n.S.l3DettaglioAperto = { km: true };
  const r = ricettaL3([{ id: 'km', distilledContent: 'Orfana', originL2ItemId: 'l2-inesistente', createdAt: null }]);
  const t = vis(n.api.renderConoscenzeConsolidate(r, 'classic'));
  assert.ok(t.includes('Non verificabile: osservazione d\'origine non disponibile'));
  assert.ok(!t.includes('Dalla Ricetta'));
  assert.ok(t.includes('Osservazione d\'origine non disponibile fra i dati caricati.'));
});

test('L7. Origine non confermata o in altra Scheda (dopo Unisci): stato reale e Scheda indicati', () => {
  const n = client(html, true); n.S.l3SezioneAperta = { rL: true };
  n.S.recipes = [{ id: 'rAltra', name: 'Sughi', labVersions: [], validatedVariants: [{ id: 'vX', name: 'Sugo spostato', l2Items: [{ id: 'l2fuori', content: 'Osservazione', decisionState: 'confirmed', provenanceType: 'm2' }] }] }];
  const r = ricettaL3([{ id: 'k1', distilledContent: 'Da probabile', originL2ItemId: 'l2p' }, { id: 'k2', distilledContent: 'Da altra Scheda', originL2ItemId: 'l2fuori' }]);
  const t = vis(n.api.renderConoscenzeConsolidate(r, 'd3'));
  assert.ok(t.includes('Osservazione d\'origine non confermata (probabile)'));
  assert.ok(t.includes('Dalla Ricetta Sugo spostato (Scheda «Sughi»)'));
});

test('L8. Formati inattesi: numeri, booleani, oggetti annidati, contenuto vuoto', () => {
  const n = client(html, true);
  assert.strictEqual(n.api.l3TestoValore(42), '42');
  assert.strictEqual(n.api.l3TestoValore(false), 'false');
  assert.strictEqual(n.api.l3TestoValore({ a: { b: { c: { d: { e: 1 } } } } }), 'a: b: c: d: {"e":1}');
  assert.strictEqual(n.api.l3TestoValore([]), '');
  n.S.l3SezioneAperta = { rL: true };
  const t = vis(n.api.renderConoscenzeConsolidate(ricettaL3([{ id: 'k0', distilledContent: {}, originL2ItemId: 'l2a' }]), 'd3'));
  assert.ok(t.includes('Contenuto non disponibile.'));
});

test('L9. La visualizzazione non modifica i dati e non scrive nulla', () => {
  const n = client(html, true);
  const r = ricettaL3([{ id: 'k1', distilledContent: { label: 'a', text: 'b' }, contextConditions: ['c'], knownLimits: null, originL2ItemId: 'l2a', createdAt: '2026-09-02T10:00:00Z' }]);
  const copia = JSON.parse(JSON.stringify(r));
  n.api.toggleConoscenzeConsolidate('rL'); n.api.toggleDettaglioConoscenza('k1');
  n.api.renderConoscenzeConsolidate(r, 'd3'); n.api.renderConoscenzeConsolidate(r, 'classic');
  assert.deepStrictEqual(r, copia);
  const src = NUOVE.filter(m => /l3|Conoscen/i.test(m)).map(m => extract(html, m)).join('\n');
  assert.ok(!/fetch\(|saveToSupabase|supabaseAction|upRec|autosave/.test(src), 'nessuna scrittura o chiamata di rete nel codice L3');
});

console.log('\nFase 1A — Controlli sul codice');

test('K1. Funzioni di motore, salvataggio, MichelinAI e calcoli identiche a f13b6d1', () => {
  const fn = src => { const out = {}; const re = /^(async )?function ([A-Za-z0-9_$]+)\(/gm; let m; while ((m = re.exec(src))) out[m[2]] = extract(src, m[0]); return out; };
  const a = fn(htmlBase), b = fn(html);
  const cambiate = Object.keys(a).filter(k => k in b && a[k] !== b[k]).sort();
  const rimosse = Object.keys(a).filter(k => !(k in b));
  const nuove = Object.keys(b).filter(k => !(k in a)).sort();
  assert.deepStrictEqual(cambiate, ['loadFromSupabase', 'renderRicettaMadreV2', 'renderSchedaD3', 'renderStoricoProduzioni',
    /* P1: escaping dei contenuti AI (renderContenutoL2Umano, pannello Consulto in renderLabRecipe) e nessun "Conferma" per osservazioni confermate */
    'renderContenutoL2Umano', 'renderLabRecipe', 'renderMichelinAIPendingActions'].sort());
  assert.deepStrictEqual(rimosse, []);
  assert.deepStrictEqual(nuove, ['apriProduzioniScheda', 'azzeraFiltriStoricoConScheda', 'groupHistoryByRecipeVersion', 'historySchedaDiRicetta', 'historySchedaVariantIds', 'l3ConfermaTesto',
    'l3DataTesto', 'l3Html', 'l3ProvenienzaTesto', 'l3TestoValore', 'l3TrovaOrigine', 'renderConoscenzeConsolidate', 'renderHistoryPerRicetta',
    'renderHistoryRicettaBlock', 'setHistoryView', 'toggleConoscenzeConsolidate', 'toggleDettaglioConoscenza', 'togliFiltroSchedaStorico']);
});

test('K2. loadFromSupabase: unica differenza la lettura di created_at delle L3; il salvataggio delle L3 non lo invia', () => {
  const a = extract(htmlBase, 'async function loadFromSupabase()'), b = extract(html, 'async function loadFromSupabase()');
  const righeNuove = b.split('\n').filter(l => !a.split('\n').includes(l));
  assert.deepStrictEqual(righeNuove.map(s => s.trim()), ['createdAt:x.created_at||null, // Fase 1A: solo lettura/visualizzazione — mai reinviato al save (colonna gestita dal DB)']);
  assert.strictEqual(a.split('\n').filter(l => !b.split('\n').includes(l)).length, 0, 'nessuna riga rimossa');
  const save = extract(html, 'async function saveToSupabase(recipe)');
  const l3Save = save.slice(save.indexOf('const allL3Items'), save.indexOf('}));', save.indexOf('const allL3Items')));
  assert.ok(!/created/i.test(l3Save), 'created_at mai reinviato');
});

test('K3. renderRicettaMadreV2 e renderSchedaD3: aggiunta la sola sezione L3 (e la voce di menu nella Direzione 3)', () => {
  const diff = (m) => { const a = extract(htmlBase, m).split('\n'), b = extract(html, m).split('\n'); return { piu: b.filter(l => !a.includes(l)).map(s => s.trim()), meno: a.filter(l => !b.includes(l)) }; };
  const c = diff('function renderRicettaMadreV2(recipe)');
  assert.deepStrictEqual(c, { piu: ["${zonaStoria}${renderConoscenzeConsolidate(recipe,'classic')}"], meno: ['    ${zonaStoria}'] });
  const d = diff('function renderSchedaD3(recipe)');
  assert.strictEqual(d.meno.length, 1, 'una sola riga sostituita (archiviate + sezione L3 sulla stessa riga)');
  assert.strictEqual(d.piu.length, 2);
  assert.ok(d.piu[0].startsWith("{label:'Produzioni di questa Scheda',onclick:`apriProduzioniScheda('${rid}')`}"));
  assert.strictEqual(d.piu[1], d.meno[0].trim() + "${renderConoscenzeConsolidate(recipe,'d3')}", 'stessa riga + sola sezione L3');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
