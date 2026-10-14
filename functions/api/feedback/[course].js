import catalog from '../../../src/courses.json';
import {HttpError, identity, reply, checkWrite, readJSON, text, rateLimit, failure} from '../../_shared.js';

async function feedback(db, course, visitor) {
  const [counts, mine, comments, replies] = await Promise.all([
    db.prepare('SELECT kind, COUNT(*) AS count FROM reactions WHERE course_id=? GROUP BY kind').bind(course).all(),
    db.prepare('SELECT kind FROM reactions WHERE course_id=? AND visitor=?').bind(course, visitor).first('kind'),
    // Contact is private: deliberately absent from every public response.
    db.prepare('SELECT id, name, body, created_at FROM comments WHERE course_id=? ORDER BY created_at DESC,id DESC LIMIT 30').bind(course).all(),
    db.prepare(`WITH roots AS (
      SELECT id FROM comments WHERE course_id=? ORDER BY created_at DESC,id DESC LIMIT 30
    ), ranked AS (
      SELECT r.id,r.comment_id,r.name,r.body,r.created_at,
        ROW_NUMBER() OVER (PARTITION BY r.comment_id ORDER BY r.created_at DESC,r.id DESC) AS position,
        COUNT(*) OVER (PARTITION BY r.comment_id) AS total
      FROM comment_replies r JOIN roots ON roots.id=r.comment_id
    ) SELECT id,comment_id,name,body,created_at,total FROM ranked
      WHERE position<=10 ORDER BY created_at,id`).bind(course).all()
  ]);
  const reactions = {like: 0, brick: 0};
  for (const row of counts.results) reactions[row.kind] = row.count;
  for (const comment of comments.results) {
    const rows = replies.results.filter(row => row.comment_id === comment.id);
    comment.reply_count = rows[0]?.total || 0;
    comment.replies = rows.map(({id, name, body, created_at}) => ({id, name, body, created_at}));
    comment.has_more_replies = comment.reply_count > rows.length;
    comment.reply_before = rows[0]?.id || null;
  }
  return {reactions, mine: mine || null, comments: comments.results};
}

async function threadPage(db, course, parent, before) {
  const found = await db.prepare('SELECT id FROM comments WHERE id=? AND course_id=?').bind(parent, course).first();
  if (!found) throw new HttpError(404, '原留言已不存在，请刷新页面。');
  let cursor = null;
  if (before) {
    cursor = await db.prepare('SELECT id,created_at FROM comment_replies WHERE id=? AND comment_id=?').bind(before, parent).first();
    if (!cursor) throw new HttpError(404, '回复位置已更新，请刷新页面。');
  }
  const statement = cursor
    ? db.prepare('SELECT id,name,body,created_at FROM comment_replies WHERE comment_id=? AND (created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT 21').bind(parent, cursor.created_at, cursor.created_at, cursor.id)
    : db.prepare('SELECT id,name,body,created_at FROM comment_replies WHERE comment_id=? ORDER BY created_at DESC,id DESC LIMIT 21').bind(parent);
  const rows = (await statement.all()).results;
  const page = rows.slice(0, 20).reverse();
  return {comment_id: parent, replies: page, has_more_replies: rows.length > 20, reply_before: page[0]?.id || null};
}

async function createReply(db, request, course, input) {
  const parent = text(input.parent_id, '原留言编号', 100, true);
  const body = text(input.body, '回复', 1000, true);
  const name = text(input.name, '称呼', 40);
  const contact = text(input.contact, '联系方式', 200);
  if (typeof input.event !== 'string' || !/^[a-f0-9-]{36}$/.test(input.event)) throw new HttpError(400, '回复编号格式不正确。');
  const found = await db.prepare('SELECT id FROM comments WHERE id=? AND course_id=?').bind(parent, course).first();
  if (!found) throw new HttpError(404, '原留言已不存在，请刷新页面。');
  const previous = await db.prepare('SELECT comment_id,name,body FROM comment_replies WHERE id=?').bind(input.event).first();
  if (previous) {
    // Private contact does not influence the public retry response or get overwritten.
    if (previous.comment_id !== parent || previous.name !== name || previous.body !== body) throw new HttpError(409, '回复编号已使用，请重新提交。');
    return;
  }
  // Root comments and replies share the existing per-IP write budget.
  await rateLimit(db, request, 'comment', 5);
  const result = await db.prepare(`INSERT OR IGNORE INTO comment_replies(id,comment_id,name,contact,body,created_at)
    SELECT ?,id,?,?,?,? FROM comments WHERE id=? AND course_id=?`)
    .bind(input.event, name, contact, body, new Date().toISOString(), parent, course).run();
  if (!result.meta.changes) {
    const saved = await db.prepare('SELECT comment_id,name,body FROM comment_replies WHERE id=?').bind(input.event).first();
    if (!saved) throw new HttpError(404, '原留言已不存在，请刷新页面。');
    if (saved.comment_id !== parent || saved.name !== name || saved.body !== body) throw new HttpError(409, '回复编号已使用，请重新提交。');
  }
}
export async function onRequest({request, env, params}) {
  try {
    const course = params.course;
    if (!catalog.courses.some(item => item.id === course)) throw new HttpError(404, '课程不存在。');
    if (!env.COURSE_DB) throw new Error('Missing database binding');
    const id = identity(request); const db = env.COURSE_DB;
    if (request.method === 'GET') {
      const query = new URL(request.url).searchParams;
      if (query.has('thread')) return reply(await threadPage(db, course, text(query.get('thread'), '原留言编号', 100, true), query.has('before') ? text(query.get('before'), '回复位置', 100, true) : null), id);
      return reply(await feedback(db, course, id.visitor), id);
    }
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
    } else if (input.action === 'reply') {
      await createReply(db, request, course, input);
    } else throw new HttpError(400, '提交操作不正确。');
    return reply(await feedback(db, course, id.visitor), id);
  } catch (error) {return failure(error);}
}
