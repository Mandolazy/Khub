-- ============================================================================
-- KHUB — PROPOSTA, NON ESEGUITA. Richiede approvazione separata.
-- Volutamente fuori da supabase/migrations: non e' una migrazione.
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
--  3. Se la Scheda non e' vuota, ha osservazioni L3 o e' ancora indicata da
--     altre righe (recipes.parent_recipe_id, ingredients.group_recipe_id,
--     entrambe ON DELETE SET NULL), non elimina nulla e lo dice: la
--     cancellazione non scollega mai in silenzio un riferimento. Se il blocco
--     non si ottiene entro lock_timeout, errore e nessuna eliminazione.
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
  -- Colonne dei riferimenti controllati dalla funzione (stesso tipo di recipes.id).
  for r in
    select c.table_name, c.column_name, c.data_type
    from information_schema.columns c
    where c.table_schema = 'public'
      and ((c.table_name = 'recipes' and c.column_name = 'parent_recipe_id')
        or (c.table_name = 'ingredients' and c.column_name = 'group_recipe_id'))
  loop
    if r.data_type not in ('text', 'character varying') then
      raise exception 'tipo inatteso per %.%: % (atteso text)', r.table_name, r.column_name, r.data_type;
    end if;
  end loop;
  if (select count(*) from information_schema.columns c
      where c.table_schema = 'public'
        and ((c.table_name = 'recipes' and c.column_name = 'parent_recipe_id')
          or (c.table_name = 'ingredients' and c.column_name = 'group_recipe_id'))) <> 2 then
    raise exception 'colonne attese non trovate (recipes.parent_recipe_id, ingredients.group_recipe_id)';
  end if;

  -- c) Foreign key verso recipes: elenco esplicito delle relazioni che
  --    cancellano o azzerano righe quando si elimina una Scheda, ciascuna con
  --    la sua azione attesa e il controllo che la funzione fa prima di
  --    eliminare:
  --      variants.recipe_id          CASCADE  -> la Scheda deve essere vuota
  --      recipes.parent_recipe_id    SET NULL -> nessuna Scheda la indica
  --      ingredients.group_recipe_id SET NULL -> nessun ingrediente la indica
  --    Le stesse relazioni con RESTRICT / NO ACTION sono ammesse (al massimo
  --    fanno fallire la cancellazione, senza effetti). Qualunque altra FK che
  --    CANCELLI o AZZERI righe (CASCADE, SET NULL, SET DEFAULT), una FK su piu'
  --    colonne, o una delle tre con un'azione diversa: ci si ferma.
  --    (l3_items.recipe_id e' RESTRICT e la funzione la controlla comunque.)
  for r in
    select con.conname, regexp_replace(con.conrelid::regclass::text, '^public\.', '') as tabella,
           array_length(con.conkey, 1) as n_colonne,
           (select a.attname from pg_attribute a where a.attrelid = con.conrelid and a.attnum = con.conkey[1]) as colonna,
           con.confdeltype
    from pg_constraint con
    where con.contype = 'f' and con.confrelid = 'public.recipes'::regclass
  loop
    if r.n_colonne <> 1 then
      raise exception 'FK verso recipes su piu'' colonne non prevista: % su %', r.conname, r.tabella;
    end if;
    if r.confdeltype in ('a', 'r') then
      continue;  -- NO ACTION / RESTRICT: nessun dato perso
    end if;
    if not ((r.tabella, r.colonna, r.confdeltype) in (('variants', 'recipe_id', 'c'),
                                                      ('recipes', 'parent_recipe_id', 'n'),
                                                      ('ingredients', 'group_recipe_id', 'n'))) then
      raise exception 'FK verso recipes non prevista o con azione diversa: % su %.% (azione %)', r.conname, r.tabella, r.colonna, r.confdeltype;
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
  -- Riferimenti ON DELETE SET NULL (verifica preliminare c): mai scollegati in silenzio.
  if exists (select 1 from public.recipes where parent_recipe_id = p_recipe_id)
     or exists (select 1 from public.ingredients where group_recipe_id = p_recipe_id) then
    return 'collegata';
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
