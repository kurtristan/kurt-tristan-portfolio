// functions/journal.js
// REST API for your journal.
// Methods:
//   GET    /.netlify/functions/journal
//   POST   /.netlify/functions/journal     { title, date, content }
//   PUT    /.netlify/functions/journal     { id, title?, date?, content? }
//   DELETE /.netlify/functions/journal     { id }
//
// Netlify env vars required (Site settings → Environment):
//   SUPAHUB_URL or SUPABASE_URL
//   SUPAHUB_SERVICE_KEY or SUPABASE_SERVICE_ROLE_KEY
// Optional:
//   SUPAHUB_JOURNAL_TABLE or SUPABASE_JOURNAL_TABLE (default "journal")
// Also set: NODE_VERSION=18 (or 20) so `fetch` is available.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const json = (status, obj) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json', ...CORS },
  body: JSON.stringify(obj),
});

const getCfg = () => {
  const URL =
    process.env.SUPAHUB_URL ||
    process.env.SUPABASE_URL ||
    '';
  const KEY =
    process.env.SUPAHUB_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    '';
  const TABLE =
    process.env.SUPAHUB_JOURNAL_TABLE ||
    process.env.SUPABASE_JOURNAL_TABLE ||
    'journal';

  if (!URL || !KEY) {
    throw new Error('Missing env vars: SUPAHUB_URL/SUPABASE_URL and SUPAHUB_SERVICE_KEY/SUPABASE_SERVICE_ROLE_KEY');
  }

  const BASE = URL.replace(/\/$/, '');
  const rest = (path) => `${BASE}/rest/v1${path}`;
  return { KEY, TABLE, rest };
};

const headersJSON = (key) => ({
  apikey: key,
  authorization: `Bearer ${key}`,
  'content-type': 'application/json',
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  try {
    const { KEY, TABLE, rest } = getCfg();

    switch (event.httpMethod) {
      // -----------------------
      // GET: list journal entries (newest first)
      // -----------------------
      case 'GET': {
        // Order by created_at desc, then id desc as a stable tiebreaker
        const url = rest(`/${encodeURIComponent(TABLE)}?select=*&order=created_at.desc.nullslast&order=id.desc`);
        const res = await fetch(url, { headers: headersJSON(KEY) });
        if (!res.ok) {
          const t = await res.text().catch(() => '');
          console.error('[GET journal] REST error', res.status, t);
          return json(502, { error: 'Failed to list journal', detail: t });
        }
        const rows = await res.json();
        // Normalize field names the frontend expects: title, date, content
        const out = rows.map(r => ({
          id: r.id,
          title: r.title || 'Untitled',
          date: r.date || r.created_at || new Date().toISOString(),
          content: r.content || r.body || '',
          created_at: r.created_at,
          updated_at: r.updated_at,
        }));
        return json(200, out);
      }

      // --------------------------------------
      // POST: add an entry
      // body: { title, date, content }
      // --------------------------------------
      case 'POST': {
        const body = JSON.parse(event.body || '{}');
        let { title, date, content } = body;

        // Sanity defaults
        title = (title || '').toString().trim() || 'Untitled';
        // Allow either ISO or display strings — store as given
        date = (date || '').toString().trim() || new Date().toISOString();
        content = (content || '').toString();

        const payload = { title, date, content };
        const insRes = await fetch(rest(`/${encodeURIComponent(TABLE)}`), {
          method: 'POST',
          headers: { ...headersJSON(KEY), Prefer: 'return=representation' },
          body: JSON.stringify(payload),
        });
        if (!insRes.ok) {
          const t = await insRes.text().catch(() => '');
          console.error('[POST journal] REST error', insRes.status, t);
          return json(502, { error: 'db insert failed', detail: t });
        }
        const [row] = await insRes.json();
        return json(200, {
          id: row.id,
          title: row.title,
          date: row.date || row.created_at,
          content: row.content || '',
          created_at: row.created_at,
          updated_at: row.updated_at,
        });
      }

      // --------------------------------------
      // PUT: update an entry
      // body: { id, title?, date?, content? }
      // --------------------------------------
      case 'PUT': {
        const body = JSON.parse(event.body || '{}');
        const { id } = body || {};
        if (!id) return json(400, { error: 'Missing id' });

        const fields = {};
        if (typeof body.title === 'string') fields.title = body.title;
        if (typeof body.date === 'string') fields.date = body.date;
        if (typeof body.content === 'string') fields.content = body.content;

        if (Object.keys(fields).length === 0) {
          return json(400, { error: 'No updatable fields provided' });
        }

        const updRes = await fetch(
          rest(`/${encodeURIComponent(TABLE)}?id=eq.${encodeURIComponent(String(id))}`),
          {
            method: 'PATCH',
            headers: { ...headersJSON(KEY), Prefer: 'return=representation' },
            body: JSON.stringify(fields),
          }
        );
        if (!updRes.ok) {
          const t = await updRes.text().catch(() => '');
          console.error('[PUT journal] REST error', updRes.status, t);
          return json(502, { error: 'db update failed', detail: t });
        }
        const [row] = await updRes.json();
        return json(200, {
          id: row.id,
          title: row.title,
          date: row.date || row.created_at,
          content: row.content || '',
          created_at: row.created_at,
          updated_at: row.updated_at,
        });
      }

      // --------------------------------------
      // DELETE: remove an entry
      // body: { id }
      // --------------------------------------
      case 'DELETE': {
        const body = JSON.parse(event.body || '{}');
        const { id } = body || {};
        if (!id) return json(400, { error: 'Missing id' });

        const delRes = await fetch(
          rest(`/${encodeURIComponent(TABLE)}?id=eq.${encodeURIComponent(String(id))}`),
          { method: 'DELETE', headers: { ...headersJSON(KEY), Prefer: 'return=minimal' } }
        );
        if (!delRes.ok) {
          const t = await delRes.text().catch(() => '');
          console.error('[DELETE journal] REST error', delRes.status, t);
          return json(502, { error: 'db delete failed', detail: t });
        }
        return json(200, { ok: true });
      }

      default:
        return json(405, { error: 'Method not allowed' });
    }
  } catch (err) {
    console.error('[journal handler]', err);
    return json(500, { error: 'Internal error', detail: String((err && err.message) || err) });
  }
};
