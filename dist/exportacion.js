'use strict';
window.ZumiExports = function(c) {
 const {state,$,page,tell,download,safeName}=c;
 function prepare(format='plain',scope='all',content='original',includePrefixes=true) {
  const targets=scope==='page'?(page()?[page()]:[]):state.pages;
  let total=0,omitted=0,count=0,prefixed=0;
  const pages=targets.map(p=>{
   const boxes=p.boxes.flatMap((b,index)=>{
    total++;const raw=String(content==='translation'?b.trad:b.ocr);const clean=(content==='translation'?raw:raw.replace(/\s*\r?\n\s*/g,' ')).trim();
    if(!clean){omitted++;return [];}
    const prefix=window.ZumiPrefixData.code(b.prefix),text=includePrefixes&&prefix?prefix+' '+clean:clean;
    if(includePrefixes&&prefix)prefixed++;
    count++;return [{id:b.id,order:index+1,text_prefixed:Boolean(includePrefixes&&prefix),prefix,prefix_name:b.prefixName||'',x:b.x,y:b.y,w:b.w,h:b.h,text,ocr:b.ocr,translation:b.trad}];
   });
   return {page_index:state.pages.indexOf(p)+1,filename:p.filename,content,reading_order:p.readingOrder||'position',width:p.width||undefined,height:p.height||undefined,boxes};
  });
  let text='';
  if(format==='coordinates'){text=JSON.stringify(pages,null,2);}
  else if(format==='capishot_typer'){
   text=pages.filter(p=>p.boxes.length).map((p,idx)=>{
    const lines=['Page '+(p.page_index||idx+1),'## '+p.filename];
    for(const b of p.boxes){
     const body=String(content==='translation'?b.translation:b.ocr).replace(/\s*\r?\n\s*/g,' ').trim();
     lines.push(includePrefixes&&b.prefix?(b.prefix+': '+body):body);
    }
    return lines.join('\n');
   }).join('\n\n');
  }else{text=pages.flatMap(p=>p.boxes.map(b=>b.text)).join('\n\n');}
  return {text,count,total,omitted,prefixed,pages:targets.length};
 }
 function refresh() {
  const format=$('textExportFormat').value,content=$('textExportContent').value;
  const bundle=prepare(format,$('textExportScope').value,content,$('textExportPrefixes').checked);
  $('textExportPreview').value=bundle.count?bundle.text:'';
  $('textExportSummary').textContent=bundle.count+' globos · '+bundle.pages+' páginas · '+bundle.text.length+' caracteres.'+(bundle.prefixed?' '+bundle.prefixed+' con prefijo TyperTool.':'')+(bundle.omitted?' '+bundle.omitted+' cajas sin '+(content==='translation'?'traducción':'original')+' se omiten.':'');
  $('downloadTextExport').textContent=format==='coordinates'?'Descargar JSON':'Descargar TXT';
  $('copyTextExport').disabled=!bundle.count;$('downloadTextExport').disabled=!bundle.count;
  $('textExportMessage').textContent=format==='capishot_typer'?'Formato listo para el panel TypeR de Capishot (Page N, ## archivo y PREFIJO: texto).':format==='plain'?('Un globo por bloque, separado por una línea en blanco. '+($('textExportPrefixes').checked?'Se añade el código elegido y un espacio; las cajas sin prefijo salen solo con su texto.':'Texto sin prefijos de TyperTool.')):'Las coordenadas están en píxeles del raw. Se conservan IDs, orden, prefijos, originales y traducciones; text contiene el texto elegido para exportar.';
  const qaEl=$('textExportQA');
  if(qaEl){
   const targets=$('textExportScope').value==='page'?(page()?[page()]:[]):state.pages;
   const cjkRe=/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;
   let noTrad=0,noPref=0,hasCjk=0;
   const noPrefPages=new Set(),cjkPages=new Set();
   for(const p of targets){
    for(const b of p.boxes||[]){
     const tr=String(b.trad||'').trim();
     if(content==='translation'&&!tr)noTrad++;
     if($('textExportPrefixes').checked&&!(b.prefix||'').trim()){noPref++;noPrefPages.add(p.filename);}
     if(content==='translation'&&tr&&cjkRe.test(tr)){hasCjk++;cjkPages.add(p.filename);}
    }
   }
   const issues=[];
   if(noTrad)issues.push(noTrad+' sin traducción');
   if(noPref)issues.push(noPref+' sin prefijo ('+[...noPrefPages].slice(0,3).join(', ')+(noPrefPages.size>3?'…':'')+')');
   if(hasCjk)issues.push(hasCjk+' con letras coreanas/chinas en español ('+[...cjkPages].slice(0,3).join(', ')+(cjkPages.size>3?'…':'')+')');
   qaEl.hidden=false;
   qaEl.classList.toggle('qa-warn',issues.length>0);
   qaEl.classList.toggle('qa-ok',issues.length===0);
   qaEl.textContent=issues.length?('⚠ Revisión previa: '+issues.join(' · ')):'✓ Revisión limpia: todas las cajas tienen texto y prefijo en orden.';
  }
  return bundle;
 }
 function open(format='plain',scope='all') {
  if(!state.pages.length)return tell('Carga imágenes o coordenadas primero.');
  $('textExportFormat').value=format;$('textExportScope').value=scope;$('textExportContent').value=format==='capishot_typer'?'translation':'original';
  refresh();if(!$('textExportDialog').open)$('textExportDialog').showModal();
 }
 async function copy() {
  const el=$('textExportPreview');if(!el.value)return;el.focus();el.select();
  try{await navigator.clipboard.writeText(el.value);$('textExportMessage').textContent='Copiado. Pégalo en tu IA o editor de texto.';}
  catch{if(document.execCommand('copy'))$('textExportMessage').textContent='Textos copiados.';else $('textExportMessage').textContent='El contenido está seleccionado. Pulsa Ctrl+C para copiarlo.';}
 }
 $('exportTexts').onclick=()=>open();$('exportPlainChapter').onclick=()=>open();if($('exportCapishotTypeR'))$('exportCapishotTypeR').onclick=()=>open('capishot_typer');$('exportLocatedChapter').onclick=()=>open('coordinates');
 for(const id of ['textExportFormat','textExportScope','textExportContent','textExportPrefixes'])$(id).onchange=refresh;
 $('copyTextExport').onclick=copy;$('closeTextExport').onclick=()=>$('textExportDialog').close();
 $('downloadTextExport').onclick=()=>{
  const bundle=refresh();if(!bundle.count)return;
  const coords=$('textExportFormat').value==='coordinates',translation=$('textExportContent').value==='translation',scope=$('textExportScope').value;
  const stem=safeName(scope==='page'?page().filename.replace(/\.[^.]+$/,''):state.name);
  const isTypeR=$('textExportFormat').value==='capishot_typer';download(new Blob([bundle.text],{type:coords?'application/json;charset=utf-8':'text/plain;charset=utf-8'}),stem+(translation?'_Espanol':'_Original')+(coords?'_Textos_Coordenadas.json':isTypeR?'_Capishot_TypeR.txt':'_Solo_Textos.txt'));
 };
 return {prepare,open,refresh};
};
