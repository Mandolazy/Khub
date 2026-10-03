-- ============================================================================
-- KHUB — Canonical Ingredient Identity (B-light) — MS-CI1: solo database
-- ============================================================================
-- Distingue la riga ingrediente di una ricetta (ingredients.name resta il
-- nome/descrizione mostrato, es. "acqua fredda per il brodo") dall'identita'
-- dell'ingrediente fisico (canonical_ingredients, es. ACQUA).
--
-- ADDITIVA e RETROCOMPATIBILE:
--  - nessun backfill, nessuna modifica ai dati esistenti;
--  - canonical_ingredient_id e' NULLABLE ovunque: una riga senza collegamento
--    continua a comportarsi esattamente come oggi (identita' = nome);
--  - il codice attuale (load con select=*, save con colonne esplicite e
--    Prefer: resolution=merge-duplicates) ignora le colonne nuove e non le
--    azzera: un upsert aggiorna solo le colonne presenti nel payload.
--
-- Questa migration NON e' letta ne' scritta da alcun codice applicativo in
-- MS-CI1 (khub_mvp.html e api/chat.js non sono stati toccati): propagazione
-- e lookup arrivano in MS-CI2, collegamento chef in MS-CI3.
--
-- Idempotente: rieseguibile senza errori (IF NOT EXISTS / controlli su
-- pg_constraint e pg_policies).
-- ============================================================================

-- 1) Identita' canonica minima. id generato dal client (stesso pattern di
--    tutte le altre tabelle: text). name_key e' la forma normalizzata
--    (minuscolo, spazi ai bordi rimossi — stessa normalizzazione di
--    normalizeIngredientName nel client) e rende il nome unico in modo
--    case-insensitive: ACQUA / Acqua / " acqua " sono lo STESSO canonico.
--    Colonna generata (non citext: nessuna estensione) cosi' e' anche
--    interrogabile via REST (name_key=eq.acqua) e usabile come destinazione
--    di conflitto in caso di creazioni concorrenti.
create table if not exists canonical_ingredients (
  id          text primary key,
  name        text not null,
  name_key    text generated always as (lower(btrim(name))) stored,
  created_at  timestamptz not null default now(),
  constraint canonical_ingredients_name_not_blank check (btrim(name) <> '')
);

create unique index if not exists canonical_ingredients_name_key_uniq
  on canonical_ingredients (name_key);

-- 2) + 3) Riferimenti opzionali all'identita' canonica.
alter table ingredients
  add column if not exists canonical_ingredient_id text;

alter table ingredient_conversions
  add column if not exists canonical_ingredient_id text;

-- 4) FK ON DELETE RESTRICT: un canonico ancora usato da una riga ricetta o da
--    una conversione non puo' essere cancellato (nessuna perdita silenziosa
--    di collegamenti o di conoscenza).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ingredients_canonical_ingredient_fk'
  ) then
    alter table ingredients
      add constraint ingredients_canonical_ingredient_fk
      foreign key (canonical_ingredient_id) references canonical_ingredients(id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'ingredient_conversions_canonical_ingredient_fk'
  ) then
    alter table ingredient_conversions
      add constraint ingredient_conversions_canonical_ingredient_fk
      foreign key (canonical_ingredient_id) references canonical_ingredients(id)
      on delete restrict;
  end if;
end $$;

-- 5) Indici parziali: solo righe collegate (all'inizio nessuna).
create index if not exists idx_ingredients_canonical_ingredient_id
  on ingredients (canonical_ingredient_id)
  where canonical_ingredient_id is not null;

create index if not exists idx_ingredient_conversions_canonical_lookup
  on ingredient_conversions (canonical_ingredient_id, from_unit, to_unit, confirmed_at desc)
  where canonical_ingredient_id is not null;

-- 6) RLS: canonical_ingredients viene usata dall'app nello stesso contesto
--    operativo di ingredients (stessa chiave, stesse azioni). ingredients ha
--    RLS attiva con una sola policy permissiva ("allow all ingredients":
--    ALL, ruoli public, USING true). Si replica esattamente quel
--    comportamento. RLS e policy delle tabelle esistenti NON vengono toccate.
alter table canonical_ingredients enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'canonical_ingredients'
      and policyname = 'allow all canonical_ingredients'
  ) then
    create policy "allow all canonical_ingredients"
      on canonical_ingredients
      for all
      to public
      using (true)
      with check (true);
  end if;
end $$;
