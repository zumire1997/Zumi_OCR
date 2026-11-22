'use strict';
window.ZumiLama=(()=>{
 const root=new URL('.',document.currentScript.src),url='https://huggingface.co/ogkalu/lama-manga-onnx-dynamic/resolve/main/lama-manga-dynamic.onnx';
 const bytes=206291843,sha256='de31ffa5ba26916b8ea35319f6c12151ff9654d4261bccf0583a69bb095315f9';
 let model=null,worker=null,workerURL=null,controller=null,epoch=0,next=0;const pending=new Map(),loads=new Map();
 async function db(){return new Promise((resolve,reject)=>{const r=indexedDB.open('zumi-lama-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('models');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
 async function cache(action,value){const d=await db();try{return await new Promise((resolve,reject)=>{const tx=d.transaction('models',action==='get'?'readonly':'readwrite'),s=tx.objectStore('models'),r=action==='get'?s.get(sha256):action==='put'?s.put(value,sha256):s.delete(sha256);let result;r.onsuccess=()=>result=r.result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}finally{d.close();}}
 async function stored(){if(model)return model;try{const v=await cache('get');if(v instanceof Blob&&v.size===bytes)model=v;}catch{}return model;}
 function cancel(message='Operación detenida.'){epoch++;controller?.abort();controller=null;worker?.terminate();worker=null;if(workerURL)URL.revokeObjectURL(workerURL);workerURL=null;for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error(message));}pending.clear();}
 async function install(blob,onStatus=()=>{}){
  const e=epoch;if(blob.size!==bytes)throw Error('Modelo incompatible. Elige lama-manga-dynamic.onnx (206 MB).');
  onStatus('Comprobando el modelo…');const data=await blob.arrayBuffer();if(e!==epoch)throw Error('Operación detenida.');
  // crypto.subtle is unavailable on ordinary HTTP hosting; size and ONNX inputs
  // are still checked there. HTTPS/file also verifies the published SHA-256.
  if(globalThis.crypto?.subtle){const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),v=>v.toString(16).padStart(2,'0')).join('');if(hash!==sha256)throw Error('El modelo está incompleto o no coincide con Manga LaMa.');}
  if(e!==epoch)throw Error('Operación detenida.');cancel();model=blob;
  try{await cache('put',blob);return true;}catch{return false;}
 }
 async function download(onStatus=()=>{}){
  controller=new AbortController();const e=epoch,signal=controller.signal;
  try{const response=await fetch(url,{signal,credentials:'omit'});if(!response.ok)throw Error('La descarga respondió '+response.status+'.');
   const reader=response.body.getReader(),parts=[];let received=0,last=0;
   while(true){const {done,value}=await reader.read();if(done)break;parts.push(value);received+=value.byteLength;if(received>bytes)throw Error('La descarga no corresponde al modelo esperado.');if(Date.now()-last>350){onStatus('Descargando Manga LaMa: '+Math.round(received/bytes*100)+'% · '+Math.round(received/1e6)+' / 206 MB');last=Date.now();}}
   if(e!==epoch)throw Error('Operación detenida.');return await install(new Blob(parts,{type:'application/octet-stream'}),onStatus);
  }catch(e){if(signal.aborted)throw Error('Descarga detenida.');throw Error(e instanceof TypeError?'No se pudo descargar el modelo. Usa «Abrir modelo .onnx» o vuelve a intentar con conexión a internet.':e.message);}finally{controller=null;}
 }
 function script(path){if(loads.has(path))return loads.get(path);const p=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=new URL(path,root);s.onload=resolve;s.onerror=()=>{loads.delete(path);s.remove();reject(Error('Falta '+path+'. Extrae todo el ZIP.'));};document.head.append(s);});loads.set(path,p);return p;}
 function rpc(action,data={},transfer=[]){const id=++next;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{cancel('La limpieza tardó demasiado. Prueba una zona más pequeña.');},240000);pending.set(id,{resolve,reject,timer});worker.postMessage({id,action,...data},transfer);});}
 async function ready(onStatus){if(worker)return;const e=epoch,blob=await stored();if(!blob)throw Error('Primero descarga o abre el modelo Manga LaMa.');
  onStatus('Preparando Manga LaMa local…');await Promise.all(['vendor/lama/worker.js','vendor/paddle/runtime.js','vendor/paddle/runtime-module.js'].map(script));
  const encoded=window.ZUMI_PADDLE_DATA.runtime,compressed=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
  const wasm=await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(),buffer=await blob.arrayBuffer();if(e!==epoch)throw Error('Operación detenida.');
  const base=root.protocol==='file:'?'https://zumi.invalid/lama/worker.js':new URL('vendor/lama/worker.js',root).href;
  workerURL=URL.createObjectURL(new Blob(['self.ZUMI_MODULE_BASE='+JSON.stringify(base)+';\n'+window.ZUMI_LAMA_WORKER_SOURCE],{type:'application/javascript'}));worker=new Worker(workerURL);
  worker.onmessage=({data:r})=>{const p=pending.get(r.id);if(!p)return;clearTimeout(p.timer);pending.delete(r.id);r.ok?p.resolve(r):p.reject(Error(r.error));};
  worker.onerror=e=>{e.preventDefault();cancel('El motor de limpieza no pudo continuar. Cierra otras pestañas, vuelve a abrir Zumi y prueba una zona más pequeña.');};
  try{await rpc('init',{wasm,model:buffer,mjs:window.ZUMI_PADDLE_MODULE_URL},[wasm,buffer]);}catch(e){cancel();throw e;}
 }
 async function clean(image,mask,onStatus=()=>{}){try{await ready(onStatus);onStatus('Limpiando la zona con Manga LaMa…');const a=image.data.buffer,b=mask.data.buffer;return await rpc('clean',{width:image.width,height:image.height,pixels:a,mask:b},[a,b]);}finally{cancel();}}
 return {stored,install,download,cancel,clean,url,sha256,bytes,forget:async()=>{cancel();model=null;await cache('delete');}};
})();
