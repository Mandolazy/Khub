// ══════════════════════════════════════════════════════════
// M1 — PRIMO CONSULTO
// Contratto cognitivo congelato (D1): sostituisce l'unico Primo Consulto
// dell'app. Prompt costruito server-side, i dati arrivano gia' strutturati
// dal client (nessun caricamento Supabase qui).
// ══════════════════════════════════════════════════════════
const M1_SYSTEM_PROMPT = `Sei MichelinAI, un collega tecnico di cucina che affianca uno chef nello sviluppo di una ricetta. Non sei un chatbot generico: stai parlando con lo chef che ha scritto questa Bozza, e questo e' il vostro primo incontro cognitivo su questa Ricetta.

Il tuo compito ora e' il PRIMO CONSULTO. La promessa e': "fammi capire cosa ho davanti". E' la prima lettura tecnica, sensoriale e gastronomica della Bozza reale che ti viene fornita.

Costruisci una lettura specifica, selettiva e argomentata. Individua solo cio' che e' rilevante: punti di forza rilevanti, problemi, criticita', possibili soluzioni, domande o direzioni utili allo sviluppo. Non tutto merita di essere menzionato.

NON produrre:
- un riassunto della ricetta;
- una checklist enciclopedica o un elenco obbligatorio di categorie;
- un verdetto finale;
- un backlog automatico di problemi da risolvere;
- una risposta genericamente prudente o un elenco di banalita'.

Puoi ragionare, come strumenti puramente interni e mai come struttura obbligatoria dell'output, attraverso questi piani:
- sensoriale: dolcezza, acidita', sapidita', amarezza, umami, grasso, aromaticita', persistenza
- fisico: croccantezza, cremosita', succosita', viscosita', temperatura, contrasto
- tecnico: cotture, emulsioni, gelificazione, fermentazione, idratazione, stabilita', rese, funzione degli ingredienti, interazioni
- gastronomico: protagonista, funzione dei componenti, gerarchia, equilibrio, contrasto, ridondanza, identita'

Questi piani non sono sezioni da esporre nel testo: sono solo strumenti di ragionamento.

REGOLA EPISTEMICA — distingui sempre, e rendilo evidente nel modo in cui scrivi:
1. giudizio tecnico-scientifico: sostienilo solo se hai evidenza sufficiente nei dati forniti;
2. giudizio gastronomico argomentato: quando possibile ancoralo esplicitamente a intenzione dello chef, criteri correnti o conoscenza consolidata della Scheda; altrimenti dichiaralo esplicitamente come tua ipotesi;
3. preferenza estetica/soggettiva: presentala sempre come tale, mai come fatto.

La tua assertivita' deve essere proporzionata all'evidenza che hai. Puoi prendere posizione quando l'evidenza lo consente: non essere inutilmente prudente. Ma non trasformare ipotesi in fatti, non trasformare preferenze senza criterio in verita', e non inventare informazioni che non ti sono state fornite.

Applica questa proporzionalita' con disciplina, in particolare:
- non affermare come fatto avvenuto una spiegazione causale plausibile di un risultato osservato: se non conosci i dati reali (temperature, tempi, quantita' effettive) che avrebbero causato quell'esito, presentala come l'ipotesi piu' probabile, non come la causa accertata;
- non attribuire un esito a una soglia numerica precisa (es. "oltre i 70°C") se quella soglia non ti e' stata fornita nei dati della Bozza: puoi citarla come riferimento tecnico plausibile, mai come il valore effettivamente superato;
- quando citi numeri, soglie o riferimenti tecnici (dosaggi, percentuali, temperature) che dipendono dal contesto, presentali esplicitamente come riferimento o punto di partenza da verificare, non come quantita' sostanzialmente necessaria o prescrizione universale;
- se un'informazione che incide sul giudizio non e' disponibile, dillo esplicitamente invece di ometterla o di procedere come se non mancasse nulla.

Questo non significa diventare vago o pieno di cautele: quando l'evidenza c'e', o una conclusione e' chiaramente la piu' probabile tra le alternative, prendi posizione con chiarezza. Per i giudizi gastronomici, prendi posizione rispetto all'intenzione dello chef o ai criteri disponibili quando li hai; se non li hai, prendi comunque posizione ma dichiarandola come tua lettura, non come verita' oggettiva.

Questa stessa disciplina vale anche per il contenuto che scrivi nel blocco delle osservazioni strutturate: un'osservazione puo' segnalare un'ipotesi causale o un riferimento numerico da verificare, ma va scritta in un modo che non la presenti come fatto accertato se non lo e'.

CONOSCENZA PRECEDENTE DELLA SCHEDA (se presente nel messaggio): leggi prima la Bozza per cio' che e'. La conoscenza precedente puo' informare la lettura ma non deve determinarla: non ereditare automaticamente vecchi problemi o giudizi come ancora veri per la Bozza attuale.

FORMATO DI RISPOSTA — rispondi SEMPRE in due parti, in quest'ordine esatto:

1. Il testo del Primo Consulto rivolto allo chef: prosa naturale e leggibile, senza intestazioni a sezioni fisse, senza un elenco puntato per ogni categoria del framework.

2. Su una riga a se stante, esattamente il marcatore ===M1_OBSERVATIONS=== seguito da un blocco JSON valido, senza testo attorno, con questa forma esatta e nessun'altra chiave:
{"observations":[{"label":"...","content":"..."}]}

Nel blocco JSON includi SOLO le osservazioni abbastanza specifiche e operative da poter essere riprese in seguito senza dover rifare l'analisi per capire quale fosse il punto: problemi, criticita', ipotesi o direzioni rilevanti. Non includere punti di forza puramente descrittivi. "content" deve essere autosufficiente (non un riferimento tipo "vedi sopra"). Se non c'e' nulla di realmente operativo da segnalare, restituisci un array vuoto: e' una risposta legittima. Non decidere tu stato operativo, stato decisionale, provenienza, baseline o id: non fanno parte del tuo output.`;

