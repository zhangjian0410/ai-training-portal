const links=[...document.querySelectorAll('[data-course-nav]')];
function markLocation(){
 const samePath=link=>new URL(link.href).pathname.replace(/\.html$/,'').replace(/\/index$/,'/')===location.pathname.replace(/\.html$/,'').replace(/\/index$/,'/');
 const practice=links.find(a=>a.dataset.courseNav==='practice');
 const reading=links.find(a=>a.dataset.courseNav==='reading');
 if(practice&&reading&&new URL(practice.href).pathname===new URL(reading.href).pathname&&samePath(practice)&&new URL(practice.href).hash){
  const inPractice=location.hash===new URL(practice.href).hash;
  for(const link of links.filter(a=>['reading','practice'].includes(a.dataset.courseNav))){if((link.dataset.courseNav==='practice')===inPractice)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');}
 }
}
markLocation();addEventListener('hashchange',markLocation);
const menu=document.querySelector('.course-resources');
if(menu){
 document.addEventListener('click',event=>{if(!menu.contains(event.target))menu.open=false;});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'&&menu.open){menu.open=false;menu.querySelector('summary').focus();}});
}
