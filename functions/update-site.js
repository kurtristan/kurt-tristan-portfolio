// functions/update-site.js
// Calls your Netlify build hook to rebuild the public site.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
};

const json = (status, obj) => ({
  statusCode: status,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, max-age=0',
    'Pragma': 'no-cache',
    ...CORS,
  },
  body: JSON.stringify(obj),
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const hook = process.env.NETLIFY_BUILD_HOOK_URL;
  if (!hook) return json(500, { error: 'Missing NETLIFY_BUILD_HOOK_URL env var' });

  // Optional guard: require a header if ADMIN_SECRET is set
  const secret = process.env.ADMIN_SECRET;
  if (secret) {
    const provided = event.headers['x-admin-key'] || event.headers['X-Admin-Key'];
    if (provided !== secret) return json(401, { error: 'Unauthorized' });
  }

  try {
    // Some hooks prefer empty body, some accept JSON fine — we try JSON first, then fall back.
    let res = await fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ triggeredBy: 'admin', ts: Date.now() }),
    });

    if (!res.ok) {
      // Fallback with no body
      res = await fetch(hook, { method: 'POST' });
    }

    const text = await res.text().catch(() => '');
    let parsed = null; try { parsed = JSON.parse(text); } catch {}

    if (!res.ok) return json(502, { error: 'Build hook responded with error', status: res.status, body: parsed || text });
    return json(200, { ok: true, status: res.status, body: parsed || text, note: 'Build enqueued. Check Netlify → Deploys.' });
  } catch (err) {
    return json(500, { error: 'Failed to call build hook', detail: String(err) });
  }
};
