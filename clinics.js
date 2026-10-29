import tzlookup from './assets/vendor/tz-lookup/tz.js';
import { hoursStatus, readableHours, clinicsFrom, addressCandidates, nominatimElements } from './clinic-data.js';

const $ = id => document.getElementById(id);
const INITIAL_MESSAGE = 'Введите город и улицу или нажмите «Разрешить геопозицию».';
const cache = new Map();
let initialized = false, center = null, records = [], searched = false, busy = false;
let generation = 0, controller = null, lastGeocode = 0, fetchedAt = 0, dataTimestamp = '';
let mapFrame = null, selectedMapId = null, mapRadius = 5, timer = null;
let requestDirectory = null;
let locationPermission = null;

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}
function link(text, url, className) {
    const a = element('a', className, text);
    a.href = url;
    if (!url.startsWith('tel:')) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    return a;
}
function status(text, kind = '') {
    $('clinicStatus').textContent = text;
    $('clinicStatus').dataset.kind = kind;
}
function setBusy(value) {
    busy = value;
    ['clinicSearchButton', 'clinicLocateButton', 'clinicRadius', 'clinicRefresh'].forEach(id => { $(id).disabled = value; });
    $('clinicCancel').hidden = !value;
    $('clinicSearchPanel').setAttribute('aria-busy', String(value));
}
function startOperation(message) {
    controller?.abort();
    controller = new AbortController();
    generation++;
    setBusy(true);
    status(message, 'loading');
    return { id: generation, signal: controller.signal };
}
function cancel() {
    generation++;
    controller?.abort();
    controller = null;
    if (busy) status('Поиск отменён. Можно выбрать другой адрес.');
    setBusy(false);
}
async function jsonRequest(url, signal, timeout = 20000) {
    const local = new AbortController();
    const abort = () => local.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) local.abort();
    const deadline = setTimeout(() => local.abort(), timeout);
    try {
        const response = await fetch(url, { signal: local.signal, credentials: 'omit', referrerPolicy: 'strict-origin-when-cross-origin' });
        if (!response.ok) {
            const error = new Error('Service unavailable');
            error.status = response.status;
            const retry = Number(response.headers.get('Retry-After'));
            error.retryAfter = Number.isFinite(retry) ? Math.max(30, retry) : 30;
            throw error;
        }
        return await response.json();
    } finally { clearTimeout(deadline); signal.removeEventListener('abort', abort); }
}

async function searchAddress(event) {
    event?.preventDefault();
    if (busy) return;
    const text = $('clinicAddress').value.trim();
    if (text.length < 3) { status('Введите город и адрес — не менее трёх символов.'); $('clinicAddress').focus(); return; }
    if (Date.now() - lastGeocode < 1200) return;
    lastGeocode = Date.now();
    const op = startOperation('Ищу адрес…');
    $('clinicCandidates').replaceChildren();
    try {
        const params = new URLSearchParams({ q: text, limit: '5' });
        const data = await jsonRequest(`https://photon.komoot.io/api/?${params}`, op.signal, 15000);
        if (op.id !== generation) return;
        const candidates = addressCandidates(Array.isArray(data.features) ? data.features : []);
        if (!candidates.length) { status('Адрес не найден. Добавьте название города или другую улицу.'); return; }
        if (candidates.length === 1) {
            setBusy(false);
            await searchClinics(candidates[0]);
            return;
        }
        status('Уточните адрес: выберите подходящее место из списка.');
        candidates.forEach(candidate => {
            const button = element('button', 'clinic-candidate', `⌖  ${candidate.label}`);
            button.type = 'button';
            button.addEventListener('click', () => { if (!busy) searchClinics(candidate); });
            $('clinicCandidates').append(button);
        });
    } catch {
        if (op.id === generation) status(navigator.onLine ? 'Сервис адресов временно недоступен. Попробуйте ещё раз или разрешите геопозицию.' : 'Нет интернета. Для поиска клиник нужно подключение к сети.', 'error');
    } finally { if (op.id === generation) setBusy(false); }
}

