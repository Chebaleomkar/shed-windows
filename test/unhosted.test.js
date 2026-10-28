import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
const until = async (check, ms = 15000) => {
  for (const end = Date.now() + ms; Date.now() < end;) { const value = await check().catch(() => null); if (value) return value; await new Promise(r => setTimeout(r, 100)); }
  throw new Error('timed out');
};

test('a Claude session open in a window Shed does not host is refused, not resumed a second time', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shed-unhosted-'));
  const home = path.join(dir, 'home'), bin = path.join(dir, 'bin'), project = path.join(dir, 'project');
  fs.mkdirSync(path.join(home, '.claude', 'projects', 'proj'), { recursive:true });
  fs.mkdirSync(path.join(home, '.claude', 'sessions'), { recursive:true });
  fs.mkdirSync(bin); fs.mkdirSync(project);
  const sessionId = '99999999-aaaa-4bbb-8ccc-dddddddddddd';
  fs.writeFileSync(path.join(home, '.claude', 'projects', 'proj', `${sessionId}.jsonl`), JSON.stringify({ type:'user', sessionId, cwd:project, timestamp:new Date().toISOString(), message:{ content:'Work on the lunar dashboard' } }) + '\n');
  // This test process stands in for the Claude that is running in someone's own terminal.
  fs.writeFileSync(path.join(home, '.claude', 'sessions', `${process.pid}.json`), JSON.stringify({ pid:process.pid, sessionId, cwd:project, status:'idle', updatedAt:Date.now() }));
  const launched = path.join(dir, 'launched');
  fs.writeFileSync(path.join(bin, 'claude.cmd'), '@ECHO off\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\claude.js" %*\r\n');
  fs.writeFileSync(path.join(bin, 'claude.js'), `const a = process.argv.slice(2);
if (a[0] === '--version') console.log('claude fixture');
else if (a[0] === 'auth') console.log('{"loggedIn":true}');
else require('fs').writeFileSync(${JSON.stringify(launched)}, a.join(' '));
`);
  const port = await freePort(), token = 'unhosted-secret';
  const { Path: _systemPath, ...inherited } = process.env;
  const system32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  const child = spawn(process.execPath, ['server/index.js'], { cwd:path.resolve('.'), env:{ ...inherited, HOME:home, USERPROFILE:home, PATH:`${bin};${system32}`, LAYA_DATA_DIR:path.join(dir, 'data'), LAYA_TOKEN:token, HOST:'127.0.0.1', PORT:String(port) }, stdio:'ignore' });
  try {
    const base = `http://127.0.0.1:${port}`, headers = { Authorization:`Bearer ${token}`, 'Content-Type':'application/json' };
    await until(async () => (await fetch(`${base}/api/me`)).status === 401);
    const listed = await until(async () => (await (await fetch(`${base}/api/sessions`, { headers })).json()).sessions.find(s => s.id === `claude:${sessionId}`));
    assert.notEqual(listed.liveState, 'history', 'the session is seen as running');
    assert.ok(!listed.tty, 'but Shed does not host it');
    await until(async () => (await (await fetch(`${base}/api/harness-health`, { headers })).json()).harnesses.claude?.state === 'ready');
    const created = await fetch(`${base}/api/tasks`, { method:'POST', headers, body:JSON.stringify({ prompt:'Keep going', sessionId:`claude:${sessionId}` }) });
    const body = await created.json();
    assert.equal(created.status, 201, JSON.stringify(body));
    const { task: { id } } = body;
    const failed = await until(async () => { const { task } = await (await fetch(`${base}/api/tasks/${id}`, { headers })).json(); return task.status === 'failed' ? task : null; });
    assert.match(failed.error, /Shed did not start/);
    assert.equal(fs.existsSync(launched), false, 'no second Claude was started on the same session');
  } finally {
    child.kill();
    await new Promise(resolve => child.exitCode === null ? child.once('exit', resolve) : resolve());
    fs.rmSync(dir, { recursive:true, force:true, maxRetries:10, retryDelay:100 });
  }
});
