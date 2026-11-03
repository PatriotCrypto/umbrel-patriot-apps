import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Store } from './lib/store.js';
import { PrivateStore } from './lib/private.js';
import { Auth, cookieValue, validatePassword, checkPassword } from './lib/auth.js';
import { normalizeNtfy, sendNtfy, runReminders, localParts } from './lib/ntfy.js';
import { defaultState, migrate, ACCOUNT_TYPES } from './lib/schema.js';
import {
  HttpError, bad, notFound, uid, isDate, isMonth, clampStr, asCents, todayStr, monthEnd, addMonths, normPayee
} from './lib/util.js';
import { accountBalance, byId, computeBudget, initMonth, upcomingBills, debtBalance, partsOf } from './lib/budget.js';
import { parseStatement } from './lib/parsers.js';
import * as S from './lib/statements.js';
import { simulate } from './lib/debt.js';
import { paycheckPlan, dueThisWeek, cleanPaychecks, autoPaychecks, splitEvenly } from './lib/paycheck.js';
import { classifyInput, scanXpub, lookupAddress, fetchPrice, normalizeApi } from './lib/bitcoin.js';
import { netWorthNow, snapshotMonth, goalProgress, cleanAsset, cleanLiability, cleanGoal, btcValue, csvRows, ASSET_CATS, LIABILITY_CATS } from './lib/networth.js';
import { insights, resolveRange } from './lib/insights.js';
import { parseEveryDollar, planImport, applyImport, monthFromFileName } from './lib/everydollar.js';
import { spendingByCategory, monthlyTrend, topPayees, netWorthSeries } from './lib/reports.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8')).version;
  } catch {
    return '0';
  }
})();

const MORSE = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--',
  N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..'
};
const morse = (s) => s.toUpperCase().split(' ').map((w) => [...w].map((c) => MORSE[c] || '').join(' ')).join('  /  ');