function showLocationPermission(state) {
    $('clinicLocateButton').textContent = state === 'granted' ? '⌖ Обновить геопозицию' : '⌖ Разрешить геопозицию';
    $('clinicLocationStatus').textContent = state === 'granted' ? 'Доступ к геопозиции разрешён.' : state === 'denied'
        ? 'Доступ запрещён. Разрешите геопозицию в настройках сайта в браузере или введите адрес.'
        : 'Разрешите доступ, чтобы показать ваше местоположение и клиники рядом.';
}
async function checkLocationPermission() {
    if (!navigator.permissions?.query) return;
    try {
        const permission = locationPermission || await navigator.permissions.query({ name: 'geolocation' });
        locationPermission = permission;
        const changed = () => {
            showLocationPermission(permission.state);
            if (permission.state === 'granted' && !center && !busy && $('clinicsPage').offsetParent) locate();
        };
        permission.onchange = changed;
        changed();
    } catch { /* Safari and local-file modes can lack the Permissions API. The button still works. */ }
}
function locate() {
    if (busy) return;
    if (!navigator.geolocation || !window.isSecureContext) { status('Определение местоположения здесь недоступно. Введите адрес вручную.', 'error'); return; }
    const op = startOperation('Определяю местоположение. Разрешите доступ в окне браузера…');
    navigator.geolocation.getCurrentPosition(position => {
        if (op.id !== generation) return;
        setBusy(false);
        $('clinicLocateButton').textContent = '⌖ Обновить геопозицию';
        $('clinicLocationStatus').textContent = `Геопозиция определена. Точность — около ${Math.round(position.coords.accuracy)} м.`;
        searchClinics({ lat: position.coords.latitude, lon: position.coords.longitude,
            label: 'Рядом с вами', accuracy: position.coords.accuracy, fromGeolocation: true });
    }, error => {
        if (op.id !== generation) return;
        setBusy(false);
        status(error.code === 1 ? 'Доступ к геолокации запрещён. Разрешите его в настройках браузера или введите адрес.' : 'Не удалось определить местоположение. Введите город и адрес вручную.', 'error');
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 });
}

async function getClinics(point, radius, signal) {
    const key = `${point.lat.toFixed(4)},${point.lon.toFixed(4)},${radius}`;
    const saved = cache.get(key);
    if (saved && Date.now() - saved.time < 15 * 60000) return saved;
    if (!requestDirectory || signal.aborted) throw new Error('Directory unavailable');
    const grant = await requestDirectory({ action: 'reserve', lat: point.lat, lon: point.lon, radius: radius * 1000 }, signal);
    let result, upstreamStatus = 200;
    try {
        if (grant.cached) result = { elements: grant.cached.elements, time: grant.cached.fetchedAt, timestamp: '' };
        else {
            const url = new URL(grant.url);
            if (url.protocol !== 'https:' || !['nominatim.openstreetmap.org', 'qexiyikdmdbdxgusqnee.supabase.co'].includes(url.hostname)) throw new Error('Invalid directory source');
            const data = await jsonRequest(url.href, signal, 15000);
            if (!Array.isArray(data)) throw new Error('Invalid directory response');
            result = { elements: nominatimElements(data), time: Date.now(), timestamp: '' };
        }
    } catch (error) { upstreamStatus = signal.aborted ? 499 : error.status || 0; throw error; }
    finally {
        if (grant.lease) {
            // Release even after a cancelled search, so another user can search next.
            const release = new AbortController();
            const deadline = setTimeout(() => release.abort(), 5000);
            requestDirectory({ action: 'finish', key: grant.key, lease: grant.lease, status: upstreamStatus }, release.signal)
                .catch(() => {}).finally(() => clearTimeout(deadline));
        }
    }
    if (cache.size >= 12) cache.delete(cache.keys().next().value);
    cache.set(key, result);
    return result;
}

async function searchClinics(point = center) {
    if (!point || busy) return;
    if (!navigator.onLine) { status('Нет интернета. Подключитесь к сети и повторите поиск.', 'error'); return; }
    const op = startOperation('Ищу ветеринарные клиники поблизости…');
    const radius = [3, 5, 10, 15].includes(Number($('clinicRadius').value)) ? Number($('clinicRadius').value) : 5;
    center = point;
    records = [];
    searched = false;
    $('clinicCandidates').replaceChildren();
    $('clinicResults').replaceChildren();
    $('clinicResultSummary').textContent = '';
    $('clinicAreaLabel').textContent = `${point.label} · радиус ${radius} км${point.accuracy > 1000 ? ' · местоположение определено приблизительно' : ''}`;
    $('clinicRefresh').hidden = false;
    updateAlternative();
    mapRadius = radius;
    selectedMapId = point.fromGeolocation ? '__location__' : null;
    mapFrame?.remove(); mapFrame = null;
    $('clinicMapControls').hidden = true;
    $('clinicMap').replaceChildren(element('div', 'clinic-map-empty', 'Ищу клиники для отображения на карте…'));
    if (point.fromGeolocation) renderMap();
    try {
        const data = await getClinics(point, radius, op.signal);
        if (op.id !== generation) return;
        records = clinicsFrom(data.elements, point, radius, tzlookup);
        fetchedAt = data.time;
        dataTimestamp = data.timestamp;
        searched = true;
        status('Клиники отсортированы по расстоянию. Перед поездкой уточните приём по телефону.');
        render();
    } catch (error) {
        if (op.id !== generation) return;
        status(error.status === 429 ? 'Справочник занят. Подождите немного и нажмите «Повторить поиск».' : error.status === 401 ? 'Войдите в аккаунт заново, чтобы продолжить поиск.' : 'Не удалось загрузить справочник клиник. Попробуйте поиск ещё раз или откройте Яндекс Карты по ссылке ниже.', 'error');
    } finally { if (op.id === generation) setBusy(false); }
}

