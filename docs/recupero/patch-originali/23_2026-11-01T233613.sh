# 2026-11-01T23:36:13.463Z  esito: ok
# output: 'ok\n31 passed, 0 failed'
python3 - <<'EOF'
p='scripts/test-stati-ricetta.js'; s=open(p).read()
def rep(old,new):
    global s
    assert s.count(old)==1,(s.count(old),old[:80]); s=s.replace(old,new)
rep("""      const t = fake.tables; t.l2_items = t.l2_items || []; t.l3_items = t.l3_items || [];
      if (method === 'DELETE' && u.pathname.endsWith('/recipes')) {
        const id = (u.searchParams.get('id') || '').replace(/^eq\\./, '');""","""      const t = fake.tables; t.l2_items = t.l2_items || []; t.l3_items = t.l3_items || [];
      // Funzione elimina_scheda_se_vuota (docs/proposte): stessa logica, in un solo passo.
      if (method === 'POST' && u.pathname.endsWith('/rpc/elimina_scheda_se_vuota')) {
        fake.rpcChiamate = (fake.rpcChiamate || 0) + 1;
        if (fake.rpc === 'assente') return { ok: false, status: 404, json: async () => ({ code: 'PGRST202' }), text: async () => '{"code":"PGRST202","message":"Could not find the function"}' };
        if (fake.rpc === 'errore') return { ok: false, status: 500, json: async () => ({ code: '55P03' }), text: async () => '{"code":"55P03","message":"lock timeout"}' };
        if (fake.rpc === 'rete') throw new TypeError('fetch failed');
        if (fake.primaDellaRpc) fake.primaDellaRpc();
        const id = JSON.parse(opts.body).p_recipe_id;
        let esito;
        if (!t.recipes.some(r => r.id === id)) esito = 'assente';
        else if (t.variants.some(v => v.recipe_id === id)) esito = 'non_vuota';
        else if (t.l3_items.some(x => x.recipe_id === id)) esito = 'osservazioni_michelinai';
        else { fake.daRpc = true; await fake.fetch(u.origin + '/rest/v1/recipes?id=eq.' + encodeURIComponent(id), { method: 'DELETE', headers: {} }); fake.daRpc = false; esito = 'eliminata'; }
        return { ok: true, status: 200, json: async () => esito, text: async () => JSON.stringify(esito) };
      }
      if (method === 'DELETE' && u.pathname.endsWith('/recipes')) {
        const id = (u.searchParams.get('id') || '').replace(/^eq\\./, '');
        if (!fake.daRpc) fake.deleteSchedeDirette = (fake.deleteSchedeDirette || 0) + 1; // Elimina Scheda (cascata voluta)""")
