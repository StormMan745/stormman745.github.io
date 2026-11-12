// Device-local delivery checks: provider acceptance never means user receipt.
(() => {
    const $ = id => document.getElementById(id);
    let state = {}, user = null, attempt = null, epoch = 0;
    const key = uid => `petcare:notification-check:${uid}`;
    const uid = () => typeof activeUserId === 'undefined' ? null : activeUserId;
    function read() {
        try { const value = JSON.parse(localStorage.getItem(key(user))); return value && ['accepted','confirmed','missing'].includes(value.stage) ? value : null; } catch { return null; }
    }
    function save(value) {
        attempt = value;
        try { if (user) { if (value) localStorage.setItem(key(user), JSON.stringify(value)); else localStorage.removeItem(key(user)); } } catch { /* Current-session checks still work without storage. */ }
    }
    function owner() {
        if (user !== uid()) { epoch++; user = uid(); state = {}; attempt = user ? read() : null; }
        return user;
    }
    function row(id, text, kind = 'unknown') { const node = $(id); if (node) { node.textContent = text; node.dataset.state = kind; } }
    function render() {
        owner();
        row('notificationScheduleStatus', !user ? 'Войдите в аккаунт' : state.schedule || 'Проверяется…', state.scheduleState);
        row('notificationPermissionStatus', !user ? 'Не проверено' : state.permission || 'Проверяется…', state.permissionState);
        let text = 'Ещё не проверяли', kind = 'unknown';
        if (attempt?.stage === 'sending') text = 'Отправляю проверку…';
        if (attempt?.stage === 'accepted') text = 'Отправлено. Получение пока не подтверждено';
        if (attempt?.stage === 'confirmed') { text = `Получено — подтверждено вами ${new Date(attempt.confirmedAt).toLocaleString('ru-RU')}`; kind = 'ok'; }
        if (attempt?.stage === 'missing') { text = 'Вы отметили, что уведомление не пришло'; kind = 'warning'; }
        if (attempt?.stage === 'error') { text = attempt.message || 'Проверка не отправлена'; kind = 'warning'; }
        row('notificationTestStatus', text, kind);
        const confirmation = $('notificationTestConfirmation');
        if (confirmation) confirmation.hidden = !user || attempt?.stage !== 'accepted';
        if ($('notificationTestHelp')) $('notificationTestHelp').hidden = attempt?.stage !== 'missing';
        if ($('notificationTestHelp')) $('notificationTestHelp').textContent = state.help || 'Проверьте разрешение PetCare в настройках устройства, интернет и режим «Не беспокоить». Затем нажмите «Проверить уведомления» ещё раз.';
    }
    function device(patch) { owner(); state = { ...state, ...patch }; render(); }
    function begin() {
        if (!owner()) return null;
        const token = { user, id: crypto.randomUUID(), epoch };
        save({ ...token, stage: 'sending', at: Date.now() }); render(); return token;
    }
    function isCurrent(token) { return Boolean(token && owner() && token.epoch === epoch && token.user === user && token.id === attempt?.id); }
    function finish(token, message, error = false) {
        if (!isCurrent(token)) return;
        save({ ...attempt, stage: error ? 'error' : 'accepted', message }); render();
    }
    function reset() { owner(); save(null); render(); }
    $('notificationTestReceived')?.addEventListener('click', () => {
        if (!owner() || attempt?.stage !== 'accepted') return;
        save({ ...attempt, stage: 'confirmed', confirmedAt: Date.now() }); render();
        if ($('pushSettingsStatus')) $('pushSettingsStatus').textContent = 'Вы подтвердили получение пробного уведомления на этом устройстве. Показ и звук следующих сообщений зависят от настроек устройства.';
    });
    $('notificationTestMissing')?.addEventListener('click', () => {
        if (!owner() || attempt?.stage !== 'accepted') return;
        save({ ...attempt, stage: 'missing' }); render();
        if ($('pushSettingsStatus')) $('pushSettingsStatus').textContent = 'Пробное уведомление не пришло. Проверьте настройки по подсказкам ниже и повторите проверку.';
    });
    window.addEventListener('petcare:account-reset', () => {
        epoch++; user = null; state = {}; attempt = null;
        row('notificationScheduleStatus', 'Войдите в аккаунт'); row('notificationPermissionStatus', 'Не проверено'); row('notificationTestStatus', 'Ещё не проверяли');
        if ($('notificationTestConfirmation')) $('notificationTestConfirmation').hidden = true;
        if ($('notificationTestHelp')) $('notificationTestHelp').hidden = true;
    });
    window.addEventListener('petcare:data-changed', render);
    window.addEventListener('focus', () => { if (uid() && $('remindersPage')?.style.display === 'block') renderPushSettings(); });
    window.PetCareNotificationStatus = { device, begin, finish, reset, render, isCurrent };
})();
