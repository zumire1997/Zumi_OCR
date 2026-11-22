'use strict';
window.ZumiClean=function({state,$,page,checkpoint,render,renderOverlay,changed,tell,runTask,isBusy,isCancelled,setMode,selectedBoxes,releaseOCR}){
 const NS='http://www.w3.org/2000/svg';let draft=null,draftPage='',drawing=null,preview=null;const decoded=new Map();
 const uid=()=>globalThis.crypto?.randomUUID?.()||'clean'+Date.now()+Math.random();
 function svg(tag,attrs){const e=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);return e;}
 function shapePath(ctx,e){ctx.beginPath();if(e.shape==='ellipse')ctx.ellipse(e.x+e.w/2,e.y+e.h/2,e.w/2,e.h/2,0,0,Math.PI*2);else if(e.shape==='brush'){ctx.lineWidth=e.size;ctx.lineCap=ctx.lineJoin='round';const pts=e.points;ctx.moveTo(...pts[0]);for(const p of pts.slice(1))ctx.lineTo(...p);if(pts.length===1)ctx.lineTo(pts[0][0]+.01,pts[0][1]);}else ctx.rect(e.x,e.y,e.w,e.h);}
 function drawShape(ctx,e,color){ctx.fillStyle=ctx.strokeStyle=color;shapePath(ctx,e);e.shape==='brush'?ctx.stroke():ctx.fill();}
 function shapeSVG(e,color,extra={}){
  const attrs={fill:color,'pointer-events':'none',...extra};
  if(e.shape==='ellipse')return svg('ellipse',{cx:e.x+e.w/2,cy:e.y+e.h/2,rx:e.w/2,ry:e.h/2,...attrs});
  if(e.shape==='brush')return svg('path',{d:e.points.map((p,i)=>(i?'L':'M')+p.join(' ')).join(' ')+' l .01 0',...attrs,fill:'none',stroke:color,'stroke-width':e.size,'stroke-linecap':'round','stroke-linejoin':'round'});
  return svg('rect',{x:e.x,y:e.y,width:e.w,height:e.h,...attrs});
 }
 function resetDraft(){draft=null;drawing=null;draftPage=page()?.id||'';}
 function refresh(){if(draftPage!==page()?.id)resetDraft();const p=page();$('cleanSummary').textContent=p?.blob?(p.cleanEdits?.length||0)+' cambios · '+p.filename:'Carga una imagen para limpiar.';const locked=isBusy()||!p?.blob;$('fillClean').disabled=$('aiClean').disabled=locked||!draft;$('clearCleanMask').disabled=locked||!draft;$('resetCleanPage').disabled=locked||!p?.cleanEdits?.length;$('cleanFromBox').disabled=locked||selectedBoxes().length!==1;$('stage').classList.toggle('cleaning',state.mode==='clean');}
 function overlay(s,p){if(draftPage!==p.id)resetDraft();for(const e of p.cleanEdits||[]){s.append(e.kind==='ai'?svg('image',{x:e.x,y:e.y,width:e.w,height:e.h,href:e.dataURL,'pointer-events':'none'}):shapeSVG(e,e.color));}
  if(draft&&state.mode==='clean')s.append(shapeSVG(draft,'#ff45996b',{stroke:'#ff5caa','stroke-width':1/state.zoom,'stroke-dasharray':String(5/state.zoom)}));
 }
 function point(e){const r=$('overlay').getBoundingClientRect(),p=page();return [Math.max(0,Math.min(p.width,(e.clientX-r.left)/state.zoom)),Math.max(0,Math.min(p.height,(e.clientY-r.top)/state.zoom))];}
 function bounds(points,size,p){const x=Math.max(0,Math.floor(Math.min(...points.map(a=>a[0]))-size/2)),y=Math.max(0,Math.floor(Math.min(...points.map(a=>a[1]))-size/2));return{x,y,w:Math.min(p.width-x,Math.ceil(Math.max(...points.map(a=>a[0]))+size/2-x)),h:Math.min(p.height-y,Math.ceil(Math.max(...points.map(a=>a[1]))+size/2-y))};}
 const el=$('overlay');
 el.addEventListener('pointerdown',e=>{if(state.mode!=='clean')return;e.stopImmediatePropagation();if(isBusy()||!page()?.blob||e.button!==0)return;e.preventDefault();resetDraft();const start=point(e),shape=$('cleanShape').value;drawing={id:e.pointerId,start};draft={kind:'fill',shape,x:start[0],y:start[1],w:0,h:0};if(shape==='brush')Object.assign(draft,{points:[start],size:Math.max(2,Math.min(200,Number($('cleanBrushSize').value)||24)),...bounds([start],Number($('cleanBrushSize').value)||24,page())});el.setPointerCapture(e.pointerId);renderOverlay();refresh();},true);
 el.addEventListener('pointermove',e=>{if(state.mode!=='clean')return;e.stopImmediatePropagation();if(!drawing||drawing.id!==e.pointerId)return;e.preventDefault();const pos=point(e),start=drawing.start;if(draft.shape==='brush'){const last=draft.points.at(-1);if(Math.hypot(pos[0]-last[0],pos[1]-last[1])<1)return;if(draft.points.length<5000)draft.points.push(pos);Object.assign(draft,bounds(draft.points,draft.size,page()));}else Object.assign(draft,{x:Math.floor(Math.min(start[0],pos[0])),y:Math.floor(Math.min(start[1],pos[1])),w:Math.ceil(Math.abs(pos[0]-start[0])),h:Math.ceil(Math.abs(pos[1]-start[1]))});renderOverlay();},true);
 function finish(e){if(state.mode!=='clean')return;e.stopImmediatePropagation();if(!drawing||drawing.id!==e.pointerId)return;drawing=null;if(e.type==='pointercancel'||draft.w<2||draft.h<2)draft=null;renderOverlay();refresh();}
 el.addEventListener('pointerup',finish,true);el.addEventListener('pointercancel',finish,true);
 $('markClean').onclick=()=>{setMode('clean');tell('Marca en la imagen la zona que quieres rellenar o limpiar.');};
 $('cleanShape').onchange=()=>{$('brushSizeLabel').hidden=$('cleanShape').value!=='brush';resetDraft();setMode('clean');renderOverlay();refresh();};
 $('cleanFromBox').onclick=()=>{const b=selectedBoxes()[0];if(!b)return;draftPage=page().id;draft={kind:'fill',shape:$('cleanShape').value==='ellipse'?'ellipse':'rect',x:b.x,y:b.y,w:b.w,h:b.h};setMode('clean');renderOverlay();refresh();};
 $('clearCleanMask').onclick=()=>{resetDraft();renderOverlay();refresh();};
 function apply(edit){const p=page();if(!p?.blob||isBusy())return;checkpoint();p.cleanEdits=[...(p.cleanEdits||[]),{...edit,id:uid()}];resetDraft();render();changed();}
 $('fillClean').onclick=()=>{if(draft)apply({...draft,color:$('cleanColor').value});};
 $('resetCleanPage').onclick=()=>{if(isBusy()||!page()?.cleanEdits?.length)return;checkpoint();page().cleanEdits=[];resetDraft();render();changed();tell('Limpieza de esta página restaurada. Puedes deshacer este cambio.');};
 async function image(dataURL){let im=decoded.get(dataURL);if(!im){im=new Image();im.src=dataURL;await im.decode();decoded.set(dataURL,im);if(decoded.size>20)decoded.delete(decoded.keys().next().value);}return im;}
 async function compose(p,region={x:0,y:0,w:p.width,h:p.height}){
  if(!p?.blob||!p.image)throw Error('Falta la imagen original de '+p.filename+'.');
  const c=document.createElement('canvas');c.width=region.w;c.height=region.h;const ctx=c.getContext('2d',{willReadFrequently:true});
  try{if(!ctx)throw Error('La página supera el tamaño de imagen admitido por el navegador.');ctx.drawImage(p.image,region.x,region.y,region.w,region.h,0,0,region.w,region.h);ctx.save();ctx.translate(-region.x,-region.y);
   for(const e of p.cleanEdits||[]){if(e.x+e.w<region.x||e.y+e.h<region.y||e.x>region.x+region.w||e.y>region.y+region.h)continue;if(e.kind==='ai')ctx.drawImage(await image(e.dataURL),e.x,e.y,e.w,e.h);else drawShape(ctx,e,e.color);}ctx.restore();return c;
  }catch(e){c.width=c.height=0;throw e;}
 }
 function canvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
 async function ai(){if(!draft||isBusy())return;if(!await ZumiLama.stored()){await modelStatus();$('lamaDialog').showModal();return;}
  const p=page(),mask=structuredClone(draft);await runTask(async()=>{await releaseOCR();if(isCancelled())return;
   const pad=32,x=Math.max(0,mask.x-pad),y=Math.max(0,mask.y-pad),region={x,y,w:Math.min(p.width-x,mask.w+pad+(mask.x-x)),h:Math.min(p.height-y,mask.h+pad+(mask.y-y))};
   const scale=Math.min(1,512/Math.max(region.w,region.h)),sw=Math.max(1,Math.round(region.w*scale)),sh=Math.max(1,Math.round(region.h*scale)),w=Math.ceil(sw/64)*64,h=Math.ceil(sh/64)*64;
   let before,small,maskSmall,result,patch,previewAfter,maskFull;
   try{before=await compose(p,region);small=canvas(w,h);const g=small.getContext('2d',{willReadFrequently:true});g.fillStyle='white';g.fillRect(0,0,w,h);g.drawImage(before,0,0,sw,sh);
    maskSmall=canvas(w,h);const mg=maskSmall.getContext('2d',{willReadFrequently:true});mg.scale(sw/region.w,sh/region.h);mg.translate(-x,-y);drawShape(mg,mask,'white');
    const out=await ZumiLama.clean(g.getImageData(0,0,w,h),mg.getImageData(0,0,w,h),tell);if(isCancelled()||page()?.id!==p.id)return;
    result=canvas(w,h);result.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(out.pixels),w,h),0,0);
    patch=canvas(region.w,region.h);const pg=patch.getContext('2d');pg.drawImage(result,0,0,sw,sh,0,0,region.w,region.h);
    maskFull=canvas(region.w,region.h);const fg=maskFull.getContext('2d');fg.translate(-x,-y);drawShape(fg,mask,'white');pg.globalCompositeOperation='destination-in';pg.drawImage(maskFull,0,0);
    previewAfter=canvas(region.w,region.h);previewAfter.getContext('2d').drawImage(before,0,0);previewAfter.getContext('2d').drawImage(patch,0,0);
    preview={pageId:p.id,edit:{kind:'ai',...region,dataURL:patch.toDataURL('image/png')}};
    $('cleanBefore').src=before.toDataURL('image/png');$('cleanAfter').src=previewAfter.toDataURL('image/png');$('cleanPreviewDialog').showModal();tell('Vista previa lista. Aplica la limpieza si el resultado te sirve.');
   }finally{for(const c of [before,small,maskSmall,result,patch,previewAfter,maskFull])if(c)c.width=c.height=0;}
  });
 }
 $('aiClean').onclick=ai;
 $('applyCleanPreview').onclick=()=>{if(preview&&preview.pageId===page()?.id){const edit=preview.edit;$('cleanPreviewDialog').close();apply(edit);}else $('cleanPreviewDialog').close();};
 $('cleanPreviewDialog').addEventListener('close',()=>{preview=null;$('cleanBefore').removeAttribute('src');$('cleanAfter').removeAttribute('src');});
 async function modelStatus(){const has=Boolean(await ZumiLama.stored());$('lamaStatus').textContent=has?'Modelo disponible en este navegador.':'Modelo opcional: 206 MB. La limpieza se procesa en tu dispositivo.';$('forgetLama').disabled=!has;}
 $('setupLama').onclick=async()=>{await modelStatus();$('lamaDialog').showModal();};
 $('downloadLama').onclick=()=>{$('lamaDialog').close();runTask(async()=>{const saved=await ZumiLama.download(tell);tell(saved?'Manga LaMa listo. Marca una zona y pulsa Limpiar con IA.':'Modelo listo para esta sesión. No hubo espacio para recordarlo; puedes guardarlo como archivo .onnx.');});};
 $('openLama').onclick=()=>$('lamaInput').click();$('lamaInput').onchange=e=>{const file=e.target.files[0];e.target.value='';if(!file)return;$('lamaDialog').close();runTask(async()=>{const saved=await ZumiLama.install(file,tell);tell(saved?'Modelo guardado. Pulsa Limpiar con IA para usarlo.':'Modelo listo para esta sesión; no hubo espacio para guardarlo en el navegador.');});};
 $('forgetLama').onclick=async()=>{try{await ZumiLama.forget();await modelStatus();}catch(e){$('lamaStatus').textContent=e.message;}};
 document.querySelectorAll('[data-clean-close]').forEach(b=>b.onclick=()=>$(b.dataset.cleanClose).close());
 async function readEdits(raw,p){if(raw===undefined)return [];if(!Array.isArray(raw)||raw.length>2000)throw Error('Limpieza inválida.');const out=[];for(const value of raw){const e=structuredClone(value);if(!e||!['ai','fill'].includes(e.kind)||!['x','y','w','h'].every(k=>Number.isFinite(e[k]))||e.x<0||e.y<0||e.w<1||e.h<1||p.width&&(e.x+e.w>p.width||e.y+e.h>p.height))throw Error('Coordenadas de limpieza inválidas.');
   if(e.kind==='ai'){if(typeof e.dataURL!=='string'||!/^data:image\/png;base64,/.test(e.dataURL)||e.dataURL.length>40000000)throw Error('Recorte de limpieza inválido.');const im=await image(e.dataURL);if(im.naturalWidth!==e.w||im.naturalHeight!==e.h)throw Error('Tamaño de recorte de limpieza inválido.');}
   else{if(!['rect','ellipse','brush'].includes(e.shape)||!/^#[0-9a-f]{6}$/i.test(e.color))throw Error('Relleno inválido.');if(e.shape==='brush'&&(!Number.isFinite(e.size)||e.size<2||e.size>200||!Array.isArray(e.points)||!e.points.length||e.points.length>5000||e.points.some(pt=>!Array.isArray(pt)||pt.length!==2||!pt.every(Number.isFinite)||pt[0]<0||pt[1]<0||p.width&&(pt[0]>p.width||pt[1]>p.height))))throw Error('Trazo inválido.');}out.push(e);
  }return out;
 }
 return {refresh,overlay,compose,readEdits,resetDraft,onTab:key=>{if(key==='clean')setMode('clean');else if(state.mode==='clean')setMode(matchMedia('(pointer:coarse)').matches&&$('panMode')?'pan':'select');refresh();}};
};
