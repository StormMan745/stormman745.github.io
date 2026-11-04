// Private medical documents. File contents never enter localStorage or the assistant context.
(() => {
    const TABLE = 'petcare_documents';
    const BUCKET = 'petcare-documents';
    const LIMIT = 10 * 1024 * 1024;
    const categories = { passport: 'Ветпаспорт', analysis: 'Результаты анализов', conclusion: 'Заключение врача', prescription: 'Назначения', other: 'Другое' };
    let rows = [];
    let context = null;
    let generation = 0;
    let loadSequence = 0;
    let busy = false;
    let editingId = null;
    let returnPage = 'healthPage';
    const printWindows = new Set();
    const el = id => document.getElementById(id);
    const current = ctx => ctx && ctx === context && ctx.userId === activeUserId && ctx.petId === getActivePetKey();
    const records = () => appData.healthRecords.filter(record => String(record.petId) === getActivePetKey());
    const findRecord = id => records().find(record => String(record.id) === String(id));
    const fileSize = size => size < 1024 * 1024 ? `${Math.ceil(size / 1024)} КБ` : `${(size / (1024 * 1024)).toFixed(1)} МБ`;

    function status(message, error = false) {
        el('documentStatus').textContent = message;
        el('documentStatus').dataset.kind = error ? 'error' : 'info';
    }

    function node(tag, className, text) {
        const item = document.createElement(tag);
        if (className) item.className = className;
        if (text != null) item.textContent = text;
        return item;
    }

    function button(label, action, id) {
        const item = node('button', 'document-button', label);
        item.type = 'button';
        item.dataset.documentAction = action;
        if (id) item.dataset.documentId = id;
        item.disabled = busy;
        return item;
    }

    function setBusy(value) {
        busy = value;
        el('documentUploadForm').setAttribute('aria-busy', String(value));
        el('documentUploadForm').querySelectorAll('input, select, button').forEach(control => { control.disabled = value; });
        el('documentsPage').querySelectorAll('[data-document-id]').forEach(control => { control.disabled = value; });
        el('documentSave').textContent = value ? 'Сохраняю…' : editingId ? 'Сохранить изменения' : 'Загрузить документ';
    }

    function populateRecords(selected = '') {
        const options = [...records()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
        const filter = el('documentRecordFilter');
        const filterValue = filter.value;
        el('documentRecord').replaceChildren(new Option('Без привязки', ''));
        filter.replaceChildren(new Option('Все записи', ''), new Option('Без привязки', 'unlinked'));
        options.forEach(record => {
            const label = `${formatHistoryDate(record.date)} · ${record.name}`;
            el('documentRecord').append(new Option(label, String(record.id)));
            filter.append(new Option(label, String(record.id)));
        });
        el('documentRecord').value = options.some(record => String(record.id) === selected) ? selected : '';
        filter.value = filterValue === 'unlinked' || options.some(record => String(record.id) === filterValue) ? filterValue : '';
    }

    function resetEditor(recordId = '') {
        editingId = null;
        el('documentUploadForm').reset();
        el('documentDate').value = getLocalDateInputValue();
        el('documentFile').hidden = false;
        el('documentFile').required = true;
        el('documentFileHint').textContent = 'Один файл до 10 МБ. PDF, JPEG, PNG или WebP. Оригинал сохраняется без уменьшения качества.';
        el('documentEditorTitle').textContent = '＋ Добавить документ';
        populateRecords(recordId);
        setBusy(busy);
    }

    function resetContext() {
        printWindows.forEach(popup => { if (!popup.closed) popup.close(); });
        printWindows.clear();
        generation += 1;
        loadSequence += 1;
        context = activeUserId && appData.pet && !appData.pet.isPlaceholder
            ? { userId: activeUserId, petId: getActivePetKey(), generation } : null;
        rows = [];
        el('documentSearch').value = '';
        el('documentTypeFilter').value = '';
        el('documentRecordFilter').value = '';
        resetEditor();
        el('documentEditor').open = false;
        el('documentsList').replaceChildren();
        el('documentCount').textContent = '';
        status('');
    }

    async function load() {
        const ctx = context;
        if (!current(ctx)) return;
        const sequence = ++loadSequence;
        status('Загружаю документы…');
        try {
            const data = await PetCareFiles.documentRows(ctx.userId); const error = null;
            if (!current(ctx) || sequence !== loadSequence) return;
            if (error) throw error;
            rows = (data || []).filter(row => row.user_id === ctx.userId && row.pet_id === ctx.petId);
            render();
            status('');
        } catch (error) {
            if (current(ctx) && sequence === loadSequence) status('Не удалось загрузить документы. Проверьте интернет и нажмите «Обновить».', true);
        }
    }

    function render() {
        const list = el('documentsList');
        list.replaceChildren();
        const query = el('documentSearch').value.trim().toLocaleLowerCase('ru-RU');
        const type = el('documentTypeFilter').value;
        const recordFilter = el('documentRecordFilter').value;
        const filtered = rows.filter(row => {
            const record = findRecord(row.record_id);
            const text = [row.title, row.file_name, categories[row.category], record?.name, record?.clinic, record?.diagnosis].filter(Boolean).join(' ').toLocaleLowerCase('ru-RU');
            return (!query || text.includes(query)) && (!type || row.category === type)
                && (!recordFilter || (recordFilter === 'unlinked' ? !record : row.record_id === recordFilter));
        });
        el('documentCount').textContent = `Документов: ${filtered.length} из ${rows.length}`;
        if (!filtered.length) {
            list.append(node('p', 'empty-state', rows.length ? 'По этим фильтрам документы не найдены.' : 'Документов пока нет. Добавьте ветпаспорт, результаты анализов или заключение врача.'));
            return;
        }
        const groups = new Map();
        filtered.forEach(row => {
            const key = findRecord(row.record_id) ? row.record_id : '';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(row);
        });
        groups.forEach((items, recordId) => {
            const group = node('article', 'document-group');
            const record = findRecord(recordId);
            group.append(node('h3', '', record ? record.name : 'Документы без медицинской записи'));
            if (record) {
                group.append(node('p', 'document-meta', `${record.type} · ${formatHistoryDate(record.date)}`));
                appendHealthRecordDetails(group, record);
                if (record.note) group.append(node('p', 'document-note', record.note));
            }
            items.forEach(row => {
                const card = node('div', 'document-card');
                const info = node('div', 'document-card-info');
                info.append(node('strong', '', row.title), node('small', '', `${categories[row.category] || 'Документ'} · ${formatHistoryDate(row.document_date)}`), node('small', 'document-filename', `${row.file_name} · ${fileSize(row.file_size)}`));
                if (row.record_id && !record) info.append(node('small', '', 'Медицинская запись удалена. Документ сохранён.'));
                const actions = node('div', 'document-actions');
                actions.append(button('Печать', 'print', row.id), button('Открыть ↗', 'open', row.id), button('Скачать', 'download', row.id), button('Изменить', 'edit', row.id), button('Удалить', 'delete', row.id));
                if(row.pending)info.append(node('small','','Ожидает отправки'));
                if(row.pendingConflict)actions.prepend(button('Разобрать конфликт','resolve-sync',row.id));
                card.append(node('span', 'document-file-icon', row.mime_type === 'application/pdf' ? 'PDF' : 'СКАН'), info, actions);
                group.append(card);
            });
            list.append(group);
        });
    }

    async function open(recordId = '') {
        if (!activeUserId || !appData.pet || appData.pet.isPlaceholder) { alert('Войдите в аккаунт и выберите питомца.'); return; }
        const previous = [...document.querySelectorAll('.page')].find(page => page.offsetParent);
        if (previous && previous.id !== 'documentsPage') returnPage = previous.id;
        if (!current(context)) resetContext();
        hideAllPages();
        el('documentsPage').style.display = 'block';
        markActiveNavigation(returnPage === 'petPage' ? 'nav-pet' : 'nav-health');
        renderPetSwitcher();
        if (!busy) resetEditor(recordId);
        el('documentRecordFilter').value = findRecord(recordId) ? String(recordId) : '';
        if (recordId) el('documentEditor').open = true;
        await load();
    }

    function close() {
        if (returnPage === 'entryHistoryPage') {
            hideAllPages();
            el('entryHistoryPage').style.display = 'block';
            markActiveNavigation('nav-health');
            renderPetSwitcher();
            renderEventHistory();
        } else if (returnPage === 'petPage') showPet();
        else showHealth();
    }

    async function inspectFile(file) {
        if (!file || !file.size || file.size > LIMIT) throw new Error('Выберите непустой файл размером до 10 МБ.');
        const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
        const ascii = String.fromCharCode(...bytes);
        let mime, extension;
        if (ascii.startsWith('%PDF-') && /\.pdf$/i.test(file.name)) [mime, extension] = ['application/pdf', 'pdf'];
        else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && /\.jpe?g$/i.test(file.name)) [mime, extension] = ['image/jpeg', 'jpg'];
        else if ([137,80,78,71,13,10,26,10].every((value, i) => bytes[i] === value) && /\.png$/i.test(file.name)) [mime, extension] = ['image/png', 'png'];
        else if (ascii.startsWith('RIFF') && ascii.slice(8) === 'WEBP' && /\.webp$/i.test(file.name)) [mime, extension] = ['image/webp', 'webp'];
        else throw new Error('Формат файла не распознан. Выберите PDF, JPEG, PNG или WebP.');
        return { mime, extension };
    }

    function safePath(row, userId) {
        return typeof row.storage_path === 'string' && row.storage_path.startsWith(`${userId}/${row.id}/`)
            && !row.storage_path.split('/').some(part => part === '..' || part === '.');
    }

    async function save(event) {
        event.preventDefault();
        if (busy || !current(context) || !el('documentUploadForm').reportValidity()) return;
        const ctx = context;
        const editId = editingId;
        const file = el('documentFile').files[0];
        const fields = { title: el('documentTitle').value.trim(), category: el('documentCategory').value,
            document_date: el('documentDate').value, record_id: el('documentRecord').value || null };
        if (!fields.title) { status('Укажите название документа.', true); return; }
        if (fields.record_id && !findRecord(fields.record_id)) { status('Выберите медицинскую запись этого питомца.', true); return; }
        setBusy(true);
        status(editId ? 'Сохраняю изменения…' : 'Загружаю оригинал…');
        try {
            if (editId) {
                const row=rows.find(r=>r.id===editId);
                if(!row)throw new Error('Документ не найден. Обновите список.');
                await PetCareFiles.editDocument(row,fields);
            } else {
                const {mime,extension}=await inspectFile(file);
                if(!current(ctx))return;
                const id=crypto.randomUUID();
                const row={...fields,id,user_id:ctx.userId,pet_id:ctx.petId,file_name:file.name.slice(0,255),mime_type:mime,file_size:file.size,storage_path:ctx.userId+'/'+id+'/original.'+extension};
                await PetCareFiles.putDocument(row,file);
                if(current(ctx)){appData.preferences={...appData.preferences,documentAdded:true};saveData().catch(()=>{});}
            }
            if (!current(ctx)) return;
            resetEditor();
            el('documentEditor').open = false;
            await load();
            if (current(ctx) && el('documentStatus').dataset.kind !== 'error') status(await PetCareFiles.pending(ctx.userId) ? 'Сохранено на устройстве. Ожидает отправки при появлении связи.' : 'Документ сохранён в аккаунте.');
        } catch (error) {
            if (current(ctx)) status(error.message || 'Не удалось сохранить документ. Повторите попытку.', true);
        } finally { setBusy(false); }
    }

    function edit(row) {
        resetEditor(row.record_id || '');
        editingId = row.id;
        el('documentTitle').value = row.title;
        el('documentCategory').value = row.category;
        el('documentDate').value = row.document_date;
        el('documentFile').hidden = true;
        el('documentFile').required = false;
        el('documentFileHint').textContent = `Файл: ${row.file_name}. Чтобы заменить оригинал, загрузите новый документ.`;
        el('documentEditorTitle').textContent = 'Изменить документ';
        el('documentEditor').open = true;
        setBusy(false);
        el('documentEditor').scrollIntoView({ block: 'start', behavior: 'instant' });
        el('documentTitle').focus({ preventScroll: true });
    }

    async function readFile(row, download) {
        if (window.PetCareNative) return readNativeFile(row, download ? 'share' : 'open');
        const ctx = context;
        const popup = download ? null : window.open('about:blank', '_blank');
        if (popup) popup.opener = null;
        if (popup) printWindows.add(popup);
        if (!download && !popup) { status('Разрешите открытие новой вкладки или нажмите «Скачать».', true); return; }
        setBusy(true);
        status(download ? 'Подготавливаю скачивание…' : 'Открываю документ…');
        try {
            if (download) {
                const { data, error } = await supabaseClient.storage.from(BUCKET).download(row.storage_path);
                if (error) throw error;
                if (!current(ctx)) return;
                const url = URL.createObjectURL(data);
                const link = document.createElement('a');
                link.href = url;
                link.download = row.file_name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
                document.body.append(link);
                link.click();
                link.remove();
                setTimeout(() => URL.revokeObjectURL(url), 60000);
            } else {
                const {data,error}=await supabaseClient.storage.from(BUCKET).download(row.storage_path);
                if(error||!data)throw error||new Error('Файл не загружен.');
                if(!current(ctx)){popup.close();return;}
                const url=URL.createObjectURL(new Blob([data],{type:row.mime_type}));
                popup.location.replace(url);
                setTimeout(()=>URL.revokeObjectURL(url),60000);
            }
            if (current(ctx)) status('');
        } catch {
            popup?.close();
            if (current(ctx)) status('Не удалось открыть файл. Проверьте интернет и попробуйте ещё раз.', true);
        } finally { setBusy(false); }
    }

    async function printFile(row) {
        if (window.PetCareNative) return readNativeFile(row, 'print');
        const ctx = context;
        const localFile = window.location.protocol === 'file:';
        const popup = window.open(localFile ? '' : new URL('document-print.html', window.location.href).href, '_blank');
        if (!popup) { status('Разрешите открытие новой вкладки для предварительного просмотра и печати.', true); return; }
        popup.opener = null;
        if (localFile) {
            // A navigated file:// tab has a separate opaque origin in Chrome.
            // A blank tab inherits our origin; only static markup is written here.
            const doc = popup.document;
            doc.open();
            doc.write('<!DOCTYPE html><html lang="ru"><head></head><body></body></html>');
            doc.documentElement.lang = 'ru';
            doc.head.innerHTML = '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Печать документа — PetCare</title>';
            const css = doc.createElement('link'); css.rel = 'stylesheet'; css.href = new URL('document-print.css?v=20261104', window.location.href).href; doc.head.append(css);
            doc.body.innerHTML = '<header class="print-toolbar"><div><span class="print-brand">PetCare · Документы</span><h1 id="printTitle">Подготовка документа</h1><p id="printStatus" role="status">Загружаю оригинал…</p></div><div class="print-actions"><button type="button" id="printButton" disabled>Печатать</button><a id="printOriginal" hidden target="_blank" rel="noopener noreferrer">Открыть оригинал ↗</a></div><p class="print-hint">В окне печати можно выбрать страницы, принтер или сохранение в PDF.</p></header><main id="printPages" aria-label="Страницы документа" aria-busy="true"></main>';
            doc.close();
            // Local popup scripts may be blocked by the browser's file-origin
            // policy. Load the controller in the original tab, then initialise
            // the isolated print view without weakening that policy.
            const initialise = () => {
                if (popup.closed || !current(ctx)) { popup.close(); return; }
                popup.PetCareDocumentPrint = window.PetCareCreateDocumentPrint(popup, document);
            };
            if (window.PetCareCreateDocumentPrint) initialise();
            else {
                const script = document.createElement('script');
                script.src = 'document-print.bundle.js?v=20261104'; script.onload = initialise;
                document.head.append(script);
            }
        }
        printWindows.forEach(item => { if (item.closed) printWindows.delete(item); });
        printWindows.add(popup);
        setBusy(true);
        status('Подготавливаю документ к печати…');
        try {
            const ready = new Promise((resolve, reject) => {
                const started = Date.now();
                const timer = setInterval(() => {
                    try {
                        if (!current(ctx) || popup.closed) { clearInterval(timer); reject(new Error('Просмотр закрыт.')); }
                        else if (popup.PetCareDocumentPrint) { clearInterval(timer); resolve(); }
                        else if (Date.now() - started > 20000) { clearInterval(timer); reject(new Error('Не удалось открыть просмотр печати. Обновите приложение и повторите попытку.')); }
                    } catch { clearInterval(timer); reject(new Error('Не удалось открыть просмотр печати.')); }
                }, 100);
            });
            const [result] = await Promise.all([supabaseClient.storage.from(BUCKET).download(row.storage_path), ready]);
            if (result.error || !result.data) throw new Error('Не удалось загрузить оригинал. Проверьте интернет и повторите печать.');
            if (!current(ctx) || popup.closed) { popup.close(); return; }
            await popup.PetCareDocumentPrint.prepare(result.data, { title: row.title, mime: row.mime_type });
            if (!current(ctx)) { popup.close(); return; }
            if (!popup.closed) status('Просмотр открыт в отдельной вкладке. Нажмите «Печатать» и выберите принтер или сохранение в PDF.');
        } catch (error) {
            popup.close();
            if (current(ctx)) status(error.message || 'Не удалось подготовить документ к печати.', true);
        } finally { setBusy(false); }
    }

    async function readNativeFile(row, action) {
        const ctx = context;
        setBusy(true);
        status('Подготавливаю документ…');
        try {
            const { data, error } = await supabaseClient.storage.from(BUCKET).download(row.storage_path);
            if (error || !data) throw error || new Error('No document');
            if (!current(ctx)) return;
            await window.PetCareNative.shareFile(data, row.file_name, action);
            if (current(ctx)) status('');
        } catch {
            if (current(ctx)) status('Не удалось открыть документ. Проверьте подключение и наличие приложения для просмотра.', true);
        } finally { setBusy(false); }
    }

    async function remove(row) {
        if(!confirm('Убрать документ «'+row.title+'»? Его можно восстановить в разделе «Мои данные» в течение 30 дней.'))return;
        const ctx=context;setBusy(true);
        try{await PetCareFiles.deleteDocument(row);if(!current(ctx))return;if(editingId===row.id)resetEditor();await load();status('Документ перемещён в корзину.');}
        catch(error){if(current(ctx))status(error.message||'Не удалось сохранить удаление.',true)}finally{setBusy(false)}
    }
    async function removePet(petId,userId) {
        if(busy)throw new Error('Дождитесь окончания операции с документом.');
        await PetCareFiles.removePet(petId,userId);
    }

    el('documentUploadForm').addEventListener('submit', save);
    el('documentFile').addEventListener('change', () => {
        const file = el('documentFile').files[0];
        if (file && !el('documentTitle').value.trim()) el('documentTitle').value = file.name.replace(/\.[^.]+$/, '').slice(0, 160);
    });
    el('documentSearch').addEventListener('input', render);
    ['documentTypeFilter', 'documentRecordFilter'].forEach(id => el(id).addEventListener('change', render));
    el('documentsPage').addEventListener('click', event => {
        const control = event.target.closest('[data-document-action]');
        if (!control) return;
        const action = control.dataset.documentAction;
        if (action === 'close') { close(); return; }
        if (busy) return;
        if (action === 'refresh') { load(); return; }
        if (action === 'cancel') { resetEditor(); el('documentEditor').open = false; return; }
        if (!current(context)) return;
        const row = rows.find(item => item.id === control.dataset.documentId && item.user_id === context.userId && item.pet_id === context.petId);
        if (!row || !safePath(row, context.userId)) return;
        if (action === 'edit') edit(row);
        else if(action==='resolve-sync')window.PetCareCare?.resolveDocument(row.id);
        else if (action === 'print') printFile(row);
        else if (action === 'open' || action === 'download') readFile(row, action === 'download');
        else if (action === 'delete') remove(row);
    });
    window.addEventListener('petcare:files-changed',()=>{if(current(context)&&el('documentsPage').style.display==='block'&&!busy)load();});
    window.addEventListener('petcare:account-reset', () => { resetContext(); context = null; });
    window.PetCareDocuments = {
        open, removePet,
        refreshPet() {
            if (context && !current(context)) resetContext();
            if (el('documentsPage').style.display === 'block') { if (!context) resetContext(); load(); }
        }
    };
})();
