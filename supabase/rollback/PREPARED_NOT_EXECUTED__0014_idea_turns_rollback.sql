-- ============================================================================
-- KHUB — Rollback di 0014_idea_turns.sql
-- ============================================================================
-- STATO: PREPARATO, NON ESEGUITO. Fuori dalla sequenza supabase/migrations/:
-- solo a mano, nell'SQL Editor, dopo un'autorizzazione esplicita.
-- Procedura: docs/migrations/0014_idea_turns.md
--
-- PRIMA va ripristinato il codice precedente al blocco 2b (il codice 2b legge e
-- scrive public.idea_turns). Eliminare la tabella CANCELLA le conversazioni:
-- lo script si FERMA (errore, nessuna modifica) se la tabella contiene anche
-- una sola riga. In quel caso va fatta prima una copia (variante B).
-- Nessun'altra tabella e' toccata (public.ideas resta com'e').
-- ============================================================================

begin;

do $$
declare n bigint;
begin
  if to_regclass('public.idea_turns') is not null then
    execute 'select count(*) from public.idea_turns' into n;
    if n > 0 then
      raise exception 'Rollback 0014 fermato: public.idea_turns contiene % righe. Eseguire prima la copia (variante B).', n;
    end if;
  end if;
end $$;

drop table if exists public.idea_turns;

commit;
