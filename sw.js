const CACHE_NAME = 'shopping-list-v19';
const STATIC_ASSETS = [
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './characters/medaka-main.png',
  './characters/medaka-kihon.png',
  './characters/medaka-thanks2.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch((err) => console.log('cache install error', err))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Supabase など他オリジンへの通信は触らない。品目リストをキャッシュすると、
  // 削除・追加が反映されず古いリストが返り続けるため。
  if (new URL(event.request.url).origin !== self.location.origin) return;

  // ページ本体（ナビゲーション）は常にネットワークから直接取得する。
  // リダイレクトを含むレスポンスをキャッシュ経由で返すと、
  // iOSのホーム画面アプリで「redirections」エラーになるため。
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // それ以外の静的ファイル（アイコンなど）はキャッシュ優先、なければネットワーク取得
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok && !response.redirected) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
