/*
 * Test minimo per STEP R1 (porting Persistent State Layer sulla base KHUB
 * avanzata recuperata da Vercel 751735c). Nessun framework introdotto: Node
 * puro + assert.
 *
 * Copre due livelli, onestamente distinti:
 *  A. Unit test reali sull'helper baseline (lib/baseline.js) — logica pura,
 *     nessuna rete, nessun DB richiesto.
 *  B. Verifiche strutturali (grep-style) su migration/api/khub_mvp.html —
 *     confermano che PSL, D2, D3, D4 sono effettivamente applicati nel
 *     codice della base avanzata, senza eseguire nulla contro un DB reale.
 *
 * Le verifiche di comportamento a runtime contro un vero Supabase (upsert,
 * CHECK, FK, multi-active, round trip load/save, riconciliazione active<-shared)
 * NON sono eseguibili da questo ambiente: qui non ci sono credenziali
 * Supabase. Vanno rieseguite manualmente dal progetto reale.
 *
 * NOTA IMPORTANTE — M1 non e' parte di R1: lib/baseline.js e' presente nel
 * repository (copiato per intero, checksum verificato) ma NON e' ancora
 * agganciato a khub_mvp.html con un tag <script>, perche' il suo unico
 * chiamante applicativo e' runM1() (M1), che non esiste ancora su questo
 * branch. Il collegamento e' previsto per R2. Questo file lo verifica
 * esplicitamente, cosi' non viene scambiato per una dimenticanza.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const KhubBaseline = require(path.join(ROOT, 'lib', 'baseline.js'));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  ok - ' + name);
    passed++;
  } catch (e) {
    console.log('  FAIL - ' + name);
    console.log('    ' + e.message);
    failed++;
  }
}

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

console.log('A. lib/baseline.js — unit test');

test('compute() e deterministico: stesso snapshot (ordine chiavi diverso) => stesso hash', () => {
  const a = { foo: 1, bar: { z: 1, a: 2 } };
  const b = { bar: { a: 2, z: 1 }, foo: 1 };
  const ra = KhubBaseline.compute(a);
  const rb = KhubBaseline.compute(b);
  assert.strictEqual(ra.baseline_hash, rb.baseline_hash);
});

test('compute() produce hash diversi per snapshot diversi', () => {
  const ra = KhubBaseline.compute({ foo: 1 });
  const rb = KhubBaseline.compute({ foo: 2 });
  assert.notStrictEqual(ra.baseline_hash, rb.baseline_hash);
});

test('compute() restituisce baseline_context = snapshot passato, non modificato', () => {
  const snap = { ingredients: [{ name: 'sale', qty: 5 }], criteria_current: 'x' };
  const r = KhubBaseline.compute(snap);
  assert.deepStrictEqual(r.baseline_context, snap);
});

test('compute() non decide i campi pertinenti: accetta qualunque forma di snapshot', () => {
  const r1 = KhubBaseline.compute({ a: 1 });
  const r2 = KhubBaseline.compute(['x', 'y']);
  const r3 = KhubBaseline.compute(null);
  assert.ok(typeof r1.baseline_hash === 'string' && r1.baseline_hash.length > 0);
  assert.ok(typeof r2.baseline_hash === 'string' && r2.baseline_hash.length > 0);
  assert.ok(typeof r3.baseline_hash === 'string' && r3.baseline_hash.length > 0);
});

console.log('');
console.log('B. verifiche strutturali sulla base avanzata (R1)');

const migration = read('supabase/migrations/0001_persistent_state_layer.sql');
const migration2 = read('supabase/migrations/0002_fix_l2_constraints.sql');
const chat = read('api/chat.js');
const html = read('khub_mvp.html');

test('migration 0001: crea l2_items e l3_items', () => {
  assert.match(migration, /create table if not exists l2_items/);
  assert.match(migration, /create table if not exists l3_items/);
});

test('migration 0001: l3_items.origin_l2_item_id e\' NOT NULL (gate L3)', () => {
  assert.match(migration, /origin_l2_item_id\s+text not null references l2_items/);
});

test('migration 0001: variants.active + origin_variant_id + intention/criteria aggiunti', () => {
  assert.match(migration, /add column if not exists origin_variant_id/);
  assert.match(migration, /add column if not exists active boolean not null default false/);
  assert.match(migration, /add column if not exists intention_initial jsonb/);
  assert.match(migration, /add column if not exists criteria_current jsonb/);
});

test('migration 0002: fix ai constraint handoff/unengaged presenti', () => {
  assert.match(migration2, /l2_items_handoff_iff_source_chk/);
  assert.match(migration2, /l2_items_unengaged_implies_none_chk/);
});

test('api/chat.js: load include l2_items e l3_items (5 query)', () => {
  assert.match(chat, /l2_items\?select=\*/);
  assert.match(chat, /l3_items\?select=\*/);
  assert.match(chat, /\{ recipes, variants, ingredients, l2_items, l3_items \}/);
});

