// functions/gallery.js
// REST API for your gallery (Netlify Function).
// Endpoints:
//   GET    /.netlify/functions/gallery
//   POST   /.netlify/functions/gallery           { image, filename, location }  // Data URL upload
//   PUT    /.netlify/functions/gallery           { id, ...fields }              // e.g. { id, location }
//   DELETE /.netlify/functions/gallery           { id }
//
// Env (set in Netlify → Site settings → Environment variables):
//   SUPAHUB_URL or SUPABASE_URL                 e.g. https://xxxxxx.supabase.co
//   SUPAHUB_SERVICE_KEY or SUPABASE_SERVICE_ROLE_KEY
//   SUPAHUB_BUCKET (optional, default "photos")
//   SUPAHUB_GALLERY_TABLE (optional, default "gallery")
//
// Requires node-fetch@2 in dependencies if your site runs Node 16:
//   npm i node-fetch@2

const fetch = globalThis.fetch || require('node-fetch');

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

const text = (status, body, ct = 'application/json') => ({
  statusCode: status,
  headers: { 'Content-Type': ct, ...CORS },
  body,
});

const toLowerKeys = (o = {}) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [String(k).toLowerCase(), v]));

const getConfig = () => {
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
    throw new Error(
      'Missing required env vars: SUPAHUB_URL/SUPABASE_URL and SUPAHUB_SERVICE_KEY/SUPABASE_SERVICE_ROLE_KEY'
    );
  }
  return {
    BASE: URL.replace(/\/$/, ''),
    KEY,
    BUCKET,
    TABLE,
    rest: (path) => `${URL.replace(/\/$/, '')}/rest/v1${path}`,
    objectWrite: (bucket, objectPath) =>
      `${URL.replace(/\/$/, '')}/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath}`,
    objectPublic: (bucket, objectPath) =>
      `${URL.replace(/\/$/, '')}/storage/v1/object/public/${encodeURIComponent(bucket)}/${objectPath}`,
  };
};

const cleanName = (s = '') =>
  s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

const parseDataUrl = (dataUrl) => {
  const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl || '');
  if (!m) throw new Error('Bad image dataUrl');
  return { contentType: m[1], buffer: Buffer.from(m[2], 'base64') };
};

