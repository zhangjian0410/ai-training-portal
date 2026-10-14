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

before(async () => {
  const migration = await execute('npx', [...cli, 'd1', 'execute', 'COURSE_DB', '--local', '--persist-to', state, '--file', 'migrations/0001_course_interactions.sql'], {cwd: root, env: environment});
  await fs.writeFile(path.join(out, 'migration.log'), migration.stdout + migration.stderr);
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
