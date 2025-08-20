// functions/journal.js
// REST API for your journal.
// Methods:
//   GET    /.netlify/functions/journal
//   POST   /.netlify/functions/journal     { title, entry_date, content }
//   PUT    /.netlify/functions/journal     { id, title?, entry_date?, content? }
//   DELETE /.netlify/functions/journal     { id }

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
        const url = rest(`/${encodeURIComponent(TABLE)}?select=*&order=created_at.desc.nullslast&order=id.desc`);
        const res = await fetch(url, { headers: headersJSON(KEY) });
        if (!res.ok) {
          const t = await res.text().catch(() => '');
          console.error('[GET journal] REST error', res.status, t);
          return json(502, { error: 'Failed to list journal', detail: t });
        }
        const rows = await res.json();

        const out = rows.map(r => ({
          id: r.id,
          title: r.title || 'Untitled',
          entry_date: r.entry_date || r.created_at || new Date().toISOString(),
          date: r.entry_date || r.created_at || new Date().toISOString(), // legacy alias
          content: r.content || '',
          created_at: r.created_at,
          updated_at: r.updated_at,
        }));
        return json(200, out);
      }

      // --------------------------------------
      // POST: add an entry
      // body: { title, entry_date, content }
      // --------------------------------------
      case 'POST': {
        const body = JSON.parse(event.body || '{}');
        let { title, entry_date, date, content } = body;

        title = (title || '').toString().trim() || 'Untitled';
        entry_date = (entry_date || date || '').toString().trim() || new Date().toISOString().slice(0,10);
        content = (content || '').toString();

        const payload = { title, entry_date, content };

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
          entry_date: row.entry_date || row.created_at,
          date: row.entry_date || row.created_at, // legacy alias
          content: row.content || '',
          created_at: row.created_at,
          updated_at: row.updated_at,
        });
      }

      // --------------------------------------
      // PUT: update an entry
      // body: { id, title?, entry_date?, content? }
      // --------------------------------------
      case 'PUT': {
        const body = JSON.parse(event.body || '{}');
        const { id } = body || {};
        if (!id) return json(400, { error: 'Missing id' });

        const fields = {};
        if (typeof body.title === 'string') fields.title = body.title;
        if (typeof body.entry_date === 'string') fields.entry_date = body.entry_date;
        else if (typeof body.date === 'string') fields.entry_date = body.date; // map legacy date
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
          entry_date: row.entry_date || row.created_at,
          date: row.entry_date || row.created_at, // legacy alias
          content: row.content || '',
          created_at: row.created_at,
          updated_at: row.updated_at,
        });
      }

      // --------------------------------------
      // DELETE: remove an entry
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
