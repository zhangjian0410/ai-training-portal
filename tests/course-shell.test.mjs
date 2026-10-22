import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
import {applyCourseShell,courseHeader,coursePath} from '../scripts/course-shell.mjs';
const root=path.resolve(import.meta.dirname,'..');const catalog=JSON.parse(await fs.readFile(root+'/src/courses.json','utf8'));
test('all assembled courses share navigation, tokens, playback and reachable next steps',async()=>{
 for(const c of catalog.courses){
  for(const page of ['index.html','deep.html','self-review.html','poster.html',...(c.practice.startsWith('practice.')?['practice.html']:[]),...(c.ui.advanced?['advanced.html']:[])]){
   const html=await fs.readFile(`${root}/dist/courses/${c.id}/${page}`,'utf8');
   assert.ok(html.includes('src="/course-shell.js?v='));assert.ok(html.includes('href="/ui-tokens.css?v='));
   const header=html.match(/<header[\s\S]*?<\/header>/)[0];
   for(const label of ['课程目录','看课件','动手做','深入阅读','学习资料'])assert.ok(header.includes(label));
   const labels=[...header.matchAll(/data-course-nav="([^"]+)"/g)].map(m=>m[1]);assert.deepEqual(labels,c.ui.advanced?['slides','practice','reading','advanced']:['slides','practice','reading']);
   if(page==='index.html'){assert.ok(html.includes('src="/course-player.js?v='));assert.ok(html.includes('data-course-end hidden'));assert.ok(html.includes('class="deck-next-action"'));assert.ok(!html.includes('src="app.js"'));}
   if(page==='self-review.html')assert.ok(html.includes('交流与反馈'));
  }
 }
 const first=await fs.readFile(root+'/dist/courses/skill-engineering/index.html','utf8');assert.ok(first.includes('下一门课：第一个 AI Agent'));
 const lastCourse=catalog.courses.at(-1);const last=await fs.readFile(root+'/dist/courses/'+lastCourse.id+'/self-review.html','utf8');assert.ok(last.includes('/#course-requests'));
 for(let i=0;i<catalog.courses.length-1;i++){const html=await fs.readFile(root+'/dist/courses/'+catalog.courses[i].id+'/practice.html','utf8');assert.ok(html.includes('下一门课：'+catalog.courses[i+1].ui.shortTitle));}
 for(const file of ['ui-tokens.css','course-shell.css','course-shell.js','course-player.js'])assert.equal(await fs.readFile(root+'/src/'+file,'utf8'),await fs.readFile(root+'/dist/'+file,'utf8'));
});
test('missing headers and unsafe new-course routes fail build instead of silently losing shared UI',()=>{
 assert.throws(()=>applyCourseShell('<main></main>',catalog.courses[0],'index.html',null,'test'),/Missing adaptable/);
 for(const bad of ['https://example.com','../x','/absolute',''])assert.throws(()=>coursePath(catalog.courses[0],bad),/Invalid/);
 assert.throws(()=>courseHeader({id:'test'},'index.html'),/metadata/);
});
