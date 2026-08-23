/* ============================================================
   hud.js — everything overlaid on the city, drawn on the same
   canvas so it can hang off world objects: leader lines,
   tracking labels, readouts that grow out of what you touched.
   No tables. No cards. Only instruments.
   ============================================================ */
'use strict';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const CY = '#7fe9ff';
const AM = '#ffc24d';

class HUD {
  constructor() {
    this.labels = new Map();     // id -> {t, x, y, ox, oy}
    this.panelT = 0;
    this.panelFrom = { x: 0, y: 0 };
    this.feedT = 0;
    this.boot = 0;
    this.ringT = 0;
    this.ringNodes = [];
    this.nodeT = new Map();
  }

  lab(id) {
    let l = this.labels.get(id);
    if (!l) { l = { t: 0, x: 0, y: 0, sx: 0, sy: 0, seen: 0 }; this.labels.set(id, l); }
    return l;
  }

  draw(ctx, sim, cam, ui, R, dt) {
    this.dt = dt;
    this.boot = Math.min(1, this.boot + dt * 0.55);
    const W = cam.W, H = cam.H;
    this.W = W; this.H = H;
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    const lod = lodOf(cam.s);
    this.radarSweep(ctx, sim, cam, R, lod);
    this.worldLabels(ctx, sim, cam, ui, R, lod, dt);
    this.chrome(ctx, sim, cam, ui, lod);
    this.detail(ctx, sim, cam, ui, R, dt);
    this.ticker(ctx, sim, cam, ui);
    this.guideCard(ctx, sim, cam, ui);
    this.linkMode(ctx, sim, cam, ui);
    this.tourCaption(ctx, sim, cam, ui);
    this.incidents(ctx, sim, cam, ui);
    this.firstHint(ctx, sim, cam, ui);
    if (ui.help) this.helpCard(ctx, cam);
    if (this.boot < 1) this.bootMask(ctx, cam);
    ctx.restore();
  }

  /* ---- a slow sweep over the whole organisation --------- */
  radarSweep(ctx, sim, cam, R, lod) {
    if (lod > LOD.TEAM) return;
    const a = (sim.time * 0.22) % TAU;
    const p0 = cam.proj(0, 0, 0, {});
    const rr2 = sim.city.radius;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = clamp(remap(cam.s, 2.5, 0.6, 0, 0.5));
    const grad = ctx.createLinearGradient(p0.x, p0.y,
      cam.proj(Math.cos(a) * rr2, Math.sin(a) * rr2, 0, {}).x,
      cam.proj(Math.cos(a) * rr2, Math.sin(a) * rr2, 0, {}).y);
    grad.addColorStop(0, 'rgba(120,235,255,0.30)');
    grad.addColorStop(1, 'rgba(120,235,255,0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    const e = cam.proj(Math.cos(a) * rr2, Math.sin(a) * rr2, 0, {});
    ctx.lineTo(e.x, e.y);
    ctx.stroke();
    ctx.restore();
  }

  /* ---- labels that track their object ------------------- */
  fits(x, y, w, h) {
    for (const b of this.taken) {
      if (x < b[0] + b[2] && x + w > b[0] && y < b[1] + b[3] && y + h > b[1]) return false;
    }
    return true;
  }
  claim(x, y, w, h) { this.taken.push([x, y, w, h]); }

  worldLabels(ctx, sim, cam, ui, R, lod, dt) {
    const city = sim.city, org = sim.org;
    const show = new Set();
    this.taken = this.panelBox ? [this.panelBox] : [];
    // the fixed instrument cluster is not available to world labels
    this.taken.push([0, cam.H - 190, 320, 190]);      // intake + pulse + counters
    this.taken.push([0, 0, 300, 260]);                // identity block + signal feed

    // districts
    if (lod <= LOD.PROJECT) {
      for (const d of city.districts) {
        const id = 'D' + d.team;
        show.add(id);
        const p = cam.proj(d.cx, d.cy, 26, {});
        const l = this.lab(id);
        l.sx = p.x; l.sy = p.y;
        const strength = lod === LOD.ORG ? 1 : lod === LOD.TEAM ? 0.9 : 0.35;
        l.t = damp(l.t, strength, 5, dt);
        if (l.t < 0.02) continue;
        const size = lerp(9, 20, clamp(remap(cam.s, 0.35, 1.4, 0, 1)));
        const box = [p.x - size * 4, p.y - size, size * 8, size * 3.4];
        if (!this.fits(box[0], box[1], box[2], box[3])) { l.t = damp(l.t, 0, 7, dt); if (l.t < 0.03) continue; }
        else this.claim(box[0], box[1], box[2], box[3]);
        this.districtLabel(ctx, sim, d, l, cam, ui, org);
      }
    }
    // buildings — ranked, then thinned so nothing overlaps
    if (lod >= LOD.TEAM) {
      const cands = [];
      for (const b of city.buildings) {
        if (!b._screen) continue;
        const top = cam.proj(b.x, b.y, buildingHeight(b) + 8, {});
        if (top.x < -100 || top.x > cam.W + 100 || top.y < -60 || top.y > cam.H + 60) continue;
        const proj = org.byId[b.project];
        const sel = ui.selected && ui.selected.id === b.project;
        const hov = ui.hover && ui.hover.id === b.project;
        const dc = Math.hypot(top.x - cam.W / 2, top.y - cam.H / 2);
        const prio = (sel ? 1e6 : 0) + (hov ? 5e5 : 0) + (proj.blocked ? 2e4 : 0) +
          (ui.focusTeam === b.district ? 1e4 : 0) + 8000 - dc;
        cands.push({ b, proj, top, sel, hov, prio });
      }
      cands.sort((a, q) => q.prio - a.prio);
      const budget = lod >= LOD.PROJECT ? 22 : 12;
      let placed = 0;
      for (const c of cands) {
        const id = 'B' + c.b.project;
        show.add(id);
        const l = this.lab(id);
        l.sx = c.top.x; l.sy = c.top.y;
        const room = this.fits(c.top.x + 22, c.top.y - 44, 150, 34);
        // a selected structure is titled by its readout, not twice
        const keep = c.hov || (!c.sel && placed < budget && room);
        const base = c.hov ? 1 : lod >= LOD.PROJECT ? 0.9 : 0.55;
        l.t = damp(l.t, keep ? base : 0, 6, dt);
        if (l.t < 0.03) continue;
        if (keep) { this.claim(c.top.x + 22, c.top.y - 44, 150, 34); placed++; }
        this.buildingLabel(ctx, sim, c.b, c.proj, l, cam, c.sel || c.hov);
      }
    }
    // agents
    if (lod >= LOD.TASK) {
      for (const a of sim.agents) {
        if (a.dead || a.resident) continue;
        const sel = ui.selected && ui.selected.type === 'task' && ui.selected.id === a.task.id;
        const hov = ui.hover && ui.hover.type === 'task' && ui.hover.id === a.task.id;
        const blocked = a.task.state === ST.BLOCKED;
        const want = sel ? 1 : hov ? 0.9 : (blocked && lod >= LOD.TASK ? 0.7 : lod >= LOD.ACT ? 0.5 : 0);
        if (want < 0.05 && !this.labels.has('T' + a.task.id)) continue;
        const id = 'T' + a.task.id;
        show.add(id);
        const l = this.lab(id);
        const p = cam.proj(a.x, a.y, 6, {});
        l.sx = p.x; l.sy = p.y;
        const room = this.fits(p.x + 14, p.y - 32, 150, 26);
        const keep = sel || hov || room;
        l.t = damp(l.t, keep ? want : 0, 7, dt);
        if (l.t < 0.03) continue;
        if (keep) this.claim(p.x + 14, p.y - 32, 150, 26);
        this.taskLabel(ctx, sim, a, l, cam, sel || hov);
      }
    }
    for (const [id, l] of this.labels) {
      if (!show.has(id)) {
        l.t = damp(l.t, 0, 8, dt);
        if (l.t < 0.01) this.labels.delete(id);
      }
    }
  }

  districtLabel(ctx, sim, d, l, cam, ui, org) {
    const t = easeOut(l.t);
    const projects = org.teams[d.team].projects.map((id) => org.byId[id]);
    const open = projects.reduce((s, p) => s + p.openCount, 0);
    const blocked = projects.reduce((s, p) => s + p.blocked, 0);
    const size = lerp(9, 20, clamp(remap(cam.s, 0.35, 1.4, 0, 1))) * (0.6 + t * 0.4);
    ctx.save();
    ctx.globalAlpha = t;
    ctx.textAlign = 'center';
    ctx.font = `600 ${size}px ${MONO}`;
    ctx.fillStyle = hsl(d.hue, 90, 78, 0.95);
    ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 12;
    ctx.fillText(d.name.toUpperCase(), l.sx, l.sy);
    ctx.shadowBlur = 0;
    ctx.font = `500 ${size * 0.46}px ${MONO}`;
    ctx.fillStyle = 'rgba(200,225,240,0.7)';
    ctx.fillText(`${d.motto}`, l.sx, l.sy + size * 0.85);
    const mor = org.teams[d.team].morale;
    const queued = projects.reduce((s, p) => s + (p.queued || 0), 0);
    ctx.fillStyle = blocked ? 'rgba(255,110,80,0.95)' : 'rgba(140,220,255,0.8)';
    ctx.fillText(`${open} open · ${blocked} blocked${queued ? ` · ${queued} waiting` : ''} · ${(d.pressure * 100) | 0}% load`,
      l.sx, l.sy + size * 1.5);
    if (mor < 0.5) {
      ctx.fillStyle = `rgba(255,${mor < 0.34 ? 100 : 170},80,0.95)`;
      ctx.fillText(`morale ${(mor * 100) | 0}%`, l.sx, l.sy + size * 2.6);
    }
    // load bar
    const bw = size * 7, bh = Math.max(2, size * 0.13);
    const bx = l.sx - bw / 2, by = l.sy + size * 2.0;
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = hsl(lerp(190, 4, clamp(d.pressure)), 90, 60, 0.95);
    ctx.fillRect(bx, by, bw * clamp(d.pressure), bh);
    ctx.restore();
  }

  buildingLabel(ctx, sim, b, proj, l, cam, strong) {
    const t = easeOut(l.t);
    const x = l.sx, y = l.sy;
    const w = 132, h = 30;
    const gx = x + 26, gy = y - 40;
    ctx.save();
    ctx.globalAlpha = t;
    // leader line — the label is tethered, it did not appear
    ctx.strokeStyle = hsl(b.hue, 80, 70, 0.5 * t);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(lerp(x, gx - 8, t), lerp(y, gy + h * 0.5, t));
    ctx.lineTo(gx - 4, gy + h * 0.5);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 2.2, 0, TAU);
    ctx.fillStyle = hsl(b.hue, 90, 75, 0.9); ctx.fill();

    ctx.translate(gx, gy + h / 2);
    ctx.scale(1, t);
    ctx.translate(0, -h / 2);
    ctx.textAlign = 'left';
    ctx.font = `600 12px ${MONO}`;
    ctx.fillStyle = 'rgba(232,246,255,0.98)';
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 8;
    ctx.fillText(proj.name.toUpperCase(), 0, 7);
    ctx.shadowBlur = 0;
    ctx.font = `500 9px ${MONO}`;
    const late = proj.deadlineDay - sim.org.day;
    ctx.fillStyle = late < 0 ? 'rgba(255,110,90,0.95)' : late < 5 ? 'rgba(255,200,90,0.9)' : 'rgba(160,200,220,0.8)';
    ctx.fillText(late < 0 ? `${Math.abs(late).toFixed(0)}d OVERDUE` : `${late.toFixed(0)}d left`, 0, 20);
    // progress bar
    const bw = 74;
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(52, 17, bw, 3);
    ctx.fillStyle = hsl(b.hue, 90, 62, 1);
    ctx.fillRect(52, 17, bw * proj.progress, 3);
    if (proj.blocked) {
      ctx.fillStyle = 'rgba(255,80,60,0.95)';
      ctx.beginPath(); ctx.arc(bw + 60, 18.5, 2.6, 0, TAU); ctx.fill();
    }
    if (proj.queued) {
      ctx.font = `600 8px ${MONO}`;
      ctx.fillStyle = 'rgba(255,194,77,0.95)';
      ctx.fillText(`≡${proj.queued} waiting`, 0, 30);
    }
    if (proj.incident) {
      ctx.font = `700 9px ${MONO}`;
      ctx.fillStyle = `rgba(255,90,60,${0.6 + 0.4 * Math.sin(sim.time * 5)})`;
      ctx.fillText('⚠ DOWN', 76, 30);
    }
    ctx.restore();
  }

