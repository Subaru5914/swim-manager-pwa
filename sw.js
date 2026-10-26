const CACHE_NAME="swim-manager-pwa-v2.80";
const APP_SHELL=["./","./index.html","./manifest.webmanifest","./local-save.js?version=v2.80","./save-history.js?version=v2.80","./cloud-sync.js?version=v2.80","./cloud-config.json","./icons/apple-touch-icon.png","./icons/icon-192.png","./icons/icon-512.png","./icons/icon-maskable-512.png"];
function currentCacheMatch(request){return caches.open(CACHE_NAME).then(cache=>cache.match(request))}
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",event=>{
  const req=event.request;if(req.method!=="GET")return;
  const url=new URL(req.url);if(url.origin!==self.location.origin)return;
  if(req.mode==="navigate"){
    event.respondWith(fetch(req).then(resp=>{const copy=resp.clone();caches.open(CACHE_NAME).then(cache=>cache.put("./index.html",copy));return resp}).catch(()=>currentCacheMatch("./index.html")));
    return;
  }
  event.respondWith(currentCacheMatch(req).then(cached=>{
    const network=fetch(req).then(resp=>{if(resp&&resp.ok){const copy=resp.clone();caches.open(CACHE_NAME).then(cache=>cache.put(req,copy))}return resp}).catch(()=>cached);
    return cached||network;
  }));
});
