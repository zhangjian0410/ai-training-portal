// End-to-end writes are restricted to an isolated local D1 database.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {chromium} from 'playwright';
const root=path.resolve(import.meta.dirname,'..');
const out=process.env.COMMUNITY_BROWSER_EVIDENCE_DIR||await fs.mkdtemp(path.join(os.tmpdir(),'course-discussion-'));
await fs.mkdir(out,{recursive:true});
const state=await fs.mkdtemp(path.join(out,'state-'));
const env={...process.env,WRANGLER_SEND_METRICS:'false'};
const cli=['--yes','wrangler@4.149.0'];const exec=promisify(execFile);
const base='http://127.0.0.1:8796/';let server,browser,log='';const checks=[];
async function sql(command){return exec('npx',[...cli,'d1','execute','COURSE_DB','--local','--persist-to',state,'--command',command],{cwd:root,env});}
try{
 for(const name of (await fs.readdir(path.join(root,'migrations'))).filter(n=>n.endsWith('.sql')).sort())await exec('npx',[...cli,'d1','execute','COURSE_DB','--local','--persist-to',state,'--file','migrations/'+name],{cwd:root,env});
 await sql("INSERT INTO comments VALUES ('conversation-root','skill-engineering','同事','','Skill 可以处理哪些任务？','2026-10-15T00:00:00Z');INSERT INTO comment_replies VALUES ('teacher-reply','conversation-root','讲师','','可以先从重复的工单日报开始。','2026-10-15T00:01:00Z');");
 await sql(['browser-root','browser-paged','browser-dynamic'].map(id=>`INSERT INTO comments VALUES ('${id}','skill-engineering','本地测试','','分页回归问题','2026-10-14T12:00:00Z');`).join('')+
  Array.from({length:35},(_,i)=>`INSERT INTO comment_replies VALUES ('paged-${String(i).padStart(2,'0')}','browser-paged','','','分页回复${i}','2026-10-14T12:01:00Z');`).join('')+
  Array.from({length:10},(_,i)=>`INSERT INTO comment_replies VALUES ('dynamic-${String(i).padStart(2,'0')}','browser-dynamic','','','动态回复${i}','2026-10-14T12:01:00Z');`).join(''));
 server=spawn('npx',[...cli,'pages','dev','dist','--port','8796','--persist-to',state],{cwd:root,env,detached:true,stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',b=>log+=b);server.stderr.on('data',b=>log+=b);
 let ready=false;for(let i=0;i<120;i++){try{if((await fetch(base+'api/metrics')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}assert.ok(ready,log);
 browser=await chromium.launch({headless:true});const errors=[];
 const one=await browser.newContext({viewport:{width:1440,height:1050}});const page=await one.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'courses/skill-engineering/deep.html#course-feedback');await page.locator('[data-feedback-status]').filter({hasText:'无需登录'}).waitFor();
 const thread=page.locator('[data-comment-id="conversation-root"]');
 await thread.locator('.reply-list').getByRole('button',{name:'继续回复',exact:true}).click();
 await page.locator('#reply-body').fill('那需要接入系统吗？');
 await page.getByRole('button',{name:'发布回复',exact:true}).click();await page.locator('[data-feedback-status]').filter({hasText:'已回复'}).waitFor();
 assert.equal(await thread.locator('.reply-list li').count(),2);
 const two=await browser.newContext({viewport:{width:390,height:844}});const other=await two.newPage();other.on('pageerror',e=>errors.push(e.message));
 await other.goto(base+'courses/skill-engineering/index.html#course-feedback');await other.locator('[data-feedback-status]').filter({hasText:'无需登录'}).waitFor();
 const theirs=other.locator('[data-comment-id="conversation-root"]');assert.ok((await theirs.textContent()).includes('那需要接入系统吗？'));
 await theirs.locator('.reply-list').getByRole('button',{name:'继续回复',exact:true}).last().click();
 await other.locator('#reply-body').fill('也可以先使用导出的文件。');await other.locator('#reply-name').fill('讲师');
 await other.getByRole('button',{name:'发布回复',exact:true}).click();await other.locator('[data-feedback-status]').filter({hasText:'已回复'}).waitFor();
 assert.equal(await theirs.locator('.reply-list li').count(),3);assert.ok(await other.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await other.screenshot({path:out+'/conversation-mobile.png'});checks.push('colleague → lecturer → colleague → lecturer in one persisted chronological discussion; desktop/Deep/mobile/course shared PASS');
 await page.goto(base);await page.getByRole('link',{name:'想学什么',exact:true}).click();await page.locator('[data-feedback-status]').filter({hasText:'无需登录'}).waitFor();
 const suggestion='<img src=x onerror=alert(1)> 想学客户会议纪要与待办。';
 await page.locator('#comment-body').fill(suggestion);await page.locator('#comment-contact').fill('private-request-browser@example.invalid');
 await page.getByRole('button',{name:'发布课程建议',exact:true}).click();await page.locator('[data-feedback-status]').filter({hasText:'留言已发布'}).waitFor();
 assert.ok((await page.locator('[data-comments]').textContent()).includes(suggestion));assert.equal(await page.locator('[data-comments] img').count(),0);
 assert.equal((await page.content()).includes('private-request-browser@example.invalid'),false);
 const requests=await page.request.get(base+'api/feedback/course-requests').then(r=>r.json());const requestId=requests.comments[0].id;assert.equal(requests.comments[0].name,'');
 assert.equal(JSON.stringify(requests).includes('private-request-browser@example.invalid'),false);
 await other.goto(base+'#course-requests');await other.locator('[data-feedback-status]').filter({hasText:'无需登录'}).waitFor();
 const request=other.locator(`[data-comment-id="${requestId}"]`);assert.ok((await request.textContent()).includes(suggestion));await request.getByRole('button',{name:'回复',exact:true}).click();
 await other.locator('#reply-body').fill('还希望加入会后邮件跟进。');
 // Network failure must keep the message as a draft and report failure.
 await other.route('**/api/feedback/course-requests',r=>r.request().method()==='POST'?r.abort():r.continue());
 await other.getByRole('button',{name:'发布回复',exact:true}).click();await other.locator('[data-reply-status]').filter({hasText:'网络连接暂时不可用'}).waitFor();assert.equal(await other.locator('#reply-body').inputValue(),'还希望加入会后邮件跟进。');
 await other.unroute('**/api/feedback/course-requests');await other.getByRole('button',{name:'发布回复',exact:true}).click();await other.locator('[data-feedback-status]').filter({hasText:'已回复'}).waitFor();
 await page.reload();await page.locator('[data-feedback-status]').filter({hasText:'无需登录'}).waitFor();assert.ok((await page.locator('[data-comments]').textContent()).includes('会后邮件跟进'));
 const feedback=await page.request.get(base+'api/feedback/skill-engineering').then(r=>r.json());assert.equal(feedback.comments.some(c=>c.id===requestId),false);
 for(const width of [390,320]){await other.setViewportSize({width,height:844});assert.ok(await other.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await other.screenshot({path:out+'/requests-mobile.png'});await page.screenshot({path:out+'/requests-desktop.png',fullPage:true});
 checks.push('anonymous course suggestions, optional private contact, literal XSS, shared continuing discussion, separate course scope and failure draft/retry PASS');
 const regression=await exec(process.execPath,['tests/replies-browser.mjs'],{cwd:root,env:{...env,COURSE_TEST_URL:base,COURSE_TEST_EVIDENCE_DIR:path.resolve(out,'reply-regression'),REPLIES_BROWSER_STATE:state},maxBuffer:1024*1024});
 await fs.writeFile(out+'/reply-regression.log',regression.stdout+regression.stderr);
 checks.push('existing browser regressions: lost response retry, draft after reaction, mobile controls, 35-reply paging and dynamically added replies PASS');
 assert.deepEqual(errors,[]);await fs.writeFile(out+'/checks.json',JSON.stringify({base,state,checks,errors},null,2)+'\n');console.log(checks.join('\n'));
}finally{
 if(browser)await browser.close();
 if(server){const ended=new Promise(r=>server.once('exit',r));try{process.kill(-server.pid,'SIGTERM');}catch{}await Promise.race([ended,new Promise(r=>setTimeout(r,3000))]);if(server.exitCode===null&&server.signalCode===null){try{process.kill(-server.pid,'SIGKILL');}catch{}}}
 await fs.writeFile(out+'/worker.log',log);
}
