import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
const dist=path.resolve(import.meta.dirname,'../dist');const pages=new Map();
async function scan(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);if(entry.isDirectory())await scan(p);else if(p.endsWith('.html')){const html=await fs.readFile(p,'utf8');const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size,p);assert.ok(!html.includes('{{'));pages.set(path.relative(dist,p),{html,ids:new Set(ids)});}}}
await scan(dist);let links=0;
for(const [name,{html}] of pages){for(const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)){
 const url=new URL(match[1].replaceAll('&amp;','&'),'https://portal.invalid/'+name);if(url.origin!=='https://portal.invalid')continue;
 let file=decodeURIComponent(url.pathname).slice(1);if(!file||file.endsWith('/'))file+='index.html';
 const resolved=path.resolve(dist,file);assert.ok(resolved.startsWith(dist+path.sep));assert.ok((await fs.stat(resolved)).isFile(),`${name}: ${file}`);
 if(url.hash)assert.ok(pages.get(file)?.ids.has(decodeURIComponent(url.hash.slice(1))),`${file}${url.hash}`);links++;
}}
assert.ok(pages.has('index.html'));
const catalog=JSON.parse(await fs.readFile(path.resolve(import.meta.dirname,'../src/courses.json'),'utf8'));
for(const course of catalog.courses)assert.ok(pages.has('courses/'+course.id+'/index.html'));
assert.ok(pages.get('index.html').html.includes('从普通 Chat 开始四步实践'));
assert.ok(pages.get('index.html').html.includes('观察调用、执行和结果反馈'));
console.log(`PASS ${pages.size} pages, ${links} same-origin links and existing anchors.`);
