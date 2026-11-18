const assert = require('node:assert/strict');

module.exports = async function checkStorage({ page, context, profiles, uid, other }) {
    const reads = [];
    // Honor the PostgREST projection and count the response body bytes for a fixed profile.
    await context.route('**/rest/v1/petcare_data?**', async route => {
        const query = new URL(route.request().url()).searchParams;
        const row = profiles.get(query.get('user_id')?.replace(/^eq\./, ''));
        const fields = query.get('select').split(',');
        const body = JSON.stringify(row ? [Object.fromEntries(fields.map(field => [field, row[field]]))] : []);
        reads.push(Buffer.byteLength(body));
        await route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body });
    });
    await page.evaluate(async () => {
        await PetCareSync.flush();
        appData.testNote = 'a'.repeat(128 * 1024);
        appData.preferences.storageTest = true;
        await saveData();
        await PetCareFiles.flush();
    });
    const duplicateChars = await page.evaluate(() => (localStorage.getItem('petcareData:' + activeUserId) || '').length);
    let documentsReads = 0;
    page.on('request', request => {
        if (new URL(request.url()).pathname === '/rest/v1/petcare_documents') documentsReads++;
    });
    reads.length = 0;
    await page.evaluate(async () => {
        for (let i = 0; i < 2; i++) {
            await PetCareSync.flush();
            await PetCareFiles.flush();
        }
    });
    const profileBytes = reads.reduce((sum, size) => sum + size, 0);
    console.log(JSON.stringify({ idleChecks: 2, profileBytes, documentsReads, duplicateChars }));
    assert(reads.length >= 2 && profileBytes < 100, 'Unchanged accounts only transfer revision numbers');
    assert.equal(documentsReads, 0, 'An empty file queue must not fetch the whole document catalog');
    assert.equal(duplicateChars, 0, 'Private profile content is stored only in IndexedDB');

    // If a browser refuses the queue write, the original must roll back with it.
    const atomic = await page.evaluate(async () => {
        const uid = activeUserId, path = uid + '/storage-test/original.png';
        const key = uid + ':petcare-documents:' + path;
        const originalPut = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) {
            if (this.name === 'outbox') throw new DOMException('Test quota', 'QuotaExceededError');
            return originalPut.apply(this, args);
        };
        let refused = false;
        try {
            await PetCareFiles.putDocument({ id: 'storage-test', user_id: uid, storage_path: path }, new Blob(['original']));
        } catch { refused = true; }
        finally { IDBObjectStore.prototype.put = originalPut; }
        return { refused, file: Boolean(await PetCareSync.get('files', key)),
            job: Boolean(await PetCareSync.get('outbox', uid + ':document-put:storage-test')) };
    });
    assert.deepEqual(atomic, { refused: true, file: false, job: false });

    // Pause a cache hit just before it resolves, then switch accounts.
    const leaked = await page.evaluate(async ({ uid, other }) => {
        const path = uid + '/storage-test/cached.png';
        await PetCareFiles.cache(uid, 'petcare-documents', path, new Blob(['private original']));
        const get = PetCareSync.get;
        let resume, entered;
        const gate = new Promise(resolve => { resume = resolve; });
        const reading = new Promise(resolve => { entered = resolve; });
        PetCareSync.get = async function (name, key) {
            const result = await get(name, key);
            if (name === 'files') { entered(); await gate; }
            return result;
        };
        try {
            const pending = PetCareFiles.download('petcare-documents', path, uid);
            await reading;
            resetActiveAccountData();
            activeUserId = other;
            resume();
            return await pending.then(() => true, () => false);
        } finally { PetCareSync.get = get; }
    }, { uid, other });
    assert.equal(leaked, false, 'A file opened before sign-out cannot be returned to a new account');

    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await context.setOffline(true);
    const offline = await page.evaluate(async () => {
        const bundle = document.querySelector('script[src*="app.bundle.js"]').src;
        const asset = await fetch(bundle);
        const cache = await caches.open((await caches.keys()).find(name => name.startsWith('petcare-shell-')));
        return { cached: Boolean(await cache.match(bundle)), usable: asset.ok && (await asset.text()).includes('PetCareSync'),
            cachedPrivateUrl: (await cache.keys()).some(req => new URL(req.url).searchParams.has('access_token')) };
    });
    assert.deepEqual(offline, { cached: true, usable: true, cachedPrivateUrl: false });

    const migrated = await page.evaluate(async ({ uid, other }) => {
        const key = 'petcareData:' + other, legacy = { pets: [], note: 'saved on the previous version' };
        localStorage.setItem(key, JSON.stringify(legacy));
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (...args) {
            if (this.name === 'profiles') throw new DOMException('Test quota', 'QuotaExceededError');
            return put.apply(this, args);
        };
        let keptOriginal;
        try { await PetCareSync.load(other, legacy); }
        catch { keptOriginal = Boolean(localStorage.getItem(key)); }
        finally { IDBObjectStore.prototype.put = put; }
        const restored = await PetCareSync.load(other, legacy);
        const retired = localStorage.getItem(key) === null;
        const refusedPurge = !await PetCareSync.purge(other, { onlyIfSynced: true });
        const pending = (await PetCareSync.get('profiles', other))?.pending;
        await PetCareSync.purge(other);
        const originalAccount = Boolean(await PetCareSync.get('profiles', uid));
        return { keptOriginal, restored: restored.note === legacy.note, retired, refusedPurge, pending, originalAccount };
    }, { uid, other });
    assert.deepEqual(migrated, { keptOriginal: true, restored: true, retired: true, refusedPurge: true, pending: true, originalAccount: true });
    console.log('PASS: transfer size, atomic file writes, account isolation, offline shell and lossless legacy migration.');
};
