import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {applyCourseShell} from './course-shell.mjs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const catalog=JSON.parse(await fs.readFile(path.join(root,'src/courses.json'),'utf8'));
const dist=path.join(root,'dist');
const e=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const ids=new Set();const builds=[];
const sharedAssets=['ui-tokens.css','course-shell.css','course-shell.js','course-player.js'];
const uiVersion=createHash('sha256').update((await Promise.all(sharedAssets.map(file=>fs.readFile(path.join(root,'src',file))))).map(b=>b.toString()).join('')).digest('hex').slice(0,16);
const localSources=JSON.parse(process.env.COURSE_SOURCE_DIRS||'{}');
await fs.rm(dist,{recursive:true,force:true});await fs.mkdir(dist,{recursive:true});
for(const course of catalog.courses){
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(course.id)||ids.has(course.id))throw new Error('Invalid/duplicate course ID');
 ids.add(course.id);
 if(!/^[\w.-]+\/[\w.-]+$/.test(course.repository)||!course.ref||course.ref.startsWith('-'))throw new Error('Invalid course source');
 let source;
 if(localSources[course.id])source=path.resolve(localSources[course.id]);
 else if(course.id==='skill-engineering'&&process.env.COURSE_SOURCE_DIR)source=path.resolve(process.env.COURSE_SOURCE_DIR);
 else{
  source=path.join(root,'build/sources',course.id);
  await fs.rm(source,{recursive:true,force:true});await fs.mkdir(path.dirname(source),{recursive:true});
  execFileSync('git',['clone','--depth','1','--branch',course.ref,'https://github.com/'+course.repository+'.git',source],{stdio:'inherit'});
 }
 if(process.env.SKIP_COURSE_BUILD!=='1')execFileSync('npm',['run','build'],{cwd:source,stdio:'inherit'});
 const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim();
 const destination=path.join(dist,'courses',course.id);
 await fs.cp(path.join(source,'dist'),destination,{recursive:true});
 for(const excluded of ['_routes.json','courses.html','site-interactions.js'])await fs.rm(path.join(destination,excluded),{force:true});
 for(const name of ['index.html','deep.html','practice.html','advanced.html','self-review.html','poster.html']){
  const file=path.join(destination,name);
  if(['practice.html','advanced.html'].includes(name) && !await fs.stat(file).catch(()=>null))continue;
  let html=await fs.readFile(file,'utf8');
  html=html.replaceAll('href="courses.html"','href="/"').replaceAll('src="site-interactions.js"','src="/site-interactions.js"');
  html=html.replace('</head>','<link rel="stylesheet" href="/community.css">\n</head>');
  html=applyCourseShell(html,course,name,catalog.courses[catalog.courses.indexOf(course)+1],uiVersion);
  await fs.writeFile(file,html);
 }
 builds.push({id:course.id,repository:course.repository,revision,path:'/courses/'+course.id+'/'});
}
const link=(course,key)=>'/courses/'+course.id+'/'+course[key];
const defaultRoute=course=>[
 {label:'看课件',description:'图解概念与方法',path:course.slides},
 {label:'做跟练',description:'从普通 Chat 开始四步实践',path:course.practice},
 {label:'自评 Skill',description:'定位已有实现的缺口',path:course.review},
 {label:'继续验证',description:'生成检查文件，运行并核对',path:course.reading+'#verification-prep'}
];
const sourcePath=(course,value)=>{
 if(typeof value!=='string'||!value||value.startsWith('/')||value.includes('..')||value.includes(':'))throw new Error('Invalid course resource path');
 return '/courses/'+course.id+'/'+value;
};
const rows=catalog.courses.map(course=>{
 const routes=course.routes||defaultRoute(course);
 const materials=course.materials||[{label:'在线查看原版海报',path:course.poster},{label:'深入阅读',path:course.reading}];
 return '<article class="course-row"><div class="course-summary"><p class="course-format">'+e(course.format)+'</p><h3>'+e(course.title)+'</h3><p>'+e(course.description)+'</p><p class="course-audience">'+e(course.audience)+'</p><a class="course-start" href="'+e(sourcePath(course,course.slides))+'">开始学习 →</a></div><nav class="learning-route" aria-label="'+e(course.title)+' 学习路线">'+routes.map(route=>'<a href="'+e(sourcePath(course,route.path))+'"><b>'+e(route.label)+'</b><span>'+e(route.description)+'</span></a>').join('')+'</nav><div class="course-materials"><strong>选读资料</strong>'+materials.map(item=>'<a href="'+e(sourcePath(course,item.path))+'">'+e(item.label)+'</a>').join('')+'<a href="/courses/'+e(course.id)+'/index.html#course-feedback">交流与反馈</a></div></article>';
}).join('');
let html=await fs.readFile(path.join(root,'src/courses-template.html'),'utf8');
html=html.replaceAll('{{SITE_TITLE}}',e(catalog.title)).replaceAll('{{SITE_DESCRIPTION}}',e(catalog.description)).replaceAll('{{COURSE_ROWS}}',rows).replaceAll('href="courses.html"','href="/"');
html=html.replace('</head>',`<link rel="stylesheet" href="/ui-tokens.css?v=${uiVersion}"><link rel="stylesheet" href="/course-shell.css?v=${uiVersion}"></head>`);
await fs.writeFile(path.join(dist,'index.html'),html);
for(const name of ['style.css','site-interactions.js','community.css',...sharedAssets])await fs.copyFile(path.join(root,'src',name),path.join(dist,name));
await fs.writeFile(path.join(dist,'_routes.json'),JSON.stringify({version:1,include:['/api/*','/__handoff'],exclude:[]},null,2)+'\n');
await fs.writeFile(path.join(dist,'_redirects'),'/courses / 302\n/courses.html / 302\n');
await fs.writeFile(path.join(dist,'build-info.json'),JSON.stringify({portalRevision:process.env.CF_PAGES_COMMIT_SHA||process.env.PORTAL_REVISION||'local',courses:builds,uiVersion},null,2)+'\n');
console.log('Built independent Portal and '+builds.length+' same-origin course(s).');
