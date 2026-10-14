import catalog from '../src/courses.json';
import {identity} from './_shared.js';
const uuid=/^[a-f0-9-]{36}$/;
export function safeNext(value){
 let url;try{url=new URL(value||'/','https://portal.invalid');}catch{return '/';}
 const allowed=['/',...catalog.courses.flatMap(c=>['','index.html','deep','deep.html','self-review','self-review.html','poster','poster.html'].map(p=>'/courses/'+c.id+'/'+p))];
 return url.origin==='https://portal.invalid'&&allowed.includes(url.pathname)?url.pathname+url.search:'/';
}
export async function onRequest({request,env}){
 if(request.method!=='GET')return new Response('Method not allowed',{status:405});
 const url=new URL(request.url);const next=safeNext(url.searchParams.get('next'));
 const headers={'Location':next,'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
 const token=url.searchParams.get('token');
 if(uuid.test(token||'')&&env.COURSE_DB){
  try{
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');
   const visitor=await env.COURSE_DB.prepare('DELETE FROM visitor_transfers WHERE token_hash=? AND expires>=? RETURNING visitor').bind(hash,Date.now()).first('visitor');
   // A visitor already established on the canonical Portal keeps that identity.
   const existing=request.headers.get('Cookie')?.match(/(?:^|;\s*)course_visitor=([a-f0-9-]{36})(?:;|$)/)?.[1];
   if(uuid.test(visitor||'')&&!existing){const id=identity(new Request(request.url,{headers:{Cookie:'course_visitor='+visitor}}));headers['Set-Cookie']=id.cookie;}
  }catch{/* A temporary database outage must still let the course open. */}
 }
 return new Response(null,{status:302,headers});
}
