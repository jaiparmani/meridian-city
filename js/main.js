/* ============================================================
   main.js — boot, camera control, picking, navigation.
   ============================================================ */
'use strict';

const canvas = document.getElementById('city');
/* these are rebindable: the city can be torn down and rebuilt from new data */
let org = buildOrg();
let city = buildCity(org);
let sim = new Sim(org, city);
sim.city = city;
const cam = new Camera();
const R = new Renderer(canvas);
const hud = new HUD();

const ui = {
  selected: null, hover: null, focusTeam: null,
  help: false, paused: false, hotDeps: null, level: LOD.ORG,
  ringHover: -1,
};

/* structures rise out of the ground on a wave from downtown */
function seedGrowth(c) {
  c.buildings.forEach((b) => {
    b.delay = 0.55 + dist(b.x, b.y, 0, 0) / 620 * 1.5 + rnd() * 0.35;
    b.floors = 0.02;
  });
}
seedGrowth(city);

/* tear the city down and raise a new one from a different organisation */
function rebuildFrom(newOrg, label) {
  org = newOrg;
  city = buildCity(org);
  sim = new Sim(org, city);
  sim.city = city;
  seedGrowth(city);
  ui.selected = null; ui.hover = null; ui.focusTeam = null;
  ui.hotDeps = null; ui.ringHover = -1; ui.linkFrom = null;
  hud.labels.clear();
  hud.ringNodes = [];
  hud.panelBox = null;
  hud.panelT = 0;
  hud.boot = 0;
  hud.hintDone = true;
  cam.follow = null;
  cam.s = 0.18; cam.ts = 0.95;
  cam.x = cam.tx = 0; cam.y = cam.ty = 30;
  cam.radiusHint = city.radius * 1.6;
  tour.stop();
  Object.assign(window.APP, { org, city, sim });
  if (label) sim.say(label, 190, true);
  return { projects: org.projects.length, tasks: org.tasks.length, teams: org.teams.length };
}
const _stepBuildings = Sim.prototype.stepBuildings;
Sim.prototype.stepBuildings = function (dt) {
  for (const b of this.city.buildings) {
    if (this.time < b.delay) { b.floors = 0.02; b.hold = true; }
    else if (b.hold) {
      b.hold = false;
      this.ring(b.x, b.y, 0, Math.max(b.w, b.d) * 2, b.hue, 0.5);
      for (let i = 0; i < 8; i++) {
        const a = rnd() * TAU, sp = rr(4, 14);
        this.fx.push({ type: 'dust', x: b.x, y: b.y, z: 0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: rr(3, 9), life: 0, max: rr(0.8, 1.8), r: rr(2, 5), hue: b.hue });
      }
    }
  }
  _stepBuildings.call(this, dt);
  for (const b of this.city.buildings) if (b.hold) b.floors = 0.02;
};

/* ---------- sizing --------------------------------------- */
let DPR = 1;
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  const w = window.innerWidth, h = window.innerHeight;
  canvas.width = Math.floor(w * DPR); canvas.height = Math.floor(h * DPR);
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  R.ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  cam.resize(w, h);
}
window.addEventListener('resize', resize);
resize();

/* ---------- camera intro --------------------------------- */
cam.x = cam.tx = 0; cam.y = cam.ty = 30;
cam.s = 0.18; cam.ts = 0.95;
cam.yaw = -1.15; cam.tyaw = -0.52;
cam.radiusHint = city.radius * 1.6;

/* ---------- input ---------------------------------------- */
let drag = null, zoomAnchor = null, lastMouse = { x: 0, y: 0 }, moved = 0;

function inIntake(mx, my) {
  const b = hud.intakeBox;
  return b && mx >= b[0] && mx <= b[0] + b[2] && my >= b[1] && my <= b[1] + b[3];
}
function setIntakeFrom(mx) {
  const b = hud.intakeBox;
  if (!b) return;
  org.intake = clamp((mx - (b[0] + 6)) / (b[2] - 12), 0, 1) * 2;
}

