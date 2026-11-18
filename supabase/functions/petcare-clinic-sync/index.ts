Deno.serve(() => Response.json({ error: 'clinic_sync_disabled' }, {
    status: 410,
    headers: {
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; sandbox",
        'X-Content-Type-Options': 'nosniff',
    },
}));
