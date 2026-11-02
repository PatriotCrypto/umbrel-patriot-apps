'use strict';
// JSON for the umbrelOS home-screen widgets. These endpoints are reached by
// umbrelOS directly over the Docker network. They never include vault data
// and honor stealth mode (sensitive categories are already filtered upstream).

const fmtDays = (d, sustainable) => (sustainable ? 'OK' : (d == null ? '0' : String(Math.round(d))));

function readinessWidget(ctx) {
  const { ready, settings } = ctx;
  return {
    type: 'text-with-progress',
    link: '',
    title: settings.groupName || 'Readiness',
    text: String(ready.score),
    progressLabel: ready.grade,
    progress: Math.max(0, Math.min(1, ready.score / 100)),
  };
}

function suppliesWidget(ctx) {
  const { sup, alerts } = ctx;
  const expiring = alerts.filter((a) => a.kind === 'expiring' || a.kind === 'expired').length;
  const low = alerts.filter((a) => a.kind === 'low').length;
  return {
    type: 'four-stats',
    link: '',
    items: [
      { title: 'Food', text: sup.needs.kcal > 0 ? fmtDays(sup.food.days, false) : '-', subtext: 'days' },
      { title: 'Water', text: sup.needs.water.survival > 0 ? fmtDays(sup.water.survivalDays, sup.water.survivalSustainable) : '-', subtext: sup.water.survivalSustainable ? 'sustainable' : 'days' },
      { title: 'Expiring', text: String(expiring), subtext: 'items' },
      { title: 'Low stock', text: String(low), subtext: 'items' },
    ],
  };
}

function attentionWidget(ctx) {
  const emoji = { crit: '🔴', warn: '🟠', info: '🔵' };
  const items = ctx.alerts.slice(0, 4).map((a) => ({
    emoji: emoji[a.sev] || '🔵',
    text: a.title.slice(0, 60),
    subtext: (a.detail || '').slice(0, 40),
  }));
  return { type: 'list-emoji', link: '', count: items.length, items, noItemsText: 'All clear' };
}

module.exports = { readinessWidget, suppliesWidget, attentionWidget };
