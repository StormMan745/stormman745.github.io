const { contextBridge, ipcRenderer } = require('electron');
// Do not expose Node, the filesystem, arbitrary channels, or event objects.
contextBridge.exposeInMainWorld('PetCareDesktop', {
  notifications: payload => ipcRenderer.invoke('petcare:notifications', payload),
  notificationStatus: () => ipcRenderer.invoke('petcare:notification-status'),
  testNotifications: () => ipcRenderer.invoke('petcare:notification-test'),
  reset: () => ipcRenderer.invoke('petcare:reset'),
  file: payload => ipcRenderer.invoke('petcare:file', payload),
  printHtml: html => ipcRenderer.invoke('petcare:print-html', html),
  onReminders: callback => { ipcRenderer.on('petcare:open-reminders', () => callback()); }
});
