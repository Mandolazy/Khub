-- ============================================================================
-- KHUB — Sprint Produzione — Micro-Step 6: schema Sessioni di Produzione
-- ============================================================================
-- Introduce lo schema persistente delle Sessioni di Produzione, secondo le
-- decisioni architetturali gia' congelate (A5.1-A5.17): una Sessione e'
-- un'entita' autonoma, con snapshot write-once separato dallo stato di
-- esecuzione (check ingredienti/step, timer, note). Piu' Sessioni possono
-- coesistere per la stessa Ricetta attiva: nessun vincolo UNIQUE limita
-- questo modello. progress e' derivato, mai persistito. Nessun operator_id
-- (A5.13), nessun productionVariantId. Note append-only in tabella dedicata
-- (A5.12): nessun campo notes su production_sessions.
--
-- SOLO SCHEMA: nessun codice applicativo (khub_mvp.html, api/chat.js) legge
-- o scrive ancora queste tabelle in questo Micro-Step. targetPortions e
-- targetGramsPerPortion vivono esclusivamente nello snapshot (A5.17);
-- target_finished_total resta invece anche colonna interrogabile (A5.17).
--
-- FOREIGN KEY recipe_id / source_variant_id — decisione e motivazione
-- (vedi anche il report del Micro-Step): NESSUNA foreign key verso
-- recipes/variants. Sia deleteRecipe() sia deleteVariant()/eliminaBozza()
-- in khub_mvp.html eseguono una DELETE reale e definitiva sulle righe
-- recipes/variants (api/chat.js, azione generica 'delete', nessun controllo
-- di dipendenze verso Sessioni). Una Sessione completata deve pero' restare
-- consultabile anche se la Ricetta sorgente cambia o viene cancellata
-- (requisito esplicito). Una FK ON DELETE CASCADE distruggerebbe la
-- Sessione insieme alla Ricetta — inaccettabile. Una FK ON DELETE RESTRICT
-- impedirebbe per sempre la cancellazione di una Ricetta/Ricetta attiva che
-- abbia anche una sola Sessione storica, senza alcuna gestione applicativa
-- oggi presente per questo caso (fuori scope: questo Micro-Step non tocca
-- khub_mvp.html) — un comportamento fragile e sorprendente introdotto
-- silenziosamente da una migration DB. Si privilegia quindi la
-- conservazione storica della Sessione: nessuna FK, solo indici per le
-- query di lookup piu' comuni.
--
-- Le tre tabelle figlie (session_ingredient_state, session_step_state,
-- session_notes) esistono invece solo in funzione della propria Sessione:
-- una foreign key verso production_sessions(id) ON DELETE CASCADE e' la
-- strategia di cancellazione coerente e semplice richiesta esplicitamente.
--
-- Additiva, idempotente, non distruttiva: create table if not exists e
-- constraint/index guardati, compatibile con un database dove queste
-- tabelle esistano eventualmente gia'.
-- ============================================================================

create table if not exists production_sessions (
  id                     text primary key,

  recipe_id              text,          -- nessuna FK: vedi nota sopra (conservazione storica)
  source_variant_id      text,          -- nessuna FK: vedi nota sopra (conservazione storica)

  status                 text not null,
  snapshot_version       integer not null,
  snapshot               jsonb not null,   -- immutabile a livello applicativo: mai un UPDATE dopo la creazione

  target_finished_total  numeric not null, -- A5.17: targetPortions/targetGramsPerPortion restano SOLO nello snapshot

  created_at             timestamptz not null default now(),
  started_at             timestamptz,
  completed_at           timestamptz,

  actual_yield_qty       numeric,
  actual_yield_unit      text
);

-- status MVP: 'pending' | 'in_progress' | 'completed'.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'production_sessions_status_chk'
  ) then
    alter table production_sessions
      add constraint production_sessions_status_chk
      check (status in ('pending','in_progress','completed'));
  end if;
end $$;

create index if not exists idx_production_sessions_status_created_at
  on production_sessions (status, created_at desc);
create index if not exists idx_production_sessions_recipe_id
  on production_sessions (recipe_id);
create index if not exists idx_production_sessions_source_variant_id
  on production_sessions (source_variant_id);

-- ----------------------------------------------------------------------------
-- session_ingredient_state — check ingredienti, separato dallo snapshot.
-- item_key = identita' dell'ingrediente congelata nello snapshot (non una FK
-- verso ingredients: quella riga puo' cambiare o sparire, lo snapshot no).
-- ----------------------------------------------------------------------------
create table if not exists session_ingredient_state (
  id           text primary key,
  session_id   text not null references production_sessions(id) on delete cascade,
  item_key     text not null,
  checked      boolean not null default false,
  checked_at   timestamptz
);

create index if not exists idx_session_ingredient_state_session_id
  on session_ingredient_state (session_id);

-- ----------------------------------------------------------------------------
-- session_step_state — check/timer per step, separato dallo snapshot. Il
-- tempo previsto NON vive qui: appartiene allo step congelato nello
-- snapshot (steps_v2.expectedDurationSeconds, Micro-Step 5). Deliberatamente
-- NON ancora presenti in questo Micro-Step: timer_paused_at, pause/resume
-- history, expected duration come colonna, progress, operator_id.
-- ----------------------------------------------------------------------------
create table if not exists session_step_state (
  id                    text primary key,
  session_id            text not null references production_sessions(id) on delete cascade,
  item_key              text not null,
  checked               boolean not null default false,
  checked_at            timestamptz,
  timer_started_at      timestamptz,
  timer_actual_seconds  integer
);

create index if not exists idx_session_step_state_session_id
  on session_step_state (session_id);

-- ----------------------------------------------------------------------------
-- session_notes — append-only a livello applicativo (A5.12): mai un UPDATE,
-- solo INSERT. Nessun campo notes su production_sessions.
-- ----------------------------------------------------------------------------
create table if not exists session_notes (
  id           text primary key,
  session_id   text not null references production_sessions(id) on delete cascade,
  text         text not null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_session_notes_session_id
  on session_notes (session_id);
