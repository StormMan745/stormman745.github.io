// Keep this ID stable: changing it would discard the user's Android sound choices.
export const ANDROID_REMINDER_CHANNEL = 'petcare_reminders_v1';

export function prepareNotifications(notifications, userId, android) {
  const used = new Set([99999]);
  return notifications.map(notification => {
    const extra = { ...notification.extra, userId };
    if (!android) return { ...notification, extra };
    let id = 99999;
    if (!extra.test) {
      // Android's onlyAlertOnce suppresses sound when an old visible ID is reused.
      // An event keeps its ID when the queue shifts; a new date/time gets a new ID.
      const key = JSON.stringify([userId, extra.petId, extra.reminderId || extra.routineId, extra.routineStep ?? null,
        new Date(notification.schedule.at).toISOString()]);
      let hash = 2166136261;
      for (let index = 0; index < key.length; index++) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
      id = 100060 + (hash >>> 0) % 2147383587;
      while (used.has(id)) id = id === 2147483646 ? 100060 : id + 1;
    }
    used.add(id);
    return { ...notification, id, channelId: ANDROID_REMINDER_CHANNEL, extra };
  });
}
