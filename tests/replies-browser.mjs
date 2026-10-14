import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {chromium} from 'playwright';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const base=process.env.COURSE_TEST_URL||'http://127.0.0.1:8796/';assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname),'Synthetic replies only local');
const out=process.env.COURSE_TEST_EVIDENCE_DIR;assert.ok(out);await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});const checks=[];
try{
 const context=await browser.newContext({viewport:{width:1440,height:1050}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'courses/skill-engineering/deep#course-feedback');await page.locator('[data-feedback-status]').filter({hasText:'无需登录'}).waitFor();
 const parent=page.locator('[data-comment-id="browser-root"]');await parent.getByRole('button',{name:'回复',exact:true}).click();
 await page.locator('#reply-body').fill('<script>window.replyInjected=1</script> 本地回复：补充边界说明。');await page.locator('#reply-name').fill('测试回复者');await page.locator('#reply-contact').fill('private-reply-browser@example.invalid');
 // A failed response after the server writes models an ambiguous network retry.
 let discarded=false;await page.route('**/api/feedback/skill-engineering',async route=>{const input=route.request().postDataJSON();if(input?.action==='reply'&&!discarded){discarded=true;await route.fetch();await route.abort();}else await route.continue();});
 await page.getByRole('button',{name:'发布回复',exact:true}).click();await page.locator('[data-reply-status]').filter({hasText:'网络连接暂时不可用'}).waitFor();
 assert.ok((await page.locator('#reply-body').inputValue()).includes('本地回复'));
 // Unrelated reaction rerender retains the pending reply form and draft.
 await page.locator('[data-reaction="like"]').click();await page.locator('[data-feedback-status]').filter({hasText:'已保存'}).waitFor();assert.ok((await page.locator('#reply-body').inputValue()).includes('本地回复'));
 await page.getByRole('button',{name:'发布回复',exact:true}).click();await page.locator('[data-feedback-status]').filter({hasText:'已回复'}).waitFor();
 await page.unroute('**/api/feedback/skill-engineering');
 assert.equal(await parent.locator('.reply-list li').count(),1);assert.equal(await parent.locator('script').count(),0);assert.equal(await page.evaluate(()=>window.replyInjected),undefined);assert.equal((await page.content()).includes('private-reply-browser@example.invalid'),false);
 const response=await page.request.get(base+'api/feedback/skill-engineering');const data=await response.json();assert.equal(data.comments.find(c=>c.id==='browser-root').reply_count,1);
 await page.screenshot({path:out+'/replies-desktop.png',fullPage:false});checks.push('inline target, persisted reply, private contact, plain text, lost-response retry without duplicate and draft through reaction PASS');
 const other=await browser.newPage({viewport:{width:390,height:844}});await other.goto(base+'courses/skill-engineering/index.html#course-feedback');await other.locator('[data-feedback-status]').filter({hasText:'无需登录'}).waitFor();assert.ok((await other.locator('[data-comment-id="browser-root"] .reply-list').textContent()).includes('本地回复'));
 const mobileParent=other.locator('[data-comment-id="browser-root"]');await mobileParent.getByRole('button',{name:'回复',exact:true}).click();await other.locator('#reply-body').fill('手机草稿');await other.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await other.locator('#reply-editor').isVisible(),false);await mobileParent.getByRole('button',{name:'回复',exact:true}).click();assert.equal(await other.locator('#reply-body').inputValue(),'手机草稿');assert.ok(await other.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await other.getByRole('button',{name:'发布回复',exact:true}).scrollIntoViewIfNeeded();await other.mouse.wheel(0,200);await other.waitForFunction(()=>{const button=document.querySelector('#reply-editor button[type=submit]').getBoundingClientRect();const bar=document.querySelector('.deck-controls').getBoundingClientRect();return button.bottom<=bar.top;});const buttonBox=await other.getByRole('button',{name:'发布回复',exact:true}).boundingBox();const barBox=await other.locator('.deck-controls').boundingBox();assert.ok(buttonBox.y+buttonBox.height<=barBox.y,'reply submit scrolls above fixed slide navigation');await other.screenshot({path:out+'/replies-mobile.png'});
 checks.push('course/Deep shared reply, mobile width and fixed navigation, cancel and reopen draft PASS');
 await page.reload();await page.locator('[data-feedback-status]').filter({hasText:'无需登录'}).waitFor();
 const paged=page.locator('[data-comment-id="browser-paged"]');assert.equal(await paged.locator('.reply-list li').count(),10);await paged.getByRole('button',{name:'查看更早回复',exact:true}).click();await page.locator('[data-feedback-status]').filter({hasText:'更早回复已展开'}).waitFor();assert.equal(await paged.locator('.reply-list li').count(),30);await paged.getByRole('button',{name:'查看更早回复',exact:true}).click();await page.locator('[data-feedback-status]').filter({hasText:'更早回复已展开'}).waitFor();assert.equal(await paged.locator('.reply-list li').count(),35);assert.equal(await paged.getByRole('button',{name:'查看更早回复',exact:true}).count(),0);
 checks.push('35 replies expandable in chronological cursor pages PASS');assert.deepEqual(errors,[]);await fs.writeFile(out+'/checks.json',JSON.stringify({base,checks,errors},null,2)+'\n');console.log(checks.join('\n'));
 const state=process.env.REPLIES_BROWSER_STATE;assert.ok(state,'Dynamic pagination regression requires the local development database path');
 const insert=Array.from({length:11},(_,n)=>`INSERT INTO comment_replies VALUES ('dynamic-${String(n+10).padStart(2,'0')}','browser-dynamic','','','动态回复${n+10}','2026-10-14T12:01:00Z');`).join('');
 await promisify(execFile)('npx',['--yes','wrangler@4.149.0','d1','execute','COURSE_DB','--local','--persist-to',state,'--command',insert],{cwd:new URL('..',import.meta.url),env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
 const dynamic=page.locator('[data-comment-id="browser-dynamic"]');await page.locator('[data-reaction="like"]').click();await page.locator('[data-feedback-status]').filter({hasText:/已保存|已取消/}).waitFor();
 assert.equal(await dynamic.locator('.reply-list li').count(),10);await dynamic.getByRole('button',{name:'查看更早回复',exact:true}).click();await page.locator('[data-feedback-status]').filter({hasText:'更早回复已展开'}).waitFor();
 assert.equal(await dynamic.locator('.reply-list li').count(),21);assert.ok((await dynamic.locator('.reply-list').textContent()).includes('动态回复10'));
 checks.push('11 new replies between cached snapshots do not create a pagination gap PASS');assert.deepEqual(errors,[]);await fs.writeFile(out+'/checks.json',JSON.stringify({base,checks,errors},null,2)+'\n');console.log(checks.at(-1));
}finally{await browser.close();}
