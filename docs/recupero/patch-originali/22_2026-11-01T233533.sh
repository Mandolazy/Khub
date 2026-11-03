# 2026-11-01T23:35:33.876Z  esito: ok
# output: 'ok\n11 passed, 0 failed'
python3 - <<'EOF'
p='scripts/test-supabase-secret-key.js'; s=open(p).read()
def rep(old,new):
    global s
    assert s.count(old)==1,(s.count(old),old[:80]); s=s.replace(old,new)
rep(""" *    /rest/v1/<tabella nota> (servizi amministrativi Auth/Storage, RPC, altri
 *    host) ne' aggiungere filtri: "fuzz" su ogni campo stringa di ogni azione;""",""" *    /rest/v1/<tabella nota> (servizi amministrativi Auth/Storage, RPC, altri
 *    host) ne' aggiungere filtri: "fuzz" su ogni campo stringa di ogni azione;
 *    unica RPC ammessa: rpc/elimina_scheda_se_vuota, solo per "Unisci"
 *    (delete con soloSeVuota), con l'id solo nel corpo JSON;""")
rep("""let supabaseFails = false;""","""let supabaseFails = false;
let rpcRisposta = () => ({ ok: true, status: 200, json: async () => 'eliminata', text: async () => '"eliminata"' });""")
rep("""  if (supabaseFails) return { ok: false, status: 500, json: async () => ({}), text: async () => 'errore simulato del database' };""","""  if (supabaseFails) return { ok: false, status: 500, json: async () => ({}), text: async () => 'errore simulato del database' };
  if (u.includes('/rest/v1/rpc/')) return rpcRisposta();""")
rep("""function assertSafe(c, ctx) {
  const u = new URL(c.url);
  assert.strictEqual(u.origin, SB_URL, ctx + ': host diverso ' + c.url);
  const m = /^\\/rest\\/v1\\/([a-z_0-9]+)$/.exec(u.pathname);
  assert.ok(m && TABLES.includes(m[1]), ctx + ': percorso non ammesso ' + u.pathname);""","""const RPC_UNISCI = '/rest/v1/rpc/elimina_scheda_se_vuota';
function assertSafe(c, ctx, rpcAmmessa = false) {
  const u = new URL(c.url);
  assert.strictEqual(u.origin, SB_URL, ctx + ': host diverso ' + c.url);
  if (rpcAmmessa && u.pathname === RPC_UNISCI) {
    assert.strictEqual(c.method, 'POST', ctx + ': RPC solo in POST');
    assert.strictEqual(u.search, '', ctx + ': nessun parametro sulla RPC');
    assert.deepStrictEqual(Object.keys(JSON.parse(c.body)), ['p_recipe_id'], ctx + ': solo l\\'id nel corpo');
  } else {
    const m = /^\\/rest\\/v1\\/([a-z_0-9]+)$/.exec(u.pathname);
    assert.ok(m && TABLES.includes(m[1]), ctx + ': percorso non ammesso ' + u.pathname);
  }""")
nuovo = r"""
  await test('Unisci (delete con soloSeVuota): una sola RPC elimina_scheda_se_vuota, id nel corpo, mai una DELETE', async () => {
    const esiti = [
      ['eliminata', { ok: true, deleted: 1 }], ['assente', { ok: true, deleted: 0 }],
      ['non_vuota', { ok: false, code: 'scheda_non_vuota' }], ['osservazioni_michelinai', { ok: false, code: 'osservazioni_michelinai' }],
      ['qualcosa', { ok: false, code: 'rpc_errore' }]];
    for (const [risposta, atteso] of esiti) {
      rpcRisposta = () => ({ ok: true, status: 200, json: async () => risposta, text: async () => JSON.stringify(risposta) });
      calls.length = 0;
      const r = await call({ supabaseAction: 'delete', table: 'recipes', id: 'r&x=1', soloSeVuota: true });
      for (const k of Object.keys(atteso)) assert.strictEqual(r.out[k], atteso[k], risposta + ': ' + JSON.stringify(r.out));
      assert.strictEqual(calls.length, 1, risposta + ': una sola chiamata');
      assertSafe(calls[0], risposta, true);
      assert.strictEqual(new URL(calls[0].url).pathname, RPC_UNISCI);
      assert.deepStrictEqual(JSON.parse(calls[0].body), { p_recipe_id: 'r&x=1' }, 'id solo come dato');
    }
    // Funzione assente, errore del database, rete: nessuna DELETE alternativa.
    const guasti = [
      [() => ({ ok: false, status: 404, json: async () => ({}), text: async () => '{"code":"PGRST202","message":"Could not find the function"}' }), 'rpc_assente'],
      [() => ({ ok: false, status: 500, json: async () => ({}), text: async () => '{"code":"55P03","message":"lock timeout"}' }), 'rpc_errore'],
      [() => { throw new Error('rete assente'); }, 'rpc_errore']];
    for (const [g, codice] of guasti) {
      rpcRisposta = g; calls.length = 0;
      const r = await call({ supabaseAction: 'delete', table: 'recipes', id: 'r1', soloSeVuota: true });
      assert.deepStrictEqual([r.status, r.out.ok, r.out.code], [200, false, codice]);
      assert.ok(!calls.some(c => c.method === 'DELETE'), codice + ': nessuna DELETE');
      assert.ok(!JSON.stringify(r.out).includes(SECRET));
    }
    // Fuzz sull'id: resta un dato nel corpo, mai un percorso o un filtro.
    rpcRisposta = () => ({ ok: true, status: 200, json: async () => 'eliminata', text: async () => '"eliminata"' });
    for (const a of ATTACKS) {
      calls.length = 0;
      await call({ supabaseAction: 'delete', table: 'recipes', id: a, soloSeVuota: true });
      assert.strictEqual(calls.length, 1); assertSafe(calls[0], 'fuzz ' + JSON.stringify(a), true);
      assert.strictEqual(JSON.parse(calls[0].body).p_recipe_id, a);
    }
    // Ogni altra azione resta senza RPC.
    calls.length = 0;
    await call({ supabaseAction: 'delete', table: 'variants', id: 'v1', soloSeVuota: true });
    calls.forEach(c => assertSafe(c, 'variants con soloSeVuota'));
  });
"""
anchor="""  await test('saveVariantFamilies: variante codificata e parametri verificati', async () => {"""
rep(anchor, nuovo.lstrip('\n')+"\n"+anchor)
open(p,'w').write(s); print('ok')
EOF
HTTPS_PROXY=http://127.0.0.1:9 node scripts/test-supabase-secret-key.js 2>&1 | grep -E "FAIL|passed" -A5
