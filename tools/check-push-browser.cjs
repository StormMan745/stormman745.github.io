const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require('../.tools/preview/node_modules/playwright');
(async () => {
  const root = path.resolve(__dirname, '..');
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    fs.readFile(file, (error, bytes) => {
      if (error) return res.writeHead(404).end();
      res.writeHead(200, { 'Content-Type': ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' })[path.extname(file)] || 'application/octet-stream' }); res.end(bytes);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    const context = await browser.newContext();
    await context.route('https://qexiyikdmdbdxgusqnee.supabase.co/**', route => route.abort());
    const page = await context.newPage(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port); await page.waitForFunction(() => window.PetCareCare);
    await page.evaluate(() => {
      activeUserId = 'test-owner'; window.isPetCareInstalled = () => false; window.isAppleMobileDevice = () => false;
      window.Notification = { permission: 'granted', requestPermission: async () => 'granted' };
      window.PushManager = class {};
      const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic', options: {}, toJSON: () => ({ endpoint: sub.endpoint, keys: { p256dh: 'test', auth: 'test' } }), unsubscribe: async () => { window.unsubscribed++; return true; } };
      window.unsubscribed = 0; window.subscriptions = 0;
      window.mockPushWorker = { pushManager: { getSubscription: async () => sub, subscribe: async () => { window.subscriptions++; return sub; } } };
      Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: async () => mockPushWorker, register: async () => mockPushWorker, ready: Promise.resolve(mockPushWorker) } });
      supabaseClient.rpc = async () => ({ data: true, error: null });
      supabaseClient.auth.getSession = async () => ({ data: { session: { user: { id: 'test-owner' }, access_token: 'synthetic-token' } }, error: null });
      window.alert = () => {};
      window.fetch = async (_url, options) => { window.testRequests = (window.testRequests || 0) + 1; window.lastTestBody = JSON.parse(options.body); return new Response('{"accepted":true}', { status: 200 }); };
    });
    await page.evaluate(() => renderPushSettings());
    await page.evaluate(()=>{hideAllPages();document.getElementById('remindersPage').style.display='block';});
    assert.equal(await page.locator('#pushEnableButton').evaluate(el => el.hidden), true, 'Desktop browsers can subscribe without installation');
    assert.equal(await page.locator('#pushTestButton').evaluate(el => el.hidden), false);
    assert.match(await page.locator('#notificationScheduleStatus').textContent(), /Включена/);
    assert.match(await page.locator('#notificationPermissionStatus').textContent(), /Разрешено/);
    assert.match(await page.locator('#notificationTestStatus').textContent(), /Ещё не проверяли/);
    await page.evaluate(() => testPushNotification());
    assert.match(await page.locator('#pushSettingsStatus').textContent(), /принято push-службой/);
    assert.equal(await page.evaluate(() => testRequests), 1);
    assert.match(await page.locator('#notificationTestStatus').textContent(), /Получение пока не подтверждено/);
    await page.locator('#notificationTestReceived').click({force:true});
    assert.match(await page.locator('#notificationTestStatus').textContent(), /подтверждено вами/);
    await page.evaluate(()=>renderPushSettings());
    assert.match(await page.locator('#notificationTestStatus').textContent(), /подтверждено вами/);
    await page.evaluate(async()=>{activeUserId='another-owner';await renderPushSettings();});
    assert.match(await page.locator('#notificationTestStatus').textContent(), /Ещё не проверяли/);
    await page.evaluate(async()=>{activeUserId='test-owner';await renderPushSettings();});
    assert.match(await page.locator('#notificationTestStatus').textContent(), /подтверждено вами/);
    assert.deepEqual(await page.evaluate(() => Object.keys(lastTestBody).sort()), ['action', 'endpoint']);
    await page.evaluate(async () => {
      window.fetch = async () => new Response('{"error":"test_recently_sent"}', { status: 429 });
      await testPushNotification();
    });
    assert.match(await page.locator('#pushSettingsStatus').textContent(), /через минуту/);
    assert.match(await page.locator('#notificationTestStatus').textContent(), /через минуту/);
    assert.equal(await page.locator('#pushTestButton').isDisabled(), false);
    await page.evaluate(async () => {
      window.testRequests = 0;
      window.fetch = () => { window.testRequests++; return new Promise(resolve => window.releaseTestPush = resolve); };
      window.firstTestPush = testPushNotification();
    });
    await page.waitForFunction(() => window.releaseTestPush);
    await page.evaluate(async () => {
      await testPushNotification(); releaseTestPush(new Response('{"accepted":true}')); await firstTestPush;
    });
    assert.equal(await page.evaluate(() => testRequests), 1, 'Repeated taps share a single pending request');
    await page.locator('#notificationTestMissing').click({force:true});
    assert.match(await page.locator('#notificationTestStatus').textContent(), /не пришло/);
    assert.equal(await page.locator('#notificationTestHelp').evaluate(el=>el.hidden),false);
    for(const width of [320,1280]){
      await page.setViewportSize({width,height:900});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Notification checklist fits '+width);
      await page.locator('.push-settings-card').screenshot({path:path.join(root,`.tools/notification-status-${width}.png`)});
    }
    await page.evaluate(async()=>{Notification.permission='denied';await renderPushSettings();});
    assert.match(await page.locator('#notificationPermissionStatus').textContent(), /Запрещено/);
    assert.match(await page.locator('#notificationScheduleStatus').textContent(), /Заблокирована/);
    assert.equal(await page.locator('#notificationTestConfirmation').evaluate(el=>el.hidden),true);
    await page.evaluate(async()=>{Notification.permission='granted';await renderPushSettings();});
    await page.evaluate(async () => {
      window.fetch = async () => new Response('{"error":"subscription_expired"}', { status: 410 });
      await testPushNotification();
    });
    assert.equal(await page.evaluate(() => unsubscribed), 1); assert.match(await page.locator('#pushSettingsStatus').textContent(), /истекла/);
    await page.evaluate(async () => {
      window.isAppleMobileDevice = () => true;
      await renderPushSettings();
    });
    assert.match(await page.locator('#pushSettingsStatus').textContent(), /главный экран/);
    assert.equal(await page.locator('#pushTestButton').evaluate(el => el.hidden), true);
    assert.match(await page.locator('#notificationScheduleStatus').textContent(), /главный экран/);
    await page.evaluate(async () => {
      window.isAppleMobileDevice = () => false;
      mockPushWorker.pushManager.getSubscription = async () => ({ options: { applicationServerKey: new Uint8Array([1]).buffer } });
      await renderPushSettings();
    });
    assert.match(await page.locator('#pushSettingsStatus').textContent(), /устарело/);
    await page.evaluate(async () => {
      mockPushWorker.pushManager.getSubscription = () => new Promise(resolve => window.releasePushRead = resolve);
      window.pendingPushRender = renderPushSettings();
    });
    await page.evaluate(async () => {
      activeUserId = null; await renderPushSettings(); releasePushRead(null); await pendingPushRender;
    });
    assert.match(await page.locator('#pushSettingsStatus').textContent(), /Войдите/);
    assert.equal(await page.locator('#pushTestButton').evaluate(el => el.hidden), true);
    assert.deepEqual(errors, []);
    // Both direct and late replies must stay tied to the current account.
    await page.evaluate(async()=>{
      activeUserId='test-owner';const check=PetCareNotificationStatus.begin();
      resetActiveAccountData();activeUserId='another-owner';
      PetCareNotificationStatus.finish(check);PetCareNotificationStatus.render();
    });
    assert.match(await page.locator('#notificationTestStatus').textContent(),/Ещё не проверяли/);
    console.log('PASS: push test button, server acceptance and error states, iOS installation hint, stale key detection, account switch races. Transport and permissions mocked.');
    await context.close();
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
