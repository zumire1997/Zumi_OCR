'use strict';
window.ZumiPanels=function({$,main,panels,renderStage,isBusy}){
 const key='zumi-ocr-panel-layout-v1',desktop=matchMedia('(min-width:851px) and (not (pointer:coarse))');
 const elements={sidebar:main.querySelector('.sidebar'),editor:main.querySelector('.editor')};
 const initial={sidebar:{width:218,floating:false,x:30,y:110,w:270,h:620},editor:{width:440,floating:false,x:600,y:120,w:480,h:620}};
 let layout=structuredClone(initial),operation=null,frame=0;
 try{const s=JSON.parse(localStorage.getItem(key)||'null');for(const id of Object.keys(layout))for(const k of Object.keys(layout[id]))if(typeof s?.[id]?.[k]===typeof layout[id][k]&&(typeof s[id][k]!=='number'||Number.isFinite(s[id][k])))layout[id][k]=s[id][k];}catch{}
 const visible=id=>id==='sidebar'?panels().pages:panels().text||panels().translate||panels().clean;
 const clamp=(n,a,b)=>Math.max(a,Math.min(Math.max(a,b),n));
 const persist=()=>{try{localStorage.setItem(key,JSON.stringify(layout));}catch{}};
 const splitters={},toggles={};
 function dimensions(id){
  const d=layout[id];d.w=clamp(d.w,id==='sidebar'?190:300,innerWidth-16);d.h=clamp(d.h,220,innerHeight-16);d.x=clamp(d.x,0,innerWidth-d.w);d.y=clamp(d.y,0,innerHeight-d.h);return d;
 }
 function schedule(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;refresh();renderStage();});}
 function refresh(){
  const on=desktop.matches,width=main.clientWidth;
  let left=on&&visible('sidebar')&&!layout.sidebar.floating?clamp(layout.sidebar.width,170,Math.min(400,width-560)):0;
  let right=on&&visible('editor')&&!layout.editor.floating?clamp(layout.editor.width,300,width-left-240):0;
  if(on){main.style.setProperty('--sidebar-width',left+'px');main.style.setProperty('--editor-width',right+'px');}
  else{main.style.removeProperty('--sidebar-width');main.style.removeProperty('--editor-width');}
  for(const id of Object.keys(elements)){
   const el=elements[id],floating=on&&layout[id].floating;el.classList.toggle('panel-floating',floating);
   toggles[id].hidden=!on;toggles[id].textContent=floating?'Fijar':'↗';toggles[id].title=floating?'Volver a fijar este panel':'Desacoplar y mover este panel';toggles[id].setAttribute('aria-label',toggles[id].title);
   if(floating){const d=dimensions(id);Object.assign(el.style,{left:d.x+'px',top:d.y+'px',width:d.w+'px',height:d.h+'px'});}
   else for(const p of ['left','top','width','height'])el.style.removeProperty(p);
   const splitter=splitters[id],show=on&&visible(id)&&!floating;splitter.hidden=!show;splitter.style.left=(id==='sidebar'?left:width-right)+'px';splitter.setAttribute('aria-valuenow',String(Math.round(id==='sidebar'?left:right)));splitter.setAttribute('aria-disabled',String(isBusy()));
  }
 }
 function begin(e,op){
  if(!desktop.matches||isBusy()||e.button!==0)return;
  const d=layout[op.id];if(op.kind==='dock')d.width=elements[op.id].getBoundingClientRect().width;operation={...op,startX:e.clientX,startY:e.clientY,before:structuredClone(d),target:e.currentTarget};
  e.currentTarget.setPointerCapture(e.pointerId);document.body.classList.add('panel-adjusting');elements[op.id].classList.add('panel-raised');e.preventDefault();
 }
 function move(e){
  if(!operation)return;const o=operation,d=layout[o.id],b=o.before,dx=e.clientX-o.startX,dy=e.clientY-o.startY;
  if(o.kind==='dock'){d.width=b.width+(o.id==='sidebar'?dx:-dx);const available=main.clientWidth-240-(visible(o.id==='sidebar'?'editor':'sidebar')&&!layout[o.id==='sidebar'?'editor':'sidebar'].floating?layout[o.id==='sidebar'?'editor':'sidebar'].width:0);d.width=clamp(d.width,o.id==='sidebar'?170:300,Math.min(o.id==='sidebar'?400:900,available));}
  else if(o.kind==='move'){d.x=b.x+dx;d.y=b.y+dy;}
  else{
   const edges=o.edges,minW=o.id==='sidebar'?190:300;
   if(edges.includes('e'))d.w=clamp(b.w+dx,minW,innerWidth-b.x);
   if(edges.includes('s'))d.h=clamp(b.h+dy,220,innerHeight-b.y);
   if(edges.includes('w')){d.x=clamp(b.x+dx,0,b.x+b.w-minW);d.w=b.w+b.x-d.x;}
   if(edges.includes('n')){d.y=clamp(b.y+dy,0,b.y+b.h-220);d.h=b.h+b.y-d.y;}
  }
  schedule();
 }
 function finish(e,cancel=false){if(!operation)return;const o=operation;if(cancel)layout[o.id]=o.before;operation=null;document.body.classList.remove('panel-adjusting');elements[o.id].classList.remove('panel-raised');try{o.target.releasePointerCapture(e.pointerId);}catch{}refresh();renderStage();persist();}
 function handle(target,op){target.addEventListener('pointerdown',e=>begin(e,op));target.addEventListener('pointermove',move);target.addEventListener('pointerup',e=>finish(e));target.addEventListener('pointercancel',e=>finish(e,true));target.addEventListener('lostpointercapture',e=>{if(operation?.target===target)finish(e,true);});}
 for(const id of Object.keys(elements)){
  const el=elements[id],header=id==='sidebar'?el.querySelector('.section-label'):el.querySelector('.tabs');header.classList.add('panel-drag-header');
  const toggle=id==='editor'?$('expandEditor'):document.createElement('button');toggle.type='button';toggle.className='panel-toggle';if(id==='sidebar'){toggle.id='floatPages';header.append(toggle);}toggles[id]=toggle;
  toggle.onclick=()=>{if(!desktop.matches||isBusy())return;const d=layout[id];if(!d.floating){const b=el.getBoundingClientRect();d.x=b.left;d.y=b.top;d.w=Math.min(id==='editor'?560:320,Math.max(id==='editor'?380:230,b.width));d.h=Math.min(Math.max(360,b.height),Math.max(260,innerHeight*.74));}d.floating=!d.floating;refresh();renderStage();persist();};
  header.addEventListener('pointerdown',e=>{if(e.target.closest('button,input,select')||!layout[id].floating)return;begin(e,{id,kind:'move'});});header.addEventListener('pointermove',move);header.addEventListener('pointerup',e=>finish(e));header.addEventListener('pointercancel',e=>finish(e,true));
  const grip=document.createElement('span');grip.className='panel-grip';grip.textContent='⠿';grip.title='Arrastra para mover el panel';header.prepend(grip);
  for(const edges of ['n','e','s','w','ne','nw','se','sw']){const h=document.createElement('span');h.className='panel-edge panel-edge-'+edges;h.setAttribute('aria-hidden','true');el.append(h);handle(h,{id,kind:'resize',edges});}
  const splitter=document.createElement('div');splitter.className='panel-splitter';splitter.role='separator';splitter.tabIndex=0;splitter.setAttribute('aria-orientation','vertical');splitter.setAttribute('aria-label',id==='sidebar'?'Ancho de Páginas y OCR':'Ancho del editor de textos');splitter.title='Arrastra para ajustar el ancho. Doble clic para restablecer.';main.append(splitter);splitters[id]=splitter;handle(splitter,{id,kind:'dock'});
  splitter.ondblclick=()=>{layout[id].width=initial[id].width;refresh();renderStage();persist();};
  splitter.onkeydown=e=>{if(isBusy()||!['ArrowLeft','ArrowRight','Home'].includes(e.key))return;e.preventDefault();layout[id].width=e.key==='Home'?initial[id].width:layout[id].width+(e.key==='ArrowLeft'?-20:20)*(id==='sidebar'?1:-1);refresh();renderStage();persist();};
 }
 $('resetPanelLayout').onclick=()=>{if(isBusy())return;layout=structuredClone(initial);refresh();renderStage();persist();};
 desktop.addEventListener('change',schedule);window.addEventListener('resize',schedule);
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&operation){e.preventDefault();finish(e,true);}});
 refresh();return {refresh};
};
