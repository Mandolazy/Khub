-- ============================================================================
-- KHUB TEST — installazione di collaudo di elimina_scheda_se_vuota.
-- Eseguire SOLO nel progetto Supabase "KHUB Test" (controllare il nome del
-- progetto in alto nel SQL Editor). MAI in Production.
-- Corpo identico a docs/proposte/elimina_scheda_se_vuota.sql (commit 607a27f).
-- ============================================================================
-- Scopo: "Unisci Ricette in un'unica Scheda" elimina una Scheda di origine
-- SOLO se e' davvero vuota, anche con salvataggi concorrenti (es. una
-- finestra rimasta aperta che risalva una Ricetta nella Scheda assorbita).
--
-- Oggi il server controlla "Scheda vuota" e poi esegue la DELETE con due
-- richieste separate: fra le due una Ricetta puo' tornare nella Scheda e la
-- cascata (variants.recipe_id ON DELETE CASCADE) la cancellerebbe.
--
-- Questa funzione chiude la finestra in un'unica transazione, SENZA toccare
-- ON DELETE CASCADE, che resta per "Elimina Scheda" (eliminazione voluta).
-- Nessun vincolo, tabella o dato esistente viene modificato: lo script crea
-- solo la funzione e ne imposta i permessi.
--
-- Perche' e' sicura:
--  1. SELECT ... FOR UPDATE sulla riga della Scheda. Chi inserisce una
--     Ricetta in questa Scheda, o ne cambia recipe_id verso questa Scheda,
--     prende FOR KEY SHARE sulla stessa riga (controllo della foreign key):
--     i due blocchi sono incompatibili. Quindi la funzione aspetta chi sta
--     gia' scrivendo, e chi arriva dopo aspetta la funzione; dopo
--     l'eliminazione il suo salvataggio fallisce per foreign key (nessuna
--     Ricetta persa: resta nella sua finestra e l'errore e' visibile).
--  2. Il controllo "vuota" e' un'istruzione successiva al blocco: in READ
--     COMMITTED (default di PostgREST) ogni istruzione di una funzione
--     VOLATILE prende una nuova fotografia dei dati e vede anche le Ricette
--     confermate mentre la funzione aspettava. In un altro livello di
--     isolamento questa garanzia non vale: la funzione si rifiuta di operare.
--  3. Se la Scheda non e' vuota, o ha osservazioni L3, non elimina nulla e
--     lo dice; se il blocco non si ottiene entro lock_timeout, errore e
--     nessuna eliminazione.
-- Nessuna osservazione MichelinAI viene eliminata (l3_items resta RESTRICT).
--
-- Installazione: l'intero script e' una sola transazione. Se una verifica
-- preliminare o finale fallisce, nulla viene creato (ROLLBACK automatico):
-- la funzione non e' mai visibile ad altri ruoli prima del COMMIT, e la
-- notifica a PostgREST parte solo al COMMIT.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 0. Verifiche preliminari (sola lettura). Interrompono tutto se lo schema
--    reale non e' quello su cui la funzione e' stata ragionata.
-- ----------------------------------------------------------------------------
do $$
declare
  r record;
