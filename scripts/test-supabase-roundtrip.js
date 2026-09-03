/*
 * Round-trip reale contro Supabase — Sprint 1 (Persistent State Layer).
 *
 * Esercita direttamente le stesse REST call PostgREST che usa api/chat.js
 * (stessi header, stesso pattern upsert/delete), senza passare dal
 * server /api/chat.js e senza toccare architettura/schema/UI.
 *
 * Crea righe di test isolate (id con prefisso "sprint1test_") sotto una
 * Scheda dedicata e le rimuove sempre, anche in caso di fallimento
 * (cleanup in finally, ordine rispettoso delle FK RESTRICT:
 * l3_items -> l2_items -> variants -> recipes).
 *
 * Richiede in ambiente: SUPABASE_URL, SUPABASE_ANON_KEY
 * (le stesse due variabili gia' usate da api/chat.js in produzione —
 * vedi Vercel: Project Settings -> Environment Variables).
 *
 * Uso:
 *   SUPABASE_URL=https://xxx.supabase.co SUPABASE_ANON_KEY=xxx \
 *     node scripts/test-supabase-roundtrip.js
 * oppure:
 *   npm run test:supabase   (con le env var gia' esportate nella shell)
 */
const SB = process.env.SUPABASE_URL;
const SK = process.env.SUPABASE_ANON_KEY;

if (!SB || !SK) {
  console.error('Mancano SUPABASE_URL e/o SUPABASE_ANON_KEY nell\'ambiente.');
  console.error('Recuperale da Vercel (Project Settings -> Environment Variables,');
  console.error('sono le stesse due variabili gia\' usate da api/chat.js) ed esportale');
  console.error('nella shell prima di rilanciare, es.:');
  console.error('  SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/test-supabase-roundtrip.js');
  process.exit(2);
}

