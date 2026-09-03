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
