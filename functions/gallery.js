// functions/gallery.js
// REST API for your gallery (no 'path' column required).
// Endpoints:
// REST API for your gallery (no `path` column required).
// Methods:
//   GET    /.netlify/functions/gallery
//   POST   /.netlify/functions/gallery           { image (DataURL) | dataUrl, filename, location }
//   PUT    /.netlify/functions/gallery           { id, location? , image_url? }
//   DELETE /.netlify/functions/gallery           { id }
//   POST   /.netlify/functions/gallery     { image (DataURL) | dataUrl, filename, location }
//   PUT    /.netlify/functions/gallery     { id, location? , image_url? }
//   DELETE /.netlify/functions/gallery     { id }
//
// Env vars (Netlify → Site settings → Environment):
// Netlify env vars required (Site settings → Environment):
//   SUPAHUB_URL or SUPABASE_URL
//   SUPAHUB_SERVICE_KEY or SUPABASE_SERVICE_ROLE_KEY
//   (optional) SUPAHUB_BUCKET or SUPABASE_BUCKET  -> defaults to "photos"
//   (optional) SUPAHUB_GALLERY_TABLE              -> defaults to "gallery"
//
// Requires Node 18+ (for built-in fetch). Set NODE_VERSION=18 if needed.
// Optional:
//   SUPAHUB_BUCKET (default "photos")
//   SUPAHUB_GALLERY_TABLE (default "gallery")
// Also set: NODE_VERSION=18 (or 20) so `fetch` is available.

