const assert = require('node:assert/strict');

module.exports = async ({ page }) => {
    await page.evaluate(() => showHealth());
    const health = page.locator('#healthPage');
    await health.waitFor({ state: 'visible' });
    assert.equal(await page.locator('#clinicConnectionsButton, #clinicConnectionDialog').count(), 0);
    assert.equal(await page.evaluate(() => typeof window.PetCareClinicConnections), 'undefined');
    assert(await health.locator('[data-pc-click="clinics-open"]').isVisible());
    assert(await health.locator('[data-pc-click="health-add"]').isVisible());
    assert(await health.locator('[data-pc-click="documents-open"]').isVisible());
    assert(await health.locator('[data-pc-click="health-export"]').isVisible());

    await health.locator('.history-access-card [data-history-type="health"]').click();
    await page.getByText('Ранее полученный приём', { exact: true }).waitFor({ state: 'visible' });
    console.log('PASS: clinic import is gone and previous clinical records remain visible in health history.');
};
