// Actual assistant/confirmation components with synthetic API boundaries only.
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

const root=fileURLToPath(new URL('..',import.meta.url));
const fixture=path.join(root,'.wrangler/personnel-material-browser-fixture');
const output=path.join(root,'parity-validation/personnel-material-browser-app');
await mkdir(fixture,{recursive:true});
await writeFile(path.join(fixture,'index.html'),'<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OA synthetic material acceptance</title></head><body><div id="root"></div><script type="module" src="./entry.mjs"></script></body></html>');
await writeFile(path.join(fixture,'entry.mjs'),`import React from 'react';
import {createRoot} from 'react-dom/client';
import '../../app/globals.css';
import {InteractionContent} from '../../components/ai-member-interaction.tsx';
import {WeeklyPanel} from '../../app/people-workbench/workflow-panel.tsx';
const params=new URLSearchParams(location.search),type=params.get('role')==='ta'?'ta':'research';
const member={id:type==='ta'?'ai-tutor':'ai-research',role:type,displayName:type==='ta'?'助教 · AI':'助研 · AI',status:'registered',canChat:true};
const content='## 采购账单\\n购买导航线缆，发票原金额128元。\\n\\n## 从事的工作\\n联调定位接口。\\n\\n## 取得的成果\\n完成导航回归验证。';
const entry={id:'synthetic-entry',member_id:'a',member_name:'陈绿平',source_title:'9月周报',source_text:content,title:'9月周报',content,state:'draft',approval_id:null,approval_status:null,current_reviewer_name:null,accepted:false,submittedContent:'',confirmed_at:'',materialIntake:true};
const workflow={weekly:[entry],sources:[],disputes:[],isDisputeOwner:false,reviewerName:'石永亮 / 冯永玄（任一人）',disputeOwnerName:'项目负责人'};
window.__submissions=[];
const component=params.get('confirm')==='1'?React.createElement(WeeklyPanel,{workflow,memberId:'a',own:true,manager:false,busy:false,run:async(body)=>{window.__submissions.push(body);return true;}}):React.createElement(InteractionContent,{member,mode:'chat',inline:true});
createRoot(document.getElementById('root')).render(component);
`);
await build({configFile:false,root,plugins:[react()],resolve:{alias:{'@':root}},publicDir:false,
 build:{outDir:output,emptyOutDir:true,sourcemap:false,rollupOptions:{input:path.join(fixture,'index.html')}}});
async function htmlFiles(directory){const found=[];for(const e of await readdir(directory,{withFileTypes:true})){const p=path.join(directory,e.name);if(e.isDirectory())found.push(...await htmlFiles(p));else if(e.name.endsWith('.html'))found.push(p);}return found;}
const built=(await htmlFiles(output))[0];if(!built)throw new Error('Fixture HTML missing');
await writeFile(path.join(output,'index.html'),await readFile(built));