function showMap(point, radius, clinicName = '') {
    const zoom = clinicName ? 16 : radius <= 5 ? 13 : 12;
    const url = new URL('https://yandex.ru/map-widget/v1/');
    url.searchParams.set('ll', `${point.lon},${point.lat}`);
    url.searchParams.set('z', String(zoom));
    url.searchParams.set('lang', 'ru_RU');
    url.searchParams.set('mode', 'whatshere');
    url.searchParams.set('whatshere[point]', `${point.lon},${point.lat}`);
    url.searchParams.set('whatshere[zoom]', String(zoom));
    if (!mapFrame) {
        const frame = element('iframe', 'clinic-yandex-map');
        frame.loading = 'lazy';
        frame.referrerPolicy = 'strict-origin-when-cross-origin';
        frame.allowFullscreen = true;
        frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation');
        frame.addEventListener('error', () => {
            if (mapFrame === frame) $('clinicMapNote').textContent = 'Карта не загрузилась. Телефоны и маршруты доступны в карточках ниже.';
        });
        $('clinicMap').replaceChildren(frame);
        mapFrame = frame;
    }
    mapFrame.title = clinicName ? `Яндекс Карты: ${clinicName}` : point.fromGeolocation ? 'Яндекс Карты: моя геопозиция' : 'Яндекс Карты: область поиска';
    if (mapFrame.getAttribute('src') !== url.href) mapFrame.src = url.href;
    $('clinicMapNote').textContent = clinicName ? `На карте: ${clinicName}. Выберите другую клинику в списке над картой или кнопкой «На карте».`
        : point.fromGeolocation ? `Ваша геопозиция. Точность — около ${Math.round(point.accuracy)} м. Клиники рядом появятся в списке.` : 'Яндекс Карты · центр области поиска.';
}

function renderMap() {
    if (!center) return;
    const visible = filtered();
    const ownPosition = center.fromGeolocation && selectedMapId === '__location__';
    const selected = ownPosition ? null : visible.find(clinic => clinic.id === selectedMapId) || visible[0];
    selectedMapId = ownPosition ? '__location__' : selected?.id || null;
    const select = $('clinicMapSelect');
    const choices = visible.map((clinic, index) => {
        const option = element('option', '', `${index + 1}. ${clinic.name}`);
        option.value = clinic.id;
        option.selected = clinic.id === selectedMapId;
        return option;
    });
    if (center.fromGeolocation) {
        const ownOption = element('option', '', 'Моя геопозиция');
        ownOption.value = '__location__'; ownOption.selected = ownPosition;
        choices.unshift(ownOption);
    }
    select.replaceChildren(...choices);
    $('clinicMapControls').hidden = !choices.length;
    showMap(selected || center, mapRadius, selected?.name || '');
}

