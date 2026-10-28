import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnCommandSync } from './command.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tailscale = (...args) => spawnCommandSync('tailscale', args, { encoding:'utf8', timeout:30000 });

// Publishes Shed to the person's own tailnet over HTTPS with `tailscale serve`, which keeps it off the public
// internet. iOS only installs a Home Screen app and allows push notifications from an https address, and Tailscale
// provides the certificate. The address is recorded where the QR code reads it from.
export function publish({ port, dataDir, run = tailscale }) {
  const status = JSON.parse(run('status', '--json').stdout || '{}');
  if (status.BackendState !== 'Running') throw new Error(`Tailscale is not connected on this PC (${status.BackendState || 'not running'}). Sign in to Tailscale, then run this again.`);
  const name = String(status.Self?.DNSName || '').replace(/\.$/, '');
  if (!name || !(status.CertDomains || []).includes(name)) throw new Error('HTTPS certificates are not enabled for your tailnet. In the Tailscale admin console, open DNS, turn on MagicDNS and HTTPS Certificates, then run this again.');
  const served = run('serve', '--bg', '--https=443', `http://127.0.0.1:${port}`);
  if (served.status !== 0) throw new Error(`tailscale serve failed: ${(served.stderr || served.stdout || '').trim()}`);
  fs.mkdirSync(dataDir, { recursive:true });
  fs.writeFileSync(path.join(dataDir, 'tailscale-url'), `https://${name}\n`);
  return `https://${name}`;
}

export function unpublish({ dataDir, run = tailscale }) {
  run('serve', 'reset');
  fs.rmSync(path.join(dataDir, 'tailscale-url'), { force:true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 4378);
  const dataDir = process.env.LAYA_DATA_DIR || process.env.JEV_DATA_DIR || path.join(root, '.jev-data');
  try {
    if (process.argv[2] === 'off') { unpublish({ dataDir }); console.log('Shed is no longer published on your tailnet.'); }
    else console.log(`Shed is published on your tailnet at ${publish({ port, dataDir })}\nOpen that address on your iPhone (signed in to Tailscale), then Share > Add to Home Screen.`);
  } catch (error) { console.error(error.message); process.exit(1); }
}
