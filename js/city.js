/* ============================================================
   city.js — turns the org into ground truth: an island, six
   neighbourhoods, a real road graph, plots, and dependency
   routes traced through actual streets.
   World units ~= metres. +x east, +y south. z is up.
   ============================================================ */
'use strict';

const BLOCK = 66;          // city block size
const ROAD_W = { highway: 13, avenue: 11, ring: 12, street: 7.5, drive: 4.5 };

function buildCity(org) {
  seed(0xC17ED0);
  const city = {
    nodes: [], edges: [], districts: [], buildings: [], gates: [],
    byProject: {}, islandPts: [], radius: 0, props: [],
  };

  const addNode = (x, y, kind) => {
    city.nodes.push({ id: city.nodes.length, x, y, kind, edges: [], jam: 0 });
    return city.nodes.length - 1;
  };
  const addEdge = (a, b, kind) => {
    if (a === b) return -1;
    const na = city.nodes[a], nb = city.nodes[b];
    const existing = na.edges.find((ei) => {
      const e = city.edges[ei]; return (e.a === b || e.b === b);
    });
    if (existing !== undefined) return existing;
    const e = {
      id: city.edges.length, a, b, kind,
      w: ROAD_W[kind], len: dist(na.x, na.y, nb.x, nb.y),
      jam: 0, jamT: 0, agents: [], deps: [], hue: 210, flow: 0, pulse: 0,
    };
    city.edges.push(e);
    na.edges.push(e.id); nb.edges.push(e.id);
    return e.id;
  };
  city.addNode = addNode; city.addEdge = addEdge;

  /* ---- downtown: the org core plaza ---------------------- */
  const coreNode = addNode(0, 0, 'core');
  const RING_R = 132, RING_N = 12;
  const ring = [];
  for (let i = 0; i < RING_N; i++) {
    const a = (i / RING_N) * TAU;
    ring.push(addNode(Math.cos(a) * RING_R, Math.sin(a) * RING_R, 'ring'));
  }
  for (let i = 0; i < RING_N; i++) addEdge(ring[i], ring[(i + 1) % RING_N], 'ring');
  for (let i = 0; i < RING_N; i += 3) addEdge(ring[i], coreNode, 'avenue');
  city.core = { node: coreNode, r: RING_R };
  city.ring = ring;

  /* ---- districts ----------------------------------------- */
  const n = org.teams.length;
  org.teams.forEach((team, i) => {
    const a = -PI / 2 + (i / n) * TAU + rr(-0.09, 0.09);
    const projects = team.projects.map((id) => org.byId[id]);
    const blocks = projects.length + ri(3, 6);
    const cols = Math.max(2, Math.round(Math.sqrt(blocks * 1.45)));
    const rows = Math.max(2, Math.ceil(blocks / cols));
    const W = cols * BLOCK, D = rows * BLOCK;
    const rad = 268 + Math.max(W, D) * 0.42 + (i % 2) * 46;
    const cx = Math.cos(a) * rad, cy = Math.sin(a) * rad;
    const ang = a + PI / 2 + rr(-0.14, 0.14);

    const d = {
      team: team.id, name: team.name, tag: team.tag, hue: team.hue, motto: team.motto,
      cx, cy, ang, W, D, cols, rows, nodes: [], grid: [], poly: [],
      buildings: [], gate: -1, pressure: 0, storm: 0, light: 0,
    };

    const L2W = (u, v) => {
      const [rx, ry] = rot2(u, v, ang);
      return [cx + rx, cy + ry];
    };
    d.L2W = L2W;

    // street grid nodes
    for (let r = 0; r <= rows; r++) {
      const row = [];
      for (let c = 0; c <= cols; c++) {
        const u = c * BLOCK - W / 2, v = r * BLOCK - D / 2;
        const wob = 3.2;
        const [x, y] = L2W(u + rr(-wob, wob), v + rr(-wob, wob));
        const id = addNode(x, y, 'street');
        row.push(id); d.nodes.push(id);
      }
      d.grid.push(row);
    }
    for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) {
      if (c < cols) addEdge(d.grid[r][c], d.grid[r][c + 1], 'street');
      if (r < rows) addEdge(d.grid[r][c], d.grid[r + 1][c], 'street');
    }

    // gate = grid node nearest downtown
    let best = Infinity;
    d.nodes.forEach((id) => {
      const nn = city.nodes[id], dd = dist2(nn.x, nn.y, 0, 0);
      if (dd < best) { best = dd; d.gate = id; }
    });
    city.nodes[d.gate].kind = 'gate';

    // district outline (rounded, slightly organic)
    const pad = 30;
    for (let s = 0; s < 40; s++) {
      const t = s / 40 * TAU;
      const rx = (W / 2 + pad), ry = (D / 2 + pad);
      const k = 0.68; // superellipse-ish
      const cs = Math.cos(t), sn = Math.sin(t);
      const u = Math.sign(cs) * Math.pow(Math.abs(cs), k) * rx;
      const v = Math.sign(sn) * Math.pow(Math.abs(sn), k) * ry;
      const j = 1 + (fbm(u * 0.01 + i * 10, v * 0.01, 3) - 0.5) * 0.09;
      d.poly.push(L2W(u * j, v * j));
    }

    /* plots: projects get the prime blocks (nearest the gate) */
    const cells = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const u = (c + 0.5) * BLOCK - W / 2, v = (r + 0.5) * BLOCK - D / 2;
      const [x, y] = L2W(u, v);
      cells.push({ r, c, u, v, x, y, d: dist2(x, y, 0, 0) });
    }
    cells.sort((p, q) => p.d - q.d);

    projects.forEach((proj, k) => {
      const cell = cells[k];
      const s = proj.scale;
      const bw = lerp(20, 34, s), bd = lerp(20, 32, s * 0.8 + rr(0, 0.2));
      const nodeId = nearestGridNode(city, d, cell.x, cell.y);
      const b = makeBuilding(city, org, proj, cell.x, cell.y, bw, bd, ang + (chance(0.3) ? PI / 2 : 0), nodeId, d);
      d.buildings.push(b);
      city.buildings.push(b);
      city.byProject[proj.id] = b;
      const dn = addNode(lerp(cell.x, city.nodes[nodeId].x, 0.55), lerp(cell.y, city.nodes[nodeId].y, 0.55), 'drive');
      addEdge(dn, nodeId, 'drive');
      b.driveNode = dn;
      b.streetNode = nodeId;
    });

    // filler civic structures in the leftover blocks
    for (let k = projects.length; k < cells.length; k++) {
      const cell = cells[k];
      if (chance(0.22)) { d.parks = d.parks || []; d.parks.push({ x: cell.x, y: cell.y, r: rr(16, 25), seed: rnd() }); continue; }
      const cnt = ri(2, 5);
      for (let q = 0; q < cnt; q++) {
        const ox = rr(-20, 20), oy = rr(-20, 20);
        city.props.push({
          type: 'filler', x: cell.x + ox, y: cell.y + oy,
          w: rr(9, 17), d: rr(9, 16), h: rr(7, 30) * (1 - dist(cell.x, cell.y, 0, 0) / 900),
          rot: ang + (chance(0.5) ? PI / 2 : 0) + rr(-0.05, 0.05),
          hue: team.hue, seed: rnd(), district: team.id,
        });
      }
    }

    city.districts.push(d);
  });

  /* ---- avenues: district gate -> downtown ring ----------- */
  city.districts.forEach((d) => {
    const g = city.nodes[d.gate];
    let best = -1, bd = Infinity;
    ring.forEach((id) => { const nn = city.nodes[id], q = dist2(nn.x, nn.y, g.x, g.y); if (q < bd) { bd = q; best = id; } });
    // a couple of intermediate nodes so avenues curve a little
    const nn = city.nodes[best];
    const steps = 2;
    let prev = d.gate;
    for (let s = 1; s <= steps; s++) {
      const t = s / (steps + 1);
      const mx = lerp(g.x, nn.x, t), my = lerp(g.y, nn.y, t);
      const off = (fbm(mx * 0.004, my * 0.004, 2) - 0.5) * 46;
      const px = -(nn.y - g.y), py = (nn.x - g.x);
      const L = Math.hypot(px, py) || 1;
      const id = addNode(mx + px / L * off, my + py / L * off, 'avenue');
      addEdge(prev, id, 'avenue'); prev = id;
    }
    addEdge(prev, best, 'avenue');
    d.avenueEnd = best;
  });

  /* ---- inner ring: the downtown loop --------------------- */
  const RING2_R = 214, RING2_N = 16;
  const ring2 = [];
  for (let i = 0; i < RING2_N; i++) {
    const a = (i / RING2_N) * TAU + 0.11;
    ring2.push(addNode(Math.cos(a) * RING2_R * rr(0.96, 1.05), Math.sin(a) * RING2_R * rr(0.96, 1.05), 'ring'));
  }
  for (let i = 0; i < RING2_N; i++) addEdge(ring2[i], ring2[(i + 1) % RING2_N], 'ring');
  for (let i = 0; i < RING2_N; i += 2) {
    let best = -1, bd = Infinity;
    const n2 = city.nodes[ring2[i]];
    ring.forEach((id) => { const nn = city.nodes[id], q = dist2(nn.x, nn.y, n2.x, n2.y); if (q < bd) { bd = q; best = id; } });
    addEdge(ring2[i], best, 'avenue');
  }
  city.districts.forEach((d) => {
    const g = city.nodes[d.gate];
    let best = -1, bd = Infinity;
    ring2.forEach((id) => { const nn = city.nodes[id], q = dist2(nn.x, nn.y, g.x, g.y); if (q < bd) { bd = q; best = id; } });
    if (best >= 0) addEdge(d.gate, best, 'avenue');
  });
  city.ring2 = ring2;

  /* ---- orbital links between neighbouring districts ------ */
  for (let i = 0; i < city.districts.length; i++) {
    const a = city.districts[i], b = city.districts[(i + 1) % city.districts.length];
    const na = city.nodes[a.gate], nb = city.nodes[b.gate];
    const mx = (na.x + nb.x) / 2, my = (na.y + nb.y) / 2;
    const L = Math.hypot(mx, my) || 1;
    const mid = addNode(mx / L * (L * 1.16), my / L * (L * 1.16), 'avenue');
    addEdge(a.gate, mid, 'avenue'); addEdge(mid, b.gate, 'avenue');
  }

  /* ---- spur roads reaching for the shore ----------------- */
  city.districts.forEach((d) => {
    let far = -1, fd = -1;
    d.nodes.forEach((id) => {
      const nn = city.nodes[id], q = dist2(nn.x, nn.y, 0, 0);
      if (q > fd) { fd = q; far = id; }
    });
    const nn = city.nodes[far];
    const a = Math.atan2(nn.y, nn.x);
    let prev = far;
    for (let k = 1; k <= 3; k++) {
      const r = Math.hypot(nn.x, nn.y) + k * 92;
      const aa = a + Math.sin(k * 1.7 + d.team) * 0.14;
      const id = addNode(Math.cos(aa) * r, Math.sin(aa) * r, 'avenue');
      addEdge(prev, id, k === 1 ? 'avenue' : 'street');
      prev = id;
    }
  });

  /* ---- island shape + city gates ------------------------- */
  let maxR = 0;
  city.nodes.forEach((nd) => { maxR = Math.max(maxR, Math.hypot(nd.x, nd.y)); });
  city.radius = maxR + 150;
  for (let i = 0; i < 96; i++) {
    const t = (i / 96) * TAU;
    const w = 1 + (fbm(Math.cos(t) * 1.6 + 4, Math.sin(t) * 1.6 + 9, 4) - 0.5) * 0.46;
    city.islandPts.push([Math.cos(t) * city.radius * w, Math.sin(t) * city.radius * w]);
  }
  const GATES = 5;
  for (let i = 0; i < GATES; i++) {
    const a = (i / GATES) * TAU + 0.4;
    const k = Math.round((a / TAU) * city.islandPts.length) % city.islandPts.length;
    const sp = city.islandPts[(k + city.islandPts.length) % city.islandPts.length];
    const shore = Math.hypot(sp[0], sp[1]);
    const gx = Math.cos(a) * shore * 0.88, gy = Math.sin(a) * shore * 0.88;
    const id = addNode(gx, gy, 'cityGate');
    // link to nearest district gate through one bend
    let best = null, bd = Infinity;
    city.districts.forEach((d) => {
      const nn = city.nodes[d.gate], q = dist2(nn.x, nn.y, gx, gy);
      if (q < bd) { bd = q; best = d; }
    });
    const tgt = city.nodes[best.gate];
    const mid = addNode(lerp(gx, tgt.x, 0.5) + rr(-30, 30), lerp(gy, tgt.y, 0.5) + rr(-30, 30), 'highway');
    addEdge(id, mid, 'highway'); addEdge(mid, best.gate, 'highway');
    city.gates.push(id);
  }

  /* ---- route every dependency through real streets ------- */
  org.deps.forEach((dep) => {
    const A = city.byProject[dep.from], B = city.byProject[dep.to];
    if (!A || !B) return;
    const path = routeNodes(city, A.driveNode, B.driveNode);
    if (!path || path.length < 2) return;
    dep.path = path;
    dep.edges = pathEdges(city, path);
    dep.hue = org.teams[org.byId[dep.to].team].hue;
    dep.edges.forEach((ei) => {
      const e = city.edges[ei];
      e.deps.push(dep.id);
      e.hue = dep.hue;
      if (e.kind === 'street') { e.kind = 'arterial'; e.w = 9; }
    });
  });

  fillCity(city);

  /* ---- streetlights & trees along streets ---------------- */
  city.edges.forEach((e) => {
    if (e.kind === 'drive') return;
    const a = city.nodes[e.a], b = city.nodes[e.b];
    const count = Math.floor(e.len / 34);
    for (let i = 1; i <= count; i++) {
      const t = i / (count + 1);
      const px = -(b.y - a.y), py = (b.x - a.x), L = Math.hypot(px, py) || 1;
      const off = (e.w / 2 + 3.4);
      const side = chance(0.5) ? 1 : -1;
      city.props.push({
        type: chance(0.35) ? 'tree' : 'lamp',
        x: lerp(a.x, b.x, t) + px / L * off * side,
        y: lerp(a.y, b.y, t) + py / L * off * side,
        seed: rnd(), h: rr(7, 10),
      });
    }
  });

  seedGreens(city);
  city.props.sort((a, b) => a.y - b.y);
  return city;
}

