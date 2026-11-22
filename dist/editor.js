'use strict';
(() => {
const $ = id => document.getElementById(id);
const notices=window.ZumiNotices($);
const prefixData=window.ZumiPrefixData;const savedPrefixes=prefixData.read();
const uid = () => globalThis.crypto?.randomUUID?.() || 'z'+Date.now().toString(36)+Math.random().toString(36).slice(2);
const ocrLanguages=['kor','eng','jpn','chi_sim','chi_tra','tha','rus'];
const defaults = {language:'kor',ocrEngine:'tesseract',onlyHangul:true,minConfidence:30,groupLines:true,ollamaURL:'http://127.0.0.1:11435',model:'',instructions:$('instructions').value,glossary:'',overwriteTranslations:false};
const state = {name:'Mi capítulo',pages:[],pageId:null,selected:new Set(),settings:{...defaults},prefixFolders:savedPrefixes.folders,activePrefixFolderId:savedPrefixes.activeFolderId,prefixes:savedPrefixes.items,defaultPrefix:savedPrefixes.defaultPrefix,mode:'select',zoom:1};
let busy=false, cancelled=false, worker=null, workerLanguage='', workerURL=null, aborter=null, saveTimer=null,unsaved=false,sessionStarted=false;
let taskEpoch=0, cancelSignal=null, resolveCancel=null;
let drag=null, orderDrag=null, tempRect=null, undoStack=[], redoStack=[];
let workspaceUI=null,prefixUI=null,visionUI=null,cleanUI=null;
const page = () => state.pages.find(p=>p.id===state.pageId);
const selectedBoxes = () => page()?.boxes.filter(b=>state.selected.has(b.id)) || [];
const tell = msg => notices.show(msg);
function node(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function finite(value,fallback=0){const n=Number(value);return Number.isFinite(n)?n:fallback;}
function normalBox(b={}) {
 const text = typeof b.ocr==='string' ? b.ocr.replace(/^\ufeff?_{4,}\s*/, '').replace(/\ufeff/g,'').replace(/\s*\r?\n\s*/g,' ') : '';
 const translated=typeof b.trad==='string'?b.trad:typeof b.translation==='string'?b.translation:b.final_translation||b.t_text||'';
 const finalOnly=typeof b.trad!=='string'&&typeof b.translation!=='string';
 return {id:typeof b.id==='string'?b.id:uid(),x:Math.max(0,Math.round(finite(b.x))),y:Math.max(0,Math.round(finite(b.y))),w:Math.max(1,Math.round(finite(b.w,100))),h:Math.max(1,Math.round(finite(b.h,60))),ocr:text,trad:typeof translated==='string'&&!(finalOnly&&translated.replace(/\s+/g,' ').trim()===text.replace(/\s+/g,' ').trim())?translated:'',prefix:prefixData.importCode(b),prefixName:typeof (b.prefixName??b.prefix_name)==='string'?String(b.prefixName??b.prefix_name).trim().slice(0,80):(state.prefixes.find(p=>p.code===prefixData.importCode(b))?.name||''),confidence:Math.min(1,Math.max(0,finite(b.confidence)))};
}
function applyDefaultPrefix(b){if(!b.prefix)Object.assign(b,prefixUI.assignment());return b;}
function clampBox(b,p){if(!p?.width)return;b.x=Math.max(0,Math.min(p.width-1,Math.round(b.x)));b.y=Math.max(0,Math.min(p.height-1,Math.round(b.y)));b.w=Math.max(1,Math.min(p.width-b.x,Math.round(b.w)));b.h=Math.max(1,Math.min(p.height-b.y,Math.round(b.h)));}
function sortBoxes(boxes){return boxes.sort((a,b)=>a.y-b.y||a.x-b.x);}
function hasOrder(b){return Number.isSafeInteger(b?.order)&&b.order>0;}
function readBoxes(boxes){const rows=boxes.map((b,i)=>({b,i}));if(boxes.some(hasOrder))rows.sort((a,b)=>(hasOrder(a.b)?a.b.order:a.i+1)-(hasOrder(b.b)?b.b.order:b.i+1)||a.i-b.i);return rows.map(r=>normalBox(r.b));}
function readingMode(raw){return ['manual','position'].includes(raw.reading_order)?raw.reading_order:raw.boxes.some(hasOrder)?'manual':'position';}
function snapshot(){return {prefixFolders:structuredClone(state.prefixFolders),activePrefixFolderId:state.activePrefixFolderId,prefixes:structuredClone(state.prefixes),defaultPrefix:state.defaultPrefix,pages:state.pages.map(p=>({...p,boxes:structuredClone(p.boxes)})),settings:{...state.settings},pageId:state.pageId,selected:[...state.selected],name:state.name};}
function checkpoint(){undoStack.push(snapshot());if(undoStack.length>60)undoStack.shift();redoStack=[];}
function restoreSnap(s){cleanUI?.resetDraft();if(s.prefixFolders)state.prefixFolders=structuredClone(s.prefixFolders);if(s.activePrefixFolderId)state.activePrefixFolderId=s.activePrefixFolderId;state.prefixes=structuredClone(s.prefixes||state.prefixes);state.defaultPrefix=s.defaultPrefix||'';prefixUI?.persist();state.pages=s.pages.map(p=>({...p,boxes:structuredClone(p.boxes)}));state.pageId=state.pages.some(p=>p.id===s.pageId)?s.pageId:state.pages[0]?.id||null;state.selected=new Set(s.selected||[]);state.name=s.name;state.settings={...s.settings};syncSettings();render();changed();}
function undo(){if(!undoStack.length)return;redoStack.push(snapshot());restoreSnap(undoStack.pop());}
function redo(){if(!redoStack.length)return;undoStack.push(snapshot());restoreSnap(redoStack.pop());}
function changed(){unsaved=true;clearTimeout(saveTimer);$('autosave').textContent='Cambios sin guardar…';saveTimer=setTimeout(saveSession,800);}
function setBusy(value){busy=value;document.querySelectorAll('button,input,select,textarea').forEach(el=>{if(!['cancel','help','themeToggle','showBoxes','zoomIn','zoomOut','fitWidth','windowMenu','expandEditor','dismissNotice'].includes(el.id)&&!el.closest('#windowDialog'))el.disabled=value;});$('progress').hidden=!value;$('cancel').hidden=!value;notices.setBusy(value);if(!value){$('progress').value=0;aborter=null;}updateOCRControls();workspaceUI?.refresh();if(!value)translator.refresh();}
async function runTask(fn){if(busy)return;cancelled=false;taskEpoch++;cancelSignal=new Promise(resolve=>resolveCancel=resolve);setBusy(true);try{await fn();}catch(e){console.error(e);tell(cancelled?'Operación detenida. Se conservan los resultados terminados.':'Error: '+(e?.message||String(e)));}finally{setBusy(false);render();changed();}}
function cancellable(promise){return Promise.race([promise,cancelSignal.then(()=>{throw new Error('Operación detenida.');})]);}
function choosePage(id){if(busy||drag||orderDrag||!state.pages.some(p=>p.id===id))return;state.pageId=id;state.selected.clear();render();fitWidth();$('viewport').scrollTop=0;$('viewport').scrollLeft=0;}
function countMissingPrefixes(){
 let total=0;
 for(const p of state.pages)for(const bx of p.boxes||[])if(!(bx.prefix||'').trim())total++;
 return total;
}
function updateMissingPrefixUI(){
 const total=countMissingPrefixes(),btn=$('jumpMissingPrefix'),bar=$('batchPrefixBar');
 if(btn){
  btn.hidden=total===0;
  btn.textContent='⚠ '+total;
  btn.title=total===1?'Ir a la caja sin prefijo del capítulo':'Ir a la siguiente caja sin prefijo ('+total+' en el capítulo)';
 }
}
function jumpToNextMissingPrefix(){
 if(busy||!state.pages.length)return;
 const flat=[];
 for(const p of state.pages){
  for(let i=0;i<(p.boxes||[]).length;i++){
   const bx=p.boxes[i];
   if(!(bx.prefix||'').trim())flat.push({page:p,box:bx,idx:i});
  }
 }
 if(!flat.length)return tell('¡Todas las cajas del capítulo tienen prefijo!');
 const curPageIdx=state.pages.findIndex(p=>p.id===state.pageId);
 const curSelId=[...state.selected][0]||'';
 const curBoxIdx=curPageIdx>=0?(state.pages[curPageIdx].boxes||[]).findIndex(b=>b.id===curSelId):-1;
 let next=flat.find(item=>{
  const pi=state.pages.indexOf(item.page);
  return pi>curPageIdx||(pi===curPageIdx&&item.idx>curBoxIdx);
 })||flat[0];
 const switched=next.page.id!==state.pageId;
 if(switched){state.pageId=next.page.id;render();fitWidth();}
 const textTab=document.querySelector('.tabs [data-tab="text"]');
 if(textTab&&!textTab.classList.contains('active'))textTab.click();
 select([next.box.id],{image:true});
 tell('Caja #'+(next.idx+1)+' sin prefijo en '+next.page.filename+' ('+flat.length+' pendientes en total).');
}
function renderPages(){
 const container=$('pages');container.replaceChildren();$('pageCount').textContent=state.pages.length;
 for(let i=0;i<state.pages.length;i++){
  const p=state.pages[i],row=node('div','page-row'),b=node('button','page-button'+(p.id===state.pageId?' active':''));
  b.disabled=busy;
  const missing=(p.boxes||[]).filter(bx=>!(bx.prefix||'').trim()).length;
  b.append(node('span','page-number',String(i+1).padStart(2,'0')),node('span','page-name',p.filename));
  if(missing>0){
   const badge=node('span','page-missing-prefix','⚠'+missing);
   badge.title=missing+(missing===1?' caja sin prefijo':' cajas sin prefijo');
   b.append(badge);
  }
  b.append(node('small','',String(p.boxes.length)));
  b.title=p.filename+(missing?' · '+missing+' sin prefijo':'');
  b.onclick=()=>choosePage(p.id);
  const remove=node('button','page-remove','×');remove.disabled=busy;remove.title='Quitar '+p.filename+' del proyecto';remove.setAttribute('aria-label','Quitar imagen '+p.filename);remove.onclick=()=>removePage(p.id);
  row.append(b,remove);container.append(row);
 }
 updateMissingPrefixUI();
 updateOCRControls();
}
function updateOCRControls(){$('onlyHangulLabel').hidden=state.settings.language!=='kor';$('onlyHangul').disabled=busy||state.settings.language!=='kor';$('removePage').disabled=busy||!page();$('removeAllPages').disabled=busy||!state.pages.length;}
function removePage(id=state.pageId){if(busy)return;const index=state.pages.findIndex(p=>p.id===id);if(index<0)return;const removed=state.pages[index];checkpoint();state.pages.splice(index,1);if(state.pageId===id){state.pageId=state.pages[Math.min(index,state.pages.length-1)]?.id||null;state.selected.clear();}sessionStarted=true;render();fitWidth();changed();tell('Imagen quitada del proyecto: '+removed.filename+'. Puedes recuperarla con Deshacer (Ctrl+Z).');}
function requestRemoveAllPages(){
 if(busy||drag||orderDrag||!state.pages.length)return;
 const count=state.pages.length,boxes=state.pages.reduce((n,p)=>n+p.boxes.length,0);
 $('removeAllSummary').textContent='Se quitarán '+count+' imágenes y sus '+boxes+' cajas de texto de este proyecto.';
 if(!$('removeAllDialog').open)$('removeAllDialog').showModal();
}
function removeAllPages(){
 if(busy||drag||orderDrag||!state.pages.length)return;
 const count=state.pages.length;checkpoint();state.pages=[];state.pageId=null;state.selected.clear();tempRect=null;sessionStarted=true;
 $('pageImage').removeAttribute('src');$('overlay').replaceChildren();$('search').value='';$('viewport').scrollTop=0;$('viewport').scrollLeft=0;
 $('removeAllDialog').close();render();changed();
 tell(count+' imágenes quitadas del proyecto. Deshacer (Ctrl+Z) recupera el capítulo completo.');
}
function render(){renderPages();renderStage();renderCards();renderInspector();workspaceUI?.refresh();visionUI?.refresh();cleanUI?.refresh();}
function renderStage(){const p=page();$('empty').hidden=Boolean(p?.blob);$('stage').hidden=!p?.blob;if(!p?.blob){$('empty').querySelector('h1').textContent=p?'Carga el raw para ver estas coordenadas.':'Extrae y traduce el texto del capítulo.';return;}if($('pageImage').src!==p.url)$('pageImage').src=p.url;$('stage').style.width=p.width*state.zoom+'px';$('stage').style.height=p.height*state.zoom+'px';$('stage').classList.toggle('adding',state.mode!=='select');$('overlay').setAttribute('viewBox',`0 0 ${p.width} ${p.height}`);$('stage').classList.toggle('cleaning',state.mode==='clean');$('zoomValue').textContent=Math.round(state.zoom*100)+'%';renderOverlay();}
function svg(tag,attrs={}){const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;}
function renderOverlay(){const p=page(),s=$('overlay');s.replaceChildren();if(!p?.blob)return;cleanUI?.overlay(s,p);const show=$('showBoxes').checked;
 for(let i=0;i<p.boxes.length;i++){const b=p.boxes[i];
  if(show){const r=svg('rect',{x:b.x,y:b.y,width:b.w,height:b.h,class:'box-outline'+(state.selected.has(b.id)?' selected':''),'data-box-id':b.id});s.append(r);const markSize=21/state.zoom;const badge=svg('rect',{x:b.x,y:Math.max(0,b.y-markSize),width:markSize*1.5,height:markSize,rx:3/state.zoom,fill:state.selected.has(b.id)?'#d982b1':'#7756b5','pointer-events':'none'});s.append(badge);const t=svg('text',{x:b.x+markSize*.75,y:Math.max(0,b.y-markSize)+markSize*.72,'font-size':12/state.zoom,'font-family':'Arial','font-weight':'bold',fill:'white','text-anchor':'middle','pointer-events':'none'});t.textContent=i+1;s.append(t);if(state.selected.has(b.id)){const size=11/state.zoom;s.append(svg('rect',{x:b.x+b.w-size/2,y:b.y+b.h-size/2,width:size,height:size,class:'resize-handle','data-box-id':b.id,'data-resize':'true'}));}}
 }
 if(tempRect)s.append(svg('rect',{x:tempRect.x,y:tempRect.y,width:tempRect.w,height:tempRect.h,fill:'#d982b133',stroke:'#d982b1','stroke-dasharray':'4 3','vector-effect':'non-scaling-stroke'}));
}
function select(ids,{image=false,cards=true}={}){state.selected=new Set(ids);renderOverlay();if(cards)renderCards();else document.querySelectorAll('.box-card').forEach(el=>el.classList.toggle('selected',state.selected.has(el.dataset.id)));renderInspector();const b=selectedBoxes()[0];if(b&&image){$('viewport').scrollTo({top:Math.max(0,b.y*state.zoom-$('viewport').clientHeight*.25),behavior:'smooth'});}if(b&&!image){const card=Array.from($('boxList').children).find(el=>el.dataset.id===b.id);if(card)$('boxList').scrollTop=Math.max(0,card.offsetTop-$('boxList').offsetTop-8);}}
function renderCards(){const list=$('boxList'),scroll=list.scrollTop;list.replaceChildren();const p=page(),q=$('search').value.toLowerCase();$('boxCount').textContent=(p?.boxes.length||0)+' cajas';$('readingOrderStatus').textContent=p?.readingOrder==='manual'?'Orden manual':'Orden de arriba abajo';$('readingOrderHint').hidden=!q;$('resetReadingOrder').disabled=busy||Boolean(q)||(p?.boxes.length||0)<2;if(!p?.boxes.length){list.append(node('p','hint','Aquí aparecerán los textos escaneados.'));return;}
 p.boxes.forEach((b,i)=>{if(q&&!(b.ocr+' '+b.trad+' '+b.prefix+' '+b.prefixName).toLowerCase().includes(q))return;const card=node('div','box-card'+(state.selected.has(b.id)?' selected':''));card.dataset.id=b.id;card.setAttribute('role','listitem');const title=node('div','card-title');title.append(node('b','',String(i+1)),node('span','',`${Math.round(b.confidence*100)}% OCR`),node('span','translated',b.trad.trim()?'Traducido':'Pendiente'));addOrderControls(card,title,b,i,Boolean(q));card.append(title);prefixUI.renderCard(card,b,i);
  for(const [field,label]of [['ocr','ORIGINAL'],['trad','ESPAÑOL']]){const lab=node('label','',label),input=node('textarea');input.value=b[field];input.rows=3;input.disabled=busy;input.setAttribute('aria-label',label+' '+(i+1));input.onfocus=()=>{checkpoint();if(!state.selected.has(b.id)||state.selected.size!==1)select([b.id],{image:true,cards:false});};input.oninput=()=>{b[field]=input.value;title.querySelector('.translated').textContent=b.trad.trim()?'Traducido':'Pendiente';renderOverlay();changed();};lab.append(input);card.append(lab);}
  card.addEventListener('click',e=>{
   if(e.target.closest('textarea,select,input,button'))return;
   if(e.shiftKey&&state.selected.size){
    const cur=page()?.boxes||[],lastId=[...state.selected].at(-1),a=cur.findIndex(x=>x.id===lastId),z=cur.findIndex(x=>x.id===b.id);
    if(a>=0&&z>=0){const ids=new Set(state.selected);for(let k=Math.min(a,z);k<=Math.max(a,z);k++)ids.add(cur[k].id);select(ids,{image:true});return;}
   }
   const ids=e.ctrlKey||e.metaKey?new Set(state.selected):new Set();
   if(ids.has(b.id))ids.delete(b.id);else ids.add(b.id);
   select(ids,{image:true});
  });list.append(card);
 });list.scrollTop=scroll;
}
function endOrderDrag(){orderDrag=null;document.querySelectorAll('.box-card').forEach(el=>el.classList.remove('order-source','drop-before','drop-after'));workspaceUI?.refresh();}
function moveReadingBox(id,index,focusAction='handle'){
 const p=page();if(busy||drag||!p||$('search').value)return;
 const from=p.boxes.findIndex(b=>b.id===id),to=Math.max(0,Math.min(p.boxes.length-1,index));
 if(from<0||from===to)return;
 checkpoint();const [box]=p.boxes.splice(from,1);p.boxes.splice(to,0,box);p.readingOrder='manual';state.selected=new Set([id]);render();changed();
 const card=[...$('boxList').children].find(el=>el.dataset.id===id),button=card?.querySelector('[data-order-action="'+focusAction+'"]');
 (button&&!button.disabled?button:card?.querySelector('[data-order-action="handle"]'))?.focus({preventScroll:true});card?.scrollIntoView({block:'nearest'});
}
function addOrderControls(card,title,b,index,filtered){
 const controls=node('div','order-controls'),locked=busy||filtered;
 for(const [action,label,hint]of [['up','↑','Subir diálogo'],['down','↓','Bajar diálogo'],['handle','↕','Arrastrar diálogo']]){
  const button=node('button','order-'+action,label);button.dataset.orderAction=action;button.title=hint+' '+(index+1)+' en el orden de lectura';button.setAttribute('aria-label',button.title);button.disabled=locked||action==='up'&&index===0||action==='down'&&index===page().boxes.length-1;
  button.onclick=e=>{e.stopPropagation();if(action!=='handle')moveReadingBox(b.id,index+(action==='up'?-1:1),action);};
  if(action==='handle'){
   button.draggable=!locked;
   button.ondragstart=e=>{if(locked||busy||drag){e.preventDefault();return;}orderDrag={id:b.id,pageId:state.pageId};e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('application/x-zumi-reading-order',b.id);card.classList.add('order-source');workspaceUI?.refresh();};
   button.ondragend=endOrderDrag;
  }
  controls.append(button);
 }
 card.ondragover=e=>{if(!orderDrag||orderDrag.pageId!==state.pageId||orderDrag.id===b.id||locked)return;e.preventDefault();e.dataTransfer.dropEffect='move';document.querySelectorAll('.drop-before,.drop-after').forEach(el=>el.classList.remove('drop-before','drop-after'));card.classList.add(e.clientY<card.getBoundingClientRect().top+card.offsetHeight/2?'drop-before':'drop-after');};
 card.ondragleave=e=>{if(!card.contains(e.relatedTarget))card.classList.remove('drop-before','drop-after');};
 card.ondrop=e=>{
  if(!orderDrag||orderDrag.pageId!==state.pageId||locked)return;e.preventDefault();e.stopPropagation();
  const id=orderDrag.id,from=page().boxes.findIndex(box=>box.id===id),after=e.clientY>=card.getBoundingClientRect().top+card.offsetHeight/2;
  let to=index+(after?1:0);if(from<to)to--;endOrderDrag();moveReadingBox(id,to);
 };
 title.append(controls);
}
function resetReadingOrder(){const p=page();if(busy||drag||orderDrag||!p||p.boxes.length<2||$('search').value)return;checkpoint();sortBoxes(p.boxes);p.readingOrder='position';render();changed();tell('Orden de arriba abajo restaurado. Puedes deshacerlo con Ctrl+Z.');}
function renderInspector(){const boxes=selectedBoxes(),b=boxes[0];prefixUI?.renderSelection(boxes);updateMissingPrefixUI();$('inspector').hidden=!b;$('boxHeading').textContent=boxes.length>1?boxes.length+' seleccionadas':'Diálogos';if(!b)return;for(const [id,key]of [['coordX','x'],['coordY','y'],['coordW','w'],['coordH','h']])$(id).value=b[key];}
function fitWidth(){const p=page();if(!p?.blob)return;state.zoom=Math.min(2,Math.max(.05,($('viewport').clientWidth-50)/p.width));renderStage();}
function zoom(factor){state.zoom=Math.max(.05,Math.min(4,state.zoom*factor));renderStage();}
function point(e){const r=$('overlay').getBoundingClientRect();return {x:Math.max(0,Math.min(page().width,(e.clientX-r.left)/state.zoom)),y:Math.max(0,Math.min(page().height,(e.clientY-r.top)/state.zoom))};}
$('overlay').addEventListener('pointerdown',e=>{if(busy||!page()?.blob||e.button!==0)return;const pos=point(e),target=e.target.closest('[data-box-id]');if(state.mode!=='select'){drag={kind:'add',start:pos,read:state.mode==='read'};tempRect={x:pos.x,y:pos.y,w:0,h:0};}else if(target){const id=target.dataset.boxId;if(e.ctrlKey||e.metaKey){const ids=new Set(state.selected);ids.has(id)?ids.delete(id):ids.add(id);select(ids);return;}if(!state.selected.has(id))select([id]);checkpoint();drag={kind:target.dataset.resize?'resize':'move',start:pos,boxes:selectedBoxes().map(b=>({id:b.id,x:b.x,y:b.y,w:b.w,h:b.h})),targetId:id};}else{select([]);return;}$('overlay').setPointerCapture(e.pointerId);e.preventDefault();});
$('overlay').addEventListener('pointermove',e=>{if(!drag)return;const p=page(),pos=point(e),dx=pos.x-drag.start.x,dy=pos.y-drag.start.y;if(drag.kind==='add'){tempRect={x:Math.min(pos.x,drag.start.x),y:Math.min(pos.y,drag.start.y),w:Math.abs(dx),h:Math.abs(dy)};}else if(drag.kind==='move'){const minX=Math.min(...drag.boxes.map(b=>b.x)),minY=Math.min(...drag.boxes.map(b=>b.y)),maxX=Math.max(...drag.boxes.map(b=>b.x+b.w)),maxY=Math.max(...drag.boxes.map(b=>b.y+b.h));const actualX=Math.max(-minX,Math.min(p.width-maxX,dx)),actualY=Math.max(-minY,Math.min(p.height-maxY,dy));for(const orig of drag.boxes){const b=p.boxes.find(b=>b.id===orig.id);const r=b;r.x=Math.round(orig.x+actualX);r.y=Math.round(orig.y+actualY);}}else{const orig=drag.boxes.find(b=>b.id===drag.targetId),b=p.boxes.find(b=>b.id===drag.targetId);const r=b;r.w=Math.max(4,orig.w+dx);r.h=Math.max(4,orig.h+dy);clampBox(r,p);}renderOverlay();renderInspector();});
function finishDrag(){if(!drag)return;let read=false;if(drag.kind==='add'&&tempRect?.w>=4&&tempRect.h>=4){checkpoint();const b=applyDefaultPrefix(normalBox({...tempRect,confidence:1}));clampBox(b,page());page().boxes.push(b);if(page().readingOrder!=='manual')sortBoxes(page().boxes);state.selected=new Set([b.id]);read=drag.read;}drag=null;tempRect=null;render();changed();if(read){setMode('select');doOCR(false,true);}}
$('overlay').addEventListener('pointerup',finishDrag);$('overlay').addEventListener('pointercancel',finishDrag);
function setMode(mode){state.mode=mode;$('selectMode').classList.toggle('active',mode==='select');$('addMode').classList.toggle('active',mode==='add');$('readMode').classList.toggle('active',mode==='read');renderStage();if(mode==='read')tell('Dibuja un rectángulo que incluya solo las letras del globo, dejando fuera el borde.');}
async function loadBlob(blob,filename){const url=URL.createObjectURL(blob);try{const image=new Image();image.src=url;await image.decode();return {id:uid(),filename,blob,url,image,width:image.naturalWidth,height:image.naturalHeight,boxes:[],readingOrder:'position'};}catch(e){URL.revokeObjectURL(url);throw new Error('No pude abrir '+filename+'. Usa JPG, PNG, WebP o BMP.');}}
async function loadImages(files){if(busy)return;await runTask(async()=>{const images=Array.from(files).filter(f=>/\.(png|jpe?g|webp|bmp)$/i.test(f.name)).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));if(!images.length){tell('No encontré imágenes compatibles. Usa JPG, PNG, WebP o BMP.');return;}checkpoint();let added=0,duplicates=0;for(const f of images){if(cancelled)break;const match=state.pages.find(p=>p.filename.toLowerCase()===f.name.toLowerCase());if(match?.blob){duplicates++;continue;}const loaded=await loadBlob(f,f.name);if(match){Object.assign(match,{...loaded,id:match.id,boxes:match.boxes,readingOrder:match.readingOrder||'position'});match.boxes.forEach(b=>clampBox(b,match));}else state.pages.push(loaded);added++;}if(!state.pageId&&state.pages.length)state.pageId=state.pages[0].id;if(added)sessionStarted=true;render();fitWidth();tell(`${added} imágenes cargadas${duplicates?'. '+duplicates+' nombres repetidos omitidos':''}. Elige el idioma y escanea una página.`);});}
function exportCoordinates(){return state.pages.map((p,i)=>({page_index:i+1,filename:p.filename,full_path:p.filename,width:p.width||undefined,height:p.height||undefined,reading_order:p.readingOrder||'position',boxes:p.boxes.map((b,index)=>{const final=b.trad.trim()||b.ocr.trim();return {id:b.id,order:index+1,prefix:b.prefix||'',prefix_name:b.prefixName||'',x:b.x,y:b.y,w:b.w,h:b.h,ocr:b.ocr,trad:b.trad,translation:b.trad,t_text:final,final_translation:final,confidence:b.confidence};})}));}
function importCoordinates(raw){const items=Array.isArray(raw)?raw:raw?.pages;if(!Array.isArray(items))throw new Error('El JSON debe contener una lista de páginas o un objeto con pages.');const staged=[];const names=new Set();for(const [i,item]of items.entries()){if(!item||typeof item!=='object'||!Array.isArray(item.boxes))throw new Error('Página '+(i+1)+' sin boxes.');const filename=String(item.filename||String(i+1).padStart(2,'0')+'.jpg').split(/[\\/]/).pop();if(names.has(filename.toLowerCase()))throw new Error('Nombre de página repetido: '+filename);names.add(filename.toLowerCase());staged.push({filename,boxes:readBoxes(item.boxes),readingOrder:readingMode(item)});}checkpoint();for(const item of staged){let p=state.pages.find(p=>p.filename.toLowerCase()===item.filename.toLowerCase());if(p){p.boxes=item.boxes;p.readingOrder=item.readingOrder;if(p.blob)p.boxes.forEach(b=>clampBox(b,p));}else{p={id:uid(),filename:item.filename,boxes:item.boxes,readingOrder:item.readingOrder,blob:null,url:'',image:null,width:0,height:0};state.pages.push(p);}}if(!state.pageId&&state.pages.length)state.pageId=state.pages[0].id;state.selected.clear();render();changed();tell('Coordenadas importadas. '+(state.pages.some(p=>!p.blob)?'Carga los raws con los mismos nombres para ver las imágenes.':'Revisa las cajas sobre los raws.'));}
function download(blob,name){const a=node('a');const u=URL.createObjectURL(blob);a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),10000);}
function jsonDownload(value,name){download(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}),name);}
const safeName = value=>String(value).replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').slice(0,100)||'zumi';
function blobDataURL(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});}
async function saveProject(){if(!state.pages.length)return tell('Carga imágenes primero.');await runTask(async()=>{tell('Preparando proyecto con sus imágenes…');const pages=[];for(const p of state.pages)pages.push({id:p.id,filename:p.filename,width:p.width||undefined,height:p.height||undefined,reading_order:p.readingOrder||'position',cleanEdits:p.cleanEdits||[],boxes:p.boxes.map((b,index)=>({...b,order:index+1})),imageData:p.blob?await blobDataURL(p.blob):null});jsonDownload({format:'zumi-ocr-project',version:2,name:state.name,settings:state.settings,prefix_folders:state.prefixFolders,active_prefix_folder_id:state.activePrefixFolderId,prefixes:state.prefixes,default_prefix:state.defaultPrefix,pages},safeName(state.name)+'.zumi.json');tell('Proyecto descargado. Incluye raws, limpieza, textos y coordenadas.');});}
async function openProject(raw){if(raw?.format!=='zumi-ocr-project'){importCoordinates(raw);return;}if(!Array.isArray(raw.pages))throw new Error('Proyecto sin páginas.');const incomingLib=Array.isArray(raw.prefix_folders)&&raw.prefix_folders.length?prefixData.library({folders:raw.prefix_folders,activeFolderId:raw.active_prefix_folder_id}):null;const prefixCatalog=incomingLib?incomingLib.items:raw.prefixes===undefined?structuredClone(state.prefixes):prefixData.catalog(raw.prefixes),requestedDefault=incomingLib?incomingLib.defaultPrefix:raw.default_prefix===undefined?state.defaultPrefix:prefixData.code(raw.default_prefix);const next=[];try{for(const item of raw.pages){if(!item||!Array.isArray(item.boxes))throw new Error('Página inválida.');let p;if(item.imageData){if(typeof item.imageData!=='string'||!/^data:image\/(png|jpe?g|webp|bmp);base64,/i.test(item.imageData))throw new Error('Formato de imagen no admitido.');const parts=item.imageData.split(',');const bytes=Uint8Array.from(atob(parts[1]),c=>c.charCodeAt(0));p=await loadBlob(new Blob([bytes],{type:parts[0].slice(5).split(';')[0]}),String(item.filename));}else p={id:uid(),filename:String(item.filename),blob:null,url:'',image:null,width:0,height:0};p.id=item.id||p.id;p.cleanEdits=await cleanUI.readEdits(item.cleanEdits,p);p.boxes=readBoxes(item.boxes);p.readingOrder=readingMode(item);p.boxes.forEach(b=>clampBox(b,p));next.push(p);}}catch(e){next.forEach(p=>p.url&&URL.revokeObjectURL(p.url));throw e;}cleanUI?.resetDraft();for(const p of state.pages)if(p.url)URL.revokeObjectURL(p.url);if(incomingLib){state.prefixFolders=incomingLib.folders;state.activePrefixFolderId=incomingLib.activeFolderId;}state.prefixes=prefixCatalog;state.defaultPrefix=prefixCatalog.some(p=>p.code===requestedDefault)?requestedDefault:'';prefixUI?.persist();state.pages=next;sessionStarted=true;state.name=String(raw.name||'Mi capítulo');state.settings=validateSettings(raw.settings);state.pageId=next[0]?.id||null;state.selected.clear();undoStack=[];redoStack=[];syncSettings();render();fitWidth();changed();tell('Proyecto abierto.');}
function validateSettings(input){const s={...defaults};for(const k of Object.keys(defaults))if(input&&typeof input[k]===typeof defaults[k])s[k]=input[k];if(!['tesseract','paddle'].includes(s.ocrEngine))s.ocrEngine='tesseract';if(s.language==='kor_only')s.language='kor';if(!ocrLanguages.includes(s.language))s.language=defaults.language;s.minConfidence=Math.max(0,Math.min(95,finite(s.minConfidence,30)));return s;}
function syncSettings(){$('projectName').value=state.name;for(const [id,value]of Object.entries(state.settings)){const input=$(id);if(!input)continue;if(input.type==='checkbox')input.checked=value;else if(id==='model'){input.replaceChildren(new Option(value||'Primero conecta Ollama',value));}else input.value=value;}}
function getDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open('zumi-ocr-v02',1);req.onupgradeneeded=()=>req.result.createObjectStore('projects');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function saveSession(){saveTimer=null;if(!state.pages.length&&!sessionStarted){unsaved=false;$('autosave').textContent='Guardado local al editar';return;}try{const db=await getDB();await new Promise((resolve,reject)=>{const tx=db.transaction('projects','readwrite');tx.objectStore('projects').put({name:state.name,settings:state.settings,prefix_folders:state.prefixFolders,active_prefix_folder_id:state.activePrefixFolderId,prefixes:state.prefixes,default_prefix:state.defaultPrefix,pages:state.pages.map(p=>({id:p.id,filename:p.filename,reading_order:p.readingOrder||'position',boxes:structuredClone(p.boxes),cleanEdits:p.cleanEdits||[],blob:p.blob}))},'last');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});db.close();unsaved=false;$('autosave').textContent='Guardado en este navegador · '+new Date().toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit'});}catch(e){$('autosave').textContent='Usa Guardar proyecto para conservar tus cambios.';}}
async function recoverSession(){await runTask(async()=>{const db=await getDB();const stored=await new Promise((resolve,reject)=>{const req=db.transaction('projects').objectStore('projects').get('last');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});db.close();if(!stored?.pages?.length){tell('No hay una sesión anterior guardada aquí.');return;}if(state.pages.length&&!confirm('¿Reemplazar el proyecto actual por la sesión anterior? Guarda primero los cambios que quieras conservar.'))return;const pages=[];for(const p of stored.pages)pages.push({...p,imageData:p.blob?await blobDataURL(p.blob):null,blob:undefined});await openProject({...stored,format:'zumi-ocr-project',pages});tell('Sesión anterior recuperada.');});}
function decodeModel(data){return Uint8Array.from(atob(data),c=>c.charCodeAt(0));}
async function createOCRWorker(langs,options){
 let rejectFailure,timer;
 const failed=new Promise((resolve,reject)=>{rejectFailure=reject;timer=setTimeout(()=>reject(new Error('El motor OCR tardó demasiado en iniciar. Prueba cerrar otras pestañas y escanear una sola página.')),60000);});
 const pending=Tesseract.createWorker(langs,1,{...options,errorHandler:e=>{console.error('OCR',e);rejectFailure(new Error('No se pudo preparar el OCR: '+String(e)));}});
 try{return await Promise.race([pending,failed]);}catch(e){pending.then(w=>w.terminate()).catch(()=>{});throw e;}finally{clearTimeout(timer);}
}
async function getWorker(){window.ZumiLama.cancel();const lang=state.settings.language,epoch=taskEpoch,codes=[lang],engine=state.settings.ocrEngine,key=engine+':'+lang;if(worker&&workerLanguage===key)return worker;if(worker){await worker.terminate();worker=null;}if(engine==='paddle'){const created=await window.ZumiPaddle.create(lang,{onStatus:tell});if(cancelled||epoch!==taskEpoch){await created.terminate();throw new Error('Operación detenida.');}worker=created;workerLanguage=key;return worker;}if(!window.Tesseract||!window.ZUMI_WORKER_SOURCE||codes.some(code=>!window.ZUMI_MODELS?.[code]))throw new Error('Faltan archivos del motor. Extrae TODO el ZIP y conserva vendor y modelos junto al HTML.');if(workerURL)URL.revokeObjectURL(workerURL);workerURL=URL.createObjectURL(new Blob([window.ZUMI_WORKER_SOURCE],{type:'application/javascript'}));tell('Preparando OCR local…');const langs=codes.map(code=>({code,data:decodeModel(window.ZUMI_MODELS[code])}));const created=await createOCRWorker(langs,{workerPath:workerURL,workerBlobURL:false,cacheMethod:'none',logger:m=>{if(epoch===taskEpoch&&m.status==='recognizing text')$('progress').value=Math.round(m.progress*100);}});if(cancelled||epoch!==taskEpoch){await created.terminate();throw new Error('Operación detenida.');}worker=created;workerLanguage=key;return worker;}
function extractLines(blocks,scale,offsetX,offsetY,p){const result=[];for(const block of blocks||[])for(const para of block.paragraphs||[])for(const line of para.lines||[]){const text=String(line.text||'').trim();if(!text||finite(line.confidence)<state.settings.minConfidence)continue;if(state.settings.language==='kor'&&state.settings.onlyHangul&&!/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/.test(text))continue;const bb=line.bbox;if(!bb)continue;const b=normalBox({x:bb.x0/scale+offsetX-3,y:bb.y0/scale+offsetY-3,w:(bb.x1-bb.x0)/scale+6,h:(bb.y1-bb.y0)/scale+6,ocr:text,confidence:finite(line.confidence)/100});clampBox(b,p);result.push(b);}return result;}
function overlapRatio(a,b){const x=Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)),y=Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));return x*y/Math.min(a.w*a.h,b.w*b.h);}
function deduplicate(boxes){const out=[];for(const b of sortBoxes(boxes)){const old=out.find(a=>overlapRatio(a,b)>.6);if(old){if(b.confidence>old.confidence)Object.assign(old,b);}else out.push(b);}return out;}
function groupLines(boxes){const groups=[];for(const b of sortBoxes(boxes)){let best=null,bestGap=Infinity;for(const g of groups){const gap=b.y-(g.y+g.h),height=Math.min(g.lineHeight,b.h),overlap=Math.max(0,Math.min(g.x+g.w,b.x+b.w)-Math.max(g.x,b.x))/Math.min(g.w,b.w),center=Math.abs(g.x+g.w/2-b.x-b.w/2);if(gap>=-height*.35&&gap<=height*.8&&overlap>.4&&center<Math.max(g.w,b.w)*.45&&gap<bestGap){best=g;bestGap=gap;}}if(!best){groups.push({...b,lineHeight:b.h,count:1});continue;}const x=Math.min(best.x,b.x),y=Math.min(best.y,b.y),right=Math.max(best.x+best.w,b.x+b.w),bottom=Math.max(best.y+best.h,b.y+b.h);best.x=x;best.y=y;best.w=right-x;best.h=bottom-y;best.ocr+=' '+b.ocr;best.confidence=(best.confidence*best.count+b.confidence)/(best.count+1);best.count++;best.lineHeight=Math.min(best.lineHeight,b.h);}return groups.map(({lineHeight,count,...b})=>b);}
async function scanRegion(p,region,sparse=true){
 const w=await cancellable(getWorker());if(cancelled)return [];
 const width=region.w,height=region.h,scale=Math.min(2,1600/width),pad=sparse?0:20,c=document.createElement('canvas');
 const scaledW=Math.max(1,Math.round(width*scale)),scaledH=Math.max(1,Math.round(height*scale));c.width=scaledW+pad*2;c.height=scaledH+pad*2;
 const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(p.image,region.x,region.y,width,height,pad,pad,scaledW,scaledH);
 await cancellable(w.setParameters({tessedit_pageseg_mode:sparse?'11':'6',preserve_interword_spaces:'1'}));
 const r=await cancellable(w.recognize(c,{}, {text:true,blocks:true}));return extractLines(r.data.blocks,scale,region.x-pad/scale,region.y-pad/scale,p);
}
async function scanPage(p){const regions=[],tile=1800,overlap=140;for(let y=0;y<p.height;y+=tile-overlap)regions.push({x:0,y,w:p.width,h:Math.min(tile,p.height-y)});let boxes=[];for(let i=0;i<regions.length;i++){if(cancelled)break;tell(`OCR: ${p.filename} · tramo ${i+1}/${regions.length}`);boxes.push(...await scanRegion(p,regions[i]));}boxes=deduplicate(boxes);if(state.settings.groupLines)boxes=groupLines(boxes);return boxes;}
async function doOCR(all=false,regionOnly=false){const targets=all?state.pages.filter(p=>p.blob):(page()?.blob?[page()]:[]);if(!targets.length)return tell('Carga las imágenes primero.');if(regionOnly&&!selectedBoxes().length)return tell('Selecciona una caja para escanear esa zona.');if(!regionOnly&&targets.some(p=>p.boxes.length)&&!confirm('El nuevo OCR reemplazará las cajas y textos de las páginas elegidas. Guarda el proyecto si quieres conservarlos. ¿Continuar?'))return;
 const regions=regionOnly?[...selectedBoxes()]:[];checkpoint();await runTask(async()=>{let unread=0;for(const p of targets){if(cancelled)break;if(regionOnly){for(const b of regions){if(cancelled)break;const result=await scanRegion(p,{x:b.x,y:b.y,w:b.w,h:b.h},false);if(!cancelled){if(result.length){b.ocr=result.map(r=>r.ocr).join(' ');b.confidence=result.reduce((a,r)=>a+r.confidence,0)/result.length;}else unread++;}}}else{const boxes=await scanPage(p);if(!cancelled){p.boxes=boxes.map(applyDefaultPrefix);p.readingOrder='position';}else break;}render();changed();}tell(cancelled?'OCR detenido. Se conservaron las páginas terminadas.':unread?'No pude leer '+unread+' zonas. Ajusta el rectángulo o baja la confianza mínima. Los textos existentes se conservan.':'OCR terminado. Revisa la lectura y la agrupación antes de exportar.');});}
