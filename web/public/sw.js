// 責務: PWAとしてホーム画面追加・オフライン起動を可能にするための最小限のキャッシュのみを行う。
// /api/* は常に最新の状態を扱う必要があるためキャッシュしない（接続状態のポーリング等）。
const CACHE_NAME = "vpngateway-gui-shell-v1";
const SHELL_ASSETS = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api")) return;

  // ナビゲーション（画面遷移）はネット優先。オフライン時のみキャッシュ済みの画面を返す。
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/")),
    );
    return;
  }

  // 静的アセットはキャッシュ優先で、取得できたら裏でキャッシュを更新する。
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached ?? fetchPromise;
    }),
  );
});
