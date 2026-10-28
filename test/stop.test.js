import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { stopAgent } from '../server/terminal.js';
import { startSession, getSession, screenText, sessionIsRunning } from '../server/pty-host.js';

// A fake agent: node copied to a file named claude.exe, so the process list reports it as claude.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shed-stop-'));
const fakeClaude = path.join(dir, 'claude.exe');
fs.copyFileSync(process.execPath, fakeClaude);
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (check, ms = 8000) => { for (const end = Date.now() + ms; Date.now() < end;) { if (check()) return; await new Promise(r => setTimeout(r, 50)); } throw new Error('timed out'); };
function agent(code) {
  const child = spawn(fakeClaude, ['-e', code], { stdio:['ignore', 'pipe', 'ignore'], windowsHide:true });
  child.unref();
  return child;
}
const firstLine = child => new Promise((resolve, reject) => { child.stdout.once('data', d => resolve(String(d).trim())); child.once('exit', code => reject(new Error(`fake agent exited (${code})`))); });
test.after(() => fs.rmSync(dir, { recursive:true, force:true, maxRetries:10, retryDelay:200 }));

test('ends an agent in a window Shed does not host, and the tool command it is running', async () => {
  const tool = "require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio:'ignore' })";
  const child = agent(`const c = ${tool}; console.log(c.pid); setInterval(() => {}, 1000)`);
  const toolPid = Number(await firstLine(child));
  assert.ok(alive(child.pid) && alive(toolPid));
  const result = await stopAgent(child.pid, 'claude');
  assert.deepEqual(result, { stopped:true, forced:true });
  await until(() => !alive(toolPid));
});

test('never ends a process that is not the named agent', async () => {
  const child = agent("console.log('ready'); setInterval(() => {}, 1000)");
  await firstLine(child);
  try {
    assert.deepEqual(await stopAgent(child.pid, 'codex'), { stopped:false, reason:'not-running' });
    assert.ok(alive(child.pid));
  } finally { child.kill(); }
});

const hosted = async code => {
  const id = startSession({ command:fakeClaude, args:['-e', code], cwd:dir });
  await until(() => screenText(id)?.includes('ready'));
  return { id, pid:getSession(id).pid };
};

test('a hosted agent is asked to quit with Ctrl-C before anything is forced', async () => {
  const { id, pid } = await hosted("console.log('ready'); setInterval(() => {}, 1000)");
  assert.deepEqual(await stopAgent(pid, 'claude'), { stopped:true, forced:false });
  assert.equal(sessionIsRunning(id), false);
});

test('a hosted agent that ignores Ctrl-C is force-ended after the grace period', async () => {
  const { id, pid } = await hosted("process.on('SIGINT', () => {}); console.log('ready'); setInterval(() => {}, 1000)");
  assert.deepEqual(await stopAgent(pid, 'claude', { graceMs:600 }), { stopped:true, forced:true });
  await until(() => !sessionIsRunning(id));
});
