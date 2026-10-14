export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function identity(request) {
  const existing = request.headers.get('Cookie')?.match(/(?:^|;\s*)course_visitor=([a-f0-9-]{36})(?:;|$)/)?.[1];
  const visitor = existing || crypto.randomUUID();
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return { visitor, cookie: `course_visitor=${visitor}; Path=/; Max-Age=7776000; HttpOnly; SameSite=Lax${secure}` };
}
export function reply(data, id, status = 200) {
  return Response.json(data, {status, headers: {
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(id ? {'Set-Cookie': id.cookie} : {})
  }});
}
export function checkWrite(request) {
  if (request.headers.get('Origin') !== new URL(request.url).origin) throw new HttpError(403, '请从课程页面提交。');
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new HttpError(415, '提交格式应为 JSON。');
}
export async function readJSON(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, '提交内容为空。');
  const chunks = []; let length = 0;
  for (;;) {
    const {done, value} = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > 8192) { await reader.cancel(); throw new HttpError(413, '提交内容太长。'); }
    chunks.push(value);
  }
  const data = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) {data.set(chunk, offset); offset += chunk.byteLength;}
  try {
    const value = JSON.parse(new TextDecoder().decode(data));
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
    return value;
  } catch { throw new HttpError(400, '提交内容格式不正确。'); }
}
export function text(value, name, max, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string') throw new HttpError(400, `${name}格式不正确。`);
  const result = value.trim();
  if ((required && !result) || result.length > max) throw new HttpError(400, `${name}请填写${required ? '1' : '0'}至${max}个字符。`);
  return result;
}
export async function rateLimit(db, request, category, max) {
  const minute = Math.floor(Date.now() / 60000);
  const salt = await db.prepare("SELECT value FROM settings WHERE key='rate_salt'").first('value');
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${ip}:${category}:${minute}`));
  const key = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  const row = await db.prepare('INSERT INTO request_rates(key,count,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count')
    .bind(key, minute + 2).first();
  if (row.count > max) throw new HttpError(429, '提交较频繁，请稍后再试。');
  await db.prepare('DELETE FROM request_rates WHERE expires < ?').bind(minute).run();
}
export function dayUTC8() {return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);}
export function failure(error) {
  return reply({error: error instanceof HttpError ? error.message : '服务暂时不可用，请稍后再试。'}, null, error instanceof HttpError ? error.status : 503);
}
