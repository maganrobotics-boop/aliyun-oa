import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
if(!process.env.PLAYWRIGHT_MODULE)throw new Error('PLAYWRIGHT_MODULE required');
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const root=resolve('parity-validation/personnel-material-browser-app'),output=resolve('parity-validation/personnel-material-browser-report');
await mkdir(output,{recursive:true});
const server=createServer(async(req,res)=>{try{const p=new URL(req.url,'http://localhost').pathname;
 const f=resolve(root,'.'+(p==='/'?'/index.html':p));if(!f.startsWith(root+sep))throw new Error('Invalid path');
 res.setHeader('content-type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css'})[extname(f)]||'application/octet-stream');res.end(await readFile(f));
}catch{res.writeHead(404);res.end();}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
const source='## 陈绿平\n### 采购账单\n采购导航线缆，发票原金额128元。\n### 从事的工作\n测试定位接口。\n### 取得的成果\n完成导航回归验证。';
const results=[];
try{for(const [name,width,height] of [['desktop',1280,900],['mobile',390,844]]){
 const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block'}),page=await context.newPage();
 const errors=[],materials=[],messages=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();if(!url.pathname.startsWith('/api/'))return route.continue();
  if(url.pathname==='/api/personnel-materials'){
   materials.push(route.request().postDataJSON());return route.fulfill({json:{receipt:{id:'synthetic-receipt',received:true,duplicate:materials.length>1,recipients:[{memberId:'a',name:'陈绿平',state:'pending_self_confirmation',approvalStatus:null}],unresolvedCount:0}}});
  }
  if(url.pathname.includes('/conversations/')&&route.request().method()==='POST'){
   const request=route.request().postDataJSON();messages.push(request);
   const user={id:'turn:user',role:'user',content:request.message,state:'succeeded',createdAt:Date.now()};
   const assistant={id:'turn:assistant',role:'assistant',content:'陈绿平取得的成果：完成导航回归验证（指定审核人已通过）。',state:'succeeded',createdAt:Date.now()};
   return route.fulfill({contentType:'text/event-stream',body:'event: meta\ndata: '+JSON.stringify({requestId:'turn',messages:[user]})+'\n\nevent: done\ndata: '+JSON.stringify({state:'succeeded',messages:[user,assistant]})+'\n\n'});
  }
  return route.fulfill({json:{messages:[],notice:'按当前 OA 登录人权限收件和查询'}});
 });
 await page.goto(origin);await page.getByLabel('发送给 助研 · AI 的问题',{exact:true}).waitFor();
 const picker=page.getByRole('button',{name:'上传文件、图片、ZIP 或文件夹',exact:true});await picker.click();
 await page.getByRole('group',{name:'聊天附件上传方式',exact:true}).waitFor();
 await page.locator('input[type=file]').first().setInputFiles({name:'9月周报.txt',mimeType:'text/plain',buffer:Buffer.from(source)});
 await page.getByText('陈绿平：待本人确认',{exact:true}).waitFor();assert.equal(materials.length,1);assert.ok(materials[0].text.includes(source));assert.equal(messages.length,0,'attachment source is handled directly in authenticated material API');
 await page.screenshot({path:resolve(output,name+'-received.png'),fullPage:true});
 await page.locator('input[type=file]').first().setInputFiles({name:'9月周报.txt',mimeType:'text/plain',buffer:Buffer.from(source)});
 await page.getByText('同份材料已收件，沿用原确认单。',{exact:true}).waitFor();assert.equal(materials.length,2);
 await page.getByLabel('发送给 助研 · AI 的问题',{exact:true}).fill('陈绿平取得的成果');await page.getByRole('button',{name:'发送',exact:true}).click();
 await page.getByText('回答已保存',{exact:true}).waitFor();assert.equal(messages.length,1);assert.match(await page.locator('.oa-ai-message.assistant').innerText(),/指定审核人已通过/);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow');
 await page.goto(origin+'/?role=ta');await page.getByLabel('发送给 助教 · AI 的问题',{exact:true}).waitFor();assert.equal(await picker.count(),0,'other roles have no personnel upload control');
 await page.goto(origin+'/?confirm=1');const fields=page.locator('.pw-work textarea');assert.equal(await fields.count(),4);
 const work=page.getByLabel('核对本人从事的工作',{exact:true});await work.fill('本人核对：联调定位接口并记录测试日志。');
 await page.getByRole('button',{name:/本人确认并提交 .*审核/u}).click();
 const submitted=await page.evaluate(()=>window.__submissions);assert.equal(submitted.length,1);assert.equal(submitted[0].action,'work_submit');assert.match(submitted[0].content,/## 采购账单/);assert.match(submitted[0].content,/本人核对：联调定位接口/);assert.match(submitted[0].content,/## 取得的成果/);
 await page.screenshot({path:resolve(output,name+'-self-confirmation.png'),fullPage:true});assert.deepEqual(errors,[]);
 results.push({name,attachmentReceipt:true,duplicateReceipt:true,approvedQuery:true,selfConfirmation:true,noOverflow:true});await context.close();
}await writeFile(resolve(output,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
}finally{await browser.close();await new Promise(done=>server.close(done));}