function filtered() {
    return records.map(clinic => ({ ...clinic, state: hoursStatus(clinic.hours, clinic.timeZone) }))
        .filter(c => (!$('clinicOpenOnly').checked || c.state === 'open') && (!$('clinicPhoneOnly').checked || c.phones.length));
}
const stateLabel = state => state === 'open' ? 'Открыто по графику' : state === 'closed' ? 'Закрыто по графику' : 'Уточните часы работы';
const routeUrl = c => `https://yandex.ru/maps/?rtext=~${c.lat},${c.lon}&rtt=auto`;
function render() {
    if (!searched) return;
    const visible = filtered();
    const unknown = records.filter(c => hoursStatus(c.hours, c.timeZone) === 'unknown').length;
    const missingPhone = records.filter(c => !c.phones.length).length;
    $('clinicResultSummary').textContent = `Показано ${visible.length} из ${records.length}. ${unknown ? `Для ${unknown} нет точного графика. ` : ''}${missingPhone ? `У ${missingPhone} не указан телефон. ` : ''}Проверено в ${new Date(fetchedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}.`;
    $('clinicResults').replaceChildren();
    visible.forEach((c, index) => {
        const card = element('article', 'clinic-card');
        const top = element('div', 'clinic-card-top');
        const badge = element('span', 'clinic-badge', stateLabel(c.state)); badge.dataset.state = c.state;
        top.append(badge, element('span', 'clinic-distance', `${c.distance < 1 ? `${Math.round(c.distance * 1000)} м` : `${c.distance.toFixed(1)} км`} по прямой`));
        card.append(top, element('h4', '', `${index + 1}. ${c.name}`), element('p', '', c.address));
        const phones = element('div', 'clinic-phones');
        c.phones.forEach(p => phones.append(link(p.label, p.href)));
        if (!c.phones.length) phones.append(element('p', '', 'Телефон не указан в справочнике'));
        card.append(phones);
        const schedule = element('details');
        schedule.append(element('summary', '', c.hours === '24/7' ? 'Работает круглосуточно' : 'Часы работы'), element('p', '', readableHours(c.hours)));
        if (c.timeZone) schedule.append(element('p', '', `Местное время клиники: ${new Date().toLocaleTimeString('ru-RU', { timeZone: c.timeZone, hour: '2-digit', minute: '2-digit' })}`));
        card.append(schedule);
        const actions = element('div', 'clinic-card-actions');
        const onMap = element('button', '', 'На карте'); onMap.type = 'button';
        onMap.addEventListener('click', () => {
            selectedMapId = c.id;
            renderMap();
            $('clinicMap').scrollIntoView({ block: 'center', behavior: 'instant' });
        });
        actions.append(onMap, link('Маршрут ↗', routeUrl(c)), link('В справочнике ↗', `https://www.openstreetmap.org/${c.id}`));
        card.append(actions); $('clinicResults').append(card);
    });
    if (!visible.length) {
        const empty = element('div', 'clinic-empty');
        empty.append(element('strong', '', records.length ? 'Нет клиник с такими условиями' : 'В этом радиусе клиники не найдены'),
            element('span', '', records.length ? 'Можно показать все найденные клиники и уточнить график или телефон в справочнике.' : 'Увеличьте радиус поиска или выберите другой адрес. В справочнике могут быть указаны не все клиники.'));
        if (records.length) {
            const all = element('button', 'clinic-button', 'Показать все найденные'); all.type = 'button';
            all.addEventListener('click', () => { $('clinicOpenOnly').checked = false; $('clinicPhoneOnly').checked = false; render(); });
            empty.append(all);
        }
        $('clinicResults').append(empty);
    }
    renderMap();
    const date = new Date(dataTimestamp);
    $('clinicDataDate').textContent = Number.isNaN(date.getTime()) ? '' : ` Состояние базы: ${date.toLocaleDateString('ru-RU')}.`;
}
function updateAlternative() {
    const url = new URL('https://yandex.ru/maps/');
    url.searchParams.set('text', 'ветеринарные клиники');
    if (center) { url.searchParams.set('ll', `${center.lon},${center.lat}`); url.searchParams.set('z', '13'); }
    $('clinicExternalSearch').href = url.href;
}
export function open(options = {}) {
    if (typeof options.requestDirectory === 'function') requestDirectory = options.requestDirectory;
    if (!initialized) {
        initialized = true;
        $('clinicSearchForm').addEventListener('submit', searchAddress);
        $('clinicLocateButton').addEventListener('click', locate);
        $('clinicCancel').addEventListener('click', cancel);
        $('clinicRefresh').addEventListener('click', () => searchClinics());
        $('clinicRadius').addEventListener('change', () => { if (center) searchClinics(); });
        $('clinicMapSelect').addEventListener('change', event => { selectedMapId = event.target.value; renderMap(); });
        ['clinicOpenOnly', 'clinicPhoneOnly'].forEach(id => $(id).addEventListener('change', render));
        document.addEventListener('visibilitychange', () => { if (!document.hidden && $('clinicsPage').offsetParent && !busy) render(); });
        window.addEventListener('petcare:clinics-close', close);
        window.addEventListener('petcare:account-reset', reset);
    }
    clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden && $('clinicsPage').offsetParent && !busy) render(); }, 60000);
    if (searched) render();
    $('clinicAddress').focus({ preventScroll: true });
    checkLocationPermission();
}
function close() { cancel(); clearInterval(timer); timer = null; }
function reset() {
    close(); cache.clear(); center = null; records = []; searched = false; fetchedAt = 0; dataTimestamp = '';
    mapFrame?.remove(); mapFrame = null; selectedMapId = null; mapRadius = 5;
    $('clinicMapControls').hidden = true;
    $('clinicMapSelect').replaceChildren();
    $('clinicAddress').value = '';
    $('clinicRadius').value = '5';
    $('clinicOpenOnly').checked = true; $('clinicPhoneOnly').checked = true;
    ['clinicCandidates', 'clinicResults'].forEach(id => $(id).replaceChildren());
    ['clinicAreaLabel', 'clinicResultSummary', 'clinicDataDate'].forEach(id => { $(id).textContent = ''; });
    $('clinicRefresh').hidden = true;
    const placeholder = element('div', 'clinic-map-empty', 'Выберите место для поиска клиник');
    $('clinicMap').replaceChildren(placeholder);
    status(INITIAL_MESSAGE); updateAlternative();
    showLocationPermission(locationPermission?.state || 'prompt');
}