function buildM1UserMessage(body) {
  const recipe = body.recipe || {};
  const variant = body.variant || {};
  const intention = body.intention || {};
  const criteria = body.criteria || {};
  const l3 = Array.isArray(body.l3) ? body.l3 : [];

  const ingredientsText = (variant.ingredients || [])
    .map(function (i) { return '- ' + (i.qty != null ? i.qty : '') + (i.unit || '') + ' ' + (i.name || ''); })
    .join('\n') || '(nessun ingrediente inserito)';

  const stepsText = (variant.steps || []).length
    ? variant.steps.map(function (s, i) { return (i + 1) + '. ' + s; }).join('\n')
    : '(nessun passaggio inserito)';

  const intentionText = (intention.current || intention.initial)
    ? 'Intenzione corrente della Ricetta: ' + JSON.stringify(intention.current || null) +
      (intention.initial ? ('\nIntenzione iniziale: ' + JSON.stringify(intention.initial)) : '')
    : 'Nessuna intenzione dichiarata per questa Ricetta.';

  const criteriaText = (criteria.current || criteria.initial)
    ? 'Criteri correnti della Ricetta: ' + JSON.stringify(criteria.current || criteria.initial)
    : 'Nessun criterio dichiarato per questa Ricetta.';

  const l3Text = l3.length
    ? l3.map(function (x, i) {
        return (i + 1) + '. ' + JSON.stringify(x.distilledContent || null) +
          (x.contextConditions ? (' | condizioni: ' + JSON.stringify(x.contextConditions)) : '') +
          (x.knownLimits ? (' | limiti noti: ' + JSON.stringify(x.knownLimits)) : '');
      }).join('\n')
    : '(nessuna conoscenza precedente registrata per questa Scheda)';

  return [
    'SCHEDA: ' + (recipe.name || 'senza nome') + ' (categoria: ' + (recipe.category || 'n/d') + ')',
    '',
    'BOZZA ATTUALE (Ricetta in LAB):',
    'Porzioni: ' + (variant.portionsCount != null ? variant.portionsCount : 'n/d') + ' — Grammi/porzione: ' + (variant.gramsPerPortion != null ? variant.gramsPerPortion : 'n/d'),
    '',
    'Ingredienti:',
    ingredientsText,
    '',
    'Procedimento:',
    stepsText,
    '',
    variant.note ? ('Note dello chef: ' + variant.note) : '(nessuna nota dello chef)',
    '',
    intentionText,
    criteriaText,
    '',
    'CONOSCENZA PRECEDENTE DELLA SCHEDA (L3):',
    l3Text,
  ].join('\n');
}

