// functions/gallery.js
// REST API for your gallery (no 'path' column required).
// Endpoints:
//   GET    /.netlify/functions/gallery
//   POST   /.netlify/functions/gallery           { image (DataURL) | dataUrl, filename, location }
//   PUT    /.netlify/functions/gallery           { id, location? , image_url? }
//   DELETE /.netlify/functions/gallery           { id }
//
// Env vars (Netlify → Site settings → Environment):
//   SUPAHUB_URL or SUPABASE_URL
//   SUPAHUB_SERVICE_KEY or SUPABASE_SERVICE_ROLE_KEY
//   (optional) SUPAHUB_BUCKET or SUPABASE_BUCKET  -> defaults to "photos"
//   (optional) SUPAHUB_GALLERY_TABLE              -> defaults to "gallery"
//
// Requires Node 18+ (for built-in fetch). Set NODE_VERSION=18 if needed.

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
  const BUCKET = process.env.SUPAHUB_BUCKET || process.env.SUPABASE_BUCKET || 'photos';
  const TABLE = process.env.SUPAHUB_GALLERY_TABLE || process.env.SUPABASE_GALLERY_TABLE || 'gallery';
  if (!URL || !KEY) {
    throw new Error('Missing env vars: SUPAHUB_URL/SUPABASE_URL and SUPAHUB_SERVICE_KEY/SUPABASE_SERVICE_ROLE_KEY');
  }
  const BASE = URL.replace(/\/$/, '');
  const rest = (path) => `${BASE}/rest/v1${path}`;
  const objectWrite = (bucket, objectPath) =>
    `${BASE}/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath}`;
  const objectPublic = (bucket, objectPath) =>
    `${BASE}/storage/v1/object/public/${encodeURIComponent(bucket)}/${objectPath}`;
  return { BASE, KEY, BUCKET, TABLE, rest, objectWrite, objectPublic };
};

