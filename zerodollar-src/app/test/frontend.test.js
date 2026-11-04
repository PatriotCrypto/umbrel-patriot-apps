import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// The browser code has no build step, so one typo breaks a whole page. Parse every file.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'js');
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } })(root);

test('every browser script parses', () => {
  assert.ok(files.length > 10);
  for (const f of files) {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${path.relative(root, f)}: ${r.stderr.split('\n').find((l) => /Error/.test(l)) || r.stderr}`);
  }
});
