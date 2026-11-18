-- ============================================================================
-- KHUB — P2-a.2 (blocco 2e e release): una sola proposta e una sola
--        trasformazione alla volta per Idea
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
-- Seconda tabella (release): idea_recipe_claims, la prenotazione della
-- trasformazione di un'Idea in Ricetta. La pagina la chiede PRIMA di salvare la
-- Scheda, con gli id della propria Scheda/Bozza: due dispositivi che trasformano
-- la stessa Idea non creano due Ricette (il secondo non salva nulla).
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
  attese_claims constant text[] := array['claimed_at', 'idea_id', 'recipe_id', 'variant_id'];
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
  if to_regclass('public.idea_recipe_claims') is not null then
    select array_agg(column_name::text order by column_name) into presenti
      from information_schema.columns where table_schema = 'public' and table_name = 'idea_recipe_claims';
    if presenti is distinct from attese_claims then
      raise exception 'P2-a.2: public.idea_recipe_claims esiste gia'' con colonne diverse (%): nessuna modifica', presenti;
    end if;
  end if;
end $$;

create table if not exists public.idea_proposal_locks (
  idea_id     text        primary key references public.ideas(id) on delete cascade,
  started_at  timestamptz not null
);

-- Id della Scheda/Bozza come testo, senza chiave esterna: la prenotazione nasce
-- PRIMA che la Scheda esista.
create table if not exists public.idea_recipe_claims (
  idea_id     text        primary key references public.ideas(id) on delete cascade,
  recipe_id   text        not null check (char_length(recipe_id) between 1 and 200),
  variant_id  text        not null check (char_length(variant_id) between 1 and 200),
  claimed_at  timestamptz not null
);

alter table public.idea_proposal_locks enable row level security;
alter table public.idea_recipe_claims enable row level security;
do $$
declare r text; t text;
begin
  foreach t in array array['idea_proposal_locks', 'idea_recipe_claims'] loop
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on table public.%I from %I', t, r);
      end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('revoke all on table public.%I from service_role', t);
      execute format('grant select, insert, update on table public.%I to service_role', t);
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t) then
      raise exception 'P2-a.2: public.% ha policy inattese: nessuna modifica', t;
    end if;
  end loop;
end $$;

comment on table public.idea_proposal_locks is 'P2-a.2: prenotazione di una generazione di proposta in corso, una per Idea. Accesso solo dal server.';
comment on column public.idea_proposal_locks.started_at is 'Inizio della prenotazione; scaduta dopo 120 s. Rilasciata con una data nel passato.';
comment on table public.idea_recipe_claims is 'P2-a.2: prenotazione della trasformazione di un''Idea in Ricetta (un solo dispositivo). Accesso solo dal server.';

commit;
