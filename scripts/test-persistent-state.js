/*
 * Test minimo per lo Sprint 1 (Persistent State Layer).
 * Nessun framework introdotto: Node puro + assert.
 *
 * Copre due livelli, onestamente distinti:
 *  A. Unit test reali sull'helper baseline (lib/baseline.js) — logica pura,
 *     nessuna rete, nessun DB richiesto.
 *  B. Verifiche strutturali (grep-style) su migration/api/khub_mvp.html —
 *     confermano che i vincoli/le modifiche richieste sono effettivamente
 *     presenti nel codice, senza eseguire nulla contro un DB reale.
 *
 * Le verifiche di comportamento a runtime contro un vero Supabase (upsert,
 * CHECK, FK, multi-active, round trip load/save) NON sono eseguibili da
 * questo ambiente: qui non ci sono credenziali Supabase. Vanno rieseguite
 * manualmente dopo aver applicato la migration al progetto reale.
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
console.log('B. verifiche strutturali sul codice modificato');

const migration = read('supabase/migrations/0001_persistent_state_layer.sql');
const chat = read('api/chat.js');
const html = read('khub_mvp.html');

test('migration: crea l2_items e l3_items', () => {
  assert.match(migration, /create table if not exists l2_items/);
  assert.match(migration, /create table if not exists l3_items/);
});

test('migration: source_l2_item_id vincolato a provenance_type=handoff', () => {
  assert.match(migration, /l2_items_source_only_handoff_chk/);
  assert.match(migration, /source_l2_item_id is null or provenance_type = 'handoff'/);
});

test('migration: l3_items.origin_l2_item_id e\' NOT NULL (gate L3)', () => {
  assert.match(migration, /origin_l2_item_id\s+text not null references l2_items/);
});

test('migration: l3_items.recipe_id (non origin_recipe_id) e\' owner Scheda', () => {
  assert.match(migration, /recipe_id\s+text not null references recipes/);
  assert.doesNotMatch(migration, /origin_recipe_id/);
});

test('migration: variants.active + origin_variant_id + intention/criteria aggiunti', () => {
  assert.match(migration, /add column if not exists origin_variant_id/);
  assert.match(migration, /add column if not exists active boolean not null default false/);
  assert.match(migration, /add column if not exists intention_initial jsonb/);
  assert.match(migration, /add column if not exists criteria_current jsonb/);
});

test('migration: FK verso l2_items/l3_items sono ON DELETE RESTRICT', () => {
  const l2Block = migration.slice(migration.indexOf('create table if not exists l2_items'), migration.indexOf('create table if not exists l3_items'));
  const l3Block = migration.slice(migration.indexOf('create table if not exists l3_items'));
  assert.match(l2Block, /variant_id\s+text not null references variants\(id\) on delete restrict/);
  assert.match(l3Block, /recipe_id\s+text not null references recipes\(id\) on delete restrict/);
  assert.match(l3Block, /origin_l2_item_id\s+text not null references l2_items\(id\) on delete restrict/);
});

test('api/chat.js: load include l2_items e l3_items', () => {
  assert.match(chat, /l2_items\?select=\*/);
  assert.match(chat, /l3_items\?select=\*/);
  assert.match(chat, /l2_items, l3_items \}/);
});

test('api/chat.js: save non usa piu\' delete+insert per l2_items/l3_items', () => {
  const saveBlock = chat.slice(chat.indexOf("supabaseAction === 'save'"), chat.indexOf("supabaseAction === 'update'"));
  assert.match(saveBlock, /write\('l2_items', l2Items, 'l2_items'\)/);
  assert.match(saveBlock, /write\('l3_items', l3Items, 'l3_items'\)/);
  assert.doesNotMatch(saveBlock, /l2_items\?variant_id=eq/);
  assert.doesNotMatch(saveBlock, /l3_items\?recipe_id=eq/);
});

test('api/chat.js: save/update/delete controllano res.ok e propagano errori reali', () => {
  assert.match(chat, /if \(!r\.ok\) \{[\s\S]{0,200}throw new Error/);
  const occurrences = chat.match(/if \(!(r|dr)\.ok\)/g) || [];
  assert.ok(occurrences.length >= 4, 'attese almeno 4 verifiche res.ok (save x3 + update + delete), trovate ' + occurrences.length);
});

test('khub_mvp.html: onValidate non genera piu\' un nuovo variant.id ("vv"+Date.now())', () => {
  const fnBody = html.slice(html.indexOf('function onValidate()'), html.indexOf('function addIngredient'));
  assert.doesNotMatch(fnBody, /id:'vv'\+Date\.now\(\)/);
  assert.match(fnBody, /const vId=v\.id;/);
  assert.match(fnBody, /id:vId,name,/);
});

test('khub_mvp.html: onValidate sposta la Ricetta da labVersions a validatedVariants preservando l2Items', () => {
  const fnBody = html.slice(html.indexOf('function onValidate()'), html.indexOf('function addIngredient'));
  assert.match(fnBody, /labVersions\.filter\(x=>x\.id!==vId\)/);
  assert.match(fnBody, /l2Items:v\.l2Items\|\|\[\]/);
});

test('khub_mvp.html: saveToSupabase invia l2Items e l3Items, controlla res.ok', () => {
  const fnBody = html.slice(html.indexOf('async function saveToSupabase'), html.indexOf('async function deleteRecipe'));
  assert.match(fnBody, /l2Items:allL2Items,l3Items:allL3Items/);
  assert.match(fnBody, /if\(!res\.ok\|\|!data\|\|!data\.ok\)/);
});

test('khub_mvp.html: loadFromSupabase ricostruisce l2Items per variant e l3Items per recipe', () => {
  const fnBody = html.slice(html.indexOf('async function loadFromSupabase'), html.indexOf('function parseSteps'));
  assert.match(fnBody, /mapL2Items=\(vid\)=>\(data\.l2_items\|\|\[\]\)\.filter\(x=>x\.variant_id===vid\)/);
  assert.match(fnBody, /l3Items=\(data\.l3_items\|\|\[\]\)\.filter\(x=>x\.recipe_id===r\.id\)/);
});

test('khub_mvp.html: carica lib/baseline.js prima dello script principale', () => {
  assert.match(html, /<script src="lib\/baseline\.js"><\/script>\s*<script>/);
});

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
console.log('');
console.log('NOTA: i casi di test 1,2,3,4,5,6,7,8,9,10,11 della spec che richiedono');
console.log('un round-trip reale contro Supabase (CHECK/FK a runtime, upsert idempotente,');
console.log('multi-active persistito, propagazione di un vero errore HTTP) NON sono');
console.log('eseguibili da questo ambiente: qui non sono presenti credenziali Supabase.');
console.log('Vanno verificati manualmente dopo aver applicato la migration 0001.');

if (failed > 0) process.exit(1);
