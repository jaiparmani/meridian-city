/* ============================================================
   sim.js — physics of work. Tasks become bodies with mass and
   momentum, roads carry them, blockages queue behind blockages,
   congestion bleeds outward through the graph, deadlines make
   weather, finished work becomes light that flies downtown.
   ============================================================ */
'use strict';

const LANE = 2.6;

class Sim {
  constructor(org, city) {
    this.org = org; this.city = city;
    this.agents = [];
    this.fx = [];          // ground rings, bursts, dust
    this.motes = [];       // completed work, flying to the core
    this.time = 0;
    this.speed = 1;
    this.coreCharge = 0;
    this.narration = [];
    this.weather = { storm: 0, stormT: 0, rain: 0, wind: 0.5, flash: 0, nextBolt: 8, cloud: 0.25 };
    this.pulse = new Array(160).fill(0);
    this.pulseAcc = 0;
    this.throughput = 0;
    this.byTask = {};

    org.tasks.forEach((t) => this.spawnAgent(t, true));
    this.spawnResidents(140);
    city.districts.forEach((d) => { d.cell = { x: d.cx, y: d.cy, r: 190, v: rr(-6, 6), vy: rr(-6, 6) }; });
  }

  /* ---------- agents ------------------------------------- */
  spawnAgent(task, initial) {
    const city = this.city, org = this.org;
    const b = city.byProject[task.project];
    if (!b) return null;
    const team = org.teams[task.team];
    const a = {
      id: task.id, task, kind: task.kind, mass: task.mass, hue: team.hue,
      vmax: task.kind === 'walk' ? 13 : task.kind === 'car' ? 30 : 22,
      speed: 0, s: 0, edgeId: -1, dir: 1, path: null, pi: 0,
      x: b.x, y: b.y, ang: 0, stopped: false, park: -1, mode: 'idle',
      wob: rnd() * TAU, trail: [], life: 0, alpha: 0, home: b,
      beacon: 0, seedv: rnd(),
    };
    this.agents.push(a);
    this.byTask[task.id] = a;

    if (task.state === ST.BLOCKED && task.blockedBy) this.sendToBlocker(a);
    else if (task.state === ST.INBOUND || (initial && chance(0.25))) this.sendInbound(a);
    else this.circulate(a);
    return a;
  }

  /* residents: they carry no work, but they use the same roads and
     sit in the same jams, which is what makes a jam feel real */
  spawnResidents(n) {
    const city = this.city;
    for (let i = 0; i < n; i++) {
      const walker = chance(0.45);
      const from = ri(0, city.nodes.length - 1);
      const a = {
        id: 'r' + i, resident: true, task: { state: 'ambient', title: '', done: 0 },
        kind: walker ? 'walk' : 'car', mass: walker ? 0.8 : rr(1.4, 2.6),
        hue: rr(190, 215), vmax: walker ? 11 : rr(22, 32),
        speed: 0, s: 0, edgeId: -1, dir: 1, path: null, pi: 0,
        x: 0, y: 0, ang: 0, stopped: false, park: -1, mode: 'circulate',
        wob: rnd() * TAU, trail: [], life: 0, alpha: 0, beacon: 0, seedv: rnd(),
      };
      const to = ri(0, city.nodes.length - 1);
      const p = routeNodes(city, from, to);
      this.agents.push(a);
      if (p) this.setPath(a, p); else a.mode = 'idle';
    }
  }

  setPath(a, nodes) {
    if (!nodes || nodes.length < 2) { this.circulate(a); return; }
    a.path = nodes; a.pi = 0; a.s = 0;
    a.edgeId = edgeBetween(this.city, nodes[0], nodes[1]);
    if (a.edgeId === undefined || a.edgeId === -1) { a.path = null; this.circulate(a); return; }
    const e = this.city.edges[a.edgeId];
    a.dir = e.a === nodes[0] ? 1 : -1;
    a.stopped = false;
  }

  sendInbound(a) {
    const city = this.city;
    const gate = pick(city.gates);
    a.mode = 'toBuilding';
    a.task.state = ST.INBOUND;
    a.alpha = 0;
    this.setPath(a, routeNodes(city, gate, a.home.driveNode));
  }

