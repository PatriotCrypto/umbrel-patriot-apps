import { monthEnd, uid, isDate, bad } from './util.js';
import { activityByCategory, byId } from './budget.js';

/**
 * Paycheck planning: lay the month's planned income and bills out by date, carry a running
 * balance from a starting buffer, and say how likely you are to run short.
 *
 * Month data (all optional): months[m].buffer (cents), months[m].paychecks [{id,catId,date,amount}],
 * months[m].dueOverride {catId: dayOfMonth}. Income categories may carry payDays [2,16] and then
 * split their planned amount over those days until real paychecks are entered for the month.
 */

const dayIn = (month, day) => `${month}-${String(Math.min(Math.max(1, day), Number(monthEnd(month).slice(8)))).padStart(2, '0')}`;

/** Split cents evenly; any remainder lands on the last paycheck. */
export function splitEvenly(total, n) {
  const base = Math.floor(total / n);
  const out = Array(n).fill(base);
  out[n - 1] += total - base * n;
  return out;
}

export function autoPaychecks(month, cat, planned) {
  const days = [...new Set((cat.payDays || []).filter((d) => Number.isInteger(d) && d >= 1 && d <= 31))].sort((a, b) => a - b);
  if (!planned || !days.length) return [];
  const amounts = splitEvenly(planned, days.length);
  return days.map((d, i) => ({ id: `auto_${cat.id}_${i}`, catId: cat.id, date: dayIn(month, d), amount: amounts[i], auto: true }));
}

export function paycheckPlan(state, month, todayDate = null) {
  const rec = state.months[month];
  if (!rec) return { month, initialized: false };
  const planned = rec.planned || {};
  const cats = byId(state.categories);
  const activity = activityByCategory(state, `${month}-01`, monthEnd(month), cats);
  const events = [];
  const unscheduledIncome = [];
  const warnings = [];

  const groupOf = byId(state.groups);
  for (const c of state.categories) {
    if (c.archived || groupOf.get(c.groupId)?.archived) continue;
    const p = planned[c.id] || 0;
    if (c.type === 'income') {
      if (!p) continue;
      const stored = (rec.paychecks || []).filter((x) => x.catId === c.id);
      const list = stored.length ? stored : autoPaychecks(month, c, p);
      const sum = list.reduce((n, x) => n + x.amount, 0);
      list.sort((a, b) => a.date.localeCompare(b.date)).forEach((x, i) => {
        events.push({ key: x.id, id: x.id, kind: 'income', catId: c.id, name: c.name, date: x.date, amount: x.amount, n: i + 1, of: list.length, auto: !!x.auto });
      });
      if (sum !== p) unscheduledIncome.push({ catId: c.id, name: c.name, planned: p, scheduled: sum, left: p - sum });
    } else if (p > 0) {
      const day = rec.dueOverride?.[c.id] || c.dueDay;
      if (!day) continue;
      const paid = c.type === 'expense' || c.type === 'debt' ? (activity.get(c.id) || 0) >= p : false;
      events.push({ key: 'bill_' + c.id, kind: c.type === 'fund' ? 'fund' : c.type === 'debt' ? 'debt' : 'bill', catId: c.id, name: c.name, date: dayIn(month, day), amount: p, day, paid, moved: !!rec.dueOverride?.[c.id] });
    }
  }

  const buffer = rec.buffer || 0;
  events.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'income' ? -1 : 0) - (b.kind === 'income' ? -1 : 0) || a.name.localeCompare(b.name));
  let bal = buffer;
  let min = buffer;
  let minDate = null;
  let scheduledOut = 0;
  let scheduledIn = 0;
  for (const e of events) {
    if (e.kind === 'income') {
      bal += e.amount;
      scheduledIn += e.amount;
    } else {
      bal -= e.amount;
      scheduledOut += e.amount;
    }
    e.balance = bal;
    if (bal < min || minDate === null) {
      if (bal < min) {
        min = bal;
        minDate = e.date;
      }
    }
  }

  // Spending with no due date: planned, but not tied to a day.
  let unscheduledOut = 0;
  const missingDue = [];
  for (const c of state.categories) {
    if (c.archived || c.type === 'income' || groupOf.get(c.groupId)?.archived) continue;
    const p = planned[c.id] || 0;
    if (!p) continue;
    if (!(rec.dueOverride?.[c.id] || c.dueDay)) {
      unscheduledOut += p;
      if (c.type === 'debt') missingDue.push(c.name);
    }
  }
  if (unscheduledIncome.length) warnings.push('Some planned income is not placed on a date yet, so it is left out of the running balance.');
  if (missingDue.length) warnings.push(`No due day yet for: ${missingDue.slice(0, 4).join(', ')}${missingDue.length > 4 ? ` and ${missingDue.length - 4} more` : ''}.`);

  const endBalance = bal;
  const afterUnscheduled = endBalance - unscheduledOut;
  const needed = Math.max(0, -min);
  let level;
  let message;
  if (!events.length) {
    level = 'none';
    message = 'Add paychecks and due days to see how the month flows.';
  } else if (min < 0) {
    level = 'high';
    message = `Your balance drops below zero on ${minDate}.`;
  } else if (afterUnscheduled < 0) {
    level = 'medium';
    message = 'Your dated bills are covered, but spending without a due date would leave the month short.';
  } else {
    level = 'low';
    message = buffer ? 'Your income and buffer cover everything you have planned.' : 'Your income covers everything you have planned.';
  }

  return {
    month,
    initialized: true,
    buffer,
    events,
    unscheduledIncome,
    totals: { scheduledIn, scheduledOut, unscheduledOut, endBalance, afterUnscheduled },
    risk: { level, message, minBalance: events.length ? min : 0, minDate, neededBuffer: needed },
    warnings,
    today: todayDate
  };
}

/** Validate and normalise a paycheck list for one income category. */
export function cleanPaychecks(state, month, catId, list) {
  const c = state.categories.find((x) => x.id === catId);
  if (!c || c.type !== 'income') throw bad('Paychecks belong to an income item');
  if (!Array.isArray(list) || list.length > 31) throw bad('Too many paychecks');
  return list.map((p) => {
    if (!isDate(p?.date) || p.date.slice(0, 7) !== month) throw bad('Each paycheck needs a date inside this month');
    if (!Number.isInteger(p.amount) || p.amount <= 0) throw bad('Each paycheck needs an amount above zero');
    return { id: uid('p_'), catId, date: p.date, amount: p.amount };
  });
}

const shiftDay = (date, n) => {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Bills that are actually due in the next `days` days (today included), plus unpaid ones
 * from earlier this month marked overdue. Paid bills and income are left out.
 */
export function dueThisWeek(state, today, days = 7) {
  const end = shiftDay(today, days - 1);
  const months = [...new Set([today.slice(0, 7), end.slice(0, 7)])];
  const out = [];
  for (const m of months) {
    const plan = paycheckPlan(state, m, today);
    if (!plan.initialized) continue;
    for (const e of plan.events) {
      if (e.kind === 'income' || e.paid) continue;
      if (e.date >= today && e.date <= end) out.push({ catId: e.catId, name: e.name, date: e.date, amount: e.amount, kind: e.kind, overdue: false });
      else if (m === today.slice(0, 7) && e.date < today && e.kind !== 'fund') out.push({ catId: e.catId, name: e.name, date: e.date, amount: e.amount, kind: e.kind, overdue: true });
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  return { from: today, to: end, items: out, total: out.reduce((n, x) => n + x.amount, 0) };
}