export function createApp({ dataDir = process.env.DATA_DIR || '/data', publicDir = path.join(here, 'public') } = {}) {
  const store = new Store(dataDir, defaultState, migrate);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '60mb' }));

  const st = () => store.state;
  const priv = new PrivateStore(dataDir);
  const auth = new Auth(priv);
  const api = express.Router();

  /* ------------------------------------------------------------ password */
  const COOKIE = 'zd_session';
  const sessionOf = (req) => cookieValue(req.headers.cookie, COOKIE);
  const setCookie = (res, token, maxAge) => res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`);
  api.get('/auth/status', (req, res) => res.json({ required: auth.required, authed: !auth.required || auth.valid(sessionOf(req)) }));
  api.post('/auth/login', (req, res) => {
    if (!auth.required) return res.json({ ok: true });
    auth.throttle(req.ip);
    if (!checkPassword(req.body?.password, priv.data.auth)) {
      auth.failed(req.ip);
      throw new HttpError(401, 'That password is not right.');
    }
    auth.ok(req.ip);
    setCookie(res, auth.newSession(), 30 * 86400);
    res.json({ ok: true });
  });
  api.post('/auth/logout', (req, res) => {
    auth.drop(sessionOf(req));
    setCookie(res, '', 0);
    res.json({ ok: true });
  });
  // everything below needs a session once a password exists
  api.use((req, _res, next) => {
    if (auth.required && !auth.valid(sessionOf(req))) {
      const e = new HttpError(401, 'Sign in to continue.');
      e.auth = true;
      throw e;
    }
    next();
  });
  api.post('/auth/password', (req, res) => {
    const { current, password } = req.body || {};
    if (auth.required) {
      auth.throttle(req.ip);
      if (!checkPassword(current, priv.data.auth)) {
        auth.failed(req.ip);
        throw new HttpError(403, 'Your current password is not right.');
      }
      auth.ok(req.ip);
    }
    validatePassword(password);
    auth.setPassword(password);
    setCookie(res, auth.newSession(), 30 * 86400);
    res.json({ ok: true });
  });
  api.post('/auth/remove', (req, res) => {
    if (!auth.required) return res.json({ ok: true });
    auth.throttle(req.ip);
    if (!checkPassword(req.body?.current, priv.data.auth)) {
      auth.failed(req.ip);
      throw new HttpError(403, 'Your current password is not right.');
    }
    auth.ok(req.ip);
    auth.clear();
    setCookie(res, '', 0);
    res.json({ ok: true });
  });

  /* ------------------------------------------------------------ reminders */
  const ntfyView = () => ({ ...st().settings.ntfy, hasToken: !!priv.data.ntfyToken });
  api.get('/ntfy', (_req, res) => res.json(ntfyView()));
  api.put('/ntfy', (req, res) => {
    const next = normalizeNtfy(st().settings.ntfy, req.body);
    if (req.body?.token !== undefined) {
      priv.data.ntfyToken = String(req.body.token || '').trim().slice(0, 200);
      priv.save();
    }
    store.update((s) => {
      s.settings.ntfy = next;
    });
    res.json(ntfyView());
  });
  api.post('/ntfy/test', async (_req, res, next) => {
    try {
      await sendNtfy(st().settings.ntfy, priv.data.ntfyToken, { title: 'ZeroDollar test', message: 'It works. Reminders will arrive here.', tags: 'tada' }, app.locals.fetch || fetch);
      res.json({ ok: true });
    } catch (e) {
      next(e.status ? e : new HttpError(502, e.message));
    }
  });
  const checkReminders = async (now = new Date()) => {
    const out = await runReminders({ state: st(), token: priv.data.ntfyToken, sent: priv.data.sent, now, fetchImpl: app.locals.fetch || fetch });
    if (out.length) priv.save();
    return out;
  };

  /* ---------------------------------------------------------- validators */
  const needMonth = (m) => {
    if (!isMonth(m)) throw bad('Month must look like 2026-03');
    return m;
  };
  const getCat = (id) => {
    const c = st().categories.find((x) => x.id === id);
    if (!c) throw notFound('Category not found');
    return c;
  };
  const getAccount = (id) => {
    const a = st().accounts.find((x) => x.id === id);
    if (!a) throw bad('Unknown account');
    return a;
  };
  const catExists = (id) => st().categories.some((c) => c.id === id);

  function buildTx(body, existing = null) {
    const has = (k) => body[k] !== undefined;
    const t = existing ? { ...existing } : { id: uid('t_'), reconciled: false, createdAt: new Date().toISOString() };
    const before = existing ? { date: t.date, amount: t.amount, accountId: t.accountId, type: t.type } : null;

    if (has('type') || !existing) {
      if (!['expense', 'income', 'transfer'].includes(body.type)) throw bad('Type must be expense, income or transfer');
      t.type = body.type;
    }
    if (has('date') || !existing) {
      if (!isDate(body.date)) throw bad('Date must look like 2026-03-27');
      t.date = body.date;
    }
    if (has('amount') || !existing) {
      asCents(body.amount, { name: 'Amount' });
      if (body.amount === 0) throw bad('Amount must be more than zero');
      t.amount = body.amount;
    }
    if (has('accountId') || !existing) t.accountId = getAccount(body.accountId).id;
    if (has('payee')) t.payee = clampStr(body.payee, 80);
    if (has('memo')) t.memo = clampStr(body.memo, 200);
    t.payee ??= '';
    t.memo ??= '';

    if (t.type === 'transfer') {
      const to = has('toAccountId') ? body.toAccountId : t.toAccountId;
      if (!to || to === t.accountId) throw bad('Pick two different accounts for a transfer');
      t.toAccountId = getAccount(to).id;
      delete t.catId;
      delete t.splits;
    } else {
      delete t.toAccountId;
      if (has('splits') && Array.isArray(body.splits) && body.splits.length) {
        let sum = 0;
        t.splits = body.splits.map((p) => {
          if (!catExists(p.catId)) throw bad('Unknown category in split');
          asCents(p.amount, { name: 'Split amount' });
          if (p.amount === 0) throw bad('Split amounts must be more than zero');
          sum += p.amount;
          return { catId: p.catId, amount: p.amount };
        });
        if (sum !== t.amount) throw bad('Splits must add up to the full amount');
        t.catId = null;
      } else {
        if (has('splits')) delete t.splits;
        if (has('catId')) {
          if (body.catId && !catExists(body.catId)) throw bad('Unknown category');
          t.catId = body.catId || null;
        }
        t.catId ??= null;
        if (t.splits && has('amount') && !has('splits')) {
          // amount changed under existing splits: collapse to the first category
          t.catId = t.splits[0].catId;
          delete t.splits;
        }
      }
    }
    if (before && t.reconciled && (before.date !== t.date || before.amount !== t.amount || before.accountId !== t.accountId || before.type !== t.type)) {
      t.reconciled = false;
      delete t.reconciledAt;
      delete t.statementId;
    }
    return t;
  }

  /* ---------------------------------------------------------------- meta */
  function metaView() {
    const s = st();
    const claimed = S.linkedTxIds(s);
    void claimed;
    const payeeCount = new Map();
    for (const t of s.transactions) if (t.payee) payeeCount.set(t.payee, (payeeCount.get(t.payee) || 0) + 1);
    const payees = [...payeeCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 300).map(([p]) => p);
    return {
      version: VERSION,
      settings: s.settings,
      accounts: s.accounts.map((a) => ({ ...a, balance: accountBalance(s, a), cleared: accountBalance(s, a) - s.transactions.filter((t) => !t.reconciled && (t.accountId === a.id || t.toAccountId === a.id)).reduce((n, t) => n + signed(t, a.id), 0) })),
      groups: s.groups,
      categories: s.categories,
      debts: s.debts.map((d) => ({ ...d, balance: debtBalance(s, d) })),
      payees,
      payeeRules: Object.fromEntries(Object.entries(s.payeeRules).slice(-800)),
      counts: { transactions: s.transactions.length, statements: s.statements.length }
    };
  }
  const signed = (t, id) => {
    if (t.type === 'income') return t.accountId === id ? t.amount : 0;
    if (t.type === 'expense') return t.accountId === id ? -t.amount : 0;
    return (t.accountId === id ? -t.amount : 0) + (t.toAccountId === id ? t.amount : 0);
  };
  api.get('/meta', (_req, res) => res.json(metaView()));

  /* -------------------------------------------------------------- budget */
  api.get('/budget/:month', (req, res) => {
    const month = needMonth(req.params.month);
    const today = isDate(req.query.today) ? req.query.today : todayStr();
    res.json({ ...computeBudget(st(), month, today), bills: upcomingBills(st(), month, today) });
  });
  api.post('/budget/:month/init', (req, res) => {
    const month = needMonth(req.params.month);
    const mode = req.body?.mode === 'blank' ? 'blank' : 'previous';
    store.update((s) => {
      if (s.months[month]) throw new HttpError(409, 'That month already has a budget');
      initMonth(s, month, mode);
    });
    res.json(computeBudget(st(), month));
  });
  api.put('/budget/:month/planned', (req, res) => {
    const month = needMonth(req.params.month);
    const values = req.body?.values && typeof req.body.values === 'object' ? req.body.values : { [req.body?.catId]: req.body?.amount };
    store.update((s) => {
      initMonth(s, month, 'blank');
      for (const [catId, amount] of Object.entries(values)) {
        if (!s.categories.some((c) => c.id === catId)) throw bad('Unknown category');
        asCents(amount, { name: 'Planned amount' });
        if (amount === 0) delete s.months[month].planned[catId];
        else s.months[month].planned[catId] = amount;
      }
    });
    res.json(computeBudget(st(), month));
  });
  api.put('/budget/:month/note', (req, res) => {
    const month = needMonth(req.params.month);
    store.update((s) => {
      initMonth(s, month, 'blank').note = clampStr(req.body?.note, 600);
    });
    res.json({ ok: true });
  });

  /* ------------------------------------------------------ paycheck planning */
  api.get('/paycheck/:month', (req, res) => res.json(paycheckPlan(st(), needMonth(req.params.month), isDate(req.query.today) ? req.query.today : todayStr())));
  const monthRec = (s, m) => {
    const r = s.months[needMonth(m)];
    if (!r) throw bad('Plan this month first');
    return r;
  };
  api.put('/paycheck/:month/buffer', (req, res) => {
    store.update((s) => {
      monthRec(s, req.params.month).buffer = asCents(req.body?.amount ?? 0, { name: 'Buffer' });
    });
    res.json(paycheckPlan(st(), req.params.month, todayStr()));
  });
  api.put('/paycheck/:month/paychecks', (req, res) => {
    store.update((s) => {
      const r = monthRec(s, req.params.month);
      const catId = req.body?.catId;
      const list = cleanPaychecks(s, req.params.month, catId, req.body?.paychecks ?? []);
      r.paychecks = (r.paychecks || []).filter((p) => p.catId !== catId).concat(list);
      if (!r.paychecks.length) delete r.paychecks;
    });
    res.json(paycheckPlan(st(), req.params.month, todayStr()));
  });
  api.post('/paycheck/:month/split', (req, res) => {
    store.update((s) => {
      const r = monthRec(s, req.params.month);
      const c = s.categories.find((x) => x.id === req.body?.catId && x.type === 'income');
      if (!c) throw bad('Pick an income item');
      const days = (Array.isArray(req.body?.days) ? req.body.days : []).filter((d) => Number.isInteger(d) && d >= 1 && d <= 31);
      if (!days.length || days.length > 8) throw bad('Give 1 to 8 pay days');
      const plan = r.planned?.[c.id] || 0;
      if (!plan) throw bad('Plan an amount for this income first');
      const list = autoPaychecks(req.params.month, { ...c, payDays: days }, plan).map((p) => ({ date: p.date, amount: p.amount }));
      r.paychecks = (r.paychecks || []).filter((p) => p.catId !== c.id).concat(cleanPaychecks(s, req.params.month, c.id, list));
      if (req.body?.remember) c.payDays = [...new Set(days)].sort((a, b) => a - b);
    });
    res.json(paycheckPlan(st(), req.params.month, todayStr()));
  });
  api.put('/paycheck/:month/due', (req, res) => {
    store.update((s) => {
      const r = monthRec(s, req.params.month);
      const c = s.categories.find((x) => x.id === req.body?.catId && x.type !== 'income');
      if (!c) throw bad('Unknown item');
      const day = req.body?.day;
      r.dueOverride = r.dueOverride || {};
      if (day == null) delete r.dueOverride[c.id];
      else if (Number.isInteger(day) && day >= 1 && day <= 31) r.dueOverride[c.id] = day;
      else throw bad('Day must be 1 to 31');
      if (req.body?.always) {
        if (day == null) delete c.dueDay;
        else c.dueDay = day;
        delete r.dueOverride[c.id];
      }
      if (!Object.keys(r.dueOverride).length) delete r.dueOverride;
    });
    res.json(paycheckPlan(st(), req.params.month, todayStr()));
  });

  /* ------------------------------------------------------ EveryDollar import */
  const edOpts = (b) => {
    const parsed = parseEveryDollar(b?.csv);
    const inferredMonth = monthFromFileName(b?.fileName);
    const groupTypes = b?.groupTypes && typeof b.groupTypes === 'object' ? b.groupTypes : {};
    return { parsed, opts: { month: b?.month, inferredMonth, groupTypes, debts: b?.debts !== false, spent: !!b?.spent, accountId: b?.accountId } };
  };
  api.post('/import/everydollar/preview', (req, res) => {
    const { parsed, opts } = edOpts(req.body);
    res.json({ ...planImport(st(), parsed, opts), accounts: st().accounts.filter((a) => !a.archived).map((a) => ({ id: a.id, name: a.name })) });
  });
  api.post('/import/everydollar/apply', (req, res) => {
    const { parsed, opts } = edOpts(req.body);
    const out = store.update((s) => applyImport(s, parsed, opts));
    res.json(out);
  });

  /* -------------------------------------------------------------- bitcoin */
  const walletView = (w) => ({ id: w.id, name: w.name, kind: w.xpub ? 'xpub' : w.address ? 'address' : 'manual', script: w.script, hint: w.xpub ? w.xpub.slice(0, 8) + '…' + w.xpub.slice(-6) : w.address ? w.address.slice(0, 8) + '…' + w.address.slice(-6) : '', manualSats: w.manualSats || 0, last: w.last || null });
  const btcView = () => {
    const v = btcValue(st());
    return { wallets: st().wallets.map(walletView), price: v.price, currency: v.currency, priceAt: v.priceAt, sats: v.sats, cents: v.cents, hasPrice: v.hasPrice, lookups: st().settings.btcLookups, api: st().settings.btcApi };
  };
  api.get('/btc', (_req, res) => res.json(btcView()));
  api.post('/btc/wallets', (req, res) => {
    const name = clampStr(req.body?.name, 40);
    if (!name) throw bad('Give the wallet a name');
    const w = { id: uid('w_'), name };
    if (req.body?.manualSats !== undefined && !req.body?.input) {
      const n = req.body.manualSats;
      if (!Number.isInteger(n) || n < 0 || n > 21_000_000 * 100_000_000) throw bad('Enter the amount in satoshis (whole number)');
      w.manualSats = n;
    } else {
      const c = classifyInput(req.body?.input);
      if (c.kind === 'xpub') {
        w.xpub = c.value;
        w.script = c.script;
      } else w.address = c.value;
      if (st().wallets.some((x) => (x.xpub || x.address) === c.value)) throw new HttpError(409, 'That wallet is already tracked');
    }
    store.update((s) => s.wallets.push(w));
    res.status(201).json(btcView());
  });
  api.patch('/btc/wallets/:id', (req, res) => {
    store.update((s) => {
      const w = s.wallets.find((x) => x.id === req.params.id);
      if (!w) throw notFound('Wallet not found');
      if (req.body?.name !== undefined) {
        const n = clampStr(req.body.name, 40);
        if (!n) throw bad('Give the wallet a name');
        w.name = n;
      }
      if (req.body?.manualSats !== undefined) {
        const n = req.body.manualSats;
        if (!Number.isInteger(n) || n < 0 || n > 21_000_000 * 100_000_000) throw bad('Enter the amount in satoshis (whole number)');
        w.manualSats = n;
      }
    });
    res.json(btcView());
  });
  api.delete('/btc/wallets/:id', (req, res) => {
    store.update((s) => {
      if (!s.wallets.some((x) => x.id === req.params.id)) throw notFound('Wallet not found');
      s.wallets = s.wallets.filter((x) => x.id !== req.params.id);
    });
    res.json(btcView());
  });
  api.post('/btc/refresh', async (_req, res, next) => {
    try {
    const set = st().settings;
    if (!set.btcLookups) throw bad('Lookups are turned off. Turn them on in Bitcoin settings, or enter amounts by hand.');
    const fetchImpl = app.locals.fetch || fetch;
    const jobs = st().wallets.filter((w) => w.xpub || w.address);
    const results = await Promise.all(jobs.map(async (w) => {
      try {
        const r = w.xpub ? await scanXpub(set.btcApi, w.xpub, w.script, { fetch: fetchImpl }) : await lookupAddress(set.btcApi, w.address, { fetch: fetchImpl });
        return [w.id, { confirmed: r.confirmed, pending: r.pending, txCount: r.txCount, at: new Date().toISOString() }];
      } catch (e) {
        return [w.id, { ...(w.last || {}), error: e.message, errorAt: new Date().toISOString() }];
      }
    }));
    let price = null;
    let priceError = null;
    try {
      price = await fetchPrice(set.btcApi, { fetch: fetchImpl });
    } catch (e) {
      priceError = e.message;
    }
    store.update((s) => {
      for (const [id, last] of results) {
        const w = s.wallets.find((x) => x.id === id);
        if (w) w.last = last;
      }
      if (price) s.btc = { price, priceAt: new Date().toISOString() };
    });
    res.json({ ...btcView(), priceError });
    } catch (e) {
      next(e);
    }
  });

  /* ------------------------------------------------------------ net worth */
  const nwView = () => {
    const s = st();
    const now = netWorthNow(s);
    const month = todayStr().slice(0, 7);
    if (snapshotMonth(s, month, now)) store.update((x) => snapshotMonth(x, month));
    return {
      assets: now.assets,
      liabilities: now.liabilities,
      totals: now.totals,
      history: st().networth.history,
      goals: st().networth.goals.map((g) => ({ ...g, ...goalProgress(g, now.totals) })),
      include: st().networth.include,
      btc: { sats: now.btc.sats, hasPrice: now.btc.hasPrice },
      assetCategories: ASSET_CATS,
      liabilityCategories: LIABILITY_CATS
    };
  };
  const nwList = (key, clean) => {
    api.post(`/networth/${key}`, (req, res) => {
      store.update((s) => s.networth[key].push(clean(req.body || {})));
      res.status(201).json(nwView());
    });
    api.patch(`/networth/${key}/:id`, (req, res) => {
      store.update((s) => {
        const i = s.networth[key].findIndex((x) => x.id === req.params.id);
        if (i < 0) throw notFound('Not found');
        s.networth[key][i] = clean(req.body || {}, s.networth[key][i]);
      });
      res.json(nwView());
    });
    api.delete(`/networth/${key}/:id`, (req, res) => {
      store.update((s) => {
        if (!s.networth[key].some((x) => x.id === req.params.id)) throw notFound('Not found');
        s.networth[key] = s.networth[key].filter((x) => x.id !== req.params.id);
      });
      res.json(nwView());
    });
  };
  nwList('assets', cleanAsset);
  nwList('liabilities', cleanLiability);
  nwList('goals', cleanGoal);
  api.get('/networth', (_req, res) => res.json(nwView()));
  api.put('/networth/include', (req, res) => {
    store.update((s) => {
      for (const k of ['accounts', 'bitcoin', 'debts']) if (req.body?.[k] !== undefined) s.networth.include[k] = !!req.body[k];
    });
    res.json(nwView());
  });
  api.put('/networth/history/:month', (req, res) => {
    const month = needMonth(req.params.month);
    store.update((s) => {
      const rec = { month, assets: asCents(req.body?.assets ?? 0, { name: 'Assets' }), liabilities: asCents(req.body?.liabilities ?? 0, { name: 'Liabilities' }), manual: true };
      s.networth.history = s.networth.history.filter((h) => h.month !== month).concat(rec).sort((a, b) => a.month.localeCompare(b.month));
    });
    res.json(nwView());
  });
  api.delete('/networth/history/:month', (req, res) => {
    const month = needMonth(req.params.month);
    store.update((s) => {
      s.networth.history = s.networth.history.filter((h) => h.month !== month);
    });
    res.json(nwView());
  });
  api.get('/networth.csv', (_req, res) => {
    const esc = (v) => {
      let x = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(x)) x = "'" + x;
      return /[",\n\r]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
    };
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="zerodollar-net-worth-${todayStr()}.csv"`);
    res.send(csvRows(st()).map((r) => r.map(esc).join(',')).join('\n') + '\n');
  });

  /* ------------------------------------------------------------- insights */
  api.get('/insights', (req, res) => {
    const today = isDate(req.query.today) ? req.query.today : todayStr();
    const r = resolveRange(String(req.query.range || 'ytd'), today);
    if (!r) throw bad('Unknown range');
    res.json(insights(st(), r.from, r.to, { savings: req.query.savings !== '0' }));
  });

  api.get('/due-week', (req, res) => {
    const today = isDate(req.query.today) ? req.query.today : todayStr();
    res.json(dueThisWeek(st(), today, 7));
  });

  /* ------------------------------------------------------- groups & cats */
  api.post('/groups', (req, res) => {
    const name = clampStr(req.body?.name, 40);
    if (!name) throw bad('Give the group a name');
    const g = store.update((s) => {
      const g = { id: uid('g_'), name, kind: 'expense', sort: Math.max(-1, ...s.groups.map((x) => x.sort)) + 1 };
      s.groups.push(g);
      return g;
    });
    res.status(201).json(g);
  });
  api.patch('/groups/:id', (req, res) => {
    const g = store.update((s) => {
      const g = s.groups.find((x) => x.id === req.params.id);
      if (!g) throw notFound('Group not found');
      if (req.body?.name !== undefined) {
        const n = clampStr(req.body.name, 40);
        if (!n) throw bad('Give the group a name');
        g.name = n;
      }
      if (req.body?.color !== undefined) {
        if (req.body.color === null || req.body.color === '') delete g.color;
        else if (/^#[0-9a-fA-F]{6}$/.test(req.body.color)) g.color = req.body.color.toLowerCase();
        else throw bad('Pick a colour from the list');
      }
      if (Number.isInteger(req.body?.sort)) g.sort = req.body.sort;
      return g;
    });
    res.json(g);
  });
  api.put('/groups-order', (req, res) => {
    const order = Array.isArray(req.body?.ids) ? req.body.ids : [];
    store.update((s) => order.forEach((id, i) => {
      const g = s.groups.find((x) => x.id === id);
      if (g) g.sort = i;
    }));
    res.json({ ok: true });
  });
  api.delete('/groups/:id', (req, res) => {
    store.update((s) => {
      const g = s.groups.find((x) => x.id === req.params.id);
      if (!g) throw notFound('Group not found');
      if (g.kind === 'income') throw bad('The income group cannot be removed');
      const cats = s.categories.filter((c) => c.groupId === g.id);
      if (cats.some((c) => !c.archived)) throw new HttpError(409, 'Move or remove this group\'s categories first');
      if (cats.length) g.archived = true;
      else s.groups = s.groups.filter((x) => x.id !== g.id);
    });
    res.json({ ok: true });
  });

  function applyCat(c, body, s) {
    if (body.name !== undefined) {
      const n = clampStr(body.name, 40);
      if (!n) throw bad('Give the category a name');
      c.name = n;
    }
    if (body.groupId !== undefined) {
      const g = s.groups.find((x) => x.id === body.groupId && !x.archived);
      if (!g) throw bad('Unknown group');
      if ((g.kind === 'income') !== (c.type === 'income')) throw bad('Income categories live in the Income group');
      c.groupId = g.id;
    }
    if (c.type === 'debt' && body.name !== undefined) {
      const d = s.debts.find((x) => x.id === c.debtId);
      if (d) d.name = c.name;
    }
    if (body.payDays !== undefined) {
      if (c.type !== 'income') throw bad('Pay days only apply to income items');
      const days = Array.isArray(body.payDays) ? body.payDays : [];
      if (days.length > 8 || days.some((d) => !Number.isInteger(d) || d < 1 || d > 31)) throw bad('Pay days must be day-of-month numbers, 1 to 31');
      if (days.length) c.payDays = [...new Set(days)].sort((a, b) => a - b);
      else delete c.payDays;
    }
    if (body.type !== undefined && body.type !== c.type) {
      if (!['expense', 'fund'].includes(body.type) || !['expense', 'fund'].includes(c.type)) throw bad('Only expense and fund categories can switch type');
      c.type = body.type;
    }
    if (body.dueDay !== undefined) {
      if (body.dueDay === null) delete c.dueDay;
      else if (Number.isInteger(body.dueDay) && body.dueDay >= 1 && body.dueDay <= 31) c.dueDay = body.dueDay;
      else throw bad('Due day must be 1 to 31');
    }
    if (body.target !== undefined) {
      if (!body.target) delete c.target;
      else c.target = asCents(body.target, { name: 'Target' });
    }
    if (body.fundStart !== undefined) c.fundStart = asCents(body.fundStart || 0, { allowNegative: true, name: 'Starting balance' });
    if (Number.isInteger(body.sort)) c.sort = body.sort;
  }
  api.post('/categories', (req, res) => {
    const c = store.update((s) => {
      const g = s.groups.find((x) => x.id === req.body?.groupId && !x.archived);
      if (!g) throw bad('Unknown group');
      const type = g.kind === 'income' ? 'income' : ['fund'].includes(req.body?.type) ? 'fund' : 'expense';
      const c = { id: uid('c_'), groupId: g.id, name: '', type, sort: Math.max(-1, ...s.categories.filter((x) => x.groupId === g.id).map((x) => x.sort)) + 1 };
      applyCat(c, { ...req.body, groupId: g.id, type }, s);
      if (!c.name) throw bad('Give the category a name');
      s.categories.push(c);
      return c;
    });
    res.status(201).json(c);
  });
  api.patch('/categories/:id', (req, res) => {
    const c = store.update((s) => {
      const c = s.categories.find((x) => x.id === req.params.id);
      if (!c) throw notFound('Category not found');
      applyCat(c, req.body || {}, s);
      return c;
    });
    res.json(c);
  });
  api.put('/categories-order', (req, res) => {
    const order = Array.isArray(req.body?.ids) ? req.body.ids : [];
    store.update((s) => order.forEach((id, i) => {
      const c = s.categories.find((x) => x.id === id);
      if (c) c.sort = i;
    }));
    res.json({ ok: true });
  });
  api.delete('/categories/:id', (req, res) => {
    const out = store.update((s) => {
      const c = s.categories.find((x) => x.id === req.params.id);
      if (!c) throw notFound('Category not found');
      if (c.type === 'debt') throw bad('Remove the debt on the Debt page instead');
      const used = s.transactions.some((t) => partsOf(t).some((p) => p.catId === c.id)) || Object.values(s.months).some((m) => m.planned?.[c.id]);
      if (used) {
        c.archived = true;
        return { archived: true };
      }
      s.categories = s.categories.filter((x) => x.id !== c.id);
      for (const k of Object.keys(s.payeeRules)) if (s.payeeRules[k] === c.id) delete s.payeeRules[k];
      return { archived: false };
    });
    res.json(out);
  });

  /* ------------------------------------------------------------ accounts */
  function applyAccount(a, body) {
    if (body.name !== undefined) {
      const n = clampStr(body.name, 40);
      if (!n) throw bad('Give the account a name');
      a.name = n;
    }
    if (body.type !== undefined) {
      if (!ACCOUNT_TYPES.includes(body.type)) throw bad('Unknown account type');
      a.type = body.type;
    }
    if (body.openingBalance !== undefined) a.openingBalance = asCents(body.openingBalance, { allowNegative: true, name: 'Opening balance' });
    if (body.archived !== undefined) a.archived = !!body.archived;
  }
  api.post('/accounts', (req, res) => {
    const a = store.update((s) => {
      const a = { id: uid('a_'), name: '', type: 'checking', openingBalance: 0, archived: false };
      applyAccount(a, req.body || {});
      if (!a.name) throw bad('Give the account a name');
      s.accounts.push(a);
      return a;
    });
    res.status(201).json(a);
  });
  api.patch('/accounts/:id', (req, res) => {
    const a = store.update((s) => {
      const a = s.accounts.find((x) => x.id === req.params.id);
      if (!a) throw notFound('Account not found');
      applyAccount(a, req.body || {});
      return a;
    });
    res.json(a);
  });
  api.delete('/accounts/:id', (req, res) => {
    const out = store.update((s) => {
      const a = s.accounts.find((x) => x.id === req.params.id);
      if (!a) throw notFound('Account not found');
      const used = s.transactions.some((t) => t.accountId === a.id || t.toAccountId === a.id) || s.statements.some((x) => x.accountId === a.id);
      if (used) {
        a.archived = true;
        return { archived: true };
      }
      if (s.accounts.length <= 1) throw bad('Keep at least one account');
      s.accounts = s.accounts.filter((x) => x.id !== a.id);
      return { archived: false };
    });
    res.json(out);
  });

  /* -------------------------------------------------------- transactions */
  api.get('/transactions', (req, res) => {
    const { month, accountId, catId, q, uncategorized, unreconciled } = req.query;
    const limit = Math.min(2000, Math.max(1, parseInt(req.query.limit, 10) || 500));
    const needle = q ? String(q).toLowerCase() : '';
    const cats = byId(st().categories);
    let list = st().transactions.filter((t) => {
      if (month && !t.date.startsWith(month)) return false;
      if (accountId && t.accountId !== accountId && t.toAccountId !== accountId) return false;
      if (catId && !partsOf(t).some((p) => p.catId === catId)) return false;
      if (uncategorized && (t.type === 'transfer' || partsOf(t).length)) return false;
      if (unreconciled && t.reconciled) return false;
      if (needle) {
        const hay = `${t.payee} ${t.memo} ${partsOf(t).map((p) => cats.get(p.catId)?.name || '').join(' ')} ${(t.amount / 100).toFixed(2)}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    list.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    res.json({ total: list.length, transactions: list.slice(0, limit) });
  });
  api.post('/transactions', (req, res) => {
    const t = store.update((s) => {
      const t = buildTx(req.body || {});
      s.transactions.push(t);
      S.learnPayee(s, t);
      return t;
    });
    res.status(201).json(t);
  });
  api.patch('/transactions/:id', (req, res) => {
    const t = store.update((s) => {
      const i = s.transactions.findIndex((x) => x.id === req.params.id);
      if (i < 0) throw notFound('Transaction not found');
      const t = buildTx(req.body || {}, s.transactions[i]);
      s.transactions[i] = t;
      S.learnPayee(s, t);
      return t;
    });
    res.json(t);
  });
  api.delete('/transactions/:id', (req, res) => {
    store.update((s) => {
      const i = s.transactions.findIndex((x) => x.id === req.params.id);
      if (i < 0) throw notFound('Transaction not found');
      const id = s.transactions[i].id;
      s.transactions.splice(i, 1);
      for (const stm of s.statements) {
        for (const r of stm.rows) {
          if (r.txId !== id) continue;
          r.txId = null;
          if (!stm.finalizedAt) {
            r.status = 'new';
            r.auto = false;
          }
        }
      }
    });
    res.json({ ok: true });
  });
  api.post('/transactions/bulk-category', (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const catId = req.body?.catId || null;
    if (catId && !catExists(catId)) throw bad('Unknown category');
    const n = store.update((s) => {
      let n = 0;
      for (const t of s.transactions) {
        if (!ids.includes(t.id) || t.type === 'transfer') continue;
        t.catId = catId;
        delete t.splits;
        S.learnPayee(s, t);
        n++;
      }
      return n;
    });
    res.json({ updated: n });
  });

  /* ---------------------------------------------------------- statements */
  function statementView(stm) {
    const sum = S.statementSummary(st(), stm);
    return { ...stm, summary: sum };
  }
  api.get('/statements', (_req, res) => {
    res.json(
      st().statements
        .map((x) => ({
          id: x.id, accountId: x.accountId, fileName: x.fileName, importedAt: x.importedAt, finalizedAt: x.finalizedAt, rows: x.rows.length,
          unresolved: x.rows.filter((r) => r.status === 'new' || r.status === 'suggested').length
        }))
        .sort((a, b) => b.importedAt.localeCompare(a.importedAt))
    );
  });
  api.post('/statements', (req, res) => {
    const { accountId, fileName, content, flip } = req.body || {};
    if (typeof content !== 'string') throw bad('No file content received');
    const parsed = parseStatement(content, fileName || '', { dateOrder: st().settings.dateOrder });
    const created = store.update((s) => S.createStatement(s, { accountId, fileName, parsed, flip: typeof flip === 'boolean' ? flip : null }));
    res.status(201).json(statementView(created));
  });
  const stmt = (id) => S.getStatement(st(), id);
  api.get('/statements/:id', (req, res) => res.json(statementView(stmt(req.params.id))));
  api.post('/statements/:id/flip', (req, res) => {
    store.update((s) => S.setFlip(s, req.params.id, !!req.body?.flip));
    res.json(statementView(stmt(req.params.id)));
  });
  api.post('/statements/:id/rematch', (req, res) => {
    store.update((s) => {
      const x = S.getStatement(s, req.params.id);
      if (x.finalizedAt) throw new HttpError(409, 'Already reconciled');
      S.autoMatch(s, x);
    });
    res.json(statementView(stmt(req.params.id)));
  });
  api.post('/statements/:id/rows/:rowId/link', (req, res) => {
    store.update((s) => S.link(s, req.params.id, req.params.rowId, req.body?.txId));
    res.json(statementView(stmt(req.params.id)));
  });
  api.post('/statements/:id/rows/:rowId/unlink', (req, res) => {
    store.update((s) => S.unlink(s, req.params.id, req.params.rowId));
    res.json(statementView(stmt(req.params.id)));
  });
  api.post('/statements/:id/rows/:rowId/accept', (req, res) => {
    store.update((s) => S.accept(s, req.params.id, req.params.rowId));
    res.json(statementView(stmt(req.params.id)));
  });
  api.post('/statements/:id/rows/:rowId/ignore', (req, res) => {
    store.update((s) => S.ignoreRow(s, req.params.id, req.params.rowId, req.body?.ignore !== false));
    res.json(statementView(stmt(req.params.id)));
  });
  api.post('/statements/:id/rows/:rowId/add', (req, res) => {
    store.update((s) => S.addRow(s, req.params.id, req.params.rowId, req.body || {}));
    res.json(statementView(stmt(req.params.id)));
  });
  api.post('/statements/:id/add-all', (req, res) => {
    const { added } = store.update((s) => S.addAll(s, req.params.id, { onlyKnown: req.body?.onlyKnown !== false }));
    res.json({ added, statement: statementView(stmt(req.params.id)) });
  });
  api.post('/statements/:id/finalize', (req, res) => {
    const out = store.update((s) => S.finalize(s, req.params.id, { endBalance: req.body?.endBalance, force: !!req.body?.force }));
    res.json({ reconciled: out.reconciled, statement: statementView(stmt(req.params.id)) });
  });
  api.post('/statements/:id/reopen', (req, res) => {
    store.update((s) => S.reopen(s, req.params.id));
    res.json(statementView(stmt(req.params.id)));
  });
  api.delete('/statements/:id', (req, res) => {
    store.update((s) => S.removeStatement(s, req.params.id));
    res.json({ ok: true });
  });

  /* ---------------------------------------------------------------- debts */
  function debtGroup(s) {
    let g = s.groups.find((x) => x.name === 'Debt' && x.kind !== 'income' && !x.archived);
    if (!g) {
      g = { id: uid('g_'), name: 'Debt', kind: 'expense', sort: Math.max(-1, ...s.groups.map((x) => x.sort)) + 1 };
      s.groups.push(g);
    }
    return g;
  }
  function applyDebt(d, body) {
    if (body.name !== undefined) {
      const n = clampStr(body.name, 40);
      if (!n) throw bad('Give the debt a name');
      d.name = n;
    }
    if (body.balance !== undefined) {
      d.baseBalance = asCents(body.balance, { name: 'Balance' });
      d.asOf = isDate(body.asOf) ? body.asOf : todayStr();
    }
    if (body.minPayment !== undefined) d.minPayment = asCents(body.minPayment, { name: 'Minimum payment' });
    if (body.apr !== undefined) {
      const apr = Number(body.apr);
      if (!Number.isFinite(apr) || apr < 0 || apr > 100) throw bad('Interest rate must be between 0 and 100');
      d.apr = apr;
    }
  }
  api.post('/debts', (req, res) => {
    const d = store.update((s) => {
      const d = { id: uid('d_'), name: '', baseBalance: 0, asOf: todayStr(), minPayment: 0, apr: 0 };
      applyDebt(d, req.body || {});
      if (!d.name) throw bad('Give the debt a name');
      const g = debtGroup(s);
      const c = { id: uid('c_'), groupId: g.id, name: d.name, type: 'debt', debtId: d.id, sort: s.categories.filter((x) => x.groupId === g.id).length };
      d.catId = c.id;
      s.categories.push(c);
      s.debts.push(d);
      return d;
    });
    res.status(201).json(d);
  });
  api.patch('/debts/:id', (req, res) => {
    const d = store.update((s) => {
      const d = s.debts.find((x) => x.id === req.params.id);
      if (!d) throw notFound('Debt not found');
      applyDebt(d, req.body || {});
      const c = s.categories.find((x) => x.id === d.catId);
      if (c) c.name = d.name;
      return d;
    });
    res.json(d);
  });
  api.delete('/debts/:id', (req, res) => {
    store.update((s) => {
      const d = s.debts.find((x) => x.id === req.params.id);
      if (!d) throw notFound('Debt not found');
      s.debts = s.debts.filter((x) => x.id !== d.id);
      const c = s.categories.find((x) => x.id === d.catId);
      if (c) {
        const used = s.transactions.some((t) => partsOf(t).some((p) => p.catId === c.id)) || Object.values(s.months).some((m) => m.planned?.[c.id]);
        if (used) {
          c.archived = true;
          delete c.debtId;
          c.type = 'expense';
        } else s.categories = s.categories.filter((x) => x.id !== c.id);
      }
    });
    res.json({ ok: true });
  });
  api.get('/debts/plan', (req, res) => {
    const extra = Math.max(0, parseInt(req.query.extra, 10) || 0);
    const strategy = req.query.strategy === 'avalanche' ? 'avalanche' : 'snowball';
    const s = st();
    const input = s.debts.map((d) => ({ id: d.id, name: d.name, balance: debtBalance(s, d), apr: d.apr, minPayment: d.minPayment }));
    res.json({
      debts: input,
      plan: simulate(input, extra, strategy),
      minimumsOnly: simulate(input, 0, strategy),
      total: input.reduce((n, d) => n + d.balance, 0)
    });
  });

  /* -------------------------------------------------------------- reports */
  api.get('/reports/spending', (req, res) => {
    const month = needMonth(req.query.month);
    const span = Math.min(24, Math.max(1, parseInt(req.query.months, 10) || 1));
    const from = `${addMonths(month, -(span - 1))}-01`;
    const to = monthEnd(month);
    res.json({ from, to, categories: spendingByCategory(st(), from, to), payees: topPayees(st(), from, to, 10) });
  });
  api.get('/reports/trend', (req, res) => {
    const month = needMonth(req.query.month);
    res.json({ trend: monthlyTrend(st(), month, 12), netWorth: netWorthSeries(st(), month, 12) });
  });

  /* ------------------------------------------------------------- settings */
  api.get('/settings', (_req, res) => res.json(st().settings));
  api.put('/settings', (req, res) => {
    const b = req.body || {};
    const out = store.update((s) => {
      if (b.currency !== undefined) {
        if (!/^[A-Z]{3}$/.test(b.currency)) throw bad('Currency must be a 3-letter code such as USD');
        s.settings.currency = b.currency;
      }
      if (b.locale !== undefined) {
        try {
          new Intl.NumberFormat(b.locale);
        } catch {
          throw bad('Unknown locale');
        }
        s.settings.locale = clampStr(b.locale, 20);
      }
      if (b.matchWindowDays !== undefined) {
        if (!Number.isInteger(b.matchWindowDays) || b.matchWindowDays < 0 || b.matchWindowDays > 15) throw bad('Match window must be 0 to 15 days');
        s.settings.matchWindowDays = b.matchWindowDays;
      }
      if (b.dateOrder !== undefined) {
        if (!['mdy', 'dmy'].includes(b.dateOrder)) throw bad('Date order must be mdy or dmy');
        s.settings.dateOrder = b.dateOrder;
      }
      if (b.btcLookups !== undefined) s.settings.btcLookups = !!b.btcLookups;
      if (b.btcApi !== undefined) s.settings.btcApi = normalizeApi(b.btcApi);
      if (b.householdName !== undefined) s.settings.householdName = clampStr(b.householdName, 40);
      return s.settings;
    });
    res.json(out);
  });

  /* ---------------------------------------------------------- backup & CSV */
  api.get('/export', (_req, res) => {
    res.setHeader('Content-Disposition', `attachment; filename="zerodollar-backup-${todayStr()}.json"`);
    res.json(st());
  });
  api.post('/import', (req, res) => {
    const data = req.body;
    if (!data || typeof data !== 'object' || !Array.isArray(data.transactions) || !Array.isArray(data.categories)) {
      throw bad('That does not look like a ZeroDollar backup');
    }
    store.replace(structuredClone(data));
    res.json({ ok: true, transactions: st().transactions.length });
  });
  api.post('/reset', (req, res) => {
    if (req.body?.confirm !== 'ERASE') throw bad('Send {"confirm":"ERASE"} to wipe everything');
    store.replace(defaultState());
    res.json({ ok: true });
  });
  api.get('/export/transactions.csv', (req, res) => {
    const s = st();
    const cats = byId(s.categories);
    const accts = byId(s.accounts);
    const esc = (v) => {
      let x = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(x)) x = "'" + x; // keep spreadsheets from running cell content as a formula
      return /[",\n\r]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
    };
    const lines = [['Date', 'Type', 'Amount', 'Payee', 'Category', 'Account', 'To account', 'Memo', 'Reconciled'].join(',')];
    for (const t of [...s.transactions].sort((a, b) => a.date.localeCompare(b.date))) {
      const parts = partsOf(t);
      const catName = parts.length > 1 ? parts.map((p) => `${cats.get(p.catId)?.name || '?'} ${(p.amount / 100).toFixed(2)}`).join(' | ') : cats.get(parts[0]?.catId)?.name || '';
      lines.push([t.date, t.type, (t.amount / 100).toFixed(2), t.payee, catName, accts.get(t.accountId)?.name, accts.get(t.toAccountId)?.name || '', t.memo, t.reconciled ? 'yes' : ''].map(esc).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="zerodollar-transactions-${todayStr()}.csv"`);
    res.send(lines.join('\n') + '\n');
  });

  app.use('/api', api);

  /* --------------------------------------------------------------- misc */
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.get('/cw', (_req, res) => {
    res.type('text/plain').send(`${morse('ZERO IS THE HERO')}\n`);
  });
  // Umbrel home-screen widget
  app.get('/widgets/left', (_req, res) => {
    const month = todayStr().slice(0, 7);
    const b = computeBudget(st(), month);
    const cur = st().settings.currency;
    const fmt = (c) => new Intl.NumberFormat(st().settings.locale, { style: 'currency', currency: cur }).format(c / 100);
    const planned = b.totals.plannedIncome;
    res.json({
      type: 'text-with-progress',
      link: '',
      title: 'Left to budget',
      text: fmt(b.totals.leftToBudget),
      progressLabel: planned ? `${fmt(b.totals.plannedOut)} of ${fmt(planned)} planned` : 'Add your income to start',
      progress: planned ? Math.max(0, Math.min(1, b.totals.plannedOut / planned)) : 0
    });
  });

  app.use(express.static(publicDir, { maxAge: '5m', extensions: ['html'] }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.auth ? { auth: true } : {}) });
    if (err.status === 429) return res.status(429).json({ error: err.message });
    if (err.status === 400 && err.message) return res.status(400).json({ error: err.message }); // validation errors from lib/bitcoin.js
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That file is too large' });
    if (err instanceof SyntaxError && 'body' in err) return res.status(400).json({ error: 'Invalid JSON' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server' });
  });

  const timer = process.env.ZD_NO_TIMER ? null : setInterval(() => checkReminders().catch((e) => console.error('reminders:', e.message)), 60000);
  timer?.unref();
  return { app, store, priv, auth, checkReminders };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3973;
  const { app } = createApp();
  const server = app.listen(port, '0.0.0.0', () => console.log(`ZeroDollar listening on ${port}`));
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

void normPayee;
void splitEvenly;
void localParts;
