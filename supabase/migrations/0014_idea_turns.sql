-- ============================================================================
-- KHUB — P2-a.2 (blocco 2b): conversazione persistente delle Idee
-- ============================================================================
-- STATO: PREPARATA, NON ESEGUITA. Da applicare prima su KHUB Test, solo dopo
-- un'autorizzazione esplicita (procedura: docs/migrations/0014_idea_turns.md).
-- Richiede 0013 (public.ideas).
--
-- Un turno = un messaggio dello chef + la risposta di MichelinAI per una Idea.
-- La riga nasce PRIMA della chiamata AI (stato in_corso, con scadenza) e
-- diventa completato o fallito: e' il meccanismo atomico che garantisce una
-- sola elaborazione per turno anche con richieste simultanee o ripetute.
--   status in_corso   : elaborazione prenotata fino a lease_until
--   status completato : risposta salvata (immutabile)
--   status fallito    : errore registrato (error_code); si puo' riprovare
-- Un solo turno in_corso per Idea (indice unico parziale): niente risposte
-- che si sovrappongono. Una prenotazione scaduta (funzione interrotta) non
-- blocca mai: il server la chiude o la riprende.
--
-- Accesso: SOLO dal server. RLS attivo senza policy; nessun privilegio per
-- anon e authenticated; service_role riceve esplicitamente SELECT, INSERT,
-- UPDATE (i turni non si cancellano; la cancellazione di un'Idea li elimina
-- in cascata). Non usa la policy aperta di m2_turns.
-- Additiva, idempotente, in un'unica transazione. Nessuna tabella esistente
-- viene modificata. Si ferma se public.idea_turns esiste con colonne diverse.
-- ============================================================================

begin;

do $$
declare
  attese constant text[] := array['id','idea_id','question','question_origin','question_hash','response','status',
    'attempts','lease_until','error_code','created_at','updated_at','completed_at'];
  presenti text[];
begin
  if to_regclass('public.ideas') is null then
    raise exception 'P2-a.2: tabella public.ideas non trovata (applicare prima la 0013)';
  end if;
  if to_regclass('public.idea_turns') is not null then
    select array_agg(column_name::text order by column_name) into presenti
      from information_schema.columns where table_schema = 'public' and table_name = 'idea_turns';
    if presenti is distinct from (select array_agg(x order by x) from unnest(attese) x) then
      raise exception 'P2-a.2: public.idea_turns esiste gia'' con colonne diverse (%): nessuna modifica', presenti;
    end if;
    raise notice 'P2-a.2: public.idea_turns gia'' presente con le colonne attese';
  end if;
end $$;

create table if not exists public.idea_turns (
  id               text        primary key check (id ~ '^it_[A-Za-z0-9_-]{8,64}$'),
  idea_id          text        not null references public.ideas(id) on delete cascade,
  question         text        not null check (char_length(btrim(question)) between 1 and 4000),
  question_origin  text        not null check (question_origin in ('testo', 'voce')),
  question_hash    text        not null check (question_hash ~ '^[0-9a-f]{64}$'),
  response         text        check (response is null or char_length(response) between 1 and 20000),
  status           text        not null default 'in_corso' check (status in ('in_corso', 'completato', 'fallito')),
  attempts         integer     not null default 1 check (attempts between 1 and 10),
  lease_until      timestamptz,
  error_code       text        check (error_code is null or error_code ~ '^[a-z_]{1,40}$'),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  completed_at     timestamptz,
  -- Stati coerenti: nessuna risposta senza completamento, nessuna prenotazione senza scadenza.
  constraint idea_turns_stato_chk check (
       (status = 'in_corso'   and response is null     and lease_until is not null and completed_at is null)
    or (status = 'completato' and response is not null and lease_until is null     and completed_at is not null and error_code is null)
    or (status = 'fallito'    and response is null     and lease_until is null     and completed_at is null     and error_code is not null))
);

-- Cronologia di un'Idea (ordine stabile) e conteggio giornaliero.
create index if not exists idea_turns_cronologia_idx on public.idea_turns (idea_id, created_at, id);
create index if not exists idea_turns_creati_idx on public.idea_turns (created_at);
-- Al massimo un turno in elaborazione per Idea.
create unique index if not exists idea_turns_uno_in_corso_idx on public.idea_turns (idea_id) where status = 'in_corso';

-- Accesso privato: RLS senza policy, privilegi espliciti (vedi 0013).
alter table public.idea_turns enable row level security;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.idea_turns from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    revoke all on table public.idea_turns from service_role;
    grant select, insert, update on table public.idea_turns to service_role;
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'idea_turns') then
    raise exception 'P2-a.2: public.idea_turns ha policy inattese: nessuna modifica';
  end if;
end $$;

comment on table public.idea_turns is 'P2-a.2: conversazione delle Idee con MichelinAI (un turno = messaggio + risposta). Accesso solo dal server.';
comment on column public.idea_turns.question_hash is 'sha256 del messaggio normalizzato: lo stesso id non puo'' essere riusato con un messaggio diverso.';
comment on column public.idea_turns.lease_until is 'Scadenza della prenotazione di un turno in_corso: dopo, il turno si chiude o si riprende.';

commit;