  taskLabel(ctx, sim, a, l, cam, strong) {
    const t = easeOut(l.t);
    const st = a.task.state;
    const col = st === ST.BLOCKED ? '#ff6a4a' : st === ST.REVIEW ? '#b78cff' : st === ST.INBOUND ? '#7fe9ff' : hsl(a.hue, 85, 70);
    const x = l.sx, y = l.sy;
    const gx = x + 18, gy = y - 26;
    ctx.save();
    ctx.globalAlpha = t * (strong ? 1 : 0.8);
    ctx.strokeStyle = col; ctx.globalAlpha *= 0.9;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(gx - 6, gy + 8); ctx.stroke();
    ctx.textAlign = 'left';
    ctx.font = `600 10px ${MONO}`;
    ctx.fillStyle = col;
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 6;
    const title = a.task.title.length > 26 ? a.task.title.slice(0, 25) + '…' : a.task.title;
    ctx.fillText(title, gx, gy + 8);
    ctx.font = `500 8px ${MONO}`;
    ctx.fillStyle = 'rgba(200,220,235,0.75)';
    ctx.fillText(`${a.task.ownerName} · ${a.task.size} · ${st}`, gx, gy + 19);
    ctx.shadowBlur = 0;
    // progress ring around the body
    const r = 9;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
    ctx.strokeStyle = col;
    ctx.beginPath(); ctx.arc(x, y, r, -PI / 2, -PI / 2 + TAU * a.task.done); ctx.stroke();
    ctx.restore();
  }

  /* ---- fixed instrumentation ---------------------------- */
  chrome(ctx, sim, cam, ui, lod) {
    const W = cam.W, H = cam.H, org = sim.org;
    const stats = orgStats(org);
    // while the city is touring itself the instruments step back
    const b = easeOut(this.boot)
      * (1 - (ui.tour ? ui.tour.fade : 0) * 0.88)
      * (1 - (ui.guide ? ui.guide.fade : 0) * 0.7);
    if (b < 0.02) return;

    /* top-left: identity + clock */
    ctx.save();
    ctx.globalAlpha = b;
    ctx.textAlign = 'left';
    const day = Math.floor(org.day), hrs = (org.day % 1) * 24;
    ctx.font = `700 22px ${MONO}`;
    ctx.fillStyle = '#e9f6ff';
    ctx.fillText(org.name, 24, 38);
    ctx.font = `500 10px ${MONO}`;
    ctx.fillStyle = 'rgba(150,200,225,0.8)';
    ctx.fillText('LIVE OPERATIONS SURFACE', 24, 55);
    ctx.font = `600 12px ${MONO}`;
    ctx.fillStyle = CY;
    ctx.fillText(`DAY ${pad2(day)}  ${pad2(Math.floor(hrs))}:${pad2(Math.floor((hrs % 1) * 60))}`, 24, 76);
    const wname = sim.weather.storm > 0.6 ? 'STORM' : sim.weather.storm > 0.32 ? 'RAIN' :
      sim.weather.cloud > 0.35 ? 'OVERCAST' : sim.night > 0.5 ? 'CLEAR NIGHT' : 'CLEAR';
    ctx.fillStyle = sim.weather.storm > 0.32 ? '#ff9a6a' : 'rgba(160,210,230,0.9)';
    ctx.fillText(`${wname}  ·  DEADLINE PRESSURE ${(stats.risk * 100).toFixed(0)}%`, 24, 92);
    ctx.restore();

    /* top-centre: the zoom ladder you are standing on */
    ctx.save();
    ctx.globalAlpha = b;
    ctx.textAlign = 'center';
    ctx.font = `600 10px ${MONO}`;
    const names = LOD_NAME;
    if (ui.compact) {
      ctx.font = `700 11px ${MONO}`;
      ctx.fillStyle = '#eaf8ff';
      ctx.fillText(names[lod], W / 2, 22);
      const alt0 = clamp(remap(Math.log(cam.s), Math.log(0.3), Math.log(28), 0, 1));
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(W / 2 - 70, 32, 140, 2);
      ctx.fillStyle = AM;
      ctx.fillRect(W / 2 - 70 + 140 * alt0 - 1, 29, 2, 8);
      ctx.restore();
      this.rightRail(ctx, sim, cam, ui, lod, b);
      return;
    }
    const total = 460, x0 = W / 2 - total / 2;
    for (let i = 0; i < names.length; i++) {
      const x = x0 + (i + 0.5) * (total / names.length);
      const on = i === lod;
      ctx.fillStyle = on ? '#eaf8ff' : 'rgba(140,180,205,0.45)';
      ctx.fillText(names[i], x, 30);
      if (i < names.length - 1) {
        ctx.fillStyle = 'rgba(120,160,185,0.3)';
        ctx.fillText('›', x0 + (i + 1) * (total / names.length), 30);
      }
      const tick = on ? 6 : 3;
      ctx.fillStyle = on ? CY : 'rgba(120,160,185,0.35)';
      ctx.fillRect(x - 12, 40, 24, on ? 2 : 1);
      if (on) {
        ctx.fillRect(x - 1, 36, 2, 8);
      }
    }
    // altitude scale
    const alt = clamp(remap(Math.log(cam.s), Math.log(0.3), Math.log(28), 0, 1));
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x0, 50, total, 1);
    ctx.fillStyle = AM;
    ctx.fillRect(x0 + total * alt - 1, 46, 2, 9);
    ctx.restore();

