'use strict';
window.ZumiWorkspace = function({state,$,isBusy,choosePage,renderStage,onTabChange=()=>{}}){
 const storageKey='zumi-ocr-window-v1';
 const defaults={pages:true,ocr:true,text:true,translate:true,clean:true,inspector:true,tools:true,zoom:true};
 let panels={...defaults},pageSignature='',activeTab='text',lastTab=null,panelLayout=null;
 const dialog=$('windowDialog'),main=document.querySelector('main');
 try{
  const saved=JSON.parse(localStorage.getItem(storageKey)||'null');
  if(typeof saved?.editor==='boolean')panels.text=panels.translate=saved.editor;
  for(const key of Object.keys(defaults))if(typeof saved?.[key]==='boolean')panels[key]=saved[key];
  if(['text','translate','clean'].includes(saved?.activeTab))activeTab=saved.activeTab;
 }catch{}
 function save(){
  try{localStorage.setItem(storageKey,JSON.stringify({...panels,activeTab}));$('windowSaveStatus').textContent='Preferencias guardadas en este navegador.';}
  catch{$('windowSaveStatus').textContent='Vista aplicada. No se pudo guardar la preferencia; puedes volver a elegirla desde Ventana.';}
 }
 function tabs(){
  if(!panels[activeTab])activeTab=panels.text?'text':panels.translate?'translate':panels.clean?'clean':activeTab;
  for(const key of ['text','translate','clean']){
   const button=document.querySelector('[data-tab="'+key+'"]');
   button.hidden=!panels[key];button.classList.toggle('active',panels[key]&&key===activeTab);
   $('tab-'+key).hidden=!panels[key]||key!==activeTab;
  }
  const current=panels[activeTab]?activeTab:'';if(current!==lastTab){lastTab=current;onTabChange(current);}
 }
 function apply(){
  main.dataset.pagesVisible=String(panels.pages);main.dataset.editorVisible=String(panels.text||panels.translate||panels.clean);
  document.querySelectorAll('[data-window-panel]').forEach(el=>el.dataset.uiHidden=String(!panels[el.dataset.windowPanel]));
  document.querySelectorAll('[data-window-option]').forEach(el=>{
   const key=el.dataset.windowOption;el.checked=panels[key];
   el.disabled=key==='ocr'&&!panels.pages||key==='inspector'&&!panels.text;
  });
  tabs();
  panelLayout?.refresh();renderStage();
 }
 function refresh(){
  panelLayout?.refresh();
  const index=state.pages.findIndex(p=>p.id===state.pageId),count=state.pages.length,locked=isBusy();
  const signature=JSON.stringify(state.pages.map(p=>[p.id,p.filename]));
  if(signature!==pageSignature){
   pageSignature=signature;
   $('pageSelect').replaceChildren(...(count?state.pages.map((p,i)=>new Option((i+1)+'. '+p.filename,p.id)):[new Option('Sin imágenes','')]));
  }
  $('pageSelect').value=index>=0?state.pageId:'';
  $('pageSelect').disabled=locked||count<2;
  $('previousPage').disabled=locked||index<=0;
  $('nextPage').disabled=locked||index<0||index>=count-1;
  const current=index>=0?state.pages[index]:null;
  $('pageIndicator').textContent=(index+1)+' / '+count;
  $('pageIndicator').setAttribute('aria-label',current?'Imagen '+(index+1)+' de '+count+': '+current.filename:'Sin imágenes');
  $('pageSelect').title=current?.filename||'Carga imágenes para recorrer el capítulo';
  // setBusy also updates inputs; restore the parent-dependent view controls.
  dialog.querySelector('[data-window-option="ocr"]').disabled=!panels.pages;
  dialog.querySelector('[data-window-option="inspector"]').disabled=!panels.text;
 }
 function move(step){
  if(isBusy())return;
  const index=state.pages.findIndex(p=>p.id===state.pageId),target=state.pages[index+step];
  if(index<0||!target)return;
  choosePage(target.id);$('viewport').focus({preventScroll:true});
 }
 $('previousPage').onclick=()=>move(-1);$('nextPage').onclick=()=>move(1);
 $('pageSelect').onchange=e=>{if(!isBusy())choosePage(e.target.value);refresh();};
 $('windowMenu').onclick=()=>{if(!dialog.open)dialog.showModal();};
 document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>{activeTab=button.dataset.tab;tabs();save();});
 dialog.querySelectorAll('[data-window-option]').forEach(input=>input.onchange=()=>{panels[input.dataset.windowOption]=input.checked;apply();save();});
 for(const [id,preset]of [
  ['showAllPanels',defaults],
  ['reviewWorkspace',{...defaults,pages:false,ocr:false,inspector:false,tools:false}],
  ['imageWorkspace',{...defaults,pages:false,text:false,translate:false,clean:false,tools:false}]
 ])$(id).onclick=()=>{panels={...preset};activeTab='text';apply();save();};
 document.addEventListener('keydown',e=>{
  if(e.defaultPrevented||e.ctrlKey||e.metaKey||e.altKey||e.shiftKey||isBusy()||document.querySelector('dialog[open]'))return;
  if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;
  if(e.target!==document.body&&!$('viewport').contains(e.target))return;
  if(e.target.closest('input,textarea,select,button,[contenteditable="true"]'))return;
  e.preventDefault();move(e.key==='ArrowLeft'?-1:1);
 });
 panelLayout=window.ZumiPanels({$,main,panels:()=>panels,renderStage,isBusy});
 apply();refresh();
 return {refresh};
};
