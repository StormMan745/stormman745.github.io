// Original bytes and unreviewed drafts never leave this device.
(() => {
    const base = new URL('.', document.baseURI);
    const asset = name => new URL('assets/vendor/' + name, base).href;
    const loads = new Map();
    function script(name) {
        if (!loads.has(name)) loads.set(name, new Promise((resolve, reject) => {
            const item = document.createElement('script');
            item.src = asset(name); item.onload = resolve;
            item.onerror = () => { loads.delete(name); item.remove(); reject(Error('Не удалось загрузить распознавание. Подключитесь к интернету и повторите.')); };
            document.head.append(item);
        }));
        return loads.get(name);
    }
    function fields(text) {
        const title = text.split(/\r?\n/).map(line => line.trim()).find(line => line.length > 3)?.slice(0, 160) || '';
        const match = text.match(/\b(\d{2})[./-](\d{2})[./-](20\d{2})\b/);
        const iso = match ? `${match[3]}-${match[2]}-${match[1]}` : '';
        const date = iso && !Number.isNaN(Date.parse(iso)) && new Date(iso).toISOString().slice(0,10) === iso ? iso : '';
        const category = /назначени|prescription/i.test(text) ? 'prescription'
            : /анализ|исследовани|laboratory/i.test(text) ? 'analysis'
            : /паспорт|passport/i.test(text) ? 'passport' : 'conclusion';
        return { title, date, text, category };
    }
    function create() {
        let cancelled = false, worker, task, timer;
        const check = () => { if (cancelled) throw Error('Распознавание отменено.'); };
        const cancel = () => { cancelled = true; worker?.terminate(); task?.destroy(); };
        async function recognize(file, mime, progress = () => {}) {
            timer = setTimeout(cancel, 180000);
            try {
                if (location.protocol === 'file:') throw Error('Для распознавания откройте PetCare через сайт или локальный HTTP-сервер. Оригинал можно сохранить без распознавания.');
                async function scan(image) {
                    check();
                    if (!worker) {
                        progress('Загружаю распознавание русского и английского текста…');
                        await script('ocr/tesseract.min.js'); check();
                        const created = await Tesseract.createWorker(['rus', 'eng'], 1, {
                            workerPath: asset('ocr/worker.min.js'), workerBlobURL: false,
                            corePath: asset('ocr/'), langPath: asset('ocr/'),
                            logger: info => { if (!cancelled && info.status === 'recognizing text') progress(`Распознаю текст: ${Math.round(info.progress * 100)}%`); }
                        });
                        worker = created; check();
                    }
                    return (await worker.recognize(image)).data.text;
                }
                const parts = [];
                if (mime === 'application/pdf') {
                    await script('pdfjs/pdf.runtime.min.js'); check();
                    await script('pdfjs/pdf.worker.classic.min.js'); check();
                    task = PetCarePDF.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, enableXfa: false,
                        cMapUrl: asset('pdfjs/cmaps/'), cMapPacked: true, standardFontDataUrl: asset('pdfjs/standard_fonts/'), wasmUrl: asset('pdfjs/wasm/') });
                    task.onPassword = () => { task.destroy(); };
                    const pdf = await task.promise; check();
                    if (pdf.numPages > 20) throw Error('Для распознавания выберите PDF до 20 страниц. Оригинал можно сохранить без распознавания.');
                    for (let n = 1; n <= pdf.numPages; n++) {
                        progress(`Читаю страницу ${n} из ${pdf.numPages}…`);
                        const page = await pdf.getPage(n); check();
                        const content = await page.getTextContent(); check();
                        let text = content.items.map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('').trim();
                        if (text.replace(/\s/g, '').length < 20) {
                            const original = page.getViewport({ scale: 1 });
                            const viewport = page.getViewport({ scale: Math.min(2, 2600 / Math.max(original.width, original.height)) });
                            const canvas = document.createElement('canvas');
                            canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
                            try {
                                await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise; check();
                                text = await scan(canvas);
                            } finally { canvas.width = canvas.height = 0; }
                        }
                        parts.push(text); page.cleanup(); check();
                        if (parts.join('\n\n').length > 50000) throw Error('В документе больше 50 000 символов. Выберите меньший документ.');
                    }
                } else {
                    const bitmap = await createImageBitmap(file); check();
                    const scale = Math.min(1, 3200 / Math.max(bitmap.width, bitmap.height));
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
                    try { canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close(); parts.push(await scan(canvas)); }
                    finally { bitmap.close(); canvas.width = canvas.height = 0; }
                }
                check();
                const text = parts.join('\n\n').trim();
                if (!text) throw Error('Текст не найден. Попробуйте более чёткий скан или заполните поля вручную.');
                if (text.length > 50000) throw Error('В документе больше 50 000 символов. Выберите меньший документ.');
                return fields(text);
            } finally { clearTimeout(timer); await worker?.terminate(); await task?.destroy(); }
        }
        return { recognize, cancel };
    }
    window.PetCareDocumentOCR = { create, fields };
})();
