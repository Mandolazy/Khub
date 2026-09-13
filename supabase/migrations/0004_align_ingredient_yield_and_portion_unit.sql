-- ============================================================================
-- KHUB — Sprint Produzione — Micro-Step 1A: allineamento schema drift
-- ============================================================================
-- Le colonne seguenti sono gia' utilizzate dal client (khub_mvp.html) e gia'
-- presenti in ambienti Supabase reali per intervento manuale, ma non erano
-- mai state versionate in una migration di questo repository. Questa
-- migration allinea lo schema dichiarato allo stato reale, senza introdurre
-- alcun comportamento nuovo e senza toccare dati esistenti.
--
-- Additiva e idempotente: compatibile sia con database dove queste colonne
-- esistono gia' (ADD COLUMN IF NOT EXISTS e' un no-op in quel caso; un
-- eventuale DEFAULT non viene comunque applicato retroattivamente alle righe
-- esistenti) sia con database dove mancano ancora.
--
-- Frozen (Micro-Step 1 Resa LAB): estimated_yield_pct/measured_yield_pct
-- NULL significa "resa non ancora modellata", MAI un default implicito a
-- 100 — questa migration non assegna quindi alcun DEFAULT a questi due
-- campi, per non introdurre un comportamento diverso da quello gia'
-- deciso e testato lato applicazione.
-- ============================================================================

alter table ingredients
  add column if not exists estimated_yield_pct numeric,
  add column if not exists measured_yield_pct numeric;

-- variants.portion_unit: il client legge gia' con fallback 'g'
-- (v.portionUnit||'g', khub_mvp.html) — il DEFAULT qui sotto si applica
-- solo a righe future prive di valore esplicito, non altera le righe
-- esistenti (che restano NULL e continuano a essere interpretate come 'g'
-- dal client esattamente come oggi).
alter table variants
  add column if not exists portion_unit text default 'g';