test('api/chat.js: save (D4) usa mustSave/sbPost per l2_items/l3_items, mai delete+insert', () => {
  const saveStart = chat.indexOf("supabaseAction === 'save'");
  const saveEnd = chat.indexOf("supabaseAction === 'update'");
  const saveBlock = chat.slice(saveStart, saveEnd);
  assert.match(saveBlock, /mustSave\('l3_items', l3Items, 'l3_items'\)/);
  assert.match(saveBlock, /mustSave\('l2_items', l2Items, 'l2_items'\)/);
  assert.doesNotMatch(saveBlock, /l2_items\?variant_id=eq/);
  assert.doesNotMatch(saveBlock, /l3_items\?recipe_id=eq/);
});

test('api/chat.js: save (D4) scrive l3_items PRIMA di l2_items (l2 e\' l\'ultimo step)', () => {
  const saveStart = chat.indexOf("supabaseAction === 'save'");
  const saveEnd = chat.indexOf("supabaseAction === 'update'");
  const saveBlock = chat.slice(saveStart, saveEnd);
  const l3Idx = saveBlock.indexOf("mustSave('l3_items'");
  const l2Idx = saveBlock.indexOf("mustSave('l2_items'");
  assert.ok(l3Idx > -1 && l2Idx > -1 && l3Idx < l2Idx, 'l3_items deve precedere l2_items nel save');
});

test('api/chat.js: save (D4) e\' fail-fast — un solo try/catch, si ferma al primo errore reale', () => {
  const saveStart = chat.indexOf("supabaseAction === 'save'");
  const saveEnd = chat.indexOf("supabaseAction === 'update'");
  const saveBlock = chat.slice(saveStart, saveEnd);
  assert.match(saveBlock, /const mustSave = async/);
  assert.match(saveBlock, /if \(r\.error\) throw new Error/);
  assert.match(saveBlock, /catch \(saveError\)/);
  assert.match(saveBlock, /return res\.status\(200\)\.json\(\{ ok: false, errors: \[saveError\.message\] \}\)/);
});

test('api/chat.js: save preserva la strategia avanzata upsert+delete-orfani SOLO per ingredients', () => {
  const saveStart = chat.indexOf("supabaseAction === 'save'");
  const saveEnd = chat.indexOf("supabaseAction === 'update'");
  const saveBlock = chat.slice(saveStart, saveEnd);
  assert.match(saveBlock, /mustSave\('ingredients', ingredients, 'ingredients upsert'\)/);
  assert.match(saveBlock, /method: 'DELETE'/);
  assert.match(saveBlock, /if \(!dr\.ok\)/);
});

console.log('');
console.log('C. verifiche strutturali D2 (active come source of truth, shared legacy) su khub_mvp.html');

test('khub_mvp.html: nessun riferimento funzionale residuo a .shared o toggleSharedV2', () => {
  assert.doesNotMatch(html, /toggleSharedV2/);
  assert.doesNotMatch(html, /\.shared\b/);
});

test('khub_mvp.html: allVariants/activeVariants derivano da active, non da shared', () => {
  const fnBody = html.slice(html.indexOf('function allVariants('), html.indexOf('function retireVariant('));
  assert.match(fnBody, /v\.active/);
});

test('khub_mvp.html: toggleActiveV2 esiste e agisce sul campo active', () => {
  const fnBody = html.slice(html.indexOf('function toggleActiveV2('), html.indexOf('function retireVariant('));
  assert.match(fnBody, /active:newActive/);
});

