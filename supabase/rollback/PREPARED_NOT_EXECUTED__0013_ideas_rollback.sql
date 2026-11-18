-- ============================================================================
-- KHUB — Rollback di 0013_ideas.sql
-- ============================================================================
-- STATO: PREPARATO, NON ESEGUITO. Fuori dalla sequenza supabase/migrations/:
-- solo a mano, nell'SQL Editor, dopo un'autorizzazione esplicita.
-- Procedura: docs/migrations/0013_ideas.md
--
-- PRIMA va ripristinato il codice precedente a P2-a.1 (il codice P2-a.1 legge e
-- scrive public.ideas). Eliminare la tabella CANCELLA le Idee: lo script si
-- FERMA (errore, nessuna modifica) se la tabella contiene anche una sola riga.
-- In quel caso va fatta prima una copia (variante B della procedura).
-- Nessun'altra tabella e' toccata (i riferimenti partono da ideas verso
-- recipes/variants, non il contrario).
-- ============================================================================

begin;

do $$
declare n bigint;
begin
  -- P2-a.2: la conversazione delle Idee (0014) dipende da ideas: va tolta prima.
  if to_regclass('public.idea_turns') is not null then
    raise exception 'Rollback 0013 fermato: esiste public.idea_turns (0014). Eseguire prima il rollback 0014.';
  end if;
  if to_regclass('public.ideas') is not null then
    execute 'select count(*) from public.ideas' into n;
    if n > 0 then
      raise exception 'Rollback 0013 fermato: public.ideas contiene % righe. Eseguire prima la copia (variante B).', n;
    end if;
  end if;
end $$;

drop table if exists public.ideas;

commit;
