#!/usr/bin/env bash
# ============================================================================
# Test — migrazione 0011_variants_declared_yield.sql su un Postgres LOCALE e
# TEMPORANEO (mai Supabase). Crea un cluster usa-e-getta in una cartella
# temporanea, con una replica della tabella variants costruita dallo schema
# reale verificato (portions_count integer NOT NULL DEFAULT 4,
# grams_per_portion numeric NOT NULL DEFAULT 200, portion_unit text DEFAULT
# 'g', CHECK su origin_variant_id), e alla fine la cancella.
#
# Verifica: dati legacy identici (checksum), colonne nullable senza default,
# righe esistenti a NULL, idempotenza, upsert in stile PostgREST che non
# tocca le colonne assenti dal payload, precisione dei valori, rollback
# protetto (si ferma se ci sono dati) e rollback senza dati.
#
# Uso: bash scripts/db/test-0011-declared-yield.sh
# Requisiti: binari Postgres (initdb, pg_ctl, psql); se eseguito da root usa
# l'utente di sistema "postgres".
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIGRATION="$ROOT/supabase/migrations/0011_variants_declared_yield.sql"
ROLLBACK="$ROOT/supabase/rollback/PREPARED_NOT_EXECUTED__0011_variants_declared_yield_rollback.sql"
PGBIN="${PGBIN:-$(dirname "$(command -v initdb 2>/dev/null || ls /usr/lib/postgresql/*/bin/initdb | tail -1)")}"
PORT="${PORT:-55411}"
WORK="$(mktemp -d)"
RUNAS=()
if [ "$(id -u)" = "0" ]; then RUNAS=(runuser -u postgres --); chown postgres "$WORK"; fi
cp "$MIGRATION" "$WORK/m.sql"; cp "$ROLLBACK" "$WORK/r.sql"; chmod a+r "$WORK"/*.sql

cleanup() { "${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

"${RUNAS[@]}" "$PGBIN/initdb" -D "$WORK/data" -A trust -U postgres >/dev/null
"${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" start >/dev/null
PSQL=("${RUNAS[@]}" "$PGBIN/psql" -h "$WORK" -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1 -At)
createdb() { "${PSQL[@]}" -d postgres -c "create database $1"; }
q() { "${PSQL[@]}" -d "$1" -c "$2"; }

passed=0; failed=0
ok()   { echo "  ok - $1"; passed=$((passed+1)); }
fail() { echo "  FAIL - $1"; echo "    $2"; failed=$((failed+1)); }
check() { if [ "$2" = "$3" ]; then ok "$1"; else fail "$1" "atteso [$3], ottenuto [$2]"; fi; }

SCHEMA="
create table recipes (id text primary key, name text);
create table variants (
  id text primary key,
  recipe_id text references recipes(id),
  name text, label text, note text, status text,
  active boolean, shared boolean,
  portions_count integer not null default 4,
  grams_per_portion numeric not null default 200,
  portion_unit text default 'g',
  steps text, steps_v2 jsonb,
  validated_at timestamptz,
  origin_variant_id text references variants(id) on delete restrict,
  contenuto_hash text,
  created_at timestamptz not null default now(),
  constraint variants_origin_not_self check (origin_variant_id is null or origin_variant_id <> id)
);
insert into recipes values ('r1','Crema'),('r2','Frolla');
insert into variants (id,recipe_id,name,label,note,status,active,portions_count,grams_per_portion,portion_unit,steps,steps_v2,validated_at,origin_variant_id,created_at) values
 ('vA','r1','Classica','Classica','nota','validated',true,10,80,'g','[\"a\"]','[{\"id\":\"s1\",\"order\":0,\"text\":\"a\"}]','2026-10-01T09:30:17.250Z',null,'2026-10-01'),
 ('vR','r1','Vecchia','Vecchia','','retired',false,8,90.5,'g','[]','[]','2026-08-01T18:45:00Z',null,'2026-08-01'),
 ('lB','r1','Bozza','Bozza 1','', 'lab',false,4,200,'g','[]',null,null,'vA','2026-10-02'),
 ('lZ','r2','Bozza zero','Bozza 1','','lab',false,1,0,'g','[]','[]',null,null,'2026-10-03'),
 ('lN','r2','Bozza unit null','Bozza 2','','lab',false,3,123.456789,null,'[]','[]',null,null,'2026-10-04');
"
LEGACY_SUM="select md5(string_agg(concat_ws('|',id,recipe_id,name,label,note,status,active,shared,portions_count,grams_per_portion,portion_unit,steps,steps_v2::text,validated_at,origin_variant_id,contenuto_hash,created_at),'#' order by id)) from variants"

echo "LAB FIX 2A — migrazione 0011 su Postgres locale temporaneo ($("${PSQL[@]}" -d postgres -c 'show server_version'))"
createdb t1
q t1 "$SCHEMA"
before=$(q t1 "$LEGACY_SUM"); rows_before=$(q t1 "select count(*) from variants")

"${PSQL[@]}" -d t1 -f "$WORK/m.sql"
ok "migrazione applicata senza errori"
check "dati legacy identici (checksum di tutte le colonne esistenti)" "$(q t1 "$LEGACY_SUM")" "$before"
check "numero di righe invariato" "$(q t1 "select count(*) from variants")" "$rows_before"
check "colonne: tipo, nullable, nessun default" \
  "$(q t1 "select string_agg(column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'∅'),',' order by column_name) from information_schema.columns where table_name='variants' and column_name like 'declared_yield%'")" \
  "declared_yield_qty:numeric:YES:∅,declared_yield_unit:text:YES:∅"
check "righe esistenti: resa dichiarata NULL" "$(q t1 "select count(*) from variants where declared_yield_qty is not null or declared_yield_unit is not null")" "0"
check "colonne legacy invariate (tipo, NOT NULL, default)" \
  "$(q t1 "select string_agg(column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'∅'),',' order by column_name) from information_schema.columns where table_name='variants' and column_name in ('portions_count','grams_per_portion','portion_unit')")" \
  "grams_per_portion:numeric:NO:200,portion_unit:text:YES:'g'::text,portions_count:integer:NO:4"
check "vincoli invariati (solo il CHECK su origin_variant_id)" "$(q t1 "select string_agg(conname,',' order by conname) from pg_constraint where conrelid='variants'::regclass and contype='c'")" "variants_origin_not_self"

"${PSQL[@]}" -d t1 -f "$WORK/m.sql"
check "idempotente: seconda esecuzione senza errori ne' modifiche" "$(q t1 "$LEGACY_SUM")" "$before"

# Valori futuri: precisione e unita'
q t1 "update variants set declared_yield_qty=30, declared_yield_unit='pz' where id='lB'"
q t1 "update variants set declared_yield_qty=2.5, declared_yield_unit='kg' where id='lZ'"
q t1 "update variants set declared_yield_qty=0.333333333333333333, declared_yield_unit='teglia' where id='lN'"
check "memorizzazione quantita' + unita' (esatta, decimali compresi)" \
  "$(q t1 "select string_agg(id||'='||declared_yield_qty||' '||declared_yield_unit,',' order by id) from variants where declared_yield_qty is not null")" \
  "lB=30 pz,lN=0.333333333333333333 teglia,lZ=2.5 kg"
check "NULL/NULL resta valido (resa non dichiarata)" "$(q t1 "select count(*) from variants where declared_yield_qty is null and declared_yield_unit is null")" "2"

# Upsert in stile PostgREST (resolution=merge-duplicates): aggiorna SOLO le
# colonne presenti nel payload. Il payload del codice attuale non contiene
# le nuove colonne: devono restare intatte.
q t1 "insert into variants (id,recipe_id,name,label,note,status,active,portions_count,grams_per_portion,portion_unit,steps,steps_v2,origin_variant_id)
      values ('lB','r1','Bozza rinominata','Bozza 1','x','lab',false,12,80,'g','[]','[]','vA')
      on conflict (id) do update set recipe_id=excluded.recipe_id,name=excluded.name,label=excluded.label,note=excluded.note,status=excluded.status,active=excluded.active,
        portions_count=excluded.portions_count,grams_per_portion=excluded.grams_per_portion,portion_unit=excluded.portion_unit,steps=excluded.steps,steps_v2=excluded.steps_v2,origin_variant_id=excluded.origin_variant_id"
check "salvataggio del codice attuale (payload senza nuove colonne): resa dichiarata intatta" \
  "$(q t1 "select name||' '||portions_count||'x'||grams_per_portion||' | '||declared_yield_qty||' '||declared_yield_unit from variants where id='lB'")" \
  "Bozza rinominata 12x80 | 30 pz"
q t1 "insert into variants (id,recipe_id,name,status,active,portions_count,grams_per_portion,portion_unit) values ('lNew','r1','Nuova','lab',false,1,0,'g')
      on conflict (id) do update set name=excluded.name"
check "nuova riga dal codice attuale: resa dichiarata NULL (nessun default)" "$(q t1 "select coalesce(declared_yield_qty::text,'NULL')||'/'||coalesce(declared_yield_unit,'NULL') from variants where id='lNew'")" "NULL/NULL"
check "zero ancora accettato in grams_per_portion (comportamento reale invariato)" "$(q t1 "select grams_per_portion from variants where id='lNew'")" "0"
if q t1 "insert into variants (id,recipe_id,status,portions_count,grams_per_portion) values ('lBad','r1','lab',1,null)" 2>/dev/null; then
  fail "NOT NULL di grams_per_portion ancora attivo" "inserimento con NULL accettato"
else ok "NOT NULL di grams_per_portion ancora attivo"; fi
check "select * restituisce le nuove colonne (la load le ignora)" "$(q t1 "select count(*) from information_schema.columns where table_name='variants'")" "19"

# Rollback protetto: con dati presenti deve fermarsi senza cambiare nulla
sum_with_data=$(q t1 "select md5(string_agg(concat_ws('|',id,declared_yield_qty,declared_yield_unit),'#' order by id)) from variants")
if "${PSQL[@]}" -d t1 -f "$WORK/r.sql" >/dev/null 2>"$WORK/rb.err"; then
  fail "rollback con dati presenti: deve fermarsi" "il rollback e' stato eseguito"
else
  grep -q "Rollback interrotto" "$WORK/rb.err" && ok "rollback con dati presenti: si ferma con messaggio esplicito" || fail "rollback con dati presenti" "$(cat "$WORK/rb.err")"
fi
check "rollback interrotto: colonne e dati intatti" "$(q t1 "select md5(string_agg(concat_ws('|',id,declared_yield_qty,declared_yield_unit),'#' order by id)) from variants")" "$sum_with_data"

# Rollback prima dell'uso (nessun dato nelle nuove colonne)
createdb t2
q t2 "$SCHEMA"
before2=$(q t2 "$LEGACY_SUM")
"${PSQL[@]}" -d t2 -f "$WORK/m.sql"
"${PSQL[@]}" -d t2 -f "$WORK/r.sql"
check "rollback prima dell'uso: colonne rimosse" "$(q t2 "select count(*) from information_schema.columns where table_name='variants' and column_name like 'declared_yield%'")" "0"
check "rollback prima dell'uso: dati legacy identici" "$(q t2 "$LEGACY_SUM")" "$before2"
"${PSQL[@]}" -d t2 -f "$WORK/r.sql"
ok "rollback idempotente (seconda esecuzione senza errori)"

echo ""
echo "$passed passed, $failed failed"
[ "$failed" = "0" ]
