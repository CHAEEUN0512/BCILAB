/* sw.js — 오프라인에서도 열리도록 앱 파일을 캐시한다.
 * 전략: stale-while-revalidate — 캐시를 먼저 보여주고 뒤에서 새 버전을 받아둔다.
 * 다음에 열 때 새 버전이 뜨므로 주방에서 느리게 뜨는 일이 없다.
 */
var VERSION = 'fridge-keeper-v1';
var SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/styles.css',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './js/store.js',
  './js/render.js',
  './js/vision.js',
  './js/blocks.js',
  './js/ai-demo.js',
  './js/ai.js',
  './js/app.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(VERSION)
      .then(function (c) { return c.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== VERSION; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  // 같은 출처의 앱 파일만 다룬다 (AI 인식 API 호출 등은 건드리지 않는다)
  if (url.origin !== self.location.origin) return;

  e.respondWith(caches.open(VERSION).then(function (cache) {
    return cache.match(e.request).then(function (hit) {
      var net = fetch(e.request).then(function (res) {
        if (res && res.ok) cache.put(e.request, res.clone());
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    });
  }));
});
