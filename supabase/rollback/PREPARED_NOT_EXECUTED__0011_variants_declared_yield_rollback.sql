-- ============================================================================
-- KHUB — Rollback di 0011_variants_declared_yield.sql
-- ============================================================================
-- STATO: PREPARATO, NON ESEGUITO.
-- Non fa parte della sequenza supabase/migrations/ e nessuna pipeline lo
-- esegue. Va eseguito SOLO a mano, nell'SQL Editor di Supabase, e SOLO dopo
-- un'autorizzazione esplicita. Procedura completa e avvertenze:
-- docs/migrations/0011_variants_declared_yield.md
--
-- ATTENZIONE: eliminare una colonna che contiene dati CANCELLA quei dati in
-- modo definitivo. Per questo lo script si FERMA (errore, nessuna modifica)
-- se anche una sola riga ha un valore in declared_yield_qty o
-- declared_yield_unit. In quel caso seguire la variante B della procedura
-- (copia di sicurezza prima di eliminare).
--
-- Tutto in un'unica transazione: o va a buon fine per intero, o non cambia
-- nulla.
-- ============================================================================

begin;

do $$
declare
  n_dati bigint;
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'variants'
               and column_name in ('declared_yield_qty', 'declared_yield_unit')) then
    execute 'select count(*) from public.variants
             where declared_yield_qty is not null or declared_yield_unit is not null'
      into n_dati;
    if n_dati > 0 then
      raise exception 'Rollback interrotto: % righe hanno una resa dichiarata. Eliminare le colonne cancellerebbe questi dati. Seguire la variante B (copia di sicurezza) della procedura.', n_dati;
    end if;
  end if;
end $$;

alter table public.variants
  drop column if exists declared_yield_qty,
  drop column if exists declared_yield_unit;

commit;