  circulate(a) {
    const city = this.city;
    if (a.resident) {
      const from = a.path ? a.path[a.pi] : ri(0, city.nodes.length - 1);
      const p = routeNodes(city, from, ri(0, city.nodes.length - 1));
      if (p) this.setPath(a, p); else a.mode = 'idle';
      a.mode = 'circulate';
      return;
    }
    const d = city.districts[a.home.district];
    const from = a.path ? a.path[a.pi] : a.home.driveNode;
    let target = pick(d.nodes);
    if (chance(0.16)) target = pick(city.districts[ri(0, city.districts.length - 1)].nodes);
    a.mode = 'circulate';
    const p = routeNodes(city, from, target);
    if (!p) { a.mode = 'idle'; return; }
    this.setPath(a, p);
  }

  sendToBlocker(a) {
    const city = this.city, org = this.org;
    const blocker = city.byProject[a.task.blockedBy];
    if (!blocker) { this.circulate(a); return; }
    const from = a.path ? a.path[a.pi] : a.home.driveNode;
    const p = routeNodes(city, from, blocker.driveNode);
    if (!p || p.length < 3) { this.circulate(a); return; }
    a.mode = 'toBlocker';
    this.setPath(a, p);
    // park somewhere in the middle of the route: this is where the jam starts
    a.park = Math.max(1, Math.floor(p.length * rr(0.45, 0.8)));
  }

  sendHome(a, mode) {
    const from = a.path ? a.path[a.pi] : a.home.driveNode;
    a.mode = mode || 'toBuilding';
    a.park = -1;
    this.setPath(a, routeNodes(this.city, from, a.home.driveNode, true));
  }

  sendToReview(a) {
    const city = this.city;
    const others = city.buildings.filter((b) => b !== a.home);
    const tgt = pick(others);
    const from = a.path ? a.path[a.pi] : a.home.driveNode;
    a.mode = 'toReview'; a.reviewAt = tgt;
    this.setPath(a, routeNodes(city, from, tgt.driveNode, true));
  }

  /* ---------- events -> motion --------------------------- */
  applyEvents(events) {
    const org = this.org, city = this.city;
    events.forEach((ev) => {
      if (ev.type === 'arrive') {
        const p = org.byId[ev.project];
        const t = makeTask(p, org, ST.INBOUND);
        p.tasks.push(t.id); org.tasks.push(t); org.byId[t.id] = t;
        const a = this.spawnAgent(t);
        if (a) this.sendInbound(a);
        this.say(`${p.name} · new work inbound`, org.teams[p.team].hue);
      } else if (ev.type === 'block') {
        const t = org.byId[ev.task]; if (!t || t.state === ST.DONE) return;
        t.state = ST.BLOCKED; t.blockedBy = ev.by; t.heat = 1;
        t.log.push({ day: org.day, text: `blocked by ${org.byId[ev.by].name}` });
        const a = this.byTask[t.id]; if (a) this.sendToBlocker(a);
        this.say(`${t.title} · blocked on ${org.byId[ev.by].name}`, 6);
      } else if (ev.type === 'unblock') {
        const t = org.byId[ev.task]; if (!t) return;
        t.state = ST.ACTIVE; t.blockedBy = null; t.heat = 1;
        t.log.push({ day: org.day, text: 'unblocked' });
        const a = this.byTask[t.id];
        if (a) {
          a.stopped = false; a.park = -1;
          this.ring(a.x, a.y, 0, 34, org.teams[t.team].hue, 0.8);
          this.sendHome(a, 'toBuilding');
        }
        this.say(`${t.title} · cleared`, 150);
      } else if (ev.type === 'review') {
        const t = org.byId[ev.task]; if (!t || t.state !== ST.ACTIVE) return;
        t.state = ST.REVIEW; t.heat = 1;
        const a = this.byTask[t.id]; if (a) this.sendToReview(a);
      } else if (ev.type === 'complete') {
        const t = org.byId[ev.task]; if (!t || t.state === ST.DONE) return;
        t.state = ST.DONE; t.done = 1; t.heat = 1;
        t.log.push({ day: org.day, text: 'completed' });
        const a = this.byTask[t.id];
        if (a) { a.mode = 'finishing'; this.sendHome(a, 'finishing'); }
        org.shipped++;
        this.throughput += 1;
      } else if (ev.type === 'milestone') {
        const p = org.byId[ev.project]; if (!p) return;
        const m = p.milestones.find((x) => !x.done); if (!m) return;
        m.done = true;
        const b = city.byProject[p.id];
        if (b) this.growBuilding(b, m.name);
        this.say(`${p.name} · ${m.name} complete`, org.teams[p.team].hue);
      }
    });
  }