canvas.addEventListener('mousedown', (e) => {
  tour.poke();
  if (inIntake(e.clientX, e.clientY)) {
    drag = { intake: true };
    setIntakeFrom(e.clientX);
    return;
  }
  drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, rot: e.shiftKey || e.button === 2, t: performance.now() };
  moved = 0;
  zoomAnchor = null;
  canvas.style.cursor = 'grabbing';
});
window.addEventListener('mousemove', (e) => {
  if (Math.abs(e.clientX - lastMouse.x) + Math.abs(e.clientY - lastMouse.y) > 3) tour.poke();
  lastMouse.x = e.clientX; lastMouse.y = e.clientY;
  ui.mouse = lastMouse;
  if (drag && drag.intake) { setIntakeFrom(e.clientX); return; }
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    moved += Math.abs(dx) + Math.abs(dy);
    if (drag.rot) {
      cam.tyaw -= dx * 0.006;
    } else {
      const k = 1 / cam.s;
      const wx = dx * k, wy = (dy * k) / PITCH;
      const c = Math.cos(-cam.yaw), s = Math.sin(-cam.yaw);
      cam.tx -= wx * c - wy * s;
      cam.ty -= wx * s + wy * c;
      cam.follow = null;
      cam.vx = -(wx * c - wy * s); cam.vy = -(wx * s + wy * c);
    }
    drag.x = e.clientX; drag.y = e.clientY;
  } else {
    if (inIntake(e.clientX, e.clientY)) {
      ui.hover = null; ui.ringHover = -1;
      canvas.style.cursor = 'ew-resize';
      return;
    }
    const node = ringAt(e.clientX, e.clientY);
    ui.ringHover = node ? node.index : -1;
    if (node) { ui.hover = null; canvas.style.cursor = node.ok ? 'pointer' : 'not-allowed'; return; }
    ui.hover = pickAt(e.clientX, e.clientY);
    canvas.style.cursor = ui.hover ? 'crosshair' : 'grab';
  }
});
window.addEventListener('mouseup', (e) => {
  if (drag && drag.intake) { drag = null; return; }
  if (drag) {
    if (moved < 5) click(e.clientX, e.clientY, drag.rot);
    else { // throw the camera a little
      cam.tx += cam.vx * 6; cam.ty += cam.vy * 6;
    }
  }
  drag = null; canvas.style.cursor = 'grab';
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('dblclick', (e) => {
  if (ringAt(e.clientX, e.clientY)) return;
  descend(e.clientX, e.clientY);
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  tour.poke();
  const k = Math.exp(-e.deltaY * 0.0016);
  cam.ts = clamp(cam.ts * k, 0.22, 34);
  // keep the original anchor while the cursor stays put, so repeated
  // ticks zoom into exactly the same point instead of creeping
  if (!zoomAnchor || Math.hypot(zoomAnchor.sx - e.clientX, zoomAnchor.sy - e.clientY) > 4) {
    zoomAnchor = { sx: e.clientX, sy: e.clientY, w: cam.unproj(e.clientX, e.clientY), t: 1.8 };
  } else zoomAnchor.t = 1.8;
  cam.follow = null;
}, { passive: false });

/* touch: one finger orbits, two fingers zoom */
let touch = null;
canvas.addEventListener('touchstart', (e) => {
  tour.poke();
  if (e.touches.length === 1) touch = { x: e.touches[0].clientX, y: e.touches[0].clientY, d: 0 };
  else if (e.touches.length === 2) {
    const [a, b] = e.touches;
    touch = { pinch: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
  }
}, { passive: false });
canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (!touch) return;
  if (e.touches.length === 1) {
    const dx = e.touches[0].clientX - touch.x, dy = e.touches[0].clientY - touch.y;
    const k = 1 / cam.s, wx = dx * k, wy = (dy * k) / PITCH;
    const c = Math.cos(-cam.yaw), s = Math.sin(-cam.yaw);
    cam.tx -= wx * c - wy * s; cam.ty -= wx * s + wy * c;
    touch.x = e.touches[0].clientX; touch.y = e.touches[0].clientY;
    cam.follow = null;
  } else if (e.touches.length === 2 && touch.pinch) {
    const [a, b] = e.touches;
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    cam.ts = clamp(cam.ts * (d / touch.pinch), 0.22, 34);
    touch.pinch = d;
  }
}, { passive: false });
canvas.addEventListener('touchend', () => { touch = null; });

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  tour.poke();
  if (ui.loader && k !== 'escape' && k !== 'i') return;
  if (k === 'i') { openLoader(); return; }
  if (k === 'escape') {
    if (ui.loader) { openLoader(false); return; }
    if (sim.linkFrom) { sim.linkFrom = null; sim.say('road cancelled', 200, true); return; }
    ascend();
  }
  else if (k === 'h') ui.help = !ui.help;
  else if (k === ' ') { e.preventDefault(); ui.paused = !ui.paused; }
  else if (k === 'q') cam.tyaw += 0.22;
  else if (k === 'e') cam.tyaw -= 0.22;
  else if (k === 'f') toggleFollow();
  else if (k === 'r') { cam.tyaw = -0.52; }
  else if (k >= '1' && k <= '5') gotoLevel(+k - 1);
  else if (k === '[') org.intake = clamp(org.intake - 0.2, 0, 2);
  else if (k === ']') org.intake = clamp(org.intake + 0.2, 0, 2);
  else if (k === '+' || k === '=') cam.ts = clamp(cam.ts * 1.35, 0.22, 34);
  else if (k === '-') cam.ts = clamp(cam.ts / 1.35, 0.22, 34);
});

