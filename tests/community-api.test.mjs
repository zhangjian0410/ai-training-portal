import assert from 'node:assert/strict';
import test, {before, after} from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execute = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const out = process.env.COMMUNITY_TEST_EVIDENCE_DIR || await fs.mkdtemp(path.join(os.tmpdir(), 'course-api-'));
await fs.mkdir(out, {recursive: true});
const state = await fs.mkdtemp(path.join(out, 'state-'));
const base = 'http://127.0.0.1:8790';
const cli = ['--yes', 'wrangler@4.149.0'];
const environment = {...process.env, WRANGLER_SEND_METRICS: 'false'};
let server; let logs = '';
const receipts = [];

async function start() {
  server = spawn('npx', [...cli, 'pages', 'dev', 'dist', '--port', '8790', '--persist-to', state], {cwd: root, env: environment, detached: true, stdio: ['ignore', 'pipe', 'pipe']});
  server.stdout.on('data', data => {logs += data;}); server.stderr.on('data', data => {logs += data;});
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null) throw new Error(`Local worker exited: ${logs}`);
    try {const response = await fetch(base + '/api/metrics'); if (response.ok) return;}
    catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Worker did not become ready: ${logs}`);
}
async function stop() {
  if (!server || server.exitCode !== null) return;
  const child = server;
  const exited = new Promise(resolve => child.once('exit', resolve));
  process.kill(-child.pid, 'SIGTERM');
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]);
  if (child.exitCode === null && child.signalCode === null) process.kill(-child.pid, 'SIGKILL');
}
class Client {
  constructor(ip) {this.ip = ip; this.cookie = '';}
  async request(url, input, extra = {}) {
    const response = await fetch(base + url, {
      method: input ? 'POST' : 'GET',
      headers: {'Cookie': this.cookie, 'CF-Connecting-IP': this.ip, ...(input ? {'Content-Type': 'application/json', 'Origin': base} : {}), ...extra},
      ...(input ? {body: JSON.stringify(input)} : {})
    });
    const cookie = response.headers.get('Set-Cookie'); if (cookie) this.cookie = cookie.split(';')[0];
    const body = await response.json();
    receipts.push({url, method: input ? 'POST' : 'GET', status: response.status, body});
    return {status: response.status, body, headers: response.headers};
  }
}
const one = new Client('192.0.2.1');
const two = new Client('192.0.2.2');
const endpoint = '/api/feedback/skill-engineering';
const visit = (page = 'courses', event = crypto.randomUUID()) => ({page, event});
const comment = (body, extra = {}) => ({action: 'comment', body, event: crypto.randomUUID(), ...extra});

async function sql(command) {
  const result = await execute('npx', [...cli, 'd1', 'execute', 'COURSE_DB', '--local', '--persist-to', state, '--command', command, '--json'], {cwd: root, env: environment});
  return JSON.parse(result.stdout)[0].results;
}
before(async () => {
  let logs = '';
  for (const file of ['0001_course_interactions.sql', '0002_visitor_handoff.sql', '0003_comment_replies.sql']) {
    const migration = await execute('npx', [...cli, 'd1', 'execute', 'COURSE_DB', '--local', '--persist-to', state, '--file', 'migrations/' + file], {cwd: root, env: environment});
    logs += migration.stdout + migration.stderr;
  }
  await fs.writeFile(path.join(out, 'migration.log'), logs);
  await start();
});
after(async () => {
  await stop();
  await fs.writeFile(path.join(out, 'server.log'), logs);
  await fs.writeFile(path.join(out, 'api-receipts.json'), JSON.stringify({base, state, receipts}, null, 2) + '\n');
});

test('real D1 PV/UV: retry, same browser and second browser', async () => {
  assert.deepEqual((await one.request('/api/metrics')).body.total, {pv: 0, uv: 0});
  const event = visit();
  let result = await one.request('/api/metrics', event);
  assert.equal(result.status, 200); assert.deepEqual(result.body.total, {pv: 1, uv: 1});
  result = await one.request('/api/metrics', event);
  assert.deepEqual(result.body.total, {pv: 1, uv: 1});
  result = await one.request('/api/metrics', visit('skill-engineering:slides'));
  assert.deepEqual(result.body.total, {pv: 2, uv: 1});
  result = await two.request('/api/metrics', visit());
  assert.deepEqual(result.body.total, {pv: 3, uv: 2});
  assert.deepEqual(result.body.today, result.body.total); assert.equal(result.body.timezone, 'UTC+8');
});
test('shared anonymous reactions can switch and cancel', async () => {
  assert.deepEqual((await one.request(endpoint)).body.reactions, {like: 0, brick: 0});
  assert.deepEqual((await one.request(endpoint, {action: 'reaction', kind: 'like'})).body.reactions, {like: 1, brick: 0});
  assert.deepEqual((await two.request(endpoint, {action: 'reaction', kind: 'like'})).body.reactions, {like: 2, brick: 0});
  let result = await one.request(endpoint, {action: 'reaction', kind: 'brick'});
  assert.deepEqual(result.body.reactions, {like: 1, brick: 1}); assert.equal(result.body.mine, 'brick');
  result = await one.request(endpoint, {action: 'reaction', kind: null});
  assert.deepEqual(result.body.reactions, {like: 1, brick: 0}); assert.equal(result.body.mine, null);
  assert.equal((await two.request(endpoint)).body.mine, 'like');
});
test('optional contact is stored but absent from public GET and POST; retry does not duplicate', async () => {
  const input = comment('<img src=x onerror=alert(1)> 原样文本', {name: '测试昵称', contact: 'private-contact@example.invalid'});
  const result = await one.request(endpoint, input); assert.equal(result.status, 200);
  assert.equal(result.body.comments[0].body, input.body);
  assert.equal('contact' in result.body.comments[0], false);
  assert.equal(JSON.stringify(result.body).includes(input.contact), false);
  await one.request(endpoint, input);
  const publicResult = await two.request(endpoint);
  assert.equal(publicResult.body.comments.length, 1);
  assert.equal(JSON.stringify(publicResult.body).includes(input.contact), false);
  const stored = await execute('npx', [...cli, 'd1', 'execute', 'COURSE_DB', '--local', '--persist-to', state, '--command', 'SELECT contact FROM comments;', '--json'], {cwd: root, env: environment});
  assert.equal(JSON.parse(stored.stdout)[0].results[0].contact, input.contact);
});
test('anonymous comment requires only its message', async () => {
  const result = await two.request(endpoint, comment('不填写姓名和联系方式也能留言。'));
  assert.equal(result.status, 200);
  assert.equal(result.body.comments[0].name, '');
});
test('rejects cross-origin writes, bad input, unknown course and overlong body', async () => {
  assert.equal((await one.request(endpoint, {action: 'reaction', kind: 'like'}, {Origin: 'https://other.invalid'})).status, 403);
  assert.equal((await one.request(endpoint, {action: 'reaction', kind: 'other'})).status, 400);
  assert.equal((await one.request(endpoint, comment('   '))).status, 400);
  assert.equal((await one.request(endpoint, comment('a'.repeat(1001)))).status, 400);
  assert.equal((await one.request(endpoint, comment('测试', {contact: 'a'.repeat(201)}))).status, 400);
  assert.equal((await one.request('/api/feedback/unknown')).status, 404);
  assert.equal((await one.request('/api/metrics', visit('not-a-page'))).status, 400);
  const response = await fetch(base + endpoint, {method: 'POST', headers: {'Origin': base, 'Content-Type': 'application/json'}, body: ' '.repeat(8193)});
  assert.equal(response.status, 413);
});
test('write rate limit blocks bursts without storing raw IP', async () => {
  const burst = new Client('192.0.2.77'); let result;
  for (let i = 0; i < 6; i++) result = await burst.request(endpoint, comment(`限流样例${i}`));
  assert.equal(result.status, 429);
  const stored = await execute('npx', [...cli, 'd1', 'execute', 'COURSE_DB', '--local', '--persist-to', state, '--command', 'SELECT key FROM request_rates;', '--json'], {cwd: root, env: environment});
  for (const row of JSON.parse(stored.stdout)[0].results) assert.match(row.key, /^[a-f0-9]{64}$/);
});
test('real persisted database survives Worker restart', async () => {
  const metricsBefore = (await one.request('/api/metrics')).body;
  const feedbackBefore = (await two.request(endpoint)).body;
  await stop(); await start();
  assert.deepEqual((await one.request('/api/metrics')).body, metricsBefore);
  assert.deepEqual((await two.request(endpoint)).body, feedbackBefore);
});

test('reply persists under the correct root; contact private; retry cannot duplicate or overwrite', async () => {
  await sql("INSERT INTO comments VALUES ('reply-root','skill-engineering','原留言','private-root@example.invalid','原问题','2026-10-14T13:28:00Z');");
  const client = new Client('192.0.2.120');
  const input = {action: 'reply', parent_id: 'reply-root', body: '<script>alert(1)</script> 回复原样文本', name: '回复昵称', contact: 'reply-private@example.invalid', event: crypto.randomUUID()};
  let result = await client.request(endpoint, input); assert.equal(result.status, 200);
  let root = result.body.comments.find(row => row.id === 'reply-root');
  assert.equal(root.reply_count, 1); assert.equal(root.replies[0].body, input.body);
  assert.equal(JSON.stringify(result.body).includes(input.contact), false);
  result = await client.request(endpoint, input); root = result.body.comments.find(row => row.id === 'reply-root'); assert.equal(root.reply_count, 1);
  assert.equal((await client.request(endpoint, {...input, contact: 'different-private@example.invalid'})).status, 200, 'private contact guesses do not affect the public retry result');
  assert.equal((await client.request(endpoint, {...input, body: '改变同一编号的内容'})).status, 409);
  const stored = await sql('SELECT contact FROM comment_replies;'); assert.equal(stored[0].contact, input.contact);
  const thread = await client.request(endpoint + '?thread=reply-root'); assert.equal(thread.body.replies[0].body, input.body); assert.equal(JSON.stringify(thread.body).includes(input.contact), false);
  await stop(); await start();
  root = (await client.request(endpoint)).body.comments.find(row => row.id === 'reply-root'); assert.equal(root.replies[0].id, input.event);
});
test('reply validation, same-course parent, shared write budget and deletion cascade', async () => {
  await sql("INSERT INTO comments VALUES ('foreign-root','other-course','','','另一课程','2026-10-14T13:28:00Z');");
  const client = new Client('192.0.2.121');
  const input = {action: 'reply', parent_id: 'reply-root', body: '匿名回复', event: crypto.randomUUID()};
  assert.equal((await client.request(endpoint, {...input, parent_id: 'missing'})).status, 404);
  assert.equal((await client.request(endpoint, {...input, parent_id: 'foreign-root'})).status, 404);
  assert.equal((await client.request(endpoint + '?thread=foreign-root')).status, 404);
  assert.equal((await client.request(endpoint, {...input, body: ' '})).status, 400);
  assert.equal((await client.request(endpoint, {...input, body: 'a'.repeat(1001)})).status, 400);
  assert.equal((await client.request(endpoint, input, {Origin: 'https://other.invalid'})).status, 403);
  assert.equal((await client.request(endpoint, input)).status, 200);
  for (let i = 0; i < 4; i++) assert.equal((await client.request(endpoint, {action: 'comment', body: '共享限流'+i, event: crypto.randomUUID()})).status, 200);
  assert.equal((await client.request(endpoint, {...input, event: crypto.randomUUID()})).status, 429);
  await sql("DELETE FROM comments WHERE id='reply-root';");
  assert.equal((await sql("SELECT COUNT(*) AS n FROM comment_replies WHERE comment_id='reply-root';"))[0].n, 0);
  assert.equal((await client.request(endpoint + '?thread=reply-root')).status, 404);
});
test('bounded preview and cursor pages retain all replies in chronological order without overlap', async () => {
  await sql("INSERT INTO comments VALUES ('paged-root','skill-engineering','','','多回复问题','2026-10-14T14:00:00Z');" +
    Array.from({length: 35}, (_, i) => `INSERT INTO comment_replies VALUES ('page-${String(i).padStart(2,'0')}','paged-root','','private-page@example.invalid','回复${i}','2026-10-14T14:01:00Z');`).join(''));
  const client = new Client('192.0.2.122');
  const root = (await client.request(endpoint)).body.comments.find(row => row.id === 'paged-root');
  assert.equal(root.reply_count, 35); assert.equal(root.replies.length, 10); assert.equal(root.has_more_replies, true);
  const middle = (await client.request(endpoint + '?thread=paged-root&before='+root.reply_before)).body;
  assert.equal(middle.replies.length, 20); assert.equal(middle.has_more_replies, true);
  const oldest = (await client.request(endpoint + '?thread=paged-root&before='+middle.reply_before)).body;
  assert.equal(oldest.replies.length, 5); assert.equal(oldest.has_more_replies, false);
  const ids = [...oldest.replies, ...middle.replies, ...root.replies].map(row => row.id);
  assert.equal(new Set(ids).size, 35); assert.deepEqual(ids, [...ids].sort());
  assert.equal((await client.request(endpoint + '?thread=paged-root&before=wrong')).status, 404);
  assert.equal(JSON.stringify([root, middle, oldest]).includes('private-page@example.invalid'), false);
});

test('course requests accept anonymous suggestions and ongoing replies in a separate scope', async () => {
  const url = '/api/feedback/course-requests';
  const client = new Client('192.0.2.131');
  assert.equal((await client.request(url)).status, 200);
  const input = comment('希望学习如何整理客户会议纪要。', {contact: 'request-private@example.invalid'});
  let result = await client.request(url, input);
  assert.equal(result.status, 200);
  assert.equal(result.body.comments[0].body, input.body);
  assert.equal(result.body.comments[0].name, '');
  assert.equal(JSON.stringify(result.body).includes(input.contact), false);
  await client.request(url, {action: 'reply', parent_id: input.event, body: '还希望能生成待办。', event: crypto.randomUUID()});
  result = await client.request(url, {action: 'reply', parent_id: input.event, body: '可以补充一个客户跟进场景。', event: crypto.randomUUID()});
  assert.equal(result.body.comments[0].reply_count, 2);
  assert.equal((await client.request(endpoint)).body.comments.some(row => row.id === input.event), false);
  assert.equal((await client.request(endpoint, {action: 'reply', parent_id: input.event, body: '跨区回复', event: crypto.randomUUID()})).status, 404);
  assert.equal((await client.request(url, {action: 'reply', parent_id: 'paged-root', body: '跨区回复', event: crypto.randomUUID()})).status, 404);
  assert.equal((await client.request(url, {action: 'reaction', kind: 'like'})).status, 400);
  assert.equal(JSON.stringify((await new Client('192.0.2.132').request(url)).body).includes(input.contact), false);
});
