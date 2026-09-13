-- ============================================================================
-- KHUB — Sprint Produzione — Micro-Step 1B: ingredient_conversions
-- ============================================================================
-- Struttura persistente per le conversioni ingredient-specific (es. "n -> g"
-- per un ingrediente contato a pezzi; in futuro anche massa<->volume via
-- densita'). Sostituisce concettualmente S.unitWeights — oggi solo
-- in-memory lato client, mai persistito (nessun riferimento in
-- saveToSupabase/loadFromSupabase di khub_mvp.html, verificato) — con una
-- struttura dedicata e riutilizzabile tra Sessioni future (A5.15/A5.16).
--
-- Storicizzabile per design: NESSUN vincolo di unicita' su
-- (ingredient_name, from_unit, to_unit). Una correzione futura inserisce
-- una nuova riga con confirmed_at piu' recente; la fact corrente per una
-- coppia e' sempre la riga con confirmed_at massimo per quella coppia.
-- Nessuna riga viene mai aggiornata o cancellata per "correggere" un
-- valore precedente.
--
-- Non implementa ne' presuppone alcuna ricerca online: source_type e'
-- vincolato oggi a chef_confirmed/reference_data; un futuro
-- 'external_lookup' potra' essere aggiunto ampliando il solo CHECK,
-- senza alcuna modifica strutturale a questa tabella.
--
-- Questa migration NON e' letta ne' scritta da alcun codice applicativo in
-- questo Micro-Step (khub_mvp.html e api/chat.js non sono stati toccati):
-- la tabella viene creata vuota, in preparazione dei Micro-Step successivi.
-- ============================================================================

create table if not exists ingredient_conversions (
  id               text primary key,

  ingredient_name  text not null,       -- nome normalizzato (lowercase, trim) a cura del client
  from_unit        text not null,
  to_unit          text not null,
  factor           numeric not null,    -- quantita' in to_unit corrispondente a 1 from_unit

  source_type      text not null,
  source_detail    text,

  confirmed_at     timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ingredient_conversions_source_type_chk'
  ) then
    alter table ingredient_conversions
      add constraint ingredient_conversions_source_type_chk
      check (source_type in ('chef_confirmed', 'reference_data'));
  end if;
end $$;

-- Indice di lettura per la query "fact corrente" (riga piu' recente per la
-- coppia ingrediente/unita'). Deliberatamente un INDEX, MAI un vincolo
-- UNIQUE: piu' righe con la stessa (ingredient_name, from_unit, to_unit)
-- sono un comportamento previsto (storicizzazione), non un'anomalia.
create index if not exists idx_ingredient_conversions_lookup
  on ingredient_conversions (ingredient_name, from_unit, to_unit, confirmed_at desc);
