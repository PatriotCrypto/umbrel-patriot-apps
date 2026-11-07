'use strict';
// Demo mode: a made-up Umbrel with a few problems, a pretend AI and sample documents,
// so you can try (and screenshot) Liberty AI without touching anything real.
const fs = require('fs');
const path = require('path');

const GB = 1024 ** 3;
const NOW = () => Date.now();

function C(name, image, state, status, project, service, extra) {
  return Object.assign({
    Id: Buffer.from(name).toString('hex').padEnd(64, '0').slice(0, 64),
    Names: ['/' + name], Image: image, State: state, Status: status, Created: Math.floor(NOW() / 1000) - 86400 * 20,
    Labels: project ? { 'com.docker.compose.project': project, 'com.docker.compose.service': service } : {},
  }, extra || {});
}

const R = 'ghcr.io/patriotcrypto/';
const CONTAINERS = [
  C('umbrel', 'getumbrel/umbrelos:1.4.2', 'running', 'Up 9 days', null, null),
  C('bitcoin_server_1', 'getumbrel/bitcoind:v28.1', 'running', 'Up 9 days', 'bitcoin', 'server'),
  C('bitcoin_i2pd_daemon_1', 'purplei2p/i2pd:2.54', 'running', 'Up 9 days', 'bitcoin', 'i2pd_daemon'),
  C('electrs_web_1', 'getumbrel/electrs:v0.10.6', 'running', 'Up 9 days', 'electrs', 'web'),
  C('jellyfin_server_1', 'jellyfin/jellyfin:10.10.3', 'running', 'Up 3 days', 'jellyfin', 'server'),
  C('ollama_ollama_1', 'ollama/ollama:0.5.4', 'running', 'Up 2 days', 'ollama', 'ollama'),
  C('patriot-rally-point_web_1', R + 'rally-point:0.4.0', 'running', 'Up 9 days', 'patriot-rally-point', 'web'),
  C('patriot-zerodollar_web_1', R + 'zerodollar:0.4.0', 'running', 'Up 9 days', 'patriot-zerodollar', 'web'),
  C('patriot-coldfront_web_1', R + 'coldfront:0.3.4', 'running', 'Up 9 days (healthy)', 'patriot-coldfront', 'web'),
  C('patriot-coldfront_zwave_1', 'zwavejs/zwave-js-ui:latest', 'running', 'Up 9 days', 'patriot-coldfront', 'zwave'),
  C('patriot-family-vault_web_1', R + 'family-vault:0.5.1', 'running', 'Up 9 days', 'patriot-family-vault', 'web'),
  C('patriot-bible-terminal_web_1', R + 'bible-terminal:0.2.2', 'running', 'Up 9 days', 'patriot-bible-terminal', 'web'),
  C('patriot-skywatch_web_1', R + 'skywatch-radar:0.3.8', 'restarting', 'Restarting (1) 22 seconds ago', 'patriot-skywatch', 'web'),
  C('patriot-uplink_web_1', R + 'uplink:0.3.1', 'exited', 'Exited (137) 3 hours ago', 'patriot-uplink', 'web'),
  C('patriot-ipod-sync_web_1', R + 'upod:2.1.3', 'running', 'Up 9 days', 'patriot-ipod-sync', 'web'),
  C('patriot-liberty-ai_web_1', R + 'liberty-ai:0.1.0', 'running', 'Up 1 minute', 'patriot-liberty-ai', 'web'),
];

const MEM = { 'bitcoin_server_1': 2.9, 'electrs_web_1': 1.3, 'jellyfin_server_1': 2.4, 'ollama_ollama_1': 3.1, 'patriot-rally-point_web_1': 0.09, 'patriot-zerodollar_web_1': 0.07,
  'patriot-coldfront_web_1': 0.08, 'patriot-coldfront_zwave_1': 0.22, 'patriot-family-vault_web_1': 0.11, 'patriot-bible-terminal_web_1': 0.12, 'patriot-ipod-sync_web_1': 0.25,
  'patriot-liberty-ai_web_1': 0.09, 'umbrel': 0.3, 'bitcoin_i2pd_daemon_1': 0.05 };
const CPU = { 'bitcoin_server_1': 9.4, 'electrs_web_1': 2.1, 'jellyfin_server_1': 31.5, 'ollama_ollama_1': 1.2 };

