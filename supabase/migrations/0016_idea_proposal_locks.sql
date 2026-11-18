-- ============================================================================
-- KHUB — P2-a.2 (blocco 2e, correzione del 2d): una sola proposta alla volta
-- ============================================================================
-- STATO: PREPARATA, NON ESEGUITA. Da applicare prima su KHUB Test, solo dopo
-- un'autorizzazione esplicita (procedura: docs/migrations/0016_idea_proposal_locks.md).
-- Richiede 0013 (public.ideas).
--
-- Una riga per Idea: la prenotazione della generazione di una proposta di
-- Ricetta (ideaProposal). Il server la crea con un INSERT (la chiave primaria fa
-- vincere una sola richiesta), la riprende solo se scaduta (UPDATE condizionato
-- su started_at) e la rilascia alla fine. Due richieste simultanee della stessa
-- Idea non producono due chiamate AI. Senza questa tabella il server lavora come
-- nel blocco 2d (nessun blocco).
-- Nessun testo dello chef: solo l'id dell'Idea e l'ora della prenotazione.
--
-- Accesso: SOLO dal server. RLS attivo senza policy; nessun privilegio per anon
-- e authenticated; service_role riceve SELECT, INSERT, UPDATE.
-- Additiva, idempotente, in un'unica transazione. Nessuna tabella esistente
-- viene modificata. Si ferma se la tabella esiste con colonne diverse.
-- ============================================================================

begin;

do $$
declare
  attese constant text[] := array['idea_id', 'started_at'];
  presenti text[];
begin
  if to_regclass('public.ideas') is null then
    raise exception 'P2-a.2: tabella public.ideas non trovata (applicare prima la 0013)';
  end if;
  if to_regclass('public.idea_proposal_locks') is not null then
    select array_agg(column_name::text order by column_name) into presenti
      from information_schema.columns where table_schema = 'public' and table_name = 'idea_proposal_locks';
    if presenti is distinct from (select array_agg(x order by x) from unnest(attese) x) then
      raise exception 'P2-a.2: public.idea_proposal_locks esiste gia'' con colonne diverse (%): nessuna modifica', presenti;
    end if;
    raise notice 'P2-a.2: public.idea_proposal_locks gia'' presente con le colonne attese';
  end if;
end $$;

create table if not exists public.idea_proposal_locks (
  idea_id     text        primary key references public.ideas(id) on delete cascade,
  started_at  timestamptz not null
);

alter table public.idea_proposal_locks enable row level security;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.idea_proposal_locks from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on table public.idea_proposal_locks from service_role;
    grant select, insert, update on table public.idea_proposal_locks to service_role;
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'idea_proposal_locks') then
    raise exception 'P2-a.2: public.idea_proposal_locks ha policy inattese: nessuna modifica';
  end if;
end $$;

comment on table public.idea_proposal_locks is 'P2-a.2: prenotazione di una generazione di proposta in corso, una per Idea. Accesso solo dal server.';
comment on column public.idea_proposal_locks.started_at is 'Inizio della prenotazione; scaduta dopo 120 s. Rilasciata con una data nel passato.';

commit;
