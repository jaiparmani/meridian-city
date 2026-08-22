/* ============================================================
   render.js — axonometric city renderer. Everything is drawn
   from world space through one camera, so zoom is continuous
   from "whole organisation" down to "one person walking".
   ============================================================ */
'use strict';

const PITCH = 0.54;      // ground foreshortening
const ZK = 0.86;         // height scale

const LOD = { ORG: 0, TEAM: 1, PROJECT: 2, TASK: 3, ACT: 4 };
function lodOf(s) {
  if (s < 1.05) return LOD.ORG;
  if (s < 2.5) return LOD.TEAM;
  if (s < 5.6) return LOD.PROJECT;
  if (s < 11.5) return LOD.TASK;
  return LOD.ACT;
}
const LOD_NAME = ['ORGANISATION', 'NEIGHBOURHOOD', 'PROJECT', 'TASK', 'ACTIVITY'];

class Camera {
  constructor() {
    this.x = 0; this.y = 0; this.s = 0.55; this.yaw = -0.5;
    this.tx = 0; this.ty = 0; this.ts = 0.9; this.tyaw = -0.5;
    this.vx = 0; this.vy = 0;
    this.shake = 0; this.follow = null;
    this.W = 1; this.H = 1;
  }
  resize(w, h) { this.W = w; this.H = h; }
  proj(x, y, z, out) {
    const dx = x - this.x, dy = y - this.y;
    const c = this._c, s = this._s;
    const rx = dx * c - dy * s, ry = dx * s + dy * c;
    const k = this.s;
    out = out || {};
    out.x = this.W * 0.5 + rx * k + this.ox;
    out.y = this.H * 0.5 + (ry * PITCH - (z || 0) * ZK) * k + this.oy;
    out.d = ry;
    return out;
  }
  depth(x, y) {
    const dx = x - this.x, dy = y - this.y;
    return dx * this._s + dy * this._c;
  }
  /* screen -> ground plane (z = 0) */
  unproj(sx, sy) {
    const k = this.s;
    const rx = (sx - this.W * 0.5 - this.ox) / k;
    const ry = (sy - this.H * 0.5 - this.oy) / k / PITCH;
    const c = this._c, s = this._s;
    return { x: this.x + rx * c + ry * s, y: this.y - rx * s + ry * c };
  }
  update(dt, t) {
    let rate = 4.5;
    if (this.follow) {
      const f = this.follow;
      // lead the subject slightly so it sits ahead of centre, like a chase cam
      const lead = Math.min(1, (f.speed || 0) / 30) * 14;
      this.tx = f.x + Math.cos(f.ang || 0) * lead;
      this.ty = f.y + Math.sin(f.ang || 0) * lead;
      rate = 11;
      // at street level the camera drifts around what it is watching
      if (this.s > 11.5) this.tyaw += dt * 0.055;
    }
    this.x = damp(this.x, this.tx, rate, dt);
    this.y = damp(this.y, this.ty, rate, dt);
    this.s = this.s * Math.pow(this.ts / this.s, 1 - Math.exp(-5.5 * dt));
    this.yaw = angLerp(this.yaw, this.tyaw, 1 - Math.exp(-4 * dt));
    this._c = Math.cos(this.yaw); this._s = Math.sin(this.yaw);
    this.shake = Math.max(0, this.shake - dt * 1.6);
    const sh = this.shake * this.shake * 9;
    this.ox = Math.sin(t * 47) * sh + Math.sin(t * 0.23) * 2.0;
    this.oy = Math.cos(t * 41) * sh + Math.cos(t * 0.19) * 1.6;
  }
}

/* palette that shifts with time of day and storms */
function palette(sim) {
  const night = sim.night, storm = sim.weather.storm;
  const skyDay = [30, 54, 70], skyNight = [6, 9, 20], skyStorm = [18, 23, 33];
  let sky = mixRGB(skyDay, skyNight, night);
  sky = mixRGB(sky, skyStorm, storm * 0.8);
  const groundDay = [66, 71, 64], groundNight = [17, 21, 33];
  let ground = mixRGB(groundDay, groundNight, night * 0.92);
  ground = mixRGB(ground, [26, 29, 38], storm * 0.55);
  return {
    sky, ground, night, storm,
    ambient: lerp(0.58, 0.23, night),
    sunAng: -2.35 + sim.dayT * 0.9,
    facadeLight: mixRGB([196, 208, 214], [58, 70, 96], night),
    facadeDark: mixRGB([132, 146, 158], [30, 38, 58], night),
  };
}

