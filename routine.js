/* Daily checklist settings belong to the active pet inside its account snapshot. */
(() => {
    const defaults = [
        { id: 'feeding', name: 'Кормление', time: '08:00', icon: '🍖' },
        { id: 'walk', name: 'Прогулка', time: '18:00', icon: '🚶' },
        { id: 'vitamins', name: 'Витамины', time: '20:00', icon: '💊' }
    ];
    const icons = new Set(['🍖', '🚶', '💊', '💧', '🪮', '🎾', '🐾']);
    const $ = id => document.getElementById(id);
    const dialog = $('routineDialog');
    let editing = null, busy = false, midnightTimer, renderedKey = '', markedFocus = null;
    const pendingTasks = new Map();
    const copy = value => JSON.parse(JSON.stringify(value));
    const validTime = value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
    const checkCount = value => Number.isInteger(Number(value)) ? Math.max(1, Math.min(12, Number(value))) : 1;
    // Keep the first mark's legacy ID. Extra marks also survive older profile
    // normalizers, which preserve id/date/petId but discard unknown properties.
    const markId = (id, step) => step === 1 ? id : `${id}::check:${step}`;
    const pendingKey = (uid, petId, date, id) => JSON.stringify([uid, petId, date, id]);
    const completedIds = (date = getLocalDateInputValue(), petId = getActivePetKey()) => new Set(appData.completedTasks.filter(row => row.date === date && row.petId === petId).map(row => row.id));
    const marks = (task, completed) => Array.from({ length: task.checks }, (_, index) => completed.has(markId(task.id, index + 1)));
    function isCompleted(id, date = getLocalDateInputValue()) {
        const task = items().find(row => row.id === id);
        return task ? marks(task, completedIds(date)).every(Boolean) : completedIds(date).has(id);
    }
    function items(pet = appData.pet) {
        if (!pet || pet.isPlaceholder) return [];
        const source = Array.isArray(pet.dailyRoutine) ? pet.dailyRoutine : defaults;
        const seen = new Set();
        return source.filter(row => row && typeof row.id === 'string' && row.id && !seen.has(row.id) && seen.add(row.id))
            .slice(0, 20).map(row => {
                const checks = checkCount(row.checks), fallback = validTime(row.time) ? row.time : '09:00';
                const savedTimes = Array.isArray(row.times) ? row.times.slice(0, 12) : [];
                const times = Array.from({ length: Math.max(checks, savedTimes.length) }, (_, index) => validTime(savedTimes[index]) ? savedTimes[index] : fallback);
                // Older clients edit only time; keep that change as the first event.
                if (validTime(row.time)) times[0] = row.time;
                return { id: row.id, name: String(row.name || 'Ежедневное дело').slice(0, 80),
                    time: times[0], times, icon: icons.has(row.icon) ? row.icon : '🐾', checks };
            });
    }
    function node(tag, text, className) {
        const element = document.createElement(tag);
        if (text !== undefined) element.textContent = text;
        if (className) element.className = className;
        return element;
    }
    function control(label, action, className, id) {
        const button = node('button', label, className);
        button.type = 'button'; button.dataset.routine = action;
        if (id) button.dataset.taskId = id;
        return button;
    }
    function render(force = false) {
        if (!$('dailyTaskList')) return;
        if (editing && (editing.userId !== activeUserId || editing.petId !== getActivePetKey())) dialog.close();
        setTodayDate();
        const tasks = items().sort((a, b) => a.time.localeCompare(b.time));
        const date = getLocalDateInputValue(), petId = getActivePetKey(), completed = completedIds(date, petId);
        const states = tasks.map(task => marks(task, completed));
        const done = states.filter(state => state.every(Boolean)).length;
        const total = states.flat().length, checked = states.flat().filter(Boolean).length;
        const key = JSON.stringify([activeUserId, petId, date, tasks, states]);
        if (!force && renderedKey === key) return;
        renderedKey = key;
        const focused = document.activeElement?.closest('[data-routine][data-task-id]');
        const restoreFocus = focused ? { action: focused.dataset.routine, id: focused.dataset.taskId, step: focused.dataset.step } : null;
        $('routineProgressLabel').textContent = tasks.length ? (done === tasks.length ? 'Все дела сделаны. Вы отличная команда!' : total === tasks.length ? `${done} из ${tasks.length} дел выполнено` : `${checked} из ${total} отметок · ${done} из ${tasks.length} дел выполнено`) : 'Маленькие дела, большая забота';
        $('routineProgress').max = Math.max(total, 1);
        $('routineProgress').value = checked;
        $('routineProgress').hidden = !tasks.length;
        const list = $('dailyTaskList');
        const scrollPositions = new Map([...list.querySelectorAll('.routine-checks')].map(group => [group.dataset.taskId, group.scrollLeft]));
        list.replaceChildren();
        for (const task of tasks) {
            const state = marks(task, completed), count = state.filter(Boolean).length;
            const row = node('div', undefined, 'task'); row.dataset.task = task.id;
            row.classList.toggle('task-multiple', task.checks > 1);
            row.classList.toggle('done', count === task.checks);
            const icon = node('div', task.icon, 'task-icon'); icon.setAttribute('aria-hidden', 'true');
            const info = node('div', undefined, 'task-info');
            const time = node('time', task.time); time.dateTime = task.time;
            const subline = node('p');
            if (task.checks === 1) subline.append(time, node('span', ' · каждый день', 'routine-frequency'));
            else subline.append(node('span', `${task.checks} раз в день`));
            if (task.checks > 1) subline.append(node('span', ` · ${count} из ${task.checks}`, 'routine-count'));
            info.append(node('strong', task.name), subline);
            const actions = node('div', undefined, 'routine-row-actions');
            const edit = control('Изменить', 'edit', 'routine-edit', task.id);
            edit.setAttribute('aria-label', `Изменить дело «${task.name}»`);
            const group = node('div', undefined, 'routine-checks'); group.dataset.taskId = task.id;
            group.setAttribute('role', 'group'); group.setAttribute('aria-label', `Отметки выполнения: ${task.name}`);
            for (let step = 1; step <= task.checks; step++) {
                const marked = state[step - 1];
                const complete = control(marked ? '✓' : task.checks > 1 ? String(step) : '○', 'toggle', 'task-complete', task.id);
                complete.dataset.step = String(step);
                complete.disabled = pendingTasks.has(pendingKey(activeUserId, petId, date, markId(task.id, step)));
                complete.setAttribute('aria-pressed', String(marked));
                const scheduledTime = task.times[step - 1];
                complete.setAttribute('aria-label', `${marked ? 'Снять отметку' : 'Отметить выполнение'}: ${task.name}, ${step} из ${task.checks}, ${scheduledTime}`);
                complete.title = `${step} из ${task.checks} · ${scheduledTime}`;
                if (task.checks > 1) {
                    const slot = node('div', undefined, 'routine-check-slot');
                    const label = node('time', scheduledTime, 'routine-check-time'); label.dateTime = scheduledTime;
                    slot.append(complete, label); group.append(slot);
                } else group.append(complete);
            }
            actions.append(edit, group); row.append(icon, info, actions); list.append(row);
            group.scrollLeft = scrollPositions.get(task.id) || 0;
        }
        if (!tasks.length) {
            const empty = node('div', undefined, 'routine-empty');
            empty.append(node('span', '✦', 'routine-empty-mark'), node('strong', appData.pet?.isPlaceholder ? 'Начнём с вашего питомца' : 'Ритм дня выбираете вы'), node('p', appData.pet?.isPlaceholder ? 'Добавьте питомца, чтобы составить его ежедневный план.' : 'Добавьте кормление, прогулку или игру — всё, что важно для вашего любимца.'));
            if (appData.pet?.isPlaceholder) { const add = control('Добавить питомца', 'pet', 'routine-add'); empty.append(add); }
            list.append(empty);
        }
        document.querySelector('.routine-footer').hidden = Boolean(appData.pet?.isPlaceholder);
        document.querySelector('[data-routine="add"]').disabled = tasks.length >= 20;
        if (restoreFocus) [...list.querySelectorAll('[data-routine]')].find(b => b.dataset.routine === restoreFocus.action && b.dataset.taskId === restoreFocus.id && b.dataset.step === restoreFocus.step)?.focus({ preventScroll: true });
    }
    function open(id) {
        if (!activeUserId || appData.pet?.isPlaceholder) return;
        const task = id ? items().find(row => row.id === id) : null;
        if ((id && !task) || (!id && items().length >= 20)) return;
        editing = { userId: activeUserId, petId: getActivePetKey(), id, original: task ? JSON.stringify(task) : null,
            times: task ? [...task.times] : ['09:00'] };
        $('routineDialogTitle').textContent = task ? 'Изменить дело' : 'Новое дело';
        $('routineDialogDescription').textContent = `Ежедневный план · ${appData.pet.name || 'Ваш питомец'}`;
        $('routineName').value = task?.name || '';
        $('routineIcon').value = task?.icon || '🐾';
        $('routineChecks').value = task?.checks || 1;
        renderTimeInputs(false);
        $('routineDelete').hidden = !task;
        $('routineFormStatus').textContent = '';
        $('routineStatus').textContent = '';
        busy = false; setBusy(false);
        dialog.showModal(); $('routineName').focus();
    }
    function rememberTimes() {
        if (!editing) return;
        for (const input of $('routineTimesGrid').querySelectorAll('input')) editing.times[Number(input.dataset.routineTime)] = input.value;
    }
    function renderTimeInputs(capture = true) {
        if (!editing) return;
        if (capture) rememberTimes();
        const count = Number($('routineChecks').value);
        if (!Number.isInteger(count) || count < 1 || count > 12) return;
        const fields = [];
        for (let index = 0; index < count; index++) {
            const field = node('div'), id = index === 0 ? 'routineTime' : `routineTime${index + 1}`;
            const label = node('label', count === 1 ? 'Время каждый день' : `${index + 1}-е выполнение`); label.htmlFor = id;
            const input = node('input'); input.id = id; input.type = 'time'; input.required = true;
            input.dataset.routineTime = String(index); input.value = editing.times[index] || '';
            field.append(label, input); fields.push(field);
        }
        $('routineTimesGrid').replaceChildren(...fields);
    }
    function setBusy(value) {
        busy = value;
        for (const element of $('routineForm').elements) element.disabled = value;
        $('routineSave').textContent = value ? 'Сохраняю…' : 'Сохранить';
        $('routineForm').setAttribute('aria-busy', String(value));
    }
    async function commit(remove = false) {
        if (busy || !editing) return;
        const draft = editing;
        if (draft.userId !== activeUserId || draft.petId !== getActivePetKey()) { dialog.close(); return; }
        const current = items();
        if (draft.id && JSON.stringify(current.find(task => task.id === draft.id)) !== draft.original) {
            $('routineFormStatus').textContent = 'Это дело уже изменилось на другом устройстве. Закройте редактор и откройте его заново, чтобы увидеть актуальные данные.'; return;
        }
        const name = $('routineName').value.trim(), checks = Number($('routineChecks').value);
        if (!remove && !name) { $('routineFormStatus').textContent = 'Введите название дела.'; $('routineName').focus(); return; }
        if (!remove && (!Number.isInteger(checks) || checks < 1 || checks > 12)) { $('routineFormStatus').textContent = 'Выберите от 1 до 12 отметок.'; $('routineChecks').focus(); return; }
        rememberTimes();
        if (!remove) {
            const missing = Array.from({ length: checks }, (_, index) => index).find(index => !validTime(draft.times[index]));
            if (missing !== undefined) {
                $('routineFormStatus').textContent = 'Укажите время для каждого выполнения.';
                $('routineTimesGrid').querySelector(`[data-routine-time="${missing}"]`)?.focus(); return;
            }
        }
        if (!draft.id && current.length >= 20) { $('routineFormStatus').textContent = 'Можно добавить до 20 ежедневных дел.'; return; }
        if (remove && !confirm('Удалить дело из ежедневного плана? Прошлые отметки останутся в истории.')) return;
        const previous = appData.pet.dailyRoutine;
        const next = remove ? current.filter(task => task.id !== draft.id) : current.slice();
        if (!remove) {
            const times = draft.times.slice(0, 12).map(time => validTime(time) ? time : draft.times[0]);
            const task = { id: draft.id || createEntryId('routine'), name, time: times[0], times, checks, icon: icons.has($('routineIcon').value) ? $('routineIcon').value : '🐾' };
            const index = next.findIndex(row => row.id === task.id);
            if (index < 0) next.push(task); else next[index] = task;
        }
        appData.pet.dailyRoutine = next;
        setBusy(true); render();
        try {
            const synced = await saveData();
            if (draft.userId !== activeUserId || draft.petId !== getActivePetKey()) return;
            if (editing === draft) dialog.close();
            $('routineStatus').textContent = synced ? (remove ? 'Дело удалено из плана.' : 'Ежедневный план сохранён.') : 'План сохранён на устройстве и будет отправлен при восстановлении связи.';
        } catch {
            if (draft.userId === activeUserId && draft.petId === getActivePetKey()) {
                // Failed local persistence must not be presented as a successful edit.
                if (appData.pet.dailyRoutine === next) {
                    if (previous === undefined) delete appData.pet.dailyRoutine; else appData.pet.dailyRoutine = previous;
                }
                $('routineFormStatus').textContent = 'Не удалось сохранить на устройстве. Освободите место и повторите попытку.';
                $('routineStatus').textContent = 'Изменения пока не сохранены.'; render(true);
            }
        } finally { if (editing === draft) setBusy(false); }
    }
    async function toggle(element, taskId) {
        if (!activeUserId || appData.pet?.isPlaceholder) return;
        const id = taskId || element?.dataset.taskId || element?.closest('[data-task]')?.dataset.task;
        const task = items().find(row => row.id === id);
        if (!task) return;
        const step = Number(element?.dataset.step || 1);
        if (!Number.isInteger(step) || step < 1 || step > task.checks) return;
        const completionId = markId(id, step), token = Symbol();
        const uid = activeUserId, petId = getActivePetKey(), date = getLocalDateInputValue(), pending = pendingKey(uid, petId, date, completionId);
        if (pendingTasks.has(pending)) return;
        pendingTasks.set(pending, token);
        if (document.activeElement === element) markedFocus = { token, id, step };
        const match = row => row.id === completionId && row.date === date && row.petId === petId;
        const previous = appData.completedTasks.find(match);
        const historyId = `task-${petId}-${completionId}-${date}`;
        const hadHistory = appData.activityHistory.some(row => row.id === historyId);
        const priorEvents = appData.activityHistory.filter(row => row.petId === petId && row.date === date && [historyId, `task-${completionId}-${date}`].includes(row.id));
        if (previous) {
            appData.completedTasks = appData.completedTasks.filter(row => !match(row));
            appData.activityHistory = appData.activityHistory.filter(row => !priorEvents.includes(row));
        }
        else {
            appData.completedTasks.push({ id: completionId, date, petId });
            addActivityEvent('task', `Выполнено: ${task.name}${task.checks > 1 ? ` · ${step} из ${task.checks}` : ''}`, date, `Ежедневный уход · ${task.times[step - 1]}`, historyId);
        }
        render(true);
        try { await saveData(); }
        catch {
            if (activeUserId === uid && pendingTasks.get(pending) === token) {
                appData.completedTasks = appData.completedTasks.filter(row => !match(row));
                if (previous) appData.completedTasks.push(copy(previous));
                if (!hadHistory) appData.activityHistory = appData.activityHistory.filter(row => row.id !== historyId);
                for (const event of priorEvents) if (!appData.activityHistory.some(row => row.id === event.id && row.petId === petId)) appData.activityHistory.push(event);
                $('routineStatus').textContent = 'Отметка не сохранена. Освободите место на устройстве и повторите попытку.';
            }
        } finally {
            if (pendingTasks.get(pending) === token) pendingTasks.delete(pending);
            if (activeUserId === uid) {
                render(true); renderEventHistory(); renderCalendar();
                if (markedFocus?.token === token && petId === getActivePetKey() && date === getLocalDateInputValue() && document.activeElement === document.body) {
                    const button = [...$('dailyTaskList').querySelectorAll('[data-routine="toggle"]')].find(button => button.dataset.taskId === id && Number(button.dataset.step) === step);
                    if (button?.offsetParent) button.focus({ preventScroll: true });
                }
            }
        }
    }
    $('routineForm').addEventListener('submit', event => { event.preventDefault(); commit(); });
    $('routineChecks').addEventListener('input', () => renderTimeInputs());
    $('routineTimesGrid').addEventListener('input', rememberTimes);
    document.addEventListener('click', event => {
        const button = event.target.closest?.('[data-routine]');
        if (!button || button.disabled) return;
        const action = button.dataset.routine;
        if (action === 'add') open();
        else if (action === 'edit') open(button.dataset.taskId);
        else if (action === 'toggle') toggle(button);
        else if (action === 'close') dialog.close();
        else if (action === 'delete') commit(true);
        else if (action === 'pet') openPetForm(true);
    });
    dialog.addEventListener('close', () => {
        const previous = editing; editing = null;
        if (previous?.userId !== activeUserId || previous?.petId !== getActivePetKey()) return;
        const trigger = [...$('dailyTaskList').querySelectorAll('[data-routine="edit"]')].find(button => button.dataset.taskId === previous.id);
        (trigger || document.querySelector('[data-routine="add"]'))?.focus({ preventScroll: true });
    });
    // Reset the checklist at local midnight, also after resuming a suspended PWA.
    function refreshDay() {
        clearTimeout(midnightTimer);
        if (document.hidden) return;
        if (activeUserId) { render(); renderHomeReminders(); updateHomeOverview(); }
        const next = new Date(); next.setHours(24, 0, 0, 50);
        midnightTimer = setTimeout(refreshDay, next.getTime() - Date.now());
    }
    window.addEventListener('petcare:data-changed', () => render());
    window.addEventListener('petcare:account-ready', refreshDay);
    window.addEventListener('petcare:account-reset', () => { dialog.close(); renderedKey = ''; markedFocus = null; pendingTasks.clear(); $('routineStatus').textContent = ''; });
    document.addEventListener('visibilitychange', refreshDay);
    window.PetCareRoutine = { render, items, toggle, isCompleted };
    render(); refreshDay();
})();
