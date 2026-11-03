#!/usr/bin/env bash
# ============================================================================
# Test — docs/proposte/khub_test_elimina_scheda_se_vuota.sql su un Postgres
# LOCALE e TEMPORANEO (mai Supabase). Crea un cluster usa-e-getta in una
# cartella temporanea e alla fine lo cancella.
#
# Replica delle relazioni verso recipes descritte per KHUB Test:
#   variants.recipe_id          -> recipes ON DELETE CASCADE
#   recipes.parent_recipe_id    -> recipes ON DELETE SET NULL
#   ingredients.group_recipe_id -> recipes ON DELETE SET NULL
#   l3_items.recipe_id          -> recipes RESTRICT
# piu' i ruoli anon / authenticated / service_role e i privilegi predefiniti
# di Supabase (nuove funzioni concesse ad anon e authenticated).
#
# Verifica:
#  - installazione riuscita con le due FK SET NULL previste;
#  - installazione interrotta (nulla creato) per FK non previste o con
#    azione diversa, FK su piu' colonne, colonne mancanti o di tipo diverso,
#    trigger ON DELETE; FK RESTRICT / NO ACTION ammesse;
#  - esiti: eliminata, assente, non_vuota, osservazioni_michelinai,
#    collegata (parent_recipe_id, group_recipe_id, riferimento a se stessa);
#    nessun dato cambiato quando la funzione rifiuta;
#  - concorrenza: riferimento inserito durante l'attesa -> 'collegata';
#    riferimento tentato dopo l'eliminazione -> errore di foreign key;
#    blocco non ottenuto entro lock_timeout -> errore, nulla eliminato;
#  - READ COMMITTED obbligatorio; permessi (anon/authenticated rifiutati,
#    service_role ammesso); seconda installazione bloccata.
#
# Uso: bash scripts/db/test-elimina-scheda-se-vuota.sh
# Requisiti: binari Postgres (initdb, pg_ctl, psql); se eseguito da root usa
# l'utente di sistema "postgres".
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="${SCRIPT_SQL:-$ROOT/docs/proposte/khub_test_elimina_scheda_se_vuota.sql}"
PGBIN="${PGBIN:-$(dirname "$(command -v initdb 2>/dev/null || ls /usr/lib/postgresql/*/bin/initdb | tail -1)")}"
PORT="${PORT:-55412}"
WORK="$(mktemp -d)"
RUNAS=()
if [ "$(id -u)" = "0" ]; then RUNAS=(runuser -u postgres --); chown postgres "$WORK"; fi
cp "$SCRIPT" "$WORK/f.sql"; chmod a+r "$WORK/f.sql"

cleanup() { "${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

"${RUNAS[@]}" "$PGBIN/initdb" -D "$WORK/data" -A trust -U postgres >/dev/null
"${RUNAS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=''" -l "$WORK/log" start >/dev/null
PSQL=("${RUNAS[@]}" "$PGBIN/psql" -h "$WORK" -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1 -At)
q() { "${PSQL[@]}" -d "$1" -c "$2"; }
# Come il server: ruolo service_role, READ COMMITTED (default).
srv() { "${PSQL[@]}" -d "$1" -c "set role service_role; select public.elimina_scheda_se_vuota('$2')"; }

passed=0; failed=0
ok()   { echo "  ok - $1"; passed=$((passed+1)); }
fail() { echo "  FAIL - $1"; echo "    $2"; failed=$((failed+1)); }
check() { if [ "$2" = "$3" ]; then ok "$1"; else fail "$1" "atteso [$3], ottenuto [$2]"; fi; }

q postgres "create role anon nologin; create role authenticated nologin; create role service_role nologin"

# Schema base (solo le tabelle e le relazioni rilevanti per la funzione).
SCHEMA="
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
create table recipes (
  id text primary key, name text,
  parent_recipe_id text references recipes(id) on delete set null
);
create table variants (
  id text primary key,
  recipe_id text not null references recipes(id) on delete cascade,
  name text, status text,
  origin_variant_id text references variants(id) on delete restrict
);
create table ingredients (
  id text primary key,
  variant_id text references variants(id) on delete cascade,
  name text,
  sub_recipe_id text references variants(id) on delete set null,
  group_recipe_id text references recipes(id) on delete set null
);
create table l2_items (id text primary key, variant_id text references variants(id));
create table l3_items (id text primary key, recipe_id text references recipes(id), origin_l2_item_id text references l2_items(id));
"
DATI="
insert into recipes (id, name, parent_recipe_id) values
  ('rVuota','Vuota',null), ('rPiena','Piena',null), ('rL3','Con L3',null),
  ('rPadre','Padre',null), ('rFiglia','Figlia','rPadre'),
  ('rGruppo','Gruppo',null), ('rSe','Se stessa','rSe'), ('rBase','Base',null);
insert into variants (id, recipe_id, name, status) values
  ('v1','rPiena','Classica','validated'), ('v3','rBase','Base','validated');
insert into ingredients (id, variant_id, name, group_recipe_id) values ('i1','v3','Gruppo','rGruppo'), ('i2','v3','Latte',null);
insert into l2_items values ('l2a','v1');
insert into l3_items values ('l3a','rL3','l2a');
"
SUM="select md5(concat_ws('#',
  (select string_agg(concat_ws('|',id,name,parent_recipe_id),',' order by id) from recipes),
  (select string_agg(concat_ws('|',id,recipe_id,name,status,origin_variant_id),',' order by id) from variants),
  (select string_agg(concat_ws('|',id,variant_id,name,sub_recipe_id,group_recipe_id),',' order by id) from ingredients),
  (select string_agg(concat_ws('|',id,recipe_id),',' order by id) from l3_items)))"
BASE="select (select string_agg(id,',' order by id) from recipes)||'|'||(select count(*) from variants)||'|'||(select count(*) from ingredients)||'|'||(select count(*) from l3_items)"
FUNZ="select count(*) from pg_proc where proname = 'elimina_scheda_se_vuota'"

nuovo_db() { q postgres "create database $1"; q "$1" "$SCHEMA"; q "$1" "$DATI"; }

echo "elimina_scheda_se_vuota — script KHUB Test su Postgres locale temporaneo ($(q postgres 'show server_version'))"

# --------------------------------------------------------------------------
# 1. Installazione sullo schema previsto
# --------------------------------------------------------------------------
nuovo_db t1
"${PSQL[@]}" -d t1 -f "$WORK/f.sql" >/dev/null
ok "installazione riuscita con recipes.parent_recipe_id e ingredients.group_recipe_id ON DELETE SET NULL"
check "funzione creata una sola volta" "$(q t1 "$FUNZ")" "1"
check "permessi: anon e authenticated no, service_role si'" \
  "$(q t1 "select has_function_privilege('anon','elimina_scheda_se_vuota(text)','EXECUTE')||','||has_function_privilege('authenticated','elimina_scheda_se_vuota(text)','EXECUTE')||','||has_function_privilege('service_role','elimina_scheda_se_vuota(text)','EXECUTE')")" \
  "false,false,true"
if q t1 "set role anon; select public.elimina_scheda_se_vuota('rVuota')" >/dev/null 2>&1; then
  fail "anon non puo' eseguire la funzione" "eseguita"
else ok "anon non puo' eseguire la funzione"; fi
check "funzione: security invoker, volatile, lock_timeout e search_path" \
  "$(q t1 "select prosecdef||','||provolatile::text||','||array_to_string(proconfig,';') from pg_proc where proname='elimina_scheda_se_vuota'")" \
  "false,v,search_path=public, pg_temp;lock_timeout=5s"

# --------------------------------------------------------------------------
# 2. Esiti
# --------------------------------------------------------------------------
prima=$(q t1 "$SUM")
check "Scheda con Ricette -> non_vuota" "$(srv t1 rPiena)" "non_vuota"
check "Scheda con osservazione L3 -> osservazioni_michelinai" "$(srv t1 rL3)" "osservazioni_michelinai"
check "Scheda indicata da recipes.parent_recipe_id -> collegata" "$(srv t1 rPadre)" "collegata"
check "Scheda indicata da ingredients.group_recipe_id -> collegata" "$(srv t1 rGruppo)" "collegata"
check "Scheda che indica se stessa (parent_recipe_id = id) -> collegata (prudenza)" "$(srv t1 rSe)" "collegata"
check "Scheda inesistente -> assente" "$(srv t1 rNessuna)" "assente"
check "rifiuti: nessun dato cambiato (nessuna riga eliminata o azzerata)" "$(q t1 "$SUM")" "$prima"
check "Scheda che ne indica un'altra (rFiglia -> rPadre) ma non e' indicata -> eliminata" "$(srv t1 rFiglia)" "eliminata"
check "Scheda vuota e non indicata -> eliminata" "$(srv t1 rVuota)" "eliminata"
check "eliminazioni: solo le due Schede, resto invariato" \
  "$(q t1 "select string_agg(id,',' order by id) from recipes")|$(q t1 "select count(*) from variants")|$(q t1 "select count(*) from ingredients where group_recipe_id is not null")|$(q t1 "select parent_recipe_id from recipes where id='rSe'")" \
  "rBase,rGruppo,rL3,rPadre,rPiena,rSe|2|1|rSe"
check "seconda chiamata sulla stessa Scheda -> assente" "$(srv t1 rVuota)" "assente"
if q t1 "set role service_role; set transaction isolation level repeatable read; select public.elimina_scheda_se_vuota('rGruppo')" >/dev/null 2>"$WORK/iso.err"; then
  fail "fuori da READ COMMITTED: rifiuto" "eseguita"
else grep -q "richiede READ COMMITTED" "$WORK/iso.err" && ok "fuori da READ COMMITTED: errore esplicito" || fail "READ COMMITTED" "$(cat "$WORK/iso.err")"; fi
if q t1 "set role service_role; select public.elimina_scheda_se_vuota('')" >/dev/null 2>&1; then
  fail "id vuoto rifiutato" "accettato"; else ok "id vuoto rifiutato"; fi

# --------------------------------------------------------------------------
# 3. Concorrenza
# --------------------------------------------------------------------------
q t1 "insert into recipes (id,name) values ('rC1','C1'),('rC2','C2'),('rC3','C3'),('rC4','C4')"
# a) Un'altra transazione sta inserendo una Scheda figlia di rC1: la funzione
#    aspetta il suo COMMIT, poi vede il riferimento e rifiuta.
( q t1 "begin; insert into recipes (id,name,parent_recipe_id) values ('rC1figlia','x','rC1'); select pg_sleep(1.5); commit;" >/dev/null ) &
bg=$!; q t1 "select pg_sleep(0.4)" >/dev/null
check "riferimento parent_recipe_id confermato durante l'attesa -> collegata" "$(srv t1 rC1)" "collegata"
wait $bg
check "  ...e la Scheda resta, con il riferimento" "$(q t1 "select count(*) from recipes where id='rC1' or parent_recipe_id='rC1'")" "2"
# b) Stesso caso con un ingrediente che indica rC2 come gruppo.
( q t1 "begin; insert into ingredients (id,variant_id,name,group_recipe_id) values ('iC2','v3','g','rC2'); select pg_sleep(1.5); commit;" >/dev/null ) &
bg=$!; q t1 "select pg_sleep(0.4)" >/dev/null
check "riferimento group_recipe_id confermato durante l'attesa -> collegata" "$(srv t1 rC2)" "collegata"
wait $bg
# c) La funzione elimina rC3 e tiene il blocco: chi prova a indicarla aspetta
#    e poi fallisce per foreign key (nessun riferimento scollegato).
( q t1 "set role service_role; begin; select public.elimina_scheda_se_vuota('rC3'); select pg_sleep(1.5); commit;" > "$WORK/c3.out" ) &
bg=$!; q t1 "select pg_sleep(0.4)" >/dev/null
if q t1 "insert into recipes (id,name,parent_recipe_id) values ('rC3figlia','x','rC3')" >/dev/null 2>"$WORK/c3.err"; then
  fail "riferimento verso una Scheda in eliminazione: rifiutato" "inserito"
else grep -q "foreign key" "$WORK/c3.err" && ok "riferimento tentato durante l'eliminazione: aspetta e fallisce per foreign key" || fail "foreign key" "$(cat "$WORK/c3.err")"; fi
wait $bg
check "  ...la Scheda e' stata eliminata" "$(tr -d '\n' < "$WORK/c3.out")|$(q t1 "select count(*) from recipes where id in ('rC3','rC3figlia')")" "eliminata|0"
# d) Blocco tenuto oltre lock_timeout (5s): errore, nulla eliminato.
( q t1 "begin; insert into ingredients (id,variant_id,name,group_recipe_id) values ('iC4','v3','g','rC4'); select pg_sleep(7); rollback;" >/dev/null ) &
bg=$!; q t1 "select pg_sleep(0.4)" >/dev/null
if srv t1 rC4 >/dev/null 2>"$WORK/c4.err"; then
  fail "blocco oltre lock_timeout: errore" "eseguita"
else grep -q "lock timeout" "$WORK/c4.err" && ok "blocco non ottenuto entro lock_timeout: errore" || fail "lock_timeout" "$(cat "$WORK/c4.err")"; fi
wait $bg
check "  ...e la Scheda non e' eliminata" "$(q t1 "select count(*) from recipes where id='rC4'")" "1"

# --------------------------------------------------------------------------
# 4. Seconda installazione bloccata
# --------------------------------------------------------------------------
if "${PSQL[@]}" -d t1 -f "$WORK/f.sql" >/dev/null 2>"$WORK/re.err"; then
  fail "seconda installazione bloccata" "eseguita"
else grep -q "esiste gia'" "$WORK/re.err" && ok "seconda installazione bloccata con messaggio esplicito" || fail "seconda installazione" "$(cat "$WORK/re.err")"; fi
check "  ...funzione e permessi invariati" "$(q t1 "$FUNZ")|$(q t1 "select has_function_privilege('anon','elimina_scheda_se_vuota(text)','EXECUTE')")" "1|f"

# --------------------------------------------------------------------------
# 5. Verifica preliminare: schemi diversi da quello previsto
# --------------------------------------------------------------------------
n=0
interrotta() { # $1 descrizione, $2 SQL che altera lo schema, $3 testo atteso nell'errore
  n=$((n+1)); local db="v$n"
  nuovo_db "$db"; q "$db" "$2"; local s0 f0; s0=$(q "$db" "$BASE"); f0=$(q "$db" "$FUNZ")
  if "${PSQL[@]}" -d "$db" -f "$WORK/f.sql" >/dev/null 2>"$WORK/$db.err"; then
    fail "interrotta: $1" "installazione riuscita"
  elif ! grep -q "$3" "$WORK/$db.err"; then
    fail "interrotta: $1" "$(cat "$WORK/$db.err")"
  elif [ "$(q "$db" "$FUNZ")" != "$f0" ] || [ "$(q "$db" "$BASE")" != "$s0" ]; then
    fail "interrotta: $1" "funzione creata o dati cambiati"
  else ok "interrotta, nulla creato: $1"; fi
}
ammessa() { # $1 descrizione, $2 SQL che altera lo schema
  n=$((n+1)); local db="v$n"
  nuovo_db "$db"; q "$db" "$2"
  if "${PSQL[@]}" -d "$db" -f "$WORK/f.sql" >/dev/null 2>"$WORK/$db.err"; then ok "ammessa: $1"
  else fail "ammessa: $1" "$(cat "$WORK/$db.err")"; fi
}
interrotta "altra FK ON DELETE CASCADE verso recipes" \
  "create table note (id text primary key, recipe_id text references recipes(id) on delete cascade)" "non prevista o con azione diversa"
interrotta "altra FK ON DELETE SET NULL verso recipes" \
  "create table note (id text primary key, recipe_id text references recipes(id) on delete set null)" "non prevista o con azione diversa"
interrotta "altra FK ON DELETE SET DEFAULT verso recipes" \
  "create table note (id text primary key, recipe_id text default 'rBase' references recipes(id) on delete set default)" "non prevista o con azione diversa"
interrotta "seconda colonna SET NULL nella stessa tabella ingredients" \
  "alter table ingredients add column altra_recipe_id text references recipes(id) on delete set null" "non prevista o con azione diversa"
interrotta "parent_recipe_id con CASCADE invece di SET NULL" \
  "alter table recipes drop constraint recipes_parent_recipe_id_fkey; alter table recipes add foreign key (parent_recipe_id) references recipes(id) on delete cascade" "non prevista o con azione diversa"
interrotta "group_recipe_id con SET DEFAULT invece di SET NULL" \
  "alter table ingredients drop constraint ingredients_group_recipe_id_fkey; alter table ingredients add foreign key (group_recipe_id) references recipes(id) on delete set default" "non prevista o con azione diversa"
interrotta "variants.recipe_id con SET NULL invece di CASCADE" \
  "alter table variants alter column recipe_id drop not null; alter table variants drop constraint variants_recipe_id_fkey; alter table variants add foreign key (recipe_id) references recipes(id) on delete set null" "non prevista o con azione diversa"
interrotta "FK SET NULL da una tabella di un altro schema con lo stesso nome" \
  "create schema altro; create table altro.ingredients (id text primary key, group_recipe_id text references public.recipes(id) on delete set null)" "non prevista o con azione diversa"
interrotta "FK su piu' colonne verso recipes" \
  "alter table recipes add unique (id, name); create table note (id text primary key, r text, n text, foreign key (r, n) references recipes(id, name))" "piu' colonne"
interrotta "colonna ingredients.group_recipe_id assente" \
  "alter table ingredients drop column group_recipe_id" "colonne attese non trovate"
interrotta "recipes.parent_recipe_id di tipo diverso" \
  "alter table recipes drop column parent_recipe_id; alter table recipes add column parent_recipe_id integer" "tipo inatteso"
interrotta "trigger ON DELETE su recipes" \
  "create function t() returns trigger language plpgsql as 'begin return old; end'; create trigger tr before delete on recipes for each row execute function t()" "trigger ON DELETE"
interrotta "funzione gia' presente" \
  "create function public.elimina_scheda_se_vuota(p text) returns text language sql as 'select 1::text'" "esiste gia'"
ammessa "altra FK RESTRICT verso recipes" \
  "create table note (id text primary key, recipe_id text references recipes(id) on delete restrict)"
ammessa "parent_recipe_id con NO ACTION (al massimo la cancellazione fallisce)" \
  "alter table recipes drop constraint recipes_parent_recipe_id_fkey; alter table recipes add foreign key (parent_recipe_id) references recipes(id)"
ammessa "colonne varchar invece di text" \
  "alter table recipes alter column parent_recipe_id type varchar(200); alter table ingredients alter column group_recipe_id type varchar(200)"

echo ""
echo "$passed passed, $failed failed"
[ "$failed" = "0" ]
