-- ============================================================================
-- KHUB — MichelinAI 2.0 — Sprint 1: Persistent State Layer
-- ============================================================================
-- Adds the physical schema for L2 (Ricetta-owned) and L3 (Scheda-owned)
-- knowledge, Intention/Criteria (Ricetta-owned), lineage between Ricette,
-- and multi-active support.
--
-- Frozen mapping (do not reinterpret):
--   recipe  = Scheda  (permanent/historical container)
--   variant = Ricetta (specific realization belonging to a Scheda)
--   Bozza   = a variant with status = 'lab'
--
-- This migration is additive only: it does not alter or drop any existing
-- data in recipes / variants / ingredients, and does not remove
-- recipes.production_variant_id (kept as legacy pointer).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. variants: new columns (lineage, multi-active, intention/criteria)
-- ----------------------------------------------------------------------------

alter table variants
  add column if not exists origin_variant_id text references variants(id) on delete restrict,
  add column if not exists active boolean not null default false,
  add column if not exists intention_initial jsonb,
  add column if not exists intention_current jsonb,
  add column if not exists criteria_initial jsonb,
  add column if not exists criteria_current jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'variants_origin_not_self'
  ) then
    alter table variants
      add constraint variants_origin_not_self
      check (origin_variant_id is null or origin_variant_id <> id);
  end if;
end $$;

create index if not exists idx_variants_origin_variant_id on variants(origin_variant_id);

-- Backfill: today's only "active" signal is recipes.production_variant_id
-- (single-pointer, legacy). We seed variants.active from it so existing
-- "in produzione" Ricette are not silently reset to active=false.
-- recipes.production_variant_id itself is left untouched (still legacy,
-- still functional) — this is a one-way, non-destructive backfill.
update variants v
set active = true
from recipes r
where r.production_variant_id = v.id
  and v.active = false;

-- ----------------------------------------------------------------------------
-- 2. l2_items — owned by the Ricetta (variant). Stable identity: upsert only,
--    never delete+reinsert (unlike the ingredients pattern).
-- ----------------------------------------------------------------------------

create table if not exists l2_items (
  id                 text primary key,
  variant_id         text not null references variants(id) on delete restrict,

  operational_state  text not null,
  decision_state     text not null,

  content            jsonb not null,
  evidence           jsonb,

  provenance_type    text not null,
  source_l2_item_id  text references l2_items(id) on delete restrict,

  -- Baseline = snapshot of the Ricetta's relevant state at the moment this
  -- L2Item was evaluated (NOT a snapshot of the L2Item itself). Always
  -- required together; the helper that produces them lives in lib/baseline.js.
  baseline_hash      text not null,
  baseline_context   jsonb not null,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'l2_items_operational_state_chk') then
    alter table l2_items add constraint l2_items_operational_state_chk
      check (operational_state in ('unengaged','open','affected','superseded','resolved'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'l2_items_decision_state_chk') then
    alter table l2_items add constraint l2_items_decision_state_chk
      check (decision_state in ('none','probable','confirmed'));
  end if;
  -- unengaged non puo' coesistere con una decisione: il contrario non e' imposto.
  if not exists (select 1 from pg_constraint where conname = 'l2_items_unengaged_implies_none_chk') then
    alter table l2_items add constraint l2_items_unengaged_implies_none_chk
      check (operational_state <> 'unengaged' or decision_state = 'none');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'l2_items_provenance_type_chk') then
    alter table l2_items add constraint l2_items_provenance_type_chk
      check (provenance_type in ('m1','m2','m3','handoff'));
  end if;
  -- source_l2_item_id e' presente se e solo se provenance_type = 'handoff' (biconditional).
  if not exists (select 1 from pg_constraint where conname = 'l2_items_handoff_iff_source_chk') then
    alter table l2_items add constraint l2_items_handoff_iff_source_chk
      check ((provenance_type = 'handoff') = (source_l2_item_id is not null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'l2_items_source_not_self_chk') then
    alter table l2_items add constraint l2_items_source_not_self_chk
      check (source_l2_item_id is null or source_l2_item_id <> id);
  end if;
end $$;

create index if not exists idx_l2_items_variant_id on l2_items(variant_id);
create index if not exists idx_l2_items_source_l2_item_id on l2_items(source_l2_item_id);

-- ----------------------------------------------------------------------------
-- 3. l3_items — owned by the Scheda (recipe). Every L3Item is traceable to a
--    source L2Item (gate: no distillation without L2 evidence). The Ricetta
--    of origin is NOT duplicated here: derive it via
--    origin_l2_item_id -> l2_items.variant_id (see report for the trade-off).
-- ----------------------------------------------------------------------------

create table if not exists l3_items (
  id                  text primary key,
  recipe_id           text not null references recipes(id) on delete restrict,

  distilled_content   jsonb not null,
  context_conditions  jsonb,
  known_limits        jsonb,

  origin_l2_item_id   text not null references l2_items(id) on delete restrict,
  supersedes_id       text references l3_items(id) on delete restrict,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'l3_items_supersedes_not_self_chk') then
    alter table l3_items add constraint l3_items_supersedes_not_self_chk
      check (supersedes_id is null or supersedes_id <> id);
  end if;
end $$;

create index if not exists idx_l3_items_recipe_id on l3_items(recipe_id);
create index if not exists idx_l3_items_origin_l2_item_id on l3_items(origin_l2_item_id);
create index if not exists idx_l3_items_supersedes_id on l3_items(supersedes_id);
