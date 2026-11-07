// First-run setup for the family, and the PIN-locked Grown-ups page.
(function () {
  'use strict';
  const { h, clear, icon, api, toast, modal, S } = AD;
  const A = () => window.Audio2;
  const THEMES = [['joy', 'Midnight', 'Deep navy and gold'], ['candy', 'Crimson', 'Burgundy and cream'], ['wonderland', 'Frost', 'Deep teal and ice'], ['gingerbread', 'Evergreen', 'Forest green and gold'], ['aurora', 'Aurora', 'Indigo, mint and violet']];

  // ---------- setup wizard ----------
  function setup(into) {
    const kids = [''];
    let step = 0;
    const data = { pin: '', hometown: '', bedtime: '21:00', theme: 'joy' };
    const card = h('div', { class: 'wizard glass' });
    const paint = () => {
      clear(card);
      if (step === 0) {
        card.appendChild(h('div', { class: 'wiz-head' }, h('span', { class: 'big-emoji', text: '🎄' }), h('h1', { text: 'Welcome to Advent!' }), h('p', { class: 'muted', text: 'A Christmas countdown for your family: a door a day with an animated surprise and a verse from the Christmas story, North Pole spy cams, a Santa tracker on Christmas Eve, and letters to Santa.' })));
        card.appendChild(h('button', { class: 'btn primary block', type: 'button', onclick: () => { A().unlock(); A().sfx.jingle(); step = 1; paint(); } }, 'Let\'s set it up'));
      } else if (step === 1) {
        card.appendChild(h('h2', { text: 'Who is counting down?' }));
        card.appendChild(h('p', { class: 'muted small', text: 'Each child gets their own doors, letters to Santa and badges. You can add up to eight.' }));
        const list = h('div', { class: 'form' });
        kids.forEach((k, i) => list.appendChild(h('div', { class: 'row' }, h('input', { class: 'input', placeholder: 'Child\'s first name', value: k, maxlength: '30', oninput: (e) => { kids[i] = e.target.value; } }), kids.length > 1 ? h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Remove', onclick: () => { kids.splice(i, 1); paint(); } }, icon('x')) : null)));
        card.appendChild(list);
        card.appendChild(h('div', { class: 'row gap' }, kids.length < 8 ? h('button', { class: 'btn', type: 'button', onclick: () => { kids.push(''); paint(); } }, icon('plus'), 'Add another child') : null,
          h('button', { class: 'btn primary', type: 'button', onclick: () => { if (!kids.some((k) => k.trim())) return toast('Type at least one name', 'warn'); A().sfx.chime(); step = 2; paint(); } }, 'Next')));
      } else if (step === 2) {
        card.appendChild(h('h2', { text: 'Grown-up PIN' }));
        card.appendChild(h('p', { class: 'muted small', text: 'The PIN locks the Grown-ups page, where you manage the Nice list, read wish lists and change settings. 4 to 8 digits.' }));
        const pin = h('input', { class: 'input big-pin', type: 'password', inputmode: 'numeric', placeholder: '••••', maxlength: '8', autocomplete: 'off' });
        const pin2 = h('input', { class: 'input big-pin', type: 'password', inputmode: 'numeric', placeholder: 'again', maxlength: '8', autocomplete: 'off' });
        card.appendChild(h('div', { class: 'form' }, pin, pin2));
        card.appendChild(h('div', { class: 'row gap' }, h('button', { class: 'btn', type: 'button', onclick: () => { step = 1; paint(); } }, 'Back'), h('button', { class: 'btn primary', type: 'button', onclick: () => { if (!/^\d{4,8}$/.test(pin.value)) return toast('Use 4 to 8 digits', 'warn'); if (pin.value !== pin2.value) return toast('The two PINs do not match', 'warn'); data.pin = pin.value; A().sfx.chime(); step = 3; paint(); } }, 'Next')));
      } else if (step === 3) {
        card.appendChild(h('h2', { text: 'Your house' }));
        card.appendChild(h('p', { class: 'muted small', text: 'On Christmas Eve the Santa Tracker shows him flying toward your town and arriving at bedtime.' }));
        const town = h('input', { class: 'input', placeholder: 'Your town, e.g. Sunman', value: data.hometown, maxlength: '40', oninput: (e) => { data.hometown = e.target.value; } });
        const bed = h('input', { class: 'input', type: 'time', value: data.bedtime, oninput: (e) => { data.bedtime = e.target.value; } });
        card.appendChild(h('div', { class: 'form' }, h('label', null, 'Town name', town), h('label', null, 'Bedtime on Christmas Eve (when Santa arrives)', bed)));
        card.appendChild(h('div', { class: 'row gap' }, h('button', { class: 'btn', type: 'button', onclick: () => { step = 2; paint(); } }, 'Back'), h('button', { class: 'btn primary', type: 'button', onclick: () => { A().sfx.chime(); step = 4; paint(); } }, 'Next')));
      } else {
        card.appendChild(h('h2', { text: 'Pick a look' }));
        card.appendChild(h('p', { class: 'muted small', text: 'You can change this any time in Settings.' }));
        card.appendChild(themePicker(data.theme, (t) => { data.theme = t; document.documentElement.setAttribute('data-theme', t); paint(); }));
        card.appendChild(h('div', { class: 'row gap' }, h('button', { class: 'btn', type: 'button', onclick: () => { step = 3; paint(); } }, 'Back'), h('button', { class: 'btn primary', type: 'button', onclick: async () => {
          try { await api('POST', '/api/setup', Object.assign({ children: kids.filter((k) => k.trim()) }, data)); A().sfx.hooray(); AD.fun.overlay('🎄 All set! Let the countdown begin! 🎄', 'star'); await AD.refreshState(); S.child = S.state.children[0].id; AD.boot(); } catch (e) { toast(e.message, 'warn'); }
        } }, icon('check'), 'Finish')));
      }
    };
    paint();
    into.appendChild(h('div', { class: 'setup-wrap' }, card));
  }
  function themePicker(cur, onPick) {
    return h('div', { class: 'themes' }, THEMES.map(([id, name, desc]) => h('button', { class: 'theme-card th-' + id + (cur === id ? ' on' : ''), type: 'button', onclick: () => onPick(id) }, h('span', { class: 'swatch' }), h('b', { text: name }), h('small', { class: 'muted', text: desc }))));
  }

  // ---------- parent page ----------
  async function askPin() {
    return new Promise((resolve) => {
      const pin = h('input', { class: 'input big-pin', type: 'password', inputmode: 'numeric', placeholder: 'PIN', maxlength: '8', autocomplete: 'off', onkeydown: (e) => { if (e.key === 'Enter') go(); } });
      let close;
      const go = async () => { try { const r = await api('POST', '/api/pin', { pin: pin.value }); S.parentToken = r.token; close(); resolve(true); } catch (e) { toast(e.message, 'warn'); pin.value = ''; A().sfx.locked(); } };
      close = modal('Grown-ups only', h('div', { class: 'form' }, h('p', { class: 'muted small', text: 'Enter the parent PIN to open settings.' }), pin), (c) => [h('button', { class: 'btn', type: 'button', onclick: () => { c(); resolve(false); } }, 'Cancel'), h('button', { class: 'btn primary', type: 'button', onclick: go }, icon('lock'), 'Unlock')]);
      setTimeout(() => pin.focus(), 50);
    });
  }
  async function put(body) {
    try { await api('PUT', '/api/parent/settings', body, true); await AD.refreshState(); toast('Saved', 'ok'); return true; } catch (e) { toast(e.message, 'warn'); if (e.status === 401) { S.parentToken = null; AD.go('calendar'); } return false; }
  }

  function listCalendar(ch, reload) {
    // December, one cell a day: tap to cycle default -> nice -> naughty.
    const grid = h('div', { class: 'list-cal' });
    for (let d = 1; d <= 31; d++) {
      const key = '12-' + String(d).padStart(2, '0');
      const v = ch.list.days[key];
      const cell = h('button', { class: 'lc ' + (v || 'default'), type: 'button', title: v ? v : 'Uses the default (' + ch.list.default + ')', onclick: async () => {
        const next = !v ? 'nice' : v === 'nice' ? 'naughty' : null;
        try { await api('PUT', '/api/parent/children/' + ch.id, { list: { days: { [key]: next } } }, true); reload(); A().sfx.click(); } catch (e) { toast(e.message, 'warn'); }
      } }, h('b', { text: String(d) }), h('small', { text: v === 'nice' ? '😇' : v === 'naughty' ? '😬' : '·' }));
      grid.appendChild(cell);
    }
    return grid;
  }

  function render(into) {
    const host = h('section', { class: 'parent-page' }, h('p', { class: 'muted', text: 'Loading…' }));
    into.appendChild(host);
    (async () => {
      if (!S.parentToken) { const ok = await askPin(); if (!ok) { AD.go('calendar'); return; } }
      let data;
      const load = async () => { try { data = await api('GET', '/api/parent', null, true); } catch (e) { S.parentToken = null; AD.go('calendar'); return false; } return true; };
      if (!(await load())) return;
      const paint = () => {
        clear(host);
        const s = data.settings;
        host.appendChild(h('div', { class: 'page-head' }, h('h2', null, icon('lock'), ' Grown-ups'), h('p', { class: 'muted', text: 'Children, the Nice list, wish lists, and how the app looks and sounds. The kids never see this page.' })));
        // children
        const kidsCard = h('div', { class: 'card glass' }, h('h3', null, icon('users'), ' Children'));
        for (const ch of data.children) {
          const name = h('input', { class: 'input', value: ch.name, maxlength: '30', onchange: async (e) => { await api('PUT', '/api/parent/children/' + ch.id, { name: e.target.value }, true); await load(); await AD.refreshState(); toast('Saved', 'ok'); } });
          const def = h('select', { class: 'input', onchange: async (e) => { await api('PUT', '/api/parent/children/' + ch.id, { list: { default: e.target.value } }, true); await load(); paint(); toast('Saved', 'ok'); } }, h('option', { value: 'nice', text: 'Nice (default)', selected: ch.list.default === 'nice' }), h('option', { value: 'naughty', text: 'Naughty (default)', selected: ch.list.default === 'naughty' }));
          const wishes = h('ul', { class: 'plain small' }, ch.wishes.length ? ch.wishes.map((w) => h('li', { text: '🎁 ' + w.text })) : h('li', { class: 'muted', text: 'No wishes yet' }));
          const letters = h('details', null, h('summary', { text: 'Letters to Santa (' + ch.letters.length / 2 + ')' }), h('div', { class: 'letters small' }, ch.letters.map((l) => h('p', { class: l.from }, h('b', { text: l.from === 'santa' ? 'Santa: ' : ch.name + ': ' }), l.text))));
          kidsCard.appendChild(h('div', { class: 'kid-block' },
            h('div', { class: 'row gap wrap' }, name, def, data.children.length > 1 ? h('button', { class: 'btn small danger', type: 'button', onclick: async () => { if (!confirm('Remove ' + ch.name + ' and everything saved for them?')) return; await api('POST', '/api/parent/children/' + ch.id + '/remove', {}, true); await load(); await AD.refreshState(); paint(); } }, icon('trash'), 'Remove') : null),
            h('p', { class: 'muted small', text: 'Nice list by day. Tap a day to cycle: default → nice → naughty. The Scanner and Santa\'s replies use today\'s value.' }),
            listCalendar(ch, async () => { await load(); paint(); }),
            h('div', { class: 'two-col' }, h('div', null, h('b', { class: 'small', text: 'Christmas list' }), wishes), h('div', null, letters)),
            h('div', { class: 'row gap wrap' },
              h('button', { class: 'btn small', type: 'button', onclick: async () => { await api('PUT', '/api/parent/children/' + ch.id, { resetDoors: true }, true); await AD.refreshState(); toast('Doors closed again', 'ok'); } }, 'Close all doors again'),
              h('button', { class: 'btn small', type: 'button', onclick: async () => { await api('PUT', '/api/parent/children/' + ch.id, { clearWishes: true, clearLetters: true }, true); await load(); paint(); } }, 'Clear letters and wishes'))));
        }
        const newName = h('input', { class: 'input', placeholder: 'Add a child', maxlength: '30' });
        kidsCard.appendChild(h('div', { class: 'row gap' }, newName, h('button', { class: 'btn', type: 'button', onclick: async () => { if (!newName.value.trim()) return; try { await api('POST', '/api/parent/children', { name: newName.value }, true); await load(); await AD.refreshState(); paint(); } catch (e) { toast(e.message, 'warn'); } } }, icon('plus'), 'Add')));
        host.appendChild(kidsCard);
        // home and Santa
        const town = h('input', { class: 'input', value: s.hometown, maxlength: '40', onchange: (e) => put({ hometown: e.target.value }) });
        const bed = h('input', { class: 'input', type: 'time', value: s.bedtime, onchange: (e) => put({ bedtime: e.target.value }) });
        host.appendChild(h('div', { class: 'card glass' }, h('h3', null, icon('home'), ' Christmas Eve'), h('div', { class: 'form two' }, h('label', null, 'Town name shown on the tracker', town), h('label', null, 'Bedtime (Santa arrives then)', bed)),
          h('p', { class: 'muted small', text: 'Santa launches from the North Pole at 5:00 PM on Christmas Eve, reaches your town at bedtime, and finishes the world by 6:00 AM.' })));
        // preview
        const prev = h('input', { class: 'input', type: 'date', value: s.previewDate || '', onchange: (e) => put({ previewDate: e.target.value }) });
        host.appendChild(h('div', { class: 'card glass' }, h('h3', null, icon('calendar'), ' Preview a day'),
          h('p', { class: 'muted small', text: 'Pretend today is another date to see what the kids will see. Everyone sees the pretend date until you clear it, so clear it before the kids come back!' }),
          h('div', { class: 'row gap wrap' }, prev, h('button', { class: 'btn small', type: 'button', onclick: () => { const y = new Date().getFullYear(); prev.value = y + '-12-24'; put({ previewDate: prev.value }); } }, 'Christmas Eve'), h('button', { class: 'btn small', type: 'button', onclick: () => { const y = new Date().getFullYear(); prev.value = y + '-12-25'; put({ previewDate: prev.value }); } }, 'Christmas Day'), h('button', { class: 'btn small', type: 'button', onclick: () => { prev.value = ''; put({ previewDate: '' }); } }, 'Back to today')),
          s.previewDate ? h('div', { class: 'banner warn' }, icon('info'), h('span', { text: 'Preview is on: the app thinks today is ' + s.previewDate + '.' })) : null));
        // pin
        const np = h('input', { class: 'input', type: 'password', inputmode: 'numeric', placeholder: 'New PIN', maxlength: '8', autocomplete: 'off' });
        host.appendChild(h('div', { class: 'card glass' }, h('h3', null, icon('lock'), ' Parent PIN'), h('div', { class: 'row gap' }, np, h('button', { class: 'btn', type: 'button', onclick: async () => { if (await put({ newPin: np.value })) np.value = ''; } }, 'Change PIN'))));
        host.appendChild(h('div', { class: 'card glass' }, h('h3', null, icon('info'), ' About'), h('p', { class: 'muted small', text: 'Advent Calendar ' + S.state.version + ' by PatriotCrypto. Everything stays on your Umbrel: no accounts, no internet needed, no tracking. The verses are from the King James Bible. All sounds are made by the app itself. Santa\'s replies are written in advance, not by an AI.' })));
      };
      paint();
    })();
  }
  AD.pages.parent = { render, leave() {} };
  AD.setup = setup;
  AD.themePicker = themePicker;
  AD.THEMES = THEMES;
})();