    /* right: vertical zoom rail */
    if (!ui.compact) {
    ctx.save();
    ctx.globalAlpha = b * 0.9;
    const rx = W - 34, ry0 = 120, ry1 = H - 190;
    ctx.strokeStyle = 'rgba(160,210,235,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(rx, ry0); ctx.lineTo(rx, ry1); ctx.stroke();
    for (let i = 0; i < 5; i++) {
      const y = lerp(ry1, ry0, i / 4);
      const on = i === lod;
      ctx.strokeStyle = on ? CY : 'rgba(160,210,235,0.35)';
      ctx.lineWidth = on ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(rx - (on ? 10 : 5), y); ctx.lineTo(rx + (on ? 10 : 5), y); ctx.stroke();
    }
    const yk = lerp(ry1, ry0, alt);
    ctx.fillStyle = AM;
    ctx.beginPath();
    ctx.moveTo(rx + 14, yk); ctx.lineTo(rx + 22, yk - 5); ctx.lineTo(rx + 22, yk + 5);
    ctx.closePath(); ctx.fill();
    ctx.restore();

      }
  /* compass */
    const cx = W - 62, cy = ui.compact ? 60 : 74;
    ctx.save();
    ctx.globalAlpha = b * 0.85;
    ctx.translate(cx, cy);
    ctx.strokeStyle = 'rgba(160,210,235,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, 22, 0, TAU); ctx.stroke();
    ctx.rotate(-cam.yaw);
    ctx.beginPath();
    ctx.moveTo(0, -20); ctx.lineTo(5, 4); ctx.lineTo(0, 0); ctx.lineTo(-5, 4);
    ctx.closePath();
    ctx.fillStyle = '#ff7a5a'; ctx.fill();
    ctx.rotate(cam.yaw);
    ctx.font = `600 9px ${MONO}`; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(200,230,245,0.8)';
    ctx.fillText('N', Math.sin(cam.yaw) * 0 + 0, -28);
    ctx.restore();

    /* bottom-left: city pulse and the valve above it */
    this._compact = ui.compact;
    this.pulse(ctx, sim, cam, stats, b);
    this.intake(ctx, sim, cam, b);
    this.clockControl(ctx, sim, cam, ui, b);

