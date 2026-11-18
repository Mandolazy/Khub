-- ============================================================================
-- KHUB — Rollback di 0015_ideas_appunto_proposta.sql
-- ============================================================================
-- STATO: PREPARATO, NON ESEGUITO. Fuori dalla sequenza supabase/migrations/:
-- solo a mano, nell'SQL Editor, dopo un'autorizzazione esplicita.
--
-- Ripristina il vincolo della 0013 (un appunto non ha ne' link ne' anteprima).
-- Si FERMA se esistono appunti con una proposta salvata: prima va deciso se
-- toglierla (update ... set preview = null, preview_origin = null) o copiarla.
-- PRIMA va ripristinato il codice precedente al blocco 2d.
-- ============================================================================

begin;

do $$
declare n bigint;
begin
  if to_regclass('public.ideas') is not null then
    select count(*) into n from public.ideas where source_type = 'appunto' and preview is not null;
    if n > 0 then
      raise exception 'Rollback 0015 fermato: % appunti hanno una proposta salvata. Decidere prima che farne.', n;
    end if;
  end if;
end $$;

alter table public.ideas drop constraint if exists ideas_appunto_chk;
alter table public.ideas add constraint ideas_appunto_chk
  check (source_type <> 'appunto' or (source_url is null and preview is null));

commit;
