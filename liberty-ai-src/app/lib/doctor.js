'use strict';
// Home Server Doctor: collects a read-only snapshot of the box, then applies plain,
// deterministic rules to produce findings. The AI is only ever asked to EXPLAIN these;
// the rules do not depend on it, so the Doctor still works with no AI configured.
const { collectSystem } = require('./sysinfo');
const { fmtBytes, fmtDuration } = require('./util');
const catalog = require('./catalog');

const LABEL_PROJECT = 'com.docker.compose.project';
const LABEL_SERVICE = 'com.docker.compose.service';

function normContainer(c) {
  const name = String((c.Names && c.Names[0]) || c.Id || '').replace(/^\//, '');
  const labels = c.Labels || {};
  let project = labels[LABEL_PROJECT] || null;
  let service = labels[LABEL_SERVICE] || null;
  if (!project) {
    const m = /^(.+?)_([a-z0-9-]+)_(\d+)$/.exec(name);
    if (m) { project = m[1]; service = m[2]; }
  }
  const status = String(c.Status || '');
  const exit = /Exited \((-?\d+)\)/.exec(status);
  const img = String(c.Image || '');
  const tagMatch = /:([^:@\/]+)(?:@|$)/.exec(img.split('@')[0] + '@');
  return {
    id: String(c.Id || '').slice(0, 12),
    name,
    image: img.split('@')[0],
    version: tagMatch ? tagMatch[1] : null,
    state: String(c.State || '').toLowerCase(),
    status,
    project,
    service,
    exitCode: exit ? Number(exit[1]) : null,
    unhealthy: /\(unhealthy\)/i.test(status),
    createdAt: (c.Created || 0) * 1000,
  };
}

function parseStats(s) {
  if (!s || !s.memory_stats) return null;
  const ms = s.memory_stats;
  const cache = (ms.stats && (ms.stats.inactive_file != null ? ms.stats.inactive_file : (ms.stats.total_inactive_file != null ? ms.stats.total_inactive_file : ms.stats.cache))) || 0;
  const mem = Math.max(0, (ms.usage || 0) - cache);
  let cpu = null;
  const cs = s.cpu_stats;
  const pc = s.precpu_stats;
  if (cs && pc && cs.cpu_usage && pc.cpu_usage && cs.system_cpu_usage != null && pc.system_cpu_usage != null) {
    const dc = cs.cpu_usage.total_usage - pc.cpu_usage.total_usage;
    const ds = cs.system_cpu_usage - pc.system_cpu_usage;
    const n = cs.online_cpus || (cs.cpu_usage.percpu_usage || []).length || 1;
    if (ds > 0 && dc >= 0) cpu = Math.round((dc / ds) * n * 1000) / 10;
  }
  return { mem, cpu };
}

function groupApps(containers) {
  const map = new Map();
  for (const c of containers) {
    if (!c.project) continue;
    if (!map.has(c.project)) map.set(c.project, []);
    map.get(c.project).push(c);
  }
  const apps = [];
  for (const [id, list] of map) {
    const running = list.filter((c) => c.state === 'running').length;
    const web = list.find((c) => c.service === 'web' || c.service === 'server') || list[0];
    const meta = catalog.find(id);
    const bad = list.some((c) => c.state === 'restarting' || c.unhealthy);
    let state = running === list.length ? 'running' : running === 0 ? 'stopped' : 'partial';
    if (list.some((c) => c.state === 'restarting')) state = 'restarting';
    else if (bad && state === 'running') state = 'unhealthy';
    apps.push({
      id,
      name: meta ? meta.name : id.replace(/^patriot-/, '').replace(/-/g, ' '),
      patriot: !!meta,
      state,
      version: web && web.version,
      services: list.map((c) => ({ name: c.name, service: c.service, state: c.state, status: c.status, mem: c.mem != null ? c.mem : null, cpu: c.cpu != null ? c.cpu : null })),
      mem: list.reduce((a, c) => a + (c.mem || 0), 0),
      cpu: list.some((c) => c.cpu != null) ? Math.round(list.reduce((a, c) => a + (c.cpu || 0), 0) * 10) / 10 : null,
    });
  }
  apps.sort((a, b) => (a.patriot === b.patriot ? a.name.localeCompare(b.name) : a.patriot ? -1 : 1));
  return apps;
}

function dockerReclaim(df) {
  if (!df) return null;
  const unusedImages = (df.Images || []).filter((i) => !i.Containers).reduce((a, i) => a + (i.Size || 0), 0);
  const buildCache = (df.BuildCache || []).filter((b) => !b.InUse).reduce((a, b) => a + (b.Size || 0), 0);
  return { unusedImages, buildCache, total: unusedImages + buildCache };
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      try { out[k] = await fn(items[k]); } catch (e) { out[k] = null; }
    }
  });
  await Promise.all(workers);
  return out;
}

