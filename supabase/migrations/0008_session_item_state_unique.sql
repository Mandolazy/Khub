-- ============================================================================
-- KHUB — Sprint Produzione — Correzione Micro-Step 6: unicita' stato item
-- ============================================================================
-- Decisione congelata: per una stessa Sessione puo' esistere al massimo una
-- riga session_ingredient_state per item_key e una riga session_step_state
-- per item_key — lo stato operativo (checked/timer) di un ingrediente o di
-- uno step all'interno di una Sessione non deve mai essere ambiguo.
--
-- La migration 0007 (production_sessions + tabelle figlie) e' gia' stata
-- committata e pushata: questa migration NON la modifica retroattivamente,
-- aggiunge additivamente il vincolo mancante.
--
-- session_notes e' esplicitamente ESCLUSA: resta una cronologia
-- append-only (A5.12), piu' note per la stessa Sessione sono un caso
-- previsto e voluto, non un'anomalia.
--
-- Additiva e idempotente: il vincolo viene aggiunto solo se non esiste
-- gia' (compatibile con un database dove sia stato creato in anticipo con
-- lo stesso nome). Non distruttiva: nessun dato esistente viene toccato.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'session_ingredient_state_session_item_uniq'
  ) then
    alter table session_ingredient_state
      add constraint session_ingredient_state_session_item_uniq
      unique (session_id, item_key);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'session_step_state_session_item_uniq'
  ) then
    alter table session_step_state
      add constraint session_step_state_session_item_uniq
      unique (session_id, item_key);
  end if;
end $$;
