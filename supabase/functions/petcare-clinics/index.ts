// Older clients must update to the built-in Yandex directory.
// This endpoint no longer grants requests to third-party directory APIs.
function allowedOrigin(origin: string) {
  if (origin === 'https://stormman745.github.io' || origin === 'null') return true;
  try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname); } catch { return false; }
}
Deno.serve(req => {
  const origin = req.headers.get('origin');
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'Vary': 'Origin', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type' });
  if (origin && allowedOrigin(origin)) headers.set('Access-Control-Allow-Origin', origin);
  if (origin && !allowedOrigin(origin)) return new Response('{}', { status: 403, headers });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  return new Response(JSON.stringify({ error: 'client_update_required', provider: 'yandex',
    message: 'Обновите приложение: поиск клиник теперь работает во встроенном справочнике Яндекс Карт.' }), { status: 410, headers });
});
