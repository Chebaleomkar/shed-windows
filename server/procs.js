import { spawn } from 'node:child_process';

const QUERY = '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress';
const AGENTS = new Set(['codex', 'claude', 'gemini', 'pi', 'opencode']);
// Agents installed from npm run as `node <script>`, so they are told apart by the package in the command line.
const NODE_AGENTS = [['codex', /[\\/]@openai[\\/]codex[\\/]/i], ['gemini', /[\\/]@google[\\/]gemini-cli[\\/]/i], ['pi', /[\\/]pi-coding-agent[\\/]/i], ['opencode', /[\\/]opencode(-ai)?[\\/]/i]];

export function agentOf({ name, commandLine }) {
  if (AGENTS.has(name)) return name;
  if (name !== 'node') return '';
  return NODE_AGENTS.find(([, pattern]) => pattern.test(commandLine))?.[0] || '';
}

// Listing processes takes about 0.8 seconds, so readers get the last snapshot straight away and one refresh runs at a time.
let snapshot = new Map();
let takenAt = 0;
let pending = null;

export function refreshProcesses() {
  pending ??= new Promise(resolve => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', QUERY], { stdio:['ignore', 'pipe', 'ignore'], windowsHide:true });
    let out = '';
    const timer = setTimeout(() => child.kill(), 15000);
    child.stdout.on('data', chunk => { out += chunk; });
    const finish = () => {
      clearTimeout(timer);
      try {
        const rows = [].concat(JSON.parse(out));
        snapshot = new Map(rows.map(row => {
          const name = String(row.Name || '').toLowerCase().replace(/\.exe$/, '');
          const commandLine = row.CommandLine || '';
          return [row.ProcessId, { pid:row.ProcessId, ppid:row.ParentProcessId, name, commandLine, agent:agentOf({ name, commandLine }) }];
        }));
        takenAt = Date.now();
      } catch { /* Keep the previous snapshot. */ }
      pending = null;
      resolve(snapshot);
    };
    child.on('error', finish);
    child.on('close', finish);
  });
  return pending;
}

export function processSnapshot() {
  if (!pending && Date.now() - takenAt > 3000) refreshProcesses();
  return snapshot;
}