/* ---------- picking -------------------------------------- */
function pointInQuad(px, py, q) {
  return pointInPoly(px, py, q.map((p) => [p.x, p.y]));
}
function pickAt(mx, my) {
  const lod = lodOf(cam.s);
  // agents first when we're low enough to see them
  if (lod >= LOD.PROJECT) {
    let best = null, bd = (lod >= LOD.TASK ? 18 : 10) ** 2;
    for (const a of sim.agents) {
      if (a.dead || a.resident) continue;
      const p = cam.proj(a.x, a.y, 1.5, {});
      const d = dist2(p.x, p.y, mx, my);
      if (d < bd) { bd = d; best = a; }
    }
    if (best) return { type: 'task', id: best.task.id, obj: best };
  }
  // buildings, front to back
  const bs = city.buildings.slice().sort((a, b) => cam.depth(b.x, b.y) - cam.depth(a.x, a.y));
  for (const b of bs) {
    if (!b._screen) continue;
    const { base, tops } = b._screen;
    if (pointInQuad(mx, my, tops)) return { type: 'project', id: b.project, obj: b };
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      if (pointInQuad(mx, my, [base[i], base[j], tops[j], tops[i]])) return { type: 'project', id: b.project, obj: b };
    }
  }
  // ground -> district
  const w = cam.unproj(mx, my);
  for (const d of city.districts) {
    if (pointInPoly(w.x, w.y, d.poly)) return { type: 'team', id: d.team, obj: d };
  }
  return null;
}

/* the command ring sits on top of the world */
function ringAt(mx, my) {
  for (const n of hud.ringNodes) {
    if (dist2(n.x, n.y, mx, my) < n.r * n.r) return n;
  }
  return null;
}

function click(mx, my, wasRot) {
  if (wasRot) return;
  const node = ringAt(mx, my);
  if (node) {
    if (runAction(sim, ui.selected, node.def)) cam.shake = Math.max(cam.shake, 0.12);
    return;
  }
  const hit = pickAt(mx, my);
  // armed to build a road: this click picks the other end
  if (sim.linkFrom) {
    const from = sim.linkFrom;
    sim.linkFrom = null;
    if (hit && hit.type === 'project') {
      const res = sim.buildDependency(hit.id, from);
      if (!res.ok) sim.say(`cannot build that road · ${res.why}`, 20, true);
      else cam.shake = Math.max(cam.shake, 0.16);
    } else {
      sim.say('road cancelled', 200, true);
    }
    return;
  }
  if (!hit) { select(null); return; }
  select(hit);
  if (hit.type === 'team' && lodOf(cam.s) <= LOD.TEAM) flyTo(hit.obj.cx, hit.obj.cy, 1.85);
  else if (hit.type === 'project') {
    const b = hit.obj;
    if (cam.s < 3.4) flyTo(b.x, b.y, 4.4);
    else flyTo(b.x, b.y, cam.ts);
  } else if (hit.type === 'task') {
    if (cam.s < 7) flyTo(hit.obj.x, hit.obj.y, 10);
    cam.follow = hit.obj;
  }
}
function descend(mx, my) {
  const hit = pickAt(mx, my);
  if (!hit) { cam.ts = clamp(cam.ts * 2.2, 0.22, 34); return; }
  if (hit.type === 'team') flyTo(hit.obj.cx, hit.obj.cy, 2.6);
  else if (hit.type === 'project') flyTo(hit.obj.x, hit.obj.y, 7.5);
  else if (hit.type === 'task') { flyTo(hit.obj.x, hit.obj.y, 17, true); cam.follow = hit.obj; }
  select(hit);
}

function select(hit) {
  ui.selected = hit ? { type: hit.type, id: hit.id } : null;
  ui.hotDeps = null;
  if (!hit) { cam.follow = null; ui.focusTeam = null; return; }
  if (hit.type === 'project') {
    ui.focusTeam = org.byId[hit.id].team;
    ui.hotDeps = new Set(org.deps.filter((d) => d.from === hit.id || d.to === hit.id).map((d) => d.id));
  } else if (hit.type === 'team') {
    ui.focusTeam = hit.id;
  } else if (hit.type === 'task') {
    const t = org.byId[hit.id];
    ui.focusTeam = t.team;
    if (t.blockedBy) {
      ui.hotDeps = new Set(org.deps.filter((d) => d.from === t.blockedBy && d.to === t.project).map((d) => d.id));
    }
  }
}