function merge(){const boxes=selectedBoxes();if(boxes.length<2)return tell('Selecciona al menos dos cajas con Ctrl+clic.');checkpoint();const order=[...boxes],anchor=page().boxes.findIndex(b=>state.selected.has(b.id)),x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y)),r=Math.max(...boxes.map(b=>b.x+b.w)),bottom=Math.max(...boxes.map(b=>b.y+b.h));const b=normalBox({x,y,w:r-x,h:bottom-y,ocr:order.map(b=>b.ocr).filter(Boolean).join(' '),trad:order.map(b=>b.trad).filter(Boolean).join(' '),prefix:order[0].prefix,prefixName:order[0].prefixName,confidence:boxes.reduce((n,b)=>n+b.confidence,0)/boxes.length});page().boxes=page().boxes.filter(b=>!state.selected.has(b.id));page().boxes.splice(anchor,0,b);if(page().readingOrder!=='manual')sortBoxes(page().boxes);state.selected=new Set([b.id]);render();changed();}
function removeBoxes(){if(!selectedBoxes().length)return;checkpoint();page().boxes=page().boxes.filter(b=>!state.selected.has(b.id));state.selected.clear();render();changed();}
function localURL(value=state.settings.ollamaURL){let u;try{u=new URL(value);}catch(e){throw new Error('La dirección del traductor no es válida.');}if(u.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||u.username||u.password)throw new Error('Usa una dirección local, por ejemplo http://127.0.0.1:11434');return u.origin;}
function connectionInfo(message,attempts=[]){const panel=$('connectionInfo');panel.replaceChildren(node('p','',message));for(const attempt of attempts){const line=node('p',''),link=node('a','',attempt.origin+' · comprobar servidor');link.href=attempt.origin+'/api/tags';link.target='_blank';link.rel='noreferrer';line.append(link,node('br'),document.createTextNode(attempt.message));panel.append(line);}}
async function fetchLocal(route,options={},timeout=15000,origin=localURL()){
 const controller=new AbortController();aborter=controller;const timer=setTimeout(()=>controller.abort(),timeout);
 try{const r=await fetch(origin+route,{...options,signal:controller.signal});if(!r.ok){let detail;try{const body=await r.json();detail=body.error;}catch{}const e=new Error('Ollama respondió '+r.status+(detail?': '+String(detail).slice(0,160):''));e.code='HTTP_'+r.status;throw e;}try{return await r.json();}catch{const e=new Error('La dirección respondió, pero no devolvió datos JSON de Ollama.');e.code='INVALID_RESPONSE';throw e;}}
 catch(e){if(cancelled)throw new Error('Operación detenida.');if(e.name==='AbortError'){const error=new Error(route==='/api/tags'?'El servidor no respondió a tiempo.':'El modelo tardó demasiado en traducir.');error.code='TIMEOUT';throw error;}if(e instanceof TypeError){const error=new Error('Sin respuesta del navegador: servidor inaccesible, permiso de red local o bloqueo CORS.');error.code='NETWORK';throw error;}throw e;}
 finally{clearTimeout(timer);if(aborter===controller)aborter=null;}
}
async function connect(){await runTask(async()=>{
 const preferred=state.settings.model,current=localURL($('ollamaURL').value.trim());
 const candidates=[...new Set([current,'http://127.0.0.1:11435','http://127.0.0.1:11434'])],attempts=[];let emptyOrigin=null;
 connectionInfo('Comprobando el servidor y sus modelos…');$('model').replaceChildren(new Option('Buscando modelos…',''));
 for(const origin of candidates){if(cancelled)throw new Error('Operación detenida.');tell('Buscando modelos en '+origin+'…');
  try{const data=await fetchLocal('/api/tags',{},3500,origin);if(!Array.isArray(data.models))throw new Error('Esta dirección no devuelve la lista de modelos de Ollama.');const models=data.models.filter(m=>typeof m.name==='string'&&!m.name.toLowerCase().includes('cloud')&&!m.remote_host);
   if(!models.length){emptyOrigin=emptyOrigin||origin;attempts.push({origin,message:'Ollama responde, pero no muestra modelos locales.'});continue;}
   state.settings.ollamaURL=origin;$('ollamaURL').value=origin;$('model').replaceChildren(...models.map(m=>new Option(m.name,m.name)));
   state.settings.model=models.find(m=>m.name===preferred)?.name||models.find(m=>m.name==='qwen3:1.7b')?.name||models[0].name;$('model').value=state.settings.model;
   connectionInfo('Conectado a '+origin+'. '+models.length+' modelos locales disponibles.');tell('Traductor conectado. Modelo: '+state.settings.model);return;
  }catch(e){if(cancelled){state.settings.model='';$('model').replaceChildren(new Option('Búsqueda detenida; vuelve a conectar',''));connectionInfo('Búsqueda detenida.');throw e;}attempts.push({origin,message:e.message});}
 }
 state.settings.model='';$('model').replaceChildren(new Option(emptyOrigin?'Servidor conectado, sin modelos locales':'Sin conexión: revisa las comprobaciones',''));
 if(emptyOrigin){state.settings.ollamaURL=emptyOrigin;$('ollamaURL').value=emptyOrigin;connectionInfo('Hay conexión con Ollama, pero no aparecen modelos locales. Si ollama list sí muestra qwen3, comprueba que la terminal y Zumi usan la misma dirección.',attempts);tell('Ollama responde, pero la lista de modelos locales está vacía.');return;}
 connectionInfo('No pude leer la lista. Abre los enlaces de comprobación. Si muestran qwen3, el servidor funciona: revisa el permiso de red local de Chrome/Edge. Si no abren, ejecuta CONECTAR_TRADUCTOR.bat y consulta lo que indica su ventana.',attempts);
 throw new Error('No pude conectar con Ollama. En Traductor aparecen las comprobaciones de cada dirección.');
 });}
