/*
 * Test — P0-c: migrazione 0012 e rollback su un PostgreSQL LOCALE fittizio.
 *
 * Non tocca Supabase: richiede un'istanza PostgreSQL locale e vuota indicata
 * da KHUB_PG_TEST (es. "host=/percorso/socket port=55432 user=postgres").
 * Senza KHUB_PG_TEST il test si dichiara non eseguito (skip) e termina con 0.
 * Crea ogni volta un database temporaneo con la tabella ingredients come
 * verificata su KHUB Test (qty numeric NOT NULL DEFAULT 0, unit text NOT NULL
 * DEFAULT 'g', PK + chiavi esterne) e 12 righe precedenti a P0-c.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CONN = process.env.KHUB_PG_TEST;
if (!CONN) { console.log('P0-c — migrazione 0012: KHUB_PG_TEST non impostato, test non eseguito (skip)\n\n0 passed, 0 failed, 1 skipped'); process.exit(0); }
const MIG = fs.readFileSync(path.join(ROOT, 'supabase/migrations/0012_ingredients_quantity_kind.sql'), 'utf8');
const RB = fs.readFileSync(path.join(ROOT, 'supabase/rollback/PREPARED_NOT_EXECUTED__0012_ingredients_quantity_kind_rollback.sql'), 'utf8');
const DB = 'khub_p0c_' + process.pid;
const sql = (q, db = DB) => spawnSync('psql', [CONN + ' dbname=' + db, '-v', 'ON_ERROR_STOP=1', '-qtA', '-c', q], { encoding: 'utf8' });
const ok = (q, db) => { const r = sql(q, db); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
const ko = q => { const r = sql(q); assert.notStrictEqual(r.status, 0, 'doveva fallire: ' + q); return r.stderr; };
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok - ' + name); } catch (e) { failed++; console.log('  FAIL - ' + name + '\n    ' + String(e && e.message || e).split('\n').slice(0, 4).join('\n    ')); } }

const SCHEMA = `
create table recipes (id text primary key, name text);
create table variants (id text primary key, recipe_id text references recipes(id) on delete cascade);
create table ingredients (
  id text primary key,
  variant_id text not null references variants(id) on delete cascade,
  name text not null,
  qty numeric not null default 0,
  unit text not null default 'g',
  sort_order int,
  estimated_yield_pct numeric, measured_yield_pct numeric,
  is_sub_recipe boolean default false,
  sub_recipe_id text references variants(id),
  group_recipe_id text references recipes(id) on delete set null);
insert into recipes values ('r1','Scheda');
insert into variants values ('v1','r1');
insert into ingredients (id,variant_id,name,qty,unit,sort_order)
  select 'i'||g, 'v1', 'Ingrediente '||g, 10*g, case when g%3=0 then 'ml' when g%3=1 then 'g' else 'n' end, g from generate_series(1,12) g;`;
const firmaRighe = () => ok("select string_agg(id||':'||name||':'||qty||':'||unit, ',' order by id) from ingredients");

try {
  ok('drop database if exists ' + DB, 'postgres'); ok('create database ' + DB, 'postgres');
  ok(SCHEMA);
  console.log('P0-c — migrazione 0012 (PostgreSQL locale fittizio)');
  const prima = firmaRighe();

  test('M1. migrazione additiva: 4 colonne nullable, nessun default, righe esistenti invariate e con qty_kind NULL', () => {
    ok(MIG);
    const col = ok("select string_agg(column_name||' '||data_type||' '||is_nullable||' '||coalesce(column_default,'-'), ', ' order by column_name) from information_schema.columns where table_name='ingredients' and column_name in ('qty_kind','qty_min','qty_max','source_text')");
    assert.strictEqual(col, 'qty_kind text YES -, qty_max numeric YES -, qty_min numeric YES -, source_text text YES -');
    assert.strictEqual(firmaRighe(), prima, 'righe precedenti invariate');
    assert.strictEqual(ok('select count(*) from ingredients where qty_kind is not null or qty_min is not null or qty_max is not null or source_text is not null'), '0');
    assert.strictEqual(ok("select is_nullable||' '||column_default from information_schema.columns where table_name='ingredients' and column_name='qty'"), "NO 0", 'qty invariata');
  });

  test('M2. idempotente: seconda esecuzione senza errori e senza duplicare vincoli', () => {
    ok(MIG);
    assert.strictEqual(ok("select count(*) from pg_constraint where conrelid='ingredients'::regclass and conname like 'ingredients_%_chk'"), '5');
  });

  test('M3. vincoli: tipi ammessi; intervallo coerente; certa > 0; segnaposto 0 per i tipi non numerici; testo <= 300', () => {
    const ins = (id, cols, vals) => `insert into ingredients (id,variant_id,name,${cols}) values ('${id}','v1','x',${vals})`;
    ok(ins('a1', 'qty,unit,qty_kind,source_text', "2,'spicchio','certa','2 spicchi d''aglio'"));
    ok(ins('a2', 'qty,unit,qty_kind,source_text', "0,'g','variabile','Sale q.b.'"));
    ok(ins('a3', 'qty,unit,qty_kind', "0,'g','mancante'"));
    ok(ins('a4', 'qty,unit,qty_kind,qty_min,qty_max', "0,'g','intervallo',20,30"));
    ok(ins('a5', 'qty,unit', '0,\'g\'')); // riga "precedente" (qty_kind NULL): 0 ammesso come oggi
    ko(ins('b1', 'qty,qty_kind', "1,'stimata'"));
    ko(ins('b2', 'qty,qty_kind,qty_min,qty_max', "0,'intervallo',30,20"));
    ko(ins('b3', 'qty,qty_kind,qty_min', "0,'intervallo',20"));
    ko(ins('b4', 'qty,qty_kind', "0,'certa'"));
    ko(ins('b5', 'qty,qty_kind', "5,'variabile'"));
    ko(ins('b6', 'qty,qty_kind', "5,'mancante'"));
    ko(ins('b7', 'qty,qty_min,qty_max', '0,1,2'));
    ko(ins('b8', 'qty,qty_kind,source_text', `1,'certa','${'x'.repeat(301)}'`));
  });
  ok("delete from ingredients where id like 'a%' or id like 'b%'");

  test('M4. colonna omonima con tipo incompatibile: la migrazione si ferma senza modificare nulla', () => {
    ok('drop database if exists ' + DB + '_b', 'postgres'); ok('create database ' + DB + '_b', 'postgres');
    ok(SCHEMA + ' alter table ingredients add column qty_min text;', DB + '_b');
    const r = spawnSync('psql', [CONN + ' dbname=' + DB + '_b', '-v', 'ON_ERROR_STOP=1', '-qtA', '-c', MIG], { encoding: 'utf8' });
    assert.notStrictEqual(r.status, 0); assert.ok(/qty_min esiste gia' con tipo text/.test(r.stderr), r.stderr);
    assert.strictEqual(ok("select count(*) from information_schema.columns where table_name='ingredients' and column_name in ('qty_kind','qty_max','source_text')", DB + '_b'), '0', 'transazione annullata');
    ok('drop database ' + DB + '_b', 'postgres');
  });

  test('M5. rollback: fermato se ci sono dati P0-c; eseguito senza dati, schema tornato come prima', () => {
    ok("insert into ingredients (id,variant_id,name,qty,unit,qty_kind) values ('z1','v1','Sale',0,'g','variabile')");
    const r = sql(RB); assert.notStrictEqual(r.status, 0); assert.ok(/Rollback 0012 fermato: 1 righe/.test(r.stderr), r.stderr);
    assert.strictEqual(ok("select count(*) from information_schema.columns where table_name='ingredients' and column_name='qty_kind'"), '1', 'nessuna modifica');
    ok("delete from ingredients where id='z1'");
    ok(RB);
    assert.strictEqual(ok("select count(*) from information_schema.columns where table_name='ingredients' and column_name in ('qty_kind','qty_min','qty_max','source_text')"), '0');
    assert.strictEqual(ok("select count(*) from pg_constraint where conrelid='ingredients'::regclass and conname like 'ingredients_%_chk'"), '0');
    assert.strictEqual(firmaRighe(), prima, 'righe precedenti invariate dopo il rollback');
  });
} finally {
  sql('drop database if exists ' + DB, 'postgres');
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