    /* bottom-right: legend */
    if (ui.compact) { ctx.restore(); return; }
    ctx.save();
    ctx.globalAlpha = b * 0.8;
    ctx.textAlign = 'right';
    ctx.font = `500 9px ${MONO}`;
    const lines = [
      'DRAG orbit · SCROLL altitude · SHIFT+DRAG rotate',
      'CLICK building = project · CLICK vehicle = task',
      'ESC ascend · F follow · SPACE hold time · H help',
    ];
    lines.forEach((t, i) => {
      ctx.fillStyle = 'rgba(170,205,225,0.55)';
      ctx.fillText(t, W - 24, H - 26 + i * 12 - 24);
    });
    ctx.restore();
  }

  /* the valve on new work — an instrument, not a form control */
  intake(ctx, sim, cam, b) {
    const org = sim.org;
    const compact = this._compact;
    const x = 24, y = cam.H - (compact ? 132 : 142),
      w = compact ? Math.min(200, cam.W - 48) : 260, h = compact ? 12 : 8;
    this.intakeBox = [x - 6, y - 20, w + 12, h + 32];
    ctx.save();
    ctx.globalAlpha = b;
    ctx.textAlign = 'left';
    ctx.font = `600 9px ${MONO}`;
    ctx.fillStyle = 'rgba(160,205,230,0.65)';
    ctx.fillText('INTAKE VALVE', x, y - 10);
    const pct = org.intake;
    ctx.textAlign = 'right';
    ctx.fillStyle = pct < 0.05 ? '#ff6a4a' : pct > 1.4 ? '#ffc24d' : CY;
    ctx.font = `700 10px ${MONO}`;
    ctx.fillText(pct < 0.05 ? 'CLOSED' : `${(pct * 100) | 0}%`, x + w, y - 10);
    ctx.textAlign = 'left';
    // track
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(x, y, w, h);
    for (let i = 0; i <= 4; i++) {
      ctx.fillStyle = 'rgba(160,205,230,0.25)';
      ctx.fillRect(x + (w - 1) * (i / 4), y - 3, 1, h + 6);
    }
    const t = clamp(org.intake / 2);
    const g = ctx.createLinearGradient(x, 0, x + w * t, 0);
    g.addColorStop(0, 'rgba(127,233,255,0.35)');
    g.addColorStop(1, pct > 1.2 ? 'rgba(255,194,77,0.95)' : 'rgba(127,233,255,0.95)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w * t, h);
    // handle
    const hx = x + w * t;
    ctx.fillStyle = '#eaf8ff';
    ctx.fillRect(hx - 2, y - 6, 4, h + 12);
    ctx.font = `500 8px ${MONO}`;
    ctx.fillStyle = 'rgba(150,190,215,0.5)';
    ctx.fillText('drag  ·  [ ]', x, y + h + 12);
    ctx.restore();
  }

  /* the pieces a phone still gets: instruments, no chrome */
  rightRail(ctx, sim, cam, ui, lod, b) {
    const stats = orgStats(sim.org);
    this._compact = ui.compact;
    this.pulse(ctx, sim, cam, stats, b);
    this.intake(ctx, sim, cam, b);
    this.clockControl(ctx, sim, cam, ui, b);
  }

  /* time: hold it, slow it, or run it hot */
  clockControl(ctx, sim, cam, ui, b) {
    const w = ui.compact ? 150 : 176;
    const x = 24, y = cam.H - (ui.compact ? 196 : 178), h = ui.compact ? 22 : 18;
    this.speedBoxes = [];
    ctx.save();
    ctx.globalAlpha = b;
    ctx.textAlign = 'left';
    ctx.font = `600 9px ${MONO}`;
    ctx.fillStyle = 'rgba(160,205,230,0.65)';
    ctx.fillText('TIME', x, y - 7);
    const labels = ['⏸', '¼', '½', '1', '2', '4'];
    const vals = [0, 0.25, 0.5, 1, 2, 4];
    const cw = w / labels.length;
    for (let i = 0; i < labels.length; i++) {
      const bx = x + i * cw;
      const on = i === 0 ? ui.paused : (!ui.paused && ui.speed === vals[i]);
      ctx.fillStyle = on ? 'rgba(127,233,255,0.9)' : 'rgba(255,255,255,0.07)';
      ctx.fillRect(bx, y, cw - 2, h);
      if (!on) {
        ctx.strokeStyle = 'rgba(140,190,215,0.22)';
        ctx.lineWidth = 1;
        ctx.strokeRect(bx + 0.5, y + 0.5, cw - 3, h - 1);
      }
      ctx.fillStyle = on ? '#04121a' : 'rgba(190,220,238,0.8)';
      ctx.font = `${on ? 700 : 500} ${ui.compact ? 11 : 10}px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.fillText(labels[i], bx + (cw - 2) / 2, y + h / 2 + 0.5);
      ctx.textAlign = 'left';
      this.speedBoxes.push({ x: bx, y, w: cw - 2, h, val: vals[i], pause: i === 0 });
    }
    if (!ui.paused && ui.speed !== 1) {
      ctx.font = `600 8px ${MONO}`;
      ctx.fillStyle = ui.speed > 1 ? '#ffc24d' : 'rgba(150,200,225,0.8)';
      ctx.fillText(ui.speed > 1 ? 'RUNNING HOT' : 'SLOWED', x + w + 8, y + h / 2);
    }
    ctx.restore();
  }

  pulse(ctx, sim, cam, stats, b) {
    const H = cam.H;
    const compact = this._compact;
    const x = 24, y = H - 96, w = compact ? Math.min(200, cam.W - 48) : 260, h = compact ? 34 : 54;
    ctx.save();
    ctx.globalAlpha = b;
    ctx.font = `600 9px ${MONO}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(160,205,230,0.65)';
    ctx.fillText('CITY PULSE · THROUGHPUT', x, y - 10);
    ctx.strokeStyle = 'rgba(140,190,215,0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    // grid
    ctx.strokeStyle = 'rgba(140,190,215,0.08)';
    ctx.beginPath();
    for (let i = 1; i < 4; i++) { ctx.moveTo(x, y + (h * i) / 4); ctx.lineTo(x + w, y + (h * i) / 4); }
    ctx.stroke();
    const p = sim.pulse, n = p.length;
    let max = 1;
    for (const v of p) max = Math.max(max, v);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const px = x + (i / (n - 1)) * w;
      const py = y + h - (p[i] / max) * (h - 6) - 3;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.strokeStyle = CY; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath();
    ctx.fillStyle = 'rgba(127,233,255,0.10)'; ctx.fill();

    // counters
    ctx.textAlign = 'left';
    ctx.font = `700 15px ${MONO}`;
    const cols = [
      [stats.active, 'ACTIVE', '#8fe9c0'],
      [stats.blocked, 'BLOCKED', '#ff6a4a'],
      [stats.open, 'OPEN', '#7fe9ff'],
      [stats.shipped, 'SHIPPED', '#ffc24d'],
    ];
    cols.forEach(([v, label, col], i) => {
      const cx = x + 4 + i * 70;
      ctx.fillStyle = col;
      ctx.fillText(String(v), cx, y + h + 20);
      ctx.font = `500 8px ${MONO}`;
      ctx.fillStyle = 'rgba(165,200,220,0.6)';
      ctx.fillText(label, cx, y + h + 32);
      ctx.font = `700 15px ${MONO}`;
    });
    ctx.restore();
  }

  /* ---- the readout that grows out of the thing you picked */
  detail(ctx, sim, cam, ui, R, dt) {
    const target = ui.selected;
    this.panelT = damp(this.panelT, target ? 1 : 0, 7, dt);
    if (this.panelT < 0.02) { this.lastSel = null; this.panelBox = null; this.ringNodes = []; return; }
    const sel = target || this.lastSel;
    if (target) this.lastSel = target;
    if (!sel) return;
    const org = sim.org;

    let anchor = { x: cam.W / 2, y: cam.H / 2 }, hue = 200;
    if (sel.type === 'project') {
      const b = sim.city.byProject[sel.id];
      if (b) { const p = cam.proj(b.x, b.y, buildingHeight(b), {}); anchor = p; hue = b.hue; }
    } else if (sel.type === 'task') {
      const a = sim.byTask[sel.id];
      if (a) { const p = cam.proj(a.x, a.y, 4, {}); anchor = p; hue = a.hue; }
      else { this.lastSel = null; ui.selected = null; return; }
    } else if (sel.type === 'team') {
      const d = sim.city.districts[sel.id];
      const p = cam.proj(d.cx, d.cy, 40, {}); anchor = p; hue = d.hue;
    }

    const t = easeOut(this.panelT);
    const compact = ui.compact;
    const w = compact ? Math.min(300, cam.W - 24) : 300;
    const h = sel.type === 'project' ? 250 : sel.type === 'team' ? 210 : 190;
    // on a phone it sits at the top, clear of both the ring and the instruments
    const leftRoom = compact ? false : anchor.x > cam.W * 0.55;
    let px = compact ? (cam.W - w) / 2
      : clamp(leftRoom ? anchor.x - w - 46 : anchor.x + 46, 20, cam.W - w - 20);
    let py = compact ? 54 : clamp(anchor.y - h * 0.5, 76, cam.H - h - 130);

    this.panelBox = [px - 12, py - 10, w + 24, h + 20];
    this.commandRing(ctx, sim, ui, anchor, hue, leftRoom, dt, t);

    ctx.save();
    // tether
    ctx.strokeStyle = hsl(hue, 85, 70, 0.55 * t);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(anchor.x, anchor.y);
    const tx = leftRoom ? px + w + 14 : px - 14;
    ctx.lineTo(lerp(anchor.x, tx, t), lerp(anchor.y, py + h / 2, t));
    ctx.lineTo(leftRoom ? px + w + 2 : px - 2, py + h / 2);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(anchor.x, anchor.y, 3, 0, TAU);
    ctx.fillStyle = hsl(hue, 90, 75, t); ctx.fill();

    // glass
    ctx.translate(px, py + h / 2);
    ctx.scale(lerp(0.7, 1, t), t);
    ctx.translate(0, -h / 2);
    ctx.globalAlpha = t;
    roundRectPath(ctx, 0, 0, w, h, 3);
    ctx.fillStyle = 'rgba(8,18,26,0.80)';
    ctx.fill();
    ctx.strokeStyle = hsl(hue, 70, 62, 0.55);
    ctx.lineWidth = 1; ctx.stroke();
    // brackets
    ctx.strokeStyle = hsl(hue, 85, 72, 0.9);
    ctx.lineWidth = 2;
    const L = 16;
    ctx.beginPath();
    ctx.moveTo(0, L); ctx.lineTo(0, 0); ctx.lineTo(L, 0);
    ctx.moveTo(w - L, h); ctx.lineTo(w, h); ctx.lineTo(w, h - L);
    ctx.stroke();
    // scan line
    const sy = (sim.time * 55) % h;
    ctx.fillStyle = hsl(hue, 90, 70, 0.06);
    ctx.fillRect(0, sy, w, 18);

    ctx.textAlign = 'left';
    if (sel.type === 'project') this.projectReadout(ctx, sim, org.byId[sel.id], hue, w, h);
    else if (sel.type === 'task') this.taskReadout(ctx, sim, org.byId[sel.id], hue, w, h);
    else this.teamReadout(ctx, sim, sim.city.districts[sel.id], hue, w, h);
    ctx.restore();
  }

  /* ---- the command ring ---------------------------------
     Actions orbit the thing they act on. You reach for the
     city, not for a toolbar.
  ------------------------------------------------------- */
  commandRing(ctx, sim, ui, anchor, hue, panelLeft, dt, panelT) {
    const acts = actionsFor(sim, ui.selected);
    this.ringT = damp(this.ringT, ui.selected ? 1 : 0, 7, dt);
    this.ringNodes = [];
    if (!acts.length || this.ringT < 0.02) return;

    const n = acts.length;
    const big = ui.touch || ui.compact;
    const R = big ? 116 : 92;
    // fan away from the readout: sideways normally, down and to the
    // right on a phone, where the readout is pinned across the top
    const centre = ui.compact ? PI * 0.15 : (panelLeft ? 0 : PI);
    const spread = Math.min(2.0, 0.52 * (n - 1));
    ctx.save();
    for (let i = 0; i < n; i++) {
      const { def, ok, cool } = acts[i];
      const ang = centre + (n === 1 ? 0 : (i - (n - 1) / 2) * (spread / (n - 1)));
      const key = def.id;
      const stagger = clamp(remap(this.ringT, i * 0.07, i * 0.07 + 0.45, 0, 1));
      const g = easeBack(stagger) * this.ringT;
      const hov = ui.ringHover === i;
      let ht = this.nodeT.get(key) || 0;
      ht = damp(ht, hov ? 1 : 0, 12, dt);
      this.nodeT.set(key, ht);

      const rr2 = R * g * (1 + ht * 0.09);
      const x = anchor.x + Math.cos(ang) * rr2;
      const y = anchor.y + Math.sin(ang) * rr2 * 0.86;
      const rad = (big ? 22 : 17) + ht * 3.5;
      const live = ok && cool <= 0;
      this.ringNodes.push({ x, y, r: rad + (big ? 12 : 5), def, ok: live, index: i });
      if (g < 0.05) continue;

      // spoke
      ctx.strokeStyle = hsl(hue, 80, 68, 0.20 * g);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(anchor.x, anchor.y);
      ctx.lineTo(x - Math.cos(ang) * rad, y - Math.sin(ang) * rad * 0.86);
      ctx.stroke();

      // dial
      ctx.globalAlpha = g;
      ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU);
      ctx.fillStyle = live ? `rgba(8,20,28,${0.86 + ht * 0.1})` : 'rgba(8,14,20,0.6)';
      ctx.fill();
      ctx.strokeStyle = live ? hsl(hue, 85, 66, 0.55 + ht * 0.45) : 'rgba(120,145,165,0.28)';
      ctx.lineWidth = live ? 1.4 + ht : 1;
      ctx.stroke();
      if (live && ht > 0.01) {
        ctx.strokeStyle = hsl(hue, 90, 70, 0.28 * ht);
        ctx.lineWidth = 6 * ht; ctx.stroke();
      }
      // cooldown sweeps away
      if (cool > 0) {
        const frac = clamp(cool / def.cool);
        ctx.strokeStyle = 'rgba(255,170,80,0.75)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(x, y, rad + 3, -PI / 2, -PI / 2 + TAU * frac);
        ctx.stroke();
      }
      // glyph
      ctx.textAlign = 'center';
      ctx.font = `600 ${13 + ht * 2}px ${MONO}`;
      ctx.fillStyle = live ? (ht > 0.4 ? '#ffffff' : hsl(hue, 90, 78, 0.95)) : 'rgba(150,175,195,0.4)';
      ctx.fillText(def.glyph, x, y + 1);
      ctx.font = `600 8px ${MONO}`;
      ctx.fillStyle = live ? 'rgba(214,238,250,0.9)' : 'rgba(150,175,195,0.35)';
      ctx.fillText(def.label, x, y + rad + 11);
      ctx.globalAlpha = 1;
    }

    // what the hovered command will do to the city
    const hv = acts[ui.ringHover];
    if (hv && this.ringT > 0.6) {
      const node = this.ringNodes[ui.ringHover];
      const msg = hv.cool > 0 ? `recharging · ${hv.cool.toFixed(1)}s`
        : hv.ok ? hv.def.hint : 'not available here';
      ctx.textAlign = 'center';
      ctx.font = `500 9px ${MONO}`;
      const tw = ctx.measureText(msg).width + 18;
      // keep the caption on screen and clear of the readout
      let tx = clamp(node.x, tw / 2 + 8, this.W - tw / 2 - 8);
      if (this.panelBox) {
        const [bx, by, bw, bh] = this.panelBox;
        const ty0 = node.y + node.r + 16;
        if (tx + tw / 2 > bx && tx - tw / 2 < bx + bw && ty0 < by + bh && ty0 + 18 > by) {
          tx = Math.max(tw / 2 + 8, bx - tw / 2 - 10);
        }
      }
      const ty = node.y + node.r + 26;
      ctx.fillStyle = 'rgba(8,18,26,0.92)';
      roundRectPath(ctx, tx - tw / 2, ty - 10, tw, 18, 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(127,233,255,0.18)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = hv.cool > 0 ? 'rgba(255,180,110,0.95)'
        : hv.ok ? 'rgba(220,242,252,0.95)' : 'rgba(160,185,205,0.6)';
      ctx.fillText(msg, tx, ty);
    }
    ctx.restore();
  }

  projectReadout(ctx, sim, p, hue, w, h) {
    if (!p) return;
    const org = sim.org;
    const team = org.teams[p.team];
    ctx.font = `700 15px ${MONO}`;
    ctx.fillStyle = '#eefaff';
    ctx.fillText(p.name.toUpperCase(), 14, 24);
    ctx.font = `500 9px ${MONO}`;
    ctx.fillStyle = hsl(hue, 85, 72, 0.95);
    ctx.fillText(`${team.name.toUpperCase()} · STRUCTURE ${p.id}`, 14, 40);

    // milestone ladder — the floors of the building
    const lx = 20, ly = 58, step = Math.min(17, (h - 120) / p.milestones.length);
    ctx.font = `500 9px ${MONO}`;
    p.milestones.forEach((m, i) => {
      const y = ly + (p.milestones.length - 1 - i) * step;
      ctx.fillStyle = m.done ? hsl(hue, 85, 62, 0.95) : 'rgba(255,255,255,0.12)';
      ctx.fillRect(lx, y, 42, step * 0.55);
      ctx.fillStyle = m.done ? 'rgba(230,248,255,0.92)' : 'rgba(170,200,220,0.45)';
      ctx.fillText(m.name.toUpperCase(), lx + 50, y + step * 0.3);
      if (m.done) {
        ctx.fillStyle = hsl(hue, 90, 70, 0.9);
        ctx.fillText('▮', lx + 128, y + step * 0.3);
      }
    });

    // task swarm: one dot per task, placed by state, never a list
    const sx = 200, sy2 = 74, rad = 44;
    const tasks = p.tasks.map((id) => org.byId[id]).filter(Boolean);
    ctx.save();
    ctx.translate(sx + 46, sy2 + 30);
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    [0.45, 0.72, 1].forEach((r) => { ctx.beginPath(); ctx.arc(0, 0, rad * r, 0, TAU); ctx.stroke(); });
    tasks.forEach((t, i) => {
      const ring = t.state === ST.DONE ? 0.45 : t.state === ST.BLOCKED ? 1 : 0.72;
      const a = (i / Math.max(1, tasks.length)) * TAU + sim.time * (t.state === ST.BLOCKED ? 0.05 : 0.22) * (ring);
      const x = Math.cos(a) * rad * ring, y = Math.sin(a) * rad * ring;
      const col = t.state === ST.BLOCKED ? '#ff6a4a' : t.state === ST.DONE ? '#8fe9c0' :
        t.state === ST.REVIEW ? '#b78cff' : t.state === ST.INBOUND ? '#7fe9ff' : hsl(hue, 85, 70);
      ctx.fillStyle = col;
      const r = 1.8 + t.mass * 0.5;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      if (t.state === ST.BLOCKED) {
        ctx.strokeStyle = 'rgba(255,106,74,0.5)';
        ctx.beginPath(); ctx.arc(x, y, r + 3 + Math.sin(sim.time * 4 + i) * 1.5, 0, TAU); ctx.stroke();
      }
    });
    ctx.restore();

    // deadline + risk
    const by = h - 46;
    const left = p.deadlineDay - org.day;
    ctx.font = `500 9px ${MONO}`;
    ctx.fillStyle = 'rgba(170,205,225,0.7)';
    ctx.fillText('DEADLINE', 14, by - 12);
    ctx.fillText('LOAD', 160, by - 12);
    const bw = 128;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(14, by - 4, bw, 5);
    const frac = clamp(1 - left / 46);
    ctx.fillStyle = left < 0 ? '#ff5a3c' : left < 6 ? '#ffb347' : hsl(hue, 85, 60);
    ctx.fillRect(14, by - 4, bw * frac, 5);
    ctx.fillStyle = left < 0 ? '#ff8a6a' : '#dff2ff';
    ctx.font = `700 11px ${MONO}`;
    ctx.fillText(left < 0 ? `${Math.abs(left).toFixed(1)}d OVER` : `${left.toFixed(1)}d`, 14, by + 16);
    // risk arc
    ctx.save();
    ctx.translate(200, by - 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(0, 0, 14, PI, TAU); ctx.stroke();
    ctx.strokeStyle = hsl(lerp(150, 2, clamp(p.risk)), 90, 58, 1);
    ctx.beginPath(); ctx.arc(0, 0, 14, PI, PI + PI * clamp(p.risk), false); ctx.stroke();
    ctx.restore();
    ctx.font = `700 11px ${MONO}`;
    ctx.fillStyle = '#dff2ff';
    ctx.fillText(`${(p.progress * 100) | 0}%`, 232, by + 2);
    ctx.font = `500 8px ${MONO}`;
    ctx.fillStyle = 'rgba(170,205,225,0.6)';
    ctx.fillText(`${p.activeCount} moving · ${p.blocked} stalled`, 160, by + 16);
    if (p.wip > 0) {
      ctx.fillStyle = p.atLimit ? 'rgba(255,194,77,0.95)' : 'rgba(150,215,255,0.8)';
      ctx.fillText(`WIP ${p.activeCount}/${p.wip}${p.queued ? ` · ${p.queued} waiting` : ''}`, 160, by + 26);
    }
    if (p.incident) {
      ctx.font = `700 10px ${MONO}`;
      ctx.fillStyle = `rgba(255,100,70,${0.65 + 0.35 * Math.sin(sim.time * 5)})`;
      ctx.fillText('⚠ STRUCTURE DOWN', 14, by - 26);
    }
  }

  taskReadout(ctx, sim, t, hue, w, h) {
    if (!t) return;
    const org = sim.org;
    const p = org.byId[t.project];
    const col = t.state === ST.BLOCKED ? '#ff6a4a' : t.state === ST.REVIEW ? '#b78cff' :
      t.state === ST.INBOUND ? '#7fe9ff' : hsl(hue, 85, 70);
    ctx.font = `700 13px ${MONO}`;
    ctx.fillStyle = '#eefaff';
    const title = t.title.length > 26 ? t.title.slice(0, 25) + '…' : t.title;
    ctx.fillText(title.toUpperCase(), 14, 24);
    ctx.font = `500 9px ${MONO}`;
    ctx.fillStyle = hsl(hue, 85, 72, 0.9);
    ctx.fillText(`${p ? p.name.toUpperCase() : ''} · ${org.teams[t.team].tag}`, 14, 40);

    // carrier + mass
    ctx.fillStyle = 'rgba(180,215,235,0.85)';
    ctx.fillText(`CARRIED BY  ${t.ownerName.toUpperCase()}`, 14, 62);
    ctx.fillText(`MASS ${t.size} · ${t.hours}h · ${t.kind.toUpperCase()}`, 14, 76);

    // progress arc
    ctx.save();
    ctx.translate(w - 56, 62);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(0, 0, 22, 0, TAU); ctx.stroke();
    ctx.strokeStyle = col; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, 0, 22, -PI / 2, -PI / 2 + TAU * clamp(t.done)); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.font = `700 12px ${MONO}`; ctx.fillStyle = '#eefaff';
    ctx.fillText(`${(t.done * 100) | 0}`, 0, 1);
    ctx.textAlign = 'left';
    ctx.restore();

    // state + blocker
    ctx.font = `700 11px ${MONO}`;
    ctx.fillStyle = col;
    ctx.fillText(t.state.toUpperCase(), 14, 100);
    if (t.state === ST.BLOCKED && t.blockedBy) {
      const bp = org.byId[t.blockedBy];
      ctx.font = `500 9px ${MONO}`;
      ctx.fillStyle = 'rgba(255,150,120,0.9)';
      ctx.fillText(`WAITING ON ${bp.name.toUpperCase()}`, 14, 114);
      // the dependency drawn as a road
      ctx.strokeStyle = 'rgba(255,106,74,0.6)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.lineDashOffset = -(sim.time * 20) % 8;
      ctx.beginPath(); ctx.moveTo(14, 124); ctx.lineTo(w - 20, 124); ctx.stroke();
      ctx.setLineDash([]);
    }

    // history ticks — momentum over time
    ctx.font = `500 8px ${MONO}`;
    ctx.fillStyle = 'rgba(170,205,225,0.6)';
    ctx.fillText('HISTORY', 14, h - 52);
    const logs = t.log.slice(-4);
    logs.forEach((l, i) => {
      const y = h - 40 + i * 11;
      ctx.fillStyle = hsl(hue, 80, 65, 0.8);
      ctx.fillRect(14, y - 3, 3, 3);
      ctx.fillStyle = 'rgba(210,232,245,0.8)';
      ctx.fillText(`D${l.day.toFixed(1)}  ${l.text}`, 24, y);
    });
  }

  teamReadout(ctx, sim, d, hue, w, h) {
    const org = sim.org;
    const team = org.teams[d.team];
    const projects = team.projects.map((id) => org.byId[id]);
    ctx.font = `700 15px ${MONO}`;
    ctx.fillStyle = '#eefaff';
    ctx.fillText(team.name.toUpperCase(), 14, 24);
    ctx.font = `500 9px ${MONO}`;
    ctx.fillStyle = hsl(hue, 85, 72, 0.9);
    ctx.fillText(`${team.people.length} RESIDENTS · ${projects.length} STRUCTURES`, 14, 40);
    // skyline: each project as a bar of its own height
    const bx = 16, by = h - 60, bw = (w - 40) / projects.length;
    projects.forEach((p, i) => {
      const bh = 8 + p.progress * 70;
      const x = bx + i * bw;
      ctx.fillStyle = hsl(hue, 80, lerp(30, 62, p.progress), 0.9);
      ctx.fillRect(x, by - bh, bw - 5, bh);
      if (p.blocked) {
        ctx.fillStyle = '#ff6a4a';
        ctx.fillRect(x, by - bh - 6, bw - 5, 3);
      }
      ctx.save();
      ctx.translate(x + bw / 2 - 2, by + 8);
      ctx.rotate(-PI / 3);
      ctx.font = `500 8px ${MONO}`;
      ctx.fillStyle = 'rgba(200,225,240,0.7)';
      ctx.fillText(p.name.slice(0, 12), 0, 0);
      ctx.restore();
    });
    ctx.font = `500 9px ${MONO}`;
    ctx.fillStyle = 'rgba(180,215,235,0.8)';
    ctx.fillText(`LOAD ${Math.min(100, (d.pressure * 100) | 0)}%   STORM ${Math.min(100, (d.storm * 100) | 0)}%`, 14, h - 26);
    // morale
    const mor = team.morale;
    ctx.fillStyle = 'rgba(180,215,235,0.8)';
    ctx.fillText('MORALE', 14, h - 12);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(66, h - 16, 120, 5);
    ctx.fillStyle = mor < 0.35 ? '#ff5a3c' : mor < 0.6 ? '#ffb347' : '#8fe9c0';
    ctx.fillRect(66, h - 16, 120 * clamp(mor), 5);
    ctx.fillStyle = mor < 0.35 ? '#ff8a6a' : '#dff2ff';
    ctx.font = `700 9px ${MONO}`;
    ctx.fillText(`${(mor * 100) | 0}%`, 194, h - 12);
    if (mor < 0.34) {
      ctx.font = `500 8px ${MONO}`;
      ctx.fillStyle = 'rgba(255,140,110,0.9)';
      ctx.fillText('people are leaving', 232, h - 12);
    }
  }

  /* ---- event ticker ------------------------------------- */
  ticker(ctx, sim, cam, ui) {
    if (ui.compact) return;                    // no room for a feed on a phone
    const x = 24, y0 = 128;
    const dim = (1 - (ui.tour ? ui.tour.fade : 0) * 0.9) * (1 - (ui.guide ? ui.guide.fade : 0));
    if (dim < 0.02) return;
    ctx.save();
    ctx.globalAlpha = easeOut(this.boot) * 0.95 * dim;
    ctx.textAlign = 'left';
    ctx.font = `500 9px ${MONO}`;
    ctx.fillStyle = 'rgba(150,195,220,0.55)';
    ctx.fillText('SIGNAL', x, y0 - 12);
    const list = sim.narration.slice(0, 9);
    list.forEach((n, i) => {
      const age = sim.time - n.t;
      const a = clamp(1 - i / 9) * clamp(remap(age, 22, 26, 1, 0));
      if (a <= 0) return;
      const y = y0 + i * 14;
      ctx.fillStyle = hsl(n.hue, 85, 68, a);
      if (n.player) {
        ctx.fillRect(x - 1, y - 4, 5, 5);
        ctx.fillStyle = `rgba(255,214,140,${a})`;
        ctx.fillText('▸ ' + (n.text.length > 42 ? n.text.slice(0, 41) + '…' : n.text), x + 10, y);
      } else {
        ctx.fillRect(x, y - 3, 3, 3);
        ctx.fillStyle = `rgba(215,236,248,${a * 0.92})`;
        ctx.fillText(n.text.length > 44 ? n.text.slice(0, 43) + '…' : n.text, x + 10, y);
      }
    });
    ctx.restore();
  }

  wrap(ctx, text, maxW) {
    const words = String(text).split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  /* the walkthrough: a card that explains what you are looking at */
  guideCard(ctx, sim, cam, ui) {
    const g = ui.guide;
    if (!g || g.fade < 0.02) { if (g) g.buttons = []; return; }
    const a = easeOut(g.fade);
    const W = cam.W, H = cam.H;
    const touch = ui.touch;
    ctx.save();
    ctx.globalAlpha = a;

    // letterbox, so it reads as a set piece rather than a popup
    const bar = 40 * a;
    ctx.fillStyle = 'rgba(2,7,12,0.96)';
    ctx.fillRect(0, 0, W, bar);
    ctx.strokeStyle = 'rgba(127,233,255,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, bar + 0.5); ctx.lineTo(W, bar + 0.5); ctx.stroke();
    ctx.textAlign = 'left';
    ctx.font = `600 ${touch ? 11 : 9}px ${MONO}`;
    ctx.fillStyle = CY;
    ctx.fillText(`WALKTHROUGH  ${g.step + 1} / ${BEATS.length}`, 24, bar * 0.5);
    // progress pips
    for (let i = 0; i < BEATS.length; i++) {
      const px = 190 + i * 14;
      ctx.fillStyle = i <= g.step ? CY : 'rgba(140,190,215,0.28)';
      ctx.fillRect(px, bar * 0.5 - 1.5, 9, 3);
    }

    /* the card */
    const cw = Math.min(touch ? W - 32 : 560, W - 48);
    const pad = touch ? 20 : 22;
    ctx.font = `500 ${touch ? 13 : 11.5}px ${MONO}`;
    const lines = this.wrap(ctx, g.body || '', cw - pad * 2);
    const lineH = touch ? 20 : 17;
    const ch = pad + (touch ? 22 : 19) + 10 + lines.length * lineH + pad + 30;
    const cx = W / 2 - cw / 2;
    const cy = H - ch - (touch ? 26 : 34);

    roundRectPath(ctx, cx, cy, cw, ch, 3);
    ctx.fillStyle = 'rgba(6,16,24,0.94)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(127,233,255,0.42)';
    ctx.lineWidth = 1; ctx.stroke();
    // corner brackets
    ctx.strokeStyle = CY; ctx.lineWidth = 2;
    const L = 16;
    ctx.beginPath();
    ctx.moveTo(cx, cy + L); ctx.lineTo(cx, cy); ctx.lineTo(cx + L, cy);
    ctx.moveTo(cx + cw - L, cy + ch); ctx.lineTo(cx + cw, cy + ch); ctx.lineTo(cx + cw, cy + ch - L);
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.font = `700 ${touch ? 15 : 13}px ${MONO}`;
    ctx.fillStyle = '#eaf8ff';
    ctx.fillText(g.title || '', cx + pad, cy + pad + (touch ? 8 : 6));
    ctx.font = `500 ${touch ? 13 : 11.5}px ${MONO}`;
    ctx.fillStyle = 'rgba(205,232,246,0.9)';
    lines.forEach((ln, i) => {
      ctx.fillText(ln, cx + pad, cy + pad + (touch ? 34 : 30) + i * lineH);
    });

    /* buttons */
    g.buttons = [];
    const by = cy + ch - (touch ? 26 : 24);
    const mk = (label, action, x, primary) => {
      ctx.font = `600 ${touch ? 12 : 10}px ${MONO}`;
      const w = ctx.measureText(label).width + (touch ? 30 : 24);
      const h = touch ? 30 : 24;
      const bx = x - w;
      roundRectPath(ctx, bx, by - h / 2, w, h, 2);
      ctx.fillStyle = primary ? 'rgba(127,233,255,0.92)' : 'rgba(255,255,255,0.06)';
      ctx.fill();
      if (!primary) { ctx.strokeStyle = 'rgba(150,200,225,0.4)'; ctx.lineWidth = 1; ctx.stroke(); }
      ctx.fillStyle = primary ? '#04121a' : 'rgba(200,228,244,0.9)';
      ctx.textAlign = 'center';
      ctx.fillText(label, bx + w / 2, by);
      ctx.textAlign = 'left';
      g.buttons.push({ x: bx, y: by - h / 2, w, h, action });
      return bx - 10;
    };
    let x = cx + cw - pad;
    if (g.waiting) {
      const puls = 0.55 + 0.45 * Math.sin(sim.time * 4);
      ctx.font = `700 ${touch ? 12 : 10}px ${MONO}`;
      ctx.fillStyle = `rgba(255,194,77,${puls})`;
      ctx.fillText('◉ WAITING FOR YOU', cx + pad, by);
      x = mk('SKIP THIS', 'next', x, false);
    } else {
      x = mk('NEXT ›', 'next', x, true);
    }
    mk('SKIP TOUR', 'skip', x, false);
    ctx.restore();
  }

  /* armed to lay a road: a line follows the cursor */
  linkMode(ctx, sim, cam, ui) {
    if (!sim.linkFrom) return;
    const b = sim.city.byProject[sim.linkFrom];
    if (!b) return;
    const p = cam.proj(b.x, b.y, buildingHeight(b) * 0.6, {});
    const m = ui.mouse || { x: cam.W / 2, y: cam.H / 2 };
    const puls = 0.6 + 0.4 * Math.sin(sim.time * 5);
    ctx.save();
    ctx.setLineDash([7, 6]);
    ctx.lineDashOffset = -(sim.time * 30) % 13;
    ctx.strokeStyle = `rgba(255,190,70,${0.55 + puls * 0.4})`;
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(m.x, m.y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, TAU);
    ctx.fillStyle = 'rgba(255,190,70,0.95)'; ctx.fill();
    ctx.beginPath(); ctx.arc(m.x, m.y, 9 + puls * 3, 0, TAU);
    ctx.strokeStyle = `rgba(255,190,70,${0.5 + puls * 0.4})`;
    ctx.lineWidth = 1.4; ctx.stroke();

    const label = 'PICK THE STRUCTURE IT WAITS ON  ·  ESC TO CANCEL';
    ctx.textAlign = 'center';
    ctx.font = `600 10px ${MONO}`;
    const w = ctx.measureText(label).width + 26;
    const bx = clamp(m.x, w / 2 + 10, cam.W - w / 2 - 10), by = m.y + 30;
    ctx.fillStyle = 'rgba(8,18,26,0.92)';
    roundRectPath(ctx, bx - w / 2, by - 10, w, 20, 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,190,70,0.4)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#ffd280';
    ctx.fillText(label, bx, by);
    ctx.restore();
  }

  /* the city narrating itself while nobody is driving */
  tourCaption(ctx, sim, cam, ui) {
    const t = ui.tour;
    if (!t || t.fade < 0.02) return;
    const a = easeOut(t.fade);
    const W = cam.W, H = cam.H;
    ctx.save();
    ctx.globalAlpha = a;
    // a letterbox to say plainly that this is not you driving
    const bar = 46 * a;
    ctx.fillStyle = 'rgba(2,7,12,0.96)';
    ctx.fillRect(0, 0, W, bar);
    ctx.fillRect(0, H - bar, W, bar);
    ctx.strokeStyle = 'rgba(127,233,255,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, bar + 0.5); ctx.lineTo(W, bar + 0.5);
    ctx.moveTo(0, H - bar - 0.5); ctx.lineTo(W, H - bar - 0.5);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.font = `700 17px ${MONO}`;
    ctx.fillStyle = '#eaf8ff';
    ctx.fillText(t.caption || '', W / 2, H - bar * 0.62);
    ctx.font = `500 10px ${MONO}`;
    ctx.fillStyle = 'rgba(170,210,232,0.85)';
    ctx.fillText(t.sub || '', W / 2, H - bar * 0.28);

    ctx.textAlign = 'left';
    ctx.font = `600 9px ${MONO}`;
    ctx.fillStyle = CY;
    const dot = 0.5 + 0.5 * Math.sin(sim.time * 3);
    ctx.globalAlpha = a * (0.5 + dot * 0.5);
    ctx.fillText('◉ TOURING', 24, bar * 0.5);
    ctx.globalAlpha = a;
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(160,200,225,0.7)';
    ctx.fillText('MOVE THE MOUSE TO TAKE OVER', W - 24, bar * 0.5);
    ctx.restore();
  }

  /* something is down — you should not be able to miss it */
  incidents(ctx, sim, cam, ui) {
    const list = sim.org.incidents;
    if (!list.length) return;
    const W = cam.W, H = cam.H;
    const puls = 0.55 + 0.45 * Math.sin(sim.time * 4.5);
    list.forEach((inc, i) => {
      const b = sim.city.byProject[inc.project];
      if (!b) return;
      const left = clamp(1 - inc.t / inc.limit);
      // banner
      const bw = 300, bx = W / 2 - bw / 2, by = 62 + i * 40;
      ctx.save();
      roundRectPath(ctx, bx, by, bw, 30, 2);
      ctx.fillStyle = `rgba(40,8,8,${0.72 + puls * 0.12})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(255,90,60,${0.5 + puls * 0.45})`;
      ctx.lineWidth = 1.4; ctx.stroke();
      ctx.textAlign = 'left';
      ctx.font = `700 11px ${MONO}`;
      ctx.fillStyle = `rgba(255,140,110,${0.8 + puls * 0.2})`;
      ctx.fillText('⚠', bx + 12, by + 13);
      ctx.fillStyle = '#ffe4dc';
      ctx.fillText(`${inc.name.toUpperCase()} DOWN`, bx + 30, by + 13);
      ctx.font = `500 8px ${MONO}`;
      ctx.fillStyle = 'rgba(255,190,175,0.75)';
      ctx.fillText(`${sim.org.teams[inc.team].name} · select it and RESPOND`, bx + 30, by + 24);
      // how long you have
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(bx + 1, by + 28, bw - 2, 2);
      ctx.fillStyle = left < 0.3 ? '#ff4a2a' : '#ff9a6a';
      ctx.fillRect(bx + 1, by + 28, (bw - 2) * left, 2);
      ctx.restore();

      // an arrow at the edge if it is not on screen
      const p = cam.proj(b.x, b.y, buildingHeight(b) * 0.6, {});
      const m = 60;
      if (p.x > m && p.x < W - m && p.y > m && p.y < H - m) return;
      const cx = W / 2, cy = H / 2;
      const ang = Math.atan2(p.y - cy, p.x - cx);
      const rx = W / 2 - 54, ry = H / 2 - 54;
      const ex = cx + Math.cos(ang) * Math.min(rx, Math.abs(rx / Math.cos(ang)) || rx);
      const ey = cy + Math.sin(ang) * Math.min(ry, Math.abs(ry / Math.sin(ang)) || ry);
      ctx.save();
      ctx.translate(clamp(ex, 40, W - 40), clamp(ey, 40, H - 40));
      ctx.rotate(ang);
      ctx.fillStyle = `rgba(255,80,55,${0.6 + puls * 0.4})`;
      ctx.beginPath();
      ctx.moveTo(16, 0); ctx.lineTo(-8, -9); ctx.lineTo(-3, 0); ctx.lineTo(-8, 9);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    });
  }

  /* one nudge on arrival, then it gets out of the way for good */
  firstHint(ctx, sim, cam, ui) {
    if (ui.help || this.hintDone) return;
    const t = sim.time;
    const a = clamp(remap(t, 2.2, 3.6, 0, 1)) * clamp(remap(t, 13, 16, 1, 0));
    if (t > 16) { this.hintDone = true; return; }
    if (a <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.font = `500 11px ${MONO}`;
    const y = cam.H - 46;
    ctx.fillStyle = 'rgba(190,225,242,0.85)';
    ctx.fillText('SIX NEIGHBOURHOODS · TWENTY-FIVE STRUCTURES · EVERY VEHICLE IS A TASK', cam.W / 2, y - 16);
    ctx.font = `600 11px ${MONO}`;
    ctx.fillStyle = CY;
    ctx.fillText('SCROLL TO DESCEND  ·  CLICK ANYTHING TO COMMAND IT  ·  H FOR THE LEGEND', cam.W / 2, y + 2);
    const w = 430;
    ctx.strokeStyle = `rgba(127,233,255,${0.25 * a})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cam.W / 2 - w / 2, y + 14); ctx.lineTo(cam.W / 2 + w / 2, y + 14);
    ctx.stroke();
    ctx.restore();
  }

  helpCard(ctx, cam) {
    const w = 440, h = 320, x = cam.W / 2 - w / 2, y = cam.H / 2 - h / 2;
    ctx.save();
    roundRectPath(ctx, x, y, w, h, 4);
    ctx.fillStyle = 'rgba(6,14,22,0.92)'; ctx.fill();
    ctx.strokeStyle = 'rgba(127,233,255,0.5)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.textAlign = 'left';
    ctx.font = `700 14px ${MONO}`; ctx.fillStyle = '#eefaff';
    ctx.fillText('READING THE CITY', x + 22, y + 30);
    ctx.font = `500 10px ${MONO}`;
    const rows = [
      ['BUILDING', 'a project. floors = milestones shipped.'],
      ['LIT WINDOWS', 'progress. dark towers are stalled work.'],
      ['PEOPLE / VANS', 'tasks in motion. size = estimate.'],
      ['ROADS', 'dependencies between projects.'],
      ['RED TRAFFIC', 'blocked work. jams spread down the road.'],
      ['NEIGHBOURHOOD', 'a team. haze = deadline pressure.'],
      ['STORMS', 'deadlines closing in on that district.'],
      ['RISING LIGHT', 'finished work flying to the core.'],
      ['', ''],
      ['SELECT ANYTHING', 'commands orbit it. click one to act.'],
      ['▲ SHIP  ⇢ SURGE', 'add a floor · call in more work'],
      ['⊘ CLEAR  ⏵ EXPEDITE', 'drain a jam · push a task through'],
      ['❖ ALL HANDS  ◈ CRUNCH', 'clear a district · drive it harder'],
      ['', ''],
      ['DRAG / SCROLL', 'move · change altitude'],
      ['SHIFT+DRAG / Q E', 'rotate the city'],
      ['CLICK / ESC', 'descend into · ascend out of'],
      ['F', 'lock the camera onto a moving task'],
      ['SPACE / 1-5', 'hold time · jump to an altitude'],
      ['G / I', 'replay the walkthrough · load your own work'],
    ];
    rows.forEach(([k, v], i) => {
      const yy = y + 54 + i * 13.5;
      ctx.fillStyle = 'rgba(127,233,255,0.9)';
      ctx.fillText(k, x + 22, yy);
      ctx.fillStyle = 'rgba(205,228,242,0.8)';
      ctx.fillText(v, x + 150, yy);
    });
    ctx.font = `500 9px ${MONO}`;
    ctx.fillStyle = 'rgba(160,200,225,0.6)';
    ctx.fillText('H to close', x + 22, y + h - 14);
    ctx.restore();
  }

  bootMask(ctx, cam) {
    const t = easeOut(this.boot);
    ctx.save();
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = '#02060c';
    ctx.fillRect(0, 0, cam.W, cam.H);
    ctx.globalAlpha = clamp((1 - t) * 1.6);
    ctx.textAlign = 'center';
    ctx.font = `600 12px ${MONO}`;
    ctx.fillStyle = CY;
    ctx.fillText('SURVEYING TERRAIN · LAYING ROADS · RAISING STRUCTURES', cam.W / 2, cam.H / 2);
    ctx.restore();
  }
}