class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.glow = this.makeGlow();
    this.grain = this.makeGrain();
    this.p0 = {}; this.p1 = {}; this.p2 = {}; this.p3 = {};
    this.buf = [];
  }
  makeGlow() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(255,255,255,0.42)');
    gr.addColorStop(0.6, 'rgba(255,255,255,0.09)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    return c;
  }
  makeGrain() {
    const c = document.createElement('canvas'); c.width = c.height = 180;
    const g = c.getContext('2d');
    const img = g.createImageData(180, 180);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 128 + (Math.random() - 0.5) * 90;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 26;
    }
    g.putImageData(img, 0, 0);
    return c;
  }
  blob(ctx, x, y, r, color, alpha) {
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.glow, x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
  }
  /* soft additive wash — a hard-edged arc reads as a sticker */
  tint(ctx, x, y, r, css, alpha) {
    if (alpha <= 0.002 || r <= 0) return;
    if (!this._tintCv) {
      this._tintCv = document.createElement('canvas');
      this._tintCv.width = this._tintCv.height = 128;
      this._tintCtx = this._tintCv.getContext('2d');
    }
    const c = this._tintCtx;
    c.clearRect(0, 0, 128, 128);
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = css;
    c.fillRect(0, 0, 128, 128);
    c.globalCompositeOperation = 'destination-in';
    c.drawImage(this.glow, 0, 0, 128, 128);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    ctx.drawImage(this._tintCv, x - r, y - r, r * 2, r * 2);
    ctx.restore();
  }

  /* ================= main entry ========================== */
  draw(sim, cam, ui, dt) {
    const ctx = this.ctx, W = cam.W, H = cam.H;
    const pal = palette(sim);
    this.pal = pal; this.sim = sim; this.cam = cam; this.ui = ui;
    this.lod = lodOf(cam.s);
    this.t = sim.time;

    this.followPt = null;
    if (cam.follow) {
      const f = cam.follow;
      this.followPt = cam.proj(f.x, f.y, 2, {});
      this.followDepth = cam.depth(f.x, f.y);
    } else if (ui.selected && ui.selected.type === 'project') {
      const b = sim.city.byProject[ui.selected.id];
      if (b) { this.followPt = cam.proj(b.x, b.y, buildingHeight(b) * 0.5, {}); this.followDepth = cam.depth(b.x, b.y) - 0.01; }
    }

    this.drawVoid(ctx, cam, pal, sim);
    this.drawIsland(ctx, cam, pal, sim);
    this.drawDistricts(ctx, cam, pal, sim, ui);
    this.drawRoads(ctx, cam, pal, sim, ui);
    this.drawCloudShadows(ctx, cam, pal, sim);
    this.drawShadows(ctx, cam, pal, sim);
    this.drawWorld(ctx, cam, pal, sim, ui);
    this.drawCore(ctx, cam, pal, sim);
    this.drawWeather(ctx, cam, pal, sim);
    this.drawPost(ctx, cam, pal, sim);
  }

  /* ---- the sea / void the city sits in ------------------ */
  drawVoid(ctx, cam, pal, sim) {
    const W = cam.W, H = cam.H;
    const sea = mixRGB(pal.sky, [4, 14, 30], 0.55);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, toCSS(mixRGB(sea, [0, 0, 0], 0.35)));
    g.addColorStop(0.55, toCSS(mixRGB(sea, [0, 0, 0], 0.62)));
    g.addColorStop(1, toCSS(mixRGB(sea, [0, 0, 0], 0.80)));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // holographic grid over the water
    const step = 120;
    const alpha = clamp(remap(cam.s, 0.25, 3, 0.16, 0.03));
    ctx.save();
    ctx.strokeStyle = `rgba(90,190,225,${alpha})`;
    ctx.lineWidth = 1;
    const R = cam.radiusHint || 1600;
    const p = this.p0;
    ctx.beginPath();
    for (let gx = -R; gx <= R; gx += step) {
      cam.proj(gx, -R, 0, p); ctx.moveTo(p.x, p.y);
      cam.proj(gx, R, 0, p); ctx.lineTo(p.x, p.y);
    }
    for (let gy = -R; gy <= R; gy += step) {
      cam.proj(-R, gy, 0, p); ctx.moveTo(p.x, p.y);
      cam.proj(R, gy, 0, p); ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  islandPath(ctx, cam, city, expand) {
    const pts = city.islandPts, p = this.p0;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const k = expand || 1;
      cam.proj(pts[i][0] * k, pts[i][1] * k, 0, p);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
  }

  drawIsland(ctx, cam, pal, sim) {
    const city = sim.city;
    // soft halo in the water
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    this.islandPath(ctx, cam, city, 1.05);
    ctx.fillStyle = `rgba(40,120,150,${0.08 + sim.coreCharge * 0.03})`;
    ctx.fill();
    ctx.restore();

    this.islandPath(ctx, cam, city, 1);
    const c0 = cam.proj(0, 0, 0, this.p1);
    const g = ctx.createRadialGradient(c0.x, c0.y, 10, c0.x, c0.y, Math.max(120, city.radius * cam.s));
    g.addColorStop(0, toCSS(mixRGB(pal.ground, [255, 240, 220], pal.night * 0.05 + 0.06)));
    g.addColorStop(0.6, toCSS(pal.ground));
    g.addColorStop(1, toCSS(mixRGB(pal.ground, [0, 0, 0], 0.34)));
    ctx.fillStyle = g;
    ctx.fill();

    // terrain variation so open ground is never a flat plate
    ctx.save();
    this.islandPath(ctx, cam, city, 1);
    ctx.clip();
    ctx.globalCompositeOperation = 'overlay';
    seedPatchesOnce(city);
    for (const q of city.patches) {
      const c = cam.proj(q.x, q.y, 0, this.p0);
      const r = q.r * cam.s;
      if (c.x < -r || c.x > cam.W + r || c.y < -r || c.y > cam.H + r) continue;
      const gg = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, Math.max(3, r));
      const v = q.dark ? 96 : 150;
      gg.addColorStop(0, `rgba(${v},${v + 6},${v + 12},${0.5})`);
      gg.addColorStop(1, 'rgba(128,128,128,0)');
      ctx.fillStyle = gg;
      ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(3, r), 0, TAU); ctx.fill();
    }
    ctx.restore();

    // parks and inlets
    if (city.greens) {
      ctx.save();
      this.islandPath(ctx, cam, city, 1);
      ctx.clip();
      for (const g2 of city.greens) {
        const c = cam.proj(g2.x, g2.y, 0, this.p0);
        const r = g2.r * cam.s;
        if (r < 1.2 || c.x < -r || c.x > cam.W + r || c.y < -r || c.y > cam.H + r) continue;
        ctx.save();
        ctx.translate(c.x, c.y); ctx.scale(1, PITCH);
        ctx.beginPath();
        for (let k = 0; k <= 14; k++) {
          const a = (k / 14) * TAU;
          const rr2 = r * (0.78 + 0.32 * noise2(Math.cos(a) * 2 + g2.seed * 10, Math.sin(a) * 2));
          const x = Math.cos(a) * rr2, y = Math.sin(a) * rr2;
          k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = g2.water
          ? toCSS(mixRGB([26, 62, 84], [8, 18, 30], pal.night), 0.75)
          : toCSS(mixRGB([38, 66, 46], [12, 24, 24], pal.night), 0.6);
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }

    // shoreline
    ctx.save();
    ctx.lineWidth = Math.max(1, 2 * cam.s ** 0.4);
    ctx.strokeStyle = `rgba(140,230,250,${0.42 + Math.sin(sim.time * 0.8) * 0.06})`;
    ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = Math.max(2, 6 * cam.s ** 0.35);
    ctx.strokeStyle = `rgba(70,180,215,0.16)`;
    ctx.stroke();
    ctx.restore();
  }

  drawDistricts(ctx, cam, pal, sim, ui) {
    const p = this.p0;
    for (const d of sim.city.districts) {
      const focus = ui.focusTeam === d.team;
      const dim = ui.focusTeam != null && !focus ? 0.35 : 1;
      ctx.beginPath();
      for (let i = 0; i < d.poly.length; i++) {
        cam.proj(d.poly[i][0], d.poly[i][1], 0, p);
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      const lit = 0.05 + d.light * 0.1;
      // under pressure the ground itself runs hot: hue slides toward ember
      const heat = clamp((d.pressure - 0.3) / 0.7);
      const pulse = heat > 0.05 ? 0.78 + 0.22 * Math.sin(sim.time * 1.6 + d.team) : 1;
      const L = lerp(14, 44, pal.ambient);
      const cold = hsl2rgb(d.hue, 40, L);
      const ember = hsl2rgb(12, 82, L * 1.1);
      ctx.fillStyle = toCSS(mixRGB(cold, ember, heat * 0.9), (0.26 + lit + heat * 0.14 * pulse) * dim);
      ctx.fill();
      ctx.lineWidth = Math.max(1, 1.4 * Math.min(2, cam.s));
      ctx.strokeStyle = hsl(d.hue, 70, 62, (0.35 + (focus ? 0.4 : 0)) * dim);
      ctx.stroke();

      // corner brackets, like a targeting overlay
      if (this.lod <= LOD.TEAM || focus) this.districtBrackets(ctx, cam, d, focus, dim);
    }
  }

  districtBrackets(ctx, cam, d, focus, dim) {
    let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
    const p = this.p0;
    for (const q of d.poly) {
      cam.proj(q[0], q[1], 0, p);
      minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x);
      miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y);
    }
    const L = Math.min(28, (maxx - minx) * 0.16);
    ctx.save();
    ctx.strokeStyle = hsl(d.hue, 80, 70, (focus ? 0.85 : 0.4) * dim);
    ctx.lineWidth = focus ? 1.8 : 1.1;
    const cs = [[minx, miny, 1, 1], [maxx, miny, -1, 1], [minx, maxy, 1, -1], [maxx, maxy, -1, -1]];
    ctx.beginPath();
    for (const [x, y, sx, sy] of cs) {
      ctx.moveTo(x + sx * L, y); ctx.lineTo(x, y); ctx.lineTo(x, y + sy * L);
    }
    ctx.stroke();
    ctx.restore();
    d._box = { minx, miny, maxx, maxy };
  }

  /* ---- roads: casing, surface, jams, dependency flow ---- */
  drawRoads(ctx, cam, pal, sim, ui) {
    this.pal = pal;
    const city = sim.city, s = cam.s;
    const W = cam.W, H = cam.H, M = 200;
    const P = this.p0, Q = this.p1;
    const detail = s > 2.2;
    const road = [];
    for (const e of city.edges) {
      const a = city.nodes[e.a], b = city.nodes[e.b];
      cam.proj(a.x, a.y, 0, P); cam.proj(b.x, b.y, 0, Q);
      if ((P.x < -M && Q.x < -M) || (P.x > W + M && Q.x > W + M) ||
        (P.y < -M && Q.y < -M) || (P.y > H + M && Q.y > H + M)) continue;
      road.push([e, P.x, P.y, Q.x, Q.y]);
    }
    this.visibleRoads = road;

    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // casing
    ctx.beginPath();
    for (const [e, x0, y0, x1, y1] of road) { ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); }
    ctx.lineWidth = Math.max(1.2, (10) * s * 0.14 + 1.5);
    ctx.strokeStyle = `rgba(6,10,16,${0.38 + pal.night * 0.22})`;
    ctx.stroke();

    // surface, grouped by width bucket
    const wet = sim.weather.rain;
    for (const [e, x0, y0, x1, y1] of road) {
      const lw = Math.max(0.8, e.w * s * 0.5);
      ctx.lineWidth = lw;
      const base = (e.kind === 'street' || e.kind === 'drive' ? 22 : 27) + (1 - pal.night) * 46;
      const l = base + wet * 6 + e.pulse * 20;
      ctx.strokeStyle = `rgb(${l * 0.9 | 0},${l | 0},${l * 1.12 | 0})`;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }

    // dependency arteries: coloured, with flow chevrons
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const [e, x0, y0, x1, y1] of road) {
      if (!e.deps.length) continue;
      const hue = e.hue;
      const focus = ui.hotDeps && e.deps.some((d) => ui.hotDeps.has(d));
      ctx.lineWidth = Math.max(0.7, e.w * s * 0.30);
      ctx.strokeStyle = hsl(hue, 85, 60, ((focus ? 0.45 : 0.10) + e.pulse * 0.12) * clamp(remap(s, 8, 16, 1, 0.25)));
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      const mapAlpha = clamp(remap(s, 7, 15, 1, 0.12));
      if (detail && mapAlpha > 0.02) {
        const dash = 4.5 * s, gap = 11 * s;
        ctx.save();
        ctx.lineCap = 'butt';
        ctx.globalAlpha = mapAlpha;
        ctx.setLineDash([dash, gap]);
        ctx.lineDashOffset = -(sim.time * 26 * s) % (dash + gap);
        ctx.lineWidth = Math.max(0.8, e.w * s * 0.16);
        ctx.strokeStyle = hsl(hue, 95, 72, (focus ? 0.85 : 0.28));
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        ctx.restore();
      }
    }
    ctx.restore();

    // congestion: heat on the tarmac, brighter and pulsing where it is worst
    ctx.save();
    for (const [e, x0, y0, x1, y1] of road) {
      if (e.jam < 0.16) continue;
      const j = clamp((e.jam - 0.16) / 0.84);
      const hue = lerp(44, 2, j);
      ctx.lineWidth = Math.max(0.8, e.w * s * 0.34);
      ctx.strokeStyle = hsl(hue, 92, 42, j * 0.34);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      // brake lights crawling backwards along the queue
      const dash = 3.2 * s, gap = 5.5 * s;
      ctx.save();
      ctx.lineCap = 'butt';
      ctx.setLineDash([dash, gap]);
      ctx.lineDashOffset = (sim.time * 7 * s) % (dash + gap);
      ctx.lineWidth = Math.max(0.7, e.w * s * 0.26);
      ctx.strokeStyle = hsl(hue, 100, 58, j * j * 0.55);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.restore();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();

    // lane markings
    if (detail) {
      ctx.save();
      ctx.lineCap = 'butt';
      ctx.setLineDash([2.4 * s, 3.6 * s]);
      ctx.lineWidth = Math.max(0.5, s * 0.16);
      ctx.strokeStyle = `rgba(216,222,196,${clamp(remap(s, 2, 5, 0, 0.34))})`;
      ctx.beginPath();
      for (const [e, x0, y0, x1, y1] of road) {
        if (e.kind === 'drive' || e.kind === 'street') continue;
        ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  drawCloudShadows(ctx, cam, pal, sim) {
    const w = sim.weather;
    if (pal.night > 0.62) return;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    const t = sim.time;
    for (const d of sim.city.districts) {
      const inten = (0.10 + d.storm * 0.26) * (1 - pal.night);
      const c = cam.proj(d.cell.x, d.cell.y, 0, this.p0);
      const r = d.cell.r * cam.s * (1 + d.storm * 0.4);
      const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, Math.max(4, r));
      const dark = Math.round(255 * (1 - inten * (1 - pal.night * 0.5)));
      g.addColorStop(0, `rgba(${dark},${dark},${dark + 6},1)`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(4, r), 0, TAU); ctx.fill();
    }
    // drifting fair-weather clouds
    for (let i = 0; i < 7; i++) {
      const x = ((t * (6 + i) * (0.4 + w.wind)) % 3000) - 1500 + i * 240;
      const y = -900 + ((i * 397) % 1800);
      const c = cam.proj(x, y, 0, this.p0);
      const r = (170 + i * 40) * cam.s;
      if (c.x < -r || c.x > cam.W + r) continue;
      const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, Math.max(4, r));
      const v = Math.round(255 * (1 - 0.07 * (1 - pal.night)));
      g.addColorStop(0, `rgba(${v},${v},${v},1)`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(4, r), 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  sunVec(pal) {
    const a = pal.sunAng;
    return { x: Math.cos(a), y: Math.sin(a) };
  }

  drawShadows(ctx, cam, pal, sim) {
    if (cam.s < 0.5) return;
    const sv = this.sunVec(pal);
    const alpha = 0.30 * (1 - pal.night * 0.75) * (1 - sim.weather.storm * 0.5);
    if (alpha < 0.02) return;
    ctx.save();
    ctx.fillStyle = `rgba(4,8,14,${alpha})`;
    const p = this.p0;
    for (const b of sim.city.buildings) {
      const h = buildingHeight(b) * (1 - sim.weather.storm * 0.1);
      const c = this.corners(b);
      const ox = sv.x * h * 0.9, oy = sv.y * h * 0.9;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        cam.proj(c[i][0], c[i][1], 0, p);
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      for (let i = 3; i >= 0; i--) {
        cam.proj(c[i][0] + ox, c[i][1] + oy, 0, p);
        ctx.lineTo(p.x, p.y);
      }
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  corners(b) {
    const hw = b.w / 2, hd = b.d / 2, r = b.rot;
    const c = Math.cos(r), s = Math.sin(r);
    const pts = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
    return pts.map(([u, v]) => [b.x + u * c - v * s, b.y + u * s + v * c]);
  }
}

/* ============================================================
   render.js (part 2) — solids: buildings, traffic, light.
   ============================================================ */
Object.assign(Renderer.prototype, {

  drawWorld(ctx, cam, pal, sim, ui) {
    const s = cam.s, city = sim.city;
    this.groundDecals(ctx, cam, pal, sim);

    const list = this.buf; list.length = 0;
    const M = 260, W = cam.W, H = cam.H;
    const p = this.p0;

    for (const b of city.buildings) {
      cam.proj(b.x, b.y, 0, p);
      if (p.x < -M || p.x > W + M || p.y < -M || p.y > H + M + 400) continue;
      list.push({ d: cam.depth(b.x, b.y), k: 0, o: b });
    }
    {
      for (const f of city.props) {
        if (f.type !== 'filler' && s < 3.2) continue;
        if (f.type === 'filler' && f.h * s < 1.6) continue;
        cam.proj(f.x, f.y, 0, p);
        if (p.x < -M || p.x > W + M || p.y < -M || p.y > H + M) continue;
        list.push({ d: cam.depth(f.x, f.y), k: 1, o: f });
      }
    }
    for (const a of sim.agents) {
      if (a.dead) continue;
      cam.proj(a.x, a.y, 0, p);
      if (p.x < -60 || p.x > W + 60 || p.y < -60 || p.y > H + 60) continue;
      list.push({ d: cam.depth(a.x, a.y), k: 2, o: a });
    }
    for (const f of sim.fx) {
      if (f.type === 'ring') continue;
      list.push({ d: cam.depth(f.x, f.y), k: 3, o: f });
    }
    list.sort((a, b) => a.d - b.d);

    for (const it of list) {
      if (it.k === 0) this.drawBuilding(ctx, cam, pal, it.o, sim, ui);
      else if (it.k === 1) this.drawProp(ctx, cam, pal, it.o, sim);
      else if (it.k === 2) this.drawAgent(ctx, cam, pal, it.o, sim, ui);
      else this.drawParticle(ctx, cam, pal, it.o, sim);
    }
    this.drawMotes(ctx, cam, pal, sim);
    this.drawTracker(ctx, cam, pal, sim, ui);
  },

  /* a beam that keeps the tracked subject findable in a dense city */
  drawTracker(ctx, cam, pal, sim, ui) {
    const f = cam.follow;
    if (!f || f.dead) return;
    const col = this.agentColor(f, sim);
    const base = cam.proj(f.x, f.y, 0, this.p1);
    const top = cam.proj(f.x, f.y, 46, this.p2);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(base.x, base.y, top.x, top.y);
    g.addColorStop(0, toCSS(col, 0.30));
    g.addColorStop(1, toCSS(col, 0));
    ctx.strokeStyle = g;
    ctx.lineWidth = Math.max(1, 1.2 * Math.min(3, cam.s * 0.2));
    ctx.beginPath(); ctx.moveTo(base.x, base.y); ctx.lineTo(top.x, top.y); ctx.stroke();
    // ground ring, breathing
    const puls = 0.6 + 0.4 * Math.sin(sim.time * 2.4);
    ctx.strokeStyle = toCSS(col, 0.35 * puls);
    ctx.lineWidth = 1.2;
    ctx.save();
    ctx.translate(base.x, base.y); ctx.scale(1, PITCH);
    ctx.beginPath(); ctx.arc(0, 0, Math.max(3, 7 * cam.s * (0.8 + puls * 0.35)), 0, TAU); ctx.stroke();
    ctx.restore();
    ctx.restore();
  },

  groundDecals(ctx, cam, pal, sim) {
    const p = this.p0;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const f of sim.fx) {
      if (f.type !== 'ring') continue;
      const t = f.life / f.max;
      const r = lerp(f.r0, f.r, easeOut(t)) * cam.s;
      const a = (1 - t) * (1 - t) * 0.85 * (f.power || 1);
      const c = cam.proj(f.x, f.y, f.z, p);
      ctx.strokeStyle = hsl(f.hue, 90, 68, a);
      ctx.lineWidth = Math.max(1, 3 * cam.s * (1 - t));
      ctx.save();
      ctx.translate(c.x, c.y); ctx.scale(1, PITCH);
      ctx.beginPath(); ctx.arc(0, 0, Math.max(1, r), 0, TAU); ctx.stroke();
      ctx.restore();
    }
    // pools of light under stalled traffic
    for (const a of sim.agents) {
      if (!a.stopped || a.task.state !== ST.BLOCKED) continue;
      const c = cam.proj(a.x, a.y, 0, p);
      const puls = 0.55 + 0.45 * Math.sin(sim.time * 4 + a.seedv * 9);
      this.blob(ctx, c.x, c.y, 26 * cam.s * (0.7 + puls * 0.3), null, 0);
      ctx.globalAlpha = 0.16 * puls;
      ctx.fillStyle = 'rgba(255,60,40,1)';
      ctx.save(); ctx.translate(c.x, c.y); ctx.scale(1, PITCH);
      ctx.beginPath(); ctx.arc(0, 0, Math.max(2, 22 * cam.s), 0, TAU); ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  },

  /* ---- buildings ---------------------------------------- */
  drawBuilding(ctx, cam, pal, b, sim, ui) {
    const proj = sim.org.byId[b.project];
    const s = cam.s;
    const shakeX = b.shake ? Math.sin(sim.time * 42) * b.shake * 1.6 : 0;
    const h = Math.max(1.2, b.floors * b.floorH);
    const c = this.corners(b);
    if (shakeX) c.forEach((q) => { q[0] += shakeX; });

    const bp = [], tp = [];
    for (let i = 0; i < 4; i++) {
      bp.push(cam.proj(c[i][0], c[i][1], 0, {}));
      tp.push(cam.proj(c[i][0], c[i][1], h, {}));
    }
    const screenW = Math.max(
      Math.abs(bp[0].x - bp[2].x), Math.abs(bp[1].x - bp[3].x));
    const selected = ui.selected && ui.selected.type === 'project' && ui.selected.id === b.project;
    let dim = ui.focusTeam != null && ui.focusTeam !== b.district ? 0.42 : 1;
    // x-ray: structures in front of the tracked subject go transparent
    if (this.followPt && !selected && cam.depth(b.x, b.y) > this.followDepth) {
      const fp = this.followPt;
      let hit = false;
      for (let i = 0; i < 4 && !hit; i++) {
        const j = (i + 1) % 4;
        hit = pointInPoly(fp.x, fp.y, [[bp[i].x, bp[i].y], [bp[j].x, bp[j].y], [tp[j].x, tp[j].y], [tp[i].x, tp[i].y]]);
      }
      if (!hit) hit = pointInPoly(fp.x, fp.y, tp.map((q) => [q.x, q.y]));
      if (hit) { b.xray = Math.min(1, (b.xray || 0) + 0.14); } else { b.xray = Math.max(0, (b.xray || 0) - 0.09); }
    } else b.xray = Math.max(0, (b.xray || 0) - 0.09);
    dim *= 1 - (b.xray || 0) * 0.78;

    const sv = this.sunVec(pal);
    const cs = Math.cos(cam.yaw), sn = Math.sin(cam.yaw);
    const faces = [];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const ex = c[j][0] - c[i][0], ey = c[j][1] - c[i][1];
      let nx = ey, ny = -ex;
      const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
      const mx = (c[i][0] + c[j][0]) / 2 - b.x, my = (c[i][1] + c[j][1]) / 2 - b.y;
      if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
      const nry = nx * sn + ny * cs;
      if (nry <= 0.02) continue;
      const light = clamp(pal.ambient + Math.max(0, -(nx * sv.x + ny * sv.y)) * (1 - pal.night) * 0.75, 0, 1.2);
      faces.push({ i, j, nx, ny, light, nry });
    }

    if (dim < 0.06) { b._screen = { base: bp, tops: tp, h, w: screenW }; return; }
    // body
    for (const f of faces) {
      const { i, j, light } = f;
      const col = mixRGB(pal.facadeDark, pal.facadeLight, light);
      const tinted = mixRGB(col, hsl2rgb(b.hue, 62, 48), 0.34);
      ctx.beginPath();
      ctx.moveTo(bp[i].x, bp[i].y); ctx.lineTo(bp[j].x, bp[j].y);
      ctx.lineTo(tp[j].x, tp[j].y); ctx.lineTo(tp[i].x, tp[i].y);
      ctx.closePath();
      const g = ctx.createLinearGradient(bp[i].x, bp[i].y, tp[i].x, tp[i].y);
      g.addColorStop(0, toCSS(mixRGB(tinted, [0, 0, 0], 0.42), dim));
      g.addColorStop(1, toCSS(tinted, dim));
      ctx.fillStyle = g;
      ctx.fill();
      if (screenW > 26) {
        ctx.strokeStyle = toCSS(mixRGB(tinted, [255, 255, 255], 0.25), 0.22 * dim);
        ctx.lineWidth = 1; ctx.stroke();
      }
    }

    // windows — the lit fraction is the project's progress
    if (screenW > 34) this.windows(ctx, cam, pal, b, proj, faces, bp, tp, h, sim, dim);
    else if (b.litDisp > 0.05) {
      // too far to resolve windows: the tower becomes the light it emits
      const c0 = cam.proj(b.x, b.y, h * 0.55, this.p1);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const gr = clamp(Math.max(b.w, h) * s * 0.9, 4, 90);
      ctx.globalAlpha = (0.10 + pal.night * 0.32) * b.litDisp * dim;
      ctx.drawImage(this.glow, c0.x - gr, c0.y - gr, gr * 2, gr * 2);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // roof
    ctx.beginPath();
    for (let i = 0; i < 4; i++) { const q = tp[i]; i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }
    ctx.closePath();
    const roofCol = mixRGB(pal.facadeLight, hsl2rgb(b.hue, 40, 46), 0.3);
    ctx.fillStyle = toCSS(mixRGB(roofCol, [0, 0, 0], 0.30), dim);
    ctx.fill();
    ctx.strokeStyle = toCSS(mixRGB(roofCol, [255, 255, 255], 0.5), 0.35 * dim);
    ctx.lineWidth = 1; ctx.stroke();

    // construction: the newest floor is still going up
    if (b.grow > 0.02 || b.floors < b.targetFloors - 0.02) {
      const t = clamp(b.grow);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = hsl(b.hue, 90, 70, 0.5 * t + 0.15);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        ctx.moveTo(tp[i].x, tp[i].y); ctx.lineTo(tp[j].x, tp[j].y);
        ctx.moveTo(tp[i].x, tp[i].y);
        ctx.lineTo(tp[i].x, tp[i].y - b.floorH * ZK * s * (0.4 + t * 0.6));
      }
      ctx.stroke();
      ctx.restore();
      if (s > 1.4) this.crane(ctx, cam, pal, b, h, sim);
    }

    // rooftop kit
    if (screenW > 40) this.rooftop(ctx, cam, pal, b, proj, h, sim, tp, dim);

    // risk aura: late projects burn
    const risk = proj.risk;
    if (risk > 0.55) {
      const c0 = cam.proj(b.x, b.y, h * 0.55, this.p1);
      this.tint(ctx, c0.x, c0.y, Math.max(b.w, h) * s * 0.9,
        hsl(lerp(40, 2, clamp((risk - 0.55) / 0.8)), 95, 55),
        clamp((risk - 0.55) * 0.30) * (0.6 + 0.4 * Math.sin(sim.time * 2.2 + b.seed * 10)) * dim);
    }
    // completion / milestone bloom
    if (b.glow > 0.01) {
      const c0 = cam.proj(b.x, b.y, h * 0.6, this.p1);
      this.blob(ctx, c0.x, c0.y, Math.max(b.w, h) * s * 1.5, null, 0);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp(b.glow) * 0.55 * dim;
      ctx.fillStyle = hsl(b.hue, 80, 62, 1);
      const r = Math.max(b.w, h) * s * 1.2;
      ctx.beginPath(); ctx.arc(c0.x, c0.y, r, 0, TAU); ctx.fill();
      ctx.restore(); ctx.globalAlpha = 1;
    }

    b._screen = { x: bp[0].x, top: tp[0], base: bp, tops: tp, h, w: screenW };
    if (selected) this.reticle(ctx, bp, tp, b.hue, sim, true);
    else if (ui.hover && ui.hover.type === 'project' && ui.hover.id === b.project) this.reticle(ctx, bp, tp, b.hue, sim, false);
  },

  windows(ctx, cam, pal, b, proj, faces, bp, tp, h, sim, dim) {
    const s = cam.s;
    const floors = Math.max(1, Math.round(h / b.floorH));
    const rowsPer = Math.max(1, Math.round(b.floorH / 3.9));
    const rows = floors * rowsPer;
    const lit = b.litDisp;
    const night = pal.night;
    const cw = this.corners(b);

    for (const f of faces) {
      const { i, j } = f;
      const faceLen = dist(cw[i][0], cw[i][1], cw[j][0], cw[j][1]);
      const cols = clamp(Math.round(faceLen / 3.6), 2, 16);
      const bx0 = bp[i].x, by0 = bp[i].y, bx1 = bp[j].x, by1 = bp[j].y;
      const tx0 = tp[i].x, ty0 = tp[i].y, tx1 = tp[j].x, ty1 = tp[j].y;
      const cellPx = Math.hypot(bx1 - bx0, by1 - by0) / cols;
      if (cellPx < 1.6) continue;
      const P = (u, v, out) => {
        const xa = lerp(bx0, bx1, u), ya = lerp(by0, by1, u);
        const xb = lerp(tx0, tx1, u), yb = lerp(ty0, ty1, u);
        out[0] = lerp(xa, xb, v); out[1] = lerp(ya, yb, v);
        return out;
      };
      const A = [0, 0], B = [0, 0], C = [0, 0], D = [0, 0];

      // floor bands give the facade its scale
      if (cellPx > 3.4) {
        ctx.strokeStyle = `rgba(0,0,0,${0.22 * dim})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let fl = 1; fl < floors; fl++) {
          const v = fl / floors;
          P(0, v, A); P(1, v, B);
          ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]);
        }
        ctx.stroke();
      }

      const wU = 0.58, wV = 0.52;
      for (let r = 0; r < rows; r++) {
        const v0 = (r + (1 - wV) * 0.7) / rows, v1 = v0 + wV / rows;
        for (let c = 0; c < cols; c++) {
          const u0 = (c + (1 - wU) / 2) / cols, u1 = u0 + wU / cols;
          const key = hash3(b.seed * 733 + f.i * 17, r * 3.1, c * 7.3);
          // the lower floors light first: progress fills the tower from the ground up
          const height01 = r / rows;
          const isLit = key < lit * (1.25 - height01 * 0.5);
          let col, alpha;
          if (isLit) {
            const flick = 0.86 + 0.14 * Math.sin(sim.time * (1.4 + key * 5) + key * 60);
            alpha = (0.30 + night * 0.55) * flick * (0.72 + proj.activity * 0.35) * dim;
            col = key < 0.10 ? 'rgba(150,214,255,1)' : key < 0.2 ? 'rgba(255,232,196,1)' : 'rgba(255,198,124,1)';
          } else {
            alpha = (0.30 - night * 0.12) * dim;
            col = night > 0.5 ? 'rgba(14,20,32,1)' : 'rgba(78,102,126,1)';
          }
          ctx.globalAlpha = alpha;
          ctx.fillStyle = col;
          P(u0, v0, A); P(u1, v0, B); P(u1, v1, C); P(u0, v1, D);
          ctx.beginPath();
          ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.lineTo(C[0], C[1]); ctx.lineTo(D[0], D[1]);
          ctx.closePath(); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      // vertical edge highlight — catches the sky
      ctx.strokeStyle = `rgba(180,215,240,${0.16 * dim})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bp[i].x, bp[i].y); ctx.lineTo(tp[i].x, tp[i].y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // light spilling into the street below
    if (night > 0.25 && lit > 0.2) {
      const c0 = cam.proj(b.x, b.y, h * 0.3, this.p1);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.13 * night * lit * dim;
      const rr2 = Math.max(b.w, b.d) * s * 1.6;
      ctx.drawImage(this.glow, c0.x - rr2, c0.y - rr2, rr2 * 2, rr2 * 2);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  },

  rooftop(ctx, cam, pal, b, proj, h, sim, tp, dim) {
    const s = cam.s;
    const cx = (tp[0].x + tp[2].x) / 2, cy = (tp[0].y + tp[2].y) / 2;
    // beacon: blinks red when the project has blocked work, otherwise team colour
    const blocked = proj.blocked > 0;
    const period = blocked ? 0.75 : 1.9;
    const ph = (sim.time / period + b.beacon) % 1;
    const on = ph < 0.22;
    if (on) {
      const mastH = 6 + b.w * 0.1;
      const top = cam.proj(b.x, b.y, h + mastH, this.p1);
      ctx.save();
      ctx.strokeStyle = `rgba(150,170,190,${0.5 * dim})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(top.x, top.y); ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      const col = blocked ? 'rgba(255,60,50,1)' : hsl(b.hue, 90, 65, 1);
      ctx.fillStyle = col;
      ctx.globalAlpha = dim;
      ctx.beginPath(); ctx.arc(top.x, top.y, Math.max(1.2, 2.4 * Math.min(2, s * 0.4)), 0, TAU); ctx.fill();
      this.blob(ctx, top.x, top.y, 26 * Math.min(2, s * 0.5), null, 0);
      ctx.globalAlpha = 0.6 * dim;
      ctx.drawImage(this.glow, top.x - 22, top.y - 22, 44, 44);
      ctx.restore();
      ctx.globalAlpha = 1;
    } else {
      const mastH = 6 + b.w * 0.1;
      const top = cam.proj(b.x, b.y, h + mastH, this.p1);
      ctx.strokeStyle = `rgba(120,140,160,${0.35 * dim})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(top.x, top.y); ctx.stroke();
    }
  },

  crane(ctx, cam, pal, b, h, sim) {
    const s = cam.s;
    const armLen = b.w * 0.9 + 10;
    const mastTop = h + 14 + b.w * 0.2;
    const base = cam.proj(b.x + b.w * 0.45, b.y + b.d * 0.45, 0, {});
    const top = cam.proj(b.x + b.w * 0.45, b.y + b.d * 0.45, mastTop, {});
    const swing = Math.sin(sim.time * 0.35 + b.seed * 6) * 1.4;
    const ax = b.x + b.w * 0.45 + Math.cos(swing) * armLen;
    const ay = b.y + b.d * 0.45 + Math.sin(swing) * armLen;
    const arm = cam.proj(ax, ay, mastTop, {});
    const tail = cam.proj(b.x + b.w * 0.45 - Math.cos(swing) * armLen * 0.35,
      b.y + b.d * 0.45 - Math.sin(swing) * armLen * 0.35, mastTop, {});
    ctx.save();
    ctx.strokeStyle = 'rgba(240,180,60,0.75)';
    ctx.lineWidth = Math.max(1, 1.4 * Math.min(2, s * 0.35));
    ctx.beginPath();
    ctx.moveTo(base.x, base.y); ctx.lineTo(top.x, top.y);
    ctx.moveTo(tail.x, tail.y); ctx.lineTo(arm.x, arm.y);
    ctx.stroke();
    // hook line
    const hookZ = mastTop - (10 + Math.sin(sim.time * 0.8 + b.seed) * 8);
    const hook = cam.proj(ax, ay, Math.max(0, hookZ), {});
    ctx.strokeStyle = 'rgba(200,210,220,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(arm.x, arm.y); ctx.lineTo(hook.x, hook.y); ctx.stroke();
    ctx.restore();
  },

  reticle(ctx, bp, tp, hue, sim, strong) {
    let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
    for (const q of bp.concat(tp)) {
      minx = Math.min(minx, q.x); maxx = Math.max(maxx, q.x);
      miny = Math.min(miny, q.y); maxy = Math.max(maxy, q.y);
    }
    const pad = strong ? 10 : 6;
    minx -= pad; maxx += pad; miny -= pad; maxy += pad;
    const L = Math.min(22, (maxx - minx) * 0.3);
    ctx.save();
    ctx.strokeStyle = hsl(hue, 90, 72, strong ? 0.95 : 0.5);
    ctx.lineWidth = strong ? 2 : 1.2;
    ctx.beginPath();
    for (const [x, y, sx, sy] of [[minx, miny, 1, 1], [maxx, miny, -1, 1], [minx, maxy, 1, -1], [maxx, maxy, -1, -1]]) {
      ctx.moveTo(x + sx * L, y); ctx.lineTo(x, y); ctx.lineTo(x, y + sy * L);
    }
    ctx.stroke();
    if (strong) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = hsl(hue, 90, 60, 0.25);
      ctx.lineWidth = 6; ctx.stroke();
    }
    ctx.restore();
  },

  drawProp(ctx, cam, pal, f, sim) {
    const s = cam.s;
    if (f.type === 'filler') {
      const h = Math.max(4, f.h);
      const hw = f.w / 2, hd = f.d / 2, c = Math.cos(f.rot), sn = Math.sin(f.rot);
      const pts = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([u, v]) => [f.x + u * c - v * sn, f.y + u * sn + v * c]);
      const bp = pts.map((q) => cam.proj(q[0], q[1], 0, {}));
      const tp = pts.map((q) => cam.proj(q[0], q[1], h, {}));
      const cs = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
      // the civic fabric goes to glass in front of the tracked subject too
      if (this.followPt && cam.depth(f.x, f.y) > this.followDepth) {
        const fp = this.followPt;
        let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
        for (const q of bp) { minx = Math.min(minx, q.x); maxx = Math.max(maxx, q.x); miny = Math.min(miny, q.y); maxy = Math.max(maxy, q.y); }
        for (const q of tp) { minx = Math.min(minx, q.x); maxx = Math.max(maxx, q.x); miny = Math.min(miny, q.y); maxy = Math.max(maxy, q.y); }
        let hit = fp.x >= minx && fp.x <= maxx && fp.y >= miny && fp.y <= maxy;
        if (hit) {
          hit = pointInPoly(fp.x, fp.y, tp.map((q) => [q.x, q.y]));
          for (let q = 0; q < 4 && !hit; q++) {
            const j2 = (q + 1) % 4;
            hit = pointInPoly(fp.x, fp.y, [[bp[q].x, bp[q].y], [bp[j2].x, bp[j2].y], [tp[j2].x, tp[j2].y], [tp[q].x, tp[q].y]]);
          }
        }
        f.xray = hit ? Math.min(1, (f.xray || 0) + 0.16) : Math.max(0, (f.xray || 0) - 0.10);
      } else f.xray = Math.max(0, (f.xray || 0) - 0.10);
      if (f.xray > 0.01) ctx.globalAlpha = 1 - f.xray * 0.86;
      if (f.xray > 0.92) { ctx.globalAlpha = 1; return; }
      const dark = mixRGB(mixRGB(pal.facadeDark, [0, 0, 0], 0.52), [58, 72, 92], 0.35);
      // contact shadow so the block sits on the ground instead of floating
      ctx.beginPath();
      bp.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath();
      ctx.fillStyle = `rgba(2,6,12,${0.30 * (1 - pal.night * 0.5)})`;
      ctx.fill();
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        const ex = pts[j][0] - pts[i][0], ey = pts[j][1] - pts[i][1];
        let nx = ey, ny = -ex; const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
        const mx = (pts[i][0] + pts[j][0]) / 2 - f.x, my = (pts[i][1] + pts[j][1]) / 2 - f.y;
        if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
        if (nx * sy + ny * cs <= 0.02) continue;
        ctx.beginPath();
        ctx.moveTo(bp[i].x, bp[i].y); ctx.lineTo(bp[j].x, bp[j].y);
        ctx.lineTo(tp[j].x, tp[j].y); ctx.lineTo(tp[i].x, tp[i].y); ctx.closePath();
        const shade = 0.62 + 0.38 * (nx * sy + ny * cs);
        ctx.fillStyle = toCSS(mixRGB(dark, [0, 0, 0], (1 - shade) * 0.6), 0.98);
        ctx.fill();
      }
      ctx.beginPath();
      for (let i = 0; i < 4; i++) { i ? ctx.lineTo(tp[i].x, tp[i].y) : ctx.moveTo(tp[i].x, tp[i].y); }
      ctx.closePath();
      ctx.fillStyle = toCSS(mixRGB(dark, [255, 255, 255], 0.13), 1);
      ctx.fill();
      if (s <= 2.2) {
        if (pal.night > 0.2 && f.h > 14 && hash2(f.seed * 91, 5) < 0.5) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          const gr = clamp(f.h * s * 0.7, 2.5, 26);
          ctx.globalAlpha = pal.night * 0.20;
          ctx.drawImage(this.glow, tp[0].x - gr, tp[0].y - gr, gr * 2, gr * 2);
          ctx.restore();
          ctx.globalAlpha = 1;
        }
        return;
      }
      // background blocks get windows too, or the city looks like packaging
      if (s > 2.2) {
        const cols = clamp(Math.round(f.w / 3.6), 2, 8);
        const rows = clamp(Math.round(h / 4.2), 1, 22);
        for (let q = 0; q < 4; q++) {
          const j = (q + 1) % 4;
          const ex = pts[j][0] - pts[q][0], ey = pts[j][1] - pts[q][1];
          let nx = ey, ny = -ex; const L2 = Math.hypot(nx, ny) || 1; nx /= L2; ny /= L2;
          const mx = (pts[q][0] + pts[j][0]) / 2 - f.x, my = (pts[q][1] + pts[j][1]) / 2 - f.y;
          if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
          if (nx * sy + ny * cs <= 0.02) continue;
          const cellPx = Math.hypot(bp[j].x - bp[q].x, bp[j].y - bp[q].y) / cols;
          if (cellPx < 1.6) continue;
          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              const key = hash3(f.seed * 611 + q * 13, r * 5.7, c * 2.9);
              const on = key < 0.34 * (0.3 + pal.night);
              const u0 = (c + 0.24) / cols, u1 = (c + 0.76) / cols;
              const v0 = (r + 0.26) / rows, v1 = (r + 0.72) / rows;
              const PT = (u, v) => {
                const xa = lerp(bp[q].x, bp[j].x, u), ya = lerp(bp[q].y, bp[j].y, u);
                const xb = lerp(tp[q].x, tp[j].x, u), yb = lerp(tp[q].y, tp[j].y, u);
                return [lerp(xa, xb, v), lerp(ya, yb, v)];
              };
              const a1 = PT(u0, v0), b1 = PT(u1, v0), c1 = PT(u1, v1), d1 = PT(u0, v1);
              ctx.globalAlpha = on ? (0.22 + pal.night * 0.45) : 0.16;
              ctx.fillStyle = on ? 'rgba(255,196,126,1)' : 'rgba(16,24,36,1)';
              ctx.beginPath();
              ctx.moveTo(a1[0], a1[1]); ctx.lineTo(b1[0], b1[1]); ctx.lineTo(c1[0], c1[1]); ctx.lineTo(d1[0], d1[1]);
              ctx.closePath(); ctx.fill();
            }
          }
        }
        ctx.globalAlpha = 1;
      }
      ctx.globalAlpha = 1;
      return;
    }
    if (f.type === 'lamp') {
      const b = cam.proj(f.x, f.y, 0, this.p1);
      const t = cam.proj(f.x, f.y, f.h, this.p2);
      ctx.strokeStyle = 'rgba(120,140,155,0.55)';
      ctx.lineWidth = Math.max(0.6, s * 0.09);
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(t.x, t.y); ctx.stroke();
      if (pal.night > 0.15) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = pal.night * 0.42;
        const gr = clamp(6 * s, 5, 34);
        ctx.drawImage(this.glow, t.x - gr, t.y - gr, gr * 2, gr * 2);
        ctx.globalAlpha = 1; ctx.restore();
      }
      return;
    }
    // tree
    const b = cam.proj(f.x, f.y, 0, this.p1);
    const t = cam.proj(f.x, f.y, f.h * 0.75, this.p2);
    ctx.strokeStyle = 'rgba(70,58,44,0.7)';
    ctx.lineWidth = Math.max(0.7, s * 0.12);
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(t.x, t.y); ctx.stroke();
    const r = Math.max(1.5, f.h * 0.42 * s * 0.7);
    const sway = Math.sin(sim.time * 1.4 + f.seed * 9) * sim.weather.wind * r * 0.12;
    ctx.fillStyle = `rgba(${34 + pal.ambient * 40},${76 + pal.ambient * 60},${48 + pal.ambient * 30},0.92)`;
    ctx.beginPath(); ctx.ellipse(t.x + sway, t.y, r, r * 0.86, 0, 0, TAU); ctx.fill();
  },

  /* ---- traffic ------------------------------------------ */
  agentColor(a, sim) {
    const st = a.task.state;
    if (a.resident) return a.kind === 'walk' ? [128, 146, 162] : [150, 168, 184];
    if (st === ST.BLOCKED) return [255, 70, 52];
    if (st === ST.REVIEW) return [180, 130, 255];
    if (st === ST.INBOUND) return [120, 235, 255];
    if (st === ST.DONE) return [140, 255, 190];
    const c = hsl2rgb(a.hue, 70, 62);
    return c;
  },

  drawAgent(ctx, cam, pal, a, sim, ui) {
    const s = cam.s;
    const col = this.agentColor(a, sim);
    const p = cam.proj(a.x, a.y, 0, this.p1);
    const sel = !a.resident && ui.selected && ui.selected.type === 'task' && ui.selected.id === a.task.id;
    const fade = a.resident ? 0.55 : 1;

    if (s < 1.5) {
      if (a.resident && s < 0.9) return;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = toCSS(col, 0.85 * a.alpha * fade);
      const r = a.kind === 'walk' ? 0.9 : 1.5;
      ctx.fillRect(p.x - r / 2, p.y - r / 2, r, r);
      if (a.task.state === ST.BLOCKED) {
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(sim.time * 6 + a.seedv * 10);
        ctx.drawImage(this.glow, p.x - 7, p.y - 7, 14, 14);
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      return;
    }

    // motion trail: momentum made visible
    if (a.trail.length > 2 && s > 2) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.beginPath();
      for (let i = 0; i < a.trail.length; i++) {
        const q = cam.proj(a.trail[i].x, a.trail[i].y, 0.6, this.p2);
        i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
      }
      ctx.strokeStyle = toCSS(col, 0.16 * clamp(a.speed / 20));
      ctx.lineWidth = Math.max(0.5, s * 0.22);
      ctx.stroke();
      ctx.restore();
    }

    if (a.kind === 'walk') {
      const bob = Math.abs(Math.sin(a.life * 6 + a.wob)) * 0.5;
      const head = cam.proj(a.x, a.y, 1.7 + bob, this.p2);
      ctx.strokeStyle = toCSS(col, 0.95 * a.alpha * fade);
      ctx.lineWidth = Math.max(1, s * 0.30);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(head.x, head.y); ctx.stroke();
      if (s > 6) {
        ctx.fillStyle = toCSS(mixRGB(col, [255, 255, 255], 0.35), a.alpha);
        ctx.beginPath(); ctx.arc(head.x, head.y, Math.max(1, s * 0.20), 0, TAU); ctx.fill();
      }
      ctx.save(); ctx.globalAlpha = 0.25 * a.alpha; ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(p.x, p.y, Math.max(0.6, s * 0.22), Math.max(0.3, s * 0.11), 0, 0, TAU); ctx.fill();
      ctx.restore();
    } else {
      const len = 4.6 + a.mass * 1.5, wid = 2.6 + a.mass * 0.24, hgt = 1.9 + a.mass * 0.28;
      const c = Math.cos(a.ang), sn = Math.sin(a.ang);
      const box = [[-len / 2, -wid / 2], [len / 2, -wid / 2], [len / 2, wid / 2], [-len / 2, wid / 2]]
        .map(([u, v]) => [a.x + u * c - v * sn, a.y + u * sn + v * c]);
      const bp = box.map((q) => cam.proj(q[0], q[1], 0, {}));
      const tp = box.map((q) => cam.proj(q[0], q[1], hgt, {}));
      // shadow
      ctx.save(); ctx.globalAlpha = 0.3 * (1 - pal.night * 0.6) * a.alpha; ctx.fillStyle = '#000';
      ctx.beginPath();
      bp.forEach((q, i) => (i ? ctx.lineTo(q.x + 2, q.y + 1) : ctx.moveTo(q.x + 2, q.y + 1)));
      ctx.closePath(); ctx.fill(); ctx.restore();

      const cs = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
      ctx.globalAlpha = a.alpha * fade;
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        const ex = box[j][0] - box[i][0], ey = box[j][1] - box[i][1];
        let nx = ey, ny = -ex; const L = Math.hypot(nx, ny) || 1; nx /= L; ny /= L;
        const mx = (box[i][0] + box[j][0]) / 2 - a.x, my = (box[i][1] + box[j][1]) / 2 - a.y;
        if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
        if (nx * sy + ny * cs <= 0.02) continue;
        ctx.beginPath();
        ctx.moveTo(bp[i].x, bp[i].y); ctx.lineTo(bp[j].x, bp[j].y);
        ctx.lineTo(tp[j].x, tp[j].y); ctx.lineTo(tp[i].x, tp[i].y); ctx.closePath();
        ctx.fillStyle = toCSS(mixRGB(col, [0, 0, 0], 0.42), 1);
        ctx.fill();
      }
      ctx.beginPath();
      tp.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath();
      ctx.fillStyle = toCSS(col, 1); ctx.fill();
      ctx.globalAlpha = 1;

      // lights
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const fx = a.x + c * len * 0.55, fy = a.y + sn * len * 0.55;
      const rx = a.x - c * len * 0.55, ry = a.y - sn * len * 0.55;
      const fp = cam.proj(fx, fy, hgt * 0.6, this.p2);
      const rp = cam.proj(rx, ry, hgt * 0.6, this.p3);
      if (pal.night > 0.12 && s > 3) {
        ctx.globalAlpha = pal.night * 0.85;
        ctx.drawImage(this.glow, fp.x - 14, fp.y - 14, 28, 28);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = 'rgba(255,240,210,0.95)';
      ctx.beginPath(); ctx.arc(fp.x, fp.y, Math.max(0.6, s * 0.13), 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,60,40,0.9)';
      ctx.beginPath(); ctx.arc(rp.x, rp.y, Math.max(0.5, s * 0.11), 0, TAU); ctx.fill();
      // hazard beacon for blocked work
      if (a.task.state === ST.BLOCKED) {
        const blink = (sim.time * 2.6 + a.seedv * 5) % 1 < 0.5;
        if (blink) {
          const bp2 = cam.proj(a.x, a.y, hgt + 1.4, this.p2);
          ctx.fillStyle = 'rgba(255,70,45,1)';
          ctx.beginPath(); ctx.arc(bp2.x, bp2.y, Math.max(1, s * 0.22), 0, TAU); ctx.fill();
          ctx.globalAlpha = 0.8;
          ctx.drawImage(this.glow, bp2.x - 18, bp2.y - 18, 36, 36);
          ctx.globalAlpha = 1;
        }
      }
      ctx.restore();
    }

    if (sel) {
      const r = Math.max(10, 16 * Math.min(2, s * 0.3));
      ctx.save();
      ctx.strokeStyle = toCSS(col, 0.9);
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(p.x, p.y, r + Math.sin(sim.time * 3) * 2, 0, TAU); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x - r - 6, p.y); ctx.lineTo(p.x - r + 2, p.y);
      ctx.moveTo(p.x + r - 2, p.y); ctx.lineTo(p.x + r + 6, p.y);
      ctx.stroke();
      ctx.restore();
    }
  },

  drawParticle(ctx, cam, pal, f, sim) {
    const t = f.life / f.max;
    const p = cam.proj(f.x, f.y, f.z, this.p1);
    ctx.save();
    if (f.type === 'dust') {
      ctx.globalAlpha = (1 - t) * 0.35;
      ctx.fillStyle = `rgba(190,190,180,1)`;
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.5, f.r * cam.s * (0.6 + t)), 0, TAU); ctx.fill();
    } else if (f.type === 'spark') {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (1 - t);
      ctx.fillStyle = hsl(f.hue, 95, 65, 1);
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.6, f.r * cam.s * 0.4), 0, TAU); ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  },

  drawMotes(ctx, cam, pal, sim) {
    if (!sim.motes.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const m of sim.motes) {
      const p = cam.proj(m.x, m.y, m.z, this.p1);
      const t = m.life / m.max;
      const a = (1 - t * t) * 0.9;
      const r = Math.max(1, 2.2 * Math.min(2.5, cam.s * 0.5));
      ctx.globalAlpha = a * 0.55;
      ctx.drawImage(this.glow, p.x - r * 6, p.y - r * 6, r * 12, r * 12);
      ctx.globalAlpha = a;
      ctx.fillStyle = hsl(m.hue, 90, 75, 1);
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  },

  /* ---- downtown: the organisation itself ---------------- */
  drawCore(ctx, cam, pal, sim) {
    const s = cam.s;
    const stats = orgStats(sim.org);
    const H = 120 + Math.min(90, sim.org.shipped * 1.5);
    const base = cam.proj(0, 0, 0, this.p1);
    const top = cam.proj(0, 0, H, this.p2);
    const charge = clamp(sim.coreCharge);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    const hot = clamp(stats.risk);
    const cc = mixRGB([90, 220, 255], [255, 120, 60], hot);
    const hue = hot < 0.5 ? 190 : 24;
    // spire: a faceted mast that the whole city can see
    const mastR = 13;
    for (let i = 0; i < 6; i++) {
      const a0 = (i / 6) * TAU + sim.time * 0.05, a1 = ((i + 1) / 6) * TAU + sim.time * 0.05;
      const b0 = cam.proj(Math.cos(a0) * mastR, Math.sin(a0) * mastR, 0, {});
      const b1 = cam.proj(Math.cos(a1) * mastR, Math.sin(a1) * mastR, 0, {});
      const t0 = cam.proj(Math.cos(a0) * mastR * 0.25, Math.sin(a0) * mastR * 0.25, H * 0.82, {});
      const t1 = cam.proj(Math.cos(a1) * mastR * 0.25, Math.sin(a1) * mastR * 0.25, H * 0.82, {});
      ctx.beginPath();
      ctx.moveTo(b0.x, b0.y); ctx.lineTo(b1.x, b1.y); ctx.lineTo(t1.x, t1.y); ctx.lineTo(t0.x, t0.y);
      ctx.closePath();
      ctx.fillStyle = toCSS(mixRGB(cc, [0, 0, 0], 0.45), 0.16 + 0.10 * Math.abs(Math.sin(a0 + cam.yaw)));
      ctx.fill();
    }
    // beam, softened in layers
    for (let k = 0; k < 3; k++) {
      const g = ctx.createLinearGradient(base.x, base.y, top.x, top.y);
      const aMul = [0.30, 0.16, 0.07][k];
      g.addColorStop(0, toCSS(cc, (0.22 + charge * 0.28) * aMul * 3));
      g.addColorStop(0.55, toCSS(cc, (0.09 + charge * 0.18) * aMul * 3));
      g.addColorStop(1, toCSS(cc, 0));
      const wBeam = Math.max(1.5, (5 + k * 9) * s);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(base.x - wBeam, base.y); ctx.lineTo(base.x + wBeam, base.y);
      ctx.lineTo(top.x + wBeam * 0.18, top.y); ctx.lineTo(top.x - wBeam * 0.18, top.y);
      ctx.closePath(); ctx.fill();
    }

    // rotating rings — one per team, radius by headcount, tilt by pressure
    sim.city.districts.forEach((d, i) => {
      const z = 18 + i * (H - 30) / sim.city.districts.length;
      const r = 26 + i * 5 + d.pressure * 10;
      const spin = sim.time * (0.3 + i * 0.05) + i;
      ctx.strokeStyle = hsl(d.hue, 85, 62, 0.35 + d.pressure * 0.3);
      ctx.lineWidth = Math.max(0.8, 1.6 * Math.min(2, s));
      ctx.beginPath();
      for (let k = 0; k <= 48; k++) {
        const a = (k / 48) * TAU + spin;
        const q = cam.proj(Math.cos(a) * r, Math.sin(a) * r, z + Math.sin(a * 3 + spin) * 3, this.p3);
        k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
      }
      ctx.stroke();
    });

    // core glow
    const cg = 40 + charge * 90;
    ctx.globalAlpha = 0.5 + charge * 0.4;
    ctx.drawImage(this.glow, base.x - cg * s * 0.5, base.y - cg * s * 0.5 - 10 * s, cg * s, cg * s);
    ctx.globalAlpha = 1;
    ctx.restore();

    // plaza ring on the ground
    ctx.save();
    ctx.strokeStyle = toCSS(cc, 0.22);
    ctx.lineWidth = Math.max(1, 2 * s * 0.3);
    ctx.beginPath();
    for (let k = 0; k <= 64; k++) {
      const a = (k / 64) * TAU;
      const q = cam.proj(Math.cos(a) * 44, Math.sin(a) * 44, 0.4, this.p3);
      k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y);
    }
    ctx.stroke();
    ctx.restore();
    this.corePos = base;
  },

  /* ---- weather ------------------------------------------ */
  drawWeather(ctx, cam, pal, sim) {
    const w = sim.weather, W = cam.W, H = cam.H;
    if (!this.drops) {
      this.drops = [];
      for (let i = 0; i < 900; i++) this.drops.push({ x: Math.random() * 1.4 - 0.2, y: Math.random(), v: 0.6 + Math.random() * 0.8, l: 0.4 + Math.random() * 0.9 });
    }
    if (w.rain > 0.02) {
      const n = Math.floor(this.drops.length * clamp(w.rain));
      const slant = (w.wind * 0.35 + 0.1);
      ctx.save();
      ctx.strokeStyle = `rgba(170,210,235,${0.10 + w.rain * 0.22})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const t = sim.time;
      for (let i = 0; i < n; i++) {
        const d = this.drops[i];
        const y = ((d.y + t * d.v * 0.55) % 1) * H;
        const x = ((d.x + (y / H) * slant * 0.6) % 1.4 - 0.2) * W;
        const L = d.l * 22 * (0.6 + w.rain);
        ctx.moveTo(x, y); ctx.lineTo(x + L * slant, y + L);
      }
      ctx.stroke();
      ctx.restore();
    }
    // lightning
    if (w.flash > 0.01) {
      const f = w.flash;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(150,190,255,${f * f * 0.28})`;
      ctx.fillRect(0, 0, W, H);
      if (w.boltAt && f > 0.5) {
        const p0 = cam.proj(w.boltAt.x, w.boltAt.y, 460, this.p1);
        const p1 = cam.proj(w.boltAt.x, w.boltAt.y, 0, this.p2);
        ctx.strokeStyle = `rgba(220,235,255,${(f - 0.5) * 1.6})`;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        const segs = 9;
        for (let i = 1; i <= segs; i++) {
          const t = i / segs;
          const jx = (hash2(w.boltSeed * 100 + i, 3) - 0.5) * 60 * (1 - t) * cam.s * 0.5;
          ctx.lineTo(lerp(p0.x, p1.x, t) + jx, lerp(p0.y, p1.y, t));
        }
        ctx.stroke();
        ctx.lineWidth = 7;
        ctx.strokeStyle = `rgba(120,170,255,${(f - 0.5) * 0.5})`;
        ctx.stroke();
      }
      ctx.restore();
    }
  },

  drawPost(ctx, cam, pal, sim) {
    const W = cam.W, H = cam.H;
    // atmospheric haze toward the far edge of the world
    const g = ctx.createLinearGradient(0, 0, 0, H * 0.75);
    g.addColorStop(0, toCSS(mixRGB(pal.sky, [255, 255, 255], 0.06), 0.42));
    g.addColorStop(1, toCSS(pal.sky, 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H * 0.75);

    // vignette
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.34, W / 2, H / 2, Math.max(W, H) * 0.78);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, `rgba(0,0,0,${0.42 + pal.night * 0.2})`);
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

    // grain
    ctx.save();
    ctx.globalAlpha = 0.28;
    const ox = Math.floor(Math.random() * 180), oy = Math.floor(Math.random() * 180);
    for (let x = -ox; x < W; x += 180) for (let y = -oy; y < H; y += 180) ctx.drawImage(this.grain, x, y);
    ctx.restore();
  },
});


/* deterministic ground mottling, generated once */
function seedPatchesOnce(city) {
  if (city.patches) return;
  const R = city.radius;
  city.patches = [];
  const rndp = mulberry32(0x9A7C3);
  for (let i = 0; i < 26; i++) {
    const a = rndp() * TAU, r = Math.sqrt(rndp()) * R * 0.95;
    city.patches.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, r: 90 + rndp() * 220, dark: rndp() < 0.55 });
  }
}
