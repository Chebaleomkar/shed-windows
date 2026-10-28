import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { lockDown } from '../server/private.js';

const acl = target => spawnSync('icacls', [target], { encoding:'utf8' }).stdout;

test('a data folder and the files made inside it are readable only by the current user', () => {
  // Made beside the code, not in the temp folder, because that is where a drive's shared access list is inherited.
  const dir = fs.mkdtempSync(path.join(process.cwd(), '.acl-test-'));
  try {
    const before = path.join(dir, 'before.json'), after = path.join(dir, 'after.json');
    fs.writeFileSync(before, '{}');
    lockDown(dir, { directory:true });
    fs.writeFileSync(after, '{}');
    assert.equal(fs.readFileSync(before, 'utf8'), '{}', 'a file that was already there stays readable by its owner');
    for (const target of [dir, before, after]) {
      const listing = acl(target);
      assert.match(listing, new RegExp(`${process.env.USERNAME}:`, 'i'), `${target} grants the current user`);
      assert.doesNotMatch(listing, /Users:|Everyone|Authenticated Users|Administrators|SYSTEM/i, `${target} grants nobody else`);
    }
  } finally { fs.rmSync(dir, { recursive:true, force:true }); }
});

test('a single file can be locked down on its own', () => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), '.acl-test-'));
  try {
    const file = path.join(dir, 'token');
    fs.writeFileSync(file, 'secret');
    lockDown(file);
    assert.doesNotMatch(acl(file), /Users:|Everyone|Authenticated Users/i);
    assert.equal(fs.readFileSync(file, 'utf8'), 'secret', 'the owner can still read it');
  } finally { fs.rmSync(dir, { recursive:true, force:true }); }
});
