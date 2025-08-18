// functions/journal.js
// REST for Journal
// Methods:
//   GET    /.netlify/functions/journal
//   POST   /.netlify/functions/journal       { title, date, content }
//   PUT    /.netlify/functions/journal       { id, title?, date?, content? }
//   DELETE /.netlify/functions/journal       { id }

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

const cfg = () => {
  const BASE =
    (process.env.SUPAHUB_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const KEY = process.env.SUPAHUB_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const TABLE = process.env.SUPAHUB_JOURNAL_TABLE || process.env.SUPABASE_JOURNAL_TABLE || 'journal';
  if (!BASE || !KEY) throw new Error('Missing env vars: SUPAHUB_URL/SUPABASE_URL and SUPAHUB_SERVICE_KEY/SUPABASE_SERVICE_ROLE_KEY');
  const rest = (path) => `${BASE}/rest/v1${path}`;
  const headersJSON = {
    apikey: KEY,
    authorization: `Bearer ${KEY}`,
    'content-type': 'application/json',
  };
  return { BASE, KEY, TABLE, rest, headersJSON };
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  try {
    const { TABLE, rest, headersJSON } = cfg();

    switch (event.httpMethod) {
      // GET: list entries (newest first by date, then created_at)
      case 'GET': {
        const qs = `?select=*&order=date.desc.nullslast&order=created_at.desc.nullslast`;
        const res = await fetch(rest(`/${encodeURIComponent(TABLE)}${qs}`), { headers: headersJSON });
        if (!res.ok) {
          const t = await res.text().catch(() => '');
          console.error('[journal GET]', res.status, t);
          return json(502, { error: 'Failed to load journal', detail: t });
        }
        const rows = await res.json();
        return json(200, rows);
      }

      // POST: add an entry
      case 'POST': {
        const body = JSON.parse(event.body || '{}');
        const { title, date, content } = body || {};
        if (!title || !content) return json(400, { error: 'title and content are required' });

        // Allow empty or provided date. If provided, keep as ISO/date string.
        const payload = {
          title: String(title),
          content: String(content),
          ...(date ? { date } : {}),
        };

        const res = await fetch(rest(`/${encodeURIComponent(TABLE)}`), {
          method: 'POST',
          headers: { ...headersJSON, Prefer: 'return=representation' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const t = await res.text().catch(() => '');
          console.error('[journal POST]', res.status, t);
          return json(502, { error: 'Failed to insert journal entry', detail: t });
        }
        const [row] = await res.json();
        return json(200, row);
      }

      // PUT: update an entry
      case 'PUT': {
        const body = JSON.parse(event.body || '{}');
        const { id, title, date, content } = body || {};
        if (!id) return json(400, { error: 'id is required' });

        const fields = {};
        if (typeof title === 'string') fields.title = title;
        if (typeof content === 'string') fields.content = content;
        if (typeof date === 'string') fields.date = date;
        if (Object.keys(fields).length === 0) return json(400, { error: 'No updatable fields provided' });

        const res = await fetch(
          rest(`/${encodeURIComponent(TABLE)}?id=eq.${encodeURIComponent(String(id))}`),
          {
            method: 'PATCH',
            headers: { ...headersJSON, Prefer: 'return=representation' },
            body: JSON.stringify(fields),
          }
        );
        if (!res.ok) {
          const t = await res.text().catch(() => '');
          console.error('[journal PUT]', res.status, t);
          return json(502, { error: 'Failed to update journal entry', detail: t });
        }
        const [row] = await res.json();
        return json(200, row);
      }

      // DELETE: remove an entry
      case 'DELETE': {
        const body = JSON.parse(event.body || '{}');
        const { id } = body || {};
        if (!id) return json(400, { error: 'id is required' });

        const res = await fetch(
          rest(`/${encodeURIComponent(TABLE)}?id=eq.${encodeURIComponent(String(id))}`),
          { method: 'DELETE', headers: { ...headersJSON, Prefer: 'return=minimal' } }
        );
        if (!res.ok) {
          const t = await res.text().catch(() => '');
          console.error('[journal DELETE]', res.status, t);
          return json(502, { error: 'Failed to delete journal entry', detail: t });
        }
        return json(200, { ok: true });
      }

      default:
        return json(405, { error: 'Method not allowed' });
    }
  } catch (err) {
    console.error('[journal handler]', err);
    return json(500, { error: 'Internal error', detail: String(err && err.message || err) });
  }
};
