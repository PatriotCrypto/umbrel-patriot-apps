// The Doctor page: live server health, plain-English findings, trends.
(function () {
  'use strict';
  const { h, clear, icon, api, bytes, ago, dur, ring, bar, tone, spark, toast, S } = LA;
  let timer = null;
  let host = null;

  function stat(label, value, sub, pct, t) {
    return h('div', { class: 'stat glass' },
      h('div', { class: 'stat-top' }, h('span', { class: 'muted', text: label }), h('b', { text: value })),
      pct != null ? bar(pct, t) : null, h('small', { class: 'muted', text: sub || '' }));
  }

  function finding(f) {
    const open = f.sev === 'crit';
    const card = h('article', { class: 'finding sev-' + f.sev + (open ? ' open' : '') },
      h('header', {}, h('span', { class: 'sev', text: f.sev === 'crit' ? 'Needs action' : f.sev === 'warn' ? 'Heads up' : 'FYI' }),
        h('h3', { text: f.title }), h('button', { class: 'icon-btn small tog', type: 'button', title: 'Show or hide', onclick: () => card.classList.toggle('open') }, icon('up'))),
      h('p', { class: 'detail', text: f.detail }),
      h('div', { class: 'fix' }, h('b', { text: 'What to do' }), h('ol', null, f.fix.map((s) => h('li', { text: s }))),
        h('div', { class: 'row gap' },
          h('button', { class: 'btn small primary', type: 'button', onclick: () => LA.pages.ask.start({ mode: 'doctor', message: 'Explain what is wrong with "' + f.title + '" and walk me through fixing it.', focus: { id: f.id, container: f.container || '' } }) }, icon('chat'), 'Explain with AI'),
          f.app ? h('button', { class: 'btn small', type: 'button', onclick: () => LA.go('apps') }, 'See in Apps') : null)));
    return card;
  }

  function trends(samples) {
    const day = samples.filter((s) => Date.now() - s.t < 24 * 3600e3);
    if (day.length < 3) return h('div', { class: 'card glass' }, h('h3', { text: 'Last 24 hours' }), h('p', { class: 'muted', text: 'Trends appear after a few checks (about every ' + ((S.state && S.state.settings.checkIntervalMin) || 10) + ' minutes).' }));
    const col = (k) => day.map((s) => (typeof s[k] === 'number' ? s[k] : null));
    const t = (label, k, unit, max, cls) => {
      const v = col(k).filter((x) => x != null);
      const now = v.length ? v[v.length - 1] : null;
      return h('div', { class: 'trend' }, h('div', { class: 'trend-top' }, h('span', { class: 'muted', text: label }), h('b', { text: now == null ? '–' : now + unit })), spark(col(k), cls, max));
    };
    return h('div', { class: 'card glass' }, h('h3', { text: 'Last 24 hours' }),
      h('div', { class: 'trends' }, t('Memory', 'mem', '%', 100, 'blue'), t('Storage', 'disk', '%', 100, 'gold'), t('CPU load', 'load', '', null, 'red'), t('Health score', 'score', '', 100, 'green')));
  }

  function appRow(a) {
    const bad = a.state !== 'running';
    return h('tr', { class: bad ? 'bad' : '' },
      h('td', null, h('span', { class: 'dot ' + (a.state === 'running' ? 'ok' : a.state === 'partial' || a.state === 'stopped' ? 'warn' : 'crit') }), ' ', a.name),
      h('td', { class: 'muted', text: a.state }), h('td', { class: 'num', text: a.mem ? bytes(a.mem) : '–' }), h('td', { class: 'num', text: a.cpu != null ? a.cpu + '%' : '–' }));
  }

  function paint(data, hist) {
    clear(host);
    const sys = data.snap.system;
    const f = data.findings;
    const crit = f.filter((x) => x.sev === 'crit').length;
    const warn = f.filter((x) => x.sev === 'warn').length;
    const tn = crit ? 'crit' : warn ? 'warn' : 'ok';
    const headline = crit ? 'Needs attention' : warn ? 'Mostly healthy' : 'All healthy';

    host.appendChild(h('div', { class: 'hero card glass tone-' + tn },
      ring(data.score, String(data.score), 'health', tn),
      h('div', { class: 'hero-text' }, h('h2', { text: headline }),
        h('p', { class: 'muted', text: (crit ? crit + ' urgent, ' : '') + (warn ? warn + ' to watch, ' : '') + (f.length - crit - warn) + ' note' + (f.length - crit - warn === 1 ? '' : 's') + '. Checked ' + ago(data.at) + '. Up ' + dur(sys.uptimeSec) + '.' }),
        h('div', { class: 'row gap wrap' },
          h('button', { class: 'btn primary', type: 'button', id: 'checknow', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { await api('POST', '/api/health/check', {}); await load(true); toast('Checked'); } catch (er) { toast(er.message, 'crit'); } b.disabled = false; } }, icon('refresh'), 'Check now'),
          h('button', { class: 'btn', type: 'button', onclick: () => LA.pages.ask.start({ mode: 'doctor', message: 'Give me a short status briefing on my server: what is healthy, what needs attention, and anything trending the wrong way.' }) }, icon('chat'), 'Brief me')))));

    const disks = sys.disks.map((d) => stat(d.name + ' drive', d.pct + '%', bytes(d.free) + ' free of ' + bytes(d.total), d.pct, tone(d.pct, 88, 95)));
    host.appendChild(h('div', { class: 'stats' },
      stat('Memory', sys.mem.pct + '%', bytes(sys.mem.used) + ' of ' + bytes(sys.mem.total), sys.mem.pct, tone(sys.mem.pct, 88, 95)),
      stat('CPU', sys.cpuPct != null ? sys.cpuPct + '%' : (sys.load ? sys.load[0].toFixed(2) : '–'), sys.cores + ' cores' + (sys.load ? ' · load ' + sys.load.join(' / ') : ''), sys.cpuPct != null ? sys.cpuPct : null, tone(sys.cpuPct || 0, 80, 95)),
      disks,
      stat('Temperature', sys.tempMax != null ? sys.tempMax + ' °C' : 'n/a', sys.temps.length ? sys.temps.slice(0, 2).map((t) => t.sensor + ' ' + t.c + '°').join(' · ') : 'No sensors visible', sys.tempMax != null ? Math.min(100, sys.tempMax) : null, tone(sys.tempMax || 0, 75, 85))));

    host.appendChild(h('div', { class: 'cols' },
      h('div', { class: 'col' },
        h('h3', { class: 'sec', text: 'Findings' }),
        f.length ? f.map(finding) : h('div', { class: 'card glass ok-card' }, icon('check'), h('div', null, h('b', { text: 'All clear' }), h('p', { class: 'muted', text: 'Nothing needs your attention right now.' }))),
        !data.snap.docker.ok ? h('div', { class: 'banner warn' }, icon('alert'), h('span', { text: 'I can not see your apps: ' + (data.snap.docker.error || 'no Docker access') })) : null),
      h('div', { class: 'col side' },
        trends(hist),
        h('div', { class: 'card glass' }, h('h3', { text: 'Apps' }),
          data.snap.apps.length ? h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', { text: 'App' }), h('th', { text: 'State' }), h('th', { class: 'num', text: 'Memory' }), h('th', { class: 'num', text: 'CPU' }))),
            h('tbody', null, data.snap.apps.slice().sort((a, b) => (b.mem || 0) - (a.mem || 0)).slice(0, 14).map(appRow))) : h('p', { class: 'muted', text: 'No apps visible.' }),
          h('button', { class: 'btn small', type: 'button', onclick: () => LA.go('apps') }, 'All apps')))));
  }

  async function load(fresh) {
    try {
      const [data, hist] = await Promise.all([api('GET', '/api/health' + (fresh ? '?fresh=1' : '')), api('GET', '/api/history')]);
      if (!host || !host.isConnected) return;
      paint(data, hist.samples);
      LA.refreshChip && LA.refreshChip();
    } catch (e) {
      if (host && host.isConnected) { clear(host); host.appendChild(h('div', { class: 'banner crit' }, icon('alert'), h('span', { text: e.message }))); }
    }
  }

  function render(into) {
    host = h('div', { class: 'doctor' }, h('div', { class: 'card glass' }, h('p', { class: 'muted', text: 'Examining your server…' })));
    into.appendChild(h('section', { class: 'page' }, h('div', { class: 'page-head' }, h('h2', { text: 'Home Server Doctor' }), h('p', { class: 'muted', text: 'Plain-English checkups. Read-only: I look, I never touch.' })), host));
    load(false);
    timer = setInterval(() => load(false), 30000);
  }

  LA.pages.doctor = { render, leave() { clearInterval(timer); timer = null; host = null; } };
})();
