-- ============================================================================
-- KHUB — MichelinAI 2.0 — Sprint 1: fix constraint l2_items
-- ============================================================================
-- Il database reale ha ricevuto la prima versione di 0001, prima delle due
-- correzioni di code review (CHECK handoff bicondizionale +
-- unengaged->none). Questa migration porta i constraint allo stato corretto,
-- senza toccare altro.
-- ============================================================================

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'l2_items_source_only_handoff_chk') then
    alter table l2_items drop constraint l2_items_source_only_handoff_chk;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'l2_items_handoff_iff_source_chk') then
    alter table l2_items add constraint l2_items_handoff_iff_source_chk
      check ((provenance_type = 'handoff') = (source_l2_item_id is not null));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'l2_items_unengaged_implies_none_chk') then
    alter table l2_items add constraint l2_items_unengaged_implies_none_chk
      check (operational_state <> 'unengaged' or decision_state = 'none');
  end if;
end $$;
