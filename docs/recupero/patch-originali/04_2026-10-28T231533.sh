# 2026-10-28T23:15:33.294Z  esito: ok
# output: 'Stati delle Ricette: IN LAB -> Valida -> VALIDATA -> Rendi attiva -> ATTIVA -> Produzione\nSave rifiutato (stati): attivazione_diretta attivazione diretta di una bozza non consentita: prima Valida, poi Rendi attiva dalla Scheda (lvB)\nSave rifiutato (stati): attivazione_diretta attivazione diretta di '
python3 - <<'EOF'
p='scripts/test-stati-ricetta.js'; s=open(p).read()
old="""'async function eliminaBozza(recipeId,variantId)', 'async function confirmMerge()'];"""
new="""'async function eliminaBozza(recipeId,variantId)', 'async function confirmMerge()',
  'function ricetteDellaScheda(recipe)', 'function testoEliminaScheda(recipe)'];"""
assert old in s; s=s.replace(old,new)
old="creaBozzaDaSorgente, upLab, upRec, R, curLab, deleteVariant, deleteRecipe, eliminaBozza, confirmMerge};"
new="creaBozzaDaSorgente, upLab, upRec, R, curLab, deleteVariant, deleteRecipe, eliminaBozza, confirmMerge, ricetteDellaScheda, testoEliminaScheda};"
assert old in s; s=s.replace(old,new)
old="""  function conCascade() {
    const base = fake.fetch;
    fake.fetch = async (url, opts = {}) => {
      const u = new URL(url); const method = opts.method || 'GET';
      if (method === 'DELETE' && u.pathname.endsWith('/recipes')) {
        const id = (u.searchParams.get('id') || '').replace(/^eq\\./, '');
        const vids = fake.tables.variants.filter(v => v.recipe_id === id).map(v => v.id);"""
new="""  // Vincoli come nel database reale: variants.recipe_id CASCADE, ingredients.sub_recipe_id
  // SET NULL; RESTRICT (controllato a fine istruzione, tutto o niente) su
  // variants.origin_variant_id, l2_items.variant_id, l3_items.recipe_id.
  const restrict409 = () => ({ ok: false, status: 409, json: async () => ({ code: '23503' }), text: async () => 'violates foreign key constraint (restrict)' });
  function conCascade() {
    const base = fake.fetch;
    fake.fetch = async (url, opts = {}) => {
      const u = new URL(url); const method = opts.method || 'GET';
      const t = fake.tables; t.l2_items = t.l2_items || []; t.l3_items = t.l3_items || [];
      if (method === 'DELETE' && u.pathname.endsWith('/recipes')) {
        const id = (u.searchParams.get('id') || '').replace(/^eq\\./, '');
        const vids = fake.tables.variants.filter(v => v.recipe_id === id).map(v => v.id);
        if (t.l3_items.some(x => x.recipe_id === id) || t.l2_items.some(x => vids.includes(x.variant_id))
          || t.variants.some(v => !vids.includes(v.id) && vids.includes(v.origin_variant_id))) return restrict409();"""
assert old in s; s=s.replace(old,new)
old="""      if (method === 'DELETE' && u.pathname.endsWith('/variants')) {
        const id = (u.searchParams.get('id') || '').replace(/^eq\\./, '');
"""
new="""      if (method === 'DELETE' && u.pathname.endsWith('/variants')) {
        const id = (u.searchParams.get('id') || '').replace(/^eq\\./, '');
        if (t.l2_items.some(x => x.variant_id === id) || t.variants.some(v => v.id !== id && v.origin_variant_id === id)) return restrict409();
"""
assert old in s; s=s.replace(old,new)
old="""    assert.ok(['usata_come_mattoncino', 'usata_in_produzione'].includes((await del('recipes', 'rB')).code), 'rB: mattoncino vaM e Ricette usate in Produzione');
    assert.strictEqual((await del('recipes', 'rX')).code, 'usata_in_produzione', 'vaX origine di una Sessione');"""
new="""    assert.ok(['usata_come_mattoncino', 'usata_in_produzione'].includes((await del('recipes', 'rB', { ricetteAttese: idsScheda('rB') })).code), 'rB: mattoncino vaM e Ricette usate in Produzione');
    assert.strictEqual((await del('recipes', 'rX', { ricetteAttese: idsScheda('rX') })).code, 'usata_in_produzione', 'vaX origine di una Sessione');"""
assert old in s; s=s.replace(old,new)
old="""  const del = (table, id, extra) =>"""
new="""  const idsScheda = rid => fake.tables.variants.filter(v => v.recipe_id === rid).map(v => v.id);
  const schedaInMemoria = (c, rid) => c.S.recipes.some(r => r.id === rid);
  const del = (table, id, extra) =>"""
assert old in s; s=s.replace(old,new)

