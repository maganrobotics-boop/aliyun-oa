(() => {
  const heartbeat = () => {
    if (document.visibilityState !== 'visible') return;
    const path = new URL('v1/activity', document.baseURI).pathname;
    fetch(path, { method: 'POST', credentials: 'same-origin', cache: 'no-store' }).catch(() => {});
  };
  // The first successful page response records the initial visit.
  setInterval(heartbeat, 60000);
  document.addEventListener('visibilitychange', heartbeat);
})();
