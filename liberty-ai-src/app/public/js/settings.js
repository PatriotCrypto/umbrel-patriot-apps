// Settings: which AI to use, what it may see, alerts, look, and the audit log.
(function () {
  'use strict';
  const { h, clear, icon, api, toast, modal, ago, bytes, S } = LA;
  let host = null;
  let modelList = null;

  const THEMES = [
    { id: 'liberty', name: 'Liberty', note: 'Navy, gold and red' },
    { id: 'terminal', name: 'Terminal', note: 'Green phosphor' },
    { id: 'glass', name: 'Glass', note: 'Frosted aurora' },
    { id: 'daylight', name: 'Daylight', note: 'Clean and bright' },
  ];

  async function put(patch, quiet) {
    try {
      const r = await api('PUT', '/api/settings', patch);
      S.state.settings = r.settings;
      if (!quiet) toast('Saved', 'ok');
      await LA.refreshState();
      return true;
    } catch (e) { toast(e.message, 'crit'); return false; }
  }

  function field(label, input, help) {
    return h('label', { class: 'field' }, h('span', { class: 'lbl', text: label }), input, help ? h('small', { class: 'muted', text: help }) : null);
  }

  function providerCard(id, title, badge, desc, active) {
    return h('button', { class: 'pcard' + (active ? ' on' : ''), type: 'button', onclick: async () => { if (await put({ provider: id }, true)) { modelList = null; paint(); } } },
      h('div', { class: 'pc-top' }, h('b', { text: title }), h('span', { class: 'badge ' + (badge === 'Local' ? 'ok' : 'warn') }, icon(badge === 'Local' ? 'home' : 'cloud'), badge)), h('small', { class: 'muted', text: desc }));
  }

  function aiSection(s) {
    const sec = h('section', { class: 'card glass' }, h('h3', { text: 'Which AI do I use?' }),
      h('div', { class: 'pcards' },
        providerCard('ollama', 'Ollama', 'Local', 'Runs on your own hardware. Private. Install the Ollama app on your Umbrel.', s.provider === 'ollama'),
        providerCard('anthropic', 'Claude', 'Cloud', 'Much smarter, needs your own API key. Text I send goes to Anthropic.', s.provider === 'anthropic'),
        providerCard('openai', 'Other server', 'Local', 'Any OpenAI-compatible server: llama.cpp, LM Studio, vLLM, Open WebUI.', s.provider === 'openai')));
    const dl = h('datalist', { id: 'models' }, (modelList || []).map((m) => h('option', { value: m })));
    const modelBtn = (label) => h('button', { class: 'btn small', type: 'button', onclick: async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try { const r = await api('GET', '/api/models'); modelList = r.models; paint(); toast(r.models.length + ' model' + (r.models.length === 1 ? '' : 's') + ' found', 'ok'); } catch (er) { toast(er.message, 'crit'); b.disabled = false; }
    } }, icon('refresh'), label);
    const keyBox = (name, has, ph) => {
      const inp = h('input', { class: 'input', type: 'password', autocomplete: 'off', placeholder: has ? 'Saved. Type a new key to replace it' : ph });
      return h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'API key' }),
        h('div', { class: 'row gap' }, inp,
          h('button', { class: 'btn', type: 'button', onclick: async () => { if (!inp.value.trim()) return; try { await api('PUT', '/api/secrets', { [name]: inp.value.trim() }); inp.value = ''; toast('Key saved', 'ok'); await LA.refreshState(); paint(); } catch (e) { toast(e.message, 'crit'); } } }, 'Save key'),
          has ? h('button', { class: 'btn danger', type: 'button', onclick: async () => { await api('PUT', '/api/secrets', { [name]: '' }); toast('Key removed'); await LA.refreshState(); paint(); } }, 'Remove') : null),
        h('small', { class: 'muted', text: 'Stored on this server only, never shown again, never put in chats or logs. Type it here, not into a chat.' }));
    };
    if (s.provider === 'ollama') {
      const url = h('input', { class: 'input', value: s.ollama.url, onchange: (e) => put({ ollama: { url: e.target.value } }) });
      const model = h('input', { class: 'input', value: s.ollama.model, list: 'models', placeholder: 'e.g. llama3.2:3b', onchange: (e) => put({ ollama: { model: e.target.value } }) });
      const ctx = h('input', { class: 'input', type: 'number', min: '2048', step: '1024', value: s.ollama.numCtx, onchange: (e) => put({ ollama: { numCtx: Number(e.target.value) } }) });
      sec.appendChild(h('div', { class: 'form' }, field('Ollama address', url, 'On Umbrel this is usually http://ollama_ollama_1:11434'),
        field('Model', h('div', { class: 'row gap' }, model, modelBtn('Find models')), 'Small models (3B to 8B) are fine for the Doctor and for searching your files.'), dl,
        field('Memory window (tokens)', ctx, 'Bigger lets me read more at once but uses more RAM. 8192 is a good start.')));
    } else if (s.provider === 'anthropic') {
      const model = h('input', { class: 'input', value: s.anthropic.model, list: 'models', onchange: (e) => put({ anthropic: { model: e.target.value } }) });
      sec.appendChild(h('div', { class: 'form' }, keyBox('anthropicKey', s.keys.anthropic, 'sk-ant-…'),
        field('Model', h('div', { class: 'row gap' }, model, modelBtn('Find models')), 'Default is claude-sonnet-5-5. Smaller models cost less.'), dl,
        h('div', { class: 'banner info' }, icon('cloud'), h('span', { text: 'Claude is a cloud service. By default only your server health snapshot may be sent. Logs, app data and files stay here unless you allow them below.' }))));
    } else {
      const url = h('input', { class: 'input', value: s.openai.url, placeholder: 'http://localhost:8080', onchange: (e) => put({ openai: { url: e.target.value } }) });
      const model = h('input', { class: 'input', value: s.openai.model, list: 'models', onchange: (e) => put({ openai: { model: e.target.value } }) });
      sec.appendChild(h('div', { class: 'form' }, field('Server address', url, 'Addresses on your home network count as local. Public addresses count as cloud.'),
        field('Model', h('div', { class: 'row gap' }, model, modelBtn('Find models'))), dl, keyBox('openaiKey', s.keys.openai, 'Only if your server needs one')));
    }
    return sec;
  }

  function sw(label, checked, onchange, help) {
    return h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked, onchange: (e) => onchange(e.target.checked) }), h('span', { class: 'sw' }), h('span', null, label, help ? h('small', { class: 'muted block', text: help }) : null));
  }

  function privacySection(s) {
    const rows = [
      ['health', 'Server health', 'CPU, memory, disks, app states, findings'],
      ['logs', 'App logs', 'Recent log lines of apps that have problems (secrets scrubbed first)'],
      ['apps', 'App data', 'Summaries from the Patriot apps you switch on'],
      ['files', 'Your files', 'Passages from folders you chose'],
    ];
    const t = h('table', { class: 'tbl matrix' }, h('thead', null, h('tr', null, h('th', { text: 'Source' }), h('th', { class: 'c', text: 'Use it' }), h('th', { class: 'c', text: 'May go to a cloud AI' }))),
      h('tbody', null, rows.map(([k, name, desc]) => h('tr', null,
        h('td', null, h('b', { text: name }), h('small', { class: 'muted block', text: desc })),
        h('td', { class: 'c' }, h('input', { type: 'checkbox', checked: s.sources[k].enabled, 'aria-label': 'Use ' + name, onchange: (e) => put({ sources: { [k]: { enabled: e.target.checked } } }) })),
        h('td', { class: 'c' }, h('input', { type: 'checkbox', checked: s.sources[k].cloud, 'aria-label': name + ' may go to a cloud AI', onchange: (e) => put({ sources: { [k]: { cloud: e.target.checked } } }) }))))));
    return h('section', { class: 'card glass' }, h('h3', null, icon('shield'), ' What the AI may see'),
      h('p', { class: 'muted', text: 'With a local AI everything you allow stays on your own network. With a cloud AI only the boxes ticked in the right-hand column are ever sent. Every request is recorded below so you can check.' }),
      sw('Local-only mode', s.localOnly, (v) => put({ localOnly: v }), 'Refuse to use any cloud AI at all, whatever is selected above.'), t);
  }

  function alertsSection(s) {
    const n = s.ntfy;
    const server = h('input', { class: 'input', value: n.server, onchange: (e) => put({ ntfy: { server: e.target.value } }) });
    const topic = h('input', { class: 'input', value: n.topic, placeholder: 'a-long-private-topic-name', onchange: (e) => put({ ntfy: { topic: e.target.value } }) });
    const sev = h('select', { class: 'input', onchange: (e) => put({ ntfy: { minSeverity: e.target.value } }) }, h('option', { value: 'crit', text: 'Only urgent problems', selected: n.minSeverity === 'crit' }), h('option', { value: 'warn', text: 'Urgent problems and warnings', selected: n.minSeverity === 'warn' }));
    const every = h('select', { class: 'input', onchange: (e) => put({ checkIntervalMin: Number(e.target.value) }) }, [5, 10, 15, 30, 60].map((m) => h('option', { value: m, text: 'Every ' + m + ' minutes', selected: s.checkIntervalMin === m })));
    return h('section', { class: 'card glass' }, h('h3', null, icon('bell'), ' Checkups and phone alerts'),
      h('div', { class: 'form' }, field('Check the server', every),
        sw('Send phone alerts with ntfy', n.enabled, (v) => put({ ntfy: { enabled: v } }), 'Install the free ntfy app on your phone and subscribe to your topic.'),
        field('ntfy server', server), field('Topic', topic, 'Anyone who knows the topic can read the alerts, so make it long and hard to guess.'), field('Alert on', sev),
        h('div', { class: 'row gap' }, h('button', { class: 'btn', type: 'button', onclick: async () => { try { await api('POST', '/api/notify-test', {}); toast('Test sent', 'ok'); } catch (e) { toast(e.message, 'crit'); } } }, 'Send a test'))));
  }

  function lookSection() {
    const cur = document.documentElement.getAttribute('data-theme');
    return h('section', { class: 'card glass' }, h('h3', { text: 'Look' }),
      h('div', { class: 'themes' }, THEMES.map((t) => h('button', { class: 'theme-card th-' + t.id + (cur === t.id ? ' on' : ''), type: 'button', onclick: () => { LA.setTheme(t.id); paint(); } }, h('span', { class: 'swatch' }), h('b', { text: t.name }), h('small', { class: 'muted', text: t.note })))));
  }

  async function auditSection() {
    const box = h('div', { class: 'audit' }, h('p', { class: 'muted', text: 'Loading…' }));
    const sec = h('section', { class: 'card glass' }, h('h3', null, icon('eye'), ' What the AI saw'),
      h('p', { class: 'muted', text: 'Every question I send to an AI is logged here with the exact sources included and which ones were held back. The full text is kept for the 20 most recent.' }), box);
    try {
      const r = await api('GET', '/api/audit');
      clear(box);
      if (!r.entries.length) box.appendChild(h('p', { class: 'muted', text: 'Nothing yet.' }));
      for (const a of r.entries.slice(0, 30)) {
        box.appendChild(h('button', { class: 'audit-row', type: 'button', onclick: () => showAudit(a.id) },
          h('span', { class: 'badge ' + (a.cloud ? 'warn' : 'ok') }, icon(a.cloud ? 'cloud' : 'home'), a.cloud ? 'Cloud' : 'Local'),
          h('span', { class: 'q', text: a.question }),
          h('small', { class: 'muted', text: ago(a.t) + ' · ' + a.sources.length + ' source' + (a.sources.length === 1 ? '' : 's') + (a.blocked.length ? ' · ' + a.blocked.length + ' held back' : '') + ' · ' + bytes(a.chars) + (a.error ? ' · ' + a.error : '') })));
      }
      if (r.entries.length) box.appendChild(h('button', { class: 'btn small danger', type: 'button', onclick: async () => { await api('POST', '/api/audit/clear', {}); paint(); } }, icon('trash'), 'Clear log'));
    } catch (e) { clear(box); box.appendChild(h('p', { class: 'muted', text: e.message })); }
    return sec;
  }

  async function showAudit(id) {
    try {
      const a = await api('GET', '/api/audit/' + id);
      modal('Exactly what was sent', h('div', null,
        h('p', { class: 'muted small', text: a.provider + (a.model ? ' · ' + a.model : '') + ' · ' + (a.cloud ? 'cloud' : 'local') + ' · ' + new Date(a.t).toLocaleString() }),
        a.blocked.length ? h('p', { class: 'warn-note small', text: 'Held back: ' + a.blocked.map((b) => b.kind + ' (' + b.why + ')').join('; ') }) : null,
        a.prompt ? h('pre', { class: 'excerpt tall', text: a.prompt }) : h('p', { class: 'muted', text: 'The full text is only kept for the 20 most recent requests.' })));
    } catch (e) { toast(e.message, 'crit'); }
  }

  function aboutSection(s) {
    const g = S.state.guard;
    const guardText = { active: 'Active. Only the Umbrel app proxy (and this app itself) can reach me.', off: 'Off (demo or developer mode).', unresolved: 'Not active: I could not find the Umbrel proxy by name, so any container on the network can reach me.', unconfigured: 'Not configured.' }[g] || g;
    return h('section', { class: 'card glass' }, h('h3', { text: 'About' }),
      h('ul', { class: 'plain' },
        h('li', null, h('b', { text: 'Version ' }), S.state.version),
        h('li', null, h('b', { text: 'Network guard: ' }), guardText),
        h('li', null, h('b', { text: 'Docker access: ' }), S.state.docker ? 'Read-only (list apps, read logs and stats)' : 'Not available'),
        h('li', null, h('b', { text: 'Storage: ' }), 'Mounted read-only. I can not change a file.')),
      h('div', { class: 'row gap wrap' }, h('button', { class: 'btn small danger', type: 'button', onclick: async () => { await api('POST', '/api/chats/clear', {}); toast('Chats cleared'); } }, icon('trash'), 'Delete all chats')),
      h('p', { class: 'muted small', text: 'Liberty AI is an independent community app for Umbrel. Not affiliated with Umbrel, Anthropic or any AI vendor. AI can be wrong: check anything important.' }));
  }

  async function paint() {
    if (!host) return;
    const s = S.state.settings;
    const audit = await auditSection();
    if (!host) return;
    clear(host);
    host.appendChild(aiSection(s));
    host.appendChild(privacySection(s));
    host.appendChild(alertsSection(s));
    host.appendChild(lookSection());
    host.appendChild(audit);
    host.appendChild(aboutSection(s));
  }

  async function render(into) {
    host = h('div', { class: 'settings' });
    into.appendChild(h('section', { class: 'page' }, h('div', { class: 'page-head' }, h('h2', { text: 'Settings' }), h('p', { class: 'muted', text: 'You are in charge of what I can see. Changes save as you make them.' })), host));
    await LA.refreshState();
    paint();
  }

  LA.pages.settings = { render, leave() { host = null; } };
})();
