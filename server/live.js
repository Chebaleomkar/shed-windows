import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { claudeLiveSessions, readTerminalAsync } from './terminal.js';
import { processSnapshot } from './procs.js';

// Approval prompts and menus end with these lines; a session showing one is waiting on the user.
const askingPatterns = {
  claude:/Do you want to|Esc to cancel|Enter to confirm|❯\s*1\./,
  codex:/Would you like to|Allow .*\?|Press enter to confirm|esc to cancel|[›❯]\s*1\.\s/i,
};
// Mid-turn, both CLIs show "esc to interrupt" in their footer, even while waiting on their own tools or background work.
const activePattern = /esc to interrupt|Working \(/i;
// Reading a Terminal window takes about 0.3 seconds. Readings are refreshed in the background (at most every
// 3 seconds per window) and the last one is returned straight away, so session discovery never waits on Terminal.
const screenCache = new Map();
export function terminalState(tty, harness) {
  if (!tty || !askingPatterns[harness]) return { asking:false, active:false };
  const key = `${tty}:${harness}`;
  let entry = screenCache.get(key);
  if (!entry) { entry = { at:0, state:{ asking:false, active:false }, pending:false }; screenCache.set(key, entry); }
  if (!entry.pending && Date.now() - entry.at > 3000) {
    entry.pending = true;
    readTerminalAsync(tty, 14)
      .then(screen => { entry.state = { asking:askingPatterns[harness].test(screen || ''), active:activePattern.test(screen || '') }; })
      .catch(() => {})
      .finally(() => { entry.at = Date.now(); entry.pending = false; });
  }
  return entry.state;
}
export const terminalIsAsking = (tty, harness) => terminalState(tty, harness).asking;
// Claude's own status: busy (mid-turn), waiting (needs the person's input) or idle. Its footer covers the gaps,
// such as a turn that is waiting on its own background work.
export function claudeLiveState(info) {
  if (info.status === 'waiting') return 'asking';
  const screen = terminalState(info.tty, 'claude');
  if (screen.asking) return 'asking';
  return info.status === 'busy' || screen.active ? 'working' : 'open';
}

// Agents Shed did not start cannot be tied to a transcript on Windows (there is no lsof), so Codex, Gemini, Pi and
// OpenCode show as live only where Shed hosts them or, for OpenCode, where its local server reports a status.
function agentPids() {
  const processes = new Map();
  for (const entry of processSnapshot().values()) if (entry.agent) processes.set(entry.pid, entry.agent);
  return processes;
}

export function codexWorkState(file) {
  try {
    const fd = fs.openSync(file, 'r');
    let text;
    try {
      const size = fs.fstatSync(fd).size;
      const length = Math.min(size, 128 * 1024);
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, size - length);
      text = buffer.toString('utf8');
    } finally { fs.closeSync(fd); }
    let last = '';
    for (const line of text.split('\n')) {
      if (!line.includes('task_started') && !line.includes('task_complete') && !line.includes('turn_aborted')) continue;
      try {
        const row = JSON.parse(line);
        if (row.type === 'event_msg' && ['task_started', 'task_complete', 'turn_aborted'].includes(row.payload?.type)) last = row.payload.type;
      } catch { /* A live write may be incomplete. */ }
    }
    return last === 'task_started' ? 'working' : 'open';
  } catch { return 'open'; }
}

// Ports a process is listening on, read from netstat's rows: "TCP 127.0.0.1:4096 0.0.0.0:0 LISTENING 1234".
function localListeningPorts(pids) {
  const wanted = new Set(pids.map(String));
  const result = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding:'utf8', timeout:3000, maxBuffer:4 * 1024 * 1024 });
  const ports = new Set();
  for (const line of (result.stdout || '').split('\n')) {
    const match = line.trim().match(/^TCP\s+(?:127\.0\.0\.1|\[::1\]):(\d+)\s+\S+\s+LISTENING\s+(\d+)$/);
    if (match && wanted.has(match[2])) ports.add(Number(match[1]));
  }
  return [...ports];
}

function opencodeStatuses(processes) {
  if (![...processes.values()].includes('opencode')) return new Map();
  const pids = [...processes].filter(([, name]) => name === 'opencode').map(([pid]) => pid);
  for (const port of localListeningPorts(pids)) for (const endpoint of ['/session/status', '/api/session/status']) {
    const response = spawnSync('curl.exe', ['-fsS', '--noproxy', '*', '--max-time', '2', `http://127.0.0.1:${port}${endpoint}`], { encoding:'utf8', timeout:3000, maxBuffer:1024 * 1024 });
    if (response.status !== 0) continue;
    try {
      const data = JSON.parse(response.stdout);
      if (data && typeof data === 'object' && !Array.isArray(data)) return new Map(Object.entries(data));
    } catch { /* Try another local OpenCode endpoint. */ }
  }
  return new Map();
}

export function liveSessionStates(sessions) {
  const processes = agentPids();
  const statuses = opencodeStatuses(processes);
  const claude = claudeLiveSessions();
  const states = new Map();
  for (const session of sessions) {
    const claudeLive = session.harness === 'claude' && claude.get(session.nativeId);
    if (claudeLive) {
      states.set(session.id, { liveState:claudeLiveState(claudeLive), livePid:claudeLive.pid, tty:claudeLive.tty });
    } else if (session.harness === 'opencode' && statuses.has(session.nativeId)) {
      const status = statuses.get(session.nativeId);
      states.set(session.id, { liveState:status?.type === 'busy' ? 'working' : 'open' });
    }
  }
  return states;
}
