import { BOOKS } from './engine.js';
import { esc, api, toast, fmtBytes, fmtDate, download } from './ui.js';
import { href, readHref } from './nav.js';

// ------------------------------------------------------------------ Ask
export async function askView(ctx, r, root) {
  const E = ctx.engine;
  let settings = null;
  try { settings = await api('settings'); } catch { /* shown below */ }
  const ready = settings && settings.ollama.baseUrl && settings.ollama.model;
  const q0 = r.q.get('q') || '';
  root.innerHTML = `<h1>Ask</h1>
    <p class="muted">Ask a question in plain words. Bible Terminal finds the most relevant verses in the King James text, then your own local AI model on your Umbrel answers <i>from those verses only</i>. Nothing leaves your Umbrel.</p>
    ${ready ? '' : `<div class="card warn">Your AI model isn't set up yet. You can still see the verses Bible Terminal finds. To get written answers, open <a href="#/settings">Settings</a> and enter your Ollama address and model.</div>`}
    <form id="af" class="card"><textarea id="aq" rows="2" placeholder="What does the Bible say about forgiveness?  ·  Who was Melchizedek?  ·  What happened at Pentecost?" aria-label="Your question">${esc(q0)}</textarea>
      <div class="row" style="margin-top:.5rem"><button class="primary" id="go">ask</button><span class="muted">${ready ? 'model: ' + esc(settings.ollama.model) : ''}</span></div></form>
    <div id="out"></div>`;
  const out = root.querySelector('#out');
  let abort = null;
  async function ask(q) {
    if (abort) abort.abort();
    const passages = E.related(q, 8);
    out.innerHTML = `<div class="card"><h2>Answer</h2><div id="ans" class="answer muted">${ready ? 'Thinking…' : 'No model set up.'}</div><p id="aerr" class="bad"></p></div>
      <h2>Passages used</h2><div class="card" id="pas">${passages.length ? passages.map((p, i) => {
        const a = E.at(p.idx);
        return `<div class="hit" id="p${i + 1}"><a class="ref" href="${readHref(a.id, a.c, a.v, p.len)}">[${i + 1}] ${esc(p.label)}</a><span class="vt">${esc(p.text.length > 400 ? p.text.slice(0, 400) + '…' : p.text)}</span></div>`;
      }).join('') : '<p class="muted">No matching verses found. Try different words.</p>'}</div>`;
    if (!ready) return;
    const ans = out.querySelector('#ans'), err = out.querySelector('#aerr');
    abort = new AbortController();
    let text = '';
    try {
      const res = await fetch('api/ask', { method: 'POST', signal: abort.signal, headers: { 'content-type': 'application/json', 'x-bt': '1' },
        body: JSON.stringify({ question: q, passages: passages.map(p => ({ ref: p.label, text: p.text })) }) });
      if (!res.ok) { let j = {}; try { j = await res.json(); } catch { /* */ } throw new Error(j.error || 'HTTP ' + res.status); }
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = '';
      ans.classList.remove('muted'); ans.textContent = '';
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let k;
        while ((k = buf.indexOf('\n\n')) >= 0) {
          const line = buf.slice(0, k).replace(/^data: /, ''); buf = buf.slice(k + 2);
          let o; try { o = JSON.parse(line); } catch { continue; }
          if (o.t) { text += o.t; ans.innerHTML = esc(text).replace(/\[(\d{1,2})\]/g, '<a class="cite" href="#p$1">[$1]</a>'); }
          if (o.error) throw new Error(o.error);
        }
      }
      if (!text) ans.textContent = '(The model returned nothing.)';
    } catch (e) { if (e.name !== 'AbortError') { err.textContent = e.message; if (!text) ans.textContent = ''; } }
  }
  root.querySelector('#af').addEventListener('submit', e => {
    e.preventDefault();
    const q = root.querySelector('#aq').value.trim();
    if (q) { history.replaceState(null, '', href('ask', [], { q })); ask(q); }
  });
  root.querySelector('#aq').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); root.querySelector('#af').requestSubmit(); } });
  if (q0) ask(q0);
  return () => abort && abort.abort();
}

// ------------------------------------------------------------------ Verify
export async function verifyView(ctx, r, root) {
  const chain = ctx.engine.onchain;
  let timer = null, stopped = false;
  root.innerHTML = `<h1>Verify</h1>
    <p>The King James text in this app was read from <b>66 Bitcoin transactions</b> (one per book). Verify downloads those transactions again, pulls the text back out, and checks that it is <b>exactly</b> what this app shows. It proves the app isn't showing you altered text.</p>
    <div class="card" id="box"></div>
    <details class="card"><summary>What exactly is checked?</summary>
      <p>For each book: the inscription is fetched from the Bitcoin transaction, a SHA-256 fingerprint of the exact bytes is computed and compared with the one recorded when the app was built, and the verses read from the inscription are compared word-for-word with the bundled text.</p>
      <p><b>About the text as inscribed:</b> it is the King James Version as someone inscribed it — a modern-spelling edition with a few typographical quirks. Bible Terminal shows it exactly as inscribed and does not correct it. Bitcoin proves <i>this is what was inscribed</i>; it can't prove the inscriber's copy matched any particular printing. About 90 verses differ in tiny spelling or punctuation details from other KJV editions.</p>
      <p>By default this check asks the public mempool.space website. To keep everything on your own hardware, point it at your own explorer or Bitcoin node in <a href="#/settings">Settings</a>.</p></details>
    <div class="card" id="books"></div>`;
  const box = root.querySelector('#box'), books = root.querySelector('#books');
  const stateTxt = s => s === 'ok' ? '<span class="state-ok">✓ verified</span>' : s === 'mismatch' ? '<span class="state-bad">✗ DIFFERENT</span>' : s === 'error' ? '<span class="state-err">! could not check</span>' : '<span class="muted">…</span>';
  function draw(st) {
    const running = st.state === 'running';
    box.innerHTML = `${st.state === 'never' ? '<p class="muted">Not checked yet.</p>' : `<p><b class="good">${st.ok}</b> of ${st.total} books verified${st.mismatch ? ` · <b class="bad">${st.mismatch} different</b>` : ''}${st.error ? ` · <b class="warn">${st.error} could not be checked</b>` : ''}<br><span class="muted">via ${esc(st.source || '')}${st.finishedAt ? ' · finished ' + fmtDate(st.finishedAt) : running ? ' · running…' : ''}</span></p>
      ${running ? `<div class="bar"><i style="width:${Math.round(st.done / st.total * 100)}%"></i></div>` : ''}`}
      <button class="primary" id="run"${running ? ' disabled' : ''}>${st.state === 'never' ? 'verify all 66 books' : 'verify again'}</button>`;
    const res = st.results || {};
    books.innerHTML = `<table><tr><th>Book</th><th>Status</th><th class="hide-s">Size</th><th class="hide-s">SHA-256 of the inscription</th><th>Transaction</th></tr>${chain.books.map(b => {
      const x = res[b.id];
      return `<tr><td>${esc(b.name)}</td><td>${stateTxt(x && x.status)}${x && x.message ? `<div class="muted" style="font-size:.85em">${esc(x.message)}</div>` : ''}</td><td class="muted hide-s">${fmtBytes(b.bytes)}</td><td class="hide-s"><code title="${b.sha256}">${b.sha256.slice(0, 12)}…</code></td><td><a href="https://mempool.space/tx/${b.txid}" target="_blank" rel="noopener noreferrer"><code>${b.txid.slice(0, 10)}…</code></a></td></tr>`;
    }).join('')}</table>`;
    box.querySelector('#run')?.addEventListener('click', start);
  }
  async function poll() {
    if (stopped) return;
    try {
      const st = await api('verify'); draw(st);
      if (st.state === 'running') timer = setTimeout(poll, 1000);
    } catch (e) { box.innerHTML = `<p class="bad">${esc(e.message)}</p>`; }
  }
  async function start() { try { draw(await api('verify/start', { method: 'POST', body: {} })); timer = setTimeout(poll, 1000); } catch (e) { toast(e.message); } }
  await poll();
  return () => { stopped = true; clearTimeout(timer); };
}

// ------------------------------------------------------------------ Hotspot
export async function hotspotView(ctx, r, root) {
  let timer = null, stopped = false;
  root.innerHTML = `<h1>Scripture hotspot</h1>
    <p>Turn a <b>Raspberry Pi Zero 2 W</b> and a micro-SD card into a tiny Wi-Fi hotspot that serves this whole Bible — as a phone-first app (read, search, timeline, and a private group chat) to anyone nearby, with <b>no internet and no cell service</b>. Phones join the Wi-Fi and the Bible opens automatically.</p>
    <div class="card warn"><b>Experimental.</b> The image is assembled for you and tested for correctness here, but I couldn't try it on every Pi. If your Pi doesn't come up, put the card back in your computer and read <code>bootfs/bible-terminal/firstrun.log</code>, or use the manual files below.</div>
    <form id="hf" class="card">
      <div class="grid2"><div><label class="f" for="ssid">Wi-Fi name</label><input type="text" id="ssid" value="Bible Terminal" maxlength="32">
        <label class="f" for="psk">Wi-Fi password <span class="muted">(8+ characters, or leave empty for an open hotspot)</span></label><input type="text" id="psk" value="" maxlength="63" autocomplete="off">
        <label class="f" for="cc">Country code <span class="muted">(Wi-Fi rules, e.g. US)</span></label><input type="text" id="cc" value="US" maxlength="2" style="width:5em"></div>
      <div><label class="f" for="appname">Name on the phone's home screen <span class="muted">(shown if someone adds it as an app; keep it plain)</span></label><input type="text" id="appname" value="Scripture" maxlength="24">
        <p class="muted">The hotspot is a separate phone-first app: <b>Read, Search, Timeline, Chat and About</b>, plus a quick-hide button that turns the screen into a calculator. Chat is in memory only and clears when the Pi restarts.</p>
        <p class="muted">Text size and last place read stay on each visitor's own phone.</p></div></div>
      <div class="row"><button type="button" class="primary" id="build">build SD card image</button><button type="button" id="zipbtn">download setup files instead (.zip)</button></div>
      <div id="msg" class="bad" role="alert"></div></form>
    <div class="card" id="job" hidden></div>
    <details class="card"><summary>How do I use the image?</summary><ol>
      <li>Wait for the build (about 1 GB download, then a few minutes).</li>
      <li>Download the <code>.img.xz</code> file to your computer.</li>
      <li>Open <b>Raspberry Pi Imager</b> (or balenaEtcher) → choose <i>Use custom</i> / <i>Flash from file</i> → pick the file → choose your SD card → write. Do not change any of Imager's settings.</li>
      <li>Put the card in the Pi Zero 2 W and power it on. The first start takes a couple of minutes and restarts once.</li>
      <li>On a phone, join the Wi-Fi. A sign-in page opens the Bible; if not, browse to <code>http://10.42.0.1</code>.</li></ol>
      <p class="muted">The image also contains a login for the Pi itself (user <code>bible</code>, with a random password shown once when the build finishes). The hotspot serves read-only files and keeps no data about visitors.</p></details>`;
  const $ = s => root.querySelector(s);
  const opts = () => ({ ssid: $('#ssid').value, password: $('#psk').value, country: $('#cc').value, appName: $('#appname').value });
  const PH = { download: 'Downloading Raspberry Pi OS', unpack: 'Unpacking', patch: 'Adding the Bible', compress: 'Compressing', done: 'Done', starting: 'Starting' };
  function draw(st) {
    const j = $('#job'); j.hidden = st.state === 'idle' && !st.outputs.length;
    if (j.hidden) return;
    let h = '';
    if (st.state === 'running') h = `<h2>Building…</h2><p>${esc(PH[st.phase] || st.phase)} ${st.phase === 'download' ? st.pct + '%' : ''}</p><div class="bar"><i style="width:${st.phase === 'download' ? st.pct : 100}%"></i></div><p class="muted">You can leave this page; the build keeps going.</p>`;
    else if (st.state === 'failed') h = `<h2 class="bad">The build failed</h2><p>${esc(st.error)}</p>`;
    else if (st.state === 'done' && st.login) h = `<h2 class="good">Your image is ready</h2><p>Write down the Pi's login (shown once): user <code>${esc(st.login.user)}</code> password <code>${esc(st.login.password)}</code></p>`;
    if (st.outputs.length) h += `<p>${st.outputs.map(o => `<a class="chip on" href="api/hotspot/image/download/${encodeURIComponent(o.name)}" download>⬇ ${esc(o.name)} (${fmtBytes(o.bytes)})</a>`).join('')}</p>`;
    j.innerHTML = h;
  }
  async function poll() {
    if (stopped) return;
    try { const st = await api('hotspot/image'); draw(st); if (st.state === 'running') timer = setTimeout(poll, 1500); } catch { /* ignore */ }
  }
  $('#build').onclick = async () => {
    $('#msg').textContent = '';
    try { draw(await api('hotspot/image/start', { method: 'POST', body: opts() })); timer = setTimeout(poll, 1500); } catch (e) { $('#msg').textContent = e.message; }
  };
  $('#zipbtn').onclick = async () => {
    $('#msg').textContent = '';
    try {
      const res = await fetch('api/hotspot/zip', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bt': '1' }, body: JSON.stringify(opts()) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'HTTP ' + res.status); }
      const blob = await res.blob();
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'bible-terminal-hotspot-files.zip'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) { $('#msg').textContent = e.message; }
  };
  await poll();
  return () => { stopped = true; clearTimeout(timer); };
}

