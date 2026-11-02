'use strict';
// Builds the offline reader (a plain static website) and the files that go onto the Pi's boot partition.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { createZip } = require('./zip');

const HOTSPOT_DIR = path.join(__dirname, '..', '..', 'hotspot');

function validateOptions(input = {}) {
  const ssid = String(input.ssid == null ? 'Bible Terminal' : input.ssid).trim();
  if (!/^[A-Za-z0-9 _.\-]{1,32}$/.test(ssid)) throw new Error('Wi-Fi name: use 1 to 32 letters, numbers, spaces, dots or dashes.');
  const psk = String(input.password || '');
  if (psk && !/^[A-Za-z0-9 _.\-!@#%^&*()+=:,;?\/~]{8,63}$/.test(psk)) throw new Error('Wi-Fi password: 8 to 63 letters, numbers or simple symbols (or leave it empty for an open hotspot).');
  const country = String(input.country || 'US').toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new Error('Country: use a two-letter code such as US.');
  const appName = String(input.appName == null ? 'Scripture' : input.appName).trim() || 'Scripture';
  if (!/^[A-Za-z0-9 _.\-]{1,24}$/.test(appName)) throw new Error('App name: use 1 to 24 letters, numbers, spaces, dots or dashes.');
  return { ssid, psk, country, appName };
}

const gz = buf => zlib.gzipSync(buf, { level: 9 });

function walk(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, base));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

/** The phone web app for the hotspot: [{ name: 'www/...', data }] */
function siteFiles({ publicDir, dataDir, opts, version }) {
  const files = [];
  for (const rel of walk(path.join(HOTSPOT_DIR, 'web'))) {
    files.push({ name: 'www/' + rel, data: fs.readFileSync(path.join(HOTSPOT_DIR, 'web', rel)) });
  }
  // the search engine is shared with the Umbrel app
  for (const f of ['engine.js', 'books.js', 'nav.js']) files.push({ name: 'www/js/' + f, data: fs.readFileSync(path.join(publicDir, 'js', f)) });
  const config = { static: true, version, appName: opts.appName };
  files.push({ name: 'www/config.js', data: 'window.BT = ' + JSON.stringify(config) + ';\n' });
  files.push({
    name: 'www/manifest.webmanifest',
    data: JSON.stringify({
      name: opts.appName, short_name: opts.appName.slice(0, 12), start_url: './', scope: './', display: 'standalone',
      background_color: '#14120f', theme_color: '#14120f',
      icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
    }),
  });
  for (const f of ['kjv.json', 'timeline.json']) files.push({ name: 'www/data/' + f + '.gz', data: gz(fs.readFileSync(path.join(dataDir, f))) });
  return files;
}

function configEnv(opts) {
  return [
    `BT_SSID='${opts.ssid}'`,
    `BT_PSK='${opts.psk}'`,
    `BT_COUNTRY='${opts.country}'`,
    `BT_IP='10.42.0.1'`,
    '',
  ].join('\n');
}

/** Everything that belongs in <boot partition>/bible-terminal/ */
function payloadFiles(args) {
  const { opts } = args;
  const files = [
    { name: 'bible-terminal/firstrun.sh', data: fs.readFileSync(path.join(HOTSPOT_DIR, 'firstrun.sh')), mode: 0o755 },
    { name: 'bible-terminal/serve.py', data: fs.readFileSync(path.join(HOTSPOT_DIR, 'serve.py')), mode: 0o755 },
    { name: 'bible-terminal/config.env', data: configEnv(opts) },
  ];
  for (const f of siteFiles(args)) files.push({ ...f, name: 'bible-terminal/' + f.name });
  return files;
}

/** What gets added to the end of the single line in cmdline.txt */
function cmdlineAddition(opts) {
  return `systemd.run=/boot/firmware/bible-terminal/firstrun.sh systemd.run_success_action=reboot systemd.unit=kernel-command-line.target cfg80211.ieee80211_regdom=${opts.country}`;
}

const INSTALL_TXT = `BIBLE TERMINAL - Pi hotspot setup files
=========================================

You need: a Raspberry Pi Zero 2 W, a micro SD card (8 GB or larger), and a computer.

1. Flash "Raspberry Pi OS Lite (64-bit)" onto the SD card with Raspberry Pi Imager.
   (In Imager you can skip all the optional settings.)
2. When Imager finishes, unplug the SD card and plug it back in.
   A drive named "bootfs" appears.
3. Copy the folder "bible-terminal" from this zip into the bootfs drive.
4. Open the file "cmdline.txt" on bootfs in a plain-text editor.
   It is ONE line. Go to the very end of that line, type a single space, and paste the text from
   cmdline-add.txt (also in this zip). Do not add a new line. Save.
5. Eject the card, put it in the Pi, and power it on.
   The first start takes a couple of minutes and the Pi restarts once by itself.
6. On your phone, join the Wi-Fi network named in config.env. A "Sign in" page opens the Bible.
   If it doesn't, open any web address (for example http://10.42.0.1) in the browser.

If something doesn't work, put the card back in your computer and open
bootfs/bible-terminal/firstrun.log. It says what happened.

The hotspot has no internet. Anyone in Wi-Fi range can read the Bible and use the chat;
nothing about them is stored on the Pi, and chat messages live only in its memory.
`;

function manualZip(args) {
  const files = payloadFiles(args);
  files.push({ name: 'INSTALL.txt', data: INSTALL_TXT });
  files.push({ name: 'cmdline-add.txt', data: cmdlineAddition(args.opts) + '\n' });
  return createZip(files);
}

module.exports = { validateOptions, payloadFiles, cmdlineAddition, manualZip, INSTALL_TXT };
