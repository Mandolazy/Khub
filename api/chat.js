export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const body = req.body;
    const SB = process.env.SUPABASE_URL;
    const SK = process.env.SUPABASE_ANON_KEY;

    // Headers per lettura
    const SH_READ = { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'application/json' };
    // Headers per write con upsert
    const SH_WRITE = { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' };
    // Headers per delete
    const SH_DEL = { apikey: SK, Authorization: 'Bearer ' + SK };

    if (body.fetchUrl) {
      const pageRes = await fetch(body.fetchUrl, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html', 'Accept-Language': 'it-IT,it;q=0.9' } });
      const html = await pageRes.text();
      return res.status(200).json({ html });
    }

    if (body.supabaseAction === 'load') {
      const [r1, r2, r3] = await Promise.all([
        fetch(SB+'/rest/v1/recipes?select=*&order=created_at.asc', { headers: SH_READ }),
        fetch(SB+'/rest/v1/variants?select=*&order=created_at.asc', { headers: SH_READ }),
        fetch(SB+'/rest/v1/ingredients?select=*&order=sort_order.asc', { headers: SH_READ })
      ]);
      const [recipes, variants, ingredients] = await Promise.all([r1.json(), r2.json(), r3.json()]);
      return res.status(200).json({ recipes, variants, ingredients });
    }

    if (body.supabaseAction === 'save') {
      const { recipe, variants, ingredients } = body.data;

      // 1. Upsert ricetta
      await fetch(SB+'/rest/v1/recipes', {
        method: 'POST', headers: SH_WRITE, body: JSON.stringify(recipe)
      });

      // 2. Upsert varianti
      if (variants && variants.length) {
        await fetch(SB+'/rest/v1/variants', {
          method: 'POST', headers: SH_WRITE, body: JSON.stringify(variants)
        });
      }

      // 3. Ingredienti: delete per variant_id, poi insert pulito
      if (ingredients && ingredients.length) {
        const variantIds = [...new Set(ingredients.map(i => i.variant_id))];
        // Delete uno per uno
        for (const vid of variantIds) {
          await fetch(SB+'/rest/v1/ingredients?variant_id=eq.'+vid, {
            method: 'DELETE', headers: SH_DEL
          });
        }
        // Insert tutti insieme
        await fetch(SB+'/rest/v1/ingredients', {
          method: 'POST', headers: SH_WRITE, body: JSON.stringify(ingredients)
        });
      }

      return res.status(200).json({ ok: true });
    }

    if (body.supabaseAction === 'update') {
      await fetch(SB+'/rest/v1/'+body.table, {
        method: 'POST', headers: SH_WRITE, body: JSON.stringify(body.data)
      });
      return res.status(200).json({ ok: true });
    }

    if (body.supabaseAction === 'delete') {
      await fetch(SB+'/rest/v1/'+body.table+'?id=eq.'+body.id, {
        method: 'DELETE', headers: SH_DEL
      });
      return res.status(200).json({ ok: true });
    }

    // Proxy Anthropic AI
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    res.status(response.status).json(data);

  } catch (error) {
    res.status(500).json({ error: 'Proxy error', details: error.message });
  }
}
