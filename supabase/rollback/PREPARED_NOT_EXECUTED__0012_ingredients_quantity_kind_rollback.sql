-- ============================================================================
-- KHUB — Rollback di 0012_ingredients_quantity_kind.sql
-- ============================================================================
-- STATO: PREPARATO, NON ESEGUITO.
-- Non fa parte della sequenza supabase/migrations/ e nessuna pipeline lo
-- esegue. Va eseguito SOLO a mano, nell'SQL Editor di Supabase, e SOLO dopo
-- un'autorizzazione esplicita. Procedura: docs/migrations/0012_ingredients_quantity_kind.md
--
-- PRIMA del rollback del database va ripristinato il codice precedente a P0-c:
-- il codice P0-c invia qty_kind/qty_min/qty_max/source_text e senza le colonne
-- il salvataggio degli ingredienti importati fallirebbe.
--
-- ATTENZIONE: eliminare colonne con dati CANCELLA quei dati. Lo script si
-- FERMA (errore, nessuna modifica) se anche una sola riga ha un valore in una
-- delle quattro colonne; in quel caso va fatta prima una copia di sicurezza
-- (variante B della procedura). Le righe con qty_kind 'variabile', 'mancante'
-- o 'intervallo' tornerebbero a essere lette come "0 g": e' proprio la perdita
-- che P0-c evita.
-- Tutto in un'unica transazione.
-- ============================================================================

begin;

do $$
declare
  n_dati bigint;
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'ingredients'
                and column_name in ('qty_kind', 'qty_min', 'qty_max', 'source_text')) then
    execute 'select count(*) from public.ingredients
              where qty_kind is not null or qty_min is not null or qty_max is not null or source_text is not null'
      into n_dati;
    if n_dati > 0 then
      raise exception 'Rollback 0012 fermato: % righe contengono dati P0-c. Eseguire prima la copia di sicurezza (variante B).', n_dati;
    end if;
  end if;
end $$;

alter table public.ingredients
  drop constraint if exists ingredients_qty_kind_chk,
  drop constraint if exists ingredients_qty_intervallo_chk,
  drop constraint if exists ingredients_qty_certa_chk,
  drop constraint if exists ingredients_qty_segnaposto_chk,
  drop constraint if exists ingredients_source_text_chk;

alter table public.ingredients
  drop column if exists qty_kind,
  drop column if exists qty_min,
  drop column if exists qty_max,
  drop column if exists source_text;

commit;