async function translate(scope){return translator.translate(scope);}
async function stop(){cancelled=true;taskEpoch++;window.ZumiLama.cancel();window.ZumiPaddle.cancel();resolveCancel?.();if(aborter)aborter.abort();if(worker){const old=worker;worker=null;workerLanguage='';await old.terminate();}tell('Operación detenida. Se conservan los resultados terminados.');}
for(const id of ['loadImages','loadStart'])$(id).onclick=()=>$('imagesInput').click();$('loadFolder').onclick=()=>$('folderInput').click();$('imagesInput').onchange=e=>{loadImages(e.target.files);e.target.value='';};$('folderInput').onchange=e=>{loadImages(e.target.files);e.target.value='';};$('openProject').onclick=()=>$('projectInput').click();$('importJSON').onclick=()=>$('jsonInput').click();
for(const [id,isProject]of [['projectInput',true],['jsonInput',false]])$(id).onchange=async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;if(isProject&&state.pages.length&&!confirm('¿Abrir este archivo y reemplazar el proyecto actual? Guarda primero tus cambios.'))return;await runTask(async()=>{const raw=JSON.parse((await f.text()).replace(/^\ufeff/,''));if(isProject)await openProject(raw);else importCoordinates(raw);});};
$('saveProject').onclick=saveProject;$('exportJSON').onclick=()=>{if(!state.pages.length)return tell('Carga imágenes o coordenadas primero.');jsonDownload(exportCoordinates(),safeName(state.name)+'_Coordenadas.json');const pending=state.pages.reduce((n,p)=>n+p.boxes.filter(b=>!b.trad.trim()).length,0);tell('JSON de textos y coordenadas exportado.'+(pending?' '+pending+' cajas sin traducción usan el texto original en t_text.':''));};
$('removePage').onclick=()=>removePage();$('removeAllPages').onclick=requestRemoveAllPages;$('confirmRemoveAll').onclick=removeAllPages;$('cancelRemoveAll').onclick=()=>$('removeAllDialog').close();$('readMode').onclick=()=>setMode('read');$('projectName').oninput=e=>{state.name=e.target.value;changed();};$('recover').onclick=recoverSession;$('ocrPage').onclick=()=>doOCR();$('ocrAll').onclick=()=>doOCR(true);$('ocrRegion').onclick=()=>doOCR(false,true);$('selectMode').onclick=()=>setMode('select');$('addMode').onclick=()=>setMode('add');$('zoomIn').onclick=()=>zoom(1.2);$('zoomOut').onclick=()=>zoom(1/1.2);$('fitWidth').onclick=fitWidth;$('showBoxes').onchange=renderOverlay;$('undo').onclick=undo;$('redo').onclick=redo;$('mergeBoxes').onclick=merge;$('deleteBoxes').onclick=removeBoxes;$('search').oninput=renderCards;$('resetReadingOrder').onclick=resetReadingOrder;
if($('selectAllBoxes'))$('selectAllBoxes').onclick=()=>{const p=page();if(!p?.boxes?.length)return;select(p.boxes.map(b=>b.id));tell(p.boxes.length+' cajas seleccionadas.');};
if($('selectSamePrefix'))$('selectSamePrefix').onclick=()=>{const p=page(),sel=selectedBoxes();if(!p?.boxes?.length||!sel.length)return;const targetPref=sel[0].prefix||'';const matches=p.boxes.filter(b=>(b.prefix||'')===targetPref).map(b=>b.id);select(matches);tell(matches.length+' cajas con el mismo tipo seleccionadas.');};
if($('clearBoxSelection'))$('clearBoxSelection').onclick=()=>select([]);
if($('jumpMissingPrefix'))$('jumpMissingPrefix').onclick=jumpToNextMissingPrefix;
for(const [id,key]of [['coordX','x'],['coordY','y'],['coordW','w'],['coordH','h']]){$(id).onfocus=checkpoint;$(id).oninput=()=>{const b=selectedBoxes()[0];if(!b)return;b[key]=finite($(id).value,b[key]);clampBox(b,page());renderOverlay();changed();};$(id).onchange=renderInspector;}
for(const id of Object.keys(defaults)){const el=$(id);if(!el)continue;el.addEventListener('change',()=>{state.settings[id]=el.type==='checkbox'?el.checked:el.type==='number'?finite(el.value,defaults[id]):el.value;state.settings=validateSettings(state.settings);renderOverlay();updateOCRControls();changed();});}
$('connectOllama').onclick=connect;$('translateSelected').onclick=()=>translate('selected');$('translatePage').onclick=()=>translate('page');$('translateAll').onclick=()=>translate('all');$('cancel').onclick=stop;$('help').onclick=()=>$('helpDialog').showModal();
document.addEventListener('keydown',e=>{
 if(busy||drag||orderDrag||document.querySelector('dialog[open]')||e.target.closest('input,textarea,select'))return;
 const k=e.key.toLowerCase();
 if((e.ctrlKey||e.metaKey)&&k==='z'){e.preventDefault();e.shiftKey?redo():undo();return;}
 if((e.ctrlKey||e.metaKey)&&k==='y'){e.preventDefault();redo();return;}
 if(e.ctrlKey||e.metaKey||e.altKey)return;
 if(e.key==='Delete'){e.preventDefault();if(state.mode==='clean'){$('clearCleanMask').click();}else removeBoxes();return;}
 if(k==='v'){e.preventDefault();setMode('select');tell('Herramienta: Seleccionar (V)');return;}
 if(k==='r'||k==='m'){e.preventDefault();setMode('add');tell('Herramienta: + Caja (R)');return;}
 if(k==='w'||k==='l'){e.preventDefault();setMode('read');return;}
 if(k==='b'){
  e.preventDefault();
  const cleanTab=document.querySelector('.tabs [data-tab="clean"]');
  if(cleanTab&&!cleanTab.classList.contains('active'))cleanTab.click();
  if($('bubbleCleanMode'))$('bubbleCleanMode').click();
  return;
 }
 if(k==='0'){e.preventDefault();fitWidth();return;}
 if(e.key==='+'||e.key==='='){e.preventDefault();zoom(1.2);return;}
 if(e.key==='-'){e.preventDefault();zoom(1/1.2);return;}
});
const viewport=$('viewport');viewport.addEventListener('dragover',e=>{e.preventDefault();viewport.classList.add('drop-active');});viewport.addEventListener('dragleave',()=>viewport.classList.remove('drop-active'));viewport.addEventListener('drop',e=>{e.preventDefault();viewport.classList.remove('drop-active');loadImages(e.dataTransfer.files);});viewport.addEventListener('wheel',e=>{if(e.ctrlKey||e.metaKey){e.preventDefault();zoom(e.deltaY<0?1.1:1/1.1);}},{passive:false});
window.addEventListener('beforeunload',e=>{if(state.pages.length&&unsaved){e.preventDefault();e.returnValue='';}});window.addEventListener('resize',()=>{if(!drag)renderStage();});
const translator=window.ZumiTranslation({state,$,page,checkpoint,runTask,tell,render,changed,fetchLocal,download,safeName,isCancelled:()=>cancelled,setAborter:v=>aborter=v});
prefixUI=window.ZumiPrefixes({state,$,checkpoint,render,changed,tell,isBusy:()=>busy||Boolean(drag)||Boolean(orderDrag),select,selectedBoxes,download,safeName,onConfigChanged:()=>{if($('textExportDialog').open)exports.refresh();}});
visionUI=window.ZumiVision({$,page,selectedBoxes,checkpoint,render,changed,tell,download,safeName,isBusy:()=>busy,bridge:translator.bridge});
const exports=window.ZumiExports({state,$,page,tell,download,safeName});
cleanUI=window.ZumiClean({state,$,page,checkpoint,render,renderOverlay,changed,tell,runTask,isBusy:()=>busy,isCancelled:()=>cancelled,setMode,selectedBoxes,releaseOCR:async()=>{if(worker){const old=worker;worker=null;workerLanguage='';await old.terminate();}}});
workspaceUI=window.ZumiWorkspace({state,$,isBusy:()=>busy||Boolean(drag)||Boolean(orderDrag),choosePage,renderStage,onTabChange:key=>cleanUI.onTab(key)});
const typerLink=window.ZumiTyperLink({$,tell,getData:()=>({name:state.name,pages:exportCoordinates()}),applyPrefixes:(raw,folderName='')=>{if(busy||drag||orderDrag||$('prefixDialog').open)throw new Error('Termina la operación o cierra Configurar prefijos antes de sincronizar.');checkpoint();prefixUI.syncFromExternal(raw,folderName);render();changed();if($('textExportDialog').open)exports.refresh();tell(folderName?'Carpeta «'+folderName+'» sincronizada en Zumi OCR.':'Prefijos actualizados en este proyecto. Guarda el proyecto para conservarlos.');}});
const imageExports=window.ZumiImages({state,$,page,clean:cleanUI,link:typerLink,runTask,tell,download,safeName,exportCoordinates,isBusy:()=>busy,isCancelled:()=>cancelled});
window.ZumiOCR={clean:cleanUI,imageExports,exports,prepareTranslation:translator.prepare,parseTranslations:translator.parse,getState:()=>state,vision:visionUI,importCoordinates,exportCoordinates,groupLines,loadImages,openProject,removePage,stop};
syncSettings();render();
})();