begin
  -- a) La funzione non deve esistere gia': CREATE OR REPLACE conserverebbe
  --    proprietario e privilegi precedenti. Se esiste, ci si ferma e la si
  --    esamina a mano (nessuna sostituzione automatica).
  if to_regprocedure('public.elimina_scheda_se_vuota(text)') is not null then
    raise exception 'elimina_scheda_se_vuota(text) esiste gia'': installazione interrotta, verificarla manualmente';
  end if;

  -- b) Tipi: p_recipe_id e' text; recipes.id e le colonne che la
  --    referenziano devono essere text (o varchar, confrontabile con text
  --    usando lo stesso indice).
  for r in
    select c.table_name, c.column_name, c.data_type
    from information_schema.columns c
    where c.table_schema = 'public'
      and ((c.table_name = 'recipes' and c.column_name = 'id')
        or (c.table_name = 'variants' and c.column_name = 'recipe_id')
        or (c.table_name = 'l3_items' and c.column_name = 'recipe_id'))
  loop
    if r.data_type not in ('text', 'character varying') then
      raise exception 'tipo inatteso per %.%: % (atteso text)', r.table_name, r.column_name, r.data_type;
    end if;
  end loop;
  if (select count(*) from information_schema.columns c
      where c.table_schema = 'public'
        and ((c.table_name = 'recipes' and c.column_name = 'id')
          or (c.table_name = 'variants' and c.column_name = 'recipe_id')
          or (c.table_name = 'l3_items' and c.column_name = 'recipe_id'))) <> 3 then
    raise exception 'colonne attese non trovate (recipes.id, variants.recipe_id, l3_items.recipe_id)';
  end if;

  -- c) Foreign key verso recipes: la funzione elimina solo Schede senza
  --    Ricette e senza L3. Qualunque altra FK che alla cancellazione di una
  --    Scheda CANCELLI o AZZERI righe (CASCADE, SET NULL, SET DEFAULT)
  --    cancellerebbe dati in silenzio: in quel caso ci si ferma.
  --    (RESTRICT / NO ACTION non perdono dati: farebbero solo fallire la
  --    cancellazione, con errore e nessun effetto.)
  for r in
    select con.conname, con.conrelid::regclass as tabella, con.confdeltype
    from pg_constraint con
    where con.contype = 'f' and con.confrelid = 'public.recipes'::regclass
  loop
    if r.confdeltype in ('c', 'n', 'd') and r.tabella::text not in ('variants', 'public.variants') then
      raise exception 'FK inattesa verso recipes con cancellazione a cascata/azzeramento: % su %', r.conname, r.tabella;
    end if;
  end loop;

  -- d) Trigger utente che scattano alla cancellazione di una Scheda: non
  --    previsti. Se esistono, ci si ferma per esaminarli.
  if exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'public.recipes'::regclass and not t.tgisinternal
      and (t.tgtype::int & 8) <> 0                    -- TRIGGER_TYPE_DELETE
  ) then
    raise exception 'trigger ON DELETE su recipes presenti: installazione interrotta, esaminarli';
  end if;

  -- e) Ruolo del server.
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception 'ruolo service_role non trovato';
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 1. Funzione. CREATE (non OR REPLACE): se esistesse, errore e ROLLBACK.
-- ----------------------------------------------------------------------------
create function public.elimina_scheda_se_vuota(p_recipe_id text)
returns text
language plpgsql
volatile                       -- necessario: nuova fotografia a ogni istruzione
security invoker
set search_path = public, pg_temp
set lock_timeout = '5s'        -- mai un'attesa indefinita sul blocco
as $$
begin
  if p_recipe_id is null or length(p_recipe_id) = 0 or length(p_recipe_id) > 200 then
    raise exception 'elimina_scheda_se_vuota: id non valido' using errcode = '22023';
  end if;

  -- La garanzia del punto 2 vale solo in READ COMMITTED.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'elimina_scheda_se_vuota: richiede READ COMMITTED (trovato %)',
      current_setting('transaction_isolation') using errcode = '25001';
  end if;

  -- 1. Blocco della Scheda (vedi sopra).
  perform 1 from public.recipes where id = p_recipe_id for update;
  if not found then
    return 'assente';
  end if;

  -- 2. Verifiche dopo il blocco (istruzioni nuove: vedono i dati confermati).
  if exists (select 1 from public.variants where recipe_id = p_recipe_id) then
    return 'non_vuota';
  end if;
  if exists (select 1 from public.l3_items where recipe_id = p_recipe_id) then
    return 'osservazioni_michelinai';
  end if;

  -- 3. Eliminazione: la cascata non trova Ricette e nessuna puo' arrivare
  --    (inserirla richiederebbe il blocco che questa transazione detiene).
  delete from public.recipes where id = p_recipe_id;
  return 'eliminata';
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Permessi: solo il server (chiave segreta = service_role).
--    Su Supabase i privilegi predefiniti dello schema public concedono le
--    nuove funzioni direttamente ad anon e authenticated, oltre a PUBLIC:
--    si revocano tutti esplicitamente.
-- ----------------------------------------------------------------------------
revoke all on function public.elimina_scheda_se_vuota(text) from public;
revoke all on function public.elimina_scheda_se_vuota(text) from anon, authenticated;
grant execute on function public.elimina_scheda_se_vuota(text) to service_role;

-- ----------------------------------------------------------------------------
-- 3. Verifica finale dei permessi, prima del COMMIT. Ammessi solo il
--    proprietario della funzione e service_role; altrimenti ROLLBACK.
-- ----------------------------------------------------------------------------
do $$
declare
  f oid := 'public.elimina_scheda_se_vuota(text)'::regprocedure;
  proprietario oid;
  r record;
begin
  select proowner into proprietario from pg_proc where oid = f;
  for r in select (aclexplode(proacl)).* from pg_proc where oid = f loop
    if r.grantee <> proprietario and r.grantee <> 'service_role'::regrole then
      raise exception 'privilegio inatteso sulla funzione per il ruolo % (oid %)',
        coalesce((select rolname from pg_roles where oid = r.grantee), 'PUBLIC'), r.grantee;
    end if;
  end loop;
  if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then
    raise exception 'anon o authenticated possono ancora eseguire la funzione';
  end if;
  if not has_function_privilege('service_role', f, 'EXECUTE') then
    raise exception 'service_role non puo'' eseguire la funzione';
  end if;
end
$$;

-- PostgREST: ricaricare la cache dello schema. Dentro la transazione la
-- notifica viene consegnata solo al COMMIT (mai se c'e' ROLLBACK).
notify pgrst, 'reload schema';

commit;

-- ============================================================================
-- Rollback (se necessario, anch'esso in transazione):
--   begin;
--   drop function if exists public.elimina_scheda_se_vuota(text);
--   notify pgrst, 'reload schema';
--   commit;
-- ============================================================================