const headersJSON = (key) => ({ apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' });

const cleanName = (s = '') =>
  s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

const parseDataUrl = (dataUrl) => {
  const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl || '');
  if (!m) throw new Error('Bad image dataUrl');
  return { contentType: m[1], buffer: Buffer.from(m[2], 'base64') };
};

// Extract object path from a public URL like:
// .../storage/v1/object/public/<bucket>/<objectPath>
const extractObjectPath = (publicUrl, bucket) => {
  try {
    if (!publicUrl) return null;
    const marker = `/storage/v1/object/public/${encodeURIComponent(bucket)}/`;
    const idx = publicUrl.indexOf(marker);
    if (idx === -1) return null;
    return decodeURIComponent(publicUrl.slice(idx + marker.length));
  } catch {
    return null;
  }
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  try {
    const { BASE, KEY, BUCKET, TABLE, rest, objectWrite, objectPublic } = getCfg();

    switch (event.httpMethod) {
      // LIST
      case 'GET': {
        const res = await fetch(rest(`/${encodeURIComponent(TABLE)}?select=*`), { headers: headersJSON(KEY) });
        if (!res.ok) {
          const t = await res.text().catch(() => '');
          console.error('[GET gallery] REST error', res.status, t);
          return json(502, { error: 'Failed to list gallery', detail: t });
        }
        const rows = await res.json();

        // Ensure consistent fields for the frontend
        const out = rows.map((r) => {
          const url = r.image_url || r.src || null;
          return { ...r, image_url: url, src: url };
        });
        return json(200, out);
      }

      // UPLOAD + INSERT
      case 'POST': {
        const body = JSON.parse(event.body || '{}');
        const image = body.image || body.dataUrl; // accept either field name
        const { filename, location } = body;
        if (!image || !filename) return json(400, { error: 'image and filename required' });

        const { contentType, buffer } = parseDataUrl(image);
        const fname = cleanName(filename);
        const objectPath = `uploads/${Date.now()}_${fname}`;

        // Upload to storage (write path: no /public)
        const upRes = await fetch(objectWrite(BUCKET, objectPath), {
          method: 'POST',
          headers: { authorization: `Bearer ${KEY}`, 'content-type': contentType, 'x-upsert': 'true' },
          body: buffer,
        });
        if (!upRes.ok) {
          const t = await upRes.text().catch(() => '');
          console.error('[POST upload] storage error', upRes.status, t);
          return json(502, { error: 'upload failed', detail: t });
        }

        const publicUrl = objectPublic(BUCKET, objectPath);

        // Insert ONLY columns your table has (no 'path')
        const payload = {
          filename: fname,
          location: location || '',
          image_url: publicUrl,
          // created_at: new Date().toISOString() // add only if your table has this column without default
        };
        const insRes = await fetch(rest(`/${encodeURIComponent(TABLE)}`), {
          method: 'POST',
          headers: { ...headersJSON(KEY), Prefer: 'return=representation' },
          body: JSON.stringify(payload),
        });
        if (!insRes.ok) {
          const t = await insRes.text().catch(() => '');
          console.error('[POST insert] REST error', insRes.status, t);
          // Optional: delete the file we just uploaded to avoid orphaning
          // await fetch(objectWrite(BUCKET, objectPath), { method: 'DELETE', headers: { authorization: `Bearer ${KEY}` } }).catch(()=>{});
          return json(502, { error: 'db insert failed', detail: t });
        }

        const [row] = await insRes.json();
        const result = { ...row, image_url: publicUrl, src: publicUrl };
        return json(200, result);
      }

      // UPDATE (location and/or image_url)
      case 'PUT': {
        const body = JSON.parse(event.body || '{}');
        const { id, location, image_url } = body || {};
        if (!id) return json(400, { error: 'Missing id' });

        const fields = {};
        if (typeof location === 'string') fields.location = location;
        if (typeof image_url === 'string') fields.image_url = image_url;

        if (Object.keys(fields).length === 0) return json(400, { error: 'No updatable fields provided' });

        const updRes = await fetch(
          rest(`/${encodeURIComponent(TABLE)}?id=eq.${encodeURIComponent(String(id))}`),
          { method: 'PATCH', headers: { ...headersJSON(KEY), Prefer: 'return=representation' }, body: JSON.stringify(fields) }
        );
        if (!updRes.ok) {
          const t = await updRes.text().catch(() => '');
          console.error('[PUT update] REST error', updRes.status, t);
          return json(502, { error: 'db update failed', detail: t });
        }
        const [row] = await updRes.json();
        const url = row.image_url || row.src || null;
        return json(200, { ...row, image_url: url, src: url });
      }

      // DELETE (also delete storage object best-effort by parsing image_url)
      case 'DELETE': {
        const body = JSON.parse(event.body || '{}');
        const { id } = body || {};
        if (!id) return json(400, { error: 'Missing id' });

        // Load the row to get its image_url
        const getRes = await fetch(
          rest(`/${encodeURIComponent(TABLE)}?id=eq.${encodeURIComponent(String(id))}&select=id,image_url`),
          { headers: headersJSON(KEY) }
        );
        if (!getRes.ok) {
          const t = await getRes.text().catch(() => '');
          console.error('[DELETE fetch row] REST error', getRes.status, t);
          return json(502, { error: 'db read failed', detail: t });
        }
        const [row] = await getRes.json();

        // Delete the DB row
        const delRes = await fetch(
          rest(`/${encodeURIComponent(TABLE)}?id=eq.${encodeURIComponent(String(id))}`),
          { method: 'DELETE', headers: { ...headersJSON(KEY), Prefer: 'return=minimal' } }
        );
        if (!delRes.ok) {
          const t = await delRes.text().catch(() => '');
          console.error('[DELETE row] REST error', delRes.status, t);
          return json(502, { error: 'db delete failed', detail: t });
        }

        // Best effort: delete storage object by deriving objectPath from image_url
        if (row && row.image_url) {
          const objectPath = extractObjectPath(row.image_url, BUCKET);
          if (objectPath) {
            await fetch(`${BASE}/storage/v1/object/${encodeURIComponent(BUCKET)}/${objectPath}`, {
              method: 'DELETE',
              headers: { authorization: `Bearer ${KEY}` },
            }).catch(() => null);
          }
        }

        return json(200, { ok: true });
      }

      default:
        return json(405, { error: 'Method not allowed' });
    }
  } catch (err) {
    console.error('[gallery handler]', err);
    return json(500, { error: 'Internal error', detail: String(err && err.message || err) });
  }
};
