import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import sharp from 'sharp';

const source = fs.readFileSync(new URL('../public/oa-sw.js', import.meta.url), 'utf8');
function harness() {
  const handlers = {}, cached = new Map(), deleted = [], fetched = [];
  const cache = {
    match: async request => cached.get(request.url),
    put: async (request, response) => cached.set(request.url, response),
  };
  const caches = {open: async () => cache, keys: async () => ['oa-pwa-static-v1','unrelated-cache'], delete: async name => deleted.push(name)};
  vm.runInNewContext(source, {
    self: {location:{origin:'https://oa.omindos.cn'},addEventListener:(name, handler)=>handlers[name]=handler,skipWaiting:async()=>{},clients:{claim:async()=>{}}},
    URL, caches, fetch: async request => {fetched.push(request.url); return {ok:true,type:'basic',redirected:false,headers:new Headers({'content-type':'image/png'}),clone(){return this}};},
  });
  return {handlers,cached,deleted,fetched};
}
test('business pages, HTML, API, login, RSC, cross-origin, queries, Range and non-GET bypass worker', () => {
  const {handlers} = harness();
  for (const [url,init] of [
    ['/','navigate'], ['/login','navigate'], ['/approvals','navigate'],
    ['/api/auth/session'], ['/api/approvals'], ['/knowledge'], ['/pwa/offline.html'],
    ['/_next/static/chunks/app/page.js'], ['/manifest.webmanifest'],
    ['/pwa/icon-192-v2.png?v=2'], ['/pwa/icon-192.png'],
    ['https://other.example/pwa/icon-192-v2.png'],
    ['/pwa/icon-192-v2.png','navigate'],
    ['/pwa/icon-192-v2.png','post'], ['/pwa/icon-192-v2.png','range'],
  ]) {
    let intercepted = false;
    handlers.fetch({request:{url:new URL(url,'https://oa.omindos.cn').href,method:init==='post'?'POST':'GET',mode:init==='navigate'?'navigate':'cors',headers:new Headers(init==='range'?{range:'bytes=0-10'}:{})},respondWith:()=>intercepted=true});
    assert.equal(intercepted,false,url);
  }
});
test('only versioned same-origin PNG icons cache; repeat hits cache',async()=>{
  const h=harness();
  for(const file of ['icon-192','icon-512','icon-maskable-512','apple-touch-icon-180']) {
    const request={url:'https://oa.omindos.cn/pwa/'+file+'-v2.png',method:'GET',mode:'cors',headers:new Headers()};
    let pending;h.handlers.fetch({request,respondWith:p=>pending=p});assert.ok(pending);await pending;
    h.handlers.fetch({request,respondWith:p=>pending=p});await pending;
  }
  assert.equal(h.fetched.length,4); assert.equal(h.cached.size,4);
});
test('activation removes old OA cache without deleting unrelated caches',async()=>{
 const h=harness();let pending;h.handlers.activate({waitUntil:p=>pending=p});await pending;
 assert.deepEqual(h.deleted,['oa-pwa-static-v1']);
});
test('manifest and Apple metadata have correct scope, standalone and real icon sizes',async()=>{
 const manifest=JSON.parse(fs.readFileSync(new URL('../public/manifest.webmanifest',import.meta.url)));
 assert.equal(manifest.scope,'/');assert.equal(manifest.start_url,'/');assert.equal(manifest.display,'standalone');
 for(const icon of manifest.icons) {
   const m=await sharp(new URL('../public'+icon.src,import.meta.url).pathname).metadata();
   assert.equal(m.width+'x'+m.height,icon.sizes);assert.equal(m.format,'png');
   if(icon.purpose==='maskable') assert.equal(m.hasAlpha,false);
 }
 const apple=await sharp(new URL('../public/pwa/apple-touch-icon-180-v2.png',import.meta.url).pathname).metadata();
 assert.equal(apple.width,180);assert.equal(apple.height,180);
 const layout=fs.readFileSync(new URL('../app/layout.tsx',import.meta.url),'utf8');
 assert.match(layout,/themeColor: "#0C79D8"/);assert.match(layout,/apple-touch-icon-180-v2/);assert.match(layout,/capable: true/);
});
test('Android prompt accept/cancel and Safari/iPad fallback give correct instructions',async()=>{
 const component=fs.readFileSync(new URL('../components/oa-pwa.tsx',import.meta.url),'utf8');
 const body=component.slice(component.indexOf('  const install = async () => {'),component.indexOf('  return <Context.Provider'));
 for(const scenario of [
  {ua:'Mozilla/5.0 (Linux; Android 16)',event:true,outcome:'accepted',expected:/已确认安装/},
  {ua:'Mozilla/5.0 (Linux; Android 16)',event:true,outcome:'dismissed',expected:/已取消安装/},
  {ua:'Mozilla/5.0 (Linux; Android 16)',expected:/Chrome.*安装应用/},
  {ua:'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0)',expected:/Safari.*分享.*添加到主屏幕/},
  {ua:'Mozilla/5.0 (Macintosh)',platform:'MacIntel',touch:5,expected:/Safari.*分享.*添加到主屏幕/},
 ]) {
  let message='',prompted=false;
  const context={installed:false,navigator:{userAgent:scenario.ua,platform:scenario.platform||'',maxTouchPoints:scenario.touch||0},
   pending:{current:scenario.event?{prompt:async()=>{prompted=true},userChoice:Promise.resolve({outcome:scenario.outcome})}:null},
   setMessage:m=>message=m};
  const install=vm.runInNewContext(body+'\ninstall;',context);await install();
  assert.match(message,scenario.expected);assert.equal(prompted,!!scenario.event);
 }
});
