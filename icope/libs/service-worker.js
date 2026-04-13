// service-worker.js
self.addEventListener("message", (event) => {
  if (event.data.action === "shareMediaStream") {
    self.mediaStream = event.data.mediaStream; // 儲存傳入的 mediaStream
  }
});

self.addEventListener("fetch", (event) => {
  if (event.request.url.includes("getMediaStream")) {
    event.respondWith(new Response(self.mediaStream));
  }
});
