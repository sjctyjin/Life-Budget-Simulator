const CACHE_NAME = 'life-budget-simulator-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/journal.html',
  '/scanner.html',
  '/pledge.html',
  '/ghost.html',
  '/strategy.html',
  '/favicon.svg',
  '/manifest.json',
  '/css/style.css',
  '/css/journal.css',
  '/css/scanner.css',
  '/css/pledge.css',
  '/css/ghost.css',
  '/css/strategy.css',
  '/js/app.js',
  '/js/charts.js',
  '/js/simulator.js',
  '/js/journal-engine.js',
  '/js/journal-ui.js',
  '/js/scanner-engine.js',
  '/js/scanner-ui.js',
  '/js/ghost-backtest.js',
  '/js/strategy.js'
];

// Install Event
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker] Caching all static assets');
        // Cache assets one by one to avoid total failure if one resource fails
        return Promise.allSettled(
          ASSETS_TO_CACHE.map(url => {
            return cache.add(url).catch(err => {
              console.warn(`[Service Worker] Failed to cache: ${url}`, err);
            });
          })
        );
      })
      .then(() => self.skipWaiting())
  );
});

// Activate Event
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Clearing old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip caching for API requests and non-GET requests
  if (url.pathname.startsWith('/api/') || event.request.method !== 'GET') {
    event.respondWith(fetch(event.request));
    return;
  }

  // Stale-While-Revalidate for static assets
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) {
        // Fetch updated version in background to update cache
        fetch(event.request).then(networkResponse => {
          if (networkResponse.status === 200) {
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, networkResponse));
          }
        }).catch(() => { /* Offline or network error, ignore */ });
        return cachedResponse;
      }
      
      return fetch(event.request).then(networkResponse => {
        if (networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
        }
        return networkResponse;
      }).catch(err => {
        console.error('[Service Worker] Fetch failed:', err);
      });
    })
  );
});
