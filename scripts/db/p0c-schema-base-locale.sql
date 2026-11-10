-- ============================================================================
-- KHUB — schema di BASE per i test locali con PostgreSQL + PostgREST (P0-c.1).
-- SOLO per database locali e temporanei: mai da eseguire su Supabase.
-- Ricostruisce le tabelle che nel progetto reale precedono le migrazioni del
-- repository (recipes, variants, ingredients, families, variant_families),
-- con i tipi verificati su KHUB Test per ingredients (qty numeric NOT NULL
-- DEFAULT 0, unit text NOT NULL DEFAULT 'g'). Le migrazioni 0001-0012 del
-- repository si applicano poi in ordine sopra questo schema.
-- ============================================================================
create table recipes (
  id text primary key, name text, category text, department text,
  production_variant_id text, -- colonna storica letta dalla migrazione 0001
  media_url text, video_url text, notes text,
  created_at timestamptz not null default now());
create table variants (
  id text primary key,
  recipe_id text references recipes(id) on delete cascade,
  name text, label text, note text, status text,
  shared boolean default false,
  portions_count integer not null default 4,
  grams_per_portion numeric not null default 200,
  steps text,
  validated_at timestamptz,
  media_url text, video_url text,
  primo_consulto text,
  contenuto_hash text,
  contenuto_modificato_il timestamptz,
  created_at timestamptz not null default now());
create table ingredients (
  id text primary key,
  variant_id text not null references variants(id) on delete cascade,
  name text not null,
  qty numeric not null default 0,
  unit text not null default 'g',
  sort_order int,
  is_sub_recipe boolean default false,
  sub_recipe_id text references variants(id),
  group_recipe_id text references recipes(id) on delete set null,
  created_at timestamptz not null default now());
create table families (id text primary key, name text, created_at timestamptz not null default now());
create table variant_families (
  variant_id text references variants(id) on delete cascade,
  family_id text references families(id) on delete cascade,
  primary key (variant_id, family_id));
