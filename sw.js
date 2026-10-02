const CACHE="vcg-teamlists-shell-v62";
const SHELL=["/","/index.html","/assets/css/app.css","/assets/js/qrcodegen.min.js","/assets/js/app.js","/assets/js/auth.js","/assets/js/tcg.js","/assets/icon.svg","/manifest.webmanifest"];
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  if(event.request.mode==="navigate"){
    const spaRoutes=new Set(["/","/team-builder","/deck-builder","/my-teams","/stats","/preview","/profile"]);
    if(spaRoutes.has(url.pathname)){
      event.respondWith(fetch(event.request).then(response=>{
        const copy=response.clone();
        caches.open(CACHE).then(cache=>cache.put("/index.html",copy));
        return response;
      }).catch(()=>caches.match("/index.html")));
    }else{
      event.respondWith(fetch(event.request).then(response=>{
        const copy=response.clone();
        caches.open(CACHE).then(cache=>cache.put(event.request,copy));
        return response;
      }).catch(()=>caches.match(event.request)));
    }
    return;
  }
  event.respondWith(fetch(event.request).then(response=>{
    const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response;
  }).catch(()=>caches.match(event.request)));
});