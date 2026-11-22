'use strict';
window.ZumiTyperLink=function({$,getData,applyPrefixes,tell}){
 let target=null,token='',ready=false,pending=null,sequence=0,overlay=null,frame=null;
 const isDesktopApp=()=>Boolean(window.__TAURI_INTERNALS__||window.__TAURI__);

 function ensureOverlay(urlHref){
  if(!overlay){
   overlay=document.createElement('div');
   overlay.id='zumiTyperOverlay';
   overlay.style.cssText='position:fixed;inset:0;z-index:9999;background:#16161b;display:flex;flex-direction:column;';
   frame=document.createElement('iframe');
   frame.id='zumiTyperFrame';
   frame.title='Zumi Typer';
   frame.allow='clipboard-read; clipboard-write; fullscreen';
   frame.style.cssText='width:100%;height:100%;border:0;flex:1;background:#16161b;';
   overlay.appendChild(frame);
   document.body.appendChild(overlay);
  }
  overlay.hidden=false;
  if(!frame.src||frame.src==='about:blank'){
   frame.src=urlHref;
  }
  target=frame.contentWindow;
  return true;
 }

 function transmit(){if(!pending||pending.sent||!ready||!target||target.closed)return;pending.sent=true;target.postMessage({type:'zumi-typer-project',token,requestId:pending.id,data:pending.data},'*');}

 function open(){
  if(overlay&&frame&&frame.contentWindow&&frame.src){
   overlay.hidden=false;
   target=frame.contentWindow;
   return true;
  }
  if(target&&!target.closed){target.focus();return true;}
  if(pending){clearTimeout(pending.timer);pending.reject(Error('La pestaña de Zumi Typer se cerró.'));pending=null;}
  token=globalThis.crypto?.randomUUID?.()||String(Date.now())+Math.random();
  ready=false;
  const url=new URL('Photopea/Zumi_Typer_Photopea.html',location.href);
  url.hash='zumi-token='+encodeURIComponent(token);
  if(isDesktopApp()){
   return ensureOverlay(url.href);
  }
  target=window.open(url.href,'_blank');
  if(!target){
   return ensureOverlay(url.href);
  }
  return true;
 }

 function send(data){
  if(!target||target.closed)return Promise.reject(Error('Abre Zumi Typer y vuelve a enviar el lote.'));
  if(pending)return Promise.reject(Error('Ya hay un envío a Zumi Typer pendiente.'));
  if(overlay)overlay.hidden=false;
  return new Promise((resolve,reject)=>{
   const id=++sequence,timer=setTimeout(()=>{pending=null;reject(Error('Zumi Typer no confirmó el envío. Usa la versión de Typer incluida en este ZIP y vuelve a intentarlo.'));},60000);
   pending={id,data,resolve,reject,timer,sent:false};
   transmit();
  });
 }

 window.addEventListener('message',event=>{
  if(!target||event.source!==target||event.data?.token!==token)return;
  const m=event.data;
  if(m.type==='zumi-typer-ready'){ready=true;transmit();}
  if(m.type==='zumi-typer-hide'&&overlay){overlay.hidden=true;}
  if(m.type==='zumi-typer-project-result'&&pending&&m.requestId===pending.id){
   const p=pending;pending=null;clearTimeout(p.timer);
   m.ok?p.resolve(m):p.reject(Error(m.error||'Zumi Typer no pudo recibir el lote.'));
  }
  if(m.type==='zumi-typer-prefixes'){
   try{applyPrefixes(m.prefixes,m.folderName);target.postMessage({type:'zumi-typer-prefixes-result',token,ok:true},'*');}
   catch(e){target.postMessage({type:'zumi-typer-prefixes-result',token,ok:false,error:e.message},'*');}
  }
 });

 $('openPhotopeaTool').onclick=()=>{
  if(open()){
   const data=getData();
   if(!data.pages?.length)return;
   send(data).then(()=>tell('Coordenadas recibidas en Zumi Typer. Para enviar también imágenes usa Exportar imágenes.')).catch(e=>tell(e.message));
  }
 };
 return{open,send};
};
