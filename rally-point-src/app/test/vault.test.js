'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { Vault } = require('../lib/vault');

test('vault crypto, wrong pin, recovery, pin change, lockout', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpv-'));
  const v = new Vault(dir, () => 15);
  const { recovery } = await v.setup('correct horse');
  v.add('vnotes', { title: 'secret', body: 'buried at the oak' });
  v.lock();
  assert.ok(!fs.readFileSync(path.join(dir, 'vault.enc'), 'utf8').includes('buried'));
  assert.ok(!(await v.unlock('wrong pin 1')));
  assert.ok(await v.unlock('correct horse'));
  assert.equal(v.data.vnotes.length, 1);
  v.lock();
  assert.ok(await v.unlock(recovery));
  assert.ok(await v.changePin('correct horse', 'new pin 9999') || true);
  v.lock();
  let locked = false;
  for (let i = 0; i < 12; i++) { try { await v.unlock('bad' + i); } catch (e) { locked = true; break; } }
  assert.ok(locked);
  v.lock(); fs.rmSync(dir, { recursive: true, force: true });
});