// ------------------------------------------------------------------ Settings
export async function settingsView(ctx, r, root) {
  const store = ctx.store;
  let s;
  try { s = await api('settings'); } catch (e) { root.innerHTML = `<h1>Settings</h1><p class="bad">${esc(e.message)}</p>`; return; }
  const skin = ({ paper: 'scriptorium', ice: 'blueprint' })[store.pref('skin', 'phosphor')] || store.pref('skin', 'phosphor'), size = store.pref('size', 1);
  root.innerHTML = `<h1>Settings</h1>
    <div class="card"><h2>Look</h2><div class="row"><span class="muted">Colors:</span>${ctx.skins.map(k => `<button data-skin="${k}"${k === skin ? ' class="primary"' : ''}>${k}</button>`).join('')}</div>
      <div class="row" style="margin-top:.6rem"><span class="muted">Text size:</span><input type="range" id="size" min="0.8" max="1.6" step="0.1" value="${size}" style="width:12rem" aria-label="Text size"></div></div>
    <form id="sf" class="card"><h2>Ask: your local AI</h2>
      <p class="muted">Bible Terminal talks to an <b>Ollama</b> server you run yourself (for example the Ollama app on Umbrel). Enter its address as seen from this app, like <code>http://ollama_ollama_1:11434</code> or <code>http://umbrel.local:11434</code>.</p>
      <label class="f" for="ou">Ollama address</label><input type="text" id="ou" value="${esc(s.ollama.baseUrl)}" placeholder="http://umbrel.local:11434">
      <label class="f" for="om">Model</label><div class="row"><input type="text" id="om" class="grow" list="models" value="${esc(s.ollama.model)}" placeholder="llama3.2"><datalist id="models"></datalist><button type="button" id="find">find models</button></div>
      <h2 style="margin-top:1.2rem">Verify: how to reach Bitcoin</h2>
      <label class="f" for="vm">Source</label><select id="vm"><option value="public">Public explorer (mempool.space) — easiest</option><option value="rest">My own explorer (mempool / esplora)</option><option value="rpc">My own Bitcoin node (RPC; needs txindex=1)</option></select>
      <div id="vrest"><label class="f" for="vr">Explorer address (API root)</label><input type="text" id="vr" value="${esc(s.verify.restUrl)}" placeholder="http://mempool_web_1:3006/api"></div>
      <div id="vrpc"><label class="f" for="vu">Node address</label><input type="text" id="vu" value="${esc(s.verify.rpcUrl)}" placeholder="http://bitcoin_bitcoind_1:8332">
        <label class="f" for="vn">RPC user</label><input type="text" id="vn" value="${esc(s.verify.rpcUser)}" autocomplete="off">
        <label class="f" for="vp">RPC password ${s.verify.hasRpcPass ? '<span class="good">(saved — leave blank to keep)</span>' : ''}</label><input type="password" id="vp" autocomplete="new-password"></div>
      <p style="margin-top:1rem"><button class="primary">save</button> <span id="smsg"></span></p></form>
    <div class="card"><h2>Your data</h2><p class="muted">Bookmarks, notes, highlights, plan progress and memory cards live in a small file on your Umbrel.</p>
      <div class="row"><button id="bk">download a backup (.json)</button><label class="chip" for="rs">restore from backup…</label><input type="file" id="rs" accept="application/json" hidden></div></div>`;
  const $ = q => root.querySelector(q);
  $('#vm').value = s.verify.mode;
  const vis = () => { $('#vrest').hidden = $('#vm').value !== 'rest'; $('#vrpc').hidden = $('#vm').value !== 'rpc'; };
  vis(); $('#vm').onchange = vis;
  root.querySelectorAll('[data-skin]').forEach(b => b.onclick = () => { store.setPref('skin', b.dataset.skin); document.documentElement.dataset.skin = b.dataset.skin; root.querySelectorAll('[data-skin]').forEach(x => x.className = x === b ? 'primary' : ''); });
  $('#size').oninput = e => { store.setPref('size', +e.target.value); document.documentElement.style.setProperty('--size', e.target.value); };
  $('#find').onclick = async () => {
    $('#smsg').textContent = '';
    try {
      await api('settings', { method: 'PUT', body: { ollama: { baseUrl: $('#ou').value } } });
      const { models } = await api('ask/models');
      $('#models').innerHTML = models.map(m => `<option value="${esc(m)}">`).join('');
      $('#smsg').className = 'good'; $('#smsg').textContent = models.length ? `Found ${models.length} model${models.length === 1 ? '' : 's'} — pick one above.` : 'Connected, but no models are installed yet.';
      if (models.length && !$('#om').value) $('#om').value = models[0];
    } catch (e) { $('#smsg').className = 'bad'; $('#smsg').textContent = e.message; }
  };
  $('#sf').addEventListener('submit', async e => {
    e.preventDefault();
    const body = { ollama: { baseUrl: $('#ou').value, model: $('#om').value }, verify: { mode: $('#vm').value, restUrl: $('#vr').value, rpcUrl: $('#vu').value, rpcUser: $('#vn').value } };
    if ($('#vp').value) body.verify.rpcPass = $('#vp').value;
    try { await api('settings', { method: 'PUT', body }); $('#vp').value = ''; $('#smsg').className = 'good'; $('#smsg').textContent = 'Saved.'; }
    catch (err) { $('#smsg').className = 'bad'; $('#smsg').textContent = err.message; }
  });
  $('#bk').onclick = () => download('bible-terminal-backup.json', JSON.stringify(store.doc, null, 2), 'application/json');
  $('#rs').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (!j || typeof j !== 'object' || !('bookmarks' in j)) throw new Error('That does not look like a Bible Terminal backup.');
      if (!confirm('Replace your current bookmarks, notes and progress with this backup?')) return;
      store.change(d => { for (const k of ['bookmarks', 'highlights', 'notes', 'plans', 'cards', 'prefs']) if (k in j) d[k] = j[k]; });
      await store.flush(); toast('Restored'); location.reload();
    } catch (err) { toast(err.message); }
  };
}

