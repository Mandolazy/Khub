# 2026-10-28T23:16:28.488Z  esito: ok
# output: 'test-stati-ricetta: 29 passed, 0 failed \ntest-supabase-secret-key:   FAIL - delete: solo recipes/variants/production_sessions, id codificato, Sessioni solo se pending 9 passed, 1 failed \ntest-preview-direzione-3: 17 passed, 0 failed \ntest-security-access: 23 passed, 0 failed \ntest-post-validation-ux'
python3 - <<'EOF'
p='scripts/test-stati-ricetta.js'; s=open(p).read()
i=s.index("  await test('E11."); j=s.index("  // Scheda assorbita rX:")
new=r"""  await test('E11. eliminazione fallita (rete, database, controllo): nessun aggiornamento ingannevole dell\'interfaccia', async () => {
    const casi = [['rete', null, /controlla la connessione/],
      ['database', (u, o, base) => ((o && o.method === 'DELETE') ? restrict409() : base(u, o)), /database ha rifiutato/],
      ['controllo', (u, o, base) => (String(u).includes('/l3_items') ? { ok: false, status: 500, json: async () => ({}), text: async () => 'boom' } : base(u, o)), /verificare le dipendenze/]];
    for (const [nome, guasto, msg] of casi) {
      let c = await setupSchedaE(); const prima = db(); const base = fake.fetch;
      if (guasto) globalThis.fetch = async (u, o) => guasto(u, o, base);
      else { const offline = makeClientStati(async () => { throw new Error('offline'); }); offline.S.recipes = clone(c.S.recipes); offline.S.confirmDeleteId = 'rE'; c = offline; }
      await c.deleteRecipe('rE'); globalThis.fetch = base;
      assert.deepStrictEqual(db(), prima, nome + ': nulla eliminato');
      assert.ok(schedaInMemoria(c, 'rE') && c.S.confirmDeleteId === null, nome + ': Scheda ancora visibile, conferma chiusa');
      assert.ok(!c.log.toasts.includes('Scheda eliminata') && c.log.toasts.some(t => msg.test(t)), nome + ': ' + c.log.toasts.join(' | '));
    }
  });

"""
s=s[:i]+new+s[j:]; open(p,'w').write(s)
EOF
for t in test-stati-ricetta test-supabase-secret-key test-preview-direzione-3 test-security-access test-post-validation-ux test-demo-direzione-3; do echo "$t: $(HTTPS_PROXY=http://127.0.0.1:9 node scripts/$t.js 2>&1 | grep -E 'FAIL|passed' | tr '\n' ' ')"; done
