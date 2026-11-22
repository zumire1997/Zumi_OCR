'use strict';
window.ZumiPaddle=(()=>{
 const base=new URL('vendor/paddle/',document.currentScript.src),loads=new Map(),active=new Set();
 const models={kor:'korean_PP-OCRv5_mobile_rec',rus:'eslav_PP-OCRv5_mobile_rec',eng:'en_PP-OCRv5_mobile_rec',tha:'th_PP-OCRv5_mobile_rec',jpn:'PP-OCRv5_mobile_rec',chi_sim:'PP-OCRv5_mobile_rec',chi_tra:'PP-OCRv5_mobile_rec'};
 function script(name){
  if(loads.has(name))return loads.get(name);
  const promise=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=new URL(name+'.js',base);s.async=true;const timer=setTimeout(()=>{s.remove();loads.delete(name);reject(Error('PaddleOCR tardó en cargar. Comprueba que vendor/paddle esté completo y vuelve a intentarlo.'));},120000);s.onload=()=>{clearTimeout(timer);resolve();};s.onerror=()=>{clearTimeout(timer);s.remove();loads.delete(name);reject(Error('No se pudo cargar PaddleOCR ('+name+'). Extrae todo el ZIP, incluida vendor/paddle.'));};document.head.append(s);});loads.set(name,promise);return promise;
 }
 async function unpack(name){const encoded=window.ZUMI_PADDLE_DATA?.[name];if(!encoded)throw Error('Falta el recurso de PaddleOCR: '+name);const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();}
 function lines(items){return (items||[]).flatMap(item=>{
  const poly=item.poly;if(!Array.isArray(poly)||poly.length<4)return [];
  const points=poly.map(p=>Array.isArray(p)?p:[p.x,p.y]);if(points.some(p=>p.length<2||!p.every(Number.isFinite)))return [];
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),text=String(item.text||'').trim();if(!text)return [];
  return [{text,confidence:Math.max(0,Math.min(100,Number(item.score)*100||0)),bbox:{x0:Math.min(...xs),y0:Math.min(...ys),x1:Math.max(...xs),y1:Math.max(...ys)}}];
 });}
 async function create(language,{onStatus=()=>{}}={}){
  const model=models[language];if(!model)throw Error('PaddleOCR no tiene un modelo configurado para este idioma.');
  const record={cancelled:false,worker:null,pending:new Map(),urls:[],next:0};active.add(record);
  const terminate=()=>{if(record.cancelled)return;record.cancelled=true;record.worker?.terminate();for(const p of record.pending.values()){clearTimeout(p.timer);p.reject(Error('Operación detenida.'));}record.pending.clear();for(const url of record.urls)URL.revokeObjectURL(url);record.urls=[];active.delete(record);};record.terminate=terminate;
  const check=()=>{if(record.cancelled)throw Error('Operación detenida.');};
  function url(value,type){const u=URL.createObjectURL(new Blob([value],{type}));record.urls.push(u);return u;}
  function rpc(action,data={},transfer=[]){check();const id=++record.next;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{record.pending.delete(id);reject(Error('PaddleOCR tardó demasiado. Prueba una zona más pequeña o el motor Clásico.'));terminate();},180000);record.pending.set(id,{resolve,reject,timer});record.worker.postMessage({id,action,...data},transfer);});}
  try{
   if(!globalThis.DecompressionStream||!globalThis.Worker)throw Error('Este navegador no admite PaddleOCR local. Actualiza Chrome o Edge, o usa el motor Clásico.');
   onStatus('Preparando PaddleOCR: motor y modelo del idioma…');
   await Promise.all(['worker','runtime','runtime-module','PP-OCRv5_mobile_det',model].map(script));check();
   const [wasm,det,rec]=await Promise.all([unpack('runtime'),unpack('PP-OCRv5_mobile_det'),unpack(model)]);check();
   // ORT requires a hierarchical module base even in a file:// worker. Assets
   // are supplied as buffers/data URLs; this reserved URL is never fetched.
   const moduleBase=base.protocol==='file:'?'https://zumi.invalid/paddle/worker.js':new URL('worker.js',base).href;
   record.worker=new Worker(url('self.ZUMI_MODULE_BASE='+JSON.stringify(moduleBase)+';\n'+window.ZUMI_PADDLE_WORKER_SOURCE,'application/javascript'));
   record.worker.onmessage=({data:r})=>{const p=record.pending.get(r.id);if(!p)return;record.pending.delete(r.id);clearTimeout(p.timer);r.ok?p.resolve(r):p.reject(Error(r.error||'No se pudo leer con PaddleOCR.'));};
   record.worker.onerror=e=>{e.preventDefault();console.error('Paddle loader',String(e.error?.stack||e.message).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'ORT_MODULE').slice(0,3500));for(const p of record.pending.values()){clearTimeout(p.timer);p.reject(Error('PaddleOCR no pudo iniciar: '+(e.message||'error del navegador')));}record.pending.clear();terminate();};
   onStatus('Iniciando PaddleOCR local…');
   await rpc('init',{name:model,mjs:window.ZUMI_PADDLE_MODULE_URL,wasmArray:wasm,detArray:det,recArray:rec},[wasm,det,rec]);check();
   return {terminate:async()=>terminate(),setParameters:async()=>{},recognize:async canvas=>{check();const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data.buffer;const r=await rpc('read',{width:canvas.width,height:canvas.height,pixels},[pixels]);return {data:{blocks:[{paragraphs:[{lines:lines(r.result?.items)}]}]}};}};
  }catch(e){terminate();throw e;}
 }
 return {create,cancel:()=>{for(const r of [...active])r.terminate();},modelFor:language=>models[language],lines};
})();