function nearestGridNode(city, d, x, y) {
  let best = -1, bd = Infinity;
  d.nodes.forEach((id) => {
    const nn = city.nodes[id], q = dist2(nn.x, nn.y, x, y);
    if (q < bd) { bd = q; best = id; }
  });
  return best;
}

function makeBuilding(city, org, proj, x, y, w, d, rot, node, district) {
  const nMile = proj.milestones.length;
  const style = pick(['slab', 'tower', 'tower', 'stack', 'lattice']);
  if (style === 'tower') { w *= 0.66; d *= 0.66; }
  if (style === 'slab') { w *= 1.25; }
  const floorH = style === 'tower' ? rr(12, 16) : style === 'slab' ? rr(7.5, 9.5) : rr(9, 12.5);
  const b = {
    project: proj.id, name: proj.name, team: proj.team, hue: district.hue,
    x, y, w, d, rot, node, district: district.team,
    floorH,
    floors: Math.max(2, proj.built + 2),
    targetFloors: Math.max(2, proj.built + 2),
    hDisp: 0,                                   // animated height
    lit: proj.progress,                         // fraction of windows alight
    litDisp: 0,
    glow: 0, shake: 0, grow: 0,
    born: -1, seed: rnd(),
    style,
    beacon: rnd(),
    rings: [],                                  // expanding shockwaves
    motes: [],
  };
  b.maxFloors = nMile + 3;
  return b;
}