newtests = r"""
  // Scheda rE di prova, senza Sessioni ne' mattoncini esterni: Validata vaE1,
  // bozza lvE2 nata da vaE1 (origin_variant_id) che usa vaE1 come mattoncino.
  async function setupSchedaE(extra) {
    const c = await setupEliminazioni();
    fake.tables.recipes.push({ id: 'rE', name: 'Scheda E', category: 'Dolci', department: 'Cucina', notes: '', created_at: '2026-10-01T00:00:00Z' });
    fake.tables.variants.push({ ...clone(riga('vaP')), id: 'vaE1', recipe_id: 'rE', name: 'E1', label: 'E1' },
      { ...clone(riga('lvB')), id: 'lvE2', recipe_id: 'rE', name: 'E2', label: 'E2', origin_variant_id: 'vaE1' });
    fake.tables.ingredients.push({ id: 'ing-e1', variant_id: 'vaE1', name: 'Latte', qty: 50, unit: 'g', sort_order: 0, is_sub_recipe: false, sub_recipe_id: null, estimated_yield_pct: null, measured_yield_pct: null },
      { id: 'mat-e2', variant_id: 'lvE2', name: 'E1', qty: 20, unit: 'g', sort_order: 0, is_sub_recipe: true, sub_recipe_id: 'vaE1', estimated_yield_pct: null, measured_yield_pct: null });
    if (extra) extra();
    const c2 = makeClientStati(clientFetch); await c2.loadFromSupabase(); c2.S.selectedId = 'rE'; c2.S.confirmDeleteId = 'rE'; void c;
    return c2;
  }
  const l2 = (id, vid) => ({ id, variant_id: vid, operational_state: 'open', decision_state: 'none', content: { label: 'x', text: 'osservazione' }, evidence: null, provenance_type: 'm1', source_l2_item_id: null, baseline_hash: 'h', baseline_context: {}, created_at: '2026-10-01T00:00:00Z' });

  await test('E7. Elimina Scheda: due Ricette della stessa Scheda collegate come mattoncino (e bozza con origin_variant_id) si eliminano insieme', async () => {
    const c = await setupSchedaE(); const sess = clone(fake.tables.production_sessions);
    assert.strictEqual(c.testoEliminaScheda(c.R('rE')), 'Eliminare la Scheda «Scheda E» e le sue 2 Ricette? L\'azione è irreversibile.');
    await c.deleteRecipe('rE');
    assert.ok(!fake.tables.recipes.some(r => r.id === 'rE') && !esiste('vaE1') && !esiste('lvE2'), 'Scheda e Ricette eliminate a cascata');
    assert.ok(!fake.tables.ingredients.some(i => ['ing-e1', 'mat-e2'].includes(i.id)));
    assert.ok(!schedaInMemoria(c, 'rE') && c.log.toasts.includes('Scheda eliminata') && !c.log.toasts.some(t => t.startsWith('ALERT')));
    assert.deepStrictEqual(fake.tables.production_sessions, sess);
    assert.strictEqual(fake.tables.ingredients.find(i => i.id === 'mat-x').sub_recipe_id, 'vaM', 'mattoncini di altre Schede intatti');
  });

  await test('E8. Validata con bozza nata da lei (origin_variant_id): eliminare solo la Validata e\' rifiutato dal database, nulla cambia; la Scheda intera si elimina', async () => {
    const c = await setupSchedaE(); const prima = db();
    await c.deleteVariant('rE', 'vaE1');
    assert.deepStrictEqual(db(), prima, 'nessuna eliminazione, nessun SET NULL');
    assert.ok(inMemoria(c, 'vaE1') && /database ha rifiutato/.test(c.log.toasts.join(' ')), 'interfaccia invariata, messaggio chiaro');
    c.S.confirmDeleteId = 'rE'; await c.deleteRecipe('rE');
    assert.ok(!esiste('vaE1') && !esiste('lvE2') && !schedaInMemoria(c, 'rE'));
  });

  await test('E9. osservazioni MichelinAI: Scheda con L2 o L3 non eliminata (nessuna cancellazione delle osservazioni), messaggio comprensibile', async () => {
    for (const [nome, extra] of [['L2', () => fake.tables.l2_items.push(l2('l2E', 'lvE2'))],
      ['L3', () => { fake.tables.l2_items.push(l2('l2Xo', 'vaX')); fake.tables.l3_items.push({ id: 'l3E', recipe_id: 'rE', distilled_content: {}, origin_l2_item_id: 'l2Xo', created_at: '2026-10-01T00:00:00Z' }); }]]) {
      const c = await setupSchedaE(extra); const prima = db(); const l2l3 = clone([fake.tables.l2_items, fake.tables.l3_items]);
      const r = await del('recipes', 'rE', { ricetteAttese: ['vaE1', 'lvE2'] });
      assert.deepStrictEqual([r.ok, r.code], [false, 'osservazioni_michelinai'], nome);
      await c.deleteRecipe('rE');
      assert.deepStrictEqual(db(), prima, nome + ': nulla eliminato');
      assert.deepStrictEqual([fake.tables.l2_items, fake.tables.l3_items], l2l3, nome + ': osservazioni intatte');
      assert.ok(schedaInMemoria(c, 'rE') && c.S.confirmDeleteId === null, nome + ': Scheda ancora visibile, conferma chiusa');
      assert.ok(c.log.toasts.some(t => /non eliminata: ha osservazioni di MichelinAI/.test(t)), nome + ': ' + c.log.toasts.join(' | '));
    }
    const c = await setupSchedaE(() => fake.tables.l2_items.push(l2('l2E', 'lvE2')));
    await c.eliminaBozza('rE', 'lvE2');
    assert.ok(esiste('lvE2') && inMemoria(c, 'lvE2') && fake.tables.l2_items.some(x => x.id === 'l2E'), 'bozza con L2: non eliminata');
    assert.ok(/osservazioni di MichelinAI/.test(c.log.toasts.join(' ')));
  });

  await test('E10. conferma con elenco delle Ricette cambiato: il server rifiuta senza eliminare nulla; senza elenco confermato rifiuta', async () => {
    const c = await setupSchedaE();
    fake.tables.variants.push({ ...clone(riga('lvB')), id: 'lvE9', recipe_id: 'rE', name: 'E9 (da un\'altra finestra)', label: 'E9', origin_variant_id: null });
    const prima = db();
    await c.deleteRecipe('rE');
    assert.deepStrictEqual(db(), prima, 'nessuna eliminazione');
    assert.ok(c.log.toasts.some(t => /non eliminata: la Scheda è cambiata/.test(t)));
    assert.ok(inMemoria(c, 'lvE9'), 'interfaccia ricaricata: la nuova Ricetta e\' visibile');
    assert.strictEqual(c.testoEliminaScheda(c.R('rE')), 'Eliminare la Scheda «Scheda E» e le sue 3 Ricette? L\'azione è irreversibile.');
    assert.deepStrictEqual([(await del('recipes', 'rE')).code, (await del('recipes', 'rE', { ricetteAttese: 'vaE1' })).code], ['conferma_mancante', 'conferma_mancante']);
    assert.deepStrictEqual((await del('recipes', 'rE', { ricetteAttese: ['vaE1', 'lvE2'] })).code, 'scheda_cambiata');
    assert.deepStrictEqual(db(), prima);
    // Una bozza confermata ma mai salvata (solo in memoria) non blocca: nel database non c'e' nulla di non confermato.
    c.creaBozzaDaSorgente('rE', null); c.S.confirmDeleteId = 'rE'; await c.deleteRecipe('rE');
    assert.ok(!fake.tables.recipes.some(r => r.id === 'rE') && !esiste('lvE9') && !schedaInMemoria(c, 'rE'));
  });

  await test('E11. eliminazione fallita (rete, database, controllo): nessun aggiornamento ingannevole dell\'interfaccia', async () => {
    const casi = [['rete', () => { throw new Error('offline'); }, /controlla la connessione/],
      ['database', (u, o, base) => ((o && o.method === 'DELETE') ? restrict409() : base(u, o)), /database ha rifiutato/],
      ['controllo', (u, o, base) => (String(u).includes('/l3_items') ? { ok: false, status: 500, json: async () => ({}), text: async () => 'boom' } : base(u, o)), /verificare le dipendenze/]];
    for (const [nome, guasto, msg] of casi) {
      const c = await setupSchedaE(); const prima = db(); const base = fake.fetch;
      if (nome === 'rete') c.S.__rete = true;
      const clientGuasto = nome === 'rete' ? c : null; void clientGuasto;
      globalThis.fetch = async (u, o) => guasto(u, o, base);
      const cc = nome === 'rete' ? makeClientStati(async () => { throw new Error('offline'); }) : c;
      if (nome === 'rete') { globalThis.fetch = base; await cc.loadFromSupabase().catch(() => {}); }
      if (nome === 'rete') { cc.S.recipes = clone(c.S.recipes); cc.S.confirmDeleteId = 'rE'; }
      await cc.deleteRecipe('rE'); globalThis.fetch = base;
      assert.deepStrictEqual(db(), prima, nome + ': nulla eliminato');
      assert.ok(schedaInMemoria(cc, 'rE') && cc.S.confirmDeleteId === null, nome + ': Scheda ancora visibile, conferma chiusa');
      assert.ok(!cc.log.toasts.includes('Scheda eliminata') && cc.log.toasts.some(t => msg.test(t)), nome + ': ' + cc.log.toasts.join(' | '));
    }
  });
"""
anchor="  // Scheda assorbita rX:"
assert anchor in s; s=s.replace(anchor, newtests+"\n"+anchor,1)
open(p,'w').write(s)
EOF
HTTPS_PROXY=http://127.0.0.1:9 node scripts/test-stati-ricetta.js 2>&1 | grep -v "^  ok" | head -40
