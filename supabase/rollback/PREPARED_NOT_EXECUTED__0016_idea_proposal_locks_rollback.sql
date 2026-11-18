-- ============================================================================
-- KHUB — Rollback di 0016_idea_proposal_locks.sql
-- ============================================================================
-- STATO: PREPARATO, NON ESEGUITO. Fuori dalla sequenza supabase/migrations/:
-- solo a mano, nell'SQL Editor, dopo un'autorizzazione esplicita.
-- Procedura: docs/migrations/0016_idea_proposal_locks.md
--
-- La tabella contiene solo prenotazioni temporanee (id dell'Idea e ora), mai
-- testi dello chef: eliminarla non cancella contenuti. Il codice del blocco 2e
-- funziona anche senza (torna al comportamento del 2d), quindi non serve
-- ripristinare il codice prima. Nessun'altra tabella e' toccata.
-- ============================================================================

begin;

drop table if exists public.idea_recipe_claims;
drop table if exists public.idea_proposal_locks;

commit;