const CORS = {
'Access-Control-Allow-Origin': '*',
@@ -49,7 +49,11 @@ const getCfg = () => {
return { BASE, KEY, BUCKET, TABLE, rest, objectWrite, objectPublic };
};

const headersJSON = (key) => ({ apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' });
const headersJSON = (key) => ({
  apikey: key,
  authorization: `Bearer ${key}`,
  'content-type': 'application/json',
});

const cleanName = (s = '') =>
s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
@@ -60,7 +64,7 @@ const parseDataUrl = (dataUrl) => {
return { contentType: m[1], buffer: Buffer.from(m[2], 'base64') };
};

// Extract object path from a public URL like:
// Derive the storage object path from a Supabase public URL:
// .../storage/v1/object/public/<bucket>/<objectPath>
const extractObjectPath = (publicUrl, bucket) => {
try {
@@ -81,16 +85,21 @@ exports.handler = async (event) => {
const { BASE, KEY, BUCKET, TABLE, rest, objectWrite, objectPublic } = getCfg();

switch (event.httpMethod) {
      // LIST
      // -----------------------
      // GET: list gallery items
      // -----------------------
case 'GET': {
        const res = await fetch(rest(`/${encodeURIComponent(TABLE)}?select=*`), { headers: headersJSON(KEY) });
        // You can add ordering if you want:
        // const qs = `?select=*&order=order_index.asc.nullslast&order=created_at.desc.nullslast`;
        const res = await fetch(rest(`/${encodeURIComponent(TABLE)}?select=*`), {
          headers: headersJSON(KEY),
        });
if (!res.ok) {
const t = await res.text().catch(() => '');
console.error('[GET gallery] REST error', res.status, t);
return json(502, { error: 'Failed to list gallery', detail: t });
}
const rows = await res.json();

// Ensure consistent fields for the frontend
const out = rows.map((r) => {
const url = r.image_url || r.src || null;
@@ -99,21 +108,28 @@ exports.handler = async (event) => {
return json(200, out);
}

      // UPLOAD + INSERT
      // --------------------------------------
      // POST: upload + insert DB row (no path)
      // body: { image (DataURL) | dataUrl, filename, location }
      // --------------------------------------
case 'POST': {
const body = JSON.parse(event.body || '{}');
        const image = body.image || body.dataUrl; // accept either field name
        const image = body.image || body.dataUrl; // accept either key
const { filename, location } = body;
if (!image || !filename) return json(400, { error: 'image and filename required' });

const { contentType, buffer } = parseDataUrl(image);
const fname = cleanName(filename);
const objectPath = `uploads/${Date.now()}_${fname}`;

        // Upload to storage (write path: no /public)
        // Upload to storage (write path: NO /public)
const upRes = await fetch(objectWrite(BUCKET, objectPath), {
method: 'POST',
          headers: { authorization: `Bearer ${KEY}`, 'content-type': contentType, 'x-upsert': 'true' },
          headers: {
            authorization: `Bearer ${KEY}`,
            'content-type': contentType,
            'x-upsert': 'true',
          },
body: buffer,
});
if (!upRes.ok) {
@@ -124,12 +140,13 @@ exports.handler = async (event) => {

const publicUrl = objectPublic(BUCKET, objectPath);

        // Insert ONLY columns your table has (no 'path')
        // Insert only known columns
const payload = {
filename: fname,
location: location || '',
image_url: publicUrl,
          // created_at: new Date().toISOString() // add only if your table has this column without default
          // If you want ordering and your column supports big values:
          // order_index: Date.now()
};
const insRes = await fetch(rest(`/${encodeURIComponent(TABLE)}`), {
method: 'POST',
@@ -139,7 +156,7 @@ exports.handler = async (event) => {
if (!insRes.ok) {
const t = await insRes.text().catch(() => '');
console.error('[POST insert] REST error', insRes.status, t);
          // Optional: delete the file we just uploaded to avoid orphaning
          // Optionally delete the just-uploaded object to avoid orphaning
// await fetch(objectWrite(BUCKET, objectPath), { method: 'DELETE', headers: { authorization: `Bearer ${KEY}` } }).catch(()=>{});
return json(502, { error: 'db insert failed', detail: t });
}
@@ -149,7 +166,10 @@ exports.handler = async (event) => {
return json(200, result);
}

      // UPDATE (location and/or image_url)
      // --------------------------------------
      // PUT: update location and/or image_url
      // body: { id, location?, image_url? }
      // --------------------------------------
case 'PUT': {
const body = JSON.parse(event.body || '{}');
const { id, location, image_url } = body || {};
@@ -158,30 +178,37 @@ exports.handler = async (event) => {
const fields = {};
if (typeof location === 'string') fields.location = location;
if (typeof image_url === 'string') fields.image_url = image_url;

if (Object.keys(fields).length === 0) return json(400, { error: 'No updatable fields provided' });

const updRes = await fetch(
rest(`/${encodeURIComponent(TABLE)}?id=eq.${encodeURIComponent(String(id))}`),
          { method: 'PATCH', headers: { ...headersJSON(KEY), Prefer: 'return=representation' }, body: JSON.stringify(fields) }
          {
            method: 'PATCH',
            headers: { ...headersJSON(KEY), Prefer: 'return=representation' },
            body: JSON.stringify(fields),
          }
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
      // --------------------------------------
      // DELETE: remove DB row and storage object
      // body: { id }
      // --------------------------------------
case 'DELETE': {
const body = JSON.parse(event.body || '{}');
const { id } = body || {};
if (!id) return json(400, { error: 'Missing id' });

        // Load the row to get its image_url
        // Get row to read its image_url (so we can delete the object)
const getRes = await fetch(
rest(`/${encodeURIComponent(TABLE)}?id=eq.${encodeURIComponent(String(id))}&select=id,image_url`),
{ headers: headersJSON(KEY) }
@@ -193,7 +220,7 @@ exports.handler = async (event) => {
}
const [row] = await getRes.json();

        // Delete the DB row
        // Delete DB row
const delRes = await fetch(
rest(`/${encodeURIComponent(TABLE)}?id=eq.${encodeURIComponent(String(id))}`),
{ method: 'DELETE', headers: { ...headersJSON(KEY), Prefer: 'return=minimal' } }
@@ -204,7 +231,7 @@ exports.handler = async (event) => {
return json(502, { error: 'db delete failed', detail: t });
}

        // Best effort: delete storage object by deriving objectPath from image_url
        // Best-effort delete object in storage
if (row && row.image_url) {
const objectPath = extractObjectPath(row.image_url, BUCKET);
if (objectPath) {
