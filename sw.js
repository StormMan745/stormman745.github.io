const CACHE_NAME = "petcare-shell-v62-optional-memory-dates";
const SHELL_FILES = [
    "/",
    "/index.html",
    "/app.bundle.js",
    "/app.bundle.css",
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

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(SHELL_FILES))
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
    if (request.method !== "GET" || url.origin !== self.location.origin) return;

    // The version-pinned renderer is downloaded once, only when a model is visible.
    if (url.pathname.startsWith('/assets/vendor/')) {
        event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
            if (response.ok) { const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(request, copy)); }
            return response;
        })));
        return;
    }

    if (request.mode === "navigate") {
        event.respondWith(
            fetch(request)
                .then(response => {
                    if (response.ok) {
                        const copy = response.clone();
                        const key = url.pathname === "/" || url.pathname === "/index.html" ? "/index.html" : url.pathname;
                        caches.open(CACHE_NAME).then(cache => cache.put(key, copy));
                    }
                    return response;
                })
                .catch(async () => (await caches.match(request)) || (await caches.match(url.pathname === "/" ? "/index.html" : url.pathname)) || new Response("Нет связи. Откройте PetCare один раз при наличии интернета.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }))
        );
        return;
    }

    event.respondWith(
        fetch(request)
            .then(response => {
                if (response.ok && url.pathname.startsWith("/assets/")) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
                }
                return response;
            })
            .catch(async () => (await caches.match(request)) || (await caches.match(url.pathname)))
    );
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
