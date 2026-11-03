/*
 * Dati SINTETICI per la demo locale della Direzione 3.
 * Inventati per la prova: nessun dato reale, nessuna copia di Production.
 * Gli id degli ingredienti hanno piu' di 4 caratteri: il salvataggio
 * dell'app rinomina gli id piu' corti (comportamento esistente).
 *
 * - 22 Schede in 7 categorie (piu' alcune senza categoria), con Famiglie;
 * - "Tagliatelle ai funghi": 2 Ricette Attive, 1 Validata, 1 bozza in LAB,
 *   1 archiviata;
 * - "Risotto agli asparagi": bozza con titolo lungo, 18 ingredienti,
 *   8 passaggi e resa dichiarata, una seconda bozza e una Validata.
 */
'use strict';

function creaDatiSintetici() {
  const base = {
    portion_unit: 'g', media_url: null, video_url: null, intention_initial: null, intention_current: null, criteria_initial: null, criteria_current: null,
    steps: JSON.stringify(['Impastare']), steps_v2: [{ id: 's1', order: 0, text: 'Impastare', expectedDurationSeconds: null }],
    primo_consulto: null, m1_reading_text: null, contenuto_hash: null, contenuto_modificato_il: null,
    declared_yield_qty: null, declared_yield_unit: null, origin_variant_id: null, created_at: '2026-10-01T00:00:00Z',
  };
  const ing = (id, vid, name, qty, unit, o, extra = {}) => ({ id, variant_id: vid, name, qty, unit, sort_order: o, estimated_yield_pct: null, measured_yield_pct: null, is_sub_recipe: false, sub_recipe_id: null, ...extra });
  const passiDa = (t, durate = []) => ({ steps: JSON.stringify(t), steps_v2: t.map((x, i) => ({ id: 's' + i, order: i, text: x, expectedDurationSeconds: durate[i] == null ? null : durate[i] })) });
  const VV = (id, rid, name, status, active, extra = {}) => ({
    ...base, id, recipe_id: rid, name, label: name, note: '', status, active, portions_count: 0, grams_per_portion: 0,
    validated_at: status === 'lab' ? null : '2026-09-21T09:00:00Z', ...extra,
  });

  // [id, nome, categoria, famiglia]
  const SCHEDE = [
    ['sBac', 'Baccalà mantecato', 'Antipasti', 'Pesce'], ['sBro', 'Brodo vegetale', 'Basi', 'Fondi e salse'],
    ['sCan', 'Cannoli di ricotta di pecora', 'Dolci', 'Pasticceria'], ['sCar', 'Carciofi alla romana', 'Contorni', 'Verdure'],
    ['sCia', 'Ciambella alla ricotta e marmellata ai frutti di bosco della nonna Maria', 'Dolci', 'Pasticceria'],
    ['sCon', 'Coniglio in porchetta', 'Secondi', 'Carni'], ['sCop', 'Copertura al cioccolato', 'Dolci', 'Pasticceria'],
    ['sCre', 'Crema pasticcera', 'Basi', 'Pasticceria'], ['sFoc', 'Focaccia a lunga maturazione', 'Altro', 'Lievitati'],
    ['sFon', 'Fondo bruno di vitello', 'Basi', 'Fondi e salse'], ['sGel', 'Gelato al fiordilatte', 'Dolci', 'Gelateria'],
    ['sGla', 'Glassa al cioccolato', 'Dolci', 'Pasticceria'], ['sGua', 'Guancia di manzo brasata al Sangiovese', 'Secondi', 'Carni'],
    ['sMis', 'Mistrà fatto in casa', 'Altro', 'Liquori'], ['sPas', 'Pasta fresca all\'uovo', 'Basi', 'Pasta fresca'],
    ['sPes', 'Pesche sciroppate', 'Altro', 'Conserve'], ['sRis', 'Risotto agli asparagi', 'Primi', 'Risotti'],
    ['sSug', 'Sugo ai funghi porcini', 'Basi', 'Fondi e salse'], ['sTag', 'Tagliatelle ai funghi', 'Primi', 'Pasta fresca'],
    ['sTir', 'Tiramisù', 'Dolci', 'Pasticceria'], ['sVit', 'Vitello tonnato', 'Antipasti', 'Carni'],
    ['sZup', 'zuppa di farro e legumi', 'Primi', 'Zuppe'],
  ];
  const t = {};
  t.recipes = SCHEDE.map(([id, name, category], k) => ({ id, name, category, department: 'Cucina', notes: '', media_url: null, video_url: null, created_at: '2026-09-' + String(1 + k).padStart(2, '0') + 'T00:00:00Z' }));
  t.families = [...new Set(SCHEDE.map(x => x[3]))].map((n, i) => ({ id: 'fam' + i, name: n, created_at: '2026-09-01T00:00:00Z' }));
  const famId = n => t.families.find(f => f.name === n).id;
  t.variants = []; t.ingredients = []; t.variant_families = [];

  // Schede semplici: 1-3 Ricette validate, la prima di solito Attiva.
  SCHEDE.forEach(([rid, name, , fam], k) => {
    if (rid === 'sTag' || rid === 'sRis') return;
    const n = 1 + (k % 3);
    for (let j = 0; j < n; j++) {
      const id = rid + 'v' + j;
      t.variants.push(VV(id, rid, name + (j ? ' ' + (j + 1) : ''), 'validated', j === 0 && k % 4 !== 2));
      t.ingredients.push(ing(id + '-ing-0', id, 'Farina', 500, 'g', 0));
      t.variant_families.push({ variant_id: id, family_id: famId(fam) });
    }
  });

  // Tagliatelle: 2 Attive, 1 Validata, 1 bozza in LAB, 1 archiviata.
  const passiTag = ['Pulisci i porcini e tagliali a fette.', 'Salta i funghi in padella con olio e aglio.', 'Cuoci le tagliatelle 2 minuti in acqua salata.', 'Manteca in padella con un mestolo di acqua di cottura.'];
  [
    ['tA', 'Tagliatelle ai porcini', 'validated', true, { declared_yield_qty: 2400, declared_yield_unit: 'g', portions_count: 12 }],
    ['tB', 'Tagliatelle ai funghi misti', 'validated', true, { declared_yield_qty: 3600, declared_yield_unit: 'g', portions_count: 18 }],
    ['tC', 'Tagliatelle ai funghi e tartufo nero', 'validated', false, { declared_yield_qty: 2000, declared_yield_unit: 'g', portions_count: 10 }],
    ['tL', 'Tagliatelle ai funghi, senza burro', 'lab', false, { label: 'Bozza 3' }],
    ['tR', 'Tagliatelle ai funghi (2024)', 'retired', false, {}],
  ].forEach(([id, name, st, act, ex]) => {
    t.variants.push(VV(id, 'sTag', name, st, act, { ...passiDa(passiTag, [null, 300, 120, 60]), ...ex }));
    t.ingredients.push(ing(id + '-ing-1', id, 'Tagliatelle all\'uovo', 1000, 'g', 0), ing(id + '-ing-2', id, 'Porcini', 400, 'g', 1), ing(id + '-ing-3', id, 'Olio extravergine d\'oliva', 40, 'g', 2), ing(id + '-ing-4', id, 'Aglio', 1, 'n', 3));
    t.variant_families.push({ variant_id: id, family_id: famId('Pasta fresca') });
  });

  // Risotto: bozza con titolo lungo, 18 ingredienti, 8 passaggi, resa dichiarata.
  const RIS = [['Riso Carnaroli', 640], ['Scalogno tritato', 60], ['Olio extravergine d\'oliva', 25], ['Vino bianco secco', 120], ['Brodo vegetale', 1400],
    ['Asparagi verdi, gambi', 340], ['Spinaci novelli', 40], ['Ghiaccio', 150], ['Sale fino', 3], ['Asparagi verdi, punte', 180], ['Burro', 15],
    ['Burro freddo a cubetti', 90], ['Parmigiano Reggiano 24 mesi', 110], ['Sale fino', 9], ['Pepe bianco macinato', 1.5], ['Scorza di limone', 3],
    ['Erba cipollina', 8], ['Mandorle a lamelle tostate', 30]];
  const passi = ['Crema di asparagi: sbollenta i gambi 4 minuti in acqua salata, frulla con spinaci e ghiaccio fino a crema liscia.',
    'Punte: salta le punte nel burro a fuoco vivo, lasciandole croccanti.', 'Brodo: porta il brodo a 90 °C e mantienilo in temperatura.',
    'Soffritto e tostatura: appassisci lo scalogno nell\'olio, aggiungi il riso e tosta.', 'Sfumatura: sfuma con il vino bianco.',
    'Cottura: aggiungi il brodo un mestolo alla volta; negli ultimi 3 minuti incorpora la crema.',
    'Mantecatura: fuori dal fuoco burro freddo e Parmigiano, sale, pepe e limone.', 'Impiattamento: piatto caldo, punte, mandorle ed erba cipollina.'];
  t.variants.push(
    VV('rL1', 'sRis', 'Risotto agli asparagi', 'lab', false, { label: 'Bozza 1', contenuto_modificato_il: '2026-08-27T10:00:00Z' }),
    VV('rL2', 'sRis', 'Risotto agli asparagi con crema di gambi e mantecatura al limone', 'lab', false,
      { label: 'Bozza 2', declared_yield_qty: 2700, declared_yield_unit: 'g', contenuto_modificato_il: '2026-10-27T09:42:00Z', ...passiDa(passi, [720, 240, null, 300, 120, 960, 120, null]) }),
    VV('rV', 'sRis', 'Risotto agli asparagi classico', 'validated', false, {}),
  );
  RIS.forEach(([n, q], i) => t.ingredients.push(ing('ris-ing-' + i, 'rL2', n, q, 'g', i, { estimated_yield_pct: i === 4 ? 60 : null })));
  t.ingredients.push(ing('rL1-ing-0', 'rL1', 'Riso Carnaroli', 600, 'g', 0), ing('rV-ing-0', 'rV', 'Riso Carnaroli', 600, 'g', 0), ing('rV-ing-1', 'rV', 'Asparagi verdi', 400, 'g', 1));
  t.variant_families.push({ variant_id: 'rV', family_id: famId('Risotti') });
  t.recipes.find(r => r.id === 'sRis').notes = 'Brodo sempre a 90 °C fuori dal fuoco: aggiunto freddo blocca la cottura.';

  ['l2_items', 'l3_items', 'ingredient_conversions', 'm2_turns', 'production_sessions', 'session_ingredient_state', 'session_step_state', 'session_notes']
    .forEach(k => { t[k] = []; });
  return t;
}

module.exports = { creaDatiSintetici };