class Doctor {
  constructor(opts = {}) {
    this.docker = opts.docker || null;
    this.roots = opts.roots || {};
    this.now = opts.now || (() => Date.now());
    this.statsConcurrency = opts.statsConcurrency || 6;
    this.sysFn = opts.sysFn || ((r) => collectSystem(r));
  }

  async snapshot({ stats = true } = {}) {
    const at = this.now();
    const system = await this.sysFn(this.roots);
    const snap = { at, system, docker: { ok: false, error: null }, containers: [], apps: [], reclaim: null };
    if (!this.docker) { snap.docker.error = 'The Docker socket is not available to this app.'; return snap; }
    try {
      const raw = await this.docker.containers();
      snap.docker.ok = true;
      snap.containers = raw.map(normContainer);
    } catch (e) {
      snap.docker.error = String((e && e.message) || e);
      return snap;
    }
    if (stats) {
      const running = snap.containers.filter((c) => c.state === 'running');
      const res = await pool(running, this.statsConcurrency, (c) => this.docker.stats(c.name));
      running.forEach((c, i) => { const p = parseStats(res[i]); if (p) { c.mem = p.mem; c.cpu = p.cpu; } });
    }
    snap.apps = groupApps(snap.containers);
    try { snap.reclaim = dockerReclaim(await this.docker.df()); } catch (e) { /* optional */ }
    return snap;
  }

  async logsFor(names, tail = 50) {
    const out = {};
    for (const n of names.slice(0, 6)) {
      try { out[n] = await this.docker.logs(n, tail); } catch (e) { out[n] = null; }
    }
    return out;
  }
}

// ----------------------------------------------------------------------------------------
// Rules

const SEV_RANK = { crit: 0, warn: 1, info: 2 };

function F(id, sev, title, detail, fix, extra) {
  return Object.assign({ id, sev, title, detail, fix: fix || [] }, extra || {});
}

