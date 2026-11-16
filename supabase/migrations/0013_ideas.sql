-- ============================================================================
-- KHUB — P2-a.1: Idee (tabella separata dalle Ricette)
-- ============================================================================
-- STATO: PREPARATA, NON ESEGUITA. Da applicare prima su KHUB Test, solo dopo
-- un'autorizzazione esplicita (procedura: docs/migrations/0013_ideas.md).
--
-- Un'Idea e' materiale di partenza non formulato: un link (anche non
-- leggibile), un testo fornito, un appunto, con o senza un'anteprima
-- strutturata. Non e' una Ricetta: nessuna relazione con validazione,
-- attivazione, calcoli o Produzione (che leggono solo recipes, variants,
-- ingredients). Le uniche relazioni sono i riferimenti, facoltativi, alla
-- Ricetta creata in futuro da un'Idea (on delete set null).
--
-- Stato (ciclo di vita) e contenuto sono indipendenti:
--   status          aperta | trasformata | archiviata  (solo ciclo di vita)
--   source_type     link | testo | appunto             (provenienza)
--   preview         anteprima strutturata o NULL        (presenza = "analizzata")
--   preview_origin  strutturata | ai, NULL se preview e' NULL (vincolo)
-- Non esiste uno stato "analizzata": un'Idea e' grezza o analizzata solo in
-- base alla presenza dell'anteprima, cosi' nessuna combinazione e' ambigua.
--
-- Accesso: SOLO dal server (chiave secret = service_role, che ignora RLS).
-- RLS attivo senza alcuna policy e privilegi revocati ad anon e
-- authenticated: nessun accesso diretto dall'API pubblica.
-- Additiva, idempotente, in un'unica transazione. Nessuna tabella esistente
-- viene modificata. Se una tabella public.ideas esiste gia' con una struttura
-- diversa la migrazione si ferma senza modificare nulla.
-- ============================================================================

begin;

do $$
declare
  attese constant text[] := array['id','title','status','source_type','source_url','source_text',
    'preview','preview_origin','notes','linked_recipe_id','linked_variant_id','created_at','updated_at'];
  presenti text[];
begin
  if to_regclass('public.recipes') is null or to_regclass('public.variants') is null then
    raise exception 'P2-a.1: tabelle public.recipes o public.variants non trovate';
  end if;
  if to_regclass('public.ideas') is not null then
    select array_agg(column_name::text order by column_name) into presenti
      from information_schema.columns where table_schema = 'public' and table_name = 'ideas';
    if presenti is distinct from (select array_agg(x order by x) from unnest(attese) x) then
      raise exception 'P2-a.1: public.ideas esiste gia'' con colonne diverse (%): nessuna modifica', presenti;
    end if;
    raise notice 'P2-a.1: public.ideas gia'' presente con le colonne attese';
  end if;
end $$;

create table if not exists public.ideas (
  id                text        primary key check (id ~ '^idea_[A-Za-z0-9_-]{8,64}$'),
  title             text        not null check (char_length(btrim(title)) between 1 and 200),
  status            text        not null default 'aperta' check (status in ('aperta', 'trasformata', 'archiviata')),
  source_type       text        not null check (source_type in ('link', 'testo', 'appunto')),
  source_url        text        check (source_url is null or (char_length(source_url) <= 2000 and source_url ~* '^https?://[^\s]+$')),
  source_text       text        check (source_text is null or char_length(source_text) between 1 and 20000),
  preview           jsonb       check (preview is null or (jsonb_typeof(preview) = 'object' and octet_length(preview::text) <= 200000)),
  preview_origin    text        check (preview_origin is null or preview_origin in ('strutturata', 'ai')),
  notes             text        check (notes is null or char_length(notes) <= 5000),
  linked_recipe_id  text        references public.recipes(id) on delete set null,
  linked_variant_id text        references public.variants(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- Coerenza della provenienza (nessuna Idea vuota, nessuna combinazione ambigua):
  constraint ideas_link_chk     check (source_type <> 'link' or source_url is not null),
  constraint ideas_testo_chk    check (source_type not in ('testo', 'appunto') or source_text is not null),
  constraint ideas_appunto_chk  check (source_type <> 'appunto' or (source_url is null and preview is null)),
  constraint ideas_preview_chk  check ((preview is null) = (preview_origin is null))
  -- Nessun vincolo fra linked_recipe_id e linked_variant_id: con due chiavi
  -- esterne "on delete set null" un CHECK fra le due bloccherebbe l'eliminazione
  -- di una Scheda (verificato nei test). La coerenza dei riferimenti spetta al
  -- server che li scrivera' (fase di trasformazione, non ancora implementata).
);

create index if not exists ideas_status_created_idx on public.ideas (status, created_at desc);

-- Accesso privato: RLS senza policy + nessun privilegio per i ruoli dell'API pubblica.
alter table public.ideas enable row level security;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.ideas from %I', r);
    end if;
  end loop;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ideas') then
    raise exception 'P2-a.1: public.ideas ha policy inattese: nessuna modifica';
  end if;
end $$;

comment on table public.ideas is 'P2-a.1: Idee (materiale di partenza). Separate dalle Ricette; accesso solo dal server.';
comment on column public.ideas.preview is 'Anteprima strutturata normalizzata dal server (ingredienti con tipo di quantita'', passaggi, resa e tempi dichiarati, provenienza). NULL = Idea grezza.';
comment on column public.ideas.preview_origin is 'strutturata (schema.org/Recipe, senza AI) | ai. NULL se preview e'' NULL.';

commit;
