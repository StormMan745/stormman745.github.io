const CACHE_NAME = "petcare-shell-692ac35d0dbf5220";
const SHELL_FILES = [
    "/index.html",
    "/app.bundle.js?v=c18ee549c011",
    "/app.bundle.css?v=1ac6acc83862",
    "/memories.bundle.js",
    "/vet.html",
    "/vet.js",
    "/vet.css",
    "/assets/vendor/supabase/supabase-2.118.0.min.js",
    "/document-print.html",
    "/document-print.bundle.js",
    "/document-print.css",
    "/install.js",
    "/clinics.bundle.js",
    "/frameguard.js",
    "/collar.html",
    "/collar.js",
    "/collar.css",
    "/assets/vendor/qrcode/qrcode-2.0.4.min.js",
    "/manifest.webmanifest",
    "/assets/petcare-192.png",
    "/assets/petcare-512.png",
    "/assets/apple-touch-icon.png"
];
const shellKeys = new Map(SHELL_FILES.map(key => [key.split("?")[0], key]));
const publicPages = new Set(["/", "/index.html", "/vet.html", "/collar.html", "/document-print.html"]);

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(SHELL_FILES.map(path => new Request(path, { cache: "reload" }))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys
                .filter(key => key.startsWith("petcare-shell-") && key !== CACHE_NAME)
                .map(key => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", event => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method !== "GET" || url.origin !== self.location.origin ||
        request.headers.has("Authorization") || request.headers.has("Range") || request.cache === "no-store") return;

    if (request.mode === "navigate") {
        if (!publicPages.has(url.pathname)) return;
        // Only the static document from installation is eligible for offline navigation.
        // An incoming link may contain an invitation or an Auth callback.
        event.respondWith(fetch(request).catch(async () => {
            const offline = await caches.open(CACHE_NAME)
                .then(cache => cache.match(url.pathname === "/" ? "/index.html" : url.pathname)).catch(() => undefined);
            return offline ||
                new Response("Нет связи. Откройте PetCare один раз при наличии интернета.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
        }));
        return;
    }

    const shellKey = shellKeys.get(url.pathname);
    const asset = url.pathname.startsWith("/assets/vendor/") || /^\/assets\/install-(desktop|mobile)\.jpg$/.test(url.pathname);
    if ((!shellKey && !asset) || (url.search && !/^\?v=[\w.-]+$/.test(url.search))) return;
    const useCached = asset || (shellKey?.includes("?v=") && shellKey === url.pathname + url.search);
    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME).catch(() => null);
        if (!cache) return fetch(request);
        const key = shellKey || url.pathname;
        if (useCached && request.cache !== "reload") {
            const hit = await cache.match(key);
            if (hit) return hit;
        }
        try {
            const response = await fetch(request);
            if (asset && response.ok && response.type === "basic" && !response.redirected &&
                !/\b(?:private|no-store)\b/i.test(response.headers.get("Cache-Control") || "")) {
                const copy = response.clone();
                event.waitUntil(cache.put(key, copy).catch(() => {}));
            }
            return response;
        } catch {
            return await cache.match(key) || Response.error();
        }
    })());
});

self.addEventListener("push", event => {
    let payload = {};
    try {
        payload = event.data ? event.data.json() : {};
    } catch {
        payload = { body: event.data?.text() || "У вас есть напоминание." };
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) payload = {};

    const title = typeof payload.title === "string" && payload.title.trim()
        ? payload.title.trim().slice(0, 100)
        : "Напоминание PetCare";
    const body = typeof payload.body === "string" && payload.body.trim()
        ? payload.body.trim().slice(0, 240)
        : "Проверьте напоминания о питомце.";

    event.waitUntil(self.registration.showNotification(title, {
        body,
        icon: "/assets/petcare-192.png",
        badge: "/assets/petcare-192.png",
        tag: String(payload.tag || "petcare-reminder").slice(0, 80),
        timestamp: Number(payload.timestamp) || Date.now(),
        data: { url: typeof payload.url === "string" ? payload.url : "/?page=reminders" },
        renotify: false,
        silent: false,
        vibrate: [180, 100, 180]
    }));
});

self.addEventListener("notificationclick", event => {
    event.notification.close();
    event.waitUntil((async () => {
        let targetUrl = new URL("/?page=reminders", self.location.origin);
        try {
            const requestedUrl = new URL(event.notification.data?.url || "/?page=reminders", self.location.origin);
            if (requestedUrl.origin === self.location.origin) targetUrl = requestedUrl;
        } catch {
            // Keep the same-origin reminders page as the safe fallback.
        }

        const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
        if (existing) {
            await existing.navigate(targetUrl.href);
            return existing.focus();
        }
        return self.clients.openWindow(targetUrl.href);
    })());
});
