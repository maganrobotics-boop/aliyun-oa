import { request as httpRequest } from 'node:http';

const MAX_RESPONSE=384*1024;
// Only the fixed local OA endpoint receives the existing verified OA cookie.
// Public Chat and AI course/test APIs never receive it.
export function createOaResearchConversation({port,fetchImpl}){
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid OA port');
  return async(request,question,{history=[],signal,onEvent}={})=>{
    const cookie=request.headers.get('cookie');
    if(!cookie||cookie.length>16384||typeof question!=='string'||question.length>2000)throw new Error('Invalid OA research request');
    const controller=AbortSignal.any([AbortSignal.timeout(90000),...(signal?[signal]:[])]);
    const headers={host:'oa.omindos.cn','x-forwarded-host':'oa.omindos.cn','x-forwarded-proto':'https',
      origin:'https://oa.omindos.cn','content-type':'application/json',accept:'application/json',cookie};
    const body=JSON.stringify({question,history:history.filter(h=>h.role==='user'&&typeof h.content==='string'&&h.content.length<=2000).slice(-2)});
    let data;
    if(fetchImpl){
      const response=await fetchImpl(`http://127.0.0.1:${port}/api/lab-ai/ask`,{method:'POST',redirect:'error',headers,body,signal:controller});
      if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw new Error('OA research response rejected');
      const reader=response.body?.getReader();if(!reader)throw new Error('OA research response is empty');
      const chunks=[];let total=0;
      try{while(true){controller.throwIfAborted();const value=await reader.read();if(value.done)break;total+=value.value.byteLength;if(total>MAX_RESPONSE)throw new Error('OA research response too large');chunks.push(Buffer.from(value.value));}}
      finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
      data=JSON.parse(Buffer.concat(chunks,total).toString('utf8'));
    }else{
      const bytes=await new Promise((resolve,reject)=>{
        const outgoing=httpRequest({hostname:'127.0.0.1',port,path:'/api/lab-ai/ask',method:'POST',headers,signal:controller,agent:false,maxHeaderSize:16384},incoming=>{
          const fail=()=>{incoming.destroy();reject(new Error('OA research response rejected'));};
          if(incoming.statusCode<200||incoming.statusCode>=300||!String(incoming.headers['content-type']).includes('application/json')||Number(incoming.headers['content-length'])>MAX_RESPONSE){fail();return;}
          let total=0;const chunks=[];
          incoming.on('data',chunk=>{total+=chunk.length;if(total>MAX_RESPONSE){fail();return;}chunks.push(chunk);});
          incoming.once('aborted',fail);incoming.once('error',fail);
          incoming.once('end',()=>{if(!incoming.complete){fail();return;}resolve(Buffer.concat(chunks,total));});
        });
        outgoing.once('error',()=>reject(new Error('OA research request failed')));outgoing.end(body);
      });
      data=JSON.parse(bytes.toString('utf8'));
    }
    controller.throwIfAborted();
    if(!data||typeof data.answer!=='string'||!data.answer.trim()||data.answer.length>60000)throw new Error('OA research answer is incomplete');
    if(onEvent)await onEvent({type:'delta',text:data.answer});
    return {answer:data.answer,mode:data.mode||'oa_assistant'};
  };
}
