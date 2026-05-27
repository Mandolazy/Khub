export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const body = req.body;
    const SB = process.env.SUPABASE_URL;
    const SK = process.env.SUPABASE_ANON_KEY;
    const SH = { apikey: SK, Authorization: 'Bearer ' + SK, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' };

    if (body.fetchUrl) {
      const pageRes = await fetch(body.fetchUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36', 'Accept': 'text/html', 'Accept-Language': 'it-IT,it;q=0.9', 'Cache-Control': 'no-cache' } });
      const html = await pageRes.text();
      return res.status(200).json({ html });
    }
    if (body.supabaseAction === 'load') {
      const [r1, r2, r3] = await Promise.all([
        fetch(SB+'/rest/v1/recipes?select=*&order=created_at.asc', { headers: SH }),
        fetch(SB+'/rest/v1/variants?select=*&order=created_at.asc', { headers: SH }),
        fetch(SB+'/rest/v1/ingredients?select=*&order=sort_order.asc', { headers: SH })
      ]);
      const [recipes, variants, ingredients] = await Promise.all([r1.json(), r2.json(), r3.json()]);
      return res.status(200).json({ recipes, variants, ingredients });
    }
    if (body.supabaseAction === 'save') {
      const { recipe, variants, ingredients } = body.data;
      await fetch(SB+'/rest/v1/recipes', { method: 'POST', headers: SH, body: JSON.stringify(recipe) });
      if (variants && variants.length) await fetch(SB+'/rest/v1/variants', { method: 'POST', headers: SH, body: JSON.stringify(variants) });
      if (ingredients && ingredients.length) await fetch(SB+'/rest/v1/ingredients', { method: 'POST', headers: SH, body: JSON.stringify(ingredients) });
      return res.status(200).json({ ok: true });
    }
    if (body.supabaseAction === 'update') {
      await fetch(SB+'/rest/v1/'+body.table, { method: 'POST', headers: SH, body: JSON.stringify(body.data) });
      return res.status(200).json({ ok: true });
    }
    if (body.supabaseAction === 'delete') {
      const delH = { apikey: SK, Authorization: 'Bearer ' + SK };
      await fetch(SB+'/rest/v1/'+body.table+'?id=eq.'+body.id, { method: 'DELETE', headers: delH });
      return res.status(200).json({ ok: true });
    }
    const response = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Proxy error', details: error.message });
  }
}