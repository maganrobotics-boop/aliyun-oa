/* Independent of the application bundle: a stalled download must not trap login. */
(function () {
  'use strict';
  if (window.location.pathname !== '/') return;
  function start() {
    window.setTimeout(function () {
      var pending = document.querySelector('.oa-login-primary[disabled]');
      if (!pending || document.getElementById('oa-login-recovery')) return;
      var panel = document.createElement('aside');
      panel.id = 'oa-login-recovery';
      panel.setAttribute('role', 'status');
      panel.setAttribute('aria-live', 'polite');
      panel.style.cssText = 'position:fixed;z-index:10000;left:16px;right:16px;bottom:24px;max-width:480px;margin:auto;padding:18px;border:1px solid #cbd5df;border-radius:14px;background:#fff;color:#263746;box-shadow:0 8px 32px #15283922;font:15px/1.6 system-ui,sans-serif';
      var message = document.createElement('p');
      message.textContent = '页面加载较慢，可以重新加载后继续。';
      message.style.cssText = 'margin:0 0 12px';
      panel.appendChild(message);
      function link(label, href) {
        var element = document.createElement('a');
        element.textContent = label;
        element.href = href;
        element.target = '_top';
        element.style.cssText = 'display:inline-block;margin:0 12px 4px 0;padding:8px 12px;border-radius:8px;background:#2f6686;color:white;text-decoration:none';
        panel.appendChild(element);
      }
      // A link only: the existing server endpoint still verifies OAuth and binding.
      if (/\bwxwork\//i.test(navigator.userAgent)) {
        link('使用企业微信登录', '/api/auth/wecom/start?return_to=%2F');
      }
      var retry = new URL(window.location.href);
      retry.searchParams.set('oa_reload', String(Date.now()));
      link('重新加载', retry.pathname + retry.search + retry.hash);
      document.body.appendChild(panel);
      var observer = new MutationObserver(function () {
        if (!document.querySelector('.oa-login-primary[disabled]')) {
          panel.remove();
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    }, 12000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}());
