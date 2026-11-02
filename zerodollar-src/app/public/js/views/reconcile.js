import { h, icon, modal, toast, guard, confirmDialog, clear, shortDate, dayLabel } from '../ui.js';
import { api } from '../api.js';
import { S, fmt, loadMeta, catName, activeAccounts } from '../state.js';
import { parseMoney } from '../money.js';
import { categorySelect } from '../txeditor.js';

let currentId = null;
let pickAcct = '';

export async function render(root, ctx) {
  if (currentId) {
    const s = await api.get('/statements/' + currentId).catch(() => null);
    if (s) return statementScreen(root, ctx, s);
    currentId = null;
  }
  return home(root, ctx);
}

/* ---------------------------------------------------------------- start */
async function home(root, ctx) {
  const list = await api.get('/statements');
  const accts = activeAccounts();
  if (!pickAcct || !accts.some((a) => a.id === pickAcct)) pickAcct = accts[0].id;
  const acctSel = h('select', { 'aria-label': 'Account', onchange: () => (pickAcct = acctSel.value) }, accts.map((a) => h('option', { value: a.id }, a.name)));
  acctSel.value = pickAcct;
  const file = h('input', { type: 'file', accept: '.csv,.ofx,.qfx,.txt,text/csv', class: 'sr', id: 'stmt-file', onchange: () => file.files[0] && upload(file.files[0]) });
  const drop = h('label', { class: 'drop', for: 'stmt-file', tabIndex: 0, role: 'button',
    ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); },
    ondragleave: () => drop.classList.remove('over'),
    ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); e.dataTransfer.files[0] && upload(e.dataTransfer.files[0]); },
    onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), file.click()) },
    icon('upload', 'ico'), h('b', null, 'Drop your bank statement here'), 'or click to choose a CSV, OFX or QFX file');
  drop.querySelector('svg').style.cssText = 'width:30px;height:30px;margin-bottom:8px';

  async function upload(f) {
    if (f.size > 20 * 1024 * 1024) return toast('That file is too large', true);
    const text = await f.text();
    const s = await guard(() => api.post('/statements', { accountId: acctSel.value, fileName: f.name, content: text }));
    if (s) {
      currentId = s.id;
      await loadMeta();
      toast(`Read ${s.rows.length} rows · ${s.summary.counts.matched} matched automatically`);
      ctx.refresh();
    }
  }

  root.append(h('div', { class: 'page', style: { maxWidth: '820px' } },
    h('section', { class: 'card pad stack' },
      h('div', null, h('h2', { style: { fontSize: '18px' } }, 'Reconcile with your bank'),
        h('p', { class: 'muted', style: { margin: '6px 0 0' } }, 'Log purchases as you go. Once a month, upload the statement: ZeroDollar matches what you entered to what the bank shows, and helps you add anything you missed.')),
      h('label', { class: 'f', style: { maxWidth: '320px' } }, 'Statement is for', acctSel),
      drop, file,
      h('p', { class: 'muted', style: { margin: 0, fontSize: '13px' } }, 'Download the CSV or OFX/QFX file from your bank’s website (not the PDF). Files are read on your own server and nothing is sent anywhere else.')),
    h('section', { class: 'card' },
      h('header', { style: { padding: '14px 18px', borderBottom: '1px solid var(--line)' } }, h('h3', { style: { fontSize: '15px' } }, 'Past uploads')),
      list.length ? list.map((s) => h('div', { class: 'txmini', onclick: () => { currentId = s.id; ctx.refresh(); } },
        h('div', { class: 'who' }, h('b', null, s.fileName || 'Statement'), h('span', null, `${S.acctMap.get(s.accountId)?.name || ''} · ${s.rows} rows · ${new Date(s.importedAt).toLocaleDateString(S.meta.settings.locale)}`)),
        s.finalizedAt ? h('span', { class: 'pill good' }, 'Reconciled') : h('span', { class: 'pill warn' }, `${s.unresolved} to review`)))
        : h('div', { class: 'empty' }, 'No statements yet.'))));
}

