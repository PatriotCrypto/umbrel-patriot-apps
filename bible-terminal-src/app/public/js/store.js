// Your notes, bookmarks, highlights, plans and flashcards.
// On the Umbrel they are saved to the server (so every device sees the same ones).
// On the Pi hotspot there is no server, so they stay in this browser only.

const LS_KEY = 'bt-user-v1';
const empty = () => ({ rev: 0, bookmarks: [], highlights: {}, notes: {}, plans: {}, cards: {}, prefs: {} });

export class Store {
  constructor(isStatic) {
    this.isStatic = !!isStatic;
    this.doc = empty();
    this.subs = new Set();
    this.timer = null;
    this.saving = false;
    this.dirty = false;
    this.status = 'saved'; // saved | saving | error | offline
  }

  async init() {
    try {
      if (this.isStatic) {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) this.doc = { ...empty(), ...JSON.parse(raw) };
      } else {
        const r = await fetch('api/user');
        if (r.ok) this.doc = { ...empty(), ...(await r.json()) };
        else this.setStatus('error');
      }
    } catch { this.setStatus(this.isStatic ? 'saved' : 'error'); }
  }

  on(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
  emit(kind) { for (const f of this.subs) f(kind); }
  setStatus(s) { if (this.status !== s) { this.status = s; this.emit('status'); } }

  /** change something, e.g. store.change(d => { d.bookmarks.push(...) }) */
  change(fn) {
    fn(this.doc);
    this.dirty = true;
    this.emit('data');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 600);
  }

  async flush() {
    clearTimeout(this.timer);
    if (this.saving) { this.timer = setTimeout(() => this.flush(), 300); return; }
    if (!this.dirty) return;
    this.dirty = false;
    if (this.isStatic) {
      try { localStorage.setItem(LS_KEY, JSON.stringify(this.doc)); this.setStatus('saved'); }
      catch { this.setStatus('error'); }
      return;
    }
    this.saving = true; this.setStatus('saving');
    try {
      const r = await fetch('api/user', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-bt': '1' }, body: JSON.stringify(this.doc) });
      if (r.status === 409) {
        // Another device saved first. Merge: keep what the server has and add what only we have.
        const { doc } = await r.json();
        const mine = this.doc;
        const merged = { ...empty(), ...doc };
        const seen = new Set(merged.bookmarks.map(b => b.ref));
        for (const b of mine.bookmarks) if (!seen.has(b.ref)) merged.bookmarks.push(b);
        Object.assign(merged.highlights, mine.highlights);
        for (const [k, n] of Object.entries(mine.notes)) if (!merged.notes[k] || merged.notes[k].at < n.at) merged.notes[k] = n;
        for (const [k, p] of Object.entries(mine.plans)) {
          const o = merged.plans[k];
          merged.plans[k] = o ? { start: Math.min(o.start || p.start, p.start || o.start), done: [...new Set([...o.done, ...p.done])] } : p;
        }
        Object.assign(merged.cards, mine.cards);
        merged.prefs = { ...merged.prefs, ...mine.prefs };
        this.doc = merged; this.dirty = true;
        this.saving = false;
        this.timer = setTimeout(() => this.flush(), 50);
        return;
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      this.doc = { ...empty(), ...(await r.json()) };
      this.setStatus('saved');
    } catch {
      this.dirty = true; this.setStatus('error');
      this.timer = setTimeout(() => this.flush(), 5000);
    } finally { this.saving = false; }
  }

  // ---- helpers
  isBookmarked(ref) { return this.doc.bookmarks.some(b => b.ref === ref); }
  toggleBookmark(ref, label) {
    this.change(d => {
      const i = d.bookmarks.findIndex(b => b.ref === ref);
      if (i >= 0) d.bookmarks.splice(i, 1);
      else d.bookmarks.unshift({ ref, label: label || '', at: Date.now() });
    });
  }
  setHighlight(key, color) {
    this.change(d => { if (color) d.highlights[key] = color; else delete d.highlights[key]; });
  }
  setNote(ref, text) {
    this.change(d => { if (text.trim()) d.notes[ref] = { text, at: Date.now() }; else delete d.notes[ref]; });
  }
  pref(k, def) { const v = this.doc.prefs[k]; return v === undefined ? def : v; }
  setPref(k, v) { this.change(d => { d.prefs[k] = v; }); }
}