  growBuilding(b, label) {
    b.targetFloors = Math.min(b.maxFloors, b.targetFloors + 1);
    b.grow = 1; b.glow = 1; b.shake = 1;
    b.lastLabel = label;
    this.ring(b.x, b.y, 0, Math.max(b.w, b.d) * 2.6, b.hue, 1.1);
    for (let i = 0; i < 26; i++) {
      const a = rnd() * TAU, sp = rr(6, 26);
      this.fx.push({
        type: 'dust', x: b.x + Math.cos(a) * b.w * 0.5, y: b.y + Math.sin(a) * b.d * 0.5, z: rr(0, 4),
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: rr(4, 16),
        life: 0, max: rr(1.1, 2.4), r: rr(2, 7), hue: b.hue,
      });
    }
    for (let i = 0; i < 10; i++) this.spawnMote(b, buildingHeight(b) * rr(0.3, 1));
  }

  ring(x, y, z, r, hue, power) {
    this.fx.push({ type: 'ring', x, y, z: z || 0, r0: 2, r: r, life: 0, max: 1.5 + power, hue, power });
  }
  spawnMote(b, z) {
    this.motes.push({
      x: b.x + rr(-b.w, b.w) * 0.4, y: b.y + rr(-b.d, b.d) * 0.4, z: z != null ? z : buildingHeight(b),
      vx: rr(-4, 4), vy: rr(-4, 4), vz: rr(14, 30),
      hue: b.hue, life: 0, max: rr(4.5, 7), phase: 0, seed: rnd(),
    });
  }
  say(text, hue) {
    this.narration.unshift({ text, hue, t: this.time });
    if (this.narration.length > 26) this.narration.pop();
  }

  /* ---------- main step ---------------------------------- */
  step(dt) {
    dt = Math.min(dt, 0.05) * this.speed;
    if (dt <= 0) { this.updateWeather(0); return; }
    this.time += dt;
    const city = this.city, org = this.org;

    this.applyEvents(stepOrg(org, dt, this));
    this.traffic(dt);
    this.stepAgents(dt);
    this.stepBuildings(dt);
    this.stepMotes(dt);
    this.stepFx(dt);
    this.updateWeather(dt);

    this.pulseAcc += dt;
    if (this.pulseAcc > 0.25) {
      this.pulseAcc = 0;
      this.pulse.push(this.throughput);
      this.throughput *= 0.4;
      if (this.pulse.length > 160) this.pulse.shift();
    }
  }

  /* congestion: occupancy -> jam -> spreads to touching roads */
  traffic(dt) {
    const city = this.city;
    const E = city.edges;
    for (let i = 0; i < E.length; i++) { E[i].agents.length = 0; E[i].stopMass = 0; E[i].mass = 0; }
    for (const a of this.agents) {
      if (a.edgeId < 0 || a.dead) continue;
      const e = E[a.edgeId];
      e.agents.push(a);
      e.mass += a.mass;
      // only genuinely immobile work chokes a road; slow traffic barely counts
      if (a.stopped) e.stopMass += a.mass * (a.task.state === ST.BLOCKED ? 1 : 0.18);
    }
    // order along each edge so vehicles can see the one in front
    for (const e of E) {
      if (e.agents.length > 1) e.agents.sort((p, q) => (p.dir - q.dir) || (p.s - q.s));
      const cap = Math.max(2.5, e.len / 11);
      e.own = clamp((e.stopMass * 2.0 + e.mass * 0.10) / cap, 0, 1);
    }
    // bleed congestion into connected roads (this is the "spread"), decaying per hop
    for (const e of E) {
      let inc = 0;
      const na = city.nodes[e.a], nb = city.nodes[e.b];
      for (const ei of na.edges) if (ei !== e.id) inc = Math.max(inc, E[ei].jam);
      for (const ei of nb.edges) if (ei !== e.id) inc = Math.max(inc, E[ei].jam);
      e.jamT = Math.max(e.own, inc * 0.46);
    }
    for (const e of E) {
      e.jam = damp(e.jam, e.jamT, e.jamT > e.jam ? 1.1 : 0.42, dt);
      e.pulse = Math.max(0, e.pulse - dt);
    }
  }

