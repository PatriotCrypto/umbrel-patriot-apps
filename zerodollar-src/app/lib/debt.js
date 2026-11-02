/**
 * Debt payoff simulation. `debts`: [{id, name, balance, apr, minPayment}] (cents, apr in percent).
 * Minimums are paid on everything; the rest of the monthly budget (extra + minimums freed by paid-off
 * debts) goes to the first debt in order. Snowball orders by smallest balance, avalanche by highest rate.
 */
export function simulate(debts, extra = 0, strategy = 'snowball') {
  const live = debts
    .filter((d) => d.balance > 0)
    .map((d) => ({ id: d.id, name: d.name, bal: d.balance, apr: d.apr || 0, min: d.minPayment || 0, start: d.balance }));
  if (strategy === 'avalanche') live.sort((a, b) => b.apr - a.apr || a.bal - b.bal);
  else live.sort((a, b) => a.bal - b.bal || b.apr - a.apr);
  const budget = live.reduce((s, d) => s + d.min, 0) + Math.max(0, extra);
  const payoff = new Map();
  const timeline = [{ month: 0, total: live.reduce((s, d) => s + d.bal, 0) }];
  let totalInterest = 0;
  let month = 0;
  const LIMIT = 600;

  while (live.some((d) => d.bal > 0) && month < LIMIT) {
    month++;
    for (const d of live) {
      if (d.bal <= 0) continue;
      const i = Math.round((d.bal * d.apr) / 1200);
      d.bal += i;
      totalInterest += i;
    }
    let pool = budget;
    for (const d of live) {
      if (d.bal <= 0) continue;
      const pay = Math.min(d.min, d.bal, pool);
      d.bal -= pay;
      pool -= pay;
    }
    for (const d of live) {
      if (pool <= 0) break;
      if (d.bal <= 0) continue;
      const pay = Math.min(d.bal, pool);
      d.bal -= pay;
      pool -= pay;
    }
    for (const d of live) if (d.bal <= 0 && !payoff.has(d.id)) payoff.set(d.id, month);
    timeline.push({ month, total: live.reduce((s, d) => s + Math.max(0, d.bal), 0) });
    if (budget === 0) break;
  }
  const done = !live.some((d) => d.bal > 0);
  return {
    strategy,
    months: done ? month : null,
    neverPaysOff: !done,
    totalInterest,
    budget,
    order: live.map((d) => d.id),
    payoff: live.map((d) => ({ id: d.id, name: d.name, month: payoff.get(d.id) ?? null })),
    timeline: timeline.filter((_, i) => i % Math.max(1, Math.ceil(timeline.length / 60)) === 0 || i === timeline.length - 1)
  };
}
