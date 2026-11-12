import { planReminders } from '../../mobile/src/reminders.mjs';

if (window.PetCareDesktop) {
  const bridge = window.PetCareDesktop;
  const enabledKey = 'petcare:windows-notifications:user';
  let api, generation = 0, renderRevision = 0, testBusy = false, scheduleError = false;
  const current = () => api?.getState() || { userId: null, reminders: [] };
  const report = () => alert('Не удалось выполнить действие. Попробуйте ещё раз.');
  async function syncReminders() {
    const state = current();
    const enabled = Boolean(state.userId && localStorage.getItem(enabledKey) === state.userId);
    try {
      await bridge.notifications({ userId: state.userId, enabled, notifications: enabled
        ? planReminders(state.reminders).map(item => ({ body: item.body, at: item.schedule.at.getTime() })) : [] });
      scheduleError = false;
    } catch (error) { scheduleError = true; throw error; }
  }
  async function renderNotificationSettings() {
    const status = document.getElementById('pushSettingsStatus');
    const on = document.getElementById('pushEnableButton'), off = document.getElementById('pushDisableButton');
    if (!status || !on || !off) return;
    const { userId } = current();
    const token = generation, revision = ++renderRevision;
    const support = await bridge.notificationStatus().catch(() => ({ supported: null }));
    if (userId !== current().userId || token !== generation || revision !== renderRevision) return;
    const enabled = Boolean(userId && localStorage.getItem(enabledKey) === userId);
    on.hidden = enabled; on.disabled = !userId; on.textContent = 'Включить напоминания';
    off.hidden = !enabled; off.textContent = 'Выключить на компьютере';
    window.PetCareNotificationStatus?.device({ schedule: !enabled ? 'Выключена на этом компьютере' : support.supported === false ? 'Недоступна — Windows не поддерживает уведомления' : scheduleError ? 'Не удалось обновить расписание — повторите включение' : 'Включена · PetCare должен оставаться запущенным', scheduleState: enabled && !scheduleError && support.supported !== false ? 'ok' : 'warning',
      permission: support.supported === false ? 'Уведомления недоступны в Windows' : 'Проверьте разрешение PetCare в настройках Windows. Автоматическая проверка недоступна', permissionState: support.supported === false ? 'warning' : 'unknown',
      help: 'Откройте настройки Windows → Система → Уведомления и разрешите уведомления PetCare. Проверьте режим «Не беспокоить» и оставьте PetCare запущенным. Затем повторите проверку.' });
    if (!enabled) window.PetCareNotificationStatus?.reset();
    const test = document.getElementById('pushTestButton');
    if (test) { test.hidden = !enabled || support.supported === false; test.disabled = testBusy; test.textContent = testBusy ? 'Отправляю…' : 'Проверить уведомления'; }
    status.textContent = !userId ? 'Войдите в аккаунт, чтобы настроить напоминания.' : enabled
      ? 'Напоминания работают, пока PetCare запущен, в том числе в области уведомлений рядом с часами. После полного выхода доставка прекращается.'
      : 'Включите напоминания на этом компьютере. Для доставки PetCare должен оставаться запущенным.';
  }
  async function disableNotifications() {
    generation++; window.PetCareNotificationStatus?.reset();
    localStorage.removeItem(enabledKey);
    await syncReminders(); await renderNotificationSettings();
  }
  async function testNotifications() {
    const { userId } = current();
    if (testBusy || !userId || localStorage.getItem(enabledKey) !== userId) return;
    const token = generation, health = window.PetCareNotificationStatus, check = health?.begin();
    testBusy = true;
    try {
      await renderNotificationSettings();
      const result = await bridge.testNotifications();
      if (userId !== current().userId || token !== generation) return;
      if (!result.accepted) throw Error('Windows не подтвердила показ пробного уведомления.');
      health?.finish(check);
      document.getElementById('pushSettingsStatus').textContent = 'Пробное уведомление передано Windows. Проверьте центр уведомлений и подтвердите получение ниже.';
    } catch (error) { if (userId === current().userId && token === generation) health?.finish(check, error.message || 'Не удалось показать пробное уведомление.', true); }
    finally { testBusy = false; if (userId === current().userId && token === generation) { const button = document.getElementById('pushTestButton'); if (button) { button.disabled = false; button.textContent = 'Проверить уведомления'; } } }
  }
  window.isPetCareInstalled = () => true;
  window.isAppleMobileDevice = () => false;
  window.installPetCareApp = window.showInstallButtons = window.openInstallHelp = () => {};
  window.PetCareNative = {
    attach(callbacks) { api = callbacks; },
    syncReminders: () => syncReminders().catch(report),
    renderNotificationSettings, testNotifications,
    async enableNotifications() {
      const { userId } = current(); if (!userId) return;
      localStorage.setItem(enabledKey, userId);
      try { await syncReminders(); await renderNotificationSettings(); } catch { localStorage.removeItem(enabledKey); await renderNotificationSettings(); report(); }
    },
    disableNotifications,
    async shareFile(blob, name, action = 'share') {
      const token = generation, userId = current().userId;
      if (!userId) return;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (token !== generation || current().userId !== userId) return;
      await bridge.file({ bytes, name, action: action === 'share' ? 'save' : action, generation: token });
    },
    printHtml: html => bridge.printHtml(html),
    getCurrentPosition: (success, fail, options) => navigator.geolocation.getCurrentPosition(success, fail, options),
    checkLocationPermission: async () => (await navigator.permissions.query({ name: 'geolocation' })).state
  };
  window.addEventListener('petcare:account-reset', () => { generation++; scheduleError = false; bridge.reset().catch(report); });
  window.addEventListener('focus', () => { api?.startAutoRefresh(); syncReminders().then(renderNotificationSettings).catch(report); });
  window.addEventListener('online', () => syncReminders().then(renderNotificationSettings).catch(report));
  bridge.onReminders(() => { if (current().userId) api?.showReminders(); });
}
