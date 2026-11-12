// Public embedded directories; business details stay with the selected map provider.
const $ = id => document.getElementById(id);
let initialized = false, point = null, address = '', mapMode = '__results__';
let mapFrame = null, permission = null, generation = 0, lastSearch = 0;
let locationRequest = null, locationAttempted = false;
let country = 'RU';
const countryCodes = new Set('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' '));
const countryNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['ru'], { type: 'region' }) : null;
const englishNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
const googleQueries = Object.freeze({ clinics: 'veterinary clinics', hospital: '24 hour emergency veterinarian', vaccination: 'veterinary vaccination', walking: 'dog parks', shelters: 'animal shelters', hotels: 'pet boarding' });
const provider = () => country === 'RU' ? 'Яндекс Карты' : 'Google Карты';
const savedCountry = () => typeof appData !== 'undefined' && countryCodes.has(appData.mapCountry) ? appData.mapCountry : 'RU';
function placeholder(message = 'Разрешите геопозицию или укажите адрес.') {
    removeMap();
    ['clinicMapControls', 'clinicLocationLegend', 'clinicRefresh'].forEach(id => { $(id).hidden = true; });
    ['clinicAreaLabel', 'clinicResultSummary'].forEach(id => { $(id).textContent = ''; });
    $('clinicMapNote').textContent = 'Подробности откроются в карточке выбранного места.';
    const empty = document.createElement('div'); empty.className = 'clinic-map-empty';
    empty.textContent = `${provider()} · ${message}`; $('clinicMap').replaceChildren(empty);
}
function updateProvider() {
    $('clinicCountry').value = country;
    $('clinicProviderName').textContent = provider();
    $('clinicProviderIcon').textContent = country === 'RU' ? 'Я' : 'G';
    $('clinicProviderLink').href = country === 'RU' ? 'https://yandex.ru/maps/' : 'https://www.google.com/maps/';
    $('clinicProviderLink').setAttribute('aria-label', `Открыть ${provider()}`);
    $('clinicDirectoryTitle').textContent = `Справочник: ${provider()}`;
    $('clinicMap').setAttribute('aria-label', `Встроенная карта: ${provider()}`);
    $('clinicPrivacy').textContent = `Для поиска адрес или координаты передаются в ${provider()}. В профиле сохраняется только выбор страны, без местоположения.`;
    $('clinicExternalSearch').textContent = `Открыть поиск в ${provider()} ↗`;
    $('clinicSource').textContent = provider(); $('clinicSource').href = $('clinicProviderLink').href;
    $('clinicCategory').querySelector('[value="vaccination"]').textContent = country === 'RU' ? 'Пункты бесплатной вакцинации' : 'Вакцинация животных';
    $('clinicMapSelect').options[0].textContent = country === 'RU' ? 'Места и моя геопозиция' : 'Места рядом';
    $('clinicAddress').placeholder = country === 'RU' ? 'Например: Москва, Тверская 10' : 'Город, улица и номер дома';
    updateCategoryControls();
}
function changeCountry() {
    country = countryCodes.has($('clinicCountry').value) ? $('clinicCountry').value : 'RU';
    mapMode = '__results__'; updateProvider(); renderMap();
    if (typeof activeUserId !== 'undefined' && activeUserId) {
        appData.mapCountry = country;
        const token = generation;
        saveData().catch(() => { if (generation === token) status('Страна выбрана, но сохранить её не удалось. Повторите выбор.', 'error'); });
    }
}
const categories = Object.freeze({
    clinics: { query: 'ветеринарные клиники', label: 'ветеринарные клиники', mapLayer: 0, openOnly: true },
    hospital: { query: 'круглосуточные ветеринарные стационары', label: 'круглосуточные стационары', mapLayer: 1, openOnly: false },
    vaccination: { query: 'пункты бесплатной вакцинации животных от бешенства', label: 'пункты бесплатной вакцинации', mapLayer: 2, openOnly: false },
    walking: { query: 'площадки для выгула собак', label: 'площадки для выгула собак', mapLayer: 3, openOnly: false },
    shelters: { query: 'приюты для животных', label: 'приюты для животных', mapLayer: 4, openOnly: false },
    hotels: { query: 'зоогостиницы', label: 'зоогостиницы', mapLayer: 5, openOnly: true }
});
function currentCategory() { return categories[$('clinicCategory')?.value] || categories.clinics; }

