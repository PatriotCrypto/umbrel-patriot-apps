'use strict';
// The Patriot Apps Liberty AI knows about. `host` / `internal` are how the other
// containers are reached over Umbrel's Docker network. `widgets` are the read-only
// JSON endpoints those apps already publish for the umbrelOS home screen.
// An app can also publish GET /liberty-ai/summary (see the README) to share more.

const A = (id, name, port, extra) => Object.assign({
  id: 'patriot-' + id, name, port, host: 'patriot-' + id + '_web_1', internal: port, widgets: [], keywords: [],
  blurb: '', sensitive: false, reachable: true,
}, extra);

const PATRIOT = [
  A('zerodollar', 'ZeroDollar', 3973, {
    widgets: [{ path: '/widgets/left', label: 'Budget' }], sensitive: true,
    keywords: ['budget', 'money', 'spend', 'spending', 'bill', 'bills', 'paycheck', 'envelope', 'left to budget', 'zerodollar'],
    blurb: 'Zero-based budgeting',
  }),
  A('family-vault', 'Family Vault', 3921, { internal: 3000, sensitive: true, keywords: ['vault', 'document', 'documents', 'family vault'], blurb: 'Encrypted family papers' }),
  A('rally-point', 'Rally Point', 3967, {
    widgets: [
      { path: '/widgets/readiness', label: 'Readiness' },
      { path: '/widgets/supplies', label: 'Supplies' },
      { path: '/widgets/attention', label: 'Needs attention' },
    ],
    keywords: ['prep', 'prepping', 'supplies', 'food', 'water', 'readiness', 'inventory', 'expiring', 'expire', 'rally point', 'stockpile', 'pantry'],
    blurb: 'Preparedness planner',
  }),
  A('bible-terminal', 'Bible Terminal', 3953, { keywords: ['bible', 'verse', 'scripture', 'kjv'], blurb: 'KJV study desk' }),
  A('pilot-logbook', 'Pilot Log', 8080, { internal: 8080, keywords: ['logbook', 'flight log', 'flight hours', 'pilot log'], blurb: 'Flight log and backup', sensitive: true }),
  A('owner-log', 'Owner Log', 8232, { internal: 8080, keywords: ['owner log', 'aircraft maintenance', 'annual'], blurb: 'Aircraft ownership records' }),
  A('builder-log', 'Builder Log', 8231, { internal: 8080, keywords: ['builder log', 'build log', 'rv-12', 'kit build'], blurb: 'Kit-plane build log' }),
  A('skywatch', 'Skywatch Radar', 3928, { keywords: ['radar', 'aircraft overhead', 'skywatch', 'planes'], blurb: 'Live sky radar' }),
  A('skynet', 'Skynet', 3959, { keywords: ['mesh', 'meshtastic', 'ham', 'radio', 'skynet'], blurb: 'Mesh and ham radio hub' }),
  A('uplink', 'Uplink', 3947, { internal: 3000, keywords: ['uplink', 'chat link'], blurb: 'Private chat and files' }),
  A('disc-ripper', 'Disc Ripper', 3926, { internal: 3000, keywords: ['dvd', 'disc', 'ripper', 'rip'], blurb: 'DVD to Jellyfin' }),
  A('ipod-sync', 'uPod', 8741, { internal: 8080, keywords: ['ipod', 'upod', 'music player'], blurb: 'Music player and iPod sync' }),
  A('coldfront', 'Cold Front', 3971, {
    widgets: [
      { path: '/api/widget/status', label: 'Thermostat' },
      { path: '/api/widget/filter', label: 'Furnace filter' },
    ],
    keywords: ['thermostat', 'furnace', 'hvac', 'heat', 'cooling', 'filter', 'cold front', 'indoor temperature'],
    blurb: 'Local thermostat control',
  }),
  A('liberty-ai', 'Liberty AI', 3979, { host: null, reachable: false, blurb: 'This app: server doctor and AI' }),
  A('constellation', 'Constellation', 3977, {
    host: null, reachable: false, keywords: ['network', 'wifi', 'wi-fi', 'devices on my network', 'constellation', 'starlink'],
    blurb: 'Your network in 3D',
  }),
];

const BY_ID = new Map(PATRIOT.map((a) => [a.id, a]));

function find(id) { return BY_ID.get(id) || null; }

module.exports = { PATRIOT, find };