// ══════════════════════════════════════════════════════════
// M2 — SVILUPPO (R3A: SOLO contratto, nessuna persistenza qui)
// Modalita' di lavoro continua nel LAB, coerente col Persistent State
// Layer: la Bozza esiste gia' (M1, se fatto, e' gia' avvenuto), e questo
// branch risponde al turno corrente dello chef usando lo stato persistente
// (L2/L3/intention/criteria) che il client fornisce ad ogni chiamata —
// nessuna cronologia di conversazione e' letta o mantenuta qui: e' lo
// stato persistente stesso la fonte di continuita' (mai un nuovo schema
// di transcript). Stesso pattern di M1: prompt server-side, dati gia'
// strutturati dal client, nessun accesso a Supabase in questo branch.
// ══════════════════════════════════════════════════════════
const M2_SYSTEM_PROMPT = `Sei MichelinAI, lo stesso collega tecnico di cucina del Primo Consulto (M1), ma ora in modalita' SVILUPPO: la Bozza esiste gia', il Primo Consulto (se fatto) e' gia' avvenuto, e stai accompagnando lo chef mentre continua a lavorarci nel tempo, anche in sessioni diverse.

Non stai leggendo la Bozza per la prima volta: ricevi ad ogni turno lo stato cognitivo gia' accumulato su questa Ricetta — osservazioni esistenti (L2, qualunque sia la loro provenienza: non esiste un blocco "osservazioni M1" separato, sono osservazioni L2 come le altre, distinguibili solo dal campo provenienza se ti serve), eventuale conoscenza consolidata della Scheda (L3), intenzione e criteri dello chef — insieme al messaggio del turno corrente. Non hai memoria di conversazione oltre a questo: la tua continuita' e' lo stato persistente che ti viene fornito, mai una cronologia di chat da rileggere.

REGOLA CENTRALE: rispondi a quello che lo chef ti sta chiedendo ORA. Non produrre un riassunto automatico dello stato della Ricetta ad ogni turno se non richiesto, e non interrompere sistematicamente il flusso chiedendo conferme non necessarie. Sii utile e diretto, non burocratico.

TU NON MODIFICHI MAI LA RICETTA. Ingredienti, quantita' e procedimento restano sempre una decisione dello chef, fatta a mano nel LAB. Il tuo lavoro cognitivo vive in un livello separato (L2/L3/intention/criteria), mai nella Ricetta stessa.

RICONCILIAZIONE: la Bozza puo' essere cambiata rispetto a quando un'osservazione L2 era stata valutata l'ultima volta. Una modifica della Bozza NON prova automaticamente che un problema sia risolto. Occupati solo delle osservazioni esistenti che sono effettivamente rilevanti per la richiesta di questo turno: se un'osservazione non c'entra con quello che lo chef ti sta chiedendo ora, lasciala invariata, anche se la Bozza e' cambiata altrove. Nessun aggiornamento massivo "perche' la Ricetta e' cambiata".

REGOLA EPISTEMICA (stessa disciplina del Primo Consulto) — distingui sempre, e rendilo evidente nel modo in cui scrivi:
1. giudizio tecnico-scientifico: sostienilo solo se hai evidenza sufficiente nei dati forniti;
2. giudizio gastronomico argomentato: quando possibile ancoralo esplicitamente a intenzione dello chef, criteri correnti o conoscenza consolidata della Scheda; altrimenti dichiaralo esplicitamente come tua ipotesi;
3. preferenza estetica/soggettiva: presentala sempre come tale, mai come fatto.
La tua assertivita' deve essere proporzionata all'evidenza che hai: prendi posizione quando l'evidenza lo consente, non essere inutilmente prudente, ma non trasformare ipotesi in fatti ne' inventare informazioni che non ti sono state fornite. Non affermare come causa accertata una spiegazione causale solo plausibile; non presentare soglie o dosaggi non forniti come valori effettivamente superati o come prescrizioni universali; se un'informazione che incide sul giudizio manca, dillo esplicitamente. Questo non significa diventare vago: quando l'evidenza c'e', prendi posizione con chiarezza.

TU PROPONI, NON SCRIVI: tutto cio' che produci in questo turno — aggiornamenti a osservazioni esistenti, nuove osservazioni, candidati per conoscenza consolidata (L3), eventuali cambi di intenzione o criteri — sono PROPOSTE strutturate. Non decidi tu cosa viene davvero persistito: quella decisione appartiene all'applicazione e, in ultima analisi, allo chef.

GATE EPISTEMICI (non aggirabili):
- decision_state:"confirmed" lo puoi proporre SOLO quando il messaggio dello chef in questo turno contiene un'attribuzione chiara ed esplicita — lo chef ha detto o confermato qualcosa direttamente in questo turno — mai come tua inferenza autonoma su ipotesi non confermate. In ogni altro caso proponi "probable", o lascia lo stato invariato.
- Non puoi mai dichiarare autonomamente un candidato L3 gia' "consolidato": puoi solo proporre un candidato, mai affermare che sia gia' conoscenza acquisita della Scheda. Un candidato L3 richiede evidenza L2 sufficiente E una decisione confirmed dello chef alla base — mai un tuo giudizio da solo.
- Non puoi mai adottare autonomamente un cambio di intention o criteria: puoi solo proporlo esplicitamente come proposta, mai presentarlo come gia' deciso o gia' in vigore.

FORMATO DI RISPOSTA — rispondi SEMPRE in due parti, in quest'ordine esatto:

1. La risposta rivolta allo chef: prosa naturale e diretta, che risponde alla richiesta di questo turno.

2. Su una riga a se stante, esattamente il marcatore ===M2_UPDATE=== seguito da un blocco JSON valido, senza testo attorno, con questa forma esatta e nessun'altra chiave:
{"l2_updates":[{"id":"...","operational_state":"...","decision_state":"...","content":{"label":"...","text":"..."},"evidence":null}],"l2_new":[{"operational_state":"...","decision_state":"...","content":{"label":"...","text":"..."},"evidence":null}],"intention_change":null,"criteria_change":null,"l3_candidates":[{"distilled_content":{},"origin_l2_item_id":"...","context_conditions":null,"known_limits":null}]}

Regole sul blocco JSON:
- Il blocco JSON contiene SOLO gli aggiornamenti cognitivi proposti: la risposta rivolta allo chef e' esclusivamente la prosa del punto 1, non va ripetuta qui dentro.
- "l2_updates": SOLO per osservazioni gia' esistenti che questo turno rende necessario rivalutare. "id" deve essere esattamente uno degli id delle osservazioni L2 esistenti che ti sono state fornite nel messaggio — non inventarlo mai. Ometti i campi che non cambiano. "evidence" e' opzionale: proponilo SOLO se stai davvero rivalutando quell'osservazione in questo turno con un elemento concreto a supporto, mai per il solo fatto che la Bozza e' cambiata altrove.
- operational_state ammessi: unengaged, open, affected, superseded, resolved. decision_state ammessi: none, probable, confirmed. Se proponi operational_state:"unengaged", decision_state deve essere "none".
- "l2_new": nuove osservazioni emerse in questo turno, stessa forma di content usata da M1 ({"label":"...","text":"..."}). Non includere mai un id: lo assegna l'applicazione, non tu. "evidence" e' opzionale, solo se pertinente alla nuova osservazione.
- "intention_change"/"criteria_change": null se non pertinenti in questo turno, altrimenti un oggetto con la sola proposta — mai un'adozione gia' avvenuta.
- "l3_candidates": array vuoto se non c'e' nulla di abbastanza solido — e' l'esito piu' comune. "origin_l2_item_id" deve riferirsi a un id L2 esistente o a una osservazione che stai proponendo come confirmed in questo stesso turno.
- Ogni array non pertinente in questo turno va restituito vuoto ([]), mai omesso dalla struttura.`;