function ascend() {
  if (ui.help) { ui.help = false; return; }
  if (cam.follow) { cam.follow = null; return; }
  const lod = lodOf(cam.s);
  if (ui.selected && ui.selected.type === 'task') {
    const t = org.byId[ui.selected.id];
    const b = city.byProject[t.project];
    select({ type: 'project', id: t.project, obj: b });
    flyTo(b.x, b.y, 4.4);
    return;
  }
  if (ui.selected && ui.selected.type === 'project') {
    const p = org.byId[ui.selected.id];
    const d = city.districts[p.team];
    select({ type: 'team', id: p.team, obj: d });
    flyTo(d.cx, d.cy, 1.9);
    return;
  }
  select(null);
  flyTo(0, 30, 0.95);
}

function gotoLevel(l) {
  const targets = [0.68, 1.85, 4.2, 8.6, 17];
  const s = targets[clamp(l, 0, 4)];
  let x = cam.tx, y = cam.ty;
  if (l === 0) { x = 0; y = 30; select(null); }
  else if (!ui.selected) {
    // nothing chosen: go where the city is busiest
    if (l === 1) {
      const d = city.districts.slice().sort((a, b) => b.pressure - a.pressure)[0];
      select({ type: 'team', id: d.team, obj: d }); x = d.cx; y = d.cy;
    } else if (l === 2) {
      const p = org.projects.slice().sort((a, b) =>
        (b.blocked * 3 + b.activeCount) - (a.blocked * 3 + a.activeCount))[0];
      const b = city.byProject[p.id];
      select({ type: 'project', id: p.id, obj: b }); x = b.x; y = b.y;
    } else {
      const live = sim.agents.filter((a) => !a.dead && a.path);
      const a = live.sort((p, q) =>
        (q.task.state === ST.BLOCKED ? 1 : 0) - (p.task.state === ST.BLOCKED ? 1 : 0))[0];
      if (a) { select({ type: 'task', id: a.task.id, obj: a }); x = a.x; y = a.y; cam.follow = a; }
    }
  } else if (ui.selected) {
    if (l >= 3 && ui.selected.type !== 'task') {
      // descending past project level means riding along with the work
      const pool = ui.selected.type === 'project'
        ? org.byId[ui.selected.id].tasks
        : org.teams[ui.selected.id].projects.flatMap((pid) => org.byId[pid].tasks);
      const live = pool.map((id) => sim.byTask[id]).filter((a) => a && !a.dead && a.path);
      live.sort((p, q) => (q.task.state === ST.BLOCKED ? 1 : 0) - (p.task.state === ST.BLOCKED ? 1 : 0));
      if (live.length) {
        const a = live[0];
        select({ type: 'task', id: a.task.id, obj: a });
        x = a.x; y = a.y; cam.follow = a;
      }
    }
    if (ui.selected.type === 'project') { const b = city.byProject[ui.selected.id]; x = b.x; y = b.y; }
    else if (ui.selected.type === 'team') { const d = city.districts[ui.selected.id]; x = d.cx; y = d.cy; }
    else if (ui.selected.type === 'task') { const a = sim.byTask[ui.selected.id]; if (a) { x = a.x; y = a.y; } }
  }
  flyTo(x, y, s, l >= 3);
}
function flyTo(x, y, s, keepFollow) {
  cam.tx = x; cam.ty = y; cam.ts = clamp(s, 0.22, 34);
  if (!keepFollow) cam.follow = null;
  zoomAnchor = null;
}
function toggleFollow() {
  if (cam.follow) { cam.follow = null; return; }
  if (ui.selected && ui.selected.type === 'task') {
    const a = sim.byTask[ui.selected.id];
    if (a) { cam.follow = a; cam.ts = Math.max(cam.ts, 12); }
  }
}

/* ---------- loading a real city -------------------------- */
const loaderEl = document.getElementById('loader');
const dropVeil = document.getElementById('dropveil');
const statusEl = document.getElementById('status');
const repoEl = document.getElementById('repo');

