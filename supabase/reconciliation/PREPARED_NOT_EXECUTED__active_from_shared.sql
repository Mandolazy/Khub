-- ============================================================================
-- KHUB — MichelinAI 2.0 — D2: riconciliazione active <- shared
-- ============================================================================
--
-- STATO: PREPARATO, NON ESEGUITO.
--
-- Questo script NON deve essere eseguito automaticamente da alcuna pipeline
-- (non e' numerato in sequenza con supabase/migrations/, non e' referenziato
-- da alcun deploy hook: vercel.json non esegue migrazioni, package.json non
-- ha script di build che lo tocchino). Va eseguito SOLO a mano, nell'SQL
-- Editor di Supabase, e SOLO dopo un'approvazione esplicita separata da
-- quella dello STEP R1 che ha prodotto questo file.
--
-- DECISIONE DI PRODOTTO (D2, congelata):
--   - variants.active e' la source of truth applicativa futura per
--     "Ricetta attiva" (0..N Ricette attive per Scheda).
--   - variants.shared e' riconosciuto come campo legacy: il suo significato
--     storico reale e' sempre stato "attiva", mai "condivisa con lo staff"
--     (quel concetto e' recipeStaffCondivisi, del tutto separato e mai
--     persistito).
--   - La riconciliazione va SEMPRE nella direzione active <- shared, MAI il
--     contrario: shared e' il segnale storico/live corretto, active nel DB
--     e' stato seminato da production_variant_id ed e' provabilmente
--     inattendibile cosi' com'e' (audit reale: shared=true 19 righe,
--     active=true 6 righe, divergenti 15 righe).
--   - recipes.production_variant_id resta legacy, non torna mai ad essere
--     source of truth.
--   - Dal momento in cui STEP R1 e' stato applicato, l'applicazione non
--     scrive piu' affatto la colonna shared (omessa dal payload di save),
--     quindi i valori di shared restano stabili/storici fino a quando
--     questo script non viene eseguito: non c'e' urgenza, ma nemmeno rischio
--     di ulteriore deriva nel frattempo.
--
-- REGOLA DI RICONCILIAZIONE:
--   1. Righe con status = 'retired' (Archiviata): active viene forzato a
--      false, indipendentemente da shared — coerente con retireVariant() in
--      khub_mvp.html, che gia' oggi forza active:false all'archiviazione,
--      anche se la Ricetta era attiva prima di essere archiviata.
--   2. Righe con status IN ('validated','approved') (Pronta / Attiva): active
--      diventa COALESCE(shared, false) — cioe' true solo se shared era
--      esplicitamente true, false in ogni altro caso (false o NULL).
--   3. Righe con status = 'lab' (Bozze): NON toccate. Le Bozze non hanno mai
--      avuto un significato applicativo per shared, e l'app le scrive gia'
--      sempre con active:false dal proprio lato.
--
-- ============================================================================


-- ----------------------------------------------------------------------------
-- PASSO 0 — ANTEPRIMA READ-ONLY (eseguibile da sola, senza alcun effetto).
-- Esegui SOLO questa SELECT per vedere esattamente quali righe cambierebbero
-- e come, PRIMA di eseguire l'UPDATE nel Passo 1.
-- ----------------------------------------------------------------------------
select
  id,
  recipe_id,
  name,
  status,
  shared as shared_attuale,
  active as active_attuale,
  case
    when status = 'retired' then false
    when status in ('validated', 'approved') then coalesce(shared, false)
    else active -- status='lab': nessun cambiamento
  end as active_dopo_riconciliazione,
  case
    when status = 'lab' then 'NON TOCCATA (lab)'
    when active is distinct from (
      case
        when status = 'retired' then false
        else coalesce(shared, false)
      end
    ) then 'CAMBIA'
    else 'INVARIATA'
  end as esito
from variants
order by esito desc, status, recipe_id, id;


-- ----------------------------------------------------------------------------
-- PASSO 1 — UPDATE reale. NON ESEGUIRE senza approvazione esplicita separata.
-- Wrappato in una transazione: se qualcosa nella verifica finale (Passo 2)
-- non torna, si puo' fare ROLLBACK invece di COMMIT.
-- ----------------------------------------------------------------------------
-- begin;
--
-- update variants
-- set active = false
-- where status = 'retired'
--   and active is distinct from false;
--
-- update variants
-- set active = coalesce(shared, false)
-- where status in ('validated', 'approved')
--   and active is distinct from coalesce(shared, false);
--
-- -- PASSO 2 — verifica post-update, ancora dentro la transazione: deve
-- -- restituire 0 righe divergenti (a parte le 'lab', volutamente escluse).
-- select id, status, shared, active
-- from variants
-- where status != 'lab'
--   and active is distinct from (
--     case when status = 'retired' then false else coalesce(shared, false) end
--   );
--
-- -- Se la verifica sopra restituisce 0 righe: commit;
-- -- Se restituisce righe inattese: rollback;
