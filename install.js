/* Capture the browser's installation offer before the rest of the application loads. */
(() => {
    let offer = null;
    let busy = false;
    let installedThisVisit = false;
    const displayMode = window.matchMedia('(display-mode: standalone)');
    const isAppleMobileDevice = () => /iPhone|iPad|iPod/i.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isPetCareInstalled = () => installedThisVisit || displayMode.matches || navigator.standalone === true;
    const platform = () => isAppleMobileDevice() ? 'ios' : /Android/i.test(navigator.userAgent) ? 'android' : 'desktop';

    function showInstallButtons() {
        const installed = isPetCareInstalled();
        document.querySelectorAll('.install-app-button').forEach(button => {
            button.hidden = false;
            button.disabled = busy;
            button.dataset.installState = installed ? 'installed' : offer ? 'ready' : 'manual';
            button.textContent = installed ? '✓ Приложение установлено' : busy ? 'Открываю установку…' : '↓ Установить приложение';
        });
        const nativeButton = document.getElementById('installNativeButton');
        if (nativeButton) { nativeButton.hidden = !offer || installed; nativeButton.disabled = busy; }
    }

    function closeInstallHelp() {
        const dialog = document.getElementById('installHelpDialog');
        if (dialog?.open) dialog.close();
    }

    function openInstallHelp(selected = platform()) {
        const dialog = document.getElementById('installHelpDialog');
        if (!dialog) return;
        const title = document.getElementById('installHelpTitle');
        const text = document.getElementById('installHelpText');
        const steps = document.getElementById('installHelpSteps');
        const local = location.protocol === 'file:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
        const guides = {
            ios: ['PetCare на iPhone и iPad', 'На iPhone установка выполняется через меню Safari — это занимает всего несколько действий.', [
                'Откройте PetCare в Safari. Нажмите «Поделиться» — при необходимости сначала откройте меню страницы.',
                'Выберите «На экран Домой». Если пункт скрыт, найдите его в списке действий.',
                'Включите «Открывать как веб-приложение», если переключатель есть, и нажмите «Добавить».'
            ]],
            android: ['PetCare на Android', 'Если браузер предлагает установку, нажмите кнопку ниже. Также можно установить PetCare через меню браузера.', [
                'Откройте сайт в Chrome, Edge или другом браузере с поддержкой установки.',
                'Нажмите меню ⋮ → «Установить приложение» или «Добавить на главный экран».',
                'Подтвердите установку. Иконка PetCare появится среди ваших приложений.'
            ]],
            desktop: ['PetCare на компьютере', 'PetCare можно открывать отдельным приложением прямо с рабочего стола или из меню приложений.', [
                'В Chrome или Edge нажмите значок установки справа в адресной строке.',
                'Если значка нет: в Chrome откройте ⋮ → «Трансляция, сохранение и отправка» → «Установить страницу как приложение»; в Edge — ⋯ → «Приложения».',
                'На Mac в Safari выберите «Файл» → «Добавить в Dock». Подтвердите добавление.'
            ]],
            installed: ['PetCare уже установлен', 'Открывайте приложение с главного экрана телефона, из меню приложений компьютера или Dock.', []]
        };
        const guide = guides[selected] || guides[platform()];
        title.textContent = guide[0];
        text.textContent = guide[1];
        steps.replaceChildren(...guide[2].map(step => { const li = document.createElement('li'); li.textContent = step; return li; }));
        document.getElementById('installPublishedLink').hidden = !local;
        document.querySelectorAll('[data-install-platform]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.installPlatform === selected)));
        showInstallButtons();
        if (!dialog.open) dialog.showModal();
    }

    async function installPetCareApp() {
        if (busy) return;
        if (isPetCareInstalled()) { openInstallHelp('installed'); return; }
        if (!offer) { openInstallHelp(); return; }
        const currentOffer = offer;
        offer = null;
        busy = true;
        try {
            // Must be invoked directly by the tap: no network or readiness wait before prompt().
            const promptResult = currentOffer.prompt();
            closeInstallHelp();
            showInstallButtons();
            await promptResult;
            const choice = await currentOffer.userChoice;
            if (choice.outcome === 'accepted') {
                const notice = document.getElementById('installFeedback');
                if (notice) {
                    notice.textContent = 'Установка подтверждена. Браузер добавляет PetCare на ваше устройство.';
                    window.setTimeout(() => { notice.textContent = ''; }, 8000);
                }
            }
        } catch (error) {
            console.warn('PetCare installation prompt unavailable:', error.name);
            openInstallHelp();
        } finally { busy = false; showInstallButtons(); }
    }

    window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); offer = event; showInstallButtons(); });
    window.addEventListener('appinstalled', () => { installedThisVisit = true; offer = null; busy = false; showInstallButtons(); closeInstallHelp(); });
    displayMode.addEventListener('change', showInstallButtons);
    document.addEventListener('DOMContentLoaded', () => {
        showInstallButtons();
        if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
            navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(error => console.warn('PetCare offline shell:', error.name));
        }
    });
    document.addEventListener('click', event => {
        const button = event.target.closest?.('[data-install-platform]');
        if (button) openInstallHelp(button.dataset.installPlatform);
        const action = event.target.closest?.('[data-pc-click]')?.dataset.pcClick;
        if (action === 'install') installPetCareApp();
        if (action === 'install-close') closeInstallHelp();
    });
    Object.assign(window, { isPetCareInstalled, isAppleMobileDevice, showInstallButtons, openInstallHelp, closeInstallHelp, installPetCareApp });
})();
