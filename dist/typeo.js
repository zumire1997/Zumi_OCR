'use strict';
window.ZumiTypeo=function(c){
 const {state,$,selectedBoxes,page,checkpoint,render,renderOverlay,changed,tell,clampBox,finite}=c, profiles=window.ZumiStyles;
 const keys=['fontFamily','fontSize','textColor','lineHeight','padding','bold','italic','uppercase','autoFit','balanced','manualLines','horizontalScale','verticalScale','tracking'];
 const alias={'1':'D','2':'P','3':'N','6':'O','b':'D'};
 const measure=document.createElement('canvas').getContext('2d');
 function profile(b){return profiles.find(p=>p.id===(b.profile||alias[b.sign]||b.sign))||profiles[0];}
 function style(b){const st={...state.settings,autoFit:true,balanced:true,manualLines:false,horizontalScale:100,verticalScale:100,tracking:0,...(b.profile?profile(b):{}),...(b.sign==='b'?{bold:true}:{}),...b.style};if(b.style?.fontFamily&&(!b.profile||b.style.fontFamily!==profile(b).fontFamily))st.fontPS=b.style.fontFamily;return Object.fromEntries([...keys,'fontPS'].filter(k=>st[k]!==undefined).map(k=>[k,st[k]]));}
 function rect(b){return b.typeRect||b;}
 function font(size,s){return `${s.italic?'italic ':''}${s.bold?'bold ':''}${size}px "${s.fontFamily.replace(/["\\]/g,'')}", Arial, sans-serif`;}
 function width(text,size,s){measure.font=font(size,s);return (measure.measureText(text).width+Math.max(0,Array.from(text).length-1)*s.tracking*size/1000)*s.horizontalScale/100;}
 function greedy(text,maxWidth,size,s){const out=[];for(const para of text.split('\n')){let line='';for(const word of para.split(/\s+/).filter(Boolean)){const parts=[];if(width(word,size,s)>maxWidth){let part='';for(const ch of Array.from(word)){if(part&&width(part+ch,size,s)>maxWidth){parts.push(part);part=ch;}else part+=ch;}if(part)parts.push(part);}else parts.push(word);for(const part of parts){const test=line?line+' '+part:part;if(line&&width(test,size,s)>maxWidth){out.push(line);line=part;}else line=test;}}out.push(line);}return out;}
 function balance(para,maxWidth,size,s){const quick=greedy(para,maxWidth,size,s),words=para.split(/\s+/).filter(Boolean),k=quick.length;if(k<2||words.length>150||words.some(w=>width(w,size,s)>maxWidth))return quick;
  const cache=new Map(),get=(i,j)=>{const key=i+':'+j;if(!cache.has(key))cache.set(key,width(words.slice(i,j).join(' '),size,s));return cache.get(key);};
  const target=(width(words.join(' '),size,s)-(k-1)*width(' ',size,s))/k,memo=new Map();
  function solve(i,n){if(n===0)return i===words.length?{cost:0,lines:[]}:null;const key=i+','+n;if(memo.has(key))return memo.get(key);let best=null;for(let j=i+1;j<=words.length-n+1;j++){const w=get(i,j);if(w>maxWidth)break;const tail=solve(j,n-1);if(!tail)continue;const cost=(w-target)**2+tail.cost+(j-i===1&&k>2?target**2*.08:0);if(!best||cost<best.cost)best={cost,lines:[words.slice(i,j).join(' '),...tail.lines]};}memo.set(key,best);return best;}return solve(0,k)?.lines||quick;
 }
 function layout(b){const s=style(b),r=rect(b);let text=b.trad.trim().replace(/\r\n?/g,'\n');if(s.uppercase)text=text.toUpperCase();const pad=Math.min(s.padding,Math.max(0,Math.min(r.w,r.h)/4)),w=Math.max(1,r.w-pad*2),h=Math.max(1,r.h-pad*2);let size=s.fontSize,lines;
  const make=()=>s.manualLines?text.split('\n'):text.split('\n').flatMap(p=>s.balanced?balance(p,w,size,s):greedy(p,w,size,s));lines=make();
  while(s.autoFit&&size>4&&(lines.length*size*s.lineHeight*s.verticalScale/100>h||s.manualLines&&lines.some(l=>width(l,size,s)>w))){size=Math.max(4,size-.5);lines=make();}
  const step=size*s.lineHeight*s.verticalScale/100,overflow=lines.length*step>h||lines.some(l=>width(l,size,s)>w);
  return {lines,size,step,y:r.y+r.h/2-(lines.length-1)*step/2+size*.35*s.verticalScale/100,x:r.x+r.w/2,rect:{x:r.x,y:r.y,w:r.w,h:r.h},style:s,overflow};
 }
 function inspector(){const b=selectedBoxes()[0];$('typeInspector').hidden=!b;$('typeSelectionHint').hidden=!!b;if(!b)return;const s=style(b),r=rect(b);$('styleProfile').value=b.profile||'';for(const k of keys){const el=$('type_'+k);if(el.type==='checkbox')el.checked=s[k];else el.value=s[k];}for(const k of ['x','y','w','h'])$('typeRect_'+k).value=r[k];const l=layout(b);$('layoutInfo').textContent=(b.trad.trim()?l.lines.length+' líneas · tamaño aplicado '+l.size+' px. ':'Sin traducción. ')+(l.overflow?'El texto rebasa el área; amplía el espacio o reduce el tamaño.':'Los saltos escritos en Español se conservan.');}
 function change(){const boxes=selectedBoxes();if(!boxes.length)return;checkpoint();for(const b of boxes){b.style={};for(const k of keys){const el=$('type_'+k);b.style[k]=el.type==='checkbox'?el.checked:el.type==='number'?finite(el.value,style(b)[k]):el.value;}b.style.fontSize=Math.max(4,Math.min(300,b.style.fontSize));b.style.lineHeight=Math.max(.7,Math.min(3,b.style.lineHeight));b.style.horizontalScale=Math.max(25,Math.min(200,b.style.horizontalScale));b.style.verticalScale=Math.max(25,Math.min(200,b.style.verticalScale));b.style.padding=Math.max(0,Math.min(100,b.style.padding));b.style.tracking=Math.max(-100,Math.min(500,b.style.tracking));}renderOverlay();inspector();changed();}
 $('styleProfile').replaceChildren(new Option('Configuración general / personalizada',''),...profiles.map(p=>new Option(p.id+' · '+p.name,p.id)));
 $('styleProfile').onchange=()=>{checkpoint();for(const b of selectedBoxes()){b.profile=$('styleProfile').value;b.style={};if(b.profile)b.sign=b.profile;}render();changed();};
 for(const k of keys)$('type_'+k).onchange=change;
 for(const k of ['x','y','w','h'])$('typeRect_'+k).onchange=()=>{const b=selectedBoxes()[0];if(!b)return;checkpoint();b.typeRect={x:rect(b).x,y:rect(b).y,w:rect(b).w,h:rect(b).h};b.typeRect[k]=finite($('typeRect_'+k).value,b.typeRect[k]);clampBox(b.typeRect,page());renderOverlay();inspector();changed();};
 $('resetTypeRect').onclick=()=>{checkpoint();for(const b of selectedBoxes())delete b.typeRect;render();changed();};
 $('resetBoxStyle').onclick=()=>{checkpoint();for(const b of selectedBoxes()){b.profile='';b.style={};}render();changed();};
 $('editTypeArea').onchange=()=>{if($('editTypeArea').checked){$('previewType').checked=true;$('showBoxes').checked=true;tell('Arrastra la caja turquesa o su esquina. Solo cambia el área del texto; la limpieza conserva su rectángulo.');}renderOverlay();};
 $('loadFont').onclick=()=>$('fontInput').click();$('fontInput').onchange=async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;const name=$('fontLoadName').value.trim()||f.name.replace(/\.[^.]+$/,'');try{const face=await new FontFace(name,await f.arrayBuffer()).load();document.fonts.add(face);checkpoint();$('fontFamily').value=name;state.settings.fontFamily=name;for(const b of selectedBoxes())b.style={...b.style,fontFamily:name};render();changed();tell('Fuente cargada para esta sesión: '+name+'. Al reabrir el proyecto, vuelve a cargarla si no está instalada.');}catch{tell('No pude cargar esa fuente. Usa un archivo TTF, OTF o WOFF válido.');}};
 return {style,rect,font,layout,inspector,width};
};
