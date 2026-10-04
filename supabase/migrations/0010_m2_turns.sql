-- ============================================================================
-- KHUB — Cronologia conversazione MichelinAI M2 (Sviluppo)
-- ============================================================================
-- Conserva cio' che chef e MichelinAI si sono detti: UNA riga per turno
-- COMPLETATO (domanda + risposta valida), legata alla Ricetta (variant).
--
-- E' persistenza/visualizzazione, NON memoria cognitiva: la continuita'
-- cognitiva resta L2/L3/intention/criteria. Questa tabella non viene mai
-- letta per costruire il payload inviato ad Anthropic.
--
-- - Una sola cronologia per variant (CHAT-01): segue lo stesso variant.id
--   in tutto il lifecycle (Bozza -> Pronta -> Attiva -> Archiviata); una
--   Ricetta con un nuovo variant.id parte vuota.
-- - ON DELETE CASCADE (CHAT-02): se la Ricetta viene davvero eliminata, la
--   sua cronologia se ne va con lei. I cambi di stato non toccano nulla.
-- - id generato dal client: il retry del salvataggio dello stesso turno e'
--   idempotente (insert con ignore-duplicates).
-- - created_at inviato dal client (istante del turno completato), default
--   now(): l'ordine resta quello reale anche se un turno viene salvato in
--   ritardo da un retry.
--
-- ADDITIVA: nessuna modifica a variants, l2_items, l3_items, ingredienti,
-- conversioni o produzione. Idempotente (IF NOT EXISTS / pg_policies).
-- ============================================================================

create table if not exists m2_turns (
  id          text primary key,
  variant_id  text not null references variants(id) on delete cascade,
  question    text not null,
  response    text not null,
  created_at  timestamptz not null default now()
);

-- Lettura per variant con ordine stabile (created_at, id) e paginazione.
create index if not exists idx_m2_turns_variant_created
  on m2_turns (variant_id, created_at, id);

-- RLS: stesso modello delle tabelle della Ricetta usate dall'app con la
-- stessa chiave (RLS attiva + una sola policy permissiva). Nessun redesign
-- Auth/RLS in questo sprint.
alter table m2_turns enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'm2_turns'
      and policyname = 'allow all m2_turns'
  ) then
    create policy "allow all m2_turns"
      on m2_turns
      for all
      to public
      using (true)
      with check (true);
  end if;
end $$;