  jamSpeed(e) { return 1 / (1 + e.jam * e.jam * 3.4); }

  stepAgents(dt) {
    const city = this.city;
    for (const a of this.agents) {
      if (a.dead) continue;
      a.life += dt;
      a.alpha = Math.min(1, a.alpha + dt * 1.6);
      a.beacon += dt;

      if (a.mode === 'idle' || !a.path) { if (chance(dt * 1.5)) this.circulate(a); continue; }
      const e = city.edges[a.edgeId];
      if (!e) { this.circulate(a); continue; }

      // parked (blocked): sit still and choke the road
      const parked = a.task.state === ST.BLOCKED && a.park >= 0 && a.pi >= a.park;
      if (parked) {
        a.stopped = true; a.speed = damp(a.speed, 0, 6, dt);
        this.placeAgent(a, e);
        if (chance(dt * 0.35)) this.fx.push({
          type: 'spark', x: a.x, y: a.y, z: 3, vx: rr(-2, 2), vy: rr(-2, 2), vz: rr(6, 12),
          life: 0, max: 0.8, r: 1.6, hue: 8,
        });
        continue;
      }

      let want = a.vmax * this.jamSpeed(e);
      if (a.kind === 'walk') want *= 0.9 + 0.2 * Math.sin(a.life * 3 + a.wob);

      // car-following: never pass through the body in front
      const lead = this.leadAgent(e, a);
      if (lead) {
        const gap = Math.abs(lead.s - a.s) - (a.mass + lead.mass) * 1.5 - 4;
        if (gap < 14) want = Math.min(want, Math.max(0, lead.speed * (gap / 14)));
        if (gap < 2.5) want = 0;
      }
      // don't enter a junction whose exit is already full
      const nearEnd = e.len - a.s;
      if (nearEnd < 6 && a.pi + 2 < a.path.length) {
        const nid = edgeBetween(city, a.path[a.pi + 1], a.path[a.pi + 2]);
        if (nid !== undefined && nid >= 0) {
          const ne = city.edges[nid];
          const ndir = ne.a === a.path[a.pi + 1] ? 1 : -1;
          const blocker = ne.agents.find((q) => q.dir === ndir && q.s < 12);
          if (blocker && blocker.speed < 3) want = 0;
        }
      }

      const accel = want > a.speed ? 26 / Math.sqrt(a.mass) : 46;    // mass = momentum
      a.speed += clamp(want - a.speed, -accel * dt, accel * dt);
      a.stopped = a.speed < 0.6;
      a.s += a.speed * dt;

      if (a.s >= e.len) {
        a.s -= e.len;
        a.pi++;
        if (a.pi >= a.path.length - 1) { this.arrive(a); continue; }
        const nid = edgeBetween(city, a.path[a.pi], a.path[a.pi + 1]);
        if (nid === undefined || nid < 0) { this.circulate(a); continue; }
        a.edgeId = nid;
        const ne = city.edges[nid];
        a.dir = ne.a === a.path[a.pi] ? 1 : -1;
        a.s = Math.min(a.s, ne.len - 0.1);
        ne.pulse = 0.5;
      }
      this.placeAgent(a, city.edges[a.edgeId]);

      if (a.kind !== 'walk' && a.speed > 4) {
        a.trail.push({ x: a.x, y: a.y, t: 0 });
        if (a.trail.length > 14) a.trail.shift();
      }
      for (const p of a.trail) p.t += dt;
    }
    this.agents = this.agents.filter((a) => !a.dead);
  }

