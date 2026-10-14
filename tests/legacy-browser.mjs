import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
const legacy=process.env.LEGACY_TEST_URL||'http://localhost:8795';
const portal=process.env.PORTAL_TEST_URL||'http://127.0.0.1:8794';
for(const base of [legacy,portal])assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const out=process.env.COURSE_TEST_EVIDENCE_DIR;
assert.ok(out);await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
const checks=[];
try{
 const visitor='33333333-3333-4333-8333-333333333333';
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.addCookies([{name:'course_visitor',value:visitor,url:legacy,httpOnly:true,sameSite:'Lax'}]);
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const before=await fetch(portal+'/api/metrics').then(r=>r.json());
 await page.goto(legacy+'/deep#verification-prep');
 await page.locator('[data-feedback-status]').filter({hasText:'无需登录'}).waitFor();
 assert.equal(new URL(page.url()).origin,portal);assert.equal(new URL(page.url()).pathname,'/courses/skill-engineering/deep');assert.equal(new URL(page.url()).hash,'#verification-prep');assert.equal(new URL(page.url()).search,'');
 assert.equal((await context.cookies(portal)).find(c=>c.name==='course_visitor').value,visitor);
 const after=await fetch(portal+'/api/metrics').then(r=>r.json());assert.equal(after.total.uv,before.total.uv);assert.equal(after.total.pv,before.total.pv+1);
 checks.push('old browser cookie migrates across hosts, does not add lifetime UV; Deep hash and clean final URL PASS');
 await page.goto(legacy+'/#slide-07');assert.equal(new URL(page.url()).hash,'#slide-07');assert.equal(await page.locator('.slide.active').getAttribute('id'),'slide-07');
 assert.equal(await page.locator('.slide').count(),10);
 await page.getByLabel('课件资源').getByRole('link',{name:'课程首页',exact:true}).click();await page.waitForURL(portal+'/');assert.equal(await page.locator('.course-row').count(),1);
 await page.screenshot({path:path.join(out,'portal-desktop.png'),fullPage:true});
 for(const route of ['/self-review','/poster','/courses']){await page.goto(legacy+route);assert.equal(new URL(page.url()).origin,portal);}
 assert.deepEqual(errors,[]);checks.push('legacy slide hash, all 10 pages, shared home and legacy review/poster/directory PASS');
 await fs.writeFile(path.join(out,'legacy-checks.json'),JSON.stringify({legacy,portal,checks,errors},null,2)+'\n');console.log(checks.join('\n'));
}finally{await browser.close();}
