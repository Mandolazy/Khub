-- ============================================================================
-- KHUB — LAB FIX 2A: resa dichiarata (schema)
-- ============================================================================
-- Aggiunge a variants la resa gastronomica DICHIARATA dallo chef, espressa
-- come quantita' + unita' (es. 30 pz, 1 kg, 2 teglie, 10 porzioni).
-- E' indipendente dai parametri legacy usati dalla Produzione
-- (portions_count, grams_per_portion, portion_unit), che restano invariati.
--
-- Questa migration e' SOLO schema: nessun codice applicativo legge o scrive
-- ancora queste colonne (FIX 2B). Il codice attuale continua a funzionare
-- perche':
--   - la load legge variants con select=* e ignora le colonne sconosciute;
--   - il save fa un upsert (merge-duplicates) con un payload che NON contiene
--     queste colonne: PostgREST aggiorna solo le colonne presenti nel
--     payload, quindi i valori futuri di queste colonne non vengono toccati.
--
-- Scelte:
--   - declared_yield_qty numeric: decimale esatto (2,5 kg; 0,75 teglie),
--     nessun errore di virgola mobile, stessa famiglia di grams_per_portion
--     e delle rese ingrediente. Nessuna precisione fissa: la scala la decide
--     il dato, non lo schema.
--   - declared_yield_unit text: l'elenco delle unita' non e' ancora deciso;
--     nessun enum e nessun CHECK, per non dover migrare di nuovo lo schema
--     quando l'elenco sara' approvato.
--   - Entrambe NULL = resa non dichiarata. Nessun DEFAULT: nessun valore
--     inventato, nessun backfill, nessuna riga esistente modificata.
--
-- Additiva e idempotente: ADD COLUMN IF NOT EXISTS e' un no-op se la colonna
-- esiste gia'. ADD COLUMN senza DEFAULT e' un'operazione solo di catalogo
-- (nessuna riscrittura della tabella). Rollback documentato in
-- docs/migrations/0011_variants_declared_yield.md (NON eseguire senza
-- leggere le avvertenze sulla perdita di dati).
-- ============================================================================

alter table public.variants
  add column if not exists declared_yield_qty numeric,
  add column if not exists declared_yield_unit text;

comment on column public.variants.declared_yield_qty is
  'LAB FIX 2: quantita'' della resa dichiarata dallo chef. NULL = non dichiarata. Indipendente da portions_count/grams_per_portion.';
comment on column public.variants.declared_yield_unit is
  'LAB FIX 2: unita'' della resa dichiarata (es. pz, porzioni, teglia, g, kg). NULL = non dichiarata.';
