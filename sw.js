const CACHE_NAME = 'packflow-mobile-v18';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './pdf.js',
  './pdf.worker.js',
  './manifest.webmanifest',
  './icons/icon16.png',
  './icons/icon48.png',
  './icons/icon128.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Network-First Strategy for Instant Live Updates
self.addEventListener('fetch', (event) => {
  // Handle Web Share Target POST requests
  if (event.request.method === 'POST' && event.request.url.includes('index.html')) {
    event.respondWith(Response.redirect('./index.html?share-target', 303));

    event.waitUntil(
      (async () => {
        const data = await event.request.formData();
        const files = data.getAll('pdf');
        if (files.length > 0) {
          const file = files[0];
          // Store the shared file in a temporary cache for the client to pick up
          const cache = await caches.open('packflow-share-target');
          await cache.put('/shared-pdf', new Response(file, {
            headers: {
              'Content-Type': file.type,
              'X-Filename': file.name
            }
          }));

          // Notify all clients that a file was shared
          const clients = await self.clients.matchAll({ type: 'window' });
          for (const client of clients) {
            client.postMessage({ type: 'share-target-file', filename: file.name });
          }
        }
      })()
    );
    return;
  }

  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});
