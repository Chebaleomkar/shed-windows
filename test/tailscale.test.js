import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { publish, unpublish } from '../server/tailscale.js';

const fake = (status, { served = { status:0 } } = {}) => {
  const calls = [];
  const run = (...args) => { calls.push(args); return args[0] === 'status' ? { stdout:JSON.stringify(status) } : served; };
  return { run, calls };
};
const running = { BackendState:'Running', Self:{ DNSName:'desk.tail1234.ts.net.' }, CertDomains:['desk.tail1234.ts.net'] };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'shed-ts-'));

test('publishes Shed over https to the tailnet and records the address for the QR code', () => {
  const dataDir = tmp(), { run, calls } = fake(running);
  assert.equal(publish({ port:4378, dataDir, run }), 'https://desk.tail1234.ts.net');
  assert.deepEqual(calls.at(-1), ['serve', '--bg', '--https=443', 'http://127.0.0.1:4378']);
  assert.equal(fs.readFileSync(path.join(dataDir, 'tailscale-url'), 'utf8'), 'https://desk.tail1234.ts.net\n');
});

test('does nothing, and says why, when Tailscale is not signed in', () => {
  const dataDir = tmp(), { run, calls } = fake({ BackendState:'NoState' });
  assert.throws(() => publish({ port:4378, dataDir, run }), /not connected on this PC \(NoState\)/);
  assert.deepEqual(calls.map(c => c[0]), ['status'], 'nothing was published');
  assert.equal(fs.existsSync(path.join(dataDir, 'tailscale-url')), false);
});

test('does nothing, and says why, when the tailnet has no https certificates', () => {
  const { run, calls } = fake({ ...running, CertDomains:[] });
  assert.throws(() => publish({ port:4378, dataDir:tmp(), run }), /HTTPS certificates are not enabled/);
  assert.deepEqual(calls.map(c => c[0]), ['status']);
});

test('a failed serve command is reported and leaves no address behind', () => {
  const dataDir = tmp(), { run } = fake(running, { served:{ status:1, stderr:'serve config denied' } });
  assert.throws(() => publish({ port:4378, dataDir, run }), /serve config denied/);
  assert.equal(fs.existsSync(path.join(dataDir, 'tailscale-url')), false);
});

test('turning it off resets serve and forgets the address', () => {
  const dataDir = tmp(), { run, calls } = fake(running);
  publish({ port:4378, dataDir, run });
  unpublish({ dataDir, run });
  assert.deepEqual(calls.at(-1), ['serve', 'reset']);
  assert.equal(fs.existsSync(path.join(dataDir, 'tailscale-url')), false);
});
