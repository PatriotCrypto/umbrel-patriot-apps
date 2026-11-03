import fs from 'node:fs';
import path from 'node:path';

/**
 * Small JSON file for things that must never ride along in a backup download:
 * the password hash, login sessions, the ntfy access token and which reminders were sent.
 */
export class PrivateStore {
  constructor(dir) {
    this.file = path.join(dir, 'private.json');
    this.data = { auth: null, sessions: {}, ntfyToken: '', sent: {} };
    try {
      if (fs.existsSync(this.file)) this.data = { ...this.data, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    } catch (e) {
      console.error('could not read private.json:', e.message);
    }
  }

  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}
