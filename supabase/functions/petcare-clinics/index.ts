// Public clinic search grants. Policy: https://operations.osmfoundation.org/policies/nominatim/
// A DB lease serializes requests; browsers load and cache public listings for 15 minutes.
function allowedOrigin(origin: string) {
  if (origin === 'https://stormman745.github.io') return true;
  try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname); } catch { return false; }
}
function response(req: Request, body: unknown, status = 200) {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type', 'Access-Control-Max-Age': '600' });
  const origin = req.headers.get('origin');
  if (origin && allowedOrigin(origin)) headers.set('Access-Control-Allow-Origin', origin);
  return new Response(JSON.stringify(body), { status, headers });
}
async function readBody(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) throw new Error('body');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1024) { await reader.cancel(); throw new Error('size'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
async function rpc(name: string, body: Record<string, unknown>) {
  const base = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!base || !key) throw new Error('server_configuration');
  const result = await fetch(`${base}/rest/v1/rpc/${name}`, { method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(7000) });
  if (!result.ok) {
    console.warn('Clinic cache unavailable', { operation: name, status: result.status });
    await result.body?.cancel(); throw new Error('directory_cache');
  }
  const text = await result.text();
  return text ? JSON.parse(text) : null;
}
Deno.serve(async req => {
  const origin = req.headers.get('origin');
  if (origin && !allowedOrigin(origin)) return response(req, { error: 'origin' }, 403);
  if (req.method === 'OPTIONS') return response(req, {});
  if (req.method !== 'POST') return response(req, { error: 'method' }, 405);
  if (!/^Bearer [A-Za-z0-9_.-]+$/.test(req.headers.get('authorization') || '')) return response(req, { error: 'auth' }, 401);
  let body;
  try { body = await readBody(req); } catch { return response(req, { error: 'invalid_request' }, 400); }
  if (body.action === 'finish') {
    if (typeof body.key !== 'string' || !/^-?\d+(\.\d+)?,[-\d.]+,(3000|5000|10000|15000)$/.test(body.key)
      || typeof body.lease !== 'string' || !/^[a-f0-9-]{36}$/.test(body.lease)) return response(req, { error: 'invalid_request' }, 400);
    try {
      await rpc('petcare_finish_clinic_search', { p_key: body.key, p_lease: body.lease, p_payload: null,
        p_backoff: [403, 429].includes(body.status) ? 300 : body.status === 0 ? 30 : 2 });
      return response(req, { ok: true });
    } catch { return response(req, { error: 'directory_unavailable' }, 503); }
  }
  if (body.action !== 'reserve') return response(req, { error: 'invalid_request' }, 400);
  let { lat, lon, radius } = body;
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)
    || Math.abs(lat) > 85 || Math.abs(lon) > 180 || ![3000, 5000, 10000, 15000].includes(radius)) return response(req, { error: 'invalid_request' }, 400);
  lat = Number(lat.toFixed(3)); lon = Number(lon.toFixed(3));
  const key = lat + ',' + lon + ',' + radius;
  try {
    const grant = await rpc('petcare_reserve_clinic_search', { p_key: key });
    if (grant.cached) return response(req, { cached: grant.cached });
    if (grant.busy || !grant.lease) return response(req, { error: 'rate_limit' }, 429);
    const url = new URL(grant.endpoint);
    if (url.protocol !== 'https:') throw new Error('provider_configuration');
    const dy = (radius + 150) / 111320, dx = dy / Math.max(.08, Math.cos(lat * Math.PI / 180));
    Object.entries({ q: 'Veterinary Surgery', format: 'jsonv2',
      viewbox: [Math.max(-180, lon - dx), Math.min(90, lat + dy), Math.min(180, lon + dx), Math.max(-90, lat - dy)].join(','),
      bounded: '1', limit: '40', extratags: '1', addressdetails: '1', 'accept-language': 'ru'
    }).forEach(([k, v]) => url.searchParams.set(k, v));
    return response(req, { key, lease: grant.lease, url: url.href });
  } catch (error) {
    console.warn('Clinic search unavailable', { reason: error instanceof Error ? error.message : 'unknown' });
    return response(req, { error: 'directory_unavailable' }, 503);
  }
});
