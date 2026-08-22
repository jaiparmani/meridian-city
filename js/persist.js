/* ============================================================
   persist.js — the city survives a reload.
   Saving is just serialising to the same spec the importer
   reads, so save / load / export are one code path.
   ============================================================ */
'use strict';

const SAVE_KEY = 'meridian.city.v1';
const SAVE_EVERY = 6;   // seconds

const persist = {
  acc: 0,
  enabled: true,
  lastError: null,

  save(org) {
    if (!this.enabled) return false;
    try {
      const spec = specFromOrg(org);
      spec.savedAt = Date.now();
      localStorage.setItem(SAVE_KEY, JSON.stringify(spec));
      this.lastError = null;
      return true;
    } catch (e) {
      // a full or disabled store should never take the city down
      this.lastError = String(e.message || e);
      this.enabled = false;
      return false;
    }
  },

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const spec = JSON.parse(raw);
      if (!spec || spec.v !== 1 || !Array.isArray(spec.projects) || !spec.projects.length) return null;
      return spec;
    } catch (e) {
      this.lastError = String(e.message || e);
      return null;
    }
  },

  clear() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* nothing to do */ }
    // stop saving for the rest of the session, or the autosave (and the
    // save on unload) would put the city straight back
    this.enabled = false;
  },

  resume() { this.enabled = true; this.acc = 0; },

  age(spec) {
    if (!spec || !spec.savedAt) return null;
    const mins = (Date.now() - spec.savedAt) / 60000;
    if (mins < 1) return 'moments ago';
    if (mins < 60) return `${Math.round(mins)} min ago`;
    const h = mins / 60;
    if (h < 24) return `${Math.round(h)}h ago`;
    return `${Math.round(h / 24)}d ago`;
  },

  tick(dt, org) {
    this.acc += dt;
    if (this.acc < SAVE_EVERY) return;
    this.acc = 0;
    this.save(org);
  },
};

/* hand the current city to the user as a file */
function downloadCity(org) {
  const spec = specFromOrg(org);
  const blob = new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(org.name || 'city').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return a.download;
}