// ------------------------------------------------------------------ About
export async function aboutView(ctx, r, root) {
  const m = ctx.engine.manifest;
  root.innerHTML = `<h1>About Bible Terminal</h1>
    <div class="card"><p>A quiet study desk for the King James Bible. It runs entirely on your own Umbrel (or on a Pi hotspot): no accounts, no tracking, no ads, no outside services unless you choose them.</p>
      <p>Version ${esc(ctx.cfg.version || '')} · Open source (MIT) · Not affiliated with any publisher, church or ministry.</p></div>
    <div class="card"><h2>Where the Bible comes from</h2>
      <p>The King James text was <b>read straight from Bitcoin</b>: 66 inscriptions, one per book. Use <a href="#/verify">Verify</a> to check it yourself. The text is shown <i>exactly as inscribed</i> — it is not corrected, so you may notice rare spelling or punctuation quirks that differ from your printed Bible.</p>
      <p class="muted">Built ${esc(m.builtAt)} · ${m.kjvVerses.toLocaleString()} verses</p></div>
    <div class="card"><h2>Data and licenses</h2><table>
      <tr><td>King James Version</td><td>${esc(m.sources.kjv)}</td></tr>
      <tr><td>World English Bible</td><td>${esc(m.sources.web)}</td></tr>
      <tr><td>Cross-references</td><td>${esc(m.sources.xref)} — Treasury of Scripture Knowledge, via OpenBible.info.</td></tr>
      <tr><td>Strong’s</td><td>${esc(m.sources.strongs)}</td></tr></table></div>
    <div class="card help"><h2>Keyboard</h2><table>
      <tr><td>/</td><td>jump to the command bar</td></tr><tr><td>← →</td><td>previous / next chapter</td></tr><tr><td>Shift-click</td><td>select a range of verses</td></tr><tr><td>Esc</td><td>leave a text box</td></tr></table></div>`;
}
