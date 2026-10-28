import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const SHIM_TARGET = /"%dp0%\\([^"]+\.(?:js|mjs|cjs|exe))"\s+%\*/i;

// npm installs agents as .cmd shims, which Node cannot start without a shell, and cmd.exe's quoting would let prompt
// text run as commands. So the script or .exe that a shim launches is started directly instead.
export function resolveCommand(command, args = [], env = process.env) {
  if (path.isAbsolute(command)) return { file:command, args };
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const exe = path.join(dir, `${command}.exe`);
    if (fs.existsSync(exe)) return { file:exe, args };
    const shim = path.join(dir, `${command}.cmd`);
    if (!fs.existsSync(shim)) continue;
    const target = fs.readFileSync(shim, 'utf8').match(SHIM_TARGET)?.[1];
    if (!target) throw new Error(`Could not work out what ${shim} runs.`);
    const script = path.join(dir, target);
    return script.toLowerCase().endsWith('.exe') ? { file:script, args } : { file:process.execPath, args:[script, ...args] };
  }
  throw new Error(`${command} is not installed or not on PATH.`);
}

// Variables a running Claude Code session sets for its own children. An agent that inherits them believes it is a
// child of that session: it stops saving its transcript (which Shed reads replies from) and gets the parent's
// messaging credentials. Shed may well be started from a Claude session, so none of it is passed on.
const SESSION_MARKERS = /^(CLAUDECODE|AI_AGENT|CLAUDE_PID|CLAUDE_CODE_(CHILD_SESSION|SESSION_ID|SESSION_ATTENDED|ENTRYPOINT|EXECPATH|MESSAGING_\w+|BRIDGE_SESSION_ID))$/;
export function agentEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !SESSION_MARKERS.test(name)));
}

// When a command cannot be resolved, the plain call is made so the caller sees the usual ENOENT error.
function resolved(command, args, options) {
  try { return resolveCommand(command, args, options.env); } catch { return { file:command, args }; }
}
export function spawnCommand(command, args, options = {}) {
  const run = resolved(command, args, options);
  return spawn(run.file, run.args, { ...options, env:agentEnv(options.env) });
}
export function spawnCommandSync(command, args, options = {}) {
  const run = resolved(command, args, options);
  return spawnSync(run.file, run.args, { ...options, env:agentEnv(options.env) });
}
