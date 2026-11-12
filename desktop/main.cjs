const { app, BrowserWindow, Menu, Tray, Notification, protocol, net, session, ipcMain, dialog, shell } = require('electron');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

const APP_URL = 'petcare://localhost/index.html';
const contentRoot = path.join(__dirname, 'www');
const testMode = !app.isPackaged && process.argv.includes('--petcare-test');
let mainWindow, tray, quitting = false, timers = [], toasts = [], accountGeneration = 0, locationAllowed = false;
const printWindows = new Set();
const testToasts = new Set();
const tempRoot = fsSync.mkdtempSync(path.join(os.tmpdir(), 'petcare-export-'));
// The only directory ever removed by this process is its own mkdtemp result.
if (path.dirname(tempRoot) !== os.tmpdir() || !path.basename(tempRoot).startsWith('petcare-export-')) throw Error('Unsafe cache path');
protocol.registerSchemesAsPrivileged([{ scheme: 'petcare', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true
} }]);

if (testMode) {
  const profile = process.env.PETCARE_TEST_PROFILE;
  if (!profile || !path.resolve(profile).startsWith(path.resolve(__dirname, '../.tools') + path.sep)) throw Error('Test profile must be in project .tools');
  app.setPath('userData', profile);
}
if (!testMode && !app.requestSingleInstanceLock()) { app.quit(); }
else {
  const isApp = url => { try { const u = new URL(url); return u.protocol === 'petcare:' && u.hostname === 'localhost'; } catch { return false; } };
  const assertSender = event => {
    if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame
      || event.senderFrame.url !== APP_URL) throw Error('Untrusted request');
  };
  const external = url => {
    try { if (new URL(url).protocol === 'https:') return shell.openExternal(url); } catch { /* Reject other schemes. */ }
    return Promise.resolve();
  };
  const showWindow = () => { if (!mainWindow) return; mainWindow.show(); mainWindow.restore(); mainWindow.focus(); };
  function clearNotifications() {
    timers.forEach(clearTimeout); timers = [];
    toasts.forEach(toast => toast.close()); toasts = [];
  }
  function clearTestNotifications() { testToasts.forEach(toast => toast.close()); testToasts.clear(); }
  async function clearFiles() {
    for (const window of printWindows) if (!window.isDestroyed()) window.destroy();
    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.mkdir(tempRoot, { recursive: true });
  }
  function queueNotification(item, token) {
    const remaining = item.at - Date.now();
    const timer = setTimeout(() => {
      if (token !== accountGeneration) return;
      if (item.at > Date.now() + 1000) { queueNotification(item, token); return; }
      // Do not replay hours-old reminders after waking from sleep.
      if (Date.now() - item.at > 10 * 60 * 1000 || !Notification.isSupported()) return;
      const toast = new Notification({ title: 'Напоминание PetCare', body: item.body, icon: path.join(__dirname, 'icon.ico') });
      toast.on('click', () => { if (token === accountGeneration) { showWindow(); mainWindow.webContents.send('petcare:open-reminders'); } });
      toasts.push(toast); toast.show();
    }, Math.min(Math.max(remaining, 0), 2147483647));
    timers.push(timer);
  }
  function registerIPC() {
    ipcMain.handle('petcare:notification-status', event => { assertSender(event); return { supported: Notification.isSupported() }; });
    ipcMain.handle('petcare:notification-test', event => {
      assertSender(event);
      if (!Notification.isSupported()) throw Error('Уведомления не поддерживаются Windows.');
      clearTestNotifications();
      const token = accountGeneration;
      return new Promise((resolve, reject) => {
        const toast = new Notification({ title: 'Проверка уведомлений PetCare', body: 'Если вы видите это сообщение, вернитесь в PetCare и подтвердите получение.', icon: path.join(__dirname, 'icon.ico') });
        const timer = setTimeout(() => { toast.close(); testToasts.delete(toast); reject(Error('Windows не подтвердила показ. Проверьте настройки уведомлений PetCare.')); }, 5000);
        toast.once('show', () => { clearTimeout(timer); token === accountGeneration ? resolve({ accepted: true }) : reject(Error('Account changed')); });
        toast.once('failed', () => { clearTimeout(timer); testToasts.delete(toast); reject(Error('Windows не смогла показать пробное уведомление. Проверьте настройки PetCare.')); });
        toast.once('close', () => testToasts.delete(toast));
        toast.on('click', () => { if (token === accountGeneration) { showWindow(); mainWindow.webContents.send('petcare:open-reminders'); } });
        testToasts.add(toast); toast.show();
      });
    });
    ipcMain.handle('petcare:notifications', (event, payload) => {
      assertSender(event);
      if (!payload || !Array.isArray(payload.notifications) || payload.notifications.length > 60) throw Error('Invalid schedule');
      clearNotifications();
      if (!payload.enabled) clearTestNotifications();
      if (!payload.enabled || typeof payload.userId !== 'string' || !payload.userId) return { count: 0 };
      if (!Notification.isSupported()) throw Error('Notifications unavailable');
      const items = payload.notifications.filter(n => Number.isFinite(n.at) && n.at > Date.now() && n.at < Date.now() + 10 * 366 * 86400000
        && typeof n.body === 'string').map(n => ({ at: n.at, body: n.body.slice(0, 200) }));
      items.forEach(item => queueNotification(item, accountGeneration));
      return { count: items.length };
    });
    ipcMain.handle('petcare:reset', async event => { assertSender(event); accountGeneration++; clearNotifications(); clearTestNotifications(); await clearFiles(); });
    ipcMain.handle('petcare:file', async (event, payload) => {
      assertSender(event);
      if (!payload || !(payload.bytes instanceof Uint8Array) || payload.bytes.length > (payload.action==='save'?512:32) * 1024 * 1024) throw Error('Invalid file');
      if (!['save', 'open', 'print'].includes(payload.action)) throw Error('Invalid action');
      const bytes = Buffer.from(payload.bytes);
      let ext = bytes.subarray(0, 5).toString() === '%PDF-' ? '.pdf'
        : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? '.png'
        : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? '.jpg'
        : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' ? '.webp' : null;
      if(!ext&&payload.action==='save'&&bytes.subarray(0,4).equals(Buffer.from([80,75,3,4])))ext='.zip';
      if(!ext&&payload.action==='save'&&/\.json$/i.test(String(payload.name))&&bytes.length<=32*1024*1024){try{JSON.parse(bytes.toString('utf8'));ext='.json';}catch{}}
      if (!ext) throw Error('Unsupported file');
      const clean = path.parse(String(payload.name || 'PetCare').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')).name.slice(0, 120) || 'PetCare';
      const token = accountGeneration;
      if (payload.action === 'save') {
        const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, { title: 'Сохранить файл PetCare',
          defaultPath: path.join(app.getPath('downloads'), clean + ext), filters: [{ name: 'Документ', extensions: [ext.slice(1)] }] });
        if (canceled || !filePath || token !== accountGeneration) return;
        await fs.writeFile(filePath, bytes); return;
      }
      const directory = await fs.mkdtemp(path.join(tempRoot, 'document-'));
      if (token !== accountGeneration) return;
      const file = path.join(directory, clean + ext); await fs.writeFile(file, bytes);
      if (token !== accountGeneration) { await fs.rm(file, { force: true }); return; }
      const error = await shell.openPath(file);
      if (error) throw Error('No document viewer');
      if (payload.action === 'print' && token === accountGeneration) await dialog.showMessageBox(mainWindow, { type: 'info',
        title: 'Печать документа', message: 'Оригинал открыт в приложении для просмотра.', detail: 'Для печати выберите «Печать» или нажмите Ctrl+P в открывшемся приложении.' });
    });
    ipcMain.handle('petcare:print-html', async (event, html) => {
      assertSender(event);
      if (typeof html !== 'string' || Buffer.byteLength(html) > 8 * 1024 * 1024) throw Error('Invalid print document');
      const view = new BrowserWindow({ show: !testMode, width: 900, height: 740, title: 'Медицинская карточка PetCare',
        autoHideMenuBar: true, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, partition: 'petcare-print' } });
      printWindows.add(view); view.on('closed', () => printWindows.delete(view));
      view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      view.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !/^(data:|blob:)/.test(details.url) }));
      const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'">`;
      const document = /<head[\s>]/i.test(html) ? html.replace(/<head[^>]*>/i, '$&' + csp) : `<html><head>${csp}</head><body>${html}</body></html>`;
      try {
        await view.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(document));
        if (testMode) return { bytes: (await view.webContents.printToPDF({ printBackground: true })).length };
        await new Promise((resolve, reject) => view.webContents.print({ printBackground: true }, (ok, reason) => {
          if (ok || /cancel/i.test(reason)) resolve(); else reject(Error('Printing failed'));
        }));
      } finally { if (!view.isDestroyed()) view.destroy(); }
    });
  }
  async function createWindow() {
    mainWindow = new BrowserWindow({ width: 1280, height: 900, minWidth: 380, minHeight: 600,
      show: false, title: 'PetCare', backgroundColor: '#fcfbf7', icon: path.join(__dirname, 'icon.ico'),
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true,
        sandbox: true, webSecurity: true, webviewTag: false, allowRunningInsecureContent: false } });
    mainWindow.removeMenu();
    mainWindow.webContents.setWindowOpenHandler(({ url }) => { external(url).catch(() => {}); return { action: 'deny' }; });
    mainWindow.webContents.on('will-navigate', (event, url) => { if (!isApp(url)) { event.preventDefault(); external(url).catch(() => {}); } });
    mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
    mainWindow.on('close', event => { if (!quitting && !testMode) { event.preventDefault(); mainWindow.hide(); } });
    if (!testMode) mainWindow.once('ready-to-show', () => mainWindow.show());
    await mainWindow.loadURL(APP_URL);
  }
  app.setAppUserModelId('app.petcare.companion.desktop');
  app.on('second-instance', showWindow);
  app.on('before-quit', () => { quitting = true; clearNotifications(); });
  app.on('will-quit', () => { try { fsSync.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* An external viewer may still hold a document. */ } });
  app.whenReady().then(async () => {
    protocol.handle('petcare', request => {
      const url = new URL(request.url);
      if (url.hostname !== 'localhost' || !['GET', 'HEAD'].includes(request.method)) return new Response('', { status: 403 });
      const file = path.resolve(contentRoot, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (!file.startsWith(contentRoot + path.sep)) return new Response('', { status: 403 });
      return net.fetch(pathToFileURL(file).href);
    });
    session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) =>
      webContents === mainWindow?.webContents && isApp(requestingOrigin) && permission === 'geolocation' && locationAllowed);
    session.defaultSession.setPermissionRequestHandler(async (webContents, permission, callback, details) => {
      if (webContents !== mainWindow?.webContents || !isApp(details.requestingUrl) || !['geolocation', 'media'].includes(permission)) { callback(false); return; }
      const result = await dialog.showMessageBox(mainWindow, { type: 'question', title: 'Разрешение PetCare',
        message: permission === 'geolocation' ? 'Разрешить определить местоположение для поиска мест рядом?' : 'Разрешить доступ к камере?',
        buttons: ['Разрешить', 'Отмена'], defaultId: 1, cancelId: 1 });
      if (permission === 'geolocation') locationAllowed = result.response === 0;
      callback(result.response === 0);
    });
    registerIPC();
    tray = new Tray(path.join(__dirname, 'icon.ico')); tray.setToolTip('PetCare');
    tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Открыть PetCare', click: showWindow }, { type: 'separator' },
      { label: 'Выйти из приложения', click: () => app.quit() }]));
    tray.on('double-click', showWindow);
    await createWindow();
  }).catch(() => { dialog.showErrorBox('PetCare', 'Не удалось запустить приложение. Попробуйте установить его заново.'); app.quit(); });
}
