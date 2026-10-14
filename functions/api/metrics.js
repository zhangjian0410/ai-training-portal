import catalog from '../../src/courses.json';
import {HttpError, identity, reply, checkWrite, readJSON, rateLimit, dayUTC8, failure} from '../_shared.js';

async function metrics(db, day) {
  const [total, today] = await Promise.all([
    db.prepare('SELECT pv,uv FROM metrics_totals WHERE id=1').first(),
    db.prepare('SELECT pv,uv FROM metrics_daily WHERE day=?').bind(day).first()
  ]);
  return {day, timezone: 'UTC+8', total, today: today || {pv: 0, uv: 0}};
}
export async function onRequest({request, env}) {
  try {
    if (!env.COURSE_DB) throw new Error('Missing database binding');
    const db = env.COURSE_DB; const id = identity(request); const day = dayUTC8();
    if (request.method === 'GET') return reply(await metrics(db, day), id);
    if (request.method !== 'POST') throw new HttpError(405, '不支持此请求。');
    checkWrite(request);
    const input = await readJSON(request);
    const pages = ['courses', ...catalog.courses.flatMap(course => ['slides','deep','poster','self-review'].map(page => `${course.id}:${page}`))];
    if (!pages.includes(input.page) || typeof input.event !== 'string' || !/^[a-f0-9-]{36}$/.test(input.event)) throw new HttpError(400, '访问记录格式不正确。');
    await rateLimit(db, request, 'metrics', 300);
    await db.prepare('INSERT OR IGNORE INTO page_events(id,page,visitor,day) VALUES (?,?,?,?)').bind(input.event, input.page, id.visitor, day).run();
    // Event IDs retain one week of retry protection; aggregate counts remain intact.
    const cutoff = new Date(Date.now() + 8 * 3600000 - 7 * 86400000).toISOString().slice(0, 10);
    await db.prepare('DELETE FROM page_events WHERE day < ?').bind(cutoff).run();
    return reply(await metrics(db, day), id);
  } catch (error) {return failure(error);}
}
