// Önce ağ, olmazsa önbellek: güncellemeler hemen gelir, internet yokken uygulama yine açılır.
const CACHE = 'aile-butcesi-v4';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.url.includes('supabase.co')) return;
  e.respondWith(
    // Tarayıcı önbelleğini atla: güncelleme yayınlanınca telefonlar hemen yeni sürümü alır
    fetch(req, { cache: 'no-cache' })
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});

// Eşin ortak bir şey eklediğinde gelen bildirim
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data.json(); } catch { data = { title: 'Aile Bütçesi', body: e.data?.text() || '' }; }
  e.waitUntil(self.registration.showNotification(data.title || 'Aile Bütçesi', {
    body: data.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (all.length) return all[0].focus();
    return self.clients.openWindow('./');
  })());
});
