import path from 'node:path';
import pty from 'node-pty';
import xterm from '@xterm/headless';
import { resolveCommand, agentEnv } from './command.js';

const { Terminal } = xterm;
const COLS = 120, ROWS = 40, SCROLLBACK = 2000, KEEP_DEAD_MS = 30 * 60 * 1000;

// Agents started from Shed run inside a ConPTY that this process owns. A headless terminal emulator tracks what the
// agent has drawn, so the screen can be read back as text and approval prompts can be seen without touching a window.
const sessions = new Map();
let counter = 0;

export function startSession({ command, args = [], cwd, env = process.env }) {
  for (const [id, session] of sessions) if (!session.alive && Date.now() - session.endedAt > KEEP_DEAD_MS) sessions.delete(id);
  const resolved = resolveCommand(command, args, env);
  const proc = pty.spawn(resolved.file, resolved.args, { name:'xterm-256color', cols:COLS, rows:ROWS, cwd, env:agentEnv(env), useConpty:true, useConptyDll:true });
  const term = new Terminal({ cols:COLS, rows:ROWS, scrollback:SCROLLBACK, allowProposedApi:true });
  const session = { id:`pty:${++counter}`, pid:proc.pid, command:path.basename(command).replace(/\.exe$/i, ''), proc, term, alive:true, endedAt:0 };
  proc.onData(data => term.write(data));
  // ConPTY asks the terminal where the cursor is and waits for the answer; the emulator composes it.
  term.onData(reply => { if (session.alive) proc.write(reply); });
  proc.onExit(() => { session.alive = false; session.endedAt = Date.now(); proc.kill(); releaseWorker(proc); });
  sessions.set(session.id, session);
  return session.id;
}

export const getSession = id => sessions.get(id);
export const sessionByPid = pid => [...sessions.values()].find(s => s.alive && s.pid === pid);
export const sessionIsRunning = id => Boolean(sessions.get(id)?.alive);

export function write(id, data) {
  const session = sessions.get(id);
  if (!session?.alive) throw new Error('That terminal is no longer open.');
  session.proc.write(data);
}

// The last `maxLines` lines of scrollback plus the visible screen, with wrapped lines joined.
export function screenText(id, maxLines = 400) {
  const session = sessions.get(id);
  if (!session) return null;
  const buffer = session.term.buffer.active;
  const lines = [];
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (!line) continue;
    const text = line.translateToString(true);
    if (line.isWrapped && lines.length) lines[lines.length - 1] += text; else lines.push(text);
  }
  return lines.join('\n').replace(/\s+$/, '').split('\n').slice(-maxLines).join('\n');
}

export function killSession(id) {
  const session = sessions.get(id);
  if (session?.alive) session.proc.kill();
}

process.on('exit', () => { for (const id of sessions.keys()) try { killSession(id); } catch { /* Already gone. */ } });

// With the bundled ConPTY, node-pty frees its output worker thread only when more output arrives, and none does once
// the program has exited. Left alone, every finished session would keep a thread alive for the life of the server.
function releaseWorker(proc) {
  setTimeout(() => { try { proc._agent._conoutSocketWorker.dispose(); } catch { /* Already released. */ } }, 300).unref();
}
