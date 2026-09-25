// Generated from sw.template.js during npm run build/dev.
const CACHE = 'homechat-v0.15.2';
const CORE = ['/', '/manifest.webmanifest', '/icons/homechat-192.png', '/icons/homechat-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('homechat-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put('/', copy));
      return response;
    }).catch(() => caches.match('/')));
    return;
  }

  event.respondWith(caches.match(request).then(cached => {
    const network = fetch(request).then(response => {
      if (response.ok) caches.open(CACHE).then(cache => cache.put(request, response.clone()));
      return response;
    });
    return cached || network;
  }));
});


self.addEventListener('push', event => {
  event.waitUntil((async()=>{
    let payload={title:'HomeChat',body:'New message',conversationId:0};
    try{if(event.data)payload={...payload,...event.data.json()};}catch{}
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const visible=windows.find(client=>client.visibilityState==='visible');
    if(visible){
      visible.postMessage({type:'homechat:push-received',conversationId:Number(payload.conversationId)||0});
      return;
    }
    await self.registration.showNotification(payload.title||'HomeChat',{
      body:payload.body||'New message',
      icon:'/icons/homechat-192.png',
      badge:'/icons/homechat-192.png',
      tag:`homechat-${Number(payload.conversationId)||0}`,
      data:{conversationId:Number(payload.conversationId)||0,url:`/?conversation=${Number(payload.conversationId)||0}`}
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async()=>{
    const conversationId=Number(event.notification.data?.conversationId)||0;
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    if(windows.length){
      const client=windows[0];
      client.postMessage({type:'homechat:open-conversation',conversationId,background:false});
      if('focus' in client)await client.focus();
      return;
    }
    if(self.clients.openWindow)await self.clients.openWindow(`/?conversation=${conversationId}`);
  })());
});
