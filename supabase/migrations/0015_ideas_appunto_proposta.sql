-- ============================================================================
-- KHUB — P2-a.2 (blocco 2d): proposta di Ricetta anche per le Idee "appunto"
-- ============================================================================
-- STATO: PREPARATA, NON ESEGUITA. Da applicare prima su KHUB Test, solo dopo
-- un'autorizzazione esplicita (procedura: docs/migrations/0015_ideas_appunto_proposta.md).
-- Richiede 0013 (public.ideas). Non modifica 0013 (gia' eseguita su KHUB Test).
--
-- La 0013 vieta qualunque anteprima su un'Idea di tipo appunto
-- (ideas_appunto_chk). Con il blocco 2d MichelinAI prepara una proposta di
-- Ricetta dalla conversazione e il server la conserva nell'Idea (preview,
-- preview_origin = 'ai'), per riaprirla senza una nuova chiamata AI.
-- Qui il solo vincolo ideas_appunto_chk viene sostituito: un appunto resta senza
-- link e puo' avere un'anteprima SOLO se di origine 'ai' (mai 'strutturata').
-- Nessuna colonna, nessun dato, nessun privilegio cambiano. Le righe esistenti
-- rispettano gia' il nuovo vincolo (e' piu' permissivo del precedente).
-- Idempotente, in un'unica transazione.
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.ideas') is null then
    raise exception 'P2-a.2: tabella public.ideas non trovata (applicare prima la 0013)';
  end if;
end $$;

alter table public.ideas drop constraint if exists ideas_appunto_chk;
alter table public.ideas add constraint ideas_appunto_chk
  check (source_type <> 'appunto' or (source_url is null and (preview is null or preview_origin = 'ai')));

comment on constraint ideas_appunto_chk on public.ideas is
  'Un appunto non ha link; puo'' avere un''anteprima solo se proposta da MichelinAI (0015).';

commit;
