import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import * as host from './pty-host.js';
import { processSnapshot, refreshProcesses } from './procs.js';

// A `tty` is the id of a terminal Shed hosts (see pty-host.js). Sessions started in some other window have none, so
// Shed can watch them (through Claude's own session files) but cannot type into them.

// Claude Code writes ~/.claude/sessions/<pid>.json for each running interactive session, with its session ID and busy/idle status.
export function claudeLiveSessions() {
  const dir = path.join(os.homedir(), '.claude', 'sessions');
  const live = new Map();
  let names = [];
  try { names = fs.readdirSync(dir).filter(name => /^\d+\.json$/.test(name)); } catch { return live; }
  for (const name of names) {
    try {
      const record = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (!record.sessionId || !Number.isInteger(record.pid) || !processAlive(record.pid)) continue;
      live.set(record.sessionId, { pid:record.pid, status:record.status || '', statusUpdatedAt:record.statusUpdatedAt || 0, tty:ttyOf(record.pid) });
    } catch { /* A session may be writing its record. */ }
  }
  return live;
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

export const ttyOf = pid => host.sessionByPid(pid)?.id || '';

const commandNames = command => Array.isArray(command) ? command : [command];

// True when `command` is the program running in that terminal, so typed text goes to it and not to a shell.
export function agentInForeground(tty, command) {
  const session = host.getSession(tty);
  return Boolean(session?.alive && commandNames(command).includes(session.command));
}

export function pidOnTty(tty, command) {
  const session = host.getSession(tty);
  return session?.alive && commandNames(command).includes(session.command) ? session.pid : null;
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function readTerminalAsync(tty, maxLines = 400) {
  return host.screenText(tty, maxLines);
}

// Text is typed and then Return is pressed, like a keyboard; an empty string presses Return alone.
// Claude Code treats a fast burst of text as a paste, so that Return can land inside the input instead of submitting it.
// Prompts are therefore sent as one bracketed paste, followed by a separate Return a moment later.
// With `agent`, text is only typed while that agent is the terminal's program, checked again before Return:
// if the agent has exited, Return would run the text as a shell command, so the line is wiped instead.
export async function typeIntoTerminalAsync(tty, text, { prompt = false, agent = '' } = {}) {
  if (!host.getSession(tty)) throw new Error('That terminal is no longer open.');
  if (agent && !agentInForeground(tty, agent)) throw new Error(`${agent} is no longer running in that terminal.`);
  if (!prompt) return host.write(tty, `${text}\r`);
  host.write(tty, `\u001b[200~${text}\u001b[201~`);
  await pause(600);
  if (agent && !agentInForeground(tty, agent)) { host.write(tty, '\u0015'); throw new Error(`${agent} exited while the message was being typed.`); }
  host.write(tty, '\r');
}

// Windows allows about 32,000 characters on a command line. Longer prompts would need to be pasted after the agent starts.
const MAX_PROMPT = 30000;

// Starts the agent in a new hosted terminal in cwd. The prompt is read from a private file and becomes the last argument.
export async function openTerminalAsync(cwd, argv, promptFile) {
  let prompt = '';
  if (promptFile) {
    prompt = fs.readFileSync(promptFile, 'utf8');
    fs.rmSync(promptFile, { force:true });
    if (prompt.length > MAX_PROMPT) throw new Error('That message is too long to pass to the agent on Windows. Shorten it or send it in parts.');
  }
  const [command, ...args] = argv;
  return host.startSession({ command, args:prompt ? [...args, prompt] : args, cwd });
}

export function processInfo(pid) {
  const session = host.sessionByPid(pid);
  if (session) return { command:session.command };
  const entry = processSnapshot().get(pid);
  return entry ? { command:entry.agent || entry.name } : null;
}

// Ends a process and everything it started.
export function killTree(pid) {
  return new Promise(resolve => {
    const child = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio:'ignore', windowsHide:true });
    child.on('error', resolve);
    child.on('close', resolve);
  });
}

// Ends an agent process (and the tool commands it is running) without touching the window around it.
// The PID must still belong to `command` (PIDs get reused). Windows console programs cannot be asked to quit, so a
// hosted agent is first sent Ctrl-C twice, which Claude Code and Codex treat as quit; after the grace period, or at
// once for an agent in a window Shed does not host, the process and everything it started is ended.
export async function stopAgent(pid, command, { graceMs = 5000 } = {}) {
  const names = commandNames(command);
  const hosted = host.sessionByPid(pid);
  if (!hosted) await refreshProcesses();
  const info = processInfo(pid);
  if (!info || !names.includes(info.command)) return { stopped:false, reason:'not-running' };
  if (hosted) {
    host.write(hosted.id, '\u0003'); await pause(300);
    if (host.sessionIsRunning(hosted.id)) host.write(hosted.id, '\u0003');
    for (let waited = 0; waited < graceMs; waited += 250) {
      await pause(250);
      if (!host.sessionIsRunning(hosted.id)) return { stopped:true, forced:false };
    }
  }
  await killTree(pid);
  await pause(300);
  return { stopped:!processAlive(pid), forced:true };
}