class FakeDocker {
  async available() { return true; }
  async containers() { return CONTAINERS; }
  async stats(name) {
    const mem = (MEM[name] || 0.05) * GB;
    const cpu = CPU[name] || 0.4;
    return {
      memory_stats: { usage: mem + 0.2 * GB, stats: { inactive_file: 0.2 * GB } },
      cpu_stats: { cpu_usage: { total_usage: 1000 + cpu * 2.5 }, system_cpu_usage: 2000, online_cpus: 4 },
      precpu_stats: { cpu_usage: { total_usage: 1000 }, system_cpu_usage: 1000 },
    };
  }
  async df() { return { Images: [{ Size: 3.1 * GB, Containers: 0 }, { Size: 2.4 * GB, Containers: 0 }, { Size: 1 * GB, Containers: 3 }], BuildCache: [] }; }
  async logs(name) {
    if (name === 'patriot-skywatch_web_1') {
      return ['Skywatch Radar starting on :3928', 'Loading receiver config from /data/config.json', 'Error: ECONNREFUSED connecting to 192.168.1.50:30003', '    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1555:16)',
        'Receiver unreachable, exiting (code 1)', 'api_key=abcd1234efgh5678ijkl', 'Skywatch Radar starting on :3928', 'Error: ECONNREFUSED connecting to 192.168.1.50:30003'].join('\n');
    }
    if (name === 'patriot-uplink_web_1') {
      return ['Uplink 0.3.1 listening on :3000', 'Peer handshake ok', 'Receiving file bigvideo.mkv (6.2 GB)', 'FATAL ERROR: JavaScript heap out of memory', 'Killed'].join('\n');
    }
    return 'ok';
  }
}

function demoSystem() {
  return async () => ({
    cores: 4, cpuPct: 23.4, load: [1.2, 1.5, 1.4], uptimeSec: 9 * 86400 + 4 * 3600,
    mem: { total: 16 * GB, available: 4.6 * GB, used: 11.4 * GB, pct: 71.3 },
    swap: { total: 4 * GB, used: 0.2 * GB, pct: 5 },
    temps: [{ sensor: 'nvme', label: 'Composite', c: 52.4 }, { sensor: 'coretemp', label: 'Package id 0', c: 61 }],
    tempMax: 61,
    disks: [
      { name: 'Storage', path: '/storage', total: 1.8e12, used: 1.6e12, free: 0.2e12, pct: 89.1 },
      { name: 'System', path: '/data', total: 256e9, used: 142e9, free: 114e9, pct: 55.5 },
    ],
  });
}

function demoFetch() {
  const widgets = {
    '/widgets/readiness': { type: 'text-with-progress', title: 'Gump Homestead', text: '78', progressLabel: 'B+', progress: 0.78 },
    '/widgets/supplies': { type: 'four-stats', items: [{ title: 'Food', text: '41', subtext: 'days' }, { title: 'Water', text: '9', subtext: 'days' }, { title: 'Expiring', text: '3', subtext: 'items' }, { title: 'Low stock', text: '5', subtext: 'items' }] },
    '/widgets/attention': { type: 'list-emoji', items: [{ emoji: '🟠', text: 'Canned beans expire soon', subtext: '12 days' }, { emoji: '🔵', text: 'Rotate water barrels', subtext: 'due' }] },
    '/widgets/left': { type: 'text-with-progress', title: 'Left to budget', text: '$212.40', progressLabel: '$4,288 of $4,500 planned', progress: 0.95 },
    '/api/widget/status': { type: 'four-stats', items: [{ title: 'Indoor', text: '69.5', subtext: 'F' }, { title: 'Target', text: '68-76', subtext: 'F' }, { title: 'Status', text: 'Idle', subtext: 'auto' }, { title: 'Humidity', text: '38', subtext: '%' }] },
    '/api/widget/filter': { type: 'text-with-progress', title: 'Furnace filter', text: '22 days', progressLabel: 'left', progress: 0.25 },
  };
  return async (url) => {
    const u = new URL(url);
    const body = widgets[u.pathname];
    const mk = (status, obj) => ({ ok: status === 200, status, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(obj || {}), json: async () => obj });
    return body ? mk(200, body) : mk(404, { error: 'nope' });
  };
}

