// The Ask page: chat with Liberty AI. Answers show which sources they used.
(function () {
  'use strict';
  const { h, clear, icon, api, stream, md, toast, modal, copyText, S } = LA;
  const KIND = { health: 'pulse', logs: 'file', app: 'grid', file: 'file', lib: 'book' };
  const KIND_LABEL = { health: 'Server health', logs: 'Logs', app: 'App data', file: 'File', lib: 'Library' };

  const chat = { id: null, messages: [], mode: 'chat', busy: false, abort: null, liveEl: null };
  let root = null;
  let threadEl = null;
  let listEl = null;
  let inputEl = null;
  let sendBtn = null;
  let modeBtns = null;
  let sideOpen = false;

  function showSource(src) {
    modal(src.label || 'Source', h('div', { class: 'srcview' },
      h('div', { class: 'srcmeta' }, h('span', { class: 'chip kind-' + src.kind }, icon(KIND[src.kind] || 'file'), KIND_LABEL[src.kind] || 'Source'), src.path ? h('code', { text: src.path }) : null),
      h('pre', { class: 'excerpt', text: src.excerpt || '' }),
      h('p', { class: 'muted small', text: 'This is the exact text the AI was given for this source.' })));
  }

  function sourceChips(sources, blocked) {
    const wrap = h('div', { class: 'srcs' });
    for (const s of sources || []) {
      wrap.appendChild(h('button', { class: 'chip src kind-' + s.kind, type: 'button', title: s.label, onclick: () => showSource(s) },
        h('b', { text: s.n }), h('span', { text: shortLabel(s) })));
    }
    for (const b of blocked || []) {
      wrap.appendChild(h('button', { class: 'chip blocked', type: 'button', title: 'Open Settings', onclick: () => LA.go('settings') }, icon('lock'),
        h('span', { text: (KIND_LABEL[b.kind] || b.kind) + ' not used: ' + b.why })));
    }
    return wrap;
  }

  function shortLabel(s) {
    if (s.kind === 'file') return (s.path || s.label).split('/').pop();
    return s.label.replace(/ \(.*$/, '').replace(/^Recent log lines: /, 'Log: ').replace(/^App data: /, '');
  }

  function bubble(m) {
    if (m.role === 'user') return h('div', { class: 'msg user' }, h('div', { class: 'bub', text: m.content }));
    const body = h('div', { class: 'body' });
    const wrap = h('div', { class: 'msg bot' }, h('div', { class: 'avatar' }, h('img', { src: '/icon.svg', alt: '' })), h('div', { class: 'bub' }, body));
    wrap._body = body;
    wrap._m = m;
    renderBody(wrap);
    return wrap;
  }

  function renderBody(wrap) {
    const m = wrap._m;
    clear(wrap._body);
    const cite = (n) => { const s = (m.sources || []).find((x) => x.n === n); if (s) showSource(s); };
    wrap._body.appendChild(md(m.content || '', cite));
    const bub = wrap.querySelector('.bub');
    bub.querySelectorAll('.srcs, .foot').forEach((e) => e.remove());
    if ((m.sources && m.sources.length) || (m.blocked && m.blocked.length)) bub.appendChild(sourceChips(m.sources, m.blocked));
    if (m.done && m.content) {
      bub.appendChild(h('div', { class: 'foot' }, h('span', { class: 'muted small', text: (m.provider || '') + (m.model ? ' · ' + m.model : '') }),
        h('button', { class: 'icon-btn small', type: 'button', title: 'Copy answer', onclick: () => { copyText(m.content); toast('Copied'); } }, icon('copy'))));
    }
  }

  function scrollDown(force) {
    if (!threadEl || !threadEl.isConnected) return;
    const near = threadEl.scrollHeight - threadEl.scrollTop - threadEl.clientHeight < 140;
    if (force || near) threadEl.scrollTop = threadEl.scrollHeight;
  }

  function providerReady() {
    const st = S.state;
    if (!st) return { ok: true };
    const p = st.settings.provider;
    if (S.state.demo) return { ok: true };
    if (p === 'ollama' && !st.settings.ollama.model) return { ok: false, msg: 'Pick an Ollama model in Settings to start chatting.' };
    if (p === 'anthropic' && !st.settings.keys.anthropic) return { ok: false, msg: 'Add your Anthropic API key in Settings to use Claude.' };
    if (p === 'openai' && (!st.settings.openai.url || !st.settings.openai.model)) return { ok: false, msg: 'Enter your server address and model in Settings.' };
    if (st.settings.localOnly && st.provider.cloud) return { ok: false, msg: 'Local-only mode is on, but the selected AI is a cloud service.' };
    return { ok: true };
  }

  function suggestions() {
    const has = S.state && S.state.files && S.state.files.docs;
    if (!has) return [{ t: 'How do I set up my library?', m: 'chat' }, { t: 'What can you do offline?', m: 'chat' }];
    const out = [{ t: 'How do I purify water without a filter?', m: 'chat' }, { t: 'Find my insurance papers', m: 'chat' }, { t: 'Summarize what is in my library', m: 'chat' }];
    if (S.state.settings.doctorOn) out.push({ t: 'How is my server doing?', m: 'doctor' });
    return out;
  }

  function renderThread() {
    clear(threadEl);
    if (!chat.messages.length) {
      const ready = providerReady();
      threadEl.appendChild(h('div', { class: 'empty' },
        h('img', { class: 'logo-big', src: '/icon.svg', alt: '' }),
        h('h2', { text: 'What can I help with?' }),
        h('p', { class: 'muted', text: 'Ask me anything. I answer from the library and folders you choose, with no internet needed, and show you where each answer came from. I only ever read.' }),
        ready.ok ? null : h('div', { class: 'banner warn' }, icon('alert'), h('span', { text: ready.msg }), h('button', { class: 'btn small', type: 'button', onclick: () => LA.go('settings') }, 'Open Settings')),
        h('div', { class: 'sugg' }, suggestions().map((s) => h('button', { class: 'chip big', type: 'button', onclick: () => send(s.t, s.m) }, s.t)))));
      return;
    }
    let last = null;
    for (const m of chat.messages) { last = bubble(m); threadEl.appendChild(last); }
    if (chat.busy && last) { last.classList.add('live'); chat.liveEl = last; }
    scrollDown(true);
  }

  function setMode(m) {
    chat.mode = m;
    if (modeBtns) modeBtns.forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
    if (inputEl) inputEl.placeholder = m === 'doctor' ? 'Ask the Doctor about your server…' : 'Ask your library anything…';
  }

  function setBusy(b) {
    chat.busy = b;
    if (!sendBtn) return;
    clear(sendBtn);
    sendBtn.appendChild(icon(b ? 'stop' : 'send'));
    sendBtn.title = b ? 'Stop' : 'Send';
    sendBtn.classList.toggle('stop', b);
  }

  async function send(text, mode, focus) {
    text = String(text || '').trim();
    if (!text || chat.busy) return;
    if (text.toLowerCase() === '/freedom') { inputEl.value = ''; LA.freedom(); return; }
    if (mode) setMode(mode);
    const ready = providerReady();
    if (!ready.ok) { toast(ready.msg, 'warn'); return; }
    const user = { role: 'user', content: text };
    chat.messages.push(user);
    const bot = { role: 'assistant', content: '', sources: [], blocked: [], done: false };
    chat.messages.push(bot);
    if (chat.messages.length === 2) clear(threadEl);
    threadEl.appendChild(bubble(user));
    const el = bubble(bot);
    el.classList.add('live');
    chat.liveEl = el;
    threadEl.appendChild(el);
    scrollDown(true);
    inputEl.value = '';
    autosize();
    setBusy(true);
    chat.abort = new AbortController();
    let pending = false;
    const paint = () => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; if (chat.liveEl) renderBody(chat.liveEl); scrollDown(false); }); };
    try {
      await stream('/api/chat', { chatId: chat.id, message: text, mode: chat.mode, focus: focus || undefined }, (ev, d) => {
        if (ev === 'meta') { chat.id = d.chatId; bot.provider = d.provider; bot.model = d.model; }
        else if (ev === 'sources') { bot.sources = d.sources; bot.blocked = d.blocked; paint(); }
        else if (ev === 'token') { bot.content += d.t; paint(); }
        else if (ev === 'error') { bot.error = d.error; }
      }, chat.abort.signal);
    } catch (e) {
      if (e.name !== 'AbortError') bot.error = e.message;
    }
    const live = chat.liveEl || el;
    live.classList.remove('live');
    bot.done = true;
    if (bot.error) {
      if (!bot.content) { chat.messages.splice(chat.messages.indexOf(bot), 1); live.remove(); }
      if (threadEl) { threadEl.appendChild(h('div', { class: 'banner crit' }, icon('alert'), h('span', { text: bot.error }))); scrollDown(true); }
    } else renderBody(live);
    chat.liveEl = null;
    setBusy(false);
    chat.abort = null;
    loadList();
  }

  function autosize() {
    if (!inputEl) return;
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(180, inputEl.scrollHeight) + 'px';
  }

  async function open(id) {
    if (chat.busy) return;
    try {
      const c = await api('GET', '/api/chats/' + id);
      chat.id = c.id;
      chat.messages = c.messages.map((m) => Object.assign({ done: true }, m));
      setMode(c.mode || 'chat');
      renderThread();
      toggleSide(false);
      loadList();
    } catch (e) { toast(e.message, 'crit'); }
  }

  function newChat() {
    if (chat.busy) return;
    chat.id = null;
    chat.messages = [];
    renderThread();
    toggleSide(false);
    loadList();
    if (inputEl) inputEl.focus();
  }

  async function loadList() {
    if (!listEl) return;
    try {
      const r = await api('GET', '/api/chats');
      clear(listEl);
      if (!r.chats.length) listEl.appendChild(h('p', { class: 'muted small pad', text: 'Your chats show up here.' }));
      for (const c of r.chats) {
        listEl.appendChild(h('div', { class: 'chat-item' + (c.id === chat.id ? ' on' : '') },
          h('button', { class: 'chat-open', type: 'button', onclick: () => open(c.id) }, icon(c.mode === 'doctor' ? 'pulse' : 'chat'), h('span', { text: c.title })),
          h('button', { class: 'icon-btn small', type: 'button', title: 'Delete chat', onclick: async () => { await api('POST', '/api/chats/remove', { id: c.id }); if (chat.id === c.id) newChat(); else loadList(); } }, icon('trash'))));
      }
    } catch (e) { /* list is optional */ }
  }

  function toggleSide(v) {
    sideOpen = v === undefined ? !sideOpen : v;
    if (root) root.classList.toggle('side-open', sideOpen);
  }

  function render(into) {
    root = h('section', { class: 'page ask' });
    listEl = h('div', { class: 'chat-list' });
    threadEl = h('div', { class: 'thread', 'aria-live': 'polite' });
    inputEl = h('textarea', { class: 'input', rows: '1', placeholder: 'Ask your library anything…', maxlength: '4000',
      onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(inputEl.value); } },
      oninput: autosize });
    sendBtn = h('button', { class: 'send', type: 'button', title: 'Send', onclick: () => { if (chat.busy && chat.abort) chat.abort.abort(); else send(inputEl.value); } }, icon('send'));
    modeBtns = (S.state && S.state.settings.doctorOn ? ['chat', 'doctor'] : []).map((m) => h('button', { class: 'seg' + (chat.mode === m ? ' on' : ''), type: 'button', 'data-mode': m, onclick: () => setMode(m) }, icon(m === 'chat' ? 'chat' : 'pulse'), m === 'chat' ? 'Ask' : 'Doctor'));
    root.appendChild(h('aside', { class: 'side glass' },
      h('button', { class: 'btn primary block', type: 'button', onclick: newChat }, icon('plus'), 'New chat'), listEl));
    root.appendChild(h('div', { class: 'main' },
      h('div', { class: 'ask-top' }, h('button', { class: 'icon-btn menu', type: 'button', title: 'Chats', onclick: () => toggleSide() }, icon('menu')),
        h('span', { class: 'muted small', text: 'Answers cite the sources they used. Tap a number or chip to see exactly what I read.' })),
      threadEl,
      h('div', { class: 'composer glass' }, h('div', { class: 'modes' }, modeBtns), h('div', { class: 'row' }, inputEl, sendBtn))));
    into.appendChild(root);
    setMode(chat.mode);
    setBusy(chat.busy);
    renderThread();
    loadList();
    setTimeout(() => inputEl && inputEl.focus(), 50);
  }

  // Called by other pages (Doctor, Apps) to start a question.
  function start({ message, mode, focus }) {
    LA.go('ask');
    chat.id = null;
    chat.messages = [];
    renderThread();
    setTimeout(() => send(message, mode || 'chat', focus), 30);
  }

  LA.pages.ask = { render, start, leave() { sideOpen = false; } };
})();
