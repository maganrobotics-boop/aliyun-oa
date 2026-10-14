import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../public/oa-login-recovery.js', import.meta.url), 'utf8');
function fixture({ stalled = true, wecom = true, path = '/', ready = 'complete' } = {}) {
  const state = { stalled, panels: [], timers: [], connected: false };
  const document = {
    readyState: ready,
    querySelector: () => state.stalled ? {} : null,
    getElementById: id => state.panels.find(p => p.id === id),
    addEventListener: (_, fn) => { state.ready = fn; },
    createElement(tag) {
      return { tag, style: {}, children: [], setAttribute() {}, appendChild(e) { this.children.push(e); },
        remove() { state.panels = state.panels.filter(p => p !== this); } };
    },
    body: { appendChild(p) { state.panels.push(p); } },
  };
  class Observer {
    constructor(fn) { state.mutate = fn; }
    observe() { state.connected = true; }
    disconnect() { state.connected = false; }
  }
  const window = { location: new URL(path + '?approval=example#todos', 'https://oa.omindos.cn'),
    setTimeout(fn, ms) { state.timers.push({ fn, ms }); } };
  runInNewContext(source, { window, document, navigator: { userAgent: wecom ? 'Android wxwork/5.0.12' : 'Chrome' }, MutationObserver: Observer, URL, Date });
  state.tick = () => { for (const timer of state.timers.splice(0)) timer.fn(); };
  state.links = () => state.panels.flatMap(p => p.children.filter(e => e.tag === 'a'));
  return state;
}
test('stalled WeCom document has manual OAuth and reload links after 12 seconds, without any network or identity APIs', () => {
  const f = fixture();
  assert.equal(f.panels.length, 0);
  assert.equal(f.timers[0].ms, 12000);
  f.tick();
  assert.equal(f.panels.length, 1);
  assert.equal(f.links()[0].href, '/api/auth/wecom/start?return_to=%2F');
  const retry = new URL(f.links()[1].href, 'https://oa.omindos.cn');
  assert.equal(retry.origin, 'https://oa.omindos.cn');
  assert.equal(retry.searchParams.get('approval'), 'example');
  assert.equal(retry.hash, '#todos');
  assert.ok(retry.searchParams.get('oa_reload'));
});
test('successful startup never shows recovery controls', () => {
  const f = fixture(); f.stalled = false; f.tick(); assert.equal(f.panels.length, 0);
});
test('late application recovery removes panel and disconnects observer', () => {
  const f = fixture(); f.tick(); assert.equal(f.connected, true);
  f.stalled = false; f.mutate(); assert.equal(f.panels.length, 0); assert.equal(f.connected, false);
});
test('ordinary browser gets reload only and no WeCom redirect', () => {
  const f = fixture({ wecom: false }); f.tick();
  assert.deepEqual(f.links().map(a => a.textContent), ['重新加载']);
});
test('other pages, including OAuth callback, are untouched', () => {
  const f = fixture({ path: '/api/auth/wecom/callback' }); assert.equal(f.timers.length, 0);
});
test('early script waits for the document before starting the deadline', () => {
  const f = fixture({ ready: 'loading' }); assert.equal(f.timers.length, 0);
  f.ready(); f.tick(); assert.equal(f.panels.length, 1);
});
