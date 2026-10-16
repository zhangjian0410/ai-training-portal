const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');import assert from 'node:assert/strict';import fs from 'node:fs/promises';
const base=(process.env.COURSE_TEST_URL||'http://127.0.0.1:8768').replace(/\/$/,'');const out=process.env.COURSE_TEST_EVIDENCE_DIR;assert.ok(out);await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch();const reports=[],errors=[];
try{
 for(const width of [1440,1024,390]){
 const p=await browser.newPage({viewport:{width,height:width===390?844:900}});await p.context().grantPermissions(['clipboard-read','clipboard-write']);p.on('pageerror',e=>errors.push(e.message));
 // Read-only presentation test, including production: disable shared feedback/metrics before any execution.
 await p.route('**/site-interactions.js',r=>r.fulfill({contentType:'application/javascript',body:''}));
 await p.goto(base+'/');assert.ok(await p.locator('body').evaluate(e=>e.scrollWidth<=innerWidth));await p.screenshot({path:out+`/portal-${width}.png`});
 for(const [id,count] of [['skill-engineering',11],['agentic-loop',16]]){
  const url=base+'/courses/'+id+'/';await p.goto(url+'index.html');
  assert.equal(await p.locator('.course-header nav > [data-course-nav]').count(),2);
  assert.ok(await p.locator('body').evaluate(e=>e.scrollWidth<=innerWidth));
  const tokens=await p.evaluate(()=>{let s=getComputedStyle(document.documentElement);return [s.getPropertyValue('--ui-color-action'),s.getPropertyValue('--ui-control-height')]});assert.deepEqual(tokens,['#1669db','44px']);
  await p.locator('.course-resources summary').click();assert.ok(await p.locator('.course-resources[open]').count());await p.keyboard.press('Escape');assert.equal(await p.locator('.course-resources[open]').count(),0);
  if(width>850){await p.locator('#fullscreen').click();await p.waitForFunction(()=>document.fullscreenElement);
   for(let i=0;i<count;i++){
    await p.waitForFunction(()=>{let e=document.querySelector('.lesson.active .fullscreen-preview');return e?.complete&&e.naturalWidth>0;});
    const sizes=await p.locator('.lesson.active').evaluate(el=>{let n=el.querySelector('.explanation'),s=el.querySelector('.slide').getBoundingClientRect();return {h:n.clientHeight,scroll:n.scrollHeight,ratio:s.width/s.height,bottom:document.querySelector('.deck-controls').getBoundingClientRect().bottom,screen:innerHeight}});
    assert.ok(sizes.scroll<=sizes.h+1,JSON.stringify({id,i,width,sizes}));assert.ok(Math.abs(sizes.ratio-16/9)<.01);assert.ok(sizes.bottom<=sizes.screen);
    if(i<count-1)await p.locator('#next').click();
   }
   assert.ok(await p.locator('#next').isHidden());assert.ok(await p.locator('.deck-next-action').isVisible());
   await p.screenshot({path:out+`/${id}-end-${width}.png`});await p.evaluate(()=>document.exitFullscreen());
   assert.ok(await p.locator('[data-course-end]').isVisible());await p.locator('#first').click();assert.ok(await p.locator('[data-course-end]').isHidden());await p.locator('#contents-toggle').click();assert.equal(await p.locator('#contents a').count(),count);await p.keyboard.press('Escape');
  }
  await p.locator('[data-course-nav="practice"]').click();await p.waitForLoadState();assert.equal(await p.locator('[data-course-nav="practice"]').getAttribute('aria-current'),id==='skill-engineering'?'location':'page');
  const copy=p.locator('[data-copy]').first();const details=copy.locator('xpath=ancestor::details');for(let n=0;n<await details.count();n++){const d=details.nth(n);if(!await d.getAttribute('open'))await d.locator(':scope > summary').click();}await copy.click();await p.getByText('已复制',{exact:true}).first().waitFor();
  assert.ok(await p.locator('body').evaluate(e=>e.scrollWidth<=innerWidth));await p.screenshot({path:out+`/${id}-practice-${width}.png`});
  await p.locator('.course-resources summary').click();await p.locator('[data-course-nav="reading"]').click();await p.waitForLoadState();assert.ok(await p.locator('[data-course-nav="reading"]').getAttribute('aria-current'));
  // Current optional section stays identifiable with the menu both closed and open.
  const menuMark=await p.locator('.course-resources summary').evaluate(e=>getComputedStyle(e).boxShadow);assert.notEqual(menuMark,'none');
  await p.locator('.course-resources summary').click();assert.notEqual(await p.locator('[data-course-nav="reading"]').evaluate(e=>getComputedStyle(e).boxShadow),'none');await p.keyboard.press('Escape');
  if(id==='skill-engineering'){await p.locator('.course-resources summary').click();await p.locator('[data-course-nav="review"]').click();await p.waitForURL(/\/self-review(?:\.html)?$/);}else{await p.locator('[data-course-nav="practice"]').click();await p.getByRole('link',{name:'完成检查',exact:true}).click();await p.locator('#done table').waitFor();assert.equal(await p.locator('#done tbody tr').count(),7);}await p.locator('.course-next').waitFor({state:'visible'});assert.ok(await p.locator('body').evaluate(e=>e.scrollWidth<=innerWidth));
  const control=await p.locator('.course-next .ui-primary').boundingBox();assert.ok(control.height>=44);
  reports.push({width,id,status:'PASS'});
 }
 await p.close();
 }
 assert.deepEqual(errors,[]);await fs.writeFile(out+'/browser.json',JSON.stringify({status:'PASS',reports,errors,noProductionWrites:true},null,2));console.log('PASS both courses: nav/resources/copy/end route;27slides fullscreen1440/1024 and390mobile');
}finally{await browser.close();}
