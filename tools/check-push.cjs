const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const { transformSync } = require('esbuild');
const uid = '00000000-0000-4000-8000-000000000001', other = '00000000-0000-4000-8000-000000000002';
const endpoint = 'https://fcm.googleapis.com/fcm/send/synthetic-test';
const cronToken = 'synthetic-cron-token-01234567890123456789';
let active = true, quota = true, claim = 1, providerError = 0, sent = [], updates = [], removed = [], handler;
const rows = [{ user_id: uid, endpoint, subscription: { endpoint, keys: { p256dh: 'test', auth: 'test' } }, timezone_name: 'Europe/Moscow' }];
function query(table) {
  let filters = [], values, deletion = false;
  const q = { select: () => q, limit: () => q, maybeSingle: () => q,
    eq: (key, value) => { filters.push([key, value]); return q; },
    update: data => { values = data; return q; }, delete: () => { deletion = true; return q; },
    then: resolve => {
      if (values) updates.push({ values, filters });
      if (deletion) removed.push(filters);
      const found = rows.filter(row => filters.every(([key, value]) => row[key] === value));
      return Promise.resolve({ data: table === 'petcare_push_subscriptions' ? (filters.length ? found[0] || null : found) : null, error: null }).then(resolve);
    }
  }; return q;
}
const now = new Date(), local = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' }).format(now);
const admin = { auth: { getUser: async token => ({ data: { user: token === 'owner' ? { id: uid } : token === 'other' ? { id: other } : null }, error: null }) }, from: query,
  rpc: async name => ({ data: name === 'petcare_claim_push_delivery' ? claim : name === 'petcare_get_push_runtime_secrets' ? { cronToken, vapid: { subject: 'mailto:test@example.invalid', publicKey: 'public', privateKey: 'private' } } : [{ user_id: uid, reminders: [{ id: 'reminder', name: 'Synthetic reminder', date: local.slice(0, 10), time: local.slice(11, 16), repeat: 'once' }] }], error: null }) };
const runtime = { Request, Response, Headers, URL, TextEncoder, TextDecoder, Uint8Array, Date, Intl, crypto, btoa,
  console: { error() {} }, exports: {},
  Deno: { env: { get: key => ({ SUPABASE_URL: 'https://database.invalid', SUPABASE_SERVICE_ROLE_KEY: 'server-test-only' }[key]) }, serve: fn => handler = fn },
  require: name => name === '@supabase/supabase-js' ? { createClient: (_url, key) => key === 'server-test-only' ? admin : { rpc: async name => ({ data: name === 'petcare_account_active' ? active : { allowed: quota }, error: null }) } } : { sendNotification: async (subscription, payload, options) => { if (providerError) throw { statusCode: providerError }; sent.push({ subscription, payload: JSON.parse(payload), options }); } }
};
vm.runInNewContext(transformSync(fs.readFileSync('supabase/functions/petcare-push-reminders/index.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code, runtime);
const testRequest = (token = 'owner', body = { action: 'test', endpoint }, extra = {}) => new Request('https://app.invalid', {
  method: 'POST', headers: { origin: 'https://stormman745.github.io', apikey: 'public-test', authorization: 'Bearer ' + token, 'content-type': 'application/json', ...extra }, body: typeof body === 'string' ? body : JSON.stringify(body)
});
(async () => {
  const due = (reminder, date, zone = 'Europe/Moscow') => vm.runInNewContext('reminderIsDueNow', runtime)(reminder, new Date(date), zone);
  const reminder = { date: '2026-11-11', time: '23:59', repeat: 'once' };
  assert.equal(due(reminder, '2026-11-11T20:58:59Z'), null, 'Never send before the appointed time');
  assert.equal(due(reminder, '2026-11-11T21:02:00Z'), '2026-11-11', 'Catch up across local midnight');
  assert.equal(due(reminder, '2026-11-11T21:15:00Z'), null, 'Do not revive old reminders');
  assert.equal(due({ ...reminder, completed: true }, '2026-11-11T21:02:00Z'), null);
  assert.equal(due({ ...reminder, repeat: 'daily', completedDates: ['2026-11-11'] }, '2026-11-11T21:02:00Z'), null);
  assert.equal(due({ ...reminder, repeat: 'weekly' }, '2026-11-18T20:59:00Z'), '2026-11-18');
  assert.equal(due({ ...reminder, repeat: 'daily', endDate: '2026-11-10' }, '2026-11-11T20:59:00Z'), null);
  assert.equal((await handler(new Request('https://app.invalid', { method: 'POST' }))).status, 401);
  assert.equal((await handler(testRequest('bad'))).status, 401);
  active = false; assert.equal((await handler(testRequest())).status, 401); active = true;
  quota = false; assert.equal((await handler(testRequest())).status, 429); quota = true;
  assert.equal((await handler(testRequest('other'))).status, 404, 'Cannot test another account subscription');
  assert.equal((await handler(testRequest('owner', { action: 'test', endpoint: 'https://127.0.0.1/private' }))).status, 400);
  assert.equal((await handler(testRequest('owner', 'x'.repeat(4097)))).status, 413);
  assert.equal((await handler(testRequest('owner', {}, { origin: 'https://evil.invalid' }))).status, 403);
  assert.equal((await handler(testRequest('owner', '{'))).status, 400);
  const response = await handler(testRequest());
  assert.equal(response.status, 200); assert.equal((await response.json()).accepted, true); assert.equal(sent.length, 1);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://stormman745.github.io');
  assert.equal(sent[0].options.urgency, 'high'); assert.equal(sent[0].options.TTL, 300);
  claim = null; assert.equal((await handler(testRequest())).status, 429); assert.equal(sent.length, 1); claim = 1;
  providerError = 410; assert.equal((await handler(testRequest())).status, 410);
  assert.deepEqual(removed[0], [['user_id', uid], ['endpoint', endpoint]]); providerError = 0;
  const dispatched = await handler(new Request('https://app.invalid', { method: 'POST', headers: { 'x-petcare-cron-token': cronToken } }));
  assert.equal(dispatched.status, 200); assert.equal((await dispatched.json()).sent, 1);
  assert(updates.every(update => update.filters.some(([key]) => key === 'attempt_count')), 'Only the current delivery lease can update status');
  const events = new Map(), shown = [];
  vm.runInNewContext(fs.readFileSync('sw.js', 'utf8'), { self: { addEventListener: (name, fn) => events.set(name, fn), registration: { showNotification: async (title, options) => shown.push({ title, options }) } }, URL, Date });
  for (const payload of [{ title: 'Reminder', body: 'Test', tag: 'unique' }, null, []]) {
    let pending; events.get('push')({ data: { json: () => payload }, waitUntil: promise => pending = promise }); await pending;
  }
  assert.equal(shown.length, 3); assert.equal(shown[0].options.silent, false); assert.equal(shown[0].options.tag, 'unique');
  console.log('PASS: due time, midnight, recurrence, completed reminders; authenticated account-scoped push tests, rate limits, expired subscriptions, cron delivery leases, SW sound flags. Provider mocked.');
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
