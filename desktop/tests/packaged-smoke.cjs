const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron: electron } = require('../../.tools/preview/node_modules/playwright');

(async () => {
  const root = path.resolve(__dirname, '../..');
  const profile = await fs.mkdtemp(path.join(root, '.tools/petcare-packaged-test-'));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: path.join(root, 'desktop/releases/win-unpacked/PetCare.exe'),
    args: [`--user-data-dir=${profile}`], env });
  try {
    const page = await app.firstWindow();
    await page.waitForURL('petcare://localhost/index.html');
    await page.waitForFunction(() => window.PetCareDesktop && window.PetCareNative && document.getElementById('authPage').offsetParent);
    const result = await app.evaluate(({ app, BrowserWindow }) => {
      const fs = process.getBuiltinModule('fs'), path = process.getBuiltinModule('path');
      const files = fs.readdirSync(app.getAppPath());
      const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return { packaged: app.isPackaged, files, nodeIntegration: prefs.nodeIntegration, sandbox: prefs.sandbox,
        index: fs.readFileSync(path.join(app.getAppPath(), 'www/index.html'), 'utf8') };
    });
    assert.equal(result.packaged, true);
    assert.equal(result.nodeIntegration, false); assert.equal(result.sandbox, true);
    for (const unwanted of ['.tools', 'supabase', 'mobile', 'tests', '.env']) assert.ok(!result.files.includes(unwanted));
    assert.ok(result.index.includes('desktop.js')); assert.ok(!result.index.includes('cdn.jsdelivr.net'));
    assert.equal(await page.evaluate(() => typeof require), 'undefined');
    await app.evaluate(({ app }) => app.quit());
    console.log('PASS: actual packaged PetCare.exe launches the login screen with isolated preload and local SDK; no development/server directories are shipped.');
  } finally { await app.close().catch(() => {}); }
})().catch(error => { console.error(error); process.exitCode = 1; });