function buildingHeight(b) { return b.floors * b.floorH; }

/* ---- Dijkstra over the road graph ----------------------- */
function routeNodes(city, from, to, congestionAware) {
  const N = city.nodes.length;
  const distArr = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const done = new Uint8Array(N);
  distArr[from] = 0;
  const heap = [[0, from]];
  const push = (d, n) => {
    heap.push([d, n]);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let s = i;
        if (l < heap.length && heap[l][0] < heap[s][0]) s = l;
        if (r < heap.length && heap[r][0] < heap[s][0]) s = r;
        if (s === i) break; [heap[s], heap[i]] = [heap[i], heap[s]]; i = s;
      }
    }
    return top;
  };
  while (heap.length) {
    const [dd, u] = pop();
    if (done[u]) continue;
    done[u] = 1;
    if (u === to) break;
    for (const ei of city.nodes[u].edges) {
      const e = city.edges[ei];
      const v = e.a === u ? e.b : e.a;
      if (done[v]) continue;
      let w = e.len;
      if (e.kind === 'highway') w *= 0.72;
      else if (e.kind === 'avenue' || e.kind === 'ring') w *= 0.85;
      if (congestionAware) w *= 1 + e.jam * 5;
      const nd = dd + w;
      if (nd < distArr[v]) { distArr[v] = nd; prev[v] = u; push(nd, v); }
    }
  }
  if (distArr[to] === Infinity) return null;
  const path = [];
  for (let u = to; u !== -1; u = prev[u]) path.push(u);
  return path.reverse();
}

