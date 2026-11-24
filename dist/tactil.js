(function initZumiTouch(){
 const $ = id => document.getElementById(id);
 const STORAGE_KEY = 'zumi-pen-only';
 let penOnly = false;
 try { penOnly = localStorage.getItem(STORAGE_KEY) === '1'; } catch {}
 let gestureActive = false;
 let gestureCooldown = 0;

 // Detect Android WebView / Android device for safe status-bar padding
 if (/Android/i.test(navigator.userAgent || '')) {
  document.body.classList.add('android-app');
 }

 function syncPenUI(){
  const btn = $('penOnlyToggle');
  document.body.classList.toggle('pen-only', penOnly);
  if (btn) {
   btn.classList.toggle('active', penOnly);
   btn.setAttribute('aria-pressed', penOnly ? 'true' : 'false');
   btn.textContent = penOnly ? '🖊 Solo lápiz' : '☝ Dedo + lápiz';
  }
 }

 function cancelActiveStrokes(){
  try { window.ZumiOCR?.cancelDrag?.(); } catch {}
  try { window.ZumiCleanCancel?.(); } catch {}
 }

 window.ZumiTouch = {
  get penOnly(){ return penOnly; },
  setPenOnly(v){
   penOnly = Boolean(v);
   try { localStorage.setItem(STORAGE_KEY, penOnly ? '1' : '0'); } catch {}
   syncPenUI();
  },
  isGestureActive(){ return gestureActive || Date.now() < gestureCooldown; },
  shouldIgnoreDraw(e){
   if (!e) return false;
   if (gestureActive || Date.now() < gestureCooldown) return true;
   if (penOnly && e.pointerType === 'touch') return true;
   return false;
  }
 };

 const penBtn = $('penOnlyToggle');
 if (penBtn) {
  penBtn.onclick = () => {
   window.ZumiTouch.setPenOnly(!penOnly);
  };
 }
 syncPenUI();

 // 2-finger pinch-to-zoom and pan on #viewport
 const viewport = $('viewport');
 if (viewport) {
  let pinch = null;
  function touchDist(t1, t2){ return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY); }
  function touchMid(t1, t2){ return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 }; }

  viewport.addEventListener('touchstart', e => {
   if (e.touches.length >= 2) {
    gestureActive = true;
    cancelActiveStrokes();
    const t1 = e.touches[0], t2 = e.touches[1];
    const st = window.ZumiOCR?.getState?.();
    const startZoom = st?.zoom || 1;
    const mid = touchMid(t1, t2);
    const rect = viewport.getBoundingClientRect();
    pinch = {
     dist: Math.max(10, touchDist(t1, t2)),
     startZoom,
     lastMid: mid,
     contentX: (viewport.scrollLeft + (mid.x - rect.left)) / startZoom,
     contentY: (viewport.scrollTop + (mid.y - rect.top)) / startZoom
    };
    e.preventDefault();
   }
  }, { passive: false });

  viewport.addEventListener('touchmove', e => {
   if (e.touches.length >= 2 && pinch) {
    e.preventDefault();
    const t1 = e.touches[0], t2 = e.touches[1];
    const dist = Math.max(10, touchDist(t1, t2));
    const mid = touchMid(t1, t2);
    const rect = viewport.getBoundingClientRect();
    const nextZoom = Math.max(0.05, Math.min(4, pinch.startZoom * (dist / pinch.dist)));
    if (window.ZumiOCR?.setZoom) {
     window.ZumiOCR.setZoom(nextZoom);
     viewport.scrollLeft = Math.max(0, pinch.contentX * nextZoom - (mid.x - rect.left));
     viewport.scrollTop = Math.max(0, pinch.contentY * nextZoom - (mid.y - rect.top));
    }
    pinch.lastMid = mid;
   }
  }, { passive: false });

  function endPinch(e){
   if (e.touches.length < 2 && pinch) {
    pinch = null;
    gestureActive = false;
    gestureCooldown = Date.now() + 140;
   }
  }
  viewport.addEventListener('touchend', endPinch, { passive: true });
  viewport.addEventListener('touchcancel', endPinch, { passive: true });
 }

 // Split-screen side-by-side panel toggles (NO dark backdrop blocking the image)
 const leftBtn = $('mobileSidebarBtn');
 const rightBtn = $('mobileEditorBtn');
 const backdrop = $('mobileDrawerBackdrop');
 if (backdrop) backdrop.hidden = true;

 function syncPanelBtns(){
  const leftOpen = document.body.classList.contains('tablet-left-open');
  const rightOpen = !document.body.classList.contains('tablet-right-closed');
  if (leftBtn) leftBtn.classList.toggle('active', leftOpen);
  if (rightBtn) rightBtn.classList.toggle('active', rightOpen);
 }

 if (leftBtn) {
  leftBtn.onclick = () => {
   document.body.classList.toggle('tablet-left-open');
   syncPanelBtns();
   window.dispatchEvent(new Event('resize'));
  };
 }
 if (rightBtn) {
  rightBtn.onclick = () => {
   if (window.innerWidth <= 560 && document.body.classList.contains('tablet-left-open')) {
    document.body.classList.remove('tablet-left-open');
    document.body.classList.remove('tablet-right-closed');
   } else {
    document.body.classList.toggle('tablet-right-closed');
   }
   syncPanelBtns();
   window.dispatchEvent(new Event('resize'));
  };
 }
 syncPanelBtns();
})();