function status(message, kind = '') {
    $('clinicStatus').textContent = message;
    $('clinicStatus').dataset.kind = kind;
}
function busy(value) {
    ['clinicSearchButton', 'clinicCategory'].forEach(id => { $(id).disabled = value; });
    $('clinicLocateButton').disabled = value || locationRequest !== null;
    $('clinicCancel').hidden = !value;
    $('clinicSearchPanel').setAttribute('aria-busy', String(value));
}
function isBusy() { return $('clinicSearchPanel').getAttribute('aria-busy') === 'true'; }
function removeMap() { mapFrame?.remove(); mapFrame = null; }
function externalUrl() {
    if (country !== 'RU') {
        const url = new URL('https://www.google.com/maps/search/'); url.searchParams.set('api', '1');
        const near = mapMode === '__location__' && point;
        const category = currentCategory();
        const query = googleQueries[$('clinicCategory').value] || googleQueries.clinics;
        const area = address ? `${address}, ${englishNames?.of(country) || country}` : point ? `${point.lat},${point.lon}` : englishNames?.of(country) || country;
        url.searchParams.set('query', near ? `${point.lat},${point.lon}` : `${query}${category.openOnly && $('clinicOpenOnly').checked ? ' open now' : ''} near ${area}`);
        return url;
    }
    const url = new URL('https://yandex.ru/maps/');
    const category = currentCategory();
    const searchAddress = mapMode === '__location__' ? '' : address;
    const query = `${category.query}${category.openOnly && $('clinicOpenOnly').checked ? ' открыто сейчас' : ''}${searchAddress ? ` рядом с ${searchAddress}` : ''}`;
    url.searchParams.set('text', query);
    if (point) {
        url.searchParams.set('pt', `${point.lon},${point.lat},pm2blm`);
        if (!searchAddress) {
            url.searchParams.set('ll', `${point.lon},${point.lat}`);
            url.searchParams.set('z', mapMode === '__location__' ? '16' : '13');
            // Keep the initial search area around the device instead of a single result.
            url.searchParams.set('spn', mapMode === '__location__' ? '0.015,0.01' : '0.12,0.08');
        }
    }
    return url;
}
function updateCategoryControls() {
    const category = currentCategory();
    $('clinicOpenOnlyLabel').hidden = !category.openOnly;
    $('clinicExternalSearch').href = externalUrl().href;
    $('clinicOfficialMap').hidden = country !== 'RU';
    $('clinicOfficialMap').href = `https://www.mos.ru/pgu/ru/app/dvm/mypets/?page=info&map_layer=${category.mapLayer}`;
    $('clinicOfficialMap').textContent = `Городская карта: ${category.label} ↗`;
    $('clinicOfficialList').hidden = country !== 'RU' || $('clinicCategory').value !== 'vaccination';
}
function renderMap() {
    if (!point && !address && country === 'RU') { placeholder(); status('Укажите адрес или разрешите геопозицию для поиска.'); return; }
    removeMap();
    const ownLocation = point && mapMode === '__location__';
    const searchUrl = externalUrl();
    const url = new URL(country === 'RU' ? 'https://yandex.ru/map-widget/v1/' : 'https://maps.google.com/maps');
    if (country === 'RU') {
        url.searchParams.set('lang', 'ru_RU'); url.searchParams.set('mode', 'search');
        for (const key of ['text', 'll', 'z', 'pt', 'spn']) if (searchUrl.searchParams.has(key)) url.searchParams.set(key, searchUrl.searchParams.get(key));
    } else {
        // The public widget renders the same query as the full Google Maps link.
        // Unlike Yandex, it cannot add a separate custom GPS pin over search results.
        url.searchParams.set('output', 'embed'); url.searchParams.set('hl', 'ru'); url.searchParams.set('gl', country.toLowerCase());
        url.searchParams.set('q', searchUrl.searchParams.get('query'));
        if (point && (ownLocation || !address)) { url.searchParams.set('ll', `${point.lat},${point.lon}`); url.searchParams.set('z', ownLocation ? '16' : '13'); }
    }
    const frame = document.createElement('iframe');
    frame.className = `clinic-provider-map ${country === 'RU' ? 'clinic-yandex-map' : 'clinic-google-map'}`;
    frame.title = `${provider()} — ${ownLocation ? 'моё местоположение' : currentCategory().label}`;
    frame.referrerPolicy = 'no-referrer';
    frame.allowFullscreen = true;
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox');
    frame.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'; clipboard-write 'none'");
    frame.addEventListener('load', () => {
        if (mapFrame !== frame) return;
        busy(false);
        status(ownLocation ? 'На карте — ваше местоположение. Вернитесь к местам через переключатель над картой.' : `На карте: ${currentCategory().label}.${point ? country === 'RU' ? ' Синяя метка — ваше местоположение.' : ' Геопозиция доступна через «Приблизить меня».' : ' Разрешите геопозицию для поиска рядом с вами.'}`);
    });
    frame.addEventListener('error', () => {
        if (mapFrame !== frame) return;
        busy(false);
        status(`Не удалось загрузить ${provider()}. Проверьте интернет или откройте поиск по ссылке ниже.`, 'error');
    });
    mapFrame = frame;
    $('clinicMap').replaceChildren(frame);
    frame.src = url.href;
    $('clinicMapControls').hidden = !point;
    $('clinicLocationLegend').hidden = !point || country !== 'RU';
    $('clinicMapSelect').value = mapMode;
    $('clinicRefresh').hidden = false;
    $('clinicAreaLabel').textContent = address && !ownLocation ? `Поиск по адресу: ${address}` : point ? `Рядом с вами · точность около ${Math.round(point.accuracy)} м` : `Страна поиска: ${countryNames?.of(country) || country}`;
    $('clinicResultSummary').textContent = `Поиск: ${currentCategory().label}. Источник: ${provider()}.`;
    $('clinicMapNote').textContent = country === 'RU' ? `${point ? 'Синяя метка — вы. ' : ''}Нажмите на метку места, чтобы открыть его карточку и маршрут.` : `${point ? '«Приблизить меня» показывает вашу точку отдельно от мест. ' : ''}Карточки мест, телефоны и маршруты доступны по кнопке «Открыть в Картах» внутри карты или по ссылке ниже.`;
    $('clinicExternalSearch').href = externalUrl().href;
    busy(false);
    $('clinicCancel').hidden = false;
    status(`Открываю ${provider()}…`, 'loading');
}
function search(event) {
    event?.preventDefault();
    if (isBusy()) return;
    const query = $('clinicAddress').value.trim();
    if (query.length < 3) { status('Укажите город и адрес — не менее трёх символов.'); $('clinicAddress').focus(); return; }
    if (Date.now() - lastSearch < 700) return;
    if (!navigator.onLine) { status('Нет интернета. Для поиска мест нужно подключение к сети.', 'error'); return; }
    lastSearch = Date.now();
    address = query; mapMode = '__results__';
    renderMap();
    // Safari and installed mobile apps may have no Permissions API. Request GPS
    // from this user gesture; keep address results usable while permission is pending.
    if (!point && !locationAttempted) locate({ background: true });
}
function permissionUi(state) {
    $('clinicLocateButton').textContent = state === 'granted' ? '⌖ Обновить геопозицию' : '⌖ Разрешить геопозицию';
    $('clinicLocationStatus').textContent = state === 'granted' ? 'Доступ к геопозиции разрешён.' : state === 'denied'
        ? 'Доступ запрещён. Разрешите геопозицию в настройках сайта в браузере или введите адрес.'
        : 'Разрешите доступ, чтобы найти места рядом с вами.';
}
async function checkPermission() {
    if (window.PetCareNative) {
        const token = generation;
        try {
            const state = await window.PetCareNative.checkLocationPermission();
            if (token !== generation || !$('clinicsPage').offsetParent) return;
            permissionUi(state);
            if (state === 'granted' && !point && !isBusy()) locate();
        } catch { if (token === generation) permissionUi('prompt'); }
        return;
    }
    if (!navigator.permissions?.query) return;
    try {
        permission = permission || await navigator.permissions.query({ name: 'geolocation' });
        const changed = () => {
            permissionUi(permission.state);
            if (permission.state === 'granted' && !point && !isBusy() && $('clinicsPage').offsetParent) locate();
        };
        permission.onchange = changed; changed();
    } catch { /* The request button also works without the Permissions API. */ }
}
function locate({ background = false } = {}) {
    if (isBusy() || locationRequest !== null) return;
    locationAttempted = true;
    if (!window.PetCareNative && (!navigator.geolocation || !window.isSecureContext)) {
        $('clinicLocationStatus').textContent = 'Геопозиция недоступна. Введите адрес вручную.';
        if (!background) status('Геопозиция недоступна. Введите адрес вручную.', 'error');
        return;
    }
    const token = ++generation;
    locationRequest = token;
    $('clinicLocateButton').disabled = true;
    $('clinicLocationStatus').textContent = 'Определяем ваше местоположение. Разрешите геопозицию в окне браузера.';
    if (!background) { busy(true); status('Разрешите определение геопозиции в окне браузера…', 'loading'); }
    const geolocation = window.PetCareNative || navigator.geolocation;
    const failed = error => {
        if (token !== generation) return;
        locationRequest = null;
        busy(false);
        const message = error.code === 1 ? 'Доступ к геопозиции запрещён. Разрешите его в настройках браузера или введите адрес.'
            : 'Не удалось определить местоположение. Повторите геопозицию или введите город и адрес вручную.';
        $('clinicLocationStatus').textContent = message;
        if (!background) status(message, 'error');
    };
    const found = position => {
        if (token !== generation) return;
        const coords = position?.coords;
        if (!coords || !Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude) || Math.abs(coords.latitude) > 90 || Math.abs(coords.longitude) > 180) {
            failed({ code: 2 }); return;
        }
        locationRequest = null;
        point = { lat: coords.latitude, lon: coords.longitude, accuracy: coords.accuracy };
        if (!background) mapMode = '__results__';
        $('clinicLocateButton').textContent = '⌖ Обновить геопозицию';
        $('clinicLocationStatus').textContent = `Геопозиция определена. Точность — около ${Math.round(coords.accuracy)} м.`;
        renderMap();
    };
    try { geolocation.getCurrentPosition(found, failed, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }); }
    catch { failed({ code: 2 }); }
}
function cancel() {
    generation++; locationRequest = null; locationAttempted = false; busy(false); removeMap();
    placeholder('Поиск отменён');
    status('Поиск отменён. Можно указать другой адрес или повторить поиск.');
}
export function open() {
    if (!initialized) {
        initialized = true;
        const entries = [...countryCodes].map(code => [code, countryNames?.of(code) || code]).sort((a,b) => a[0] === 'RU' ? -1 : b[0] === 'RU' ? 1 : a[1].localeCompare(b[1], 'ru'));
        for (const [code, label] of entries) $('clinicCountry').add(new Option(label, code));
        $('clinicCountry').addEventListener('change', changeCountry);
        $('clinicSearchForm').addEventListener('submit', search);
        $('clinicLocateButton').addEventListener('click', locate);
        $('clinicCancel').addEventListener('click', cancel);
        $('clinicRefresh').addEventListener('click', () => { if (!isBusy()) renderMap(); });
        $('clinicOpenOnly').addEventListener('change', () => { if (point || address) { mapMode = '__results__'; renderMap(); } });
        $('clinicCategory').addEventListener('change', () => { updateCategoryControls(); if (point || address) { mapMode = '__results__'; renderMap(); } });
        $('clinicMapSelect').addEventListener('change', event => { mapMode = event.target.value; renderMap(); });
        window.addEventListener('petcare:clinics-close', close);
        window.addEventListener('petcare:account-reset', reset);
        window.addEventListener('petcare:data-changed', () => {
            if (savedCountry() === country) return;
            country = savedCountry(); updateProvider();
            if ($('clinicsPage').offsetParent) renderMap();
        });
    }
    country = savedCountry(); updateProvider();
    if (point || address || country !== 'RU') renderMap(); else placeholder();
    $('clinicAddress').focus({ preventScroll: true });
    checkPermission();
}
function close() { generation++; locationRequest = null; locationAttempted = false; busy(false); removeMap(); }
function reset() {
    close(); point = null; address = ''; mapMode = '__results__'; lastSearch = 0; country = 'RU';
    $('clinicAddress').value = ''; $('clinicOpenOnly').checked = true; $('clinicCategory').value = 'clinics';
    $('clinicMapControls').hidden = true; $('clinicLocationLegend').hidden = true; $('clinicRefresh').hidden = true;
    ['clinicAreaLabel', 'clinicResultSummary'].forEach(id => { $(id).textContent = ''; });
    placeholder(); updateProvider();
    permissionUi(permission?.state || 'prompt');
    status('Выберите страну, укажите адрес или разрешите геопозицию для поиска.');
}