const supaHeaders = (key) => ({
  apikey: key,
  authorization: `Bearer ${key}`,
  'content-type': 'application/json',
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  try {
    const { BASE, KEY, BUCKET, TABLE, rest, objectWrite, objectPublic } = getConfig();

    switch (event.httpMethod) {
      // ---------------------------
      // GET: list all gallery items
      // ---------------------------
      case 'GET': {
        // Fetch rows from your table
        const res = await fetch(rest(`/${encodeURIComponent(TABLE)}?select=*`), {
          headers: supaHeaders(KEY),
        });
        if (!res.ok) {
          const t = await res.text().catch(() => '');
          console.error('[GET gallery] REST error', res.status, t);
          return json(502, { error: 'Failed to list gallery', detail: t });
        }
        const rows = await res.json();

        // Ensure each item has an absolute image URL
        const withUrls = rows.map((r) => {
          const path = r.path || r.object_path || '';
          const url = r.image_url || (path ? objectPublic(BUCKET, path) : r.src) || null;
          return { ...r, image_url: url, src: url };
        });

        return json(200, withUrls);
      }

      // --------------------------------------
      // POST: upload image + insert DB record
      // body: { image (DataURL), filename, location }
      // --------------------------------------
      case 'POST': {
        const body = JSON.parse(event.body || '{}');
        // Accept "dataUrl" field too, normalize to "image"
        const image = body.image || body.dataUrl;
        const { filename, location } = body;

        if (!image || !filename) {
          return json(400, { error: 'image and filename required' });
        }

        // Parse image
        const { contentType, buffer } = parseDataUrl(image);
        const fname = cleanName(filename);
        const objectPath = `uploads/${Date.now()}_${fname}`;

        // Upload to storage (note: **no** /public in write path)
        const writeUrl = objectWrite(BUCKET, objectPath);
        const upRes = await fetch(writeUrl, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${KEY}`,
            'content-type': contentType,
            'x-upsert': 'true',
          },
          body: buffer,
        });

        if (!upRes.ok) {
          const t = await upRes.text().catch(() => '');
          console.error('[POST upload] storage error', upRes.status, t);
          return json(502, { error: 'upload failed', detail: t });
        }

        // Build canonical public URL for reading
        const publicUrl = objectPublic(BUCKET, objectPath);

        // Insert into DB
        const payload = {
          filename: fname,
          location: location || '',
          path: objectPath,         // keep the path for later deletes
          image_url: publicUrl,     // convenient for reads
          created_at: new Date().toISOString(),
        };

        const insRes = await fetch(rest(`/${encodeURIComponent(TABLE)}`), {
          method: 'POST',
          headers: { ...supaHeaders(KEY), Prefer: 'return=representation' },
          body: JSON.stringify(payload),
        });

        if (!insRes.ok) {
          const t = await insRes.text().catch(() => '');
          console.error('[POST insert] REST error', insRes.status, t);
          // Don’t orphan the file in storage if DB insert fails (optional: delete storage object)
          // await fetch(objectWrite(BUCKET, objectPath), { method: 'DELETE', headers: { authorization: `Bearer ${KEY}` } }).catch(()=>{});
          return json(502, { error: 'db insert failed', detail: t });
        }

        const [row] = await insRes.json();
        const result = { ...row, image_url: publicUrl, src: publicUrl };
        return json(200, result);
      }

      // --------------------------------------
      // PUT: update item fields (e.g., location)
      // body: { id, ...fields }
      // --------------------------------------
      case 'PUT': {
        const body = JSON.parse(event.body || '{}');
        const { id, ...fields } = body || {};
        if (!id) return json(400, { error: 'Missing id' });

        // If client sends a new path, recompute image_url
        if (fields.path && !fields.image_url) {
          fields.image_url = objectPublic(BUCKET, fields.path);
        }

        const updRes = await fetch(
          rest(`/${encodeURIComponent(TABLE)}?id=eq.${encodeURIComponent(String(id))}`),
          {
            method: 'PATCH',
            headers: { ...supaHeaders(KEY), Prefer: 'return=representation' },
            body: JSON.stringify(fields),
          }
        );

        if (!updRes.ok) {
          const t = await updRes.text().catch(() => '');
          console.error('[PUT update] REST error', updRes.status, t);
          return json(502, { error: 'db update failed', detail: t });
        }

        const [row] = await updRes.json();
        const url = row.image_url || (row.path ? objectPublic(BUCKET, row.path) : null);
        return json(200, { ...row, image_url: url, src: url });
      }

      // --------------------------------------
      // DELETE: remove item (and storage object if we know the path)
      // body: { id }
      // --------------------------------------
      case 'DELETE': {
        const body = JSON.parse(event.body || '{}');
        const { id } = body || {};
        if (!id) return json(400, { error: 'Missing id' });

        // Load row first so we know the object path to delete
        const getRes = await fetch(
          rest(`/${encodeURIComponent(TABLE)}?id=eq.${encodeURIComponent(String(id))}&select=*`),
          { headers: supaHeaders(KEY) }
        );
        if (!getRes.ok) {
          const t = await getRes.text().catch(() => '');
          console.error('[DELETE fetch row] REST error', getRes.status, t);
          return json(502, { error: 'db read failed', detail: t });
        }
        const [row] = await getRes.json();

        // Delete DB row
        const delRes = await fetch(
          rest(`/${encodeURIComponent(TABLE)}?id=eq.${encodeURIComponent(String(id))}`),
          { method: 'DELETE', headers: { ...supaHeaders(KEY), Prefer: 'return=minimal' } }
        );
        if (!delRes.ok) {
          const t = await delRes.text().catch(() => '');
          console.error('[DELETE row] REST error', delRes.status, t);
          return json(502, { error: 'db delete failed', detail: t });
        }

        // Best-effort: delete storage object if we have a path
        if (row && (row.path || row.object_path)) {
          const objectPath = row.path || row.object_path;
          const delObj = await fetch(
            // DELETE uses the *write* path (no /public)
            `${BASE}/storage/v1/object/${encodeURIComponent(BUCKET)}/${objectPath}`,
            { method: 'DELETE', headers: { authorization: `Bearer ${KEY}` } }
          ).catch(() => null);
          if (delObj && !delObj.ok) {
            const t = await delObj.text().catch(() => '');
            console.warn('[DELETE object] storage error', delObj.status, t);
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
