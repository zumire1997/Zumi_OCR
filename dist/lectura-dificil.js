'use strict';
window.ZumiVision=function({$,page,selectedBoxes,checkpoint,render,changed,tell,download,safeName,isBusy,bridge}){
 const dialog=$('visionDialog');let target=null,canvas=null,controller=null,epoch=0;
 const oneLine=text=>String(text).replace(/^\uFEFF/,'').replace(/\s*\r?\n\s*/g,' ').trim();
 function message(text,error=false){$('visionMessage').textContent=text;$('visionMessage').classList.toggle('vision-error',error);}
 function parseBatchText(raw,boxes){
  const text=String(raw||'').replace(/^\uFEFF/,'').trim();
  if(!text)return [];
  // 1. Try JSON format first: {"items":[{"index":1,"text":"..."}]} or [{"index":1,"text":"..."}]
  try{
   const cleaned=text.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
   if(cleaned.startsWith('{')||cleaned.startsWith('[')){
    const obj=JSON.parse(cleaned);
    const arr=Array.isArray(obj)?obj:Array.isArray(obj.items)?obj.items:Array.isArray(obj.boxes)?obj.boxes:null;
    if(arr){
     const out=[];
     for(const item of arr){
      const idx=Number(item.index??item.number??item.n);
      const val=oneLine(item.text??item.ocr??'');
      if(Number.isInteger(idx)&&idx>=1&&idx<=boxes.length&&val){
       out.push({box:boxes[idx-1],index:idx,text:val});
      }else if(typeof item.id==='string'&&val){
       const foundIdx=boxes.findIndex(b=>b.id===item.id);
       if(foundIdx>=0)out.push({box:boxes[foundIdx],index:foundIdx+1,text:val});
      }
     }
     if(out.length)return out;
    }
   }
  }catch{}
  // 2. Parse numbered markers from Google Lens or plain text: [1] ..., 1. ..., (1) ..., 【1】 ...
  const lines=text.replace(/\r\n?/g,'\n').split('\n').map(l=>l.trim()).filter(Boolean);
  const byNumber=new Map();
  let currentIdx=null;
  const markerRegex=/^(?:\[\s*(\d{1,3})\s*\]|\(\s*(\d{1,3})\s*\)|【\s*(\d{1,3})\s*】|(\d{1,3})\s*[.):-]|#(\d{1,3})\b)\s*(.*)$/;
  for(const line of lines){
   const m=line.match(markerRegex);
   if(m){
    const num=Number(m[1]||m[2]||m[3]||m[4]||m[5]);
    const rest=oneLine(m[6]||'');
    if(num>=1&&num<=boxes.length){
     currentIdx=num;
     if(rest)byNumber.set(num,(byNumber.get(num)?byNumber.get(num)+' ':'')+rest);
     continue;
    }
   }
   if(currentIdx!==null){
    byNumber.set(currentIdx,(byNumber.get(currentIdx)?byNumber.get(currentIdx)+' ':'')+oneLine(line));
   }
  }
  if(byNumber.size){
   return [...byNumber.entries()].filter(([,val])=>val).map(([idx,val])=>({box:boxes[idx-1],index:idx,text:val}));
  }
  // 3. Fallback: if paragraph count or line count matches boxes.length
  const blocks=text.replace(/\r\n?/g,'\n').split(/\n\s*\n/).map(oneLine).filter(Boolean);
  if(blocks.length===boxes.length){
   return blocks.map((val,i)=>({box:boxes[i],index:i+1,text:val}));
  }
  if(lines.length===boxes.length){
   return lines.map((val,i)=>({box:boxes[i],index:i+1,text:oneLine(val)}));
  }
  return [];
 }
 function refresh(){
  const running=Boolean(controller);
  dialog.querySelectorAll('button,input,select,textarea').forEach(el=>el.disabled=running&&!['cancelVision','closeVision'].includes(el.id));
  if(target?.mode==='batch'){
   const parsed=parseBatchText($('visionText').value,target.boxes);
   $('applyVision').disabled=running||!parsed.length;
   $('applyVision').textContent=parsed.length?`Aplicar a ${parsed.length} ${parsed.length===1?'caja':'cajas'}`:'Aplicar lecturas al original';
  }else{
   $('applyVision').disabled=running||!oneLine($('visionText').value)||!target;
   $('applyVision').textContent='Aplicar al original';
  }
  $('cancelVision').hidden=!running;
 }
 function crop(p,b){
  if(!p?.image||!p.blob)throw new Error('Carga el raw de esta página para usar su recorte.');
  const scale=Math.min(2,1536/Math.max(b.w,b.h)),c=document.createElement('canvas');
  c.width=Math.max(1,Math.round(b.w*scale));c.height=Math.max(1,Math.round(b.h*scale));
  const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(p.image,b.x,b.y,b.w,b.h,0,0,c.width,c.height);return c;
 }
 function buildMosaic(p,boxes){
  if(!p?.image||!p.blob)throw new Error('Carga el raw de esta página para armar el mosaico.');
  const pad=16,badgeW=68,maxCropW=680;
  const items=boxes.map((b,i)=>{
   const scale=Math.min(1.6,maxCropW/Math.max(1,b.w),260/Math.max(1,b.h));
   const w=Math.max(24,Math.round(b.w*scale)),h=Math.max(36,Math.round(b.h*scale));
   return {b,index:i+1,w,h,rowH:Math.max(54,h+20)};
  });
  const totalW=Math.min(960,Math.max(460,Math.max(...items.map(it=>it.w))+badgeW+pad*3));
  const totalH=items.reduce((sum,it)=>sum+it.rowH+pad,pad);
  const c=document.createElement('canvas');
  c.width=totalW;c.height=totalH;
  const ctx=c.getContext('2d');
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,totalW,totalH);
  let y=pad;
  for(const it of items){
   ctx.strokeStyle='#dcd3e8';ctx.lineWidth=1.5;
   ctx.strokeRect(pad,y,totalW-pad*2,it.rowH);
   // Clear "[1]" text label on white background so Google Lens reads the number marker effortlessly!
   ctx.fillStyle='#f4effa';
   ctx.fillRect(pad+1,y+1,badgeW,it.rowH-2);
   ctx.fillStyle='#111111';
   ctx.font='bold 24px Arial, sans-serif';
   ctx.textAlign='center';ctx.textBaseline='middle';
   ctx.fillText('['+it.index+']',pad+badgeW/2,y+it.rowH/2);
   // Draw crop
   const cx=pad+badgeW+12,cy=y+Math.round((it.rowH-it.h)/2);
   ctx.drawImage(p.image,it.b.x,it.b.y,it.b.w,it.b.h,cx,cy,it.w,it.h);
   y+=it.rowH+pad;
  }
  return c;
 }
 function open(){
  if(isBusy())return;
  const p=page();
  if(!p?.blob)return tell('Carga una imagen primero.');
  if(!p.boxes?.length)return tell('Escanea la página o crea cajas primero para poder leerlas.');
  const sel=selectedBoxes();
  const isBatch=sel.length!==1;
  const boxes=sel.length>1?sel:sel.length===1?[sel[0]]:p.boxes;
  try{
   if(isBatch){
    canvas=buildMosaic(p,boxes);
    target={mode:'batch',pageId:p.id,boxes,snapshots:boxes.map(b=>({id:b.id,ocr:b.ocr})),filename:p.filename,language:$('language').selectedOptions[0]?.textContent||'idioma original'};
    $('visionTitle').textContent='Mosaico Google Lens / Gemini · '+boxes.length+' cajas';
    $('visionTarget').textContent=p.filename+' · '+(sel.length>1?sel.length+' cajas seleccionadas':'todas las '+boxes.length+' cajas de la página');
    $('visionCrop').src=canvas.toDataURL('image/png');
    $('visionText').value=boxes.map((b,i)=>'['+(i+1)+'] '+b.ocr).join('\n');
    $('visionText').rows=8;
    $('visionText').placeholder='Pega aquí el texto copiado de Google Lens (con [1], [2]… o una línea por caja).';
    message('Copia o descarga el mosaico para Google Lens (o pulsa Leer con Gemini) y pega el resultado abajo.');
   }else{
    const b=boxes[0];canvas=crop(p,b);
    target={mode:'single',pageId:p.id,id:b.id,box:b,ocr:b.ocr,filename:p.filename,language:$('language').selectedOptions[0]?.textContent||'idioma original'};
    $('visionTitle').textContent='Lectura difícil';
    $('visionTarget').textContent=p.filename+' · globo '+(p.boxes.indexOf(b)+1);
    $('visionCrop').src=canvas.toDataURL('image/png');
    $('visionText').value=b.ocr;
    $('visionText').rows=4;
    $('visionText').placeholder='Pega o revisa aquí el original, sin traducirlo.';
    message('Revisa la lectura y pulsa Aplicar al original.');
   }
   $('visionBridgeURL').value=$('bridgeURL').value;
   if($('provider').value==='gemini'&&!$('visionKey').value)$('visionKey').value=$('apiKey').value;
   if(!$('visionModel').value)$('visionModel').value=$('geminiModel').value||'gemini-2.5-flash';
   method();refresh();dialog.showModal();
  }catch(e){tell(e.message);}
 }
 function method(){$('visionExternal').hidden=$('visionMethod').value!=='external';$('visionGemini').hidden=$('visionMethod').value!=='gemini';}
 function cancel(){epoch++;controller?.abort();controller=null;refresh();}
 async function directGemini(action,key,extra,signal){
  if(action==='models'){
   const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',{headers:{'x-goog-api-key':key},signal});
   const data=await r.json();if(!r.ok)throw new Error(data.error?.message||'Gemini API respondió '+r.status);return data;
  }
  const model=String(extra.model||'gemini-2.5-flash').replace(/^models\//,'');
  const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{
   method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify(extra.payload),signal
  });
  const data=await r.json();if(!r.ok)throw new Error(data.error?.message||'Gemini API respondió '+r.status);return data;
 }
 async function request(action,extra){
  if(controller)return;const key=$('visionKey').value.trim();if(!key)throw new Error('Escribe tu clave de Gemini (puedes crear una gratis en Google AI Studio).');
  const token=++epoch;controller=new AbortController();const current=controller;refresh();
  try{
   // Try direct browser call to Gemini API first (works without CONECTAR_APIS.bat and works on tablet/web!), fallback to local bridge if needed
   let data;
   try{
    data=await directGemini(action,key,extra,current.signal);
   }catch(directErr){
    if(current.signal.aborted)throw directErr;
    const u=new URL($('visionBridgeURL').value||'http://127.0.0.1:11436');
    if(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname)){
     const payload={provider:'gemini',key,...extra};
     data=await bridge(action,payload,current,u.origin);
    }else throw directErr;
   }
   if(token!==epoch||!dialog.open)return null;return data;
  }catch(e){if(token!==epoch)return null;throw e;}
  finally{if(token===epoch){controller=null;refresh();}}
 }
 async function models(){
  try{message('Buscando modelos Gemini…');const data=await request('models',{});if(!data)return;
   const models=(data.models||[]).filter(m=>m.supportedGenerationMethods?.includes('generateContent')&&/^models\/gemini-/.test(m.name));if(!models.length)throw new Error('La clave no muestra modelos compatibles.');
   $('visionModels').replaceChildren(...models.map(m=>new Option(m.displayName||m.name,m.name.replace(/^models\//,''))));
   if(!models.some(m=>m.name.replace(/^models\//,'')===$('visionModel').value))$('visionModel').value=(models.find(m=>/flash/i.test(m.name)&&!/image|tts|audio/i.test(m.name))||models[0]).name.replace(/^models\//,'');
   message(models.length+' modelos disponibles.');
  }catch(e){message(e.message,true);}
 }
 async function read(){
  try{
   const model=($('visionModel').value.trim()||'gemini-2.5-flash').replace(/^models\//,'');if(!/^gemini-[\w.-]+$/.test(model))throw new Error('Elige un modelo Gemini (por ejemplo gemini-2.5-flash) o pulsa Buscar modelos.');
   if(!canvas||!target)throw new Error('Vuelve a abrir el recorte o mosaico que quieres leer.');
   const dataURL=canvas.toDataURL('image/jpeg',.92);
   if(target.mode==='batch'){
    const count=target.boxes.length;
    const prompt=`Esta imagen es un mosaico numerado del [1] al [${count}] con recortes de globos de un cómic o manhwa en ${target.language}. Transcribe con precisión cada recorte respetando exactamente los espacios entre palabras, signos de puntuación y ortografía original. No traduzcas nada. Devuelve SOLO un objeto JSON con la forma {"items":[{"index":1,"text":"transcripción 1"},{"index":2,"text":"transcripción 2"}]}.`;
    message(`Leyendo ${count} cajas con Gemini (${model})…`);
    const data=await request('translate',{model,payload:{contents:[{role:'user',parts:[{text:prompt},{inlineData:{mimeType:'image/jpeg',data:dataURL.split(',')[1]}}]}],generationConfig:{temperature:0,responseMimeType:'application/json'}}});
    if(!data)return;
    const candidate=data.candidates?.[0];if(candidate?.finishReason&&candidate.finishReason!=='STOP')throw new Error('Gemini no terminó la lectura ('+candidate.finishReason+').');
    const raw=candidate?.content?.parts?.filter(p=>!p.thought).map(p=>p.text||'').join('');if(!raw)throw new Error('Gemini no devolvió una lectura.');
    const parsed=parseBatchText(raw,target.boxes);
    if(!parsed.length)throw new Error('No se pudieron extraer textos de la respuesta de Gemini.');
    const byIdx=new Map(parsed.map(it=>[it.index,it.text]));
    $('visionText').value=target.boxes.map((b,i)=>'['+(i+1)+'] '+(byIdx.get(i+1)??b.ocr)).join('\n');
    message(`Lectura recibida para ${parsed.length} de ${count} cajas. Revísala y pulsa Aplicar.`);refresh();
   }else{
    const prompt='Transcribe con precisión el texto visible en este recorte de un cómic. Idioma esperado: '+target.language+'. Puede ser manuscrito, inclinado o estar fuera de un globo. Conserva exactamente los espacios entre palabras y los signos. No traduzcas ni inventes letras. Devuelve SOLO JSON con la forma {"text":"transcripción original"}.';
    message('Leyendo el recorte con Gemini…');const data=await request('translate',{model,payload:{contents:[{role:'user',parts:[{text:prompt},{inlineData:{mimeType:'image/jpeg',data:dataURL.split(',')[1]}}]}],generationConfig:{temperature:0,responseMimeType:'application/json'}}});if(!data)return;
    const candidate=data.candidates?.[0];if(candidate?.finishReason&&candidate.finishReason!=='STOP')throw new Error('Gemini no terminó la lectura ('+candidate.finishReason+').');
    const raw=candidate?.content?.parts?.filter(p=>!p.thought).map(p=>p.text||'').join('');if(!raw)throw new Error('Gemini no devolvió una lectura. Revisa el modelo o las restricciones de la API.');
    let parsed;try{parsed=JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));}catch{throw new Error('La respuesta no tiene el formato de lectura esperado. El original se conserva.');}
    if(typeof parsed.text!=='string'||!oneLine(parsed.text))throw new Error('Gemini no encontró texto legible. Puedes usar Lens o escribir la corrección manualmente.');
    $('visionText').value=oneLine(parsed.text);message('Lectura recibida. Revísala antes de Aplicar al original.');refresh();
   }
  }catch(e){message(e.message,true);}
 }
 function apply(){
  if(controller||!target)return;
  const p=page();
  if(!p||p.id!==target.pageId)return message('La página cambió desde que abriste la ventana. Cierra y vuelve a abrir.',true);
  if(target.mode==='batch'){
   const parsed=parseBatchText($('visionText').value,target.boxes);
   if(!parsed.length)return message('Pega el texto con números [1], [2]… o una línea por cada caja.',true);
   let updated=0;
   checkpoint();
   for(const item of parsed){
    const boxInPage=p.boxes.find(b=>b.id===item.box.id);
    if(boxInPage&&item.text&&boxInPage.ocr!==item.text){
     boxInPage.ocr=item.text;updated++;
    }
   }
   if(updated){render();changed();}
   dialog.close();
   tell(updated?`${updated} cajas actualizadas con la lectura de Lens / Gemini. Ctrl+Z permite deshacer.`:'Las lecturas ya coincidían con el texto actual.');
   return;
  }
  const b=p.boxes.find(b=>b.id===target.id),text=oneLine($('visionText').value);
  if(!b||b!==target.box||b.ocr!==target.ocr)return message('La caja cambió desde que abriste el recorte. Cierra y vuelve a abrir Lectura difícil.',true);
  if(!text)return message('Pega o escribe una lectura antes de aplicarla.',true);
  if(text!==b.ocr){checkpoint();b.ocr=text;render();changed();}
  dialog.close();tell('Original corregido. Revisa su traducción si ya tenía una. Ctrl+Z permite deshacer.');
 }
 $('difficultOCR').onclick=open;$('visionMethod').onchange=method;$('visionText').oninput=refresh;$('listVisionModels').onclick=models;$('readVision').onclick=read;$('applyVision').onclick=apply;
 $('cancelVision').onclick=()=>{cancel();message('Lectura detenida. El original se conserva.');};$('closeVision').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{if(dialog.open)return;cancel();target=null;canvas=null;$('visionCrop').removeAttribute('src');$('visionText').value='';refresh();});
 $('forgetVisionKey').onclick=()=>{const key=$('visionKey').value;$('visionKey').value='';if($('apiKey').value===key)$('apiKey').value='';message('Clave de lectura borrada de esta sesión.');};
 $('copyVisionCrop').onclick=async()=>{try{if(!canvas)throw new Error('Abre primero una caja o mosaico.');if(!navigator.clipboard?.write||!window.ClipboardItem)throw new Error('Este navegador no permite copiar imágenes; usa Descargar imagen.');await navigator.clipboard.write([new ClipboardItem({'image/png':new Promise(resolve=>canvas.toBlob(resolve,'image/png'))})]);message(target?.mode==='batch'?'Mosaico copiado. Pégalo en Google Lens (Ctrl+V), copia todo el texto y pégalo abajo.':'Recorte copiado. Pégalo en Lens o en tu IA.');}catch(e){message(e.message||'No se pudo copiar. Usa Descargar.',true);}};
 $('downloadVisionCrop').onclick=()=>{if(canvas&&target){const suffix=target.mode==='batch'?'_Mosaico_Lens.png':'_'+target.id+'_Recorte.png';const filename=safeName(target.filename.replace(/\.[^.]+$/,'')+suffix);canvas.toBlob(blob=>{if(blob)download(blob,filename);},'image/png');}};
 method();refresh();return {open,refresh,oneLine,parseBatchText,buildMosaic};
};
