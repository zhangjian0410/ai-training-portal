import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
const root=path.resolve(import.meta.dirname,'..');
const legacy=process.env.LEGACY_SOURCE_DIR;
const base='http://127.0.0.1:8792';
const cli=['--yes','wrangler@4.149.0'];
const env={...process.env,WRANGLER_SEND_METRICS:'false'};
const visitor='11111111-1111-4111-8111-111111111111';
const cookie='course_visitor='+visitor;
const state=await fs.mkdtemp(path.join(os.tmpdir(),'portal-handoff-'));
const evidence=process.env.HANDOFF_TEST_EVIDENCE_DIR||state;
await fs.mkdir(evidence,{recursive:true});
let logs='';const servers=[];const receipts=[];
async function sql(command){const r=await execute('npx',[...cli,'d1','execute','COURSE_DB','--local','--persist-to',state,'--command',command,'--json'],{cwd:root,env});return JSON.parse(r.stdout)[0].results;}
async function start(cwd,port,args=[]){
 const p=spawn('npx',[...cli,'pages','dev','dist','--port',String(port),'--persist-to',state,...args],{cwd,env,detached:true,stdio:['ignore','pipe','pipe']});servers.push(p);
 p.stdout.on('data',d=>logs+=d);p.stderr.on('data',d=>logs+=d);
 for(let i=0;i<120;i++){
  if(p.exitCode!==null)throw Error(logs);
  try{const r=await fetch('http://127.0.0.1:'+port+'/',{redirect:'manual'});if(r.status<500)return;}catch{}
  await new Promise(r=>setTimeout(r,500));
 }throw Error('Local server not ready: '+logs);
}
async function request(route,headers={}){const r=await fetch(base+route,{headers,redirect:'manual'});receipts.push({route,status:r.status,location:r.headers.get('location'),cookie:!!r.headers.get('set-cookie')});return r;}
async function ticket(token,expires=Date.now()+120000){const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');await sql(`INSERT INTO visitor_transfers VALUES ('${hash}','${visitor}',${expires});`);}
test('real D1 handoff is single-use, bounded, preserves data and old browser identity',async()=>{
 try{
  for(const file of ['0001_course_interactions.sql','0002_visitor_handoff.sql','0003_comment_replies.sql'])await execute('npx',[...cli,'d1','execute','COURSE_DB','--local','--persist-to',state,'--file','migrations/'+file],{cwd:root,env});
  await sql(`INSERT INTO reactions VALUES ('skill-engineering','${visitor}','like'); INSERT INTO comments VALUES ('seed','skill-engineering','已有昵称','private@example.invalid','已有留言','2026-10-13T00:00:00Z'); INSERT INTO page_events VALUES ('seed','courses','${visitor}','2026-10-14');`);
  await start(root,8792);
  const token=crypto.randomUUID();await ticket(token);
  const route='/__handoff?'+new URLSearchParams({token,next:'/courses/skill-engineering/deep?from=old'});
  let r=await request(route);assert.equal(r.status,302);assert.equal(r.headers.get('location'),'/courses/skill-engineering/deep?from=old');assert.ok(r.headers.get('set-cookie').startsWith(cookie+';'));assert.match(r.headers.get('set-cookie'),/HttpOnly; SameSite=Lax/);assert.equal(r.headers.get('referrer-policy'),'no-referrer');
  r=await request(route);assert.equal(r.headers.get('set-cookie'),null,'one-use ticket cannot be replayed');
  const expired=crypto.randomUUID();await ticket(expired,Date.now()-1000);assert.equal((await request('/__handoff?token='+expired)).headers.get('set-cookie'),null);
  const existing=crypto.randomUUID();await ticket(existing);assert.equal((await request('/__handoff?token='+existing,{Cookie:'course_visitor=22222222-2222-4222-8222-222222222222'})).headers.get('set-cookie'),null,'established Portal identity has priority');
  for(const next of ['https://evil.invalid/','//evil.invalid/','/api/metrics','/courses/unknown/deep','http://['])assert.equal((await request('/__handoff?next='+encodeURIComponent(next))).headers.get('location'),'/');
  assert.equal((await fetch(base+'/__handoff',{method:'POST'})).status,405);
  let feedback=await fetch(base+'/api/feedback/skill-engineering',{headers:{Cookie:cookie}}).then(r=>r.json());assert.equal(feedback.mine,'like');assert.equal(feedback.comments[0].body,'已有留言');assert.equal(JSON.stringify(feedback).includes('private@example.invalid'),false);
  let metrics=await fetch(base+'/api/metrics',{method:'POST',headers:{Cookie:cookie,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({page:'courses',event:crypto.randomUUID()})}).then(r=>r.json());assert.deepEqual(metrics.total,{pv:2,uv:1});
  if(legacy){
   await start(legacy,8793,['--binding','PORTAL_ORIGIN='+base]);
   const routes={'/':'/courses/skill-engineering/','/courses':'/','/deep':'/courses/skill-engineering/deep','/self-review.html':'/courses/skill-engineering/self-review','/poster':'/courses/skill-engineering/poster'};
   for(const [old,next] of Object.entries(routes)){let response=await fetch('http://127.0.0.1:8793'+old,{redirect:'manual',headers:{Cookie:cookie}});const location=new URL(response.headers.get('location'));assert.equal(location.origin,base);assert.equal(location.pathname,'/__handoff');assert.equal(location.searchParams.get('next'),next);const target=await fetch(location,{redirect:'manual'});assert.equal(target.headers.get('location'),next);assert.ok(target.headers.get('set-cookie').startsWith(cookie+';'));}
   const stopped=await fetch('http://127.0.0.1:8793/api/metrics',{method:'POST'});assert.equal(stopped.status,409);
  }
  assert.equal((await sql('SELECT contact FROM comments;'))[0].contact,'private@example.invalid');
  console.log('PASS single-use/expiry/redirect constraints, same historical D1 data and UV; legacy bridge '+(legacy?'PASS':'not selected'));
 }finally{
  for(const p of servers){if(p.exitCode===null)try{process.kill(-p.pid,'SIGTERM');}catch{} }
  await fs.writeFile(path.join(evidence,'handoff-server.log'),logs);await fs.writeFile(path.join(evidence,'handoff-receipts.json'),JSON.stringify(receipts,null,2)+'\n');
 }
});
