// This isolated page holds document bytes only in memory until its tab closes.
((host) => {
    const assetBase = new URL('.', document.currentScript.src);
    function create(view, resourceDocument = view.document) {
    const window = view;
    const document = view.document;
    if (resourceDocument !== document && typeof PETCARE_PRINT_CSS !== 'undefined') {
        const style = document.createElement('style');
        style.textContent = PETCARE_PRINT_CSS;
        document.head.append(style);
    }
    const pdfAPI = () => resourceDocument.defaultView.PetCarePDF;
    const status = document.getElementById('printStatus');
    const pages = document.getElementById('printPages');
    const printButton = document.getElementById('printButton');
    const urls = [];
    let accepted = false;
    let task;
    let disposed = false;
    const waiting = setTimeout(() => {
        if (!accepted) status.textContent = 'Откройте нужный файл кнопкой «Печать» в разделе документов PetCare.';
    }, 20000);
    const objectUrl = blob => { const url = URL.createObjectURL(blob); urls.push(url); return url; };
    const loadScript = path => new Promise((resolve, reject) => {
        const script = resourceDocument.createElement('script');
        script.src = new URL(path, assetBase).href;
        script.onload = resolve;
        script.onerror = () => reject(new Error('Не удалось загрузить просмотр PDF. Проверьте интернет и повторите печать.'));
        resourceDocument.head.append(script);
    });
    async function appendPage(blob, label) {
        if (disposed) throw new Error('Просмотр закрыт.');
        const image = new Image();
        image.alt = label;
        image.src = objectUrl(blob);
        await image.decode();
        if (disposed) throw new Error('Просмотр закрыт.');
        const sheet = document.createElement('section');
        sheet.className = 'print-sheet';
        sheet.append(image);
        pages.append(sheet);
    }
    async function prepare(file, metadata) {
        if (accepted || !file || !file.size || file.size > 10 * 1024 * 1024) throw new Error('Недопустимый файл.');
        accepted = true;
        clearTimeout(waiting);
        document.getElementById('printTitle').textContent = String(metadata.title || 'Документ питомца');
        document.title = `${metadata.title || 'Документ'} — печать PetCare`;
        const mime = metadata.mime;
        if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(mime)) throw new Error('Формат не поддерживается.');
        const original = new Blob([file], { type: mime });
        const link = document.getElementById('printOriginal');
        link.href = objectUrl(original);
        link.hidden = false;
        try {
            if (mime === 'application/pdf') {
                status.textContent = 'Подготавливаю страницы PDF…';
                // Classic builds also work when PetCare is opened from index.html.
                // Parsing runs in this dedicated tab; no scripts/actions from a PDF are executed.
                await loadScript('assets/vendor/pdfjs/pdf.runtime.min.js');
                await loadScript('assets/vendor/pdfjs/pdf.worker.classic.min.js');
                const PetCarePDF = pdfAPI();
                task = PetCarePDF.getDocument({ data: new Uint8Array(await original.arrayBuffer()), ownerDocument: document,
                    isEvalSupported: false, enableXfa: false, disableWorkerRendering: true,
                    cMapUrl: new URL('assets/vendor/pdfjs/cmaps/', assetBase).href, cMapPacked: true,
                    standardFontDataUrl: new URL('assets/vendor/pdfjs/standard_fonts/', assetBase).href,
                    wasmUrl: new URL('assets/vendor/pdfjs/wasm/', assetBase).href,
                    useWasm: assetBase.protocol !== 'file:' });
                task.onPassword = (update, reason) => {
                    const password = window.prompt(reason === 2 ? 'Неверный пароль. Введите пароль PDF ещё раз:' : 'Введите пароль документа PDF:');
                    if (password === null) { task.destroy(); return; }
                    update(password);
                };
                const pdf = await task.promise;
                if (pdf.numPages > 100) throw new Error('В документе больше 100 страниц. Откройте оригинал и выберите печать в просмотрщике PDF.');
                const permissions = await pdf.getPermissions();
                if (permissions && !permissions.includes(PetCarePDF.PermissionFlag.PRINT)
                    && !permissions.includes(PetCarePDF.PermissionFlag.PRINT_HIGH_QUALITY)) {
                    throw new Error('Печать ограничена настройками этого PDF. Откройте оригинал, чтобы проверить разрешения документа.');
                }
                for (let number = 1; number <= pdf.numPages; number += 1) {
                    if (disposed) return;
                    status.textContent = `Подготавливаю страницу ${number} из ${pdf.numPages}…`;
                    const page = await pdf.getPage(number);
                    const base = page.getViewport({ scale: 1 });
                    const scale = Math.min(150 / 72, Math.sqrt(8000000 / (base.width * base.height)), 8192 / Math.max(base.width, base.height));
                    const viewport = page.getViewport({ scale });
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
                    try {
                        await page.render({ canvasContext: canvas.getContext('2d'), viewport, intent: 'print',
                            annotationMode: PetCarePDF.AnnotationMode.ENABLE_STORAGE, background: '#ffffff' }).promise;
                        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
                        if (!blob) throw new Error('Не удалось подготовить страницу. Откройте оригинал для печати.');
                        await appendPage(blob, `Страница ${number}`);
                    } finally { canvas.width = canvas.height = 0; page.cleanup(); }
                }
            } else {
                status.textContent = 'Подготавливаю изображение…';
                await appendPage(original, String(metadata.title || 'Скан документа'));
            }
            if (disposed) return;
            document.body.classList.add('print-ready');
            pages.setAttribute('aria-busy', 'false');
            status.textContent = `Готово. Страниц: ${pages.children.length}. Нажмите «Печатать».`;
            printButton.disabled = false;
        } catch (error) {
            pages.replaceChildren(); // Never offer a partially rendered examination report for printing.
            pages.setAttribute('aria-busy', 'false');
            status.dataset.error = 'true';
            status.textContent = error.message || 'Не удалось подготовить документ. Откройте оригинал для печати.';
        } finally { if (task) await task.destroy().catch(() => {}); }
    }
    printButton.addEventListener('click', () => { if (!printButton.disabled) { window.focus(); window.print(); } });
    window.addEventListener('pagehide', () => {
        disposed = true;
        clearTimeout(waiting);
        urls.forEach(url => URL.revokeObjectURL(url));
        pages.replaceChildren();
        task?.destroy().catch(() => {});
    });
    return { prepare };
    }
    host.PetCareCreateDocumentPrint = create;
    if (document.getElementById('printTitle')) host.PetCareDocumentPrint = create(host);
})(window);
