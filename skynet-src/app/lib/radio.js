'use strict';
// Ham/handheld helpers: record sanitising, CHIRP CSV import/export, ADIF export, presets.

const SERVICES = ['ham', 'GMRS', 'FRS', 'MURS', 'NOAA', 'MARINE', 'AIR', 'PUBLIC', 'other'];
const MODES = ['FM', 'NFM', 'AM', 'USB', 'LSB', 'CW', 'DIG'];
const TONES = ['', 'Tone', 'TSQL'];
const CTCSS = [67.0, 69.3, 71.9, 74.4, 77.0, 79.7, 82.5, 85.4, 88.5, 91.5, 94.8, 97.4, 100.0, 103.5, 107.2, 110.9, 114.8, 118.8, 123.0, 127.3, 131.8, 136.5, 141.3, 146.2, 151.4, 156.7, 162.2, 167.9, 173.8, 179.9, 186.2, 192.8, 203.5, 210.7, 218.1, 225.7, 233.6, 241.8, 250.3, 254.1];

const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };

function sanitizeFreq(b, old = {}) {
  const f = num(b.freq);
  if (f === null || f < 0.1 || f > 3000) return { error: 'frequency must be in MHz, between 0.1 and 3000' };
  const off = num(b.offset);
  const rt = num(b.rTone);
  return {
    value: {
      ...old,
      name: clean(b.name, 40), freq: Math.round(f * 1e6) / 1e6,
      mode: MODES.includes(b.mode) ? b.mode : 'FM',
      duplex: ['+', '-'].includes(b.duplex) ? b.duplex : '',
      offset: off !== null && off >= 0 && off < 1000 ? Math.round(off * 1e6) / 1e6 : 0,
      tone: TONES.includes(b.tone) ? b.tone : '',
      rTone: rt !== null && CTCSS.includes(rt) ? rt : 88.5,
      service: SERVICES.includes(b.service) ? b.service : 'ham',
      listenOnly: !!b.listenOnly, inRadio: !!b.inRadio,
      slot: Number.isInteger(b.slot) && b.slot >= 0 && b.slot < 1000 ? b.slot : (old.slot ?? 999),
      group: clean(b.group, 40), notes: clean(b.notes, 300), sample: !!old.sample
    }
  };
}

// Maidenhead grid locator: 4 characters (EM79) or 6 (EM79ab). Returns the normalised form, or '' if invalid.
function normGrid(s) {
  const g = String(s == null ? '' : s).trim();
  if (!/^[A-Ra-r]{2}[0-9]{2}([A-Xa-x]{2})?$/.test(g)) return '';
  return g.slice(0, 2).toUpperCase() + g.slice(2, 4) + g.slice(4).toLowerCase();
}

function sanitizeContact(b, old = {}) {
  const nodeId = clean(b.nodeId, 12).toLowerCase();
  const email = clean(b.email, 80);
  return {
    value: {
      ...old,
      name: clean(b.name, 60), callsign: clean(b.callsign, 12).toUpperCase(),
      nodeId: /^![0-9a-f]{8}$/.test(nodeId) ? nodeId : '',
      phone: clean(b.phone, 30).replace(/[^0-9+()\-. x]/gi, '').replace(/\s+/g, ' ').trim(), email: /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email) ? email : '',
      location: clean(b.location, 80), grid: normGrid(b.grid),
      relation: clean(b.relation, 40), notes: clean(b.notes, 500),
      freqIds: Array.isArray(b.freqIds) ? b.freqIds.map((x) => clean(x, 20)).slice(0, 20) : (old.freqIds || []),
      sample: !!old.sample
    }
  };
}

function sanitizeQso(b, old = {}) {
  const t = Date.parse(b.ts);
  const f = num(b.freq);
  return {
    value: {
      ...old,
      ts: Number.isFinite(t) ? t : (old.ts || Date.now()),
      call: clean(b.call, 14).toUpperCase(), freq: f !== null && f > 0 ? Math.round(f * 1e6) / 1e6 : null,
      mode: clean(b.mode, 8).toUpperCase() || 'FM', rstSent: clean(b.rstSent, 4), rstRcvd: clean(b.rstRcvd, 4),
      name: clean(b.name, 40), qth: clean(b.qth, 60), notes: clean(b.notes, 300), sample: !!old.sample
    }
  };
}

