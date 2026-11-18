# Release candidate — Idee + Import Engine

**Stato:**
- branch locale `rc/khub-idee-import`, da `claude/p2a2-idee-ricetta` (`3585c60`) con `main` (`f13b6d1`) unito;
- **nessun commit, push, merge, deploy o migrazione online.**

## 1. Contenuto
| Parte | Commit / origine | Stato |
|---|---|---|
| Production attuale (Direzione 3: colori pieni, intestazione come fascia dell'ambiente) | `main` `f13b6d1`, `b2ac4af` | Già contenuta nel branch Idee: l'unione non cambia nessuna riga. I due conflitti erano solo le aggiunte «Idee» sulle stesse righe. |
| Import Engine P0-a, P0-c, P0-c.1, P0-c.2, P1-a, P1-b | `0d5512f` … `a3ba3ad` | Una sola volta nella storia, **non** presenti in `main` |
| Idee P2-a.1, blocchi 2a–2e | `1063342` … `3585c60` | Non presenti in `main` |
| Una sola trasformazione per Idea (due dispositivi) | questa RC | Nuova azione `claimIdeaRecipe`, tabella `idea_recipe_claims` nella **0016** |
| Video e Reel | — | Esclusi |

**Due dispositivi, stessa Idea.**
- **Prima:** ogni dispositivo genera i propri id, quindi poteva salvare una seconda Ricetta. Si collegava una sola delle due.
- **Ora:** prima di **ogni** salvataggio la pagina prenota la trasformazione sul server con gli id della propria Scheda.
  - Il secondo dispositivo riceve `idea_in_trasformazione`: non salva nulla, torna all'Idea con un avviso e chiude il proprio registro.
  - `linkIdeaToRecipe` collega solo la Ricetta prenotata.
  - Una prenotazione abbandonata si riprende dopo 15 minuti, ma solo se quella Bozza non è mai arrivata nel database.
  - Senza la 0016 il comportamento torna quello del 2e.
- **Test:** `test-p2a2-idee-scheda.js` S11 e `test-p2a2-idee-scheda-ui.js` E11.
- **Prova a ritroso:** senza la prenotazione, E11 fallisce.

## 2. Migrazioni: procedura unica
Ordine fisso, una alla volta, nell'SQL Editor di Supabase. Prima di ogni file si esegue la sua verifica «sola lettura» indicata in `docs/migrations/<file>.md`, poi il file intero una volta, poi la verifica successiva.

**Tutte le migrazioni:**
- sono additive e idempotenti, ciascuna in un'unica transazione;
- si fermano senza modifiche se trovano uno schema inatteso;
- non cancellano dati.

| # | File | KHUB Test | Production |
|---|---|---|---|
| 0012 | `0012_ingredients_quantity_kind.sql` | applicata | **da verificare**, probabilmente da applicare |
| 0013 | `0013_ideas.sql` | applicata | da applicare |
| 0014 | `0014_idea_turns.sql` | applicata | da applicare |
| 0015 | `0015_ideas_appunto_proposta.sql` | **da applicare** | da applicare |
| 0016 | `0016_idea_proposal_locks.sql` (2 tabelle) | **da applicare** | da applicare |

**Verifica iniziale su Production**, sola lettura: lo stato atteso è che `main` usi lo schema fino alla 0011.
```sql
select column_name from information_schema.columns where table_schema='public' and table_name='variants' and column_name like 'declared_yield%';      -- 0011: 2 righe
select column_name from information_schema.columns where table_schema='public' and table_name='ingredients' and column_name in ('qty_kind','qty_min','qty_max','source_text');  -- 0012: 0 = da applicare
select to_regclass('public.ideas'), to_regclass('public.idea_turns'), to_regclass('public.idea_proposal_locks'), to_regclass('public.idea_recipe_claims');
```

**Verifica finale**, sola lettura, su entrambi i database:
```sql
select pg_get_constraintdef(oid) from pg_constraint where conname='ideas_appunto_chk';                     -- con preview_origin = 'ai'
select c.relname, c.relrowsecurity from pg_class c where c.relname in ('ideas','idea_turns','idea_proposal_locks','idea_recipe_claims');  -- tutte true
select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants
 where table_schema='public' and table_name in ('ideas','idea_turns','idea_proposal_locks','idea_recipe_claims') group by 1,2 order by 1,2;  -- solo service_role: INSERT,SELECT,UPDATE
```

**Dati di prova in Production:**
- Non serve azzerarli. Le migrazioni sono additive e le righe esistenti soddisfano i nuovi vincoli: la strada più semplice è **aggiornare il database esistente**.
- Una pulizia dei soli dati applicativi (Ricette, Bozze, ingredienti, Sessioni) è possibile, ma non necessaria. Se si fa, va fatta dopo il backup e con un elenco di tabelle approvato a parte.
- Nessun reset del progetto Supabase.

**Ripristino:**
- **Codice:** si ripristina subito su Vercel, rimettendo in Production il deployment precedente (`f13b6d1`). Le migrazioni 0012–0016 sono compatibili con il codice di `main`: aggiungono colonne nullable e tabelle che `main` non legge, quindi **non serve annullarle** per tornare indietro.
- **Rollback SQL:** preparati in `supabase/rollback/`, solo in caso di necessità e in ordine inverso: 0016 → 0015 → 0014 → 0013 (0012 ha il suo). Ognuno si ferma se rischia di cancellare dati.

## 3. Checklist prima di Production
1. **Backup** di Production fatto e verificato (Supabase → Database → Backups, o dump), con data e ora annotate.
2. **Integrità attuale:**
   - conteggi di `recipes`, `variants`, `ingredients` e `production_sessions` annotati;
   - verifica iniziale del §2 eseguita.
3. **KHUB Test:** 0015 e 0016 applicate e verificate. Deploy Preview della RC su KHUB Test.
4. **Collaudo reale su KHUB Test**, con l'AI vera. I test con AI simulata non lo sostituiscono.
   - **Prerequisito:** la chiave Anthropic va configurata nell'ambiente di prova solo con la tua autorizzazione. Oggi la Preview non ha la chiave, per scelta.
   - Idea → 2–3 messaggi in chat → «Prepara la Ricetta».
   - Controlli: provenienza delle quantità, una quantità confermata e una no, resa.
   - «Crea la Scheda e apri nel LAB», poi verifica nel database: `certa` / `mancante` con la nota, Idea `trasformata`, conversazione intatta.
   - Ripetere con «Scheda esistente»: la Ricetta attiva resta invariata.
   - Due schede del browser sulla stessa Idea: una sola Ricetta.
   - Un'importazione da link, da testo e da foto.
   - Una Produzione da una Ricetta attiva.
   - Accesso senza sessione: rifiutato.
5. **Production, Vercel:** `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `KHUB_ACCESS_PASSWORD` e `KHUB_SESSION_SECRET` presenti. Solo controllo dei nomi, mai dei valori.
6. **Production, migrazioni** 0012 → 0016 con le verifiche del §2.
7. **Rilascio del codice:** merge della RC in `main`, poi deploy.
8. **Dopo il rilascio:**
   - accesso;
   - Schede, LAB e Produzione su una Ricetta esistente;
   - un'importazione;
   - una conversazione Idea e una proposta, con un solo test reale e controllato;
   - salvataggio nel LAB;
   - log Vercel senza errori `Supabase error`.