const SAMPLE = {
  'Documents/Insurance/auto-policy.txt': 'Auto insurance policy summary\nPolicy holder: Gump household\nCarrier: Hoosier Mutual\nPolicy number ending 4471\nRenewal date: March 14. The six-month premium is $612 and is billed on the 1st of the month before renewal.\nCoverage: liability 100/300/100, comprehensive deductible $500, collision deductible $500.\nVehicles covered: 2018 Silverado, 2015 Tahoe.\nClaims phone number is on the back of the insurance card in the glove box.\n',
  'Documents/Home/water-heater-manual.md': '# Water heater notes\n\nInstalled 2021, 50 gallon electric, anode rod last replaced 2024.\nFlush the tank every spring. Pressure relief valve test: lift the lever once a year.\nIf the pilot or element fails, breaker 14 in the garage panel controls it.\n',
  'Documents/Home/well-pump.txt': 'Well pump service log\nPressure tank pre-charge is 38 psi. Pump replaced October 2023 by Dearborn Well Service.\nIf the water pressure drops suddenly check the breaker, then the pressure switch.\n',
  'Prepping/emergency-plan.md': '# Family emergency plan\n\nMeeting point one: the mailbox. Meeting point two: Dad\'s house on the hill.\nRadio: Baofeng on 146.520 simplex, Meshtastic channel LongFast.\nGo-bag lives in the hall closet. Water barrels are in the shop.\n',
};

function seedStorage(root) {
  for (const [rel, text] of Object.entries(SAMPLE)) {
    const f = path.join(root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    if (!fs.existsSync(f)) fs.writeFileSync(f, text);
  }
}

// A pretend AI that writes a believable answer from the numbered context blocks.
function demoProvider() {
  return {
    kind: 'demo', label: 'Demo AI (pretend)', cloud: false, model: 'demo',
    async models() { return ['demo']; },
    async chat({ system, messages, onToken }) {
      const q = String((messages[messages.length - 1] || {}).content || '');
      const blocks = [...String(system).matchAll(/\[(\d+)\] ([A-Z][^\n]*)\n([\s\S]*?)(?=\n\n\[\d+\] |$)/g)].map((m) => ({ n: m[1], title: m[2], body: m[3] }));
      let out;
      const health = blocks.find((b) => /^Server health/i.test(b.title));
      const files = blocks.filter((b) => /^File:/.test(b.title));
      const appsData = blocks.filter((b) => /^App data:/.test(b.title));
      if (health && !files.length && !appsData.length) {
        const fl = (health.body.match(/^- \[(crit|warn)\].*$/gm) || []).slice(0, 4);
        if (!fl.length) out = 'Everything looks healthy right now [' + health.n + ']. Nothing needs your attention.';
        else {
          out = 'Your server is mostly fine, but ' + fl.length + ' thing' + (fl.length > 1 ? 's' : '') + ' need attention [' + health.n + ']:\n\n' +
            fl.map((l, i) => (i + 1) + '. ' + l.replace(/^- \[(crit|warn)\] /, '')).join('\n') +
            '\n\nWhat I would do first:\n1. Restart the app that keeps crashing from your Umbrel home screen (right-click the icon, then Restart).\n2. If it crashes again, read the log lines below the finding. The receiver address it cannot reach is the likely cause.\n3. Free some space on the Storage drive before it passes 90%.';
          const lg = blocks.find((b) => /^Recent log lines/i.test(b.title));
          if (lg) out += '\n\nThe log shows a repeated connection error [' + lg.n + '].';
        }
      } else if (files.length) {
        const f = files[0];
        out = 'Here is what your files say [' + f.n + ']:\n\n' + f.body.split('\n').filter(Boolean).slice(0, 6).join('\n') + '\n\n(Demo mode: a real AI would answer in its own words.)';
      } else if (appsData.length) {
        out = appsData.map((a) => '**' + a.title.replace(/^App data: /i, '') + '** [' + a.n + ']\n' + a.body.split('\n').slice(0, 6).map((l) => '- ' + l).join('\n')).join('\n\n');
      } else {
        out = "I don't have anything in your server, apps or files that answers that, so I would only be guessing. Add a folder in the Files tab or turn on an app in the Apps tab and ask again. (Demo mode: " + q.slice(0, 40) + ')';
      }
      for (let i = 0; i < out.length; i += 7) { onToken && onToken(out.slice(i, i + 7)); await new Promise((r) => setTimeout(r, 6)); }
      return { text: out, usage: { in: 0, out: 0 } };
    },
  };
}

module.exports = { FakeDocker, demoSystem, demoFetch, demoProvider, seedStorage, CONTAINERS };
