import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startSession, screenText, write, sessionIsRunning, killSession } from '../server/pty-host.js';
import { resolveCommand, agentEnv } from '../server/command.js';

const until = async (check, ms = 8000) => {
  for (const end = Date.now() + ms; Date.now() < end;) { const value = check(); if (value) return value; await new Promise(r => setTimeout(r, 50)); }
  throw new Error('timed out');
};

// A stand-in agent: prints a banner, then echoes each line it is given.
const echoAgent = `process.stdout.write('ready\\n'); process.stdin.setEncoding('utf8'); process.stdin.on('data', d => process.stdout.write('got:' + d.trim() + '\\n'));`;

test('a hosted program can be read and typed into through its screen', async () => {
  const id = startSession({ command:process.execPath, args:['-e', echoAgent], cwd:process.cwd() });
  try {
    await until(() => screenText(id)?.includes('ready'));
    write(id, 'hello\r');
    await until(() => screenText(id).includes('got:hello'));
    assert.ok(sessionIsRunning(id));
  } finally { killSession(id); }
});

test('a program that exits is no longer running but its screen stays readable', async () => {
  const id = startSession({ command:process.execPath, args:['-e', "console.log('bye')"], cwd:process.cwd() });
  await until(() => !sessionIsRunning(id));
  assert.ok(screenText(id).includes('bye'));
  assert.throws(() => write(id, 'x'), /no longer open/);
});

test('an npm .cmd shim resolves to the script it runs, never to cmd.exe', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shed-shim-'));
  try {
    const shim = String.raw`@ECHO off
endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\node_modules\fake\cli.js" %*
`;
    fs.writeFileSync(path.join(dir, 'fakeagent.cmd'), shim);
    const resolved = resolveCommand('fakeagent', ['--flag'], { PATH:dir });
    assert.equal(resolved.file, process.execPath);
    assert.deepEqual(resolved.args, [path.join(dir, 'node_modules', 'fake', 'cli.js'), '--flag']);
  } finally { fs.rmSync(dir, { recursive:true, force:true }); }
});

test('a missing command is reported by name', () => {
  assert.throws(() => resolveCommand('definitely-not-installed', [], { PATH:'' }), /definitely-not-installed is not installed/);
});

test('a parent Claude session markers and credentials are not passed to hosted agents', async () => {
  const env = { ...process.env, CLAUDECODE:'1', CLAUDE_CODE_CHILD_SESSION:'1', CLAUDE_CODE_MESSAGING_TOKEN:'secret', CLAUDE_CODE_USE_BEDROCK:'1' };
  const kept = agentEnv(env);
  assert.equal(kept.CLAUDECODE, undefined);
  assert.equal(kept.CLAUDE_CODE_CHILD_SESSION, undefined);
  assert.equal(kept.CLAUDE_CODE_MESSAGING_TOKEN, undefined);
  assert.equal(kept.CLAUDE_CODE_USE_BEDROCK, '1', 'settings the user chose still apply');
  const id = startSession({ command:process.execPath, args:['-e', "console.log('marker=' + String(process.env.CLAUDECODE) + ' token=' + String(process.env.CLAUDE_CODE_MESSAGING_TOKEN))"], cwd:process.cwd(), env });
  await until(() => screenText(id)?.includes('marker='));
  assert.match(screenText(id), /marker=undefined token=undefined/);
});

test('arrow keys and Return reach a raw-mode agent as the escape sequences menus expect', async () => {
  const agent = "process.stdin.setRawMode(true); process.stdin.on('data', d => console.log('keys=' + Buffer.from(d).toString('hex'))); console.log('raw-ready'); setInterval(() => {}, 1000)";
  const id = startSession({ command:process.execPath, args:['-e', agent], cwd:process.cwd() });
  try {
    await until(() => screenText(id)?.includes('raw-ready'));
    write(id, '\u001b[B');
    await until(() => screenText(id).includes('keys=1b5b42'));
    write(id, '\r');
    await until(() => /keys=0d/.test(screenText(id)));
  } finally { killSession(id); }
});
