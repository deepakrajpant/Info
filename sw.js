/* Cache only the public app shell. Firebase responses and paid banks are never cached here. */
const CACHE='dream-japan-shell-v4.0.0';
const FILES=['./','./index.html','./style.css','./script.js','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('dream-japan-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET')return;
 const url=new URL(e.request.url),base=new URL(self.registration.scope);
 if(url.origin!==base.origin || !FILES.some(f=>new URL(f,base).pathname===url.pathname))return;
 e.respondWith(fetch(e.request).then(r=>{if(r.ok){const copy=r.clone();e.waitUntil(caches.open(CACHE).then(c=>c.put(e.request,copy)));}return r;}).catch(()=>caches.match(e.request).then(r=>r||new Response('Offline',{status:503}))));
});