function pathEdges(city, path) {
  const out = [];
  for (let i = 0; i < path.length - 1; i++) {
    const u = path[i], v = path[i + 1];
    const ei = city.nodes[u].edges.find((id) => {
      const e = city.edges[id];
      return (e.a === u && e.b === v) || (e.b === u && e.a === v);
    });
    if (ei !== undefined) out.push(ei);
  }
  return out;
}

function edgeBetween(city, u, v) {
  return city.nodes[u].edges.find((id) => {
    const e = city.edges[id];
    return (e.a === u && e.b === v) || (e.b === u && e.a === v);
  });
}


/* ---- civic fabric: the city between the projects ---------
   A skyline needs a city around it. These structures carry no
   data; they exist so the ones that do have somewhere to stand.
---------------------------------------------------------- */
function buildRoadIndex(city, cell) {
  const idx = new Map();
  const key = (i, j) => i + ',' + j;
  city.edges.forEach((e) => {
    const a = city.nodes[e.a], b = city.nodes[e.b];
    const steps = Math.max(1, Math.ceil(e.len / cell));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const x = lerp(a.x, b.x, t), y = lerp(a.y, b.y, t);
      const i = Math.floor(x / cell), j = Math.floor(y / cell);
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const kk = key(i + di, j + dj);
        let arr = idx.get(kk);
        if (!arr) { arr = new Set(); idx.set(kk, arr); }
        arr.add(e.id);
      }
    }
  });
  return {
    near(x, y) {
      const arr = idx.get(Math.floor(x / cell) + ',' + Math.floor(y / cell));
      return arr ? arr : null;
    },
  };
}

