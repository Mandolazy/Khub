-- ============================================================================
-- KHUB — P0-c: integrita' delle quantita' degli ingredienti (schema)
-- ============================================================================
-- STATO: PREPARATA, NON ESEGUITA. Da applicare prima su KHUB Test, solo dopo
-- un'autorizzazione esplicita (procedura: docs/migrations/0012_ingredients_quantity_kind.md).
--
-- Aggiunge a public.ingredients il TIPO di quantita' e i dati originali:
--   qty_kind    text    NULL  'certa' | 'variabile' | 'mancante' | 'intervallo'
--                              NULL = ingrediente precedente a P0-c: comportamento
--                              identico a oggi (nessun controllo nuovo).
--   qty_min     numeric NULL  minimo di un intervallo (solo qty_kind='intervallo')
--   qty_max     numeric NULL  massimo di un intervallo (solo qty_kind='intervallo')
--   source_text text    NULL  riga originale della fonte (max 300 caratteri)
--
-- qty resta numeric NOT NULL DEFAULT 0 e unit text NOT NULL DEFAULT 'g' (schema
-- verificato su KHUB Test): nessuna modifica. Per 'variabile', 'mancante' e
-- 'intervallo' qty vale 0 come SEGNAPOSTO TECNICO, imposto dal vincolo
-- ingredients_qty_segnaposto_chk: nessun valore numerico "residuo" puo' restare
-- accanto a un tipo non numerico. L'applicazione non legge mai qty per questi tipi.
--
-- Additiva e non distruttiva: nessun DEFAULT, nessun backfill, nessuna riga
-- modificata. Le righe esistenti hanno qty_kind NULL e soddisfano tutti i vincoli.
-- Prima di aggiungere ogni colonna si verifica che non esista gia' con un tipo
-- diverso: in quel caso la migrazione si ferma senza modificare nulla
-- (niente ADD COLUMN IF NOT EXISTS "cieco").
-- Tutto in un'unica transazione.
-- ============================================================================

begin;

do $$
declare
  attese constant text[][] := array[
    array['qty_kind', 'text'],
    array['qty_min', 'numeric'],
    array['qty_max', 'numeric'],
    array['source_text', 'text']];
  i int;
  tipo_attuale text;
begin
  if to_regclass('public.ingredients') is null then
    raise exception 'P0-c: tabella public.ingredients non trovata';
  end if;
  for i in 1 .. array_length(attese, 1) loop
    select data_type into tipo_attuale
      from information_schema.columns
     where table_schema = 'public' and table_name = 'ingredients' and column_name = attese[i][1];
    if tipo_attuale is null then
      execute format('alter table public.ingredients add column %I %s', attese[i][1], attese[i][2]);
    elsif tipo_attuale <> attese[i][2] then
      raise exception 'P0-c: la colonna ingredients.% esiste gia'' con tipo % (atteso %): nessuna modifica',
        attese[i][1], tipo_attuale, attese[i][2];
    else
      raise notice 'P0-c: colonna ingredients.% gia'' presente con il tipo atteso', attese[i][1];
    end if;
  end loop;
end $$;

-- Vincoli di coerenza (aggiunti solo se assenti; le righe esistenti li soddisfano).
-- In un CHECK un confronto con NULL non fallisce: per l'intervallo minimo e massimo
-- sono quindi richiesti esplicitamente non nulli, e il tipo e' confrontato con
-- IS NOT DISTINCT FROM (con qty_kind NULL un "=" darebbe NULL, cioe' superato).
do $$
declare
  vincoli constant text[][] := array[
    array['ingredients_qty_kind_chk',
          'check (qty_kind is null or qty_kind in (''certa'', ''variabile'', ''mancante'', ''intervallo''))'],
    array['ingredients_qty_intervallo_chk',
          'check ((qty_kind is not distinct from ''intervallo'' and qty_min is not null and qty_max is not null and qty_min > 0 and qty_max > qty_min) or (qty_kind is distinct from ''intervallo'' and qty_min is null and qty_max is null))'],
    array['ingredients_qty_certa_chk',
          'check (qty_kind is distinct from ''certa'' or qty > 0)'],
    array['ingredients_qty_segnaposto_chk',
          'check (qty_kind is null or qty_kind = ''certa'' or qty = 0)'],
    array['ingredients_source_text_chk',
          'check (source_text is null or char_length(source_text) <= 300)']];
  i int;
begin
  for i in 1 .. array_length(vincoli, 1) loop
    if not exists (select 1 from pg_constraint
                    where conname = vincoli[i][1] and conrelid = 'public.ingredients'::regclass) then
      execute format('alter table public.ingredients add constraint %I %s', vincoli[i][1], vincoli[i][2]);
    end if;
  end loop;
end $$;

comment on column public.ingredients.qty_kind is
  'P0-c: tipo di quantita'': certa | variabile (q.b.) | mancante | intervallo. NULL = ingrediente precedente a P0-c. Per variabile/mancante/intervallo qty = 0 e'' un segnaposto, mai un peso.';
comment on column public.ingredients.qty_min is 'P0-c: minimo dell''intervallo (solo qty_kind = intervallo).';
comment on column public.ingredients.qty_max is 'P0-c: massimo dell''intervallo (solo qty_kind = intervallo).';
comment on column public.ingredients.source_text is 'P0-c: riga originale della fonte importata (informativa, max 300 caratteri).';

commit;
