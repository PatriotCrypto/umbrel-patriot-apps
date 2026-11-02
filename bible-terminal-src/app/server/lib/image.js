'use strict';
// Builds a ready-to-flash SD card image for a Pi Zero 2 W:
//   download Raspberry Pi OS Lite  ->  unpack  ->  copy the reader onto its boot partition  ->  compress.
// Only the small FAT "boot" partition is touched (with mtools); the Linux part of the image is left exactly
// as Raspberry Pi shipped it, and the Pi sets itself up on first boot (see hotspot/firstrun.sh).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const { payloadFiles, cmdlineAddition } = require('./site');

const BASE_URL = 'https://downloads.raspberrypi.com/raspios_lite_arm64_latest';
const NEED_FREE_BYTES = 7 * 1024 ** 3;

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, ...opts, encoding: opts.encoding || 'buffer' }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd} failed: ${(stderr && stderr.toString().trim()) || err.message}`));
      else resolve(stdout);
    });
  });
}

/** Reads the MBR; returns the first FAT partition's byte offset and size. */
function bootPartition(imgPath) {
  const fd = fs.openSync(imgPath, 'r');
  try {
    const mbr = Buffer.alloc(512);
    fs.readSync(fd, mbr, 0, 512, 0);
    if (mbr[510] !== 0x55 || mbr[511] !== 0xaa) throw new Error('This is not a disk image with a partition table.');
    for (let i = 0; i < 4; i++) {
      const e = 446 + i * 16;
      const type = mbr[e + 4];
      if (type === 0x0b || type === 0x0c || type === 0x0e || type === 0x06) {
        const lba = mbr.readUInt32LE(e + 8), sectors = mbr.readUInt32LE(e + 12);
        return { offset: lba * 512, size: sectors * 512 };
      }
    }
    throw new Error('No boot partition found in the image.');
  } finally { fs.closeSync(fd); }
}

const mt = (imgPath, offset) => ({ env: { ...process.env, MTOOLS_SKIP_CHECK: '1' }, imgSpec: `${imgPath}@@${offset}` });

async function patchBoot({ imgPath, files, cmdlineAdd, userconf, workDir }) {
  const { offset } = bootPartition(imgPath);
  const { env, imgSpec } = mt(imgPath, offset);
  // 1. copy the payload folder
  const stage = path.join(workDir, 'stage');
  fs.rmSync(stage, { recursive: true, force: true });
  for (const f of files) {
    const p = path.join(stage, f.name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, f.data);
  }
  await run('mcopy', ['-s', '-n', '-o', '-i', imgSpec, path.join(stage, 'bible-terminal'), '::'], { env });
  // 2. add our boot hook to cmdline.txt (one line)
  const cur = (await run('mtype', ['-i', imgSpec, '::cmdline.txt'], { env })).toString('utf8').replace(/\s+$/, '');
  if (!cur || cur.includes('\n')) throw new Error('cmdline.txt looks wrong; refusing to change it.');
  const cleaned = cur.replace(/ ?systemd\.run=\S*/g, '').replace(/ ?systemd\.run_success_action=\S*/g, '').replace(/ ?systemd\.unit=\S*/g, '').replace(/ ?cfg80211\.ieee80211_regdom=\S*/g, '');
  const tmp = path.join(workDir, 'cmdline.txt');
  fs.writeFileSync(tmp, cleaned + ' ' + cmdlineAdd + '\n');
  await run('mcopy', ['-n', '-o', '-i', imgSpec, tmp, '::cmdline.txt'], { env });
  // 3. a login so the first-boot "create a user" prompt doesn't wait on a keyboard
  if (userconf) {
    const uc = path.join(workDir, 'userconf.txt');
    fs.writeFileSync(uc, userconf + '\n');
    await run('mcopy', ['-n', '-o', '-i', imgSpec, uc, '::userconf.txt'], { env });
  }
  return { offset };
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

function hashPassword(pw) {
  return new Promise((resolve, reject) => {
    const p = spawn('openssl', ['passwd', '-6', '-stdin']);
    let out = '', err = '';
    p.stdout.on('data', d => (out += d));
    p.stderr.on('data', d => (err += d));
    p.on('error', reject);
    p.on('close', code => (code === 0 ? resolve(out.trim()) : reject(new Error('openssl failed: ' + err))));
    p.stdin.end(pw + '\n');
  });
}

class ImageBuilder {
  constructor({ dataDir, publicDir, appDataDir, version }) {
    this.dir = path.join(dataDir, 'hotspot');
    this.publicDir = publicDir; this.appDataDir = appDataDir; this.version = version;
    this.job = null;
    fs.mkdirSync(path.join(this.dir, 'out'), { recursive: true });
    this.cleanOld();
  }

  cleanOld() { // leftovers from an interrupted build
    fs.rmSync(path.join(this.dir, 'work'), { recursive: true, force: true });
  }

  status() {
    const j = this.job;
    const outputs = fs.existsSync(path.join(this.dir, 'out'))
      ? fs.readdirSync(path.join(this.dir, 'out')).filter(f => f.endsWith('.img.xz')).map(f => ({ name: f, bytes: fs.statSync(path.join(this.dir, 'out', f)).size })) : [];
    if (!j) return { state: 'idle', outputs };
    return { state: j.state, phase: j.phase, pct: j.pct, note: j.note, error: j.error, login: j.state === 'done' ? j.login : undefined, file: j.file, outputs };
  }

  outputPath(name) {
    if (!/^[A-Za-z0-9._-]+\.img\.xz$/.test(name)) return null;
    const p = path.join(this.dir, 'out', name);
    return fs.existsSync(p) ? p : null;
  }

  async start(opts) {
    if (this.job && this.job.state === 'running') throw new Error('An image is already being built.');
    const st = fs.statfsSync(this.dir);
    if (st.bavail * st.bsize < NEED_FREE_BYTES && !process.env.HOTSPOT_SKIP_SPACE_CHECK) {
      throw new Error('Not enough free space. Building an image needs about 7 GB free on your Umbrel.');
    }
    const job = this.job = { state: 'running', phase: 'starting', pct: 0, note: '' };
    this.run(job, opts).catch(e => { job.state = 'failed'; job.error = e.message; })
      .finally(() => fs.rmSync(path.join(this.dir, 'work'), { recursive: true, force: true }));
    return this.status();
  }

  async run(job, opts) {
    const work = path.join(this.dir, 'work');
    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(work, { recursive: true });
    const set = (phase, pct, note = '') => { job.phase = phase; job.pct = pct; job.note = note; };

    // 1. base image
    let xzPath = process.env.HOTSPOT_BASE_IMAGE;
    if (!xzPath) {
      set('download', 0, 'Downloading Raspberry Pi OS Lite');
      xzPath = await this.download(job);
    }
    // 2. unpack
    set('unpack', 0, 'Unpacking the image');
    const imgPath = path.join(work, 'bible-terminal.img');
    await new Promise((resolve, reject) => {
      const x = spawn('xz', ['-dc', xzPath]);
      const out = fs.createWriteStream(imgPath);
      let err = '';
      x.stderr.on('data', d => (err += d));
      x.on('error', reject);
      x.stdout.pipe(out);
      out.on('finish', () => resolve());
      x.on('close', code => { if (code !== 0) reject(new Error('xz failed: ' + err)); });
    });
    // 3. patch
    set('patch', 0, 'Adding the Bible to the boot partition');
    const password = crypto.randomBytes(9).toString('base64url');
    const userconf = 'bible:' + await hashPassword(password);
    const files = payloadFiles({ publicDir: this.publicDir, dataDir: this.appDataDir, opts, version: this.version });
    await patchBoot({ imgPath, files, cmdlineAdd: cmdlineAddition(opts), userconf, workDir: work });
    // 4. compress
    set('compress', 0, 'Compressing (this takes a few minutes)');
    const stamp = new Date().toISOString().slice(0, 10);
    const name = `bible-terminal-${stamp}.img.xz`;
    const outTmp = path.join(this.dir, 'out', name + '.part');
    await new Promise((resolve, reject) => {
      const x = spawn('xz', ['-T0', '-3', '-c', imgPath]);
      const out = fs.createWriteStream(outTmp);
      let err = '';
      x.stderr.on('data', d => (err += d));
      x.on('error', reject);
      x.stdout.pipe(out);
      out.on('finish', resolve);
      x.on('close', code => { if (code !== 0) reject(new Error('xz failed: ' + err)); });
    });
    fs.renameSync(outTmp, path.join(this.dir, 'out', name));
    for (const f of fs.readdirSync(path.join(this.dir, 'out'))) { // keep only the newest
      if (f !== name && f.endsWith('.img.xz')) fs.rmSync(path.join(this.dir, 'out', f), { force: true });
    }
    job.file = name;
    job.login = { user: 'bible', password };
    job.state = 'done'; set('done', 100, '');
  }

  async download(job) {
    const base = path.join(this.dir, 'base');
    fs.mkdirSync(base, { recursive: true });
    const res = await fetch(BASE_URL, { redirect: 'follow', signal: AbortSignal.timeout(60 * 60 * 1000) });
    if (!res.ok) throw new Error('Could not download Raspberry Pi OS (HTTP ' + res.status + ').');
    const fname = path.basename(new URL(res.url).pathname) || 'raspios.img.xz';
    if (!/^[A-Za-z0-9._-]+\.img\.xz$/.test(fname)) throw new Error('Unexpected download name: ' + fname);
    const dest = path.join(base, fname);
    // Raspberry Pi publishes a SHA-256 next to every image; the download must match it
    const sumRes = await fetch(res.url + '.sha256', { signal: AbortSignal.timeout(60 * 1000) });
    if (!sumRes.ok) throw new Error('Could not fetch the Raspberry Pi OS checksum (HTTP ' + sumRes.status + ').');
    const want = (await sumRes.text()).trim().split(/\s+/)[0].toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(want)) throw new Error('The Raspberry Pi OS checksum was not in the expected format.');
    if (fs.existsSync(dest) && fs.statSync(dest).size === Number(res.headers.get('content-length')) && await sha256File(dest) === want) { try { res.body.cancel(); } catch { /* ok */ } return dest; }
    const total = Number(res.headers.get('content-length')) || 0;
    let got = 0;
    const src = Readable.fromWeb(res.body);
    src.on('data', c => { got += c.length; if (total) job.pct = Math.round(got / total * 100); });
    await pipeline(src, fs.createWriteStream(dest + '.part'));
    if (await sha256File(dest + '.part') !== want) { fs.rmSync(dest + '.part', { force: true }); throw new Error('The downloaded Raspberry Pi OS did not match its checksum, so it was discarded. Try again.'); }
    fs.renameSync(dest + '.part', dest);
    for (const f of fs.readdirSync(base)) if (f !== fname && f.endsWith('.img.xz')) fs.rmSync(path.join(base, f), { force: true });
    return dest;
  }
}

module.exports = { ImageBuilder, bootPartition, patchBoot, hashPassword, BASE_URL };
