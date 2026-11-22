'use strict';
(() => {
 const storageKey='zumi-ocr-prefixes-v1';
 const initial=[
  ['D','Diálogo'],['P','Pensamiento'],['N','Narración'],['G','Grito'],['O','Onomatopeya']
 ];
 const builtinScans=[
  ['mi-scan','Mi Scan',initial,'']
 ];
 const defaults=()=>initial.map(([code,name])=>({id:'zumi-'+code,code,name}));
 const newId=()=>globalThis.crypto?.randomUUID?.()||'p'+Date.now().toString(36)+Math.random().toString(36).slice(2);
 const code=value=>typeof value==='string'&&/^[^\s\u0000-\u001f\u007f]{1,12}$/u.test(value.trim())?value.trim():'';
 const text=(value,max=80)=>typeof value==='string'?value.trim().slice(0,max):'';
 function catalog(items){
  if(!Array.isArray(items)||items.length>100)throw new Error('La lista de prefijos debe tener un máximo de 100 opciones.');
  const codes=new Set(),names=new Set(),ids=new Set();
  return items.map((item,i)=>{
   const name=typeof item?.name==='string'?item.name.trim():'',value=code(item?.code),id=typeof item?.id==='string'&&item.id.length<=120&&item.id?item.id:newId();
   if(!name||name.length>80)throw new Error('Prefijo '+(i+1)+': escribe un nombre de hasta 80 caracteres.');
   if(!value)throw new Error('Prefijo '+(i+1)+': usa un código de 1 a 12 caracteres, sin espacios.');
   if(codes.has(value))throw new Error('El código «'+value+'» está repetido.');
   if(names.has(name.toLocaleLowerCase()))throw new Error('El nombre «'+name+'» está repetido.');
   if(ids.has(id))throw new Error('Identificador de prefijo repetido.');
   codes.add(value);names.add(name.toLocaleLowerCase());ids.add(id);return {id,name,code:value};
  });
 }
 function defaultFolders(){
  return builtinScans.map(([id,name,rows,def])=>({
   id,
   name,
   items:rows.map(([c,n])=>({id:id+'-'+c,code:c,name:n})),
   defaultPrefix:def
  }));
 }
 function folder(raw={},fallbackName='Carpeta'){
  const name=text(raw.name,80)||fallbackName;
  if(!name)throw new Error('Escribe un nombre para la carpeta de prefijos.');
  const items=catalog(Array.isArray(raw.items)?raw.items:Array.isArray(raw.prefixes)?raw.prefixes:defaults());
  const id=typeof raw.id==='string'&&raw.id.trim().length&&raw.id.trim().length<=120?raw.id.trim():newId();
  const def=code(raw.defaultPrefix??raw.default_prefix);
  return {id,name,items,defaultPrefix:items.some(p=>p.code===def)?def:''};
 }
 function library(raw={}){
  if(Array.isArray(raw?.folders)&&raw.folders.length){
   if(raw.folders.length>100)throw new Error('Puedes guardar hasta 100 carpetas de prefijos.');
   const names=new Set(),ids=new Set();
   const folders=raw.folders.map((f,i)=>{
    const valid=folder(f,'Carpeta '+(i+1));
    const low=valid.name.toLocaleLowerCase();
    if(names.has(low))throw new Error('Ya existe una carpeta llamada «'+valid.name+'».');
    if(ids.has(valid.id))valid.id=newId();
    names.add(low);ids.add(valid.id);
    return valid;
   });
   const activeId=folders.some(f=>f.id===raw.activeFolderId)?raw.activeFolderId:folders[0].id;
   const active=folders.find(f=>f.id===activeId)||folders[0];
   return {format:'zumi-ocr-prefixes',version:2,folders,activeFolderId:active.id,items:structuredClone(active.items),defaultPrefix:active.defaultPrefix};
  }
  if(Array.isArray(raw?.items)){
   const items=catalog(raw.items),def=items.some(p=>p.code===raw.defaultPrefix)?raw.defaultPrefix:'';
   const customName=text(raw.name,80)||'Mi Scan';
   const extras=defaultFolders().filter(f=>f.name.toLocaleLowerCase()!==customName.toLocaleLowerCase());
   const first={id:'mi-scan',name:customName,items,defaultPrefix:def};
   return {format:'zumi-ocr-prefixes',version:2,folders:[first,...extras],activeFolderId:first.id,items:structuredClone(first.items),defaultPrefix:first.defaultPrefix};
  }
  const folders=defaultFolders(),active=folders[0];
  return {format:'zumi-ocr-prefixes',version:2,folders,activeFolderId:active.id,items:structuredClone(active.items),defaultPrefix:active.defaultPrefix};
 }
 function extractStyleItems(styles=[]){
  const items=[],seenCodes=new Set(),seenNames=new Set();
  for(const s of styles){
   if(!s||typeof s!=='object')continue;
   const baseName=text(s.name??s.n,70)||'Estilo';
   const rawPrefixes=Array.isArray(s.prefixes)?s.prefixes:s.sym!==undefined?[s.sym]:s.code!==undefined?[s.code]:[];
   for(const rawCode of rawPrefixes){
    const c=code(String(rawCode??''));
    if(!c||seenCodes.has(c))continue;
    let name=baseName;
    if(seenNames.has(name.toLocaleLowerCase()))name=(baseName+' · '+c).slice(0,80);
    let n=2;while(seenNames.has(name.toLocaleLowerCase()))name=(baseName+' · '+c+' '+n++).slice(0,80);
    seenCodes.add(c);seenNames.add(name.toLocaleLowerCase());
    items.push({id:newId(),name,code:c});
    if(items.length>=100)break;
   }
   if(items.length>=100)break;
  }
  return catalog(items);
 }
 function parseExternalFolders(raw,fallbackName='Scan importado'){
  if(raw?.format==='zumi-ocr-prefixes'||Array.isArray(raw?.folders)&&raw.folders.every(f=>Array.isArray(f?.items))){
   return library(raw).folders;
  }
  if(Array.isArray(raw?.items)){
   return [folder({name:text(raw.name,80)||fallbackName,items:raw.items,defaultPrefix:raw.defaultPrefix},fallbackName)];
  }
  if(Array.isArray(raw)&&raw.every(item=>item&&typeof item.code==='string'&&typeof item.name==='string')){
   return [folder({name:fallbackName,items:raw},fallbackName)];
  }
  if(raw?.format==='zumi-typer-styles'||Array.isArray(raw?.folders)&&raw.folders.some(f=>Array.isArray(f?.styles))){
   const out=raw.folders.map((f,i)=>{
    const items=extractStyleItems(f.styles);
    const defStyle=f.styles?.find(s=>s.id===f.defaultStyleId);
    const defCode=code(defStyle?.prefixes?.[0]||'');
    return folder({name:text(f.name,80)||('Carpeta '+(i+1)),items,defaultPrefix:defCode},'Carpeta '+(i+1));
   }).filter(f=>f.items.length);
   if(!out.length)throw new Error('Las carpetas del archivo no contienen estilos con prefijos asignados.');
   return out;
  }
  if(Array.isArray(raw?.exportedStyles)){
   const items=extractStyleItems(raw.exportedStyles);
   if(!items.length)throw new Error('El archivo TypeR no contiene estilos con prefijos.');
   return [folder({name:text(raw.name,80)||fallbackName,items},fallbackName)];
  }
  const rows=Array.isArray(raw)?raw:raw?.styles;
  if(Array.isArray(rows)&&rows.length){
   const defs=new Map((Array.isArray(raw?.folders)?raw.folders:[]).map(f=>[String(f.id),text(f.name,80)]));
   const groups=new Map();
   for(const item of rows){
    const key=text(defs.get(String(item?.folder))||item?.folder,80)||fallbackName;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(item);
   }
   const out=[];
   for(const [name,styles] of groups){
    const items=extractStyleItems(styles);
    if(items.length)out.push(folder({name,items},name));
   }
   if(!out.length)throw new Error('No se encontraron prefijos válidos en los estilos del archivo.');
   return out;
  }
  throw new Error('Usa un JSON de carpetas de prefijos Zumi, Zumi Typer, TypeR o Toonaris.');
 }
 function mergeFolders(currentFolders,incomingFolders,replace=false){
  if(replace)return library({folders:incomingFolders});
  const out=structuredClone(currentFolders);
  for(const src of incomingFolders){
   const f=structuredClone(src);f.id=newId();
   let name=f.name,n=2;
   while(out.some(old=>old.name.toLocaleLowerCase()===name.toLocaleLowerCase()))name=(src.name.slice(0,70)+' ('+n++ +')');
   f.name=name;
   f.items=f.items.map(item=>({...item,id:newId()}));
   out.push(f);
  }
  return library({folders:out,activeFolderId:out.at(-1)?.id});
 }
 function read(){
  try{
   const saved=JSON.parse(localStorage.getItem(storageKey)||'null');
   if(saved)return library(saved);
  }catch{}
  return library();
 }
 // Only explicit old classifications migrate; the former default 1 remains unassigned.
 function importCode(box){if(Object.prototype.hasOwnProperty.call(box,'prefix'))return code(box.prefix);return code(box.profile)||({'2':'P','3':'N','6':'O','b':'D'}[box.sign]||'');}
 window.ZumiPrefixData={code,catalog,folder,library,parseExternalFolders,mergeFolders,read,importCode,defaults,defaultFolders};
 window.ZumiPrefixes=function({state,$,checkpoint,render,changed,tell,isBusy,select,selectedBoxes,onConfigChanged,download,safeName}){
  const dialog=$('prefixDialog'),nameModal=$('prefixFolderNameDialog');
  let draftFolders=[],draftActiveId='',folderOp='';
  function ensureStateFolders(){
   if(!Array.isArray(state.prefixFolders)||!state.prefixFolders.length){
    state.prefixFolders=defaultFolders();
    state.prefixFolders[0].items=structuredClone(state.prefixes||defaults());
    state.prefixFolders[0].defaultPrefix=state.defaultPrefix||'';
    state.activePrefixFolderId=state.prefixFolders[0].id;
   }
   if(!state.prefixFolders.some(f=>f.id===state.activePrefixFolderId))state.activePrefixFolderId=state.prefixFolders[0].id;
   const active=state.prefixFolders.find(f=>f.id===state.activePrefixFolderId);
   active.items=structuredClone(state.prefixes);
   active.defaultPrefix=state.defaultPrefix||'';
  }
  function syncBoxNames(items=state.prefixes){
   for(const p of state.pages)for(const b of p.boxes){
    const item=items.find(x=>x.code===b.prefix);
    if(item)b.prefixName=item.name;
   }
  }
  function renderFolderPickers(){
   ensureStateFolders();
   for(const id of ['prefixFolderSelect','exportPrefixFolderSelect']){
    const el=$(id);if(!el)continue;
    el.replaceChildren(...state.prefixFolders.map(f=>new Option(f.name+' ('+f.items.length+')',f.id)));
    el.value=state.activePrefixFolderId;
    el.disabled=isBusy();
   }
  }
  function persist(){
   ensureStateFolders();
   renderFolderPickers();
   try{
    localStorage.setItem(storageKey,JSON.stringify({
     format:'zumi-ocr-prefixes',
     version:2,
     folders:state.prefixFolders,
     activeFolderId:state.activePrefixFolderId,
     items:state.prefixes,
     defaultPrefix:state.defaultPrefix
    }));
    return true;
   }catch{return false;}
  }
  function switchFolder(folderId){
   if(isBusy())return;
   ensureStateFolders();
   const target=state.prefixFolders.find(f=>f.id===folderId);
   if(!target||target.id===state.activePrefixFolderId)return;
   checkpoint();
   state.activePrefixFolderId=target.id;
   state.prefixes=structuredClone(target.items);
   state.defaultPrefix=target.defaultPrefix||'';
   syncBoxNames(state.prefixes);
   persist();render();changed();onConfigChanged();
   tell('Carpeta de prefijos activa: «'+target.name+'» ('+target.items.length+' prefijos).');
  }
  for(const id of ['prefixFolderSelect','exportPrefixFolderSelect']){
   const el=$(id);if(el)el.onchange=e=>switchFolder(e.target.value);
  }
  function entry(value){return state.prefixes.find(p=>p.code===value);}
  function assignment(){const p=entry(state.defaultPrefix);return {prefix:p?.code||'',prefixName:p?.name||''};}
  function assign(box,value,fallbackName=''){const next=code(value),oldName=box.prefix===next?box.prefixName:'';box.prefix=next;box.prefixName=next?(entry(next)?.name||fallbackName||oldName||next):'';}
  function options(el,box={}){
   el.replaceChildren(new Option('Sin prefijo',''),...state.prefixes.map(p=>new Option(p.name,p.code)));
   if(box.prefix&&!entry(box.prefix))el.append(new Option((box.prefixName||box.prefix)+' · guardado',box.prefix));
   el.value=box.prefix||'';
  }
  function renderCard(card,box,index){
   const label=document.createElement('label');label.className='box-prefix';label.append(document.createTextNode('Prefijo TyperTool'));
   const row=document.createElement('span');row.className='prefix-choice';
   const picker=document.createElement('select');picker.className='prefix-select';picker.setAttribute('aria-label','Prefijo del globo '+(index+1));picker.disabled=isBusy();options(picker,box);
   const badge=document.createElement('span');badge.className='prefix-code';badge.textContent=box.prefix||'—';badge.title='Código que se añade al exportar';
   picker.onchange=()=>{if(isBusy())return;if((box.prefix||'')===picker.value)return;checkpoint();assign(box,picker.value);badge.textContent=box.prefix||'—';select([box.id],{cards:false});changed();};
   row.append(picker,badge);label.append(row);card.append(label);
  }
  function renderSelection(boxes){
   renderFolderPickers();
   const el=$('selectedPrefix');options(el,boxes[0]);
   const mixed=boxes.some(b=>(b.prefix||'')!==(boxes[0]?.prefix||''));
   if(mixed){el.prepend(new Option('Varios prefijos','\0mixed'));el.value='\0mixed';}
   el.disabled=isBusy()||!boxes.length;
   $('selectedPrefixCode').textContent=mixed?'Varios':boxes[0]?.prefix||'—';
  }
  $('selectedPrefix').onchange=e=>{
   if(isBusy()||e.target.value==='\0mixed')return;const boxes=selectedBoxes(),value=e.target.value;
   if(!boxes.length||boxes.every(b=>(b.prefix||'')===value))return;
   const fallbackName=boxes.find(b=>b.prefix===value)?.prefixName||'';
   checkpoint();boxes.forEach(b=>assign(b,value,fallbackName));render();changed();$('selectedPrefix').focus({preventScroll:true});
  };
  function currentDraftFolder(){
   return draftFolders.find(f=>f.id===draftActiveId)||draftFolders[0];
  }
  function commitCurrentDraftUI(){
   const f=currentDraftFolder();
   if(!f)return;
   const chosen=f.items.find(p=>p.id===$('newBoxPrefix').value);
   f.defaultPrefix=chosen?code(chosen.code):'';
  }
  function validateDraftFolder(f){
   const items=catalog(f.items);
   const chosen=items.find(p=>p.id===$('newBoxPrefix').value)||items.find(p=>p.code===f.defaultPrefix);
   f.items=items;
   f.defaultPrefix=chosen?.code||'';
  }
  function defaultOptions(value=$('newBoxPrefix').value){
   const f=currentDraftFolder(),items=f?f.items:[];
   $('newBoxPrefix').replaceChildren(new Option('Sin prefijo',''),...items.map(p=>new Option(p.name.trim()||'Nuevo prefijo',p.id)));
   $('newBoxPrefix').value=items.some(p=>p.id===value)?value:'';
  }
  function renderDialogFolderBar(){
   const f=currentDraftFolder();
   const sel=$('dialogPrefixFolder');
   if(sel){
    sel.replaceChildren(...draftFolders.map(folderItem=>new Option(folderItem.name,folderItem.id)));
    sel.value=f?.id||'';
   }
   const summary=$('dialogPrefixFolderSummary');
   if(summary&&f)summary.textContent=draftFolders.length+(draftFolders.length===1?' carpeta':' carpetas')+' · '+f.items.length+(f.items.length===1?' prefijo en «':' prefijos en «')+f.name+'»';
   if($('deletePrefixFolder'))$('deletePrefixFolder').disabled=draftFolders.length<=1;
  }
  function rows(){
   const f=currentDraftFolder(),items=f?f.items:[];
   const list=$('prefixRows'),scroll=list.scrollTop;list.replaceChildren();
   items.forEach((item,index)=>{
    const row=document.createElement('div');row.className='prefix-config-row';row.dataset.prefixId=item.id;
    const name=document.createElement('input');name.value=item.name;name.maxLength=80;name.placeholder='Nombre, por ejemplo Grito';name.setAttribute('aria-label','Nombre del prefijo '+(index+1));
    const symbol=document.createElement('input');symbol.value=item.code;symbol.maxLength=12;symbol.placeholder='G';symbol.spellcheck=false;symbol.setAttribute('aria-label','Código del prefijo '+(index+1));
    name.oninput=()=>{item.name=name.value;defaultOptions();};
    symbol.oninput=()=>{item.code=symbol.value;const chosen=f.items.find(p=>p.id===$('newBoxPrefix').value);f.defaultPrefix=chosen?code(chosen.code):'';};
    const remove=document.createElement('button');remove.type='button';remove.textContent='Quitar';remove.setAttribute('aria-label','Quitar prefijo '+(index+1));
    remove.onclick=()=>{f.items=f.items.filter(p=>p.id!==item.id);rows();defaultOptions();renderDialogFolderBar();};
    row.append(name,symbol,remove);list.append(row);
   });
   list.scrollTop=scroll;
   renderDialogFolderBar();
  }
  function loadDraftFolderToView(){
   const f=currentDraftFolder();
   if(!f)return;
   rows();
   const defItem=f.items.find(p=>p.code===f.defaultPrefix);
   defaultOptions(defItem?.id||'');
  }
  $('newBoxPrefix').onchange=()=>{commitCurrentDraftUI();};
  if($('dialogPrefixFolder')){
   $('dialogPrefixFolder').onchange=e=>{
    const nextId=e.target.value;
    try{
     validateDraftFolder(currentDraftFolder());
     draftActiveId=nextId;
     $('prefixError').textContent='';
     loadDraftFolderToView();
    }catch(err){
     $('dialogPrefixFolder').value=draftActiveId;
     $('prefixError').textContent='Antes de cambiar de carpeta: '+err.message;
    }
   };
  }
  function openFolderNameModal(op){
   try{validateDraftFolder(currentDraftFolder());}catch(err){$('prefixError').textContent='Antes de continuar: '+err.message;return;}
   folderOp=op;
   const f=currentDraftFolder();
   $('prefixFolderModalTitle').textContent=op==='new'?'Nueva carpeta de prefijos':op==='duplicate'?'Duplicar carpeta de prefijos':'Renombrar carpeta de prefijos';
   $('prefixFolderNameInput').value=op==='new'?'':f.name+(op==='duplicate'?' · copia':'');
   $('prefixFolderModalError').textContent='';
   nameModal.showModal();
   $('prefixFolderNameInput').focus();
   $('prefixFolderNameInput').select();
  }
  if($('newPrefixFolder'))$('newPrefixFolder').onclick=()=>openFolderNameModal('new');
  if($('duplicatePrefixFolder'))$('duplicatePrefixFolder').onclick=()=>openFolderNameModal('duplicate');
  if($('renamePrefixFolder'))$('renamePrefixFolder').onclick=()=>openFolderNameModal('rename');
  if($('cancelPrefixFolderModal'))$('cancelPrefixFolderModal').onclick=()=>nameModal.close();
  if($('confirmPrefixFolderModal')){
   $('confirmPrefixFolderModal').onclick=()=>{
    const name=text($('prefixFolderNameInput').value,80);
    if(!name){$('prefixFolderModalError').textContent='Escribe un nombre para la carpeta (máximo 80 caracteres).';return;}
    const curr=currentDraftFolder();
    if(draftFolders.some(f=>(folderOp!=='rename'||f.id!==curr.id)&&f.name.toLocaleLowerCase()===name.toLocaleLowerCase())){
     $('prefixFolderModalError').textContent='Ya existe una carpeta llamada «'+name+'».';return;
    }
    if(folderOp!=='rename'&&draftFolders.length>=100){
     $('prefixFolderModalError').textContent='Puedes tener hasta 100 carpetas de prefijos.';return;
    }
    if(folderOp==='rename'){
     curr.name=name;
    }else if(folderOp==='duplicate'){
     const copy={id:newId(),name,items:curr.items.map(p=>({...p,id:newId()})),defaultPrefix:curr.defaultPrefix};
     draftFolders.push(copy);draftActiveId=copy.id;
    }else{
     const base=[['D','Diálogo'],['P','Pensamiento'],['N','Narración'],['G','Grito'],['O','Onomatopeya']].map(([c,n])=>({id:newId(),code:c,name:n}));
     const created={id:newId(),name,items:base,defaultPrefix:''};
     draftFolders.push(created);draftActiveId=created.id;
    }
    nameModal.close();
    $('prefixError').textContent='';
    loadDraftFolderToView();
   };
  }
  if($('prefixFolderNameInput')){
   $('prefixFolderNameInput').addEventListener('keydown',e=>{
    if(e.key==='Enter'){e.preventDefault();$('confirmPrefixFolderModal').click();}
   });
  }
  if($('deletePrefixFolder')){
   $('deletePrefixFolder').onclick=()=>{
    if(draftFolders.length<=1){$('prefixError').textContent='Conserva al menos una carpeta de prefijos.';return;}
    const f=currentDraftFolder();
    if(!confirm('¿Eliminar la carpeta de prefijos «'+f.name+'»?'))return;
    draftFolders=draftFolders.filter(item=>item.id!==f.id);
    draftActiveId=draftFolders[0].id;
    $('prefixError').textContent='';
    loadDraftFolderToView();
   };
  }
  function open(){
   if(isBusy())return;
   ensureStateFolders();
   draftFolders=structuredClone(state.prefixFolders);
   draftActiveId=state.activePrefixFolderId;
   $('prefixError').textContent='';
   loadDraftFolderToView();
   dialog.showModal();
  }
  for(const id of ['configurePrefixes','configureExportPrefixes'])$(id).onclick=open;
  $('addPrefix').onclick=()=>{
   const f=currentDraftFolder();
   if(f.items.length>=100){$('prefixError').textContent='Puedes configurar hasta 100 prefijos por carpeta.';return;}
   commitCurrentDraftUI();
   f.items.push({id:newId(),name:'',code:''});
   rows();defaultOptions();
   const input=$('prefixRows').lastElementChild?.querySelector('input');
   if(input){input.focus();input.scrollIntoView({block:'nearest'});}
  };
  $('restorePrefixes').onclick=()=>{
   const f=currentDraftFolder();
   const builtin=builtinScans.find(b=>b[0]===f.id||b[1].toLocaleLowerCase()===f.name.toLocaleLowerCase());
   const sourceRows=builtin?builtin[2]:initial;
   f.items=sourceRows.map(([c,n])=>({id:newId(),code:c,name:n}));
   f.defaultPrefix='';
   rows();defaultOptions('');
   $('prefixError').textContent='Prefijos predeterminados restaurados en la carpeta «'+f.name+'». Pulsa Guardar para aplicarlos.';
  };
  if($('exportPrefixFolders')&&download&&safeName){
   $('exportPrefixFolders').onclick=()=>{
    try{
     validateDraftFolder(currentDraftFolder());
     const lib=library({folders:draftFolders,activeFolderId:draftActiveId});
     download(new Blob([JSON.stringify({format:'zumi-ocr-prefixes',version:2,folders:lib.folders,activeFolderId:lib.activeFolderId},null,2)],{type:'application/json;charset=utf-8'}),'Zumi_OCR_Carpetas_Prefijos.json');
     $('prefixError').textContent='';
    }catch(err){$('prefixError').textContent=err.message;}
   };
  }
  if($('importPrefixFolders')&&$('prefixFoldersInput')){
   $('importPrefixFolders').onclick=()=>{
    try{validateDraftFolder(currentDraftFolder());$('prefixFoldersInput').click();}
    catch(err){$('prefixError').textContent='Antes de importar: '+err.message;}
   };
   $('prefixFoldersInput').onchange=async e=>{
    const file=e.target.files[0];e.target.value='';
    if(!file)return;
    try{
     if(file.size>5*1024*1024)throw new Error('El archivo supera 5 MB.');
     const raw=JSON.parse((await file.text()).replace(/^\uFEFF/,''));
     const incoming=parseExternalFolders(raw,file.name.replace(/\.json$/i,''));
     const merged=mergeFolders(draftFolders,incoming,false);
     draftFolders=merged.folders;
     draftActiveId=merged.activeFolderId;
     loadDraftFolderToView();
     $('prefixError').textContent=incoming.length===1?'Carpeta «'+incoming[0].name+'» importada. Pulsa Guardar carpetas y prefijos para aplicarla.':incoming.length+' carpetas importadas. Pulsa Guardar carpetas y prefijos para aplicarlas.';
    }catch(err){$('prefixError').textContent=err.message;}
   };
  }
  $('savePrefixes').onclick=()=>{
   try{
    validateDraftFolder(currentDraftFolder());
    const lib=library({folders:draftFolders,activeFolderId:draftActiveId});
    const active=lib.folders.find(f=>f.id===lib.activeFolderId)||lib.folders[0];
    const items=active.items;
    const oldActive=state.prefixFolders?.find(f=>f.id===active.id);
    const baseOld=oldActive?oldActive.items:state.prefixes;
    const mapping=new Map(baseOld.map(old=>[old.code,items.find(p=>p.id===old.id)]));
    checkpoint();
    for(const p of state.pages)for(const b of p.boxes){
     const updated=mapping.get(b.prefix);
     if(updated){b.prefix=updated.code;b.prefixName=updated.name;}
     else{const same=items.find(item=>item.code===b.prefix);if(same)b.prefixName=same.name;}
    }
    state.prefixFolders=lib.folders;
    state.activePrefixFolderId=active.id;
    state.prefixes=structuredClone(items);
    state.defaultPrefix=active.defaultPrefix||'';
    const stored=persist();render();changed();onConfigChanged();dialog.close();
    tell(stored?'Carpeta «'+active.name+'» y prefijos guardados. Elige el nombre en cada globo; su código se añade al exportar.':'Prefijos aplicados. Guarda el proyecto para conservarlos: el navegador no permitió guardar la preferencia.');
   }catch(e){$('prefixError').textContent=e.message;}
  };
  function syncFromExternal(rawPrefixes,folderName=''){
   ensureStateFolders();
   const items=catalog(rawPrefixes);
   const cleanName=text(folderName,80);
   let target=cleanName?state.prefixFolders.find(f=>f.name.toLocaleLowerCase()===cleanName.toLocaleLowerCase()):state.prefixFolders.find(f=>f.id===state.activePrefixFolderId);
   if(cleanName&&!target){
    target={id:newId(),name:cleanName,items:structuredClone(items),defaultPrefix:''};
    state.prefixFolders.push(target);
   }else if(target){
    target.items=structuredClone(items);
    if(!items.some(p=>p.code===target.defaultPrefix))target.defaultPrefix='';
   }
   state.activePrefixFolderId=target.id;
   state.prefixes=structuredClone(target.items);
   state.defaultPrefix=target.defaultPrefix||'';
   syncBoxNames(state.prefixes);
   persist();
  }
  renderFolderPickers();
  return {renderCard,renderSelection,renderFolderPickers,persist,assignment,switchFolder,syncFromExternal};
 };
})();