function fillCity(city) {
  seed(0xF11E12);
  const idx = buildRoadIndex(city, 60);
  const R = city.radius;
  const inIsland = (x, y) => {
    const a = Math.atan2(y, x);
    let r = 0, n = city.islandPts.length;
    const i = ((Math.round((a / TAU) * n) % n) + n) % n;
    const p = city.islandPts[i];
    r = Math.hypot(p[0], p[1]);
    return Math.hypot(x, y) < r * 0.86;
  };
  const step = 25;
  for (let x = -R; x <= R; x += step) {
    for (let y = -R; y <= R; y += step) {
      const px = x + rr(-9, 9), py = y + rr(-9, 9);
      const r = Math.hypot(px, py);
      if (r < 104 || !inIsland(px, py)) continue;
      let skip = false;
      for (const d of city.districts) if (pointInPoly(px, py, d.poly)) { skip = true; break; }
      if (skip) continue;
      // keep clear of the carriageway
      const near = idx.near(px, py);
      let minD = 1e9;
      if (near) for (const ei of near) {
        const e = city.edges[ei], a = city.nodes[e.a], b = city.nodes[e.b];
        minD = Math.min(minD, segClosest(px, py, a.x, a.y, b.x, b.y).d - e.w / 2);
      }
      // buildings line streets; open ground stays open
      if (minD < 7 || minD > 54) continue;
      const core = 1 - smooth(inv(70, R * 0.78, r));
      if (chance(0.34 - core * 0.26)) continue;
      const h = (5 + Math.pow(core, 2.2) * 54) * rr(0.55, 1.35);
      const w = rr(9, 16) * (0.82 + core * 0.5);
      const dd = rr(9, 16) * (0.82 + core * 0.5);
      city.props.push({
        type: 'filler', x: px, y: py, w, d: dd, h: Math.max(4, h),
        rot: Math.atan2(py, px) + PI / 2 + rr(-0.35, 0.35),
        seed: rnd(), district: -1, core,
      });
    }
  }
}

/* open ground between the blocks: parks, water, scrub */
function seedGreens(city) {
  seed(0x6A12E5);
  city.greens = [];
  const R = city.radius;
  for (let i = 0; i < 90; i++) {
    const a = rnd() * TAU, r = 90 + Math.sqrt(rnd()) * R * 0.8;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    let ok = true;
    for (const d of city.districts) if (pointInPoly(x, y, d.poly)) { ok = false; break; }
    if (!ok) continue;
    city.greens.push({ x, y, r: rr(24, 78), seed: rnd(), water: chance(0.22) });
  }
}