// ---------- CSV ----------
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const csvCell = (v) => { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

const CHIRP_HEADER = ['Location', 'Name', 'Frequency', 'Duplex', 'Offset', 'Tone', 'rToneFreq', 'cToneFreq', 'DtcsCode', 'DtcsPolarity', 'RxDtcsCode', 'CrossMode', 'Mode', 'TStep', 'Skip', 'Power', 'Comment'];

// Export the channels flagged "in radio", in slot order. Returns { csv, count, warnings }.
function toChirp(freqs, { nameLen = 7, maxChannels = 128 } = {}) {
  const warnings = [];
  const list = freqs.filter((f) => f.inRadio).sort((a, b) => (a.slot - b.slot) || a.freq - b.freq);
  if (list.length > maxChannels) warnings.push(`${list.length} channels selected; only the first ${maxChannels} were exported (radio limit).`);
  const lines = [CHIRP_HEADER.join(',')];
  list.slice(0, maxChannels).forEach((f, i) => {
    let name = (f.name || '').toUpperCase().replace(/[^A-Z0-9 \-_/.]/g, '');
    if (name.length > nameLen) { warnings.push(`"${f.name}" shortened to ${nameLen} characters.`); name = name.slice(0, nameLen); }
    if (f.mode === 'AM') warnings.push(`"${f.name}" is AM; it is exported as FM because most handhelds cannot receive AM.`);
    const comment = [f.listenOnly ? 'RX ONLY' : '', f.notes].filter(Boolean).join(' - ');
    lines.push([
      i, name, f.freq.toFixed(6), f.duplex, (f.duplex ? f.offset : 0).toFixed(6), f.tone, (f.rTone || 88.5).toFixed(1), (f.rTone || 88.5).toFixed(1),
      '023', 'NN', '023', 'Tone->Tone', f.mode === 'NFM' || f.mode === 'FM' ? f.mode : 'FM', '5.00', '', '', comment
    ].map(csvCell).join(','));
  });
  return { csv: lines.join('\r\n') + '\r\n', count: Math.min(list.length, maxChannels), warnings };
}

function fromChirp(text) {
  const rows = parseCsv(String(text).slice(0, 2 * 1024 * 1024));
  if (!rows.length) return { items: [], skipped: 0 };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const ix = (n) => head.indexOf(n.toLowerCase());
  const iF = ix('frequency'); if (iF < 0) return { error: 'This does not look like a CHIRP CSV (no Frequency column).' };
  const items = []; let skipped = 0;
  for (const r of rows.slice(1, 1001)) {
    const get = (n) => { const i = ix(n); return i >= 0 ? (r[i] || '').trim() : ''; };
    const v = sanitizeFreq({
      name: get('Name'), freq: get('Frequency'), mode: get('Mode').toUpperCase() === 'NFM' ? 'NFM' : (MODES.includes(get('Mode').toUpperCase()) ? get('Mode').toUpperCase() : 'FM'),
      duplex: get('Duplex'), offset: get('Offset'), tone: get('Tone'), rTone: get('rToneFreq'),
      notes: get('Comment'), inRadio: true, slot: parseInt(get('Location'), 10), service: 'ham', group: 'Imported from CHIRP'
    });
    if (v.error) { skipped++; continue; }
    items.push(v.value);
  }
  return { items, skipped };
}

// ---------- ADIF ----------
const BANDS = [['160m', 1.8, 2], ['80m', 3.5, 4], ['60m', 5.06, 5.45], ['40m', 7, 7.3], ['30m', 10.1, 10.15], ['20m', 14, 14.35], ['17m', 18.068, 18.168], ['15m', 21, 21.45], ['12m', 24.89, 24.99], ['10m', 28, 29.7], ['6m', 50, 54], ['2m', 144, 148], ['1.25m', 222, 225], ['70cm', 420, 450], ['33cm', 902, 928], ['23cm', 1240, 1300]];
const bandOf = (f) => { const b = BANDS.find((x) => f >= x[1] && f <= x[2]); return b ? b[0] : ''; };
const adifField = (name, v) => { const s = String(v == null ? '' : v); return s ? `<${name}:${Buffer.byteLength(s)}>${s} ` : ''; };

function toAdif(log, myCall) {
  const out = ['Skynet logbook export', adifField('ADIF_VER', '3.1.4') + adifField('PROGRAMID', 'Skynet') + '<EOH>', ''];
  for (const q of log.slice().sort((a, b) => a.ts - b.ts)) {
    const d = new Date(q.ts), iso = d.toISOString();
    out.push(
      adifField('CALL', q.call) + adifField('QSO_DATE', iso.slice(0, 10).replace(/-/g, '')) + adifField('TIME_ON', iso.slice(11, 19).replace(/:/g, '')) +
      adifField('FREQ', q.freq ? q.freq.toFixed(6) : '') + adifField('BAND', q.freq ? bandOf(q.freq) : '') + adifField('MODE', q.mode) +
      adifField('RST_SENT', q.rstSent) + adifField('RST_RCVD', q.rstRcvd) + adifField('NAME', q.name) + adifField('QTH', q.qth) +
      adifField('COMMENT', q.notes) + adifField('STATION_CALLSIGN', myCall) + '<EOR>'
    );
  }
  return out.join('\n') + '\n';
}

// ---------- presets (public, well-known frequencies) ----------
function presets() {
  const out = [];
  const add = (name, freq, service, group, extra = {}) => out.push({ name, freq, mode: 'NFM', duplex: '', offset: 0, tone: '', rTone: 88.5, service, listenOnly: service !== 'ham', inRadio: false, slot: 999, group, notes: '', ...extra });
  const frs = [462.5625, 462.5875, 462.6125, 462.6375, 462.6625, 462.6875, 462.7125, 467.5625, 467.5875, 467.6125, 467.6375, 467.6625, 467.6875, 467.7125,
    462.55, 462.575, 462.6, 462.625, 462.65, 462.675, 462.7, 462.725];
  frs.forEach((f, i) => add('FRS ' + (i + 1), f, i < 14 ? 'FRS' : 'GMRS', 'FRS / GMRS', i >= 7 && i < 14 ? { notes: 'Low power only' } : {}));
  [162.4, 162.425, 162.45, 162.475, 162.5, 162.525, 162.55].forEach((f, i) => add('WX ' + (i + 1), f, 'NOAA', 'NOAA Weather', { mode: 'FM' }));
  [151.82, 151.88, 151.94, 154.57, 154.6].forEach((f, i) => add('MURS ' + (i + 1), f, 'MURS', 'MURS'));
  add('2M CALL', 146.52, 'ham', 'Ham simplex', { mode: 'FM', notes: '2 m national calling frequency' });
  add('70CM', 446.0, 'ham', 'Ham simplex', { mode: 'FM', notes: '70 cm national calling frequency' });
  add('APRS', 144.39, 'ham', 'Ham simplex', { mode: 'FM', notes: 'APRS (North America)' });
  add('6M CALL', 52.525, 'ham', 'Ham simplex', { mode: 'FM', notes: '6 m FM calling frequency' });
  add('1.25M', 223.5, 'ham', 'Ham simplex', { mode: 'FM', notes: '1.25 m calling frequency' });
  add('33CM', 927.5, 'ham', 'Ham simplex', { mode: 'FM', notes: '33 cm calling frequency' });
  // Listen-only groups (US). Marine VHF and public-safety channels are not for amateur transmitting.
  [['MAR 16', 156.8, 'Distress, safety and calling'], ['MAR 9', 156.45, 'Boater calling (secondary)'], ['MAR 6', 156.3, 'Intership safety'],
    ['MAR 13', 156.65, 'Bridge-to-bridge navigation'], ['MAR 22A', 157.1, 'Coast Guard liaison']]
    .forEach(([n, f, note]) => add(n, f, 'MARINE', 'Marine VHF (listen)', { notes: note }));
  [['GUARD', 121.5, 'Aircraft emergency frequency'], ['AIR-AIR', 122.75, 'Air-to-air, general aviation'], ['UNICOM', 122.8, 'Uncontrolled airport traffic'],
    ['MULTICM', 122.9, 'Multicom, airports without UNICOM'], ['HELI', 123.025, 'Helicopter air-to-air'], ['AIR 123', 123.45, 'Air-to-air, informal']]
    .forEach(([n, f, note]) => add(n, f, 'AIR', 'Aviation (listen)', { mode: 'AM', notes: note + '. AM: many Baofeng handhelds cannot receive this' }));
  [['VCALL10', 155.7425, 'Nationwide interoperability calling (VHF)'], ['UCALL40', 453.2125, 'Nationwide interoperability calling (UHF)'],
    ['HEAR', 155.34, 'Hospital emergency (VHF med)'], ['SAR', 155.16, 'National search and rescue']]
    .forEach(([n, f, note]) => add(n, f, 'PUBLIC', 'Public safety (listen)', { notes: note + '. Often quiet or digital' }));
  return out;
}

module.exports = { normGrid, sanitizeFreq, sanitizeContact, sanitizeQso, toChirp, fromChirp, toAdif, presets, parseCsv, bandOf, SERVICES, MODES, CTCSS };
