-- ============================================================================
-- KHUB — Sprint Produzione — Micro-Step 3: schema steps_v2
-- ============================================================================
-- Aggiunge il supporto futuro agli step strutturati della Ricetta (A5.8:
-- durata prevista modellabile per step fin da LAB; A5.9: id stabile per
-- step, portato LAB -> attiva -> snapshot, non posizionale; A5.14:
-- conversione automatica del legacy steps string[] in struttura, senza
-- conferma dello chef, semanticamente identica).
--
-- Questa migration e' SOLO schema: non genera id, non converte alcuna
-- Ricetta legacy, non viene letta ne' scritta da alcun codice applicativo
-- (khub_mvp.html e api/chat.js non sono toccati in questo Micro-Step). La
-- colonna esistente variants.steps (string[] legacy) resta completamente
-- invariata e continua a essere l'unica letta/scritta dal client.
--
-- Additiva e idempotente: ADD COLUMN IF NOT EXISTS e' un no-op se la
-- colonna esiste gia' (compatibile con ambienti dove sia stata creata
-- manualmente in anticipo). Nessun DEFAULT: le righe esistenti restano
-- NULL, senza alcun backfill automatico e senza alcuna modifica
-- semantica ai dati gia' presenti.
-- ============================================================================

alter table variants
  add column if not exists steps_v2 jsonb;
