/* ================================================================
 *  dhSync Service Worker
 *  – App-shell caching for offline support
 *  – Push notification handling
 * ================================================================ */

const CACHE_NAME = 'dhsync-cache-v1';

/**
 * Static assets to pre-cache on install.
 * Vite hashed filenames change on every build, so we only pre-cache the
 * HTML shell and manifest here.  Runtime caching (below) handles JS/CSS
 * chunks automatically.
 */
const PRE_CACHE = ['/', '/manifest.json'];

/* ── Install ──────────────────────────────────── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRE_CACHE))
  );
  // Activate immediately instead of waiting for existing clients to close
  self.skipWaiting();
});

/* ── Activate ─────────────────────────────────── */
self.addEventListener('activate', (event) => {
  // Remove stale caches from previous versions
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  );
  // Start controlling all open tabs immediately
  self.clients.claim();
});

/* ── Fetch (network-first for API, cache-first for assets) ── */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin requests
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // API calls: network-first, no caching
  if (url.pathname.startsWith('/api/')) return;

  // Static assets & app shell: stale-while-revalidate
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      const networkFetch = fetch(request)
        .then((response) => {
          // Cache successful responses
          if (response.ok) {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(async () => {
          // Fallback to cache if offline
          if (cached) return cached;
          // Try a cached offline fallback, or return a 503 response
          const offlinePage = await cache.match('/');
          if (offlinePage) return offlinePage;
          return new Response('Service Unavailable', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain' },
          });
        });

      return cached || networkFetch;
    })
  );
});

/* ── Push Notification ────────────────────────── */
self.addEventListener('push', (event) => {
  let data = { title: 'dhSync', body: 'You have a new notification', url: '/' };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    vibrate: [100, 50, 100],
    data: { url: data.url || '/' },
    actions: [
      { action: 'open', title: 'Open dhSync' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
    tag: data.tag || 'dhsync-notification',
    renotify: true,
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

/* ── Notification Click ───────────────────────── */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // If an existing window is open, focus it and navigate
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin) {
          return client.focus().then((focusedClient) => {
            if (focusedClient && 'navigate' in focusedClient) {
              return focusedClient.navigate(targetUrl);
            }
            return focusedClient;
          });
        }
      }
      // Otherwise open a new window
      return self.clients.openWindow(targetUrl);
    })
  );
});

/* ── Background Sync (future: queue offline entry changes) ── */
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-entries') {
    // Placeholder: could replay queued entry mutations when back online
    event.waitUntil(Promise.resolve());
  }
});