test('khub_mvp.html: retireVariant porta active a false in archiviazione', () => {
  const fnBody = html.slice(html.indexOf('function retireVariant('), html.indexOf('function uid('));
  assert.match(fnBody, /status:'retired',active:false/);
});

test('khub_mvp.html: saveToSupabase NON scrive piu\' il campo shared nel payload variants (protezione dati legacy pre-riconciliazione)', () => {
  const fnBody = html.slice(html.indexOf('async function saveToSupabase'), html.indexOf('async function deleteRecipe'));
  assert.doesNotMatch(fnBody, /shared:/);
  assert.match(fnBody, /active:v\.active===true/);
  assert.match(fnBody, /active:vv\.active===true/);
});

console.log('');
console.log('D. verifiche strutturali D3 (identita\' variant.id nel lifecycle) su khub_mvp.html');

test('khub_mvp.html: onValidate preserva v.id (nessun nuovo id in validazione)', () => {
  const fnBody = html.slice(html.indexOf('function onValidate()'), html.indexOf('async function confirmValidate()'));
  assert.doesNotMatch(fnBody, /id:'vv'\+Date\.now\(\)/);
  assert.match(fnBody, /id:v\.id,name,/);
  assert.match(fnBody, /originVariantId:v\.originVariantId\|\|null/);
  assert.match(fnBody, /l2Items:v\.l2Items\|\|\[\]/);
});

test('khub_mvp.html: rendiAttiva preserva v.id (nessun nuovo id in attivazione)', () => {
  const fnBody = html.slice(html.indexOf('function rendiAttiva('), html.indexOf('function onValidate()'));
  assert.doesNotMatch(fnBody, /id:'vv'\+Date\.now\(\)/);
  assert.match(fnBody, /id:v\.id,/);
  assert.match(fnBody, /active:true/);
  assert.match(fnBody, /originVariantId:v\.originVariantId\|\|null/);
  assert.match(fnBody, /l2Items:v\.l2Items\|\|\[\]/);
});

test('khub_mvp.html: confirmValidate sposta la bozza in validatedVariants senza rigenerare id', () => {
  const fnBody = html.slice(html.indexOf('async function confirmValidate()'), html.indexOf('function addIngredient('));
  assert.match(fnBody, /validatedVariants:\[\.\.\.r\.validatedVariants,nv\]/);
  assert.match(fnBody, /labVersions:newLabVersions/);
});