function analyze(snap) {
  const out = [];
  const sys = snap.system;

  for (const d of sys.disks || []) {
    const left = fmtBytes(d.free) + ' free of ' + fmtBytes(d.total);
    if (d.pct >= 95) {
      out.push(F('disk:' + d.name, 'crit', d.name + ' is almost full (' + d.pct + '% used)', left + '. Apps can stop working when a drive fills up.',
        ['Delete or move big files you no longer need (old downloads, rips, backups).', 'Check what is taking space in the Files app on your Umbrel.',
          snap.reclaim && snap.reclaim.total > 1e9 ? 'Docker also holds about ' + fmtBytes(snap.reclaim.total) + ' of unused images and build cache that can be cleaned.' : 'Uninstall apps you no longer use.']));
    } else if (d.pct >= 88 || (d.free < 20e9 && d.total > 100e9)) {
      out.push(F('disk:' + d.name, 'warn', d.name + ' is getting full (' + d.pct + '% used)', left + '.',
        ['Plan to free some space before it fills up.', 'Large media, downloads and old backups are the usual culprits.']));
    }
  }

  const memPct = sys.mem.pct;
  if (memPct >= 95) {
    out.push(F('mem', 'crit', 'Memory is almost used up (' + memPct + '%)', fmtBytes(sys.mem.available) + ' available of ' + fmtBytes(sys.mem.total) + '.',
      ['Stop apps you are not using.', 'Restart the biggest memory user shown in the Apps tab.']));
  } else if (memPct >= 88) {
    out.push(F('mem', 'warn', 'Memory is running high (' + memPct + '%)', fmtBytes(sys.mem.available) + ' available of ' + fmtBytes(sys.mem.total) + '.',
      ['Check the Apps tab for the biggest memory user.', 'If it stays high for days, restart that app.']));
  }
  if (sys.swap.total > 0 && sys.swap.pct >= 50) {
    out.push(F('swap', 'warn', 'The server is leaning on swap (' + sys.swap.pct + '%)', 'Heavy swap use makes everything slow.', ['Free memory by stopping an app you are not using.']));
  }

  if (sys.load && sys.cores) {
    const per = sys.load[1] / sys.cores;
    if (per >= 2) out.push(F('load', 'crit', 'The CPU is overloaded', 'Load average ' + sys.load.join(' / ') + ' on ' + sys.cores + ' cores.', ['Look for an app that is busy (indexing, transcoding, syncing). It may settle by itself.', 'Check the Apps tab for the top CPU user.']));
    else if (per >= 1.25) out.push(F('load', 'warn', 'The CPU is busy', 'Load average ' + sys.load.join(' / ') + ' on ' + sys.cores + ' cores.', ['If this lasts hours, find the busy app in the Apps tab.']));
  }

  if (sys.tempMax != null) {
    if (sys.tempMax >= 85) out.push(F('temp', 'crit', 'The server is running hot (' + sys.tempMax + ' C)', 'Sustained heat shortens drive and CPU life and can cause throttling.', ['Check airflow and dust around the Umbrel.', 'Move it out of an enclosed space.']));
    else if (sys.tempMax >= 75) out.push(F('temp', 'warn', 'The server is warm (' + sys.tempMax + ' C)', 'Normal under heavy load, but watch it if it stays here.', ['Make sure the vents are clear.']));
  }

  if (sys.uptimeSec < 15 * 60) {
    out.push(F('uptime', 'info', 'The server restarted recently', 'Up for ' + fmtDuration(sys.uptimeSec) + '. Some apps may still be starting.', ['Give it a few minutes, then check again.']));
  }

  if (!snap.docker.ok) {
    out.push(F('docker', 'warn', 'Cannot see your apps', snap.docker.error || 'The Docker socket did not answer.',
      ['Liberty AI needs read-only access to the Docker socket to inspect apps. Reinstalling the app restores it.']));
  } else {
    const byProject = new Map();
    for (const c of snap.containers) {
      if (!c.project) continue;
      if (!byProject.has(c.project)) byProject.set(c.project, []);
      byProject.get(c.project).push(c);
    }
    for (const [proj, list] of byProject) {
      const nice = (catalog.find(proj) || {}).name || proj;
      for (const c of list) {
        if (c.state === 'restarting') {
          out.push(F('c:' + c.name, 'crit', nice + ' keeps restarting', c.name + ' is in a restart loop (' + c.status + ').',
            ['Read its recent log lines (Ask Liberty AI to look at them).', 'If it began after an update, uninstall and reinstall keeps data for most apps; check the app notes first.'], { app: proj, container: c.name }));
        } else if (c.unhealthy) {
          out.push(F('c:' + c.name, 'crit', nice + ' reports unhealthy', c.name + ': ' + c.status + '.',
            ['Restart the app from your Umbrel home screen (right-click the icon, then Restart).', 'If it comes back unhealthy, ask Liberty AI to read its log.'], { app: proj, container: c.name }));
        } else if (c.state === 'exited' && c.exitCode !== null && c.exitCode !== 0 && !/^\s*Exited \(0\)/.test(c.status)) {
          const killed = c.exitCode === 137 ? ' Exit code 137 usually means it was killed for using too much memory.' : '';
          out.push(F('c:' + c.name, 'warn', nice + ' stopped with an error', c.name + ': ' + c.status + '.' + killed,
            ['Restart the app from your Umbrel home screen.', 'If it stops again, ask Liberty AI to read its log.'], { app: proj, container: c.name }));
        } else if (c.state === 'dead' || c.state === 'paused') {
          out.push(F('c:' + c.name, 'warn', nice + ' is ' + c.state, c.name + ' is ' + c.state + '.', ['Restart the app from your Umbrel home screen.'], { app: proj, container: c.name }));
        }
      }
      const running = list.filter((c) => c.state === 'running');
      if (running.length && running.length < list.length && !out.some((f) => f.app === proj)) {
        const stopped = list.filter((c) => c.state !== 'running' && !(c.exitCode === 0));
        if (stopped.length) {
          out.push(F('p:' + proj, 'warn', nice + ' is only partly running', stopped.map((c) => c.name + ' (' + c.state + ')').join(', ') + ' is down.', ['Restart the app from your Umbrel home screen.'], { app: proj }));
        }
      }
    }
    const totalMem = sys.mem.total || 1;
    for (const a of snap.apps || []) {
      if (a.mem && a.mem / totalMem >= 0.35 && a.mem > 1.5e9) {
        out.push(F('hog:' + a.id, 'warn', a.name + ' is using a lot of memory', fmtBytes(a.mem) + ' (' + Math.round((a.mem / totalMem) * 100) + '% of the server).', ['A restart usually returns memory that has built up.'], { app: a.id }));
      }
    }
    if (snap.reclaim && snap.reclaim.total >= 5e9) {
      out.push(F('reclaim', 'info', 'Docker is holding ' + fmtBytes(snap.reclaim.total) + ' you may not need', 'Unused images ' + fmtBytes(snap.reclaim.unusedImages) + ', build cache ' + fmtBytes(snap.reclaim.buildCache) + '.',
        ['Umbrel normally tidies old images itself. If space is tight, this is safe to reclaim.']));
    }
  }

  out.sort((a, b) => SEV_RANK[a.sev] - SEV_RANK[b.sev] || a.title.localeCompare(b.title));
  return out;
}