/* ---------------------------------------------------------------- one statement */
function statementScreen(root, ctx, s) {
  const sum = s.summary;
  const acct = S.acctMap.get(s.accountId);
  const locked = !!s.finalizedAt;
  const reload = () => ctx.refresh();
  const act = async (path, body) => {
    const r = await guard(() => api.post(`/statements/${s.id}/${path}`, body));
    if (r) { await loadMeta(); reload(); }
    return r;
  };
  const endInput = h('input', { class: 'num', inputMode: 'decimal', placeholder: 'From your statement', value: s.endBalance != null ? S.money.plain(s.endBalance) : '', disabled: locked, 'aria-label': 'Statement ending balance', style: { maxWidth: '190px' } });
  const diff = sum.difference;

  const metrics = h('div', { class: 'stmt-head' },
    metric('Matched', `${sum.counts.matched + sum.counts.added} / ${sum.total - sum.counts.ignored}`),
    metric('Need review', String(sum.unresolved), sum.unresolved ? 'warn' : 'good'),
    metric('Your balance (cleared)', fmt(sum.cleared)),
    h('div', { class: 'card metric' }, h('span', null, 'Bank ending balance'), endInput,
      diff != null ? h('div', { class: 'pill ' + (diff === 0 ? 'good' : 'warn'), style: { marginTop: '6px' } }, diff === 0 ? 'Balances agree' : `Off by ${fmt(Math.abs(diff))}`) : null));

  const rows = s.rows.map((r) => statementRow(s, r, sum, act, locked));
  const unresolvedKnown = s.rows.filter((r) => r.status === 'new').length;

  root.append(h('div', { class: 'page' },
    h('div', { class: 'row between wrap' },
      h('div', { class: 'row' }, h('button', { class: 'btn ghost sm', onclick: () => { currentId = null; reload(); } }, icon('left'), 'All statements'),
        h('div', null, h('b', null, s.fileName || 'Statement'), h('div', { class: 'muted', style: { fontSize: '13px' } }, `${acct?.name || ''} · ${s.format.toUpperCase()} · ${s.rows.length} rows`))),
      h('div', { class: 'row wrap' },
        locked ? null : h('label', { class: 'row', style: { gap: '6px', fontSize: '13.5px' }, title: 'Credit-card files often list purchases as positive numbers' },
          h('input', { type: 'checkbox', style: { width: 'auto' }, checked: s.flip, onchange: (e) => act('flip', { flip: e.target.checked }) }), 'Flip signs'),
        locked ? null : h('button', { class: 'btn sm', onclick: () => act('rematch') }, 'Re-run matching'),
        h('button', { class: 'btn sm danger', onclick: async () => {
          if (!(await confirmDialog('Remove this upload? Transactions you added from it stay. Reconciliation marks from it are cleared.', { ok: 'Remove', danger: true }))) return;
          if (await guard(() => api.del('/statements/' + s.id))) { currentId = null; await loadMeta(); reload(); }
        } }, icon('trash'), 'Remove'))),
    s.warnings?.length ? h('div', { class: 'card pad', style: { background: 'var(--warn-soft)' } }, s.warnings.join(' ')) : null,
    metrics,
    locked ? h('div', { class: 'card pad row between wrap', style: { background: 'var(--accent-soft)' } },
      h('span', null, h('b', null, 'Reconciled'), ` on ${new Date(s.finalizedAt).toLocaleDateString(S.meta.settings.locale)}. These transactions are locked as cleared.`),
      h('button', { class: 'btn sm', onclick: async () => { if (await confirmDialog('Undo this reconciliation? Transactions become unreconciled again.', { ok: 'Undo' })) act('reopen'); } }, 'Undo reconciliation')) : null,
    locked ? null : h('div', { class: 'row wrap' },
      unresolvedKnown ? h('button', { class: 'btn', onclick: async () => {
        const r = await guard(() => api.post(`/statements/${s.id}/add-all`, { onlyKnown: true }));
        if (r) { await loadMeta(); toast(r.added ? `Added ${r.added} using remembered categories` : 'No rows have a remembered category yet'); reload(); }
      } }, icon('plus'), 'Add rows I’ve categorized before') : null,
      h('div', { style: { flex: 1 } }),
      h('button', { class: 'btn primary', onclick: finish }, icon('check'), 'Finish reconciliation')),
    h('section', { class: 'card', style: { overflow: 'hidden' } },
      h('div', { class: 'srow', style: { background: 'var(--surface2)', fontSize: '11.5px', fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted)' } },
        h('div', null, 'On your bank statement'), h('div', null, 'In ZeroDollar')),
      rows),
    sum.leftover.length ? h('section', { class: 'card' },
      h('header', { style: { padding: '14px 18px', borderBottom: '1px solid var(--line)' } }, h('h3', { style: { fontSize: '15px' } }, `In ZeroDollar but not on this statement (${sum.leftover.length})`),
        h('div', { class: 'muted', style: { fontSize: '13px' } }, 'Often pending charges that will show up next month, or entries with the wrong date or amount.')),
      sum.leftover.map((id) => sum.txById[id]).filter(Boolean).map((t) => h('div', { class: 'txmini', style: { cursor: 'default' } },
        h('div', { class: 'who' }, h('b', null, t.payee || 'No payee'), h('span', null, shortDate(t.date, S.meta.settings.locale))),
        h('span', { class: 'amt num' }, fmt(t.amount))))) : null));

  async function finish() {
    const bal = endInput.value.trim() ? parseMoney(endInput.value) : null;
    const force = sum.unresolved > 0;
    if (force && !(await confirmDialog(`${sum.unresolved} row${sum.unresolved === 1 ? ' is' : 's are'} still undecided. Finish anyway? Undecided rows stay unmatched.`, { ok: 'Finish anyway' }))) return;
    const r = await guard(() => api.post(`/statements/${s.id}/finalize`, { endBalance: bal, force }));
    if (r) { await loadMeta(); toast(`Reconciled ${r.reconciled} transaction${r.reconciled === 1 ? '' : 's'}`); reload(); }
  }
}

const metric = (label, value, tone) => h('div', { class: 'card metric' }, h('span', null, label), h('b', { class: tone === 'warn' ? '' : '', style: tone ? { color: `var(--${tone === 'warn' ? 'warn' : 'good'})` } : null }, value));

function statementRow(s, r, sum, act, locked) {
  const amt = s.flip ? -r.amount : r.amount;
  const tx = r.txId ? sum.txById[r.txId] : null;
  const left = h('div', null,
    h('div', { class: 'grow' }, h('b', { title: r.desc }, r.desc), h('span', null, shortDate(r.date, S.meta.settings.locale), r.dup ? ' · already uploaded before' : '')),
    h('span', { class: 'amt num' + (amt > 0 ? ' in' : '') }, (amt > 0 ? '+' : '−') + fmt(Math.abs(amt))));
  let right;
  if ((r.status === 'matched' || r.status === 'added') && tx) {
    right = h('div', null,
      h('span', { class: 'rec' }, icon('check')),
      h('div', { class: 'grow' }, h('b', null, tx.payee || 'No payee'), h('span', null, r.status === 'added' ? 'Added from statement · ' : r.auto ? 'Matched automatically · ' : 'Matched · ', tx.splits?.length ? 'Split' : tx.type === 'transfer' ? 'Transfer' : catName(tx.catId) || 'Uncategorized')),
      locked ? null : h('button', { class: 'btn ghost sm', title: r.status === 'added' ? 'Remove the added transaction' : 'Unmatch', onclick: () => act(`rows/${r.id}/unlink`) }, icon('x')));
  } else if (r.status === 'suggested' && tx) {
    right = h('div', null,
      h('div', { class: 'grow' }, h('b', null, `Maybe: ${tx.payee || 'No payee'}`), h('span', null, `You entered ${fmt(tx.amount)} on ${shortDate(tx.date, S.meta.settings.locale)} · tip or fee?`)),
      h('button', { class: 'btn sm primary', onclick: () => act(`rows/${r.id}/accept`) }, 'Match'),
      h('button', { class: 'btn sm', onclick: () => act(`rows/${r.id}/unlink`) }, 'Not it'));
  } else if (r.status === 'ignored') {
    right = h('div', null, h('div', { class: 'grow muted' }, 'Set aside'), locked ? null : h('button', { class: 'btn sm', onclick: () => act(`rows/${r.id}/ignore`, { ignore: false }) }, 'Restore'));
  } else {
    // new
    const cat = categorySelect(amt > 0 ? 'income' : 'expense', suggest(r.desc), { blank: 'Category…' });
    right = locked ? h('div', null, h('div', { class: 'grow muted' }, 'Not matched')) : h('div', { style: { flexWrap: 'wrap' } },
      cat,
      h('button', { class: 'btn sm primary', onclick: () => act(`rows/${r.id}/add`, { catId: cat.value || null }) }, 'Add'),
      h('button', { class: 'btn sm', onclick: () => chooseMatch(s, r, sum, act) }, icon('link'), 'Match…'),
      h('button', { class: 'btn ghost sm', title: 'Ignore this row', onclick: () => act(`rows/${r.id}/ignore`) }, 'Ignore'));
  }
  return h('div', { class: `srow is-${r.status}` }, left, right);
}

function suggest(desc) {
  const n = desc.toLowerCase().replace(/[0-9#*]+/g, ' ').replace(/[^a-z& ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return S.meta.payeeRules[n] || '';
}

async function chooseMatch(s, r, sum, act) {
  const amt = s.flip ? -r.amount : r.amount;
  const res = await guard(() => api.get(`/transactions?accountId=${s.accountId}&unreconciled=1&limit=400`));
  if (!res) return;
  const claimed = new Set(s.rows.filter((x) => x.txId && x.id !== r.id && (x.status === 'matched' || x.status === 'added')).map((x) => x.txId));
  const rowDate = Date.parse(r.date);
  const signed = (t) => (t.type === 'income' ? t.amount : t.type === 'expense' ? -t.amount : t.accountId === s.accountId ? -t.amount : t.amount);
  const cands = res.transactions.filter((t) => !claimed.has(t.id))
    .map((t) => ({ t, score: Math.abs(signed(t) - amt) / 100 + Math.abs(Date.parse(t.date) - rowDate) / 86400000 / 3 }))
    .sort((a, b) => a.score - b.score).slice(0, 40);
  const m = modal({
    title: 'Match to a transaction', wide: true,
    body: [
      h('div', { class: 'card pad row between' }, h('div', null, h('b', null, r.desc), h('div', { class: 'muted', style: { fontSize: '13px' } }, shortDate(r.date, S.meta.settings.locale))), h('b', { class: 'num' }, fmt(Math.abs(amt)))),
      cands.length ? h('div', { class: 'chooser' }, cands.map(({ t }) => h('button', { onclick: async () => { m.close(); await act(`rows/${r.id}/link`, { txId: t.id }); } },
        h('div', { style: { flex: 1, minWidth: 0 } }, h('b', null, t.payee || 'No payee'), h('div', { class: 'muted', style: { fontSize: '12.5px' } }, `${dayLabel(t.date, S.meta.settings.locale)} · ${catName(t.catId) || 'Uncategorized'}`)),
        h('span', { class: 'amt num' }, fmt(t.amount))))) : h('div', { class: 'empty' }, 'No unreconciled transactions in this account.')
    ]
  });
}
