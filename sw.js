// インストール可能にするためだけの Service Worker。
//
// オフラインキャッシュはしない。予定やタスクは毎回サーバーの最新状態を
// 見せる必要があるアプリなので、古いレスポンスを返すキャッシュ層は
// ここでは要らない — install 可能にする最小限の実装に留める。

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  event.respondWith(fetch(event.request));
});