function score(findings) {
  let s = 100;
  for (const f of findings) s -= f.sev === 'crit' ? 25 : f.sev === 'warn' ? 8 : 0;
  return Math.max(0, s);
}

function summarize(snap, findings) {
  const sys = snap.system;
  const lines = [];
  lines.push('Health score: ' + score(findings) + '/100 (' + findings.length + ' finding' + (findings.length === 1 ? '' : 's') + ').');
  lines.push('Uptime ' + fmtDuration(sys.uptimeSec) + '; ' + sys.cores + ' CPU cores' + (sys.cpuPct != null ? '; CPU ' + sys.cpuPct + '% busy' : '') +
    (sys.load ? '; load ' + sys.load.join(' ') : '') + '.');
  lines.push('Memory ' + sys.mem.pct + '% used (' + fmtBytes(sys.mem.used) + ' of ' + fmtBytes(sys.mem.total) + ')' + (sys.swap.total ? '; swap ' + sys.swap.pct + '%' : '') + '.');
  for (const d of sys.disks) lines.push('Disk "' + d.name + '": ' + d.pct + '% used, ' + fmtBytes(d.free) + ' free of ' + fmtBytes(d.total) + '.');
  if (sys.tempMax != null) lines.push('Hottest sensor ' + sys.tempMax + ' C.');
  if (snap.docker.ok) {
    lines.push('Apps (' + snap.apps.length + '):');
    for (const a of snap.apps) {
      lines.push('- ' + a.name + (a.version ? ' ' + a.version : '') + ': ' + a.state + (a.mem ? ', ' + fmtBytes(a.mem) : '') + (a.cpu != null ? ', cpu ' + a.cpu + '%' : ''));
    }
  } else lines.push('Apps: unavailable (' + (snap.docker.error || 'no docker access') + ').');
  if (findings.length) {
    lines.push('Findings:');
    for (const f of findings) lines.push('- [' + f.sev + '] ' + f.title + ': ' + f.detail);
  } else lines.push('Findings: none. Everything looks healthy.');
  return lines.join('\n');
}

function sampleOf(snap, findings) {
  const sys = snap.system;
  const storage = (sys.disks || [])[0];
  return {
    t: snap.at,
    mem: sys.mem.pct,
    cpu: sys.cpuPct,
    load: sys.load ? sys.load[0] : null,
    disk: storage ? storage.pct : null,
    temp: sys.tempMax,
    apps: (snap.apps || []).length,
    down: (snap.apps || []).filter((a) => a.state !== 'running').length,
    score: score(findings),
  };
}

module.exports = { Doctor, analyze, score, summarize, sampleOf, normContainer, parseStats, groupApps, dockerReclaim };
