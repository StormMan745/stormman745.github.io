const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let handler;
vm.runInNewContext(fs.readFileSync('supabase/functions/petcare-clinic-sync/index.ts', 'utf8'), {
    Deno: { serve: callback => { handler = callback; } },
    Response,
});

(async () => {
    const response = await handler(new Request('https://edge.invalid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: 'previous-client', record: { kind: 'visit' } }),
    }));
    assert.equal(response.status, 410);
    assert.deepEqual(await response.json(), { error: 'clinic_sync_disabled' });
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    console.log('PASS: retired clinic receiver returns HTTP 410 without accessing the database.');
})().catch(error => { console.error(error); process.exitCode = 1; });
