const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('../.tools/preview/node_modules/playwright');

(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('dialog', dialog => dialog.accept());
        await page.route('https://**', route => route.abort());
        await page.addInitScript(() => {
            const state = window.documentTest = { rows: [], files: {}, failUpload: false, failInsert: false, uncertainInsert: false, failDelete: false, failSelect: false, delayUpload: false, calls: [] };
            const client = {
                auth: { getUser: async () => ({ data: { user: null } }), onAuthStateChange() {} },
                from(table) {
                    let operation = 'select', payload, single = false;
                    const filters = [];
                    const builder = {
                        select() { return this; },
                        eq(key, value) { filters.push([key, value]); return this; },
                        order() { return this; },
                        insert(value) { operation = 'insert'; payload = value; return this; },
                        update(value) { operation = 'update'; payload = value; return this; },
                        delete() { operation = 'delete'; return this; },
                        upsert() { return this; },
                        single() { single = true; return this; },
                        maybeSingle() { single = true; return this; },
                        then(resolve, reject) {
                            return Promise.resolve().then(() => {
                                state.calls.push([table, operation, filters]);
                                if (table !== 'petcare_documents') return { data: [], error: null };
                                if (operation === 'select' && state.failSelect) return { error: new Error('network') };
                                if (operation === 'insert' && state.failInsert) return { error: new Error('insert failed') };
                                if (operation === 'delete' && state.failDelete) return { error: new Error('delete failed') };
                                let matches = state.rows.filter(row => filters.every(([key, value]) => row[key] === value));
                                if (operation === 'insert') { state.rows.push({ ...payload }); matches = [payload]; }
                                if (operation === 'update') matches.forEach(row => Object.assign(row, payload));
                                if (operation === 'delete') state.rows = state.rows.filter(row => !matches.includes(row));
                                if (operation === 'insert' && state.uncertainInsert) return { error: new Error('response lost') };
                                return { data: single ? matches[0] || null : matches.map(row => ({ ...row })), error: null };
                            }).then(resolve, reject);
                        }
                    };
                    return builder;
                },
                storage: { from() { return {
                    async upload(filePath, file) {
                        if (state.delayUpload) await new Promise(resolve => { state.finishUpload = resolve; });
                        if (state.failUpload) return { error: new Error('upload failed') };
                        state.files[filePath] = file; return { data: { path: filePath } };
                    },
                    async remove(paths) { paths.forEach(filePath => delete state.files[filePath]); return { error: null }; },
                    async download(filePath) { return { data: state.files[filePath] || new Blob(['%PDF-1.4\n']), error: null }; },
                    async createSignedUrl(filePath) { return { data: { signedUrl: `https://qexiyikdmdbdxgusqnee.supabase.co/storage/v1/object/sign/petcare-documents/${filePath}?token=test` } }; }
                }; } }
            };
            Object.defineProperty(window, 'supabase', { get: () => ({ createClient: () => client }), set() {}, configurable: true });
        });
        await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
        await page.waitForFunction(() => window.PetCareDocuments);
        await page.evaluate(async () => {
            activeUserId = 'a1000000-0000-4000-8000-000000000001';
            appData = createInitialAppData();
            appData.pets = [{ id: 'pet-one', name: 'Барни', animal: '🐶' }, { id: 'pet-two', name: 'Мурка', animal: '🐱' }];
            appData.pet = appData.pets[0]; appData.activePetId = 'pet-one';
            appData.healthRecords = [{ id: 'visit-one', petId: 'pet-one', name: 'Приём у терапевта', type: 'Ветеринар', date: '2026-10-30', diagnosis: 'Запись врача', prescription: 'Назначения врача', clinic: 'Клиника' }];
            normalizeAppData(); showHealth();
            document.querySelector('.bottom-menu').style.display = 'flex';
            await PetCareDocuments.open('visit-one');
        });
        const pdf = { name: 'Анализ.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF') };
        const prepare = async (file = pdf) => {
            await page.evaluate(() => { document.getElementById('documentEditor').open = true; });
            await page.locator('#documentFile').setInputFiles(file);
            await page.locator('#documentTitle').fill('Анализ крови');
            await page.locator('#documentCategory').selectOption('analysis');
        };
        const save = async () => {
            await page.locator('#documentSave').click();
            await page.waitForFunction(() => document.getElementById('documentUploadForm').getAttribute('aria-busy') === 'false');
        };
        await prepare();
        await save();
        assert.equal(await page.locator('.document-card').count(), 1);
        assert.match(await page.locator('.document-group').innerText(), /Приём у терапевта.*Запись врача.*Назначения врача/s);
        assert.equal(await page.evaluate(() => documentTest.rows[0].record_id), 'visit-one');
        assert.equal(await page.evaluate(() => Object.keys(documentTest.files).length), 1);
        await page.locator('[data-document-action="edit"]').click();
        await page.locator('#documentTitle').fill('Скан ветпаспорта');
        await page.locator('#documentCategory').selectOption('passport');
        await page.locator('#documentRecord').selectOption('');
        await save();
        assert.equal(await page.evaluate(() => documentTest.rows[0].record_id), null);
        await page.locator('#documentRecordFilter').selectOption('');
        assert.match(await page.locator('.document-group h3').innerText(), /без медицинской/);
        await page.locator('#documentSearch').fill('несуществующее');
        assert.equal(await page.locator('.document-card').count(), 0);
        await page.locator('#documentSearch').fill('паспорт');
        assert.equal(await page.locator('.document-card').count(), 1);
        const downloadEvent = page.waitForEvent('download');
        await page.locator('[data-document-action="download"]').click();
        assert.equal((await downloadEvent).suggestedFilename(), 'Анализ.pdf');
        await page.waitForFunction(() => !document.getElementById('documentSave').disabled);
        const popupEvent = page.waitForEvent('popup');
        await page.locator('[data-document-action="open"]').click();
        const popup = await popupEvent;
        await popup.waitForURL(/supabase\.co/).catch(() => {});
        await popup.close();
        await page.waitForFunction(() => !document.getElementById('documentSave').disabled);
        await page.locator('#documentSearch').fill('');
        await prepare({ name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('<html>not a PDF</html>') });
        await save();
        assert.match(await page.locator('#documentStatus').innerText(), /не распознан/);
        assert.equal(await page.evaluate(() => documentTest.rows.length), 1);
        await prepare({ name: 'big.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
        await save();
        assert.match(await page.locator('#documentStatus').innerText(), /до 10 МБ/);
        await prepare();
        await page.evaluate(() => { documentTest.failUpload = true; });
        await save();
        assert.match(await page.locator('#documentStatus').innerText(), /Файл не загружен/);
        await page.evaluate(() => { documentTest.failUpload = false; documentTest.failInsert = true; });
        await save();
        assert.match(await page.locator('#documentStatus').innerText(), /Документ не сохранён/);
        assert.equal(await page.evaluate(() => Object.keys(documentTest.files).length), 1, 'Failed insert must clean up its file');
        await page.evaluate(() => { documentTest.failInsert = false; documentTest.uncertainInsert = true; });
        await save();
        assert.equal(await page.evaluate(() => documentTest.rows.length), 2);
        assert.equal(await page.evaluate(() => Object.keys(documentTest.files).length), 2, 'Lost INSERT response must not delete a committed file');
        await page.evaluate(() => { documentTest.uncertainInsert = false; });
        // Reload the module's view from the remote metadata, then switch pets.
        await page.evaluate(async () => { await PetCareDocuments.open(); });
        assert.equal(await page.locator('.document-card').count(), 2);
        await page.evaluate(() => { appData.pet = appData.pets[1]; appData.activePetId = 'pet-two'; PetCareDocuments.refreshPet(); });
        await page.waitForFunction(() => document.getElementById('documentCount').textContent === 'Документов: 0 из 0');
        assert.equal(await page.locator('#documentFile').inputValue(), '');
        // A late upload must not attach a file to the pet selected meanwhile.
        await prepare();
        await page.evaluate(() => { documentTest.delayUpload = true; });
        await page.locator('#documentSave').click();
        await page.waitForFunction(() => typeof documentTest.finishUpload === 'function');
        await page.evaluate(() => { appData.pet = appData.pets[0]; appData.activePetId = 'pet-one'; PetCareDocuments.refreshPet(); documentTest.finishUpload(); });
        await page.waitForFunction(() => !document.getElementById('documentSave').disabled);
        assert.equal(await page.evaluate(() => documentTest.rows.length), 2);
        assert.equal(await page.evaluate(() => Object.keys(documentTest.files).length), 2);
        await page.evaluate(() => { documentTest.delayUpload = false; });
        await page.waitForFunction(() => document.querySelectorAll('.document-card').length === 2);
        await page.locator('[data-document-action="delete"]').first().click();
        await page.waitForFunction(() => !document.getElementById('documentSave').disabled);
        assert.equal(await page.locator('.document-card').count(), 1);
        assert.equal(await page.evaluate(() => appData.healthRecords.length), 1);
        await page.evaluate(() => { documentTest.failSelect = true; });
        await page.locator('[data-document-action="refresh"]').click();
        await page.waitForFunction(() => document.getElementById('documentStatus').dataset.kind === 'error');
        assert.match(await page.locator('#documentStatus').innerText(), /Не удалось загрузить/);
        await page.evaluate(() => { documentTest.failSelect = false; });
        await page.locator('[data-document-action="refresh"]').click();
        await page.waitForFunction(() => document.getElementById('documentStatus').textContent === '');
        await prepare({ name: 'Скан.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3FoAAAAASUVORK5CYII=', 'base64') });
        await page.locator('#documentTitle').fill('Ветпаспорт — страница 1');
        await save();
        assert.equal(await page.evaluate(() => documentTest.rows.find(row => row.file_name === 'Скан.png').mime_type), 'image/png');
        assert.equal(await page.locator('.document-card').count(), 2);
        await page.evaluate(() => { document.getElementById('documentEditor').open = true; });
        for (const width of [320, 390, 1280]) {
            await page.setViewportSize({ width, height: 900 });
            const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }));
            assert.ok(dimensions.scroll <= dimensions.viewport, `Overflow at ${width}px`);
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.evaluate(() => { document.getElementById('documentEditor').open = false; });
        await page.screenshot({ path: path.resolve(__dirname, '../.tools/documents-mobile.png'), fullPage: true });
        // Pet deletion cleans only that pet's document metadata and file objects.
        await page.evaluate(async () => { await PetCareDocuments.removePet('pet-two', activeUserId); });
        assert.equal(await page.evaluate(() => documentTest.rows.length), 2);
        await page.evaluate(async () => { await PetCareDocuments.removePet('pet-one', activeUserId); await PetCareDocuments.open(); });
        assert.equal(await page.locator('.document-card').count(), 0);
        assert.equal(await page.evaluate(() => Object.keys(documentTest.files).length), 0);
        await page.evaluate(() => { resetActiveAccountData(); });
        assert.equal(await page.locator('.document-card').count(), 0);
        assert.deepEqual(errors, []);
        console.log('PASS: PDF upload, visit details, metadata edit/unlink, filters, download/open, invalid/oversized file rejection, network failures, upload rollback, uncertain commit recovery, pet isolation, late upload cleanup, deletion, account reset, 320/390/1280 layout.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