  leadAgent(e, a) {
    const list = e.agents;
    let best = null, bd = Infinity;
    for (const q of list) {
      if (q === a || q.dir !== a.dir) continue;
      const d = q.s - a.s;
      if (d > 0 && d < bd) { bd = d; best = q; }
    }
    return best;
  }

  placeAgent(a, e) {
    const city = this.city;
    const from = a.dir > 0 ? city.nodes[e.a] : city.nodes[e.b];
    const to = a.dir > 0 ? city.nodes[e.b] : city.nodes[e.a];
    const t = clamp(a.s / e.len);
    let x = lerp(from.x, to.x, t), y = lerp(from.y, to.y, t);
    const dx = to.x - from.x, dy = to.y - from.y, L = Math.hypot(dx, dy) || 1;
    const off = a.kind === 'walk' ? e.w / 2 + 2.2 : LANE;
    x += (-dy / L) * off; y += (dx / L) * off;
    if (a.kind === 'walk') { x += Math.sin(a.life * 2.3 + a.wob) * 0.8; y += Math.cos(a.life * 2.1 + a.wob) * 0.8; }
    a.x = x; a.y = y;
    a.ang = angLerp(a.ang, Math.atan2(dy, dx), 0.35);
  }

  arrive(a) {
    const t = a.task;
    a.speed *= 0.3;
    if (a.mode === 'finishing') {
      const b = a.home;
      b.glow = Math.min(1.6, b.glow + 0.7);
      b.lit = clamp(b.lit + 0.06);
      this.ring(b.x, b.y, 0, Math.max(b.w, b.d) * 1.7, b.hue, 0.5);
      for (let i = 0; i < 7; i++) this.spawnMote(b, buildingHeight(b) * rr(0.2, 0.9));
      a.dead = true;
      delete this.byTask[t.id];
      this.say(`${t.title} · shipped`, 150);
      return;
    }
    if (a.mode === 'toBuilding') {
      if (t.state === ST.INBOUND) {
        t.state = ST.ACTIVE;
        t.log.push({ day: this.org.day, text: 'started' });
        a.home.glow = Math.min(1.4, a.home.glow + 0.35);
        this.ring(a.home.x, a.home.y, 0, Math.max(a.home.w, a.home.d) * 1.2, a.home.hue, 0.3);
      }
      this.circulate(a);
      return;
    }
    if (a.mode === 'toReview') {
      if (chance(0.5)) { t.state = ST.ACTIVE; t.done = clamp(t.done + 0.15); }
      this.sendHome(a, 'toBuilding');
      return;
    }
    if (a.mode === 'toBlocker') { a.stopped = true; return; }
    this.circulate(a);
  }

  stepBuildings(dt) {
    const org = this.org;
    for (const b of this.city.buildings) {
      const p = org.byId[b.project];
      b.floors = damp(b.floors, b.targetFloors, 2.2, dt);
      b.grow = Math.max(0, b.grow - dt * 0.7);
      b.glow = Math.max(0, b.glow - dt * 0.55);
      b.shake = Math.max(0, b.shake - dt * 1.4);
      b.lit = clamp(lerp(b.lit, 0.15 + p.progress * 0.85, dt * 0.6));
      b.litDisp = damp(b.litDisp, b.lit, 1.4, dt);
      b.risk = p.risk;
      b.activity = p.activity;
      if (p.blocked > 0 && chance(dt * 0.5)) b.alarm = 1;
      b.alarm = Math.max(0, (b.alarm || 0) - dt * 0.6);
      // idle projects gently dim: information decays
      if (p.activeCount === 0) b.lit = Math.max(0.08, b.lit - dt * 0.01);
    }
  }

