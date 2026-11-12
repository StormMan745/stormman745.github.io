import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { FileViewer } from '@capacitor/file-viewer';
import { Share } from '@capacitor/share';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Geolocation } from '@capacitor/geolocation';
import { SplashScreen } from '@capacitor/splash-screen';
import { Printer } from '@capgo/capacitor-printer';
import { planNotifications } from './reminders.mjs';
import { prepareNotifications } from './notification-options.mjs';

const NotificationSound = registerPlugin('PetCareNotificationSound');

if (Capacitor.isNativePlatform()) {
  let api, generation = 0, queue = Promise.resolve(), statusMessage = '', pendingNotification, testBusy = false, renderRevision = 0;
  const enabledKey = 'petcare:native-notifications:user';
  const android = Capacitor.getPlatform() === 'android';
  const current = () => api?.getState() || { userId: null, reminders: [] };
  const report = () => notice('Не удалось выполнить действие. Проверьте разрешения и повторите попытку.');
  function notice(message) {
    let el = document.querySelector('.native-notice');
    if (!el) { el = document.createElement('div'); el.className = 'native-notice'; el.setAttribute('role', 'status'); document.body.append(el); }
    el.textContent = message;
    clearTimeout(notice.timer); notice.timer = setTimeout(() => el.remove(), 6500);
  }
  function enqueue(task) {
    const result = queue.catch(() => {}).then(task);
    queue = result.catch(() => { statusMessage = 'Не удалось обновить напоминания. Откройте раздел и повторите включение.'; });
    return result;
  }
  async function clearNotifications(includeTests = false) {
    const { notifications } = await LocalNotifications.getPending();
    const own = notifications.filter(n => (n.extra?.petcare || (n.id >= 100000 && n.id < 100060)) && (includeTests || !n.extra?.test));
    if (own.length) await LocalNotifications.cancel({ notifications: own.map(({ id }) => ({ id })) });
  }
  function syncReminders() {
    const token = generation;
    return enqueue(async () => {
      if (token !== generation) return;
      await clearNotifications();
      const state = current();
      if (!state.userId || localStorage.getItem(enabledKey) !== state.userId) return;
      if ((await LocalNotifications.checkPermissions()).display !== 'granted' || token !== generation) return;
      if (android) await NotificationSound.configure();
      if (token !== generation || current().userId !== state.userId) return;
      const notifications = prepareNotifications(planNotifications(state), state.userId, android);
      if (notifications.length) await LocalNotifications.schedule({ notifications });
      if (token !== generation || current().userId !== state.userId) { await clearNotifications(); return; }
      statusMessage = '';
      window.PetCareNotificationStatus?.device({ schedule: `Включена · запланировано событий: ${notifications.length}`, scheduleState: 'ok' });
      if (pendingNotification?.userId === state.userId) {
        const target = pendingNotification; pendingNotification = null;
        if (target.page === 'home') api?.showHome(); else api?.showReminders();
      }
    });
  }
  function renderSoundSettings(sound) {
    if (!android) return;
    let panel = document.getElementById('nativeSoundSettings');
    if (!panel) {
      panel = document.createElement('div'); panel.id = 'nativeSoundSettings'; panel.className = 'native-sound-settings';
      const title = document.createElement('strong'); title.textContent = 'Звук на Android';
      const description = document.createElement('p'); description.id = 'nativeSoundStatus'; description.setAttribute('role', 'status');
      const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary-button';
      button.id = 'nativeSoundSettingsButton'; button.textContent = 'Настроить звук уведомлений';
      button.addEventListener('click', () => NotificationSound.openSettings().catch(report));
      panel.append(title, description, button);
      document.getElementById('pushDisableButton').after(panel);
    }
    document.getElementById('nativeSoundStatus').textContent = !sound ? 'Не удалось проверить звук. Откройте настройки уведомлений.'
      : !sound.appEnabled ? 'Уведомления PetCare запрещены в Android. Разрешите их в настройках.'
      : !sound.channelReady ? 'При включении напоминаний создаётся отдельный канал со звуком и вибрацией.'
      : sound.channelEnabled === false ? 'Канал напоминаний выключен. Разрешите уведомления в настройках ниже.'
      : !sound.soundEnabled ? 'Канал работает без звука. Выберите «Со звуком» и мелодию в настройках ниже.'
      : !sound.ringerNormal ? 'На телефоне включена вибрация или беззвучный режим. Переключите его на звук.'
      : sound.volume === 0 ? 'Громкость уведомлений — 0. Увеличьте её в настройках звука телефона.'
      : 'Звук канала включён. Режим «Не беспокоить» может заглушать сигнал. Проверьте пробным уведомлением.';
  }
  async function renderNotificationSettings() {
    const status = document.getElementById('pushSettingsStatus');
    const on = document.getElementById('pushEnableButton'), off = document.getElementById('pushDisableButton');
    if (!status || !on || !off) return;
    const userId = current().userId;
    const token = generation, revision = ++renderRevision;
    const [permission, sound] = await Promise.all([LocalNotifications.checkPermissions(), android ? NotificationSound.status().catch(() => null) : null]);
    if (userId !== current().userId || token !== generation || revision !== renderRevision) return;
    renderSoundSettings(sound);
    const enabled = Boolean(userId && localStorage.getItem(enabledKey) === userId && permission.display === 'granted');
    on.hidden = enabled; off.hidden = !enabled; on.disabled = !userId;
    on.textContent = 'Включить напоминания'; off.textContent = 'Выключить на устройстве';
    const health = window.PetCareNotificationStatus;
    const optedIn = Boolean(userId && localStorage.getItem(enabledKey) === userId);
    health?.device({ schedule: !optedIn ? 'Выключена на этом устройстве' : permission.display !== 'granted' ? 'Заблокирована разрешением устройства' : statusMessage ? 'Не удалось обновить расписание — повторите включение' : 'Включена · ближайшие события сохраняются на устройстве',
      scheduleState: enabled && !statusMessage ? 'ok' : 'warning',
      permission: permission.display === 'granted' ? 'Разрешено устройством' : permission.display === 'denied' ? 'Запрещено — измените настройки устройства' : 'Разрешение ещё не получено', permissionState: permission.display === 'granted' ? 'ok' : 'warning',
      help: 'Проверьте разрешение PetCare, режим «Не беспокоить» и ограничения энергосбережения в настройках телефона. Пробное сообщение запланировано через 5 секунд. Затем повторите проверку.' });
    if (!enabled) health?.reset();
    const test = document.getElementById('pushTestButton');
    if (test) { test.hidden = !enabled; test.disabled = testBusy; test.textContent = testBusy ? 'Отправляю…' : 'Проверить уведомления'; }
    status.textContent = !userId ? 'Войдите в аккаунт, чтобы настроить напоминания.' : statusMessage || (enabled
      ? 'Открывайте PetCare для обновления расписания. Показ и звук уведомлений зависят от настроек телефона.'
      : permission.display === 'denied' ? 'Разрешите уведомления PetCare в настройках телефона.' : 'Напоминания на этом устройстве выключены.');
  }
  async function enableNotifications() {
    const userId = current().userId;
    if (!userId) return;
    try {
      const result = await LocalNotifications.requestPermissions();
      if (current().userId !== userId) return;
      if (result.display === 'granted') { localStorage.setItem(enabledKey, userId); await syncReminders(); }
      await renderNotificationSettings();
    } catch { report(); }
  }
  async function disableNotifications() {
    generation++; localStorage.removeItem(enabledKey);
    window.PetCareNotificationStatus?.reset();
    await enqueue(() => clearNotifications(true));
    await renderNotificationSettings();
  }
  async function testNotifications() {
    if (testBusy || !current().userId) return;
    const userId = current().userId, token = generation;
    const health = window.PetCareNotificationStatus, check = health?.begin();
    testBusy = true;
    try {
      await renderNotificationSettings();
      if ((await LocalNotifications.checkPermissions()).display !== 'granted' || localStorage.getItem(enabledKey) !== userId) throw Error('Сначала включите напоминания и разрешите уведомления в настройках телефона.');
      if (userId !== current().userId || token !== generation) return;
      await enqueue(async () => {
        if (userId !== current().userId || token !== generation) return;
        if (android) {
          await NotificationSound.configure();
          // Android's onlyAlertOnce would mute a replacement of the previous test.
          await LocalNotifications.removeDeliveredNotifications({ notifications: [{ id: 99999 }] });
        }
        if (userId !== current().userId || token !== generation) return;
        const notifications = prepareNotifications([{ id: 99999, title: 'Проверка уведомлений PetCare', body: 'Если вы видите это сообщение, вернитесь в PetCare и подтвердите получение.', schedule: { at: new Date(Date.now() + 5000), allowWhileIdle: true }, extra: { petcare: true, test: true, userId, page: 'reminders' } }], userId, android);
        await LocalNotifications.schedule({ notifications });
        if (userId !== current().userId || token !== generation) await clearNotifications(true);
      });
      if (userId !== current().userId || token !== generation) return;
      health?.finish(check);
      document.getElementById('pushSettingsStatus').textContent = 'Пробное уведомление запланировано через 5 секунд. Проверьте центр уведомлений, затем подтвердите получение ниже.';
    } catch (error) { if (userId === current().userId && token === generation) health?.finish(check, error.message || 'Не удалось запланировать проверку.', true); }
    finally { testBusy = false; if (userId === current().userId && token === generation) { const button = document.getElementById('pushTestButton'); if (button) { button.disabled = false; button.textContent = 'Проверить уведомления'; } } }
  }
  async function clearFiles() {
    try { await Filesystem.rmdir({ path: 'petcare-share', directory: Directory.Cache, recursive: true }); }
    catch { /* Empty cache is normal. */ }
  }
  let fileCleanup = clearFiles();
  async function shareFile(blob, name, action = 'share') {
    const token = generation, userId = current().userId;
    if (!userId) throw Error('Sign in required');
    await fileCleanup;
    if (token !== generation || userId !== current().userId) return;
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onerror = reject;
      reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(blob);
    });
    if (token !== generation || userId !== current().userId) return;
    const clean = String(name || 'document').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(-160);
    const filePath = `petcare-share/${crypto.randomUUID()}/${clean}`;
    const file = await Filesystem.writeFile({ path: filePath, data, directory: Directory.Cache, recursive: true });
    if (token !== generation || userId !== current().userId) {
      await Filesystem.deleteFile({ path: filePath, directory: Directory.Cache });
      return;
    }
    if (action === 'open') await FileViewer.openDocumentFromLocalPath({ path: file.uri });
    else if (action === 'print') await Printer.printFile({ path: file.uri, mimeType: blob.type, name: clean });
    else {
      try { await Share.share({ title: clean, files: [file.uri], dialogTitle: 'Сохранить или отправить файл' }); }
      catch (error) { if (!/cancel|dismiss/i.test(error.message || '')) throw error; }
    }
  }
  function back() {
    const dialog = document.querySelector('dialog[open]');
    if (dialog) { dialog.close(); return; }
    const page = [...document.querySelectorAll('.page')].find(el => el.offsetParent);
    if (page && !['homePage', 'authPage'].includes(page.id)) {
      const button = page.querySelector('.page-header button');
      if (button) button.click(); else api?.showHome();
    } else App.minimizeApp().catch(report);
  }
  window.isPetCareInstalled = () => true;
  window.isAppleMobileDevice = () => Capacitor.getPlatform() === 'ios';
  window.installPetCareApp = window.showInstallButtons = window.openInstallHelp = () => {};
  window.PetCareNative = {
    attach(callbacks) {
      api = callbacks;
      // Clear stale reminders until the current authenticated account has loaded.
      enqueue(() => clearNotifications(true)).catch(report);
    },
    syncReminders: () => syncReminders().catch(report),
    renderNotificationSettings: () => renderNotificationSettings().catch(report), enableNotifications, disableNotifications, testNotifications, shareFile,
    printHtml: html => Printer.printHtml({ name: 'Медицинская карточка PetCare', html }),
    getCurrentPosition: (success, fail, options) => Geolocation.getCurrentPosition(options).then(success).catch(error => fail({ code: /permission|denied|0003/i.test(error.code || error.message || '') ? 1 : 2 })),
    checkLocationPermission: async () => {
      const p = await Geolocation.checkPermissions(); return p.location === 'granted' || p.coarseLocation === 'granted' ? 'granted' : p.location;
    }
  };
  window.addEventListener('petcare:account-reset', () => {
    generation++;
    // Keep the opt-in bound to its account; pending content is always removed.
    fileCleanup = fileCleanup.catch(() => {}).then(clearFiles);
    enqueue(() => clearNotifications(true)).catch(report);
  });
  App.addListener('backButton', back);
  App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) { api?.startAutoRefresh(); syncReminders().then(renderNotificationSettings).catch(report); }
    else api?.stopAutoRefresh();
  });
  LocalNotifications.addListener('localNotificationActionPerformed', ({ notification }) => {
    if (notification.extra?.userId === current().userId) {
      if (notification.extra.page === 'home') api?.showHome(); else api?.showReminders();
    }
    else if (!current().userId) pendingNotification = notification.extra;
  });
  document.addEventListener('click', event => {
    const link = event.target.closest?.('a[href]');
    if (!link) return;
    const url = new URL(link.href, location.href);
    if (url.origin === location.origin || url.protocol !== 'https:') return;
    event.preventDefault(); Browser.open({ url: url.href }).catch(report);
  });
  document.addEventListener('DOMContentLoaded', () => {
    SplashScreen.hide().catch(() => {});
    document.querySelectorAll('.install-app-button').forEach(button => button.hidden = true);
  });
}
