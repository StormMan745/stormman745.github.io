(() => {
  // document-print.js
  ((host) => {
    const assetBase = new URL(".", document.currentScript.src);
    function create(view, resourceDocument = view.document) {
      const window2 = view;
      const document2 = view.document;
      if (resourceDocument !== document2 && true) {
        const style = document2.createElement("style");
        style.textContent = `* { box-sizing: border-box; }
body { margin: 0; background: #edf0e7; color: #254c3b; font: 16px/1.5 'Segoe UI', -apple-system, BlinkMacSystemFont, Arial, sans-serif; }
.print-toolbar { max-width: 920px; margin: 24px auto; padding: 24px; border: 1px solid #d9e3d2; border-radius: 22px; background: #fffef9; }
.print-brand { color: #68816b; font-size: 13px; font-weight: 700; }
h1 { margin: 6px 0; font-size: 23px; line-height: 1.3; overflow-wrap: anywhere; }
#printStatus { margin: 10px 0; }
#printStatus[data-error="true"] { color: #923f2c; }
.print-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 16px; margin-top: 18px; }
.print-actions button { min-height: 46px; border: 0; border-radius: 12px; padding: 12px 24px; background: #235d45; color: white; font: inherit; font-weight: 650; cursor: pointer; }
.print-actions button:disabled { opacity: .5; cursor: wait; }
.print-actions a { color: #356747; }
.print-actions :focus-visible { outline: 3px solid #769e7f; outline-offset: 4px; }
.print-hint { margin: 16px 0 0; color: #657963; font-size: 14px; }
#printPages { max-width: 794px; margin: 0 auto 30px; }
.print-sheet { display: grid; place-items: center; aspect-ratio: 190 / 277; padding: 12px; margin: 16px 0; background: white; box-shadow: 0 5px 24px #24382316; overflow: hidden; }
.print-sheet img { display: block; width: 100%; height: 100%; min-height: 0; object-fit: contain; }
@media (max-width: 600px) { .print-toolbar { margin: 12px; padding: 18px; } #printPages { margin-inline: 12px; } }
@page { size: A4; margin: 10mm; }
@media print {
    html, body { margin: 0; padding: 0; background: white; }
    .print-toolbar { display: none; }
    #printPages { max-width: none; margin: 0; }
    .print-sheet { width: 190mm; height: 276mm; aspect-ratio: auto; margin: 0; padding: 0; box-shadow: none; break-after: page; break-inside: avoid; }
    .print-sheet:last-child { break-after: auto; }
    body:not(.print-ready) #printPages { display: none; }
}
`;
        document2.head.append(style);
      }
      const pdfAPI = () => resourceDocument.defaultView.PetCarePDF;
      const status = document2.getElementById("printStatus");
      const pages = document2.getElementById("printPages");
      const printButton = document2.getElementById("printButton");
      const urls = [];
      let accepted = false;
      let task;
      let disposed = false;
      const waiting = setTimeout(() => {
        if (!accepted) status.textContent = "\u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u043D\u0443\u0436\u043D\u044B\u0439 \u0444\u0430\u0439\u043B \u043A\u043D\u043E\u043F\u043A\u043E\u0439 \xAB\u041F\u0435\u0447\u0430\u0442\u044C\xBB \u0432 \u0440\u0430\u0437\u0434\u0435\u043B\u0435 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u043E\u0432 PetCare.";
      }, 2e4);
      const objectUrl = (blob) => {
        const url = URL.createObjectURL(blob);
        urls.push(url);
        return url;
      };
      const loadScript = (path) => new Promise((resolve, reject) => {
        const script = resourceDocument.createElement("script");
        script.src = new URL(path, assetBase).href;
        script.onload = resolve;
        script.onerror = () => reject(new Error("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440 PDF. \u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u0438\u043D\u0442\u0435\u0440\u043D\u0435\u0442 \u0438 \u043F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u0435 \u043F\u0435\u0447\u0430\u0442\u044C."));
        resourceDocument.head.append(script);
      });
      async function appendPage(blob, label) {
        if (disposed) throw new Error("\u041F\u0440\u043E\u0441\u043C\u043E\u0442\u0440 \u0437\u0430\u043A\u0440\u044B\u0442.");
        const image = new Image();
        image.alt = label;
        image.src = objectUrl(blob);
        await image.decode();
        if (disposed) throw new Error("\u041F\u0440\u043E\u0441\u043C\u043E\u0442\u0440 \u0437\u0430\u043A\u0440\u044B\u0442.");
        const sheet = document2.createElement("section");
        sheet.className = "print-sheet";
        sheet.append(image);
        pages.append(sheet);
      }
      async function prepare(file, metadata) {
        if (accepted || !file || !file.size || file.size > 10 * 1024 * 1024) throw new Error("\u041D\u0435\u0434\u043E\u043F\u0443\u0441\u0442\u0438\u043C\u044B\u0439 \u0444\u0430\u0439\u043B.");
        accepted = true;
        clearTimeout(waiting);
        document2.getElementById("printTitle").textContent = String(metadata.title || "\u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442 \u043F\u0438\u0442\u043E\u043C\u0446\u0430");
        document2.title = `${metadata.title || "\u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442"} \u2014 \u043F\u0435\u0447\u0430\u0442\u044C PetCare`;
        const mime = metadata.mime;
        if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(mime)) throw new Error("\u0424\u043E\u0440\u043C\u0430\u0442 \u043D\u0435 \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442\u0441\u044F.");
        const original = new Blob([file], { type: mime });
        const link = document2.getElementById("printOriginal");
        link.href = objectUrl(original);
        link.hidden = false;
        try {
          if (mime === "application/pdf") {
            status.textContent = "\u041F\u043E\u0434\u0433\u043E\u0442\u0430\u0432\u043B\u0438\u0432\u0430\u044E \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B PDF\u2026";
            await loadScript("assets/vendor/pdfjs/pdf.runtime.min.js");
            await loadScript("assets/vendor/pdfjs/pdf.worker.classic.min.js");
            const PetCarePDF = pdfAPI();
            task = PetCarePDF.getDocument({
              data: new Uint8Array(await original.arrayBuffer()),
              ownerDocument: document2,
              isEvalSupported: false,
              enableXfa: false,
              disableWorkerRendering: true,
              cMapUrl: new URL("assets/vendor/pdfjs/cmaps/", assetBase).href,
              cMapPacked: true,
              standardFontDataUrl: new URL("assets/vendor/pdfjs/standard_fonts/", assetBase).href,
              wasmUrl: new URL("assets/vendor/pdfjs/wasm/", assetBase).href,
              useWasm: assetBase.protocol !== "file:"
            });
            task.onPassword = (update, reason) => {
              const password = window2.prompt(reason === 2 ? "\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u043F\u0430\u0440\u043E\u043B\u044C. \u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043F\u0430\u0440\u043E\u043B\u044C PDF \u0435\u0449\u0451 \u0440\u0430\u0437:" : "\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043F\u0430\u0440\u043E\u043B\u044C \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0430 PDF:");
              if (password === null) {
                task.destroy();
                return;
              }
              update(password);
            };
            const pdf = await task.promise;
            if (pdf.numPages > 100) throw new Error("\u0412 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0435 \u0431\u043E\u043B\u044C\u0448\u0435 100 \u0441\u0442\u0440\u0430\u043D\u0438\u0446. \u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u043E\u0440\u0438\u0433\u0438\u043D\u0430\u043B \u0438 \u0432\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043F\u0435\u0447\u0430\u0442\u044C \u0432 \u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440\u0449\u0438\u043A\u0435 PDF.");
            const permissions = await pdf.getPermissions();
            if (permissions && !permissions.includes(PetCarePDF.PermissionFlag.PRINT) && !permissions.includes(PetCarePDF.PermissionFlag.PRINT_HIGH_QUALITY)) {
              throw new Error("\u041F\u0435\u0447\u0430\u0442\u044C \u043E\u0433\u0440\u0430\u043D\u0438\u0447\u0435\u043D\u0430 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0430\u043C\u0438 \u044D\u0442\u043E\u0433\u043E PDF. \u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u043E\u0440\u0438\u0433\u0438\u043D\u0430\u043B, \u0447\u0442\u043E\u0431\u044B \u043F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C \u0440\u0430\u0437\u0440\u0435\u0448\u0435\u043D\u0438\u044F \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0430.");
            }
            for (let number = 1; number <= pdf.numPages; number += 1) {
              if (disposed) return;
              status.textContent = `\u041F\u043E\u0434\u0433\u043E\u0442\u0430\u0432\u043B\u0438\u0432\u0430\u044E \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443 ${number} \u0438\u0437 ${pdf.numPages}\u2026`;
              const page = await pdf.getPage(number);
              const base = page.getViewport({ scale: 1 });
              const scale = Math.min(150 / 72, Math.sqrt(8e6 / (base.width * base.height)), 8192 / Math.max(base.width, base.height));
              const viewport = page.getViewport({ scale });
              const canvas = document2.createElement("canvas");
              canvas.width = Math.ceil(viewport.width);
              canvas.height = Math.ceil(viewport.height);
              try {
                await page.render({
                  canvasContext: canvas.getContext("2d"),
                  viewport,
                  intent: "print",
                  annotationMode: PetCarePDF.AnnotationMode.ENABLE_STORAGE,
                  background: "#ffffff"
                }).promise;
                const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
                if (!blob) throw new Error("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u0434\u0433\u043E\u0442\u043E\u0432\u0438\u0442\u044C \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443. \u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u043E\u0440\u0438\u0433\u0438\u043D\u0430\u043B \u0434\u043B\u044F \u043F\u0435\u0447\u0430\u0442\u0438.");
                await appendPage(blob, `\u0421\u0442\u0440\u0430\u043D\u0438\u0446\u0430 ${number}`);
              } finally {
                canvas.width = canvas.height = 0;
                page.cleanup();
              }
            }
          } else {
            status.textContent = "\u041F\u043E\u0434\u0433\u043E\u0442\u0430\u0432\u043B\u0438\u0432\u0430\u044E \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0435\u2026";
            await appendPage(original, String(metadata.title || "\u0421\u043A\u0430\u043D \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0430"));
          }
          if (disposed) return;
          document2.body.classList.add("print-ready");
          pages.setAttribute("aria-busy", "false");
          status.textContent = `\u0413\u043E\u0442\u043E\u0432\u043E. \u0421\u0442\u0440\u0430\u043D\u0438\u0446: ${pages.children.length}. \u041D\u0430\u0436\u043C\u0438\u0442\u0435 \xAB\u041F\u0435\u0447\u0430\u0442\u0430\u0442\u044C\xBB.`;
          printButton.disabled = false;
        } catch (error) {
          pages.replaceChildren();
          pages.setAttribute("aria-busy", "false");
          status.dataset.error = "true";
          status.textContent = error.message || "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u0434\u0433\u043E\u0442\u043E\u0432\u0438\u0442\u044C \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442. \u041E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u043E\u0440\u0438\u0433\u0438\u043D\u0430\u043B \u0434\u043B\u044F \u043F\u0435\u0447\u0430\u0442\u0438.";
        } finally {
          if (task) await task.destroy().catch(() => {
          });
        }
      }
      printButton.addEventListener("click", () => {
        if (!printButton.disabled) {
          window2.focus();
          window2.print();
        }
      });
      window2.addEventListener("pagehide", () => {
        disposed = true;
        clearTimeout(waiting);
        urls.forEach((url) => URL.revokeObjectURL(url));
        pages.replaceChildren();
        task?.destroy().catch(() => {
        });
      });
      return { prepare };
    }
    host.PetCareCreateDocumentPrint = create;
    if (document.getElementById("printTitle")) host.PetCareDocumentPrint = create(host);
  })(window);
})();