test('khub_mvp.html: le funzioni di vero branching continuano a generare un nuovo variant.id', () => {
  const branchFns = [
    ['function creaBozzaDaSorgente(', 'function creaBozzaDaAttivaId('],
    ['function duplicaVersioneLAB(', 'function creaSchedaDaLab('],
  ];
  branchFns.forEach(([start, end]) => {
    const fnBody = html.slice(html.indexOf(start), html.indexOf(end));
    assert.match(fnBody, /id:\s*["'`]lv/, 'atteso un nuovo id "lv..." in ' + start);
  });
  const creaSchedaBody = html.slice(html.indexOf('async function creaSchedaDaLab('), html.indexOf('async function eliminaBozza('));
  assert.match(creaSchedaBody, /id:'lv'\+ts/);
});

test('khub_mvp.html: creaBozzaDaSorgente registra originVariantId dalla Ricetta attiva di partenza', () => {
  const fnBody = html.slice(html.indexOf('function creaBozzaDaSorgente('), html.indexOf('function creaBozzaDaAttivaId('));
  assert.match(fnBody, /originVariantId:attiva\?attiva\.id:null/);
});

console.log('');
console.log('E. verifiche strutturali PSL (L2/L3 round trip) su khub_mvp.html');

test('khub_mvp.html: loadFromSupabase ricostruisce l2Items per variant.id e l3Items per recipe.id', () => {
  const fnBody = html.slice(html.indexOf('async function loadFromSupabase'), html.indexOf('function parseSteps'));
  assert.match(fnBody, /mapL2Items=\(vid\)=>\(data\.l2_items\|\|\[\]\)\.filter\(x=>x\.variant_id===vid\)/);
  assert.match(fnBody, /l3Items=\(data\.l3_items\|\|\[\]\)\.filter\(x=>x\.recipe_id===r\.id\)/);
});

test('khub_mvp.html: saveToSupabase invia l2Items e l3Items e gestisce ok:false', () => {
  const fnBody = html.slice(html.indexOf('async function saveToSupabase'), html.indexOf('async function deleteRecipe'));
  assert.match(fnBody, /l2Items:allL2Items,l3Items:allL3Items/);
  assert.match(fnBody, /saveResult&&saveResult\.ok===false/);
});

test('khub_mvp.html: makeDefaultLab inizializza i campi PSL (l2Items, intention, criteria)', () => {
  const fnBody = html.slice(html.indexOf('function makeDefaultLab('), html.indexOf('async function saveToSupabase'));
  assert.match(fnBody, /l2Items:\[\]/);
  assert.match(fnBody, /intentionInitial:null,intentionCurrent:null,criteriaInitial:null,criteriaCurrent:null/);
});

test('khub_mvp.html (mini-sprint E2E FIX 1): variants.m1_reading_text round-trip load<->save, artefatto mai cognitivo', () => {
  const loadBody = html.slice(html.indexOf('async function loadFromSupabase'), html.indexOf('function parseSteps'));
  assert.match(loadBody, /m1ReadingText:v\.m1_reading_text\|\|null/, 'load: m1_reading_text -> v.m1ReadingText mancante');

  const saveBody = html.slice(html.indexOf('async function saveToSupabase'), html.indexOf('async function deleteRecipe'));
  assert.match(saveBody, /m1_reading_text:v\.m1ReadingText\|\|null/, 'save: v.m1ReadingText -> m1_reading_text mancante');

  // Solo il variant LAB (status='lab') lo scrive — stessa scoperta di
  // variants.primo_consulto: mai per i validatedVariants, che non hanno
  // consumer per questo artefatto.
  const validatedBlock = saveBody.slice(saveBody.indexOf('recipe.validatedVariants.forEach'));
  assert.doesNotMatch(validatedBlock, /m1_reading_text/, 'm1_reading_text non deve essere scritto per i validatedVariants');

  // Invariante piu' importante: non deve MAI finire nel payload M2 (mai
  // memoria cognitiva) — verificato anche in test-m1.js, ripetuto qui
  // perche' e' l'invariante PSL centrale di questa fix.
  const payloadBody = html.slice(html.indexOf('function costruisciPayloadM2'), html.indexOf('async function runM2'));
  assert.doesNotMatch(payloadBody, /m1ReadingText/);
});

console.log('');
console.log('F. verifica preservazione funzionalita\' avanzata (non regressione)');

test('khub_mvp.html: firmaContenutoBozza() e contenuto_hash restano presenti e distinti da baseline_hash', () => {
  assert.match(html, /function firmaContenutoBozza\(v\)/);
  assert.match(html, /contenuto_hash:firmaContenutoBozza\(v\)/);
});

test('khub_mvp.html: primoConsulto legacy (blob overwritable) resta leggibile/scrivibile invariato', () => {
  assert.match(html, /primoConsulto:v\.primo_consulto\|\|null/);
  assert.match(html, /primo_consulto:v\.primoConsulto\|\|null/);
});

test('khub_mvp.html: apriCondividiStaff resta separato da active/lifecycle (nessuna scrittura su active)', () => {
  const idx = html.indexOf('function apriCondividiStaff(');
  assert.ok(idx > -1);
  const fnBody = html.slice(idx, idx + 1500);
  assert.doesNotMatch(fnBody, /active:/);
});

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
console.log('');
console.log('NOTA: le verifiche di comportamento a runtime contro un vero Supabase');
console.log('(upsert idempotente, CHECK/FK, multi-active persistito, propagazione di un');
console.log('vero errore HTTP end-to-end, riconciliazione active<-shared) NON sono');
console.log('eseguibili da questo ambiente: qui non sono presenti credenziali Supabase.');
console.log('Vanno verificate manualmente sul progetto reale.');
console.log('');
console.log('NOTA: M1 non e\' parte di R1 — runM1()/hasM1()/renderM1Panel() e il tag');
console.log('<script src="lib/baseline.js"> NON sono ancora presenti in khub_mvp.html.');
console.log('E\' atteso: il porting di M1 e\' STEP R2, non ancora iniziato.');

if (failed > 0) process.exit(1);
