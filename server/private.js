import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// chmod does nothing on Windows, where a new folder inherits its parent's access list. Outside the user profile
// that often lets every local account read, and sometimes change, what Shed keeps (its token, password hash, device
// keys and push keys). This replaces the access list with one entry: the current user.
function icacls(args) {
  const result = spawnSync('icacls', args, { encoding:'utf8', windowsHide:true, timeout:15000 });
  if (result.status !== 0) throw new Error(`icacls ${args[0]} failed: ${(result.stdout || result.stderr || result.error?.message || '').trim()}`);
}

export function lockDown(target, { directory = false } = {}) {
  const user = `${process.env.USERDOMAIN || process.env.COMPUTERNAME}\\${process.env.USERNAME}`;
  if (!directory) return icacls([target, '/inheritance:r', '/grant:r', `${user}:F`]);
  icacls([target, '/inheritance:r', '/grant:r', `${user}:(OI)(CI)F`]);
  // Files already inside still carry the old inherited entries; resetting them makes them inherit from the folder.
  // (Removing inheritance on them instead would leave them with no entries at all, locking out their owner too.)
  if (fs.readdirSync(target).length) icacls([path.join(target, '*'), '/reset', '/T', '/C']);
}
