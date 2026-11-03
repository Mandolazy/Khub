# KHUB — Demo locale della Direzione 3

Una prova della nuova grafica sul tuo computer, **scollegata da Supabase**:
la pagina e il server sono quelli veri di KHUB, ma il database è un finto
database in memoria con **dati inventati**. Nulla di quello che fai nella demo
arriva a Production.

## Cosa serve

- Un Mac (vale anche per Windows e Linux).
- **Node.js 18 o successivo**. Per controllare, apri il Terminale e scrivi
  `node -v`. Se il comando non esiste o la versione è più vecchia, installa la
  versione **LTS** da <https://nodejs.org> (pacchetto per macOS, poi Avanti →
  Installa).

## Avvio (3 passi)

1. **Estrai lo zip** ricevuto, per esempio nella cartella *Scaricati*.
   Otterrai una cartella `khub-demo-direzione-3`.
2. **Apri il Terminale** (Spotlight: ⌘ + Spazio, scrivi *Terminale*, Invio) e
   incolla questi due comandi, uno alla volta, premendo Invio:

   ```
   cd ~/Downloads/khub-demo-direzione-3
   node demo/direzione-3/server.js
   ```

   Se hai estratto lo zip altrove, nel primo comando scrivi `cd ` (con lo
   spazio) e trascina la cartella nel Terminale, poi Invio.
   Quando vedi `Apri nel browser: http://localhost:4173` la demo è pronta.
3. **Apri il browser** (Safari o Chrome) all'indirizzo
   <http://localhost:4173>. In alto c'è una fascia scura
   **«DEMO LOCALE · dati sintetici · nessun collegamento a Supabase»**: se non
   la vedi, non sei nella demo.

Per **chiudere**: torna nel Terminale e premi `Ctrl + C`. Le modifiche fatte
nella demo vengono perse (alla riapertura ritrovi i dati iniziali).

## Provarla come su un telefono

- **Dal Mac:** in Chrome, tasto destro → *Ispeziona* → icona del telefono
  (*Toggle device toolbar*) → scegli *iPhone 12 Pro* (390 px). In Safari:
  menu *Sviluppo* → *Entra in modalità Responsive Design* (se il menu non c'è:
  Safari → Impostazioni → Avanzate → *Mostra funzioni per sviluppatori web*).
- Per motivi di sicurezza la demo **accetta solo connessioni da questo
  computer**: da un telefono vero non è raggiungibile.

## Cosa provare

| Cosa | Come |
|---|---|
| Archivio Schede | barra laterale (o barra in basso su mobile) → **Schede**: 22 Schede in ordine A–Z, con indice delle lettere |
| Cercare | campo **Cerca una Scheda** (in basso su mobile) |
| Filtrare | **Vista** → per categoria / Famiglie |
| Scheda con Ricette in stati diversi | **Tagliatelle ai funghi**: 2 Attive, 1 Validata, 1 in LAB, 1 archiviata |
| Entrare nel LAB | nella Scheda, sulla Ricetta «In LAB» → **Apri nel LAB**; oppure **Risotto agli asparagi** (18 ingredienti, titolo lungo) |
| Modificare | cambia quantità e nomi degli ingredienti, il testo dei passaggi, la resa |
| Salvataggio | dopo una modifica compare «Salvato»; ricarica la pagina (⌘ + R): l'app riparte dalla pagina iniziale (come oggi), rientra in **Schede** → Scheda → LAB e la modifica è ancora lì |
| Elenco LAB | **LAB**: bozze raggruppate per Scheda; in alto **Ultima modifica** (predefinito) o **A–Z**. Dopo una modifica la bozza sale in cima alla successiva apertura della pagina |
| Arrotonda quantità | interruttore nell'intestazione del LAB |
| Esporta | **↓ Esporta** → PDF ricetta (si apre la finestra di stampa) |
| Navigazione mobile | barra in basso Produzione / Schede / LAB; nel LAB le sezioni Ingredienti, Procedimento, Note… |
| Tornare ai dati iniziali | pulsante **Ripristina dati** nella fascia in alto |
| Grafica attuale | barra laterale → *torna alla grafica attuale* (o `http://localhost:4173/khub_mvp.html?ui=classic`) |

Non disponibili nella demo (la rete è chiusa di proposito): **MichelinAI**,
importazione da link o da foto. Danno un messaggio di errore: è previsto.

## Perché è isolata

Prima di caricare il codice dell'app, il programma della demo:

1. **toglie dal proprio ambiente tutte le credenziali** (Supabase, Anthropic,
   KHUB, Vercel, database): anche se sul computer fossero configurate, la demo
   non le vede;
2. **blocca ogni connessione in uscita** (fetch, http, https, socket, DNS):
   l'unico "database" raggiungibile è quello in memoria;
3. usa come indirizzo del database `https://supabase-demo-locale.invalid`, un
   dominio che per standard **non esiste** su Internet;
4. **ascolta solo su questo computer** (127.0.0.1) e rifiuta le richieste con
   un indirizzo diverso da `localhost`.

Verifica in qualsiasi momento: <http://localhost:4173/demo/isolamento> mostra
i nomi (mai i valori) delle variabili ignorate, le connessioni bloccate e
quante scritture sono finite nel database finto.

Il browser scarica solo i caratteri e le icone della grafica (Google Fonts e
CDN pubbliche, in sola lettura): nessun dato KHUB passa da lì.

## Problemi comuni

- **`command not found: node`** → installa Node.js LTS (vedi sopra) e riapri
  il Terminale.
- **«La porta 4173 è occupata»** → c'è già una demo aperta: chiudila con
  `Ctrl + C`, oppure avvia su un'altra porta:
  `node demo/direzione-3/server.js 4180` e apri <http://localhost:4180>.
- **Il nome della Ricetta o un passaggio sembrano tagliati** → con Chrome la
  resa è la più fedele; su Safari i campi si adattano al testo appena caricati.
- **La pagina non si apre** → controlla che il Terminale sia ancora aperto e
  mostri `Apri nel browser`.
