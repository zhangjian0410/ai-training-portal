document.documentElement.classList.add('js');
const slides=[...document.querySelectorAll('.slide')];
const mobile=matchMedia('(max-width:850px)');
const contents=document.getElementById('contents');
let index=0;
let previewGeneration=0;
const previewLoads=new WeakMap();
function loadPreview(slide,priority='low'){
 const image=slide?.querySelector('.fullscreen-preview');
 if(!image)return Promise.resolve();
 if(priority==='high')image.fetchPriority='high';
 if(previewLoads.has(image))return previewLoads.get(image);
 const status=slide.querySelector('.preview-status');
 image.fetchPriority=priority;image.loading='eager';
 status.hidden=false;status.textContent='正在加载课件…';
 image.src=image.dataset.src;
 const loaded=image.decode().then(()=>{status.hidden=true;}).catch(()=>{
  previewLoads.delete(image);status.hidden=false;
  status.textContent='课件图片暂时无法加载，请刷新页面重试。';
  throw new Error('Slide preview unavailable');
 });
 previewLoads.set(image,loaded);return loaded;
}
function preparePreviews(){
 const generation=++previewGeneration;
 if(mobile.matches)return;
 const current=index;
 loadPreview(slides[current],'high').then(async()=>{
  const connection=navigator.connection;
  if(connection?.saveData||['slow-2g','2g'].includes(connection?.effectiveType))return;
  // Warm a small reading window, without competing with the current page.
  for(const n of [current+1,current+2,current-1]){
   if(generation!==previewGeneration||mobile.matches)return;
   if(slides[n])await loadPreview(slides[n]);
  }
 }).catch(()=>{});
}
let beforeFullscreenFocus=null;
// Keep the original readable HTML as an optional transcript outside the slide canvas.
const textViews=slides.flatMap(slide=>{
 const source=slide.querySelector('.slide-content');if(!source)return [];
 const details=document.createElement('details'),summary=document.createElement('summary');
 details.className='slide-text '+[...slide.classList].filter(name=>name.startsWith('kind-')).join(' ');
 summary.textContent='查看课件文字与本页资料';details.append(summary);details.hidden=true;
 slide.closest('.lesson').append(details);
 return [{slide,source,details}];
});
const savedTextOpen=new Map();
const coverResources=document.querySelector('.kind-cover .cover-resources');
if(coverResources)coverResources.closest('.lesson').querySelector('.explanation').append(coverResources);
function prepareReadingMode(){
 const fullscreen=!!document.fullscreenElement&&!mobile.matches;
 for(const {slide,source,details} of textViews){
  if(mobile.matches){if(source.parentElement!==slide)slide.append(source);details.hidden=true;}
  else {if(source.parentElement!==details)details.append(source);details.hidden=false;}
  if(fullscreen){if(!savedTextOpen.has(details))savedTextOpen.set(details,details.open);details.open=true;}
  else if(savedTextOpen.has(details)){details.open=savedTextOpen.get(details);savedTextOpen.delete(details);}
 }
}
const originalTabindex=new Map();
function syncSlideFocus(){
 const fullscreen=!!document.fullscreenElement&&!mobile.matches;
 document.querySelectorAll('.slide a,.slide button,.slide summary,.slide-text a,.slide-text button,.slide-text summary').forEach(element=>{
  if(fullscreen){if(!originalTabindex.has(element))originalTabindex.set(element,element.getAttribute('tabindex'));element.setAttribute('tabindex','-1');}
  else if(originalTabindex.has(element)){const value=originalTabindex.get(element);if(value===null)element.removeAttribute('tabindex');else element.setAttribute('tabindex',value);originalTabindex.delete(element);}
 });
}
function hashIndex(){const n=slides.findIndex(slide=>'#'+slide.id===location.hash);return n<0?0:n;}
function positionContents(){
 if(!contents||contents.hidden)return;
 const top=document.getElementById('contents-toggle').getBoundingClientRect().top;
 contents.style.bottom=`${Math.max(12,innerHeight-top+12)}px`;
 contents.style.maxHeight=`${Math.max(80,Math.min(innerHeight-24,top-24))}px`;
}
function fitFullscreen(){
 prepareReadingMode();
 syncSlideFocus();
 if(!document.fullscreenElement||mobile.matches||!slides.length){
  document.querySelectorAll('.explanation p').forEach(p=>p.style.removeProperty('font-size'));
  positionContents();
  return;
 }
 const lesson=slides[index].closest('.lesson'),notes=lesson.querySelector('.explanation');
 const stage=document.getElementById('stage'),bar=stage.querySelector('.deck-controls');
 const css=getComputedStyle(stage),gap=parseFloat(css.rowGap)||12;
 const available=stage.clientHeight-parseFloat(css.paddingTop)-parseFloat(css.paddingBottom)-bar.offsetHeight-gap;
 const stacked=matchMedia('(max-width:1100px)').matches;
 const width=stage.clientWidth-parseFloat(css.paddingLeft)-parseFloat(css.paddingRight);
 const slideWidth=stacked?Math.min(width,(available-260-gap)*16/9):Math.min(width-notes.offsetWidth-gap,available*16/9);
 const slideHeight=slideWidth*9/16;
 stage.style.setProperty('--deck-width',`${stacked?width:slideWidth+notes.offsetWidth+gap}px`);
 lesson.style.setProperty('--frame-width',`${slideWidth}px`);
 lesson.style.setProperty('--frame-height',`${slideHeight}px`);
 if(stacked)lesson.style.setProperty('--notes-height',`${available-slideHeight-gap}px`);
 else lesson.style.setProperty('--notes-height',`${slideHeight}px`);
 const prose=notes.querySelector('p');
 for(let size=20;size>=14;size-=.5){prose.style.fontSize=`${size}px`;if(notes.scrollHeight<=notes.clientHeight+1&&prose.scrollWidth<=prose.clientWidth+1)break;}
 positionContents();
}
function show(n,scroll=false){
 if(!slides.length)return;
 index=Math.max(0,Math.min(slides.length-1,n));
 slides.forEach((s,i)=>{s.classList.toggle('active',i===index);s.closest('.lesson').classList.toggle('active',i===index);});
 document.getElementById('page-counter').textContent=`${String(index+1).padStart(2,'0')} / ${String(slides.length).padStart(2,'0')}`;
 document.getElementById('prev').disabled=index===0;
 document.getElementById('first').disabled=index===0;
 const atEnd=index===slides.length-1;
 document.getElementById('next').disabled=atEnd;
 document.getElementById('next').hidden=atEnd;
 document.querySelector('.deck-next-action').hidden=!atEnd;
 document.querySelector('[data-course-end]').hidden=!atEnd;
 fitFullscreen();
 preparePreviews();
 if(scroll){if(mobile.matches)slides[index].scrollIntoView({block:'start'});else window.scrollTo(0,0);}
}
function go(n){const target=Math.max(0,Math.min(slides.length-1,n));history.replaceState(null,'','#'+slides[target].id);show(target,true);}
async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else {beforeFullscreenFocus=document.activeElement;await document.documentElement.requestFullscreen();}}catch{const button=document.getElementById('fullscreen');if(button)button.textContent='浏览器未允许全屏';}}
if(slides.length){
 show(hashIndex());
 if(location.hash&&mobile.matches)slides[index].scrollIntoView({block:'start'});
 document.getElementById('prev').addEventListener('click',()=>go(index-1));
 document.getElementById('first').addEventListener('click',()=>go(0));
 document.getElementById('next').addEventListener('click',()=>go(index+1));
 const toggle=document.getElementById('contents-toggle');
 toggle.addEventListener('click',()=>{contents.hidden=!contents.hidden;toggle.setAttribute('aria-expanded',String(!contents.hidden));positionContents();});
 contents.addEventListener('click',event=>{if(event.target.closest('a')){contents.hidden=true;toggle.setAttribute('aria-expanded','false');}});
 addEventListener('hashchange',()=>{if(location.hash.startsWith('#slide-'))show(hashIndex(),true);});
 document.addEventListener('keydown',event=>{
  if(event.target.closest('input,textarea,[contenteditable="true"]'))return;
  if(event.key==='ArrowRight'){event.preventDefault();go(index+1);}
  if(event.key==='ArrowLeft'){event.preventDefault();go(index-1);}
  if(event.key==='Home'){event.preventDefault();go(0);}
  if(event.key.toLowerCase()==='f'){event.preventDefault();fullscreen();}
  if(event.key==='Escape'){contents.hidden=true;toggle.setAttribute('aria-expanded','false');}
 });
 const fsButton=document.getElementById('fullscreen');if(fsButton)fsButton.addEventListener('click',fullscreen);
 mobile.addEventListener('change',()=>show(index,true));
 addEventListener('resize',fitFullscreen);
 document.addEventListener('fullscreenchange',()=>{
  syncSlideFocus();
  if(!document.fullscreenElement)document.querySelectorAll('.explanation p').forEach(p=>p.style.removeProperty('font-size'));
  fitFullscreen();
  if(document.fullscreenElement)document.getElementById('contents-toggle').focus({preventScroll:true});
  else {
   const target=beforeFullscreenFocus?.isConnected&&beforeFullscreenFocus.getClientRects().length?beforeFullscreenFocus:document.getElementById('contents-toggle');
   target.focus({preventScroll:true});beforeFullscreenFocus=null;
  }
 });
 document.fonts?.ready.then(()=>requestAnimationFrame(fitFullscreen));
 const observer=new IntersectionObserver(entries=>{if(!mobile.matches)return;const visible=entries.filter(e=>e.isIntersecting).sort((a,b)=>b.intersectionRatio-a.intersectionRatio);if(visible.length)show(slides.indexOf(visible[0].target));},{rootMargin:'-5% 0px -55% 0px',threshold:[0,.2,.5]});
 slides.forEach(s=>observer.observe(s));
}
document.querySelectorAll('[data-copy]').forEach(button=>button.addEventListener('click',async()=>{
 const value=document.getElementById(button.dataset.copy).textContent;
 const status=button.parentElement.querySelector('.copy-status');
 try{await navigator.clipboard.writeText(value);status.textContent='已复制';}catch{status.textContent='请选中上方文字手动复制';}
}));
