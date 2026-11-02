import fs from 'node:fs';
import path from 'node:path';

/**
 * Single-file JSON store. Writes are atomic (temp file + rename), the previous
 * file is kept as .bak, and a daily snapshot is kept for two weeks.
 */
export class Store {
  constructor(dir, makeInitial, migrate = (s) => s) {
    this.dir = dir;
    this.file = path.join(dir, 'zerodollar.json');
    this.backupDir = path.join(dir, 'backups');
    fs.mkdirSync(this.backupDir, { recursive: true });
    this.migrate = migrate;
    this.state = this.#load(makeInitial);
    this.lastSnapshotDay = '';
  }

  #read(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  #load(makeInitial) {
    for (const f of [this.file, this.file + '.bak']) {
      try {
        if (fs.existsSync(f)) return this.migrate(this.#read(f));
      } catch (e) {
        console.error(`could not read ${f}: ${e.message}`);
        try {
          fs.copyFileSync(f, `${f}.corrupt-${Date.now()}`);
        } catch {}
      }
    }
    const s = makeInitial();
    return s;
  }

  save() {
    const tmp = this.file + '.tmp';
    const json = JSON.stringify(this.state);
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, json);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (fs.existsSync(this.file)) {
      try {
        fs.copyFileSync(this.file, this.file + '.bak');
      } catch {}
    }
    fs.renameSync(tmp, this.file);
    this.#snapshot(json);
  }

  #snapshot(json) {
    const day = new Date().toISOString().slice(0, 10);
    if (day === this.lastSnapshotDay) return;
    this.lastSnapshotDay = day;
    try {
      fs.writeFileSync(path.join(this.backupDir, `zerodollar-${day}.json`), json);
      const files = fs.readdirSync(this.backupDir).filter((f) => /^zerodollar-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
      for (const f of files.slice(0, Math.max(0, files.length - 14))) fs.unlinkSync(path.join(this.backupDir, f));
    } catch (e) {
      console.error('snapshot failed:', e.message);
    }
  }

  /** Run a mutation. If it throws, state is rolled back and nothing is written. */
  update(fn) {
    const before = structuredClone(this.state);
    try {
      const out = fn(this.state);
      this.save();
      return out;
    } catch (e) {
      this.state = before;
      throw e;
    }
  }

  replace(next) {
    const before = this.state;
    try {
      this.state = this.migrate(next);
      this.save();
    } catch (e) {
      this.state = before;
      throw e;
    }
  }
}
