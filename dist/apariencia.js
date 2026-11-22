'use strict';
(function(){
 const key='zumi-color-theme-v1',root=document.documentElement;
 function apply(value){
  const dark=value!=='light';root.dataset.theme=dark?'dark':'light';root.style.colorScheme=dark?'dark':'light';
  document.querySelectorAll('[data-theme-toggle]').forEach(b=>{b.textContent=dark?'☀ Claro':'☾ Oscuro';b.setAttribute('aria-pressed',String(dark));b.setAttribute('aria-label',dark?'Cambiar a modo claro':'Cambiar a modo oscuro');b.title=b.getAttribute('aria-label');});
 }
 function saved(){try{return localStorage.getItem(key)||'dark';}catch{return 'dark';}}
 apply(saved());
 document.addEventListener('DOMContentLoaded',()=>{apply(saved());document.querySelectorAll('[data-theme-toggle]').forEach(b=>b.addEventListener('click',()=>{const value=root.dataset.theme==='dark'?'light':'dark';apply(value);try{localStorage.setItem(key,value);}catch{}}));});
 window.addEventListener('storage',e=>{if(e.key===key)apply(e.newValue||'dark');});
 window.ZumiAppearance={apply};
})();
