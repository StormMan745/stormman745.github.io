// OSM weekly schedules. Unsupported calendar/holiday rules stay unknown, never "open".
const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const DAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const WEEK = 7 * 1440;

export function weeklySchedule(raw) {
    const text = String(raw || '').trim();
    if (text === '24/7') return [[0, WEEK]];
    if (!text || text.length > 500) return null;
    const days = Array.from({ length: 7 }, () => []);
    const ruleForDay = Array(7).fill(-1);
    const assigned = new Set();
    let ruleIndex = 0;
    for (const rule of text.split(';')) {
        const match = rule.trim().match(/^(?:(((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*[-,]\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))*)\s+))?(.+)$/);
        if (!match) return null;
        const selected = [];
        if (!match[2]) selected.push(0, 1, 2, 3, 4, 5, 6);
        else for (const group of match[2].replace(/\s/g, '').split(',')) {
            const range = group.split('-');
            if (range.length > 2) return null;
            const start = DAYS.indexOf(range[0]), end = DAYS.indexOf(range[1] || range[0]);
            if (start < 0 || end < 0) return null;
            for (let d = start; ; d = (d + 1) % 7) { selected.push(d); if (d === end) break; }
        }
        // Overlapping rules have override and overnight semantics. Don't guess them.
        if (selected.some(d => assigned.has(d))) return null;
        selected.forEach(d => assigned.add(d));
        const ranges = [];
        if (!/^(off|closed)$/.test(match[3])) {
            for (const part of match[3].split(',')) {
                const time = part.trim().match(/^(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})$/);
                if (!time) return null;
                const [, ah, am, bh, bm] = time.map(Number);
                if (ah > 23 || am > 59 || bh > 24 || bm > 59 || (bh === 24 && bm !== 0)) return null;
                const start = ah * 60 + am;
                let end = bh * 60 + bm;
                if (end === start) return null;
                if (end < start) end += 1440;
                ranges.push([start, end]);
            }
        }
        selected.forEach(d => { days[d] = ranges; ruleForDay[d] = ruleIndex; });
        ruleIndex++;
    }
    // A later day rule may override the previous night's spill. Treat as unknown.
    if (days.some((ranges, d) => ranges.some(([, end]) => end > 1440)
        && ruleForDay[(d + 1) % 7] !== -1 && ruleForDay[(d + 1) % 7] !== ruleForDay[d])) return null;
    const intervals = [];
    days.forEach((ranges, d) => ranges.forEach(([s, e]) => {
        const start = d * 1440 + s, end = d * 1440 + e;
        intervals.push([start, Math.min(end, WEEK)]);
        if (end > WEEK) intervals.push([0, end - WEEK]);
    }));
    return intervals;
}

export function hoursStatus(raw, timeZone, date = new Date()) {
    const schedule = weeklySchedule(raw);
    if (!schedule || !timeZone) return 'unknown';
    try {
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
            timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
        }).formatToParts(date).map(p => [p.type, p.value]));
        const d = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday);
        const minute = d * 1440 + Number(parts.hour) * 60 + Number(parts.minute);
        return schedule.some(([s, e]) => minute >= s && minute < e) ? 'open' : 'closed';
    } catch { return 'unknown'; }
}

export function readableHours(raw) {
    if (raw === '24/7') return 'Круглосуточно, без выходных';
    if (!raw) return 'График не указан';
    return String(raw).replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su)\b/g, day => DAY_LABELS[DAYS.indexOf(day)])
        .replace(/\b(off|closed)\b/g, 'выходной').replace(/\bPH\b/g, 'праздники').replace(/;/g, '; ');
}

export function distanceKm(a, b) {
    const r = Math.PI / 180;
    const x = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lon - a.lon) * r / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
}

export function phonesFrom(tags) {
    return [...new Set([tags.phone, tags['contact:phone'], tags.mobile, tags['contact:mobile']]
        .filter(v => typeof v === 'string').flatMap(v => v.split(/[;,]/)).map(v => v.trim()))]
        .filter(v => /^[+\d\s().-]+$/.test(v) && v.replace(/\D/g, '').length >= 7 && v.replace(/\D/g, '').length <= 15)
        .slice(0, 4).map(label => ({ label, href: `tel:${label.replace(/[^+\d]/g, '')}` }));
}

export function clinicsFrom(elements, center, radius, timezoneLookup) {
    const seen = new Set();
    return elements.flatMap(item => {
        const tags = item.tags || {}, lat = item.lat ?? item.center?.lat, lon = item.lon ?? item.center?.lon;
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !Number.isSafeInteger(item.id) || item.id <= 0 || !['node', 'way', 'relation'].includes(item.type)) return [];
        if (tags.amenity !== 'veterinary' && tags.healthcare !== 'veterinary') return [];
        if (['yes', 'true', '1'].includes(tags.disused) || ['yes', 'true', '1'].includes(tags.abandoned)) return [];
        const distance = distanceKm(center, { lat, lon });
        if (distance > radius + .05) return [];
        const name = String(tags['name:ru'] || tags.name || tags.operator || 'Ветеринарная клиника').slice(0, 180);
        const phones = phonesFrom(tags);
        const id = `${item.type}/${item.id}`;
        if (seen.has(id)) return [];
        seen.add(id);
        let timeZone;
        try { timeZone = timezoneLookup(lat, lon); } catch { /* Status remains unknown. */ }
        const address = tags['addr:full'] || [tags['addr:city'], [tags['addr:street'] || tags['addr:place'], tags['addr:housenumber']].filter(Boolean).join(', ')].filter(Boolean).join(', ');
        return [{ id, name, lat, lon, distance, phones, timeZone,
            address: String(address || 'Адрес не указан — смотрите точку на карте').slice(0, 350),
            hours: typeof tags.opening_hours === 'string' ? tags.opening_hours.slice(0, 500) : '' }];
    }).sort((a, b) => a.distance - b.distance);
}

export function nominatimElements(items) {
    if (!Array.isArray(items)) return [];
    const keys = ['phone', 'contact:phone', 'mobile', 'contact:mobile', 'opening_hours', 'disused', 'abandoned'];
    return items.filter(item => item && item.type === 'veterinary' && ['amenity', 'healthcare'].includes(item.category || item.class)).slice(0, 40).map(item => ({
        id: item.osm_id, type: item.osm_type, lat: Number(item.lat), lon: Number(item.lon),
        tags: { ...Object.fromEntries(Object.entries(item.extratags || {}).filter(([key]) => keys.includes(key))),
            amenity: 'veterinary', name: item.name || item.address?.amenity || '',
            'addr:city': item.address?.city || item.address?.town || item.address?.village || '',
            'addr:street': item.address?.road || '', 'addr:housenumber': item.address?.house_number || '' }
    }));
}

export function addressCandidates(features) {
    const seen = new Set();
    return features.flatMap(f => {
        const [lon, lat] = f.geometry?.coordinates || [], p = f.properties || {};
        if (f.geometry?.type !== 'Point' || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return [];
        const label = [...new Set([p.name, [p.street, p.housenumber].filter(Boolean).join(', '), p.city || p.town || p.village, p.state, p.country].filter(Boolean))].join(', ');
        const key = `${lat},${lon}`;
        if (!label || seen.has(key)) return [];
        seen.add(key);
        return [{ lat, lon, label: label.slice(0, 300) }];
    }).slice(0, 5);
}
