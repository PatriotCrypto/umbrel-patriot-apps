// The Apps page: your Patriot apps and everything else on the server, with a switch
// per app for whether Liberty AI may read its data.
(function () {
  'use strict';
  const { h, clear, icon, api, bytes, toast, modal, monogram, S } = LA;
  let host = null;

  const STATE_TONE = { running: 'ok', partial: 'warn', stopped: 'warn', restarting: 'crit', unhealthy: 'crit', custom: 'ok', 'not installed': 'off' };

  async function showData(a) {
    const body = h('div', null, h('p', { class: 'muted', text: 'Reading…' }));
    modal(a.name + ': what Liberty AI sees', body);
    try {
      const r = await api('GET', '/api/apps/' + a.id + '/data');
      clear(body);
      if (!r.ok) body.appendChild(h('p', { class: 'muted', text: r.error || 'Nothing to show.' }));
      else {
        body.appendChild(h('ul', { class: 'plain' }, r.lines.map((l) => h('li', { text: l }))));
        body.appendChild(h('p', { class: 'muted small', text: 'Source: ' + (r.source === 'summary' ? 'the app\'s Liberty AI summary' : r.source === 'widgets' ? 'the app\'s home-screen widgets' : 'your custom connector') + '. Read-only.' }));
      }
    } catch (e) { clear(body); body.appendChild(h('p', { class: 'muted', text: e.message })); }
  }

  async function toggle(a, on, card) {
    try {
      await api('PUT', '/api/settings', { appsOn: { [a.id]: on } });
      a.enabled = on;
      S.state.settings.appsOn[a.id] = on;
      card.classList.toggle('on', on);
      toast(on ? a.name + ' is now readable by Liberty AI' : a.name + ' is off', 'ok');
    } catch (e) { toast(e.message, 'crit'); load(); }
  }

  function connectorNote(a) {
    if (a.connector === 'widgets') return 'Shares its home-screen widget data';
    if (a.connector === 'custom') return 'Your custom connector';
    if (a.connector === 'host') return 'Runs on the host network: not reachable yet';
    return 'No data connector yet (status only)';
  }

  function card(a) {
    const can = a.installed && (a.connector === 'widgets' || a.connector === 'custom');
    const el = h('article', { class: 'app card glass' + (a.enabled ? ' on' : '') + (a.installed ? '' : ' dim') });
    const openUrl = a.url || (a.port ? location.protocol + '//' + location.hostname + ':' + a.port : null);
    el.appendChild(h('header', null, monogram(a.name, a.id), h('div', { class: 'ttl' }, h('h3', { text: a.name }), h('small', { class: 'muted', text: a.blurb || (a.other ? 'Umbrel app' : '') })),
      h('span', { class: 'pill ' + (STATE_TONE[a.state] || 'warn') }, h('i', { class: 'dot ' + (STATE_TONE[a.state] || 'warn') }), a.state)));
    el.appendChild(h('div', { class: 'meta muted small' },
      a.version ? h('span', { text: /^v/i.test(a.version) ? a.version : 'v' + a.version }) : null, a.mem ? h('span', { text: bytes(a.mem) }) : null, a.cpu != null ? h('span', { text: a.cpu + '% CPU' }) : null));
    if (!a.other) {
      el.appendChild(h('p', { class: 'muted small', text: connectorNote(a) }));
      if (can) {
        const cb = h('input', { type: 'checkbox', checked: a.enabled, 'aria-label': 'Let Liberty AI read ' + a.name, onchange: (e) => toggle(a, e.target.checked, el) });
        el.appendChild(h('label', { class: 'switch' }, cb, h('span', { class: 'sw' }), h('span', { text: 'Let Liberty AI read this app' })));
        if (a.sensitive) el.appendChild(h('p', { class: 'warn-note small' }, icon('lock'), ' Personal data. Stays on this server unless you allow cloud for apps in Settings.'));
      }
    }
    const acts = h('div', { class: 'row gap wrap' });
    if (openUrl && a.installed) acts.appendChild(h('a', { class: 'btn small', href: openUrl, target: '_blank', rel: 'noopener' }, icon('open'), 'Open'));
    if (a.enabled && can) acts.appendChild(h('button', { class: 'btn small', type: 'button', onclick: () => showData(a) }, icon('eye'), 'View data'));
    if (a.installed) acts.appendChild(h('button', { class: 'btn small', type: 'button', onclick: () => LA.pages.ask.start({ mode: 'chat', message: 'What is going on with ' + a.name + '?' }) }, icon('chat'), 'Ask'));
    if (a.custom) acts.appendChild(h('button', { class: 'btn small danger', type: 'button', onclick: async () => { await api('POST', '/api/custom/remove', { id: a.id }); load(); } }, icon('trash'), 'Remove'));
    el.appendChild(acts);
    return el;
  }

  function addCustom() {
    const name = h('input', { class: 'input', placeholder: 'Name, e.g. Jellyfin' });
    const url = h('input', { class: 'input', placeholder: 'http://jellyfin_server_1:8096/widgets/status' });
    modal('Add a custom connector', h('div', { class: 'form' },
      h('p', { class: 'muted', text: 'Point Liberty AI at any read-only JSON address on your home network: an Umbrel widget, or a page that returns { "title": "...", "lines": ["..."] }.' }),
      h('label', null, 'Name', name), h('label', null, 'Address', url)),
    (close) => [h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', type: 'button', onclick: async () => {
      try { await api('POST', '/api/custom', { name: name.value, url: url.value }); close(); load(); } catch (e) { toast(e.message, 'crit'); }
    } }, 'Add')]);
  }

  async function load() {
    try {
      const r = await api('GET', '/api/apps');
      if (!host || !host.isConnected) return;
      clear(host);
      const patriot = r.apps.filter((a) => a.patriot && a.installed);
      const missing = r.apps.filter((a) => a.patriot && !a.installed);
      const custom = r.apps.filter((a) => a.custom);
      const others = r.apps.filter((a) => a.other);
      host.appendChild(h('h3', { class: 'sec', text: 'Patriot Apps (' + patriot.length + ' installed)' }));
      host.appendChild(h('div', { class: 'grid' }, patriot.length ? patriot.map(card) : h('p', { class: 'muted', text: 'None of the Patriot Apps are installed yet.' })));
      host.appendChild(h('div', { class: 'sec-row' }, h('h3', { class: 'sec', text: 'Custom connectors' }), h('button', { class: 'btn small', type: 'button', onclick: addCustom }, icon('plus'), 'Add')));
      host.appendChild(h('div', { class: 'grid' }, custom.length ? custom.map(card) : h('p', { class: 'muted', text: 'Connect any read-only JSON source on your network.' })));
      if (others.length) {
        host.appendChild(h('h3', { class: 'sec', text: 'Other apps on this Umbrel (' + others.length + ')' }));
        host.appendChild(h('div', { class: 'grid compact' }, others.map(card)));
      }
      if (missing.length) {
        host.appendChild(h('h3', { class: 'sec', text: 'Not installed' }));
        host.appendChild(h('div', { class: 'grid compact' }, missing.map(card)));
      }
    } catch (e) { if (host) { clear(host); host.appendChild(h('div', { class: 'banner crit' }, icon('alert'), h('span', { text: e.message }))); } }
  }

  function render(into) {
    host = h('div', { class: 'apps' }, h('p', { class: 'muted', text: 'Loading…' }));
    into.appendChild(h('section', { class: 'page' },
      h('div', { class: 'page-head' }, h('h2', { text: 'Your apps' }),
        h('p', { class: 'muted', text: 'Everything on your Umbrel in one place. Turn an app on and Liberty AI can answer questions about its data. Off by default, read-only always.' })),
      host));
    load();
  }

  LA.pages.apps = { render, leave() { host = null; } };
})();