# M3: rifiuto/errore della funzione invece della DELETE
rep("""  await test('M3. Unisci con eliminazione rifiutata dal database: Ricette trasferite, Scheda vuota resta, messaggio chiaro', async () => {
    const c = await setupUnione(); const base = fake.fetch;
    globalThis.fetch = async (u, o) => ((o && o.method === 'DELETE' && String(u).includes('/recipes')) ? { ok: false, status: 409, json: async () => ({}), text: async () => 'restrict' } : base(u, o));
    await unisci(c); globalThis.fetch = base;
    assert.deepStrictEqual(trasferite.map(id => riga(id).recipe_id), ['rB', 'rB', 'rB', 'rB']);
    assert.ok(fake.tables.recipes.some(r => r.id === 'rX')); assert.ok(/non eliminata/.test(c.log.toasts.join(' ')));
  });""","""  await test('M3. Unisci con errore della funzione nel database (es. blocco scaduto): Ricette trasferite, Scheda vuota conservata, nessuna DELETE alternativa', async () => {
    const c = await setupUnione(); fake.rpc = 'errore';
    await unisci(c);
    assert.deepStrictEqual(trasferite.map(id => riga(id).recipe_id), ['rB', 'rB', 'rB', 'rB']);
    assert.ok(fake.tables.recipes.some(r => r.id === 'rX'), 'Scheda conservata');
    assert.strictEqual(fake.deleteSchedeDirette || 0, 0, 'nessuna DELETE alternativa');
    assert.ok(/non eliminata\\/e: l'eliminazione sicura non è riuscita: la Scheda è stata conservata/.test(c.log.toasts.join(' ')), c.log.toasts.join(' | '));
  });

  await test('M6. Unisci con funzione elimina_scheda_se_vuota non installata o rete assente: Schede di origine conservate, messaggio chiaro', async () => {
    for (const [guasto, msg] of [['assente', /non è ancora installata nel database: la Scheda è stata conservata/], ['rete', /eliminazione sicura non è riuscita/]]) {
      const c = await setupUnione(); fake.rpc = guasto; const nV = fake.tables.variants.length;
      await unisci(c);
      assert.ok(fake.tables.recipes.some(r => r.id === 'rX'), guasto + ': Scheda conservata');
      assert.strictEqual(fake.deleteSchedeDirette || 0, 0, guasto + ': nessuna DELETE alternativa');
      assert.strictEqual(fake.tables.variants.length, nV, guasto + ': nessuna Ricetta persa');
      assert.deepStrictEqual(trasferite.map(id => riga(id).recipe_id), ['rB', 'rB', 'rB', 'rB']);
      assert.ok(msg.test(c.log.toasts.join(' ')), guasto + ': ' + c.log.toasts.join(' | '));
      assert.ok(c.S.recipes.some(r => r.id === 'rX'), guasto + ': stato reale ricaricato');
    }
  });

  await test('M7. Unisci: Ricetta tornata nella Scheda di origine prima dell\\'eliminazione (altra finestra) -> la funzione non la elimina; Scheda con osservazioni L3 conservata', async () => {
    let c = await setupUnione();
    fake.primaDellaRpc = () => { fake.primaDellaRpc = null; fake.tables.variants.push({ ...clone(riga('lvB')), id: 'lvTardi', recipe_id: 'rX', name: 'Tardiva', label: 'Tardiva', origin_variant_id: null }); };
    await unisci(c);
    assert.ok(esiste('lvTardi') && riga('lvTardi').recipe_id === 'rX' && fake.tables.recipes.some(r => r.id === 'rX'), 'Ricetta e Scheda intatte');
    assert.strictEqual(fake.cascate || 0, 0, 'nessuna cancellazione a cascata');
    assert.ok(/contiene ancora delle Ricette/.test(c.log.toasts.join(' ')));
    c = await setupUnione();
    fake.tables.l2_items.push({ id: 'l2Xo', variant_id: 'vaX', operational_state: 'open', decision_state: 'none', content: {}, evidence: null, provenance_type: 'm1', source_l2_item_id: null, baseline_hash: 'h', baseline_context: {}, created_at: '2026-10-01T00:00:00Z' });
    fake.tables.l3_items.push({ id: 'l3X', recipe_id: 'rX', distilled_content: {}, origin_l2_item_id: 'l2Xo', created_at: '2026-10-01T00:00:00Z' });
    await unisci(c);
    assert.ok(fake.tables.recipes.some(r => r.id === 'rX') && fake.tables.l3_items.some(x => x.id === 'l3X'), 'Scheda e osservazioni conservate');
    assert.ok(/osservazioni di MichelinAI/.test(c.log.toasts.join(' ')));
    assert.deepStrictEqual(trasferite.map(id => riga(id).recipe_id), ['rB', 'rB', 'rB', 'rB']);
  });""")
# M1: Scheda vuota eliminata dalla funzione, non da una DELETE diretta
rep("""    assert.ok(!fake.tables.recipes.some(r => r.id === 'rX'), 'Scheda assorbita eliminata solo da vuota');""","""    assert.ok(!fake.tables.recipes.some(r => r.id === 'rX'), 'Scheda assorbita eliminata solo da vuota');
    assert.deepStrictEqual([fake.rpcChiamate, fake.deleteSchedeDirette || 0], [1, 0], 'eliminata dalla funzione transazionale, mai con una DELETE diretta');""")
# E7: Elimina Scheda resta la DELETE con cascata, senza funzione
rep("""    assert.ok(!fake.tables.recipes.some(r => r.id === 'rE') && !esiste('vaE1') && !esiste('lvE2'), 'Scheda e Ricette eliminate a cascata');""","""    assert.ok(!fake.tables.recipes.some(r => r.id === 'rE') && !esiste('vaE1') && !esiste('lvE2'), 'Scheda e Ricette eliminate a cascata');
    assert.deepStrictEqual([fake.rpcChiamate || 0, fake.deleteSchedeDirette], [0, 1], 'Elimina Scheda invariata: DELETE con cascata, nessuna funzione');""")
open(p,'w').write(s); print('ok')
EOF
HTTPS_PROXY=http://127.0.0.1:9 node scripts/test-stati-ricetta.js 2>&1 | grep -E "^  FAIL|passed" -A4
