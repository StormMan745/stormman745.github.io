const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron: electron } = require('../../.tools/preview/node_modules/playwright');
const root = path.resolve(__dirname, '../..');

(async () => {
  const profile = await fs.mkdtemp(path.join(root, '.tools/petcare-windows-test-'));
  const executablePath = require('../node_modules/electron');
  const env = { ...process.env, PETCARE_TEST_PROFILE: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath, args: [path.join(root, 'desktop'), '--petcare-test'], env });
  try {
    const page = await app.firstWindow();
    await page.waitForURL('petcare://localhost/index.html');
    await page.waitForLoadState('domcontentloaded');
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('https://**', route => route.abort());
    await page.route('**/supabase.js', route => route.fulfill({ contentType: 'text/javascript', body: `window.supabase={createClient:()=>({auth:{getUser:async()=>({data:{user:null}}),getSession:async()=>({data:{session:null}}),onAuthStateChange(){},startAutoRefresh(){},stopAutoRefresh(){}},storage:{from:()=>({})}})};` }));
    await page.reload();
    await page.waitForFunction(() => window.PetCareDesktop && window.PetCareNative && document.getElementById('authPage').offsetParent);
    assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
    assert.equal(await page.evaluate(() => typeof window.process), 'undefined');
    assert.equal(await page.locator('#installAppButton').isVisible(), false);
    assert.equal(page.url(), 'petcare://localhost/index.html');
    const preferences = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]; const p = w.webContents.getLastWebPreferences();
      return { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration };
    });
    assert.deepEqual(preferences, { sandbox: true, contextIsolation: true, nodeIntegration: false });
    const print = await page.evaluate(() => PetCareDesktop.printHtml('<html><head><title>Test</title></head><body><h1>PetCare</h1><p>Медицинская карточка</p></body></html>'));
    assert.ok(print.bytes > 1000, 'Native PDF export must contain document bytes');
    const fileRejection = await page.evaluate(async () => {
      try { await PetCareDesktop.file({ bytes: new Uint8Array([77, 90, 0, 0]), name: 'danger.exe', action: 'open' }); return false; }
      catch { return true; }
    });
    assert.equal(fileRejection, true, 'Executable files must never open through document IPC');
    const schedule = await page.evaluate(() => PetCareDesktop.notifications({ userId: 'test-user', enabled: true,
      notifications: [{ body: 'Напоминание', at: Date.now() + 3600000 }] }));
    assert.equal(schedule.count, 1);
    assert.equal(typeof(await page.evaluate(()=>PetCareDesktop.notificationStatus())).supported,'boolean');
    await app.evaluate(({Notification})=>{
      globalThis.testNotificationOriginals={show:Notification.prototype.show,close:Notification.prototype.close};
      Notification.prototype.show=function(){this.emit('show');};
      Notification.prototype.close=function(){this.emit('close');};
    });
    await page.evaluate(async()=>{
      activeUserId='test-user';appData.reminders=[];
      await PetCareNative.enableNotifications();showReminders();await PetCareNative.testNotifications();
    });
    assert.match(await page.locator('#notificationScheduleStatus').textContent(),/Включена/);
    assert.match(await page.locator('#notificationPermissionStatus').textContent(),/Автоматическая проверка недоступна/);
    assert.match(await page.locator('#notificationTestStatus').textContent(),/Получение пока не подтверждено/);
    await page.locator('#notificationTestReceived').click();
    assert.match(await page.locator('#notificationTestStatus').textContent(),/подтверждено вами/);
    await app.evaluate(({Notification})=>{Notification.prototype.show=function(){this.emit('failed');};});
    await page.evaluate(()=>PetCareNative.testNotifications());
    assert.match(await page.locator('#notificationTestStatus').textContent(),/не смогла показать/);
    await page.evaluate(()=>PetCareNative.disableNotifications());
    assert.match(await page.locator('#notificationTestStatus').textContent(),/Ещё не проверяли/);
    await app.evaluate(({Notification})=>{Object.assign(Notification.prototype,globalThis.testNotificationOriginals);delete globalThis.testNotificationOriginals;});
    await page.evaluate(() => PetCareDesktop.reset());
    await page.evaluate(() => {
      activeUserId = 'test-user';
      appData.reminders = [];
      PetCareNative.renderNotificationSettings();
      showHome();
    });
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal overflow');
    }
    const external = await page.evaluate(async () => {
      try { const response = await fetch('petcare://other-host/index.html'); return response.status; }
      catch { return 'blocked'; }
    });
    assert.ok(external === 403 || external === 'blocked');
    await page.screenshot({ path: path.join(root, '.tools/petcare-windows-home.png') });
    assert.deepEqual(errors, []);
    console.log('PASS: real Electron startup, sandbox/preload isolation, local interface and SDK, native PDF rendering, file validation, notification scheduling/reset, URL boundary and responsive layout.');
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