  stepMotes(dt) {
    const core = { x: 0, y: 0, z: 150 };
    for (const m of this.motes) {
      m.life += dt;
      const dx = core.x - m.x, dy = core.y - m.y, dz = core.z - m.z;
      const L = Math.hypot(dx, dy, dz) || 1;
      const g = 130 / Math.max(60, L);         // gravity toward downtown
      m.vx += (dx / L) * g * dt * 9;
      m.vy += (dy / L) * g * dt * 9;
      m.vz += (dz / L) * g * dt * 9 + 6 * dt;
      m.vx *= 1 - 0.5 * dt; m.vy *= 1 - 0.5 * dt; m.vz *= 1 - 0.5 * dt;
      m.x += m.vx * dt; m.y += m.vy * dt; m.z += m.vz * dt;
      if (L < 40) { m.dead = true; this.coreCharge = Math.min(1.8, this.coreCharge + 0.14); }
      if (m.life > m.max) m.dead = true;
    }
    this.motes = this.motes.filter((m) => !m.dead);
    this.coreCharge = Math.max(0, this.coreCharge - dt * 0.28);
  }

  stepFx(dt) {
    for (const f of this.fx) {
      f.life += dt;
      if (f.type === 'dust' || f.type === 'spark') {
        f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
        f.vz -= 24 * dt; f.vx *= 1 - 1.6 * dt; f.vy *= 1 - 1.6 * dt;
        if (f.z < 0) { f.z = 0; f.vz *= -0.25; }
      }
      if (f.life > f.max) f.dead = true;
    }
    this.fx = this.fx.filter((f) => !f.dead);
    if (this.fx.length > 900) this.fx.splice(0, this.fx.length - 900);
  }

  /* deadlines make weather ------------------------------- */
  updateWeather(dt) {
    const org = this.org, w = this.weather;
    let total = 0;
    for (const d of this.city.districts) {
      const projects = org.teams[d.team].projects.map((id) => org.byId[id]);
      let press = 0, blocked = 0;
      projects.forEach((p) => { press += clamp(p.risk, 0, 1.6); blocked += p.blocked; });
      press = press / Math.max(1, projects.length);
      press = clamp(press * 0.8 + clamp(blocked / 6) * 0.35, 0, 1.3);
      d.pressure = damp(d.pressure, press, 0.5, dt);
      d.storm = damp(d.storm, clamp((d.pressure - 0.34) / 0.7), 0.35, dt);
      total += d.pressure;
      // storm cells drift over their neighbourhood
      const c = d.cell;
      c.v += rr(-1, 1) * dt * 22; c.vy += rr(-1, 1) * dt * 22;
      c.v = clamp(c.v, -9, 9); c.vy = clamp(c.vy, -9, 9);
      c.x += c.v * dt + this.weather.wind * 5 * dt;
      c.y += c.vy * dt;
      const pull = 0.5 * dt;
      c.x = lerp(c.x, d.cx, pull); c.y = lerp(c.y, d.cy, pull);
    }
    const avg = total / Math.max(1, this.city.districts.length);
    w.stormT = clamp((avg - 0.3) / 0.75);
    w.storm = damp(w.storm, w.stormT, 0.25, dt);
    w.rain = damp(w.rain, clamp(w.storm * 1.25), 0.4, dt);
    w.cloud = damp(w.cloud, clamp(0.16 + w.storm * 0.8), 0.3, dt);
    w.wind = 0.4 + Math.sin(this.time * 0.07) * 0.35 + w.storm * 0.4;
    w.flash = Math.max(0, w.flash - dt * 3.4);
    w.nextBolt -= dt * (0.4 + w.storm * 2.4);
    if (w.nextBolt <= 0 && w.storm > 0.32) {
      w.nextBolt = rr(2.5, 9) / (0.4 + w.storm);
      w.flash = 1;
      const d = this.city.districts.slice().sort((a, b) => b.storm - a.storm)[0];
      w.boltAt = d ? { x: d.cell.x + rr(-90, 90), y: d.cell.y + rr(-90, 90) } : { x: 0, y: 0 };
      w.boltSeed = rnd();
    }
    // time of day comes straight off the org clock
    this.dayT = (org.day % 1 + 1) % 1;
    this.sun = Math.sin((this.dayT - 0.22) * TAU);     // -1 night .. 1 noon
    this.night = clamp(remap(this.sun, 0.12, -0.25, 0, 1));
  }
}
