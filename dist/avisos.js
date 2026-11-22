'use strict';
window.ZumiNotices = function($){
 const notice=$('notice');let timer=null,running=false;
 function clear(){clearTimeout(timer);timer=null;}
 function duration(){return /^(Error:|No pude|No se pudo)/.test($('status').textContent)?10000:6000;}
 function later(){clear();if(!running&&!notice.hidden&&!notice.matches(':hover')&&!notice.contains(document.activeElement))timer=setTimeout(()=>notice.hidden=true,duration());}
 function show(message){clear();$('status').textContent=String(message);notice.hidden=false;later();}
 function setBusy(value){
  running=value;$('dismissNotice').hidden=value;
  if(value){clear();show('Procesando…');}else later();
 }
 $('dismissNotice').onclick=()=>{if(!running){clear();notice.hidden=true;}};
 notice.addEventListener('mouseenter',clear);notice.addEventListener('mouseleave',later);
 notice.addEventListener('focusin',clear);notice.addEventListener('focusout',()=>setTimeout(later,0));
 return {show,setBusy};
};
