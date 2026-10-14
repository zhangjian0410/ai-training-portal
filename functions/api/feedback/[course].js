import catalog from '../../../src/courses.json';
import {HttpError, identity, reply, checkWrite, readJSON, text, rateLimit, failure} from '../../_shared.js';

async function feedback(db, course, visitor) {
  const [counts, mine, comments] = await Promise.all([
    db.prepare('SELECT kind, COUNT(*) AS count FROM reactions WHERE course_id=? GROUP BY kind').bind(course).all(),
    db.prepare('SELECT kind FROM reactions WHERE course_id=? AND visitor=?').bind(course, visitor).first('kind'),
    // Contact is private: deliberately absent from every public response.
    db.prepare('SELECT id, name, body, created_at FROM comments WHERE course_id=? ORDER BY created_at DESC LIMIT 30').bind(course).all()
  ]);
  const reactions = {like: 0, brick: 0};
  for (const row of counts.results) reactions[row.kind] = row.count;
  return {reactions, mine: mine || null, comments: comments.results};
}
export async function onRequest({request, env, params}) {
  try {
    const course = params.course;
    if (!catalog.courses.some(item => item.id === course)) throw new HttpError(404, '课程不存在。');
    if (!env.COURSE_DB) throw new Error('Missing database binding');
    const id = identity(request); const db = env.COURSE_DB;
    if (request.method === 'GET') return reply(await feedback(db, course, id.visitor), id);
    if (request.method !== 'POST') throw new HttpError(405, '不支持此请求。');
    checkWrite(request);
    const input = await readJSON(request);
    if (input.action === 'reaction') {
      if (![null, 'like', 'brick'].includes(input.kind)) throw new HttpError(400, '请选择点赞或拍砖。');
      await rateLimit(db, request, 'reaction', 30);
      if (input.kind === null) await db.prepare('DELETE FROM reactions WHERE course_id=? AND visitor=?').bind(course, id.visitor).run();
      else await db.prepare('INSERT INTO reactions(course_id,visitor,kind) VALUES (?,?,?) ON CONFLICT(course_id,visitor) DO UPDATE SET kind=excluded.kind')
        .bind(course, id.visitor, input.kind).run();
    } else if (input.action === 'comment') {
      const body = text(input.body, '留言', 1000, true);
      const name = text(input.name, '称呼', 40);
      const contact = text(input.contact, '联系方式', 200);
      if (typeof input.event !== 'string' || !/^[a-f0-9-]{36}$/.test(input.event)) throw new HttpError(400, '留言编号格式不正确。');
      await rateLimit(db, request, 'comment', 5);
      await db.prepare('INSERT OR IGNORE INTO comments(id,course_id,name,contact,body,created_at) VALUES (?,?,?,?,?,?)')
        .bind(input.event, course, name, contact, body, new Date().toISOString()).run();
    } else throw new HttpError(400, '提交操作不正确。');
    return reply(await feedback(db, course, id.visitor), id);
  } catch (error) {return failure(error);}
}
