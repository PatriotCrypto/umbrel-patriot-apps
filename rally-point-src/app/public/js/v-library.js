// Library: offline guides and the calorie reference.
import { h, n0, renderGuide } from './ui.js';
import { RP, go } from './core.js';
import { viewHead, tabBar, panel } from './parts.js';

const ui = { q: '' };

export function render(root, sub) {
  root.append(viewHead('Library'));
  const guides = RP.meta.guides || [];
  const cur = sub && sub !== 'calories' ? sub : '';
  root.append(tabBar([['', 'Guides'], ['calories', 'Calorie table']], sub === 'calories' ? 'calories' : '', (t) => go('library', t)));
  if (sub === 'calories') {
    root.append(panel('Calories per pound (dry or as stored)', h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl keep' },
      h('thead', null, h('tr', null, [h('th', null, 'Food'), h('th', { class: 'num' }, 'kcal / lb')])),
      h('tbody', null, (RP.meta.calories || []).map(([n, k]) => h('tr', null, h('td', null, n), h('td', { class: 'num' }, n0(k)))))))),);
    return;
  }
  const q = h('input', { type: 'search', placeholder: 'Search guides', value: ui.q, oninput: (e) => { ui.q = e.target.value; draw(); } });
  const list = h('div');
  root.append(h('div', { class: 'toolbar' }, q), list);
  function draw() {
    list.replaceChildren();
    const term = ui.q.toLowerCase();
    const shown = guides.filter((g) => !term || (g.title + ' ' + g.tags.join(' ') + ' ' + g.body).toLowerCase().includes(term));
    if (!shown.length) list.append(h('div', { class: 'empty' }, 'No guides match.'));
    for (const g of shown) {
      const d = h('details', { class: 'panel guide-d', open: g.id === cur || (!!term && shown.length <= 3) },
        h('summary', null, h('strong', null, g.title), ' ', h('span', { class: 'dim' }, g.tags.join(', '))), renderGuide(g.body));
      list.append(d);
    }
  }
  draw();
  root.append(h('p', { class: 'hint' }, 'General preparedness information written for this app. It is not medical, legal or professional advice. Follow local rules and the label on your equipment.'));
}
