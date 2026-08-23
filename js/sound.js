/* ============================================================
   sound.js — the city, synthesised. No audio files: every
   sound here is made from oscillators and filtered noise at
   runtime, so it ships as a few kilobytes of arithmetic.

   Nothing plays until you ask for it (M). Browsers require a
   gesture before audio anyway, and a page that starts making
   noise at you is a bad neighbour.

   It reads the simulation rather than being called by it —
   sim.js does not know this file exists.
   ============================================================ */
'use strict';

const sound = {
  ctx: null,
  enabled: false,
  ready: false,
  master: null,
  beds: {},
  voices: 0,
  seen: { shipped: 0, commands: 0, flash: 0, floors: new Map(), incidents: 0 },
  hint: 0,

  /* ---- lifecycle ---------------------------------------- */
  init() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try { this.ctx = new AC(); } catch (e) { return false; }
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    // a gentle ceiling so a storm plus a siren cannot clip
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(ctx.destination);

    this.noiseBuf = this.makeNoise(2.4);
    this.beds.hum = this.makeHum();
    this.beds.traffic = this.makeNoiseBed(420, 'bandpass', 0.8);
    this.beds.jam = this.makeJam();
    this.beds.rain = this.makeNoiseBed(2600, 'highpass', 0.7);
    this.beds.siren = this.makeSiren();

    this.ready = true;
    return true;
  },

  makeNoise(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;      // a little brown in it
      d[i] = last * 3.2 + white * 0.35;
    }
    return buf;
  },

  makeNoiseBed(freq, type, q) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = type; filt.frequency.value = freq; filt.Q.value = q;
    const gain = ctx.createGain(); gain.gain.value = 0;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    src.connect(filt).connect(gain);
    if (pan) gain.connect(pan).connect(this.master); else gain.connect(this.master);
    src.start();
    return { src, filt, gain, pan };
  },

  /* the low breath of a lot of people in one place */
  makeHum() {
    const ctx = this.ctx;
    const gain = ctx.createGain(); gain.gain.value = 0;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 260; filt.Q.value = 0.6;
    filt.connect(gain).connect(this.master);
    const oscs = [];
    [55, 82.5, 110.3, 164.8].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = i % 2 ? 'sine' : 'triangle';
      o.frequency.value = f;
      o.detune.value = (i - 1.5) * 7;
      const g = ctx.createGain();
      g.gain.value = [0.5, 0.28, 0.2, 0.1][i];
      o.connect(g).connect(filt);
      o.start();
      oscs.push({ o, g });
    });
    return { gain, filt, oscs };
  },

  /* stop-and-go: a rough low note that beats against itself */
  makeJam() {
    const ctx = this.ctx;
    const gain = ctx.createGain(); gain.gain.value = 0;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 340; filt.Q.value = 3;
    filt.connect(gain).connect(this.master);
    const a = ctx.createOscillator(); a.type = 'sawtooth'; a.frequency.value = 47;
    const b = ctx.createOscillator(); b.type = 'sawtooth'; b.frequency.value = 48.6;
    const ag = ctx.createGain(); ag.gain.value = 0.5;
    a.connect(ag).connect(filt); b.connect(ag);
    // a slow wobble, like idling engines
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.7;
    const lg = ctx.createGain(); lg.gain.value = 90;
    lfo.connect(lg).connect(filt.frequency);
    a.start(); b.start(); lfo.start();
    return { gain, filt };
  },

  makeSiren() {
    const ctx = this.ctx;
    const gain = ctx.createGain(); gain.gain.value = 0;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 640;
    const shape = ctx.createBiquadFilter();
    shape.type = 'bandpass'; shape.frequency.value = 900; shape.Q.value = 2.2;
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.55;
    const lg = ctx.createGain(); lg.gain.value = 190;
    lfo.connect(lg).connect(o.frequency);
    o.connect(shape).connect(gain);
    if (pan) gain.connect(pan).connect(this.master); else gain.connect(this.master);
    o.start(); lfo.start();
    return { gain, pan, o };
  },

  toggle() {
    if (!this.ctx && !this.init()) return false;
    this.enabled = !this.enabled;
    if (this.enabled && this.ctx.state === 'suspended') this.ctx.resume();
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(this.enabled ? 0.34 : 0, t, 0.25);
    this.hint = this.enabled ? 2.4 : 1.4;
    return this.enabled;
  },

  /* ---- one-shots ---------------------------------------- */
  at(x) { const p = this.beds && this.ctx ? clamp(x, -1, 1) : 0; return p; },

  ping(freqs, dur, vol, pan, type) {
    if (!this.enabled || !this.ready || this.voices > 14) return;
    const ctx = this.ctx, t = ctx.currentTime;
    this.voices++;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.012);
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const node = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (node) { node.pan.value = clamp(pan || 0, -1, 1); out.connect(node).connect(this.master); }
    else out.connect(this.master);
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = type || 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 1 / (i + 1.6);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + dur + 0.05);
    });
    setTimeout(() => { this.voices--; }, (dur + 0.1) * 1000);
  },

  /* a milestone: a bell, pitched by the team that shipped it */
  chime(hue, pan) {
    const root = 220 * Math.pow(2, ((hue % 360) / 360) * 0.75);
    this.ping([root, root * 1.5, root * 2, root * 3.01], 1.7, 0.30, pan, 'sine');
  },
  /* work landing at the core */
  ship(pan) {
    this.ping([880, 1320], 0.34, 0.13, pan, 'sine');
  },
  /* a command you gave */
  tick() {
    this.ping([1500, 2400], 0.09, 0.10, 0, 'square');
  },
  /* something fell over */
  alarm(pan) {
    this.ping([180, 220, 90], 1.1, 0.26, pan, 'sawtooth');
  },
  thunder(power) {
    if (!this.enabled || !this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.32;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(420, t);
    filt.frequency.exponentialRampToValueAtTime(70, t + 1.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.36 * clamp(power, 0.2, 1), t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t); src.stop(t + 2.5);
  },

  /* ---- the beds follow the city ------------------------- */
  update(dt, sim, cam, ui) {
    if (this.hint > 0) this.hint -= dt;
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const set = (param, v, tau) => param.setTargetAtTime(v, t, tau || 0.35);

    // how close we are changes what the city sounds like
    const near = clamp(remap(Math.log(cam.s), Math.log(0.6), Math.log(14), 0, 1));
    const moving = sim.agents.reduce((n, a) => n + (a.speed > 2 ? 1 : 0), 0);
    const density = clamp(moving / 240);

    set(this.beds.hum.gain.gain, 0.06 + density * 0.05 + near * 0.03);
    set(this.beds.hum.filt.frequency, 180 + near * 420, 0.6);

    set(this.beds.traffic.gain.gain, (0.02 + density * 0.10) * (0.35 + near * 0.85));
    set(this.beds.traffic.filt.frequency, 300 + near * 1500, 0.6);

    let jam = 0;
    for (const e of sim.city.edges) if (e.jam > 0.3) jam += e.jam;
    jam = clamp(jam / 45);
    set(this.beds.jam.gain.gain, jam * (0.05 + near * 0.11));

    set(this.beds.rain.gain.gain, clamp(sim.weather.rain) * 0.15 * (0.5 + near * 0.6));
    set(this.beds.rain.filt.frequency, 1800 + (1 - clamp(sim.weather.storm)) * 2200, 0.7);

    // sirens, panned to where the trouble is
    const inc = sim.org.incidents[0];
    if (inc) {
      const b = sim.city.byProject[inc.project];
      let pan = 0, prox = 0.5;
      if (b) {
        const p = cam.proj(b.x, b.y, 0, {});
        pan = clamp((p.x / cam.W) * 2 - 1, -1, 1);
        const off = Math.hypot(p.x - cam.W / 2, p.y - cam.H / 2) / Math.max(cam.W, cam.H);
        prox = clamp(1 - off);
      }
      if (this.beds.siren.pan) this.beds.siren.pan.pan.setTargetAtTime(pan, t, 0.2);
      set(this.beds.siren.gain.gain, 0.035 + prox * 0.075 * (0.4 + near * 0.8), 0.2);
    } else {
      set(this.beds.siren.gain.gain, 0, 0.4);
    }

    /* ---- watch for things worth marking ---------------- */
    const panOf = (x, y) => {
      const p = cam.proj(x, y, 0, {});
      return clamp((p.x / cam.W) * 2 - 1, -1, 1);
    };

    if (sim.org.shipped > this.seen.shipped) {
      const n = Math.min(3, sim.org.shipped - this.seen.shipped);
      for (let i = 0; i < n; i++) setTimeout(() => this.ship(rr(-0.5, 0.5)), i * 90);
      this.seen.shipped = sim.org.shipped;
    }
    if (sim.commands > this.seen.commands) {
      this.tick();
      this.seen.commands = sim.commands;
    }
    if (sim.weather.flash > 0.9 && this.seen.flash <= 0.9) {
      this.thunder(sim.weather.storm);
    }
    this.seen.flash = sim.weather.flash;

    if (sim.org.incidents.length > this.seen.incidents) {
      const b = sim.city.byProject[sim.org.incidents[sim.org.incidents.length - 1].project];
      this.alarm(b ? panOf(b.x, b.y) : 0);
    }
    this.seen.incidents = sim.org.incidents.length;

    // a floor going up is the best sound in the city
    for (const b of sim.city.buildings) {
      const was = this.seen.floors.get(b.project);
      if (was !== undefined && b.targetFloors > was) this.chime(b.hue, panOf(b.x, b.y));
      this.seen.floors.set(b.project, b.targetFloors);
    }
  },

  /* stop making noise at a tab nobody is looking at */
  visibility() {
    if (!this.ctx) return;
    if (document.hidden && this.ctx.state === 'running') this.ctx.suspend();
    else if (!document.hidden && this.enabled && this.ctx.state === 'suspended') this.ctx.resume();
  },
};