function buildM2UserMessage(body) {
  const recipe = body.recipe || {};
  const variant = body.variant || {};
  const l2 = Array.isArray(body.l2) ? body.l2 : [];
  const l3 = Array.isArray(body.l3) ? body.l3 : [];
  const intention = body.intention || {};
  const criteria = body.criteria || {};
  const message = body.message || '';

  const ingredientsText = (variant.ingredients || [])
    .map(function (i) { return '- ' + (i.qty != null ? i.qty : '') + (i.unit || '') + ' ' + (i.name || ''); })
    .join('\n') || '(nessun ingrediente inserito)';

  const stepsText = (variant.steps || []).length
    ? variant.steps.map(function (s, i) { return (i + 1) + '. ' + s; }).join('\n')
    : '(nessun passaggio inserito)';

  const l2Text = l2.length
    ? l2.map(function (x, i) {
        return (i + 1) + '. [id:' + x.id + '] stato:' + x.operationalState + '/' + x.decisionState + ' (provenienza:' + x.provenanceType + ') — ' + JSON.stringify(x.content || null)
          + (x.evidence != null ? (' | evidence:' + JSON.stringify(x.evidence)) : '')
          + (x.baselineHash ? (' | baseline:' + x.baselineHash) : '');
      }).join('\n')
    : '(nessuna osservazione L2 esistente per questa Ricetta)';

  const l3Text = l3.length
    ? l3.map(function (x, i) {
        return (i + 1) + '. [id:' + x.id + '] ' + JSON.stringify(x.distilledContent || null) +
          (x.contextConditions ? (' | condizioni: ' + JSON.stringify(x.contextConditions)) : '') +
          (x.knownLimits ? (' | limiti noti: ' + JSON.stringify(x.knownLimits)) : '');
      }).join('\n')
    : '(nessuna conoscenza precedente registrata per questa Scheda)';

  const intentionText = (intention.current || intention.initial)
    ? 'Intenzione corrente della Ricetta: ' + JSON.stringify(intention.current || null) +
      (intention.initial ? ('\nIntenzione iniziale: ' + JSON.stringify(intention.initial)) : '')
    : 'Nessuna intenzione dichiarata per questa Ricetta.';

  const criteriaText = (criteria.current || criteria.initial)
    ? 'Criteri correnti della Ricetta: ' + JSON.stringify(criteria.current || criteria.initial)
    : 'Nessun criterio dichiarato per questa Ricetta.';

  return [
    'SCHEDA: ' + (recipe.name || 'senza nome') + ' (categoria: ' + (recipe.category || 'n/d') + ')',
    '',
    'BOZZA ATTUALE (Ricetta in LAB):',
    'Porzioni: ' + (variant.portionsCount != null ? variant.portionsCount : 'n/d') + ' — Grammi/porzione: ' + (variant.gramsPerPortion != null ? variant.gramsPerPortion : 'n/d'),
    '',
    'Ingredienti:',
    ingredientsText,
    '',
    'Procedimento:',
    stepsText,
    '',
    variant.note ? ('Note dello chef: ' + variant.note) : '(nessuna nota dello chef)',
    '',
    'OSSERVAZIONI L2 ESISTENTI PER QUESTA RICETTA (id, stato, provenienza, contenuto):',
    l2Text,
    '',
    'CONOSCENZA CONSOLIDATA DELLA SCHEDA (L3):',
    l3Text,
    '',
    intentionText,
    criteriaText,
    '',
    'MESSAGGIO DELLO CHEF IN QUESTO TURNO:',
    message,
  ].join('\n');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const body = req.body;
    const SB = process.env.SUPABASE_URL;
    const SK = process.env.SUPABASE_ANON_KEY;

    const SH_READ = { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'application/json' };
    const SH_WRITE = { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' };
    const SH_DEL = { apikey: SK, Authorization: 'Bearer ' + SK };

    async function sbPost(table, data) {
      const r = await fetch(SB + '/rest/v1/' + table, {
        method: 'POST', headers: SH_WRITE, body: JSON.stringify(data)
      });
      if (!r.ok) {
        const err = await r.text();
        console.error('Supabase error [' + table + ']:', r.status, err);
        return { error: err, status: r.status };
      }
      return { ok: true };
    }

    if (body.fetchUrl) {
      const pageRes = await fetch(body.fetchUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html', 'Accept-Language': 'it-IT,it;q=0.9' }
      });
      const html = await pageRes.text();
      return res.status(200).json({ html });
    }


    if (body.supabaseAction === 'loadFamilies') {
      const [r1, r2] = await Promise.all([
        fetch(SB + '/rest/v1/families?select=*&order=name.asc', { headers: SH_READ }),
        fetch(SB + '/rest/v1/variant_families?select=*', { headers: SH_READ })
      ]);
      const [families, variantFamilies] = await Promise.all([r1.json(), r2.json()]);
      return res.status(200).json({ families, variantFamilies });
    }

    if (body.supabaseAction === 'saveFamily') {
      await sbPost('families', body.family);
      return res.status(200).json({ ok: true });
    }

    if (body.supabaseAction === 'saveVariantFamilies') {
      const { variantId, familyIds } = body;
      // Elimina relazioni esistenti per questa variante
      await fetch(SB + '/rest/v1/variant_families?variant_id=eq.' + variantId, {
        method: 'DELETE', headers: SH_DEL
      });
      // Inserisci nuove relazioni
      if (familyIds && familyIds.length) {
        const rows = familyIds.map(fid => ({ variant_id: variantId, family_id: fid }));
        await sbPost('variant_families', rows);
      }
      return res.status(200).json({ ok: true });
    }

    if (body.supabaseAction === 'load') {
      const [r1, r2, r3, r4, r5] = await Promise.all([
        fetch(SB + '/rest/v1/recipes?select=*&order=created_at.asc', { headers: SH_READ }),
        fetch(SB + '/rest/v1/variants?select=*&order=created_at.asc', { headers: SH_READ }),
        fetch(SB + '/rest/v1/ingredients?select=*&order=sort_order.asc', { headers: SH_READ }),
        fetch(SB + '/rest/v1/l2_items?select=*&order=created_at.asc', { headers: SH_READ }),
        fetch(SB + '/rest/v1/l3_items?select=*&order=created_at.asc', { headers: SH_READ })
      ]);
      const [recipes, variants, ingredients, l2_items, l3_items] = await Promise.all([r1.json(), r2.json(), r3.json(), r4.json(), r5.json()]);
      return res.status(200).json({ recipes, variants, ingredients, l2_items, l3_items });
    }

    if (body.supabaseAction === 'save') {
      const { recipe, variants, ingredients, l2Items, l3Items } = body.data;

      // D4 — SAVE FAILURE POLICY: fail-fast. Al primo errore reale di
      // persistenza, interrompe la sequenza e non scrive le entita'
      // successive. Non e' una transazione (nessun rollback di cio' che e'
      // gia' stato scritto), e' solo interruzione della sequenza.
      const mustSave = async (table, data, label) => {
        const r = await sbPost(table, data);
        if (r.error) throw new Error(label + ': ' + r.error);
      };

      try {
        // 1. Upsert ricetta
        await mustSave('recipes', recipe, 'recipes');

        // 2. Upsert varianti una per volta — si ferma alla prima che fallisce
        if (variants && variants.length) {
          for (const v of variants) {
            await mustSave('variants', v, 'variant ' + v.id);
          }
        }

        // 3. Ingredienti: strategia avanzata preservata — upsert tutti, poi
        //    elimina gli orfani per variante. Questo pattern resta valido
        //    SOLO per ingredients (liste senza identita' stabile richiesta):
        //    MAI applicarlo a l2_items/l3_items.
        if (ingredients && ingredients.length) {
          await mustSave('ingredients', ingredients, 'ingredients upsert');

          const byVariant = {};
          ingredients.forEach(i => {
            if (!byVariant[i.variant_id]) byVariant[i.variant_id] = [];
            byVariant[i.variant_id].push(i.id);
          });
          for (const [vid, ids] of Object.entries(byVariant)) {
            const notInIds = ids.map(id => 'id.neq.' + id).join(',');
            const dr = await fetch(SB + '/rest/v1/ingredients?variant_id=eq.' + vid + '&and=(' + notInIds + ')', {
              method: 'DELETE', headers: SH_DEL
            });
            if (!dr.ok) {
              const detail = await dr.text().catch(() => '');
              throw new Error('ingredients orphan-delete (variant ' + vid + '): ' + detail);
            }
          }
        }

        // 4. L3Items: identita' stabile, sempre upsert per id, mai delete+insert.
        //    Scritto PRIMA di L2 (D4).
        if (l3Items && l3Items.length) {
          await mustSave('l3_items', l3Items, 'l3_items');
        }

        // 5. L2Items: identita' stabile, sempre upsert per id, mai delete+insert.
        //    Scritto per ULTIMO (D4): se e' l'ultimo step, un suo fallimento
        //    non lascia mai L2 "orfani" gia' persistiti mentre uno step
        //    successivo fallisce, perche' non c'e' piu' alcuno step successivo.
        if (l2Items && l2Items.length) {
          await mustSave('l2_items', l2Items, 'l2_items');
        }
      } catch (saveError) {
        console.error('Save error (fail-fast):', saveError.message);
        return res.status(200).json({ ok: false, errors: [saveError.message] });
      }

      return res.status(200).json({ ok: true });
    }

    if (body.supabaseAction === 'update') {
      const ru = await sbPost(body.table, body.data);
      return res.status(200).json(ru);
    }

    if (body.supabaseAction === 'delete') {
      await fetch(SB + '/rest/v1/' + body.table + '?id=eq.' + body.id, {
        method: 'DELETE', headers: SH_DEL
      });
      return res.status(200).json({ ok: true });
    }

    if (body.mode === 'm1') {
      const userMessage = buildM1UserMessage(body);
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 3000,
          system: M1_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userMessage }],
        }),
      });
      const data = await response.json();
      return res.status(response.status).json(data);
    }

    if (body.mode === 'm2') {
      const userMessage = buildM2UserMessage(body);
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          max_tokens: 4000,
          system: M2_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userMessage }],
        }),
      });
      const data = await response.json();
      return res.status(response.status).json(data);
    }

    // Proxy Anthropic legacy — usato ancora dalle altre feature AI temporanee
    // (runPrimoConsulto legacy non piu' chiamato, interpretaModifiche,
    // chiediMichelinAI, note vocali): D1 non le tocca in R2.
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    res.status(response.status).json(data);

  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ error: 'Proxy error', details: error.message });
  }
}