const SH_READ = { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'application/json' };
const SH_WRITE = { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' };
const SH_DEL = { apikey: SK, Authorization: 'Bearer ' + SK };

const ts = Date.now();
const REC = 'sprint1test_recipe_' + ts;
const VAR_A = 'sprint1test_variant_a_' + ts;
const VAR_B = 'sprint1test_variant_b_' + ts;
const L2_A = 'sprint1test_l2_a_' + ts;
const L3_A = 'sprint1test_l3_a_' + ts;

let passed = 0, failed = 0;
const results = [];

async function write(table, payload) {
  const r = await fetch(SB + '/rest/v1/' + table, { method: 'POST', headers: SH_WRITE, body: JSON.stringify(payload) });
  const body = await r.text().catch(() => '');
  return { ok: r.ok, status: r.status, body };
}
async function readAll(table, query) {
  const r = await fetch(SB + '/rest/v1/' + table + '?' + query, { headers: SH_READ });
  return r.json();
}
async function del(table, filter) {
  await fetch(SB + '/rest/v1/' + table + '?' + filter, { method: 'DELETE', headers: SH_DEL });
}

async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    passed++;
    console.log('  ok - ' + name);
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    failed++;
    console.log('  FAIL - ' + name);
    console.log('    ' + e.message);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

async function run() {
  console.log('Round-trip reale contro ' + SB);
  console.log('Scheda di test: ' + REC);
  console.log('');

  // Setup: una Scheda e due Ricette (variant lab)
  await test('setup: crea recipes + variants di test', async () => {
    const rRecipe = await write('recipes', { id: REC, name: '__sprint1_roundtrip_test__', category: 'Altro', department: 'Cucina' });
    assert(rRecipe.ok, 'insert recipes fallito: ' + rRecipe.status + ' ' + rRecipe.body);
    const rVarA = await write('variants', { id: VAR_A, recipe_id: REC, name: 'Test A', label: 'Test A', status: 'lab', portions_count: 4, grams_per_portion: 200, steps: '[]', active: false });
    assert(rVarA.ok, 'insert variant A fallito: ' + rVarA.status + ' ' + rVarA.body);
    const rVarB = await write('variants', { id: VAR_B, recipe_id: REC, name: 'Test B', label: 'Test B', status: 'lab', portions_count: 4, grams_per_portion: 200, steps: '[]', active: false });
    assert(rVarB.ok, 'insert variant B fallito: ' + rVarB.status + ' ' + rVarB.body);
  });

  // 1. L2Item: creazione + reload con stesso id
  await test('1. L2Item creato e ricaricato con lo stesso id', async () => {
    const r = await write('l2_items', {
      id: L2_A, variant_id: VAR_A, operational_state: 'open', decision_state: 'none',
      content: { note: 'osservazione test' }, evidence: null, provenance_type: 'm1',
      source_l2_item_id: null, baseline_hash: 'abc123', baseline_context: { snapshot: 'v1' },
    });
    assert(r.ok, 'insert l2_items fallito: ' + r.status + ' ' + r.body);
    const rows = await readAll('l2_items', 'id=eq.' + L2_A);
    assert(rows.length === 1 && rows[0].id === L2_A, 'reload non ha trovato lo stesso id');
  });

  // 2. intention/criteria persistono
  await test('2. intention_initial/current + criteria_initial/current persistono', async () => {
    const r = await write('variants', {
      id: VAR_A, recipe_id: REC,
      intention_initial: { text: 'intento iniziale' }, intention_current: { text: 'intento aggiornato' },
      criteria_initial: { list: ['a'] }, criteria_current: { list: ['a', 'b'] },
    });
    assert(r.ok, 'upsert variant A (intention/criteria) fallito: ' + r.status + ' ' + r.body);
    const rows = await readAll('variants', 'id=eq.' + VAR_A);
    const v = rows[0];
    assert(JSON.stringify(v.intention_initial) === JSON.stringify({ text: 'intento iniziale' }), 'intention_initial non persistito');
    assert(JSON.stringify(v.intention_current) === JSON.stringify({ text: 'intento aggiornato' }), 'intention_current non persistito');
    assert(JSON.stringify(v.criteria_initial) === JSON.stringify({ list: ['a'] }), 'criteria_initial non persistito');
    assert(JSON.stringify(v.criteria_current) === JSON.stringify({ list: ['a', 'b'] }), 'criteria_current non persistito');
  });

  // 3. active=true persiste
  await test('3. active=true persiste su una Ricetta', async () => {
    const r = await write('variants', { id: VAR_A, recipe_id: REC, active: true });
    assert(r.ok, 'upsert active=true fallito: ' + r.status + ' ' + r.body);
    const rows = await readAll('variants', 'id=eq.' + VAR_A);
    assert(rows[0].active === true, 'active non risulta true dopo reload');
  });

  // 4. due Ricette della stessa Scheda entrambe active=true
  await test('4. due Ricette della stessa Scheda possono avere active=true', async () => {
    const r = await write('variants', { id: VAR_B, recipe_id: REC, active: true });
    assert(r.ok, 'upsert active=true su variant B fallito: ' + r.status + ' ' + r.body);
    const rows = await readAll('variants', 'recipe_id=eq.' + REC + '&select=id,active');
    const activeCount = rows.filter(x => x.active === true).length;
    assert(activeCount === 2, 'attese 2 Ricette active=true, trovate ' + activeCount);
  });

  // 5. L3Item valido con recipe_id owner + origin_l2_item_id
  await test('5. L3Item creato con recipe_id owner e origin_l2_item_id valido', async () => {
    const r = await write('l3_items', {
      id: L3_A, recipe_id: REC, distilled_content: { summary: 'conoscenza distillata test' },
      origin_l2_item_id: L2_A, supersedes_id: null,
    });
    assert(r.ok, 'insert l3_items fallito: ' + r.status + ' ' + r.body);
    const rows = await readAll('l3_items', 'id=eq.' + L3_A);
    assert(rows.length === 1 && rows[0].recipe_id === REC && rows[0].origin_l2_item_id === L2_A, 'L3Item non coerente dopo reload');
  });

  // 6. DB rifiuta L3Item senza origin_l2_item_id
  await test('6. DB rifiuta un L3Item senza origin_l2_item_id', async () => {
    const r = await write('l3_items', {
      id: 'sprint1test_l3_bad_' + ts, recipe_id: REC, distilled_content: { summary: 'senza origine' },
      origin_l2_item_id: null,
    });
    assert(!r.ok, 'atteso rifiuto DB, ma insert e\' riuscito');
  });

  // 7. DB rifiuta handoff senza source_l2_item_id
  await test('7. DB rifiuta provenance_type=handoff senza source_l2_item_id', async () => {
    const r = await write('l2_items', {
      id: 'sprint1test_l2_bad_handoff_' + ts, variant_id: VAR_A, operational_state: 'open', decision_state: 'none',
      content: {}, provenance_type: 'handoff', source_l2_item_id: null,
      baseline_hash: 'x', baseline_context: {},
    });
    assert(!r.ok, 'atteso rifiuto DB, ma insert e\' riuscito');
  });

  // 8. DB rifiuta source_l2_item_id su provenance m1/m2/m3
  await test('8. DB rifiuta source_l2_item_id valorizzato su provenance m1', async () => {
    const r = await write('l2_items', {
      id: 'sprint1test_l2_bad_source_' + ts, variant_id: VAR_A, operational_state: 'open', decision_state: 'none',
      content: {}, provenance_type: 'm1', source_l2_item_id: L2_A,
      baseline_hash: 'x', baseline_context: {},
    });
    assert(!r.ok, 'atteso rifiuto DB, ma insert e\' riuscito');
  });

  // 9. DB rifiuta unengaged + decisione diversa da none
  await test('9. DB rifiuta operational_state=unengaged con decision_state=probable/confirmed', async () => {
    const rProb = await write('l2_items', {
      id: 'sprint1test_l2_bad_unengaged_p_' + ts, variant_id: VAR_A, operational_state: 'unengaged', decision_state: 'probable',
      content: {}, provenance_type: 'm1', source_l2_item_id: null,
      baseline_hash: 'x', baseline_context: {},
    });
    assert(!rProb.ok, 'atteso rifiuto DB per unengaged+probable, ma insert e\' riuscito');
    const rConf = await write('l2_items', {
      id: 'sprint1test_l2_bad_unengaged_c_' + ts, variant_id: VAR_A, operational_state: 'unengaged', decision_state: 'confirmed',
      content: {}, provenance_type: 'm1', source_l2_item_id: null,
      baseline_hash: 'x', baseline_context: {},
    });
    assert(!rConf.ok, 'atteso rifiuto DB per unengaged+confirmed, ma insert e\' riuscito');
  });

  // 10. save + reload ripetuto senza cambiare gli id di L2/L3
  await test('10. upsert ripetuto di L2Item e L3Item mantiene lo stesso id (nessun duplicato)', async () => {
    const r1 = await write('l2_items', {
      id: L2_A, variant_id: VAR_A, operational_state: 'affected', decision_state: 'probable',
      content: { note: 'osservazione aggiornata' }, evidence: null, provenance_type: 'm1',
      source_l2_item_id: null, baseline_hash: 'abc123v2', baseline_context: { snapshot: 'v2' },
    });
    assert(r1.ok, 'upsert ripetuto l2_items fallito: ' + r1.status + ' ' + r1.body);
    const r2 = await write('l3_items', {
      id: L3_A, recipe_id: REC, distilled_content: { summary: 'conoscenza aggiornata' },
      origin_l2_item_id: L2_A, supersedes_id: null,
    });
    assert(r2.ok, 'upsert ripetuto l3_items fallito: ' + r2.status + ' ' + r2.body);
    const l2rows = await readAll('l2_items', 'id=eq.' + L2_A);
    const l3rows = await readAll('l3_items', 'id=eq.' + L3_A);
    assert(l2rows.length === 1, 'attesa 1 sola riga l2_items con id ' + L2_A + ', trovate ' + l2rows.length);
    assert(l3rows.length === 1, 'attesa 1 sola riga l3_items con id ' + L3_A + ', trovate ' + l3rows.length);
    assert(l2rows[0].decision_state === 'probable', 'upsert non ha aggiornato il contenuto (decision_state)');
    assert(l3rows[0].distilled_content.summary === 'conoscenza aggiornata', 'upsert non ha aggiornato il contenuto (distilled_content)');
  });

  // 11. Bozza -> Pronta mantenendo lo stesso variant.id
  await test('11. transizione lab -> validated sullo stesso variant.id (no riga duplicata)', async () => {
    const r = await write('variants', { id: VAR_A, recipe_id: REC, status: 'validated', validated_at: new Date().toISOString() });
    assert(r.ok, 'upsert status=validated fallito: ' + r.status + ' ' + r.body);
    const rows = await readAll('variants', 'id=eq.' + VAR_A);
    assert(rows.length === 1, 'attesa 1 sola riga variants con id ' + VAR_A + ', trovate ' + rows.length);
    assert(rows[0].status === 'validated', 'status non risulta validated dopo la transizione');
    const l2rows = await readAll('l2_items', 'variant_id=eq.' + VAR_A);
    assert(l2rows.some(x => x.id === L2_A), 'l2_items non risulta piu\' associato allo stesso variant_id dopo la transizione');
  });

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
}

async function cleanup() {
  console.log('');
  console.log('Cleanup righe di test...');
  await del('l3_items', 'recipe_id=eq.' + REC);
  await del('l2_items', 'variant_id=in.(' + VAR_A + ',' + VAR_B + ')');
  await del('variants', 'recipe_id=eq.' + REC);
  await del('recipes', 'id=eq.' + REC);
  console.log('Cleanup completato.');
}

run().catch(e => { console.error('Errore inatteso:', e); failed++; }).finally(async () => {
  await cleanup();
  process.exit(failed > 0 ? 1 : 0);
});
