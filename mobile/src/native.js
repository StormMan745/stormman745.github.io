import { Capacitor } from '@capacitor/core';
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

if (Capacitor.isNativePlatform()) {
  let api, generation = 0, queue = Promise.resolve(), statusMessage = '', pendingNotification;
  const enabledKey = 'petcare:native-notifications:user';
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
  async function clearNotifications() {
    const { notifications } = await LocalNotifications.getPending();
    const own = notifications.filter(n => n.extra?.petcare || (n.id >= 100000 && n.id < 100060));
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
      const notifications = planNotifications(state).map(n => ({ ...n, extra: { ...n.extra, userId: state.userId } }));
      if (notifications.length) await LocalNotifications.schedule({ notifications });
      if (token !== generation || current().userId !== state.userId) { await clearNotifications(); return; }
      statusMessage = '';
      if (pendingNotification?.userId === state.userId) {
        const target = pendingNotification; pendingNotification = null;
        if (target.page === 'home') api?.showHome(); else api?.showReminders();
      }
    });
  }
  async function renderNotificationSettings() {
    const status = document.getElementById('pushSettingsStatus');
    const on = document.getElementById('pushEnableButton'), off = document.getElementById('pushDisableButton');
    if (!status || !on || !off) return;
    const userId = current().userId;
    const permission = await LocalNotifications.checkPermissions();
    if (userId !== current().userId) return;
    const enabled = Boolean(userId && localStorage.getItem(enabledKey) === userId && permission.display === 'granted');
    on.hidden = enabled; off.hidden = !enabled; on.disabled = !userId;
    on.textContent = 'Включить напоминания'; off.textContent = 'Выключить на устройстве';
    status.textContent = !userId ? 'Войдите в аккаунт, чтобы настроить напоминания.' : statusMessage || (enabled
      ? 'На устройстве запланированы ближайшие 60 событий с указанным временем. Открывайте PetCare для обновления расписания. Время доставки зависит от настроек телефона.'
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
    await enqueue(clearNotifications);
    await renderNotificationSettings();
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
      enqueue(clearNotifications).catch(report);
    },
    syncReminders: () => syncReminders().catch(report),
    renderNotificationSettings: () => renderNotificationSettings().catch(report), enableNotifications, disableNotifications, shareFile,
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
    enqueue(clearNotifications).catch(report);
  });
  App.addListener('backButton', back);
  App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) { api?.startAutoRefresh(); syncReminders().catch(report); }
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
