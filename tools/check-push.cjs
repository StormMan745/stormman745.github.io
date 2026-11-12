const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const { transformSync } = require('esbuild');
const uid = '00000000-0000-4000-8000-000000000001', other = '00000000-0000-4000-8000-000000000002';
const endpoint = 'https://fcm.googleapis.com/fcm/send/synthetic-test';
const cronToken = 'synthetic-cron-token-01234567890123456789';
let active = true, quota = true, claim = 1, providerError = 0, sent = [], updates = [], removed = [], handler, schedule;
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
  rpc: async name => {
    if(name==='petcare_claim_push_delivery')return {data:claim,error:null};
    if(name==='petcare_get_push_runtime_secrets')return {data:{cronToken,vapid:{subject:'mailto:test@example.invalid',publicKey:'public',privateKey:'private'}},error:null};
    assert.equal(name,'petcare_get_push_schedule_data');
    return {data:schedule || [{ user_id: uid, reminders: [{ id: 'reminder', name: 'Synthetic reminder', date: local.slice(0, 10), time: local.slice(11, 16), repeat: 'once' }] }],error:null};
  } };
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
  assert.equal(due({ ...reminder, repeat: 'daily', endDate: null }, '2030-11-11T20:59:00Z'), '2030-11-11', 'Indefinite course reminders have no end-date cutoff');
  const pet={id:'pet-one',name:'Барни',dailyRoutinePush:{enabled:true,minutes:10},dailyRoutine:[{id:'walk',name:'Прогулка',time:'08:00',checks:5,times:['08:00','11:00','14:00','17:00','20:00']}]};
  const routine=(date,p=pet,completed=[],zone='Europe/Moscow')=>vm.runInNewContext('routinePushEvents',runtime)({pets:[p],completed_tasks:completed},new Date(date),zone);
  assert.equal(routine('2026-11-12T04:49:59Z').length,0);
  assert.equal(routine('2026-11-12T04:50:00Z')[0].ttl,600);
  assert.equal(routine('2026-11-12T04:59:59Z')[0].ttl,1);
  assert.equal(routine('2026-11-12T05:00:00Z').length,0,'Never send a daily advance alert at or after the event');
  const ids=[];
  for(let step=0;step<5;step++){
    const hour=String(4+step*3).padStart(2,'0'),event=routine(`2026-11-12T${hour}:50:00Z`)[0];
    assert(event);ids.push(event.id);assert.match(event.name,new RegExp(`${step+1} из 5`));
  }
  assert.equal(new Set(ids).size,5,'Every occurrence has an independent delivery key');
  assert.equal(routine('2026-11-12T07:50:00Z',pet,[{petId:'pet-one',date:'2026-11-12',id:'walk::check:2'}]).length,0);
  assert.equal(routine('2026-11-12T07:50:00Z',pet,[{petId:'other-pet',date:'2026-11-12',id:'walk::check:2'}]).length,1);
  for(const changed of [{dailyRoutinePush:undefined},{dailyRoutinePush:{enabled:false}},{isPlaceholder:true},{dailyRoutine:[]},{dailyRoutine:[{...pet.dailyRoutine[0],pushEnabled:false}]}])assert.equal(routine('2026-11-12T04:50:00Z',{...pet,...changed}).length,0);
  const midnight={...pet,dailyRoutine:[{id:'night',name:'Ночью',time:'00:05'}]};
  assert.equal(routine('2026-11-12T20:55:00Z',midnight)[0].date,'2026-11-13');
  assert.equal(routine('2026-11-12T20:55:00Z',midnight,[{petId:'pet-one',date:'2026-11-13',id:'night'}]).length,0);
  const spring={...pet,dailyRoutine:[{id:'dst',name:'DST',time:'03:05'}]};
  assert.equal(routine('2026-03-29T00:55:00Z',spring,[],'Europe/Berlin')[0].ttl,600);
  assert.equal(routine('2026-03-29T00:55:00Z',{...spring,dailyRoutine:[{id:'dst',name:'DST',time:'02:30'}]},[],'Europe/Berlin').length,0);
  assert.equal(routine('2026-11-12T07:50:00Z',pet,[],'invalid-zone').length,1,'Invalid device timezone safely falls back to UTC');
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
  const soon=new Date(Date.now()+9*60000),soonLocal=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',dateStyle:'short',timeStyle:'short'}).format(soon);
  schedule=[{user_id:uid,pets:[{...pet,dailyRoutine:[{id:'walk',name:'Прогулка',time:soonLocal.slice(11,16)}]}],reminders:[]}];
  let routineResponse=await handler(new Request('https://app.invalid',{method:'POST',headers:{'x-petcare-cron-token':cronToken}}));
  assert.equal((await routineResponse.json()).sent,1);assert.equal(sent.at(-1).payload.url,'/?page=home');assert.match(sent.at(-1).payload.body,/Скоро: Прогулка/);assert(sent.at(-1).options.TTL>0&&sent.at(-1).options.TTL<=600);
  claim=null;routineResponse=await handler(new Request('https://app.invalid',{method:'POST',headers:{'x-petcare-cron-token':cronToken}}));assert.equal((await routineResponse.json()).sent,0);claim=1;
  assert(updates.every(update => update.filters.some(([key]) => key === 'attempt_count')), 'Only the current delivery lease can update status');
  const events = new Map(), shown = [];
  vm.runInNewContext(fs.readFileSync('sw.js', 'utf8'), { self: { addEventListener: (name, fn) => events.set(name, fn), registration: { showNotification: async (title, options) => shown.push({ title, options }) } }, URL, Date });
  for (const payload of [{ title: 'Reminder', body: 'Test', tag: 'unique' }, null, []]) {
    let pending; events.get('push')({ data: { json: () => payload }, waitUntil: promise => pending = promise }); await pending;
  }
  assert.equal(shown.length, 3); assert.equal(shown[0].options.silent, false); assert.equal(shown[0].options.tag, 'unique');
  console.log('PASS: daily advance alerts, five separate times, opt-out, completions, midnight, DST and invalid timezone; normal recurrence, authenticated account-scoped tests, rate limits, expired subscriptions, cron delivery leases, SW sound flags. Provider mocked.');
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
