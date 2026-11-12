const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('../../.tools/preview/node_modules/playwright');
const root = path.resolve(__dirname, '../www');
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + (new URL(req.url, 'http://localhost').pathname === '/' ? '/index.html' : req.url.split('?')[0]));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }[path.extname(file)];
  fs.readFile(file, (error, bytes) => { res.writeHead(error ? 404 : 200, { 'Content-Type': type || 'application/octet-stream' }); res.end(error ? '' : bytes); });
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('https://**', route => route.abort());
    await page.route('**/supabase.js', route => route.fulfill({ contentType: 'text/javascript', body: `window.supabase = {createClient: () => ({auth:{getUser:async()=>({data:{user:null}}),getSession:async()=>({data:{session:null}}),onAuthStateChange(){},startAutoRefresh(){},stopAutoRefresh(){}},storage:{from:()=>({})}})};` }));
    await page.addInitScript(() => {
      window.androidBridge = {};
      const state = window.nativeTest = { calls: [], pending: [], permission: 'granted', listeners: {}, sound: {appEnabled:true,channelReady:true,soundEnabled:true,ringerNormal:true,volume:5} };
      const plugins = ['App', 'Browser', 'Filesystem', 'FileViewer', 'Share', 'LocalNotifications', 'Geolocation', 'SplashScreen', 'Printer', 'PetCareNotificationSound'];
      const methods = ['getPending', 'cancel', 'schedule', 'removeDeliveredNotifications', 'configure', 'status', 'openSettings', 'checkPermissions', 'requestPermissions', 'writeFile', 'rmdir', 'share', 'open', 'hide', 'minimizeApp', 'printHtml', 'printFile', 'openDocumentFromLocalPath', 'getCurrentPosition'];
      window.Capacitor = {
        PluginHeaders: plugins.map(name => ({ name, methods: [...methods.map(name => ({ name, rtype: 'promise' })), { name: 'addListener', rtype: 'callback' }] })),
        nativeCallback(plugin, method, options, callback) { state.listeners[`${plugin}:${options.eventName}`] = callback; return Promise.resolve('listener'); },
        async nativePromise(plugin, method, options) {
          state.calls.push({ plugin, method, options });
          if(plugin==='PetCareNotificationSound'&&['configure','status'].includes(method))return state.sound;
          if (method === 'getPending') return { notifications: state.pending };
          if (method === 'cancel') { const ids = options.notifications.map(n => n.id); state.pending = state.pending.filter(n => !ids.includes(n.id)); }
          if (method === 'schedule') state.pending = [...state.pending.filter(n=>!options.notifications.some(next=>next.id===n.id)), ...options.notifications];
          if (/Permissions$/.test(method)) return { display: state.permission, location: 'granted' };
          if (method === 'writeFile') return { uri: 'file:///cache/' + options.path };
          return {};
        }
      };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.PetCareNative && document.getElementById('authPage').offsetParent);
    assert.equal(await page.locator('#installAppButton').isVisible(), false);
    assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length), 0);
    await page.evaluate(async () => {
      activeUserId = 'mobile-user-a';
      appData.reminders = [{ id: 1, petId: 'pet-a', name: 'Лекарство', date: '2090-01-01', time: '12:00', repeat: 'once' }];
      await PetCareNative.enableNotifications();
    });
    assert.equal(await page.evaluate(() => nativeTest.pending.length), 1);
    assert.equal(await page.evaluate(() => nativeTest.pending[0].extra.userId), 'mobile-user-a');
    assert.equal(await page.evaluate(() => nativeTest.pending[0].channelId),'petcare_reminders_v1');
    assert(await page.evaluate(()=>nativeTest.calls.findIndex(c=>c.method==='configure')<nativeTest.calls.findIndex(c=>c.method==='schedule')),'The sound channel exists before scheduling');
    assert.match(await page.locator('#notificationScheduleStatus').textContent(), /Включена/);
    assert.match(await page.locator('#notificationPermissionStatus').textContent(), /Разрешено/);
    await page.evaluate(async()=>{showReminders();await PetCareNative.testNotifications();});
    assert.equal(await page.evaluate(()=>nativeTest.pending.some(n=>n.id===99999&&n.extra.test&&n.extra.userId==='mobile-user-a')),true);
    assert.equal(await page.evaluate(()=>nativeTest.pending.find(n=>n.id===99999).channelId),'petcare_reminders_v1');
    assert(await page.evaluate(()=>nativeTest.calls.some(c=>c.method==='removeDeliveredNotifications'&&c.options.notifications[0].id===99999)),'A new test may ring even if the old test is still visible');
    assert.match(await page.locator('#notificationTestStatus').textContent(),/Получение пока не подтверждено/);
    await page.locator('#notificationTestReceived').click();
    assert.match(await page.locator('#notificationTestStatus').textContent(),/подтверждено вами/);
    await page.evaluate(async()=>{await PetCareNative.syncReminders();});
    assert.equal(await page.evaluate(()=>nativeTest.pending.some(n=>n.id===99999)),true,'Routine refresh preserves a pending test');
    assert.match(await page.locator('#nativeSoundStatus').textContent(),/Звук канала включён/);
    await page.evaluate(async()=>{nativeTest.sound.soundEnabled=false;await PetCareNative.renderNotificationSettings()});
    assert.match(await page.locator('#nativeSoundStatus').textContent(),/без звука/);
    await page.locator('#nativeSoundSettingsButton').click();
    assert(await page.evaluate(()=>nativeTest.calls.some(c=>c.plugin==='PetCareNotificationSound'&&c.method==='openSettings')));
    await page.evaluate(async()=>{nativeTest.sound.soundEnabled=true;nativeTest.sound.ringerNormal=false;await PetCareNative.renderNotificationSettings()});
    assert.match(await page.locator('#nativeSoundStatus').textContent(),/беззвучный режим/);
    await page.evaluate(async()=>{nativeTest.sound.ringerNormal=true;nativeTest.sound.volume=0;await PetCareNative.renderNotificationSettings()});
    assert.match(await page.locator('#nativeSoundStatus').textContent(),/Громкость уведомлений — 0/);
    await page.evaluate(async()=>{nativeTest.sound.volume=5;await PetCareNative.renderNotificationSettings()});
    await page.locator('.push-settings-card').screenshot({path:path.join(root,'../../.tools/android-sound-settings-390.png')});
    await page.evaluate(() => { showHealth(); nativeTest.listeners['App:backButton']({}); });
    assert.equal(await page.locator('#homePage').isVisible(), true, 'Android back returns to home');
    await page.evaluate(async () => {
      await PetCareNative.printHtml('<html><body>PetCare</body></html>');
      await PetCareNative.shareFile(new Blob(['file'], { type: 'application/pdf' }), 'medical.pdf', 'open');
      await PetCareNative.shareFile(new Blob(['file'], { type: 'application/pdf' }), 'medical.pdf');
    });
    for (const method of ['printHtml', 'openDocumentFromLocalPath', 'share']) assert.ok(await page.evaluate(method => nativeTest.calls.some(c => c.method === method), method));
    await page.evaluate(() => { resetActiveAccountData(); activeUserId = 'mobile-user-b'; });
    await page.waitForFunction(() => nativeTest.pending.length === 0);
    await page.evaluate(()=>PetCareNotificationStatus.render());
    assert.match(await page.locator('#notificationTestStatus').textContent(),/Ещё не проверяли/);
    await page.evaluate(async () => PetCareNative.syncReminders());
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => nativeTest.pending.length), 0, 'Another account must not inherit notifications');
    await page.evaluate(async () => { activeUserId = 'mobile-user-a'; await PetCareNative.disableNotifications(); });
    assert.equal(await page.evaluate(() => localStorage.getItem('petcare:native-notifications:user')), null);
    await page.evaluate(async () => { nativeTest.permission = 'denied'; await PetCareNative.enableNotifications(); });
    assert.equal(await page.evaluate(() => nativeTest.pending.length), 0, 'Denied permission must not enable notifications');
    assert.deepEqual(errors, []);
    console.log('PASS: packaged startup, offline SDK, no service worker, native notification opt-in, account isolation, printing, file preview and sharing. Native OS APIs mocked; device testing remains required.');
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