function say(msg, kind) {
  statusEl.textContent = msg || '';
  statusEl.className = kind || '';
}
function openLoader(open) {
  const show = open === undefined ? loaderEl.hidden : open;
  loaderEl.hidden = !show;
  ui.loader = show;
  if (show) { say(''); setTimeout(() => repoEl.focus(), 30); }
}
function adopt(newOrg, label) {
  persist.resume();
  const info = rebuildFrom(newOrg, label);
  persist.save(newOrg);
  say(`built ${info.projects} structures · ${info.tasks} tasks · ${info.teams} neighbourhoods`, 'ok');
  setTimeout(() => openLoader(false), 900);
}

document.getElementById('close').onclick = () => openLoader(false);
document.getElementById('demo').onclick = () => {
  adopt(buildOrg(), 'demo city rebuilt');
};
document.getElementById('sample').onclick = async () => {
  say('reading samples/northwind.json…');
  try {
    const res = await fetch('samples/northwind.json');
    if (!res.ok) throw new Error('sample not found (' + res.status + ')');
    adopt(orgFromSpec(await res.json()), 'northwind · sample city built');
  } catch (e) {
    say(location.protocol === 'file:'
      ? 'browsers block file reads from file:// — run a local server, or drag the file in instead'
      : String(e.message || e), 'err');
  }
};
document.getElementById('build').onclick = async () => {
  const path = repoEl.value.trim();
  if (!path) { say('type owner/repo first', 'err'); return; }
  say('contacting github…');
  try {
    const newOrg = await orgFromGitHub(path, (m) => say(m));
    adopt(newOrg, `${path} · city built from live issues`);
  } catch (e) {
    const msg = String(e.message || e);
    say(/failed to fetch|networkerror/i.test(msg)
      ? 'could not reach github — check the network, or a proxy may be blocking api.github.com'
      : msg, 'err');
  }
};
repoEl.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') document.getElementById('build').click();
});

/* drop a file anywhere on the page */
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  e.preventDefault(); dragDepth++; dropVeil.hidden = false;
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; dropVeil.hidden = true; } });
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0; dropVeil.hidden = true;
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) return;
  openLoader(true);
  say(`reading ${file.name}…`);
  try {
    const spec = JSON.parse(await file.text());
    adopt(orgFromSpec(spec), `${file.name} · city built`);
  } catch (err) {
    say(`${file.name}: ${err.message || err}`, 'err');
  }
});

document.getElementById('export').onclick = () => {
  try { say(`saved ${downloadCity(org)}`, 'ok'); }
  catch (e) { say(String(e.message || e), 'err'); }
};
document.getElementById('forget').onclick = () => {
  persist.clear();
  say('saved city cleared — reload for a fresh city', 'ok');
};

/* pick up wherever we left off */
(function restore() {
  const spec = persist.load();
  if (!spec) return;
  try {
    rebuildFrom(orgFromSpec(spec), `restored · saved ${persist.age(spec) || 'earlier'}`);
    hud.boot = 0;
  } catch (e) {
    persist.clear();
  }
})();
window.addEventListener('beforeunload', () => persist.save(org));

/* ---------- loop ----------------------------------------- */
let last = performance.now();
let fpsAcc = 0, fpsN = 0, fps = 60;

function frame(now) {
  let dt = (now - last) / 1000; last = now;
  dt = Math.min(dt, 0.06);
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }

  sim.speed = ui.paused ? 0 : 1;
  sim.step(dt);

  cam.update(dt, sim.time);
  // keep the point under the cursor pinned while zooming
  if (zoomAnchor) {
    const cur = cam.unproj(zoomAnchor.sx, zoomAnchor.sy);
    const dx = zoomAnchor.w.x - cur.x, dy = zoomAnchor.w.y - cur.y;
    cam.x += dx; cam.y += dy; cam.tx += dx; cam.ty += dy;
    zoomAnchor.t -= dt;
    if (zoomAnchor.t <= 0 || Math.abs(cam.s - cam.ts) < cam.ts * 0.002) zoomAnchor = null;
  }
  // lightning rattles the camera
  if (sim.weather.flash > 0.9) cam.shake = Math.max(cam.shake, 0.35 * sim.weather.storm);

  persist.tick(dt, org);
  tour.update(dt, sim, city, org, ui);
  ui.tour = tour;
  ui.level = lodOf(cam.s);
  R.draw(sim, cam, ui, dt);
  hud.draw(R.ctx, sim, cam, ui, R, dt);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* first breath: let the city assemble, then settle */
setTimeout(() => { cam.ts = 0.95; }, 300);

/* expose the running city for inspection / automation */
window.APP = { org, city, sim, cam, ui, hud, R, flyTo, gotoLevel, select, pickAt, ringAt,
  rebuildFrom, tour,
  get fps() { return fps; } };
