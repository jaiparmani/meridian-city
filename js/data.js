/* ============================================================
   data.js — the organisation. Teams, projects, tasks, people,
   and the event stream that keeps the city alive.
   Nothing here knows about pixels.
   ============================================================ */
'use strict';

const TEAM_DEFS = [
  { name: 'Platform',       tag: 'PLT', hue: 196, motto: 'core services · infra' },
  { name: 'Growth',         tag: 'GRW', hue: 34,  motto: 'acquisition · funnels' },
  { name: 'Design Systems', tag: 'DSY', hue: 291, motto: 'primitives · tokens' },
  { name: 'Data & ML',      tag: 'DML', hue: 158, motto: 'pipelines · models' },
  { name: 'Mobile',         tag: 'MOB', hue: 8,   motto: 'ios · android' },
  { name: 'Trust & Safety', tag: 'TNS', hue: 224, motto: 'abuse · integrity' },
];

const PROJECT_NAMES = {
  PLT: ['Edge Router', 'Auth Mesh', 'Event Bus', 'Config Vault', 'Deploy Pipeline', 'Trace Fabric'],
  GRW: ['Onboarding v4', 'Referral Loop', 'Pricing Page', 'Lifecycle Mail', 'Paywall Lab'],
  DSY: ['Token Foundry', 'Motion Kit', 'Icon Atlas', 'Form Primitives'],
  DML: ['Feature Store', 'Ranking v7', 'Churn Oracle', 'Stream Lakehouse', 'Eval Harness'],
  MOB: ['Offline Sync', 'Camera Rewrite', 'Widget Suite', 'Push Rework'],
  TNS: ['Appeals Flow', 'Signal Graph', 'Rate Shield', 'Policy Console'],
};

const MILESTONES = ['scoping', 'spike', 'alpha', 'integration', 'hardening', 'beta', 'rollout', 'ga'];

const VERBS = ['refactor', 'instrument', 'migrate', 'ship', 'debug', 'benchmark', 'harden', 'wire up',
  'backfill', 'deprecate', 'shard', 'cache', 'audit', 'stub', 'rewrite', 'throttle', 'index', 'batch'];
const NOUNS = ['token refresh', 'retry policy', 'cold start', 'schema drift', 'edge cases', 'the write path',
  'session store', 'p99 latency', 'the fallback', 'dead letters', 'the migration', 'feature flags',
  'the render loop', 'idempotency keys', 'the webhook', 'rate limits', 'cursor paging', 'the changelog'];

const FIRST = ['Ada', 'Ken', 'Grace', 'Linus', 'Rin', 'Omar', 'Yuki', 'Nina', 'Tomas', 'Priya', 'Jae',
  'Ola', 'Sam', 'Iris', 'Cyrus', 'Mira', 'Devon', 'Hana', 'Luca', 'Zoe', 'Ravi', 'Noor', 'Esme', 'Kit'];
const LAST = ['Vane', 'Okoro', 'Lund', 'Ferris', 'Adeyemi', 'Novak', 'Reyes', 'Sato', 'Braun', 'Kaur',
  'Moreau', 'Chen', 'Halloran', 'Ibarra', 'Weiss', 'Dubois'];

/* task states — these map 1:1 onto behaviours in the city */
const ST = {
  INBOUND: 'inbound',   // arriving from outside the city, driving to its building
  QUEUED: 'queued',     // arrived, but the project is at its WIP limit — parked outside
  ACTIVE: 'active',     // working: circulating around its block
  BLOCKED: 'blocked',   // parked on a dependency road, causing a jam
  REVIEW: 'review',     // heading to the reviewer's building
  DONE: 'done',         // absorbed by the building; rises as light
};

const SIZES = [
  { key: 'S', hours: 3, mass: 1.0, kind: 'walk' },
  { key: 'M', hours: 8, mass: 2.2, kind: 'car' },
  { key: 'L', hours: 21, mass: 4.0, kind: 'truck' },
  { key: 'XL', hours: 40, mass: 6.5, kind: 'truck' },
];

let _id = 0;
const uid = (p) => `${p}${(++_id).toString(36)}`;

function makePerson(teamId) {
  return { id: uid('p'), name: `${pick(FIRST)} ${pick(LAST)}`, team: teamId, load: 0 };
}

function makeTask(project, org, forceState) {
  const size = pick(SIZES.slice(0, chance(0.55) ? 2 : 4));
  const person = pick(org.teams[project.team].people);
  const t = {
    id: uid('t'),
    title: `${pick(VERBS)} ${pick(NOUNS)}`,
    project: project.id,
    team: project.team,
    size: size.key,
    mass: size.mass,
    kind: size.kind,
    hours: size.hours,
    done: 0,                       // 0..1 progress on this task
    owner: person.id,
    ownerName: person.name,
    state: forceState || ST.INBOUND,
    blockedBy: null,
    age: 0,
    heat: 1,                       // decays; recent activity keeps it bright
    createdDay: org.day,
    log: [],
  };
  t.log.push({ day: org.day, text: 'created' });
  return t;
}

function buildOrg() {
  seed(0x51C17E);
  const org = {
    name: 'MERIDIAN',
    day: 0.30,
    intake: 1,           // the valve on new work coming off the coast
    incidents: [],
    teams: [],
    projects: [],
    tasks: [],
    deps: [],            // {from: projectId, to: projectId}
    byId: {},
    shipped: 0,
    events: [],
  };

  TEAM_DEFS.forEach((def, i) => {
    const team = { ...def, id: i, people: [], projects: [], pressure: 0, morale: 0.7 };
    const headcount = ri(5, 9);
    for (let k = 0; k < headcount; k++) team.people.push(makePerson(i));
    org.teams.push(team);
  });

  org.teams.forEach((team) => {
    const names = shuffle(PROJECT_NAMES[team.tag].slice());
    const count = Math.min(names.length, ri(3, 5));
    for (let i = 0; i < count; i++) {
      const nMile = ri(4, 8);
      const p = {
        id: uid('P'),
        name: names[i],
        team: team.id,
        scale: rr(0.55, 1),                 // physical prominence
        milestones: MILESTONES.slice(0, nMile).map((m) => ({ name: m, done: false })),
        built: 0,                            // completed milestones (float, animates)
        progress: 0,                         // 0..1 overall
        deadlineDay: rr(2.5, 26),
        tasks: [],
        risk: 0,
        priority: 1,
        focusUntil: 0,
        wip: 0,              // 0 = no limit
        incident: null,
        lastShip: -99,
        activity: 0,
      };
      // seed some completed milestones so the city isn't uniformly new
      const pre = ri(0, nMile - 2);
      for (let m = 0; m < pre; m++) p.milestones[m].done = true;
      p.built = pre;
      team.projects.push(p.id);
      org.projects.push(p);
      org.byId[p.id] = p;
    }
  });

  // dependencies: each project may depend on 0-2 others, biased cross-team
  org.projects.forEach((p) => {
    const n = chance(0.82) ? ri(1, 3) : 0;
    for (let i = 0; i < n; i++) {
      const other = pick(org.projects);
      if (other.id === p.id) continue;
      if (org.deps.some((d) => d.from === other.id && d.to === p.id)) continue;
      if (org.deps.some((d) => d.from === p.id && d.to === other.id)) continue;
      org.deps.push({ id: uid('D'), from: other.id, to: p.id, weight: rr(0.4, 1), edges: null });
    }
  });

  // tasks
  org.projects.forEach((p) => {
    const n = ri(4, 9);
    for (let i = 0; i < n; i++) {
      const t = makeTask(p, org, chance(0.90) ? ST.ACTIVE : ST.INBOUND);
      if (t.state === ST.ACTIVE) t.done = rr(0, 0.7);
      p.tasks.push(t.id);
      org.tasks.push(t);
      org.byId[t.id] = t;
    }
    // a couple of blockers to start with
    if (chance(0.7)) {
      const upstream = org.deps.filter((d) => d.to === p.id);
      const t = org.byId[pick(p.tasks)];
      if (upstream.length && t) { t.state = ST.BLOCKED; t.blockedBy = pick(upstream).from; }
    }
  });

  org.projects.forEach((p) => recomputeProject(p, org));
  return org;
}

function recomputeProject(p, org) {
  const tasks = p.tasks.map((id) => org.byId[id]).filter(Boolean);
  const open = tasks.filter((t) => t.state !== ST.DONE);
  const mileDone = p.milestones.filter((m) => m.done).length;
  const taskProg = tasks.length ? tasks.reduce((s, t) => s + (t.state === ST.DONE ? 1 : t.done), 0) / tasks.length : 0;
  p.progress = clamp(mileDone / p.milestones.length * 0.7 + taskProg * 0.3);
  const remaining = open.reduce((s, t) => s + t.hours * (1 - t.done), 0);
  const daysLeft = p.deadlineDay - org.day;
  const capacity = Math.max(1, org.teams[p.team].people.length * 1.15);
  // risk 0 = comfortable, 1 = on the edge, >1 = late
  p.risk = clamp(remaining / capacity / Math.max(0.45, daysLeft), 0, 1.6);
  if (daysLeft < -1.5 && p.progress < 1) { p.deadlineDay = org.day + rr(4, 12); p.slipped = (p.slipped || 0) + 1; }
  p.blocked = open.filter((t) => t.state === ST.BLOCKED).length;
  p.openCount = open.length;
  p.activeCount = open.filter((t) => t.state === ST.ACTIVE).length;
  p.queued = open.filter((t) => t.state === ST.QUEUED).length;
  p.atLimit = p.wip > 0 && p.activeCount >= p.wip;
  return p;
}

function orgStats(org) {
  let open = 0, blocked = 0, active = 0, risk = 0, late = 0;
  org.projects.forEach((p) => {
    open += p.openCount; blocked += p.blocked; active += p.activeCount;
    risk += p.risk;
    if (p.deadlineDay < org.day && p.progress < 1) late++;
  });
  return {
    open, blocked, active, late,
    risk: org.projects.length ? risk / org.projects.length : 0,
    shipped: org.shipped,
  };
}

/* ---------- the event stream -------------------------------
   The city is driven by discrete events, never by mutation of
   render state. Each event returns a description the HUD can
   narrate, and the simulation turns it into motion.
------------------------------------------------------------ */
function stepOrg(org, dt, sim) {
  org.day += dt / SEC_PER_DAY;

  org.tasks.forEach((t) => {
    t.age += dt;
    t.heat = Math.max(0, t.heat - dt * 0.035);
    if (t.state === ST.ACTIVE) {
      const p = org.byId[t.project];
      if (p.incident) return;                       // nothing moves while it is down
      const morale = org.teams[t.team].morale;
      const rate = (1 / (t.hours * SEC_PER_HOUR)) * dt *
        (p.priority || 1) * (t.boost || 1) * (0.5 + morale * 0.7);
      t.done = clamp(t.done + rate);
      p.activity = Math.min(1, p.activity + dt * 0.12);
      if (t.done >= 1) queueEvent(org, { type: 'complete', task: t.id });
    }
  });

  org.projects.forEach((p) => {
    p.activity = Math.max(0, p.activity - dt * 0.05);
    // deliberate pushes wear off, so the city drifts back on its own
    if (p.focusUntil && org.day > p.focusUntil) { p.priority = 1; p.focusUntil = 0; }
    recomputeProject(p, org);
  });
  org.tasks.forEach((t) => {
    if (t.boost) { t.boost = Math.max(1, t.boost - dt * 0.06); if (t.boost <= 1.01) t.boost = 0; }
  });
  org.teams.forEach((tm) => {
    if (tm.crunchUntil && org.day > tm.crunchUntil) tm.crunchUntil = 0;
    // morale recovers slowly, and never quite reaches contentment on its own
    const target = tm.crunchUntil ? 0.32 : 0.78;
    tm.morale = clamp(tm.morale + (target - tm.morale) * dt * 0.02, 0.05, 1);
  });

  // retire old finished work so a long session does not grow without bound
  if (org.tasks.length > 420) {
    const spent = org.tasks.filter((t) => t.state === ST.DONE);
    spent.sort((a, b) => a.createdDay - b.createdDay);
    for (const t of spent.slice(0, org.tasks.length - 380)) {
      const p = org.byId[t.project];
      if (p) p.tasks = p.tasks.filter((id) => id !== t.id);
      delete org.byId[t.id];
      t.retired = true;
    }
    org.tasks = org.tasks.filter((t) => !t.retired);
  }

  // each kind of event runs on its own clock, so the city can be
  // balanced directly instead of by fighting over one dice roll
  if (!org._acc) org._acc = { arrive: 0, block: 0, unblock: 0, review: 0, milestone: 0, incident: 0 };
  if (org._acc.incident === undefined) org._acc.incident = 0;
  for (const kind in EVENT_RATE) {
    const scale = kind === 'arrive' ? org.intake : 1;
    org._acc[kind] += dt * EVENT_RATE[kind] * scale;
    while (org._acc[kind] >= 1) { org._acc[kind] -= 1; fireEvent(org, kind); }
  }
  return drainEvents(org);
}

function queueEvent(org, ev) { org.events.push(ev); }
function drainEvents(org) { const e = org.events; org.events = []; return e; }

/* events per second, across the whole city. These are the dials
   that decide whether the city fills up or drains away. */
const EVENT_RATE = {
  arrive: 0.78,     // new work off the highway (scaled by org.intake)
  block: 0.055,     // something stalls on a dependency
  unblock: 0.110,   // something gets cleared
  review: 0.09,     // work goes out for review
  milestone: 0.018, // a floor gets added somewhere
  incident: 0.008,  // something falls over and demands an answer
};
const OPEN_CEILING = 190;

function fireEvent(org, kind) {
  const open = org.tasks.filter((t) => t.state !== ST.DONE);
  const R = Math.random;

  if (kind === 'arrive') {
    if (open.length >= OPEN_CEILING) return;
    // work lands where there is capacity and pressure, not uniformly
    const weighted = [];
    org.projects.forEach((p) => {
      if (p.progress >= 1) return;
      const w = 1 + p.risk * 1.5 + (p.priority > 1 ? 1.5 : 0);
      for (let i = 0; i < Math.ceil(w); i++) weighted.push(p);
    });
    const p = weighted.length ? weighted[Math.floor(R() * weighted.length)]
      : org.projects[Math.floor(R() * org.projects.length)];
    queueEvent(org, { type: 'arrive', project: p.id });
    return;
  }
  if (kind === 'block') {
    const cands = open.filter((t) => t.state === ST.ACTIVE &&
      org.deps.some((d) => d.to === t.project));
    if (!cands.length) return;
    const t = cands[Math.floor(R() * cands.length)];
    const ups = org.deps.filter((d) => d.to === t.project);
    queueEvent(org, { type: 'block', task: t.id, by: ups[Math.floor(R() * ups.length)].from });
    return;
  }
  if (kind === 'unblock') {
    const cands = open.filter((t) => t.state === ST.BLOCKED);
    if (!cands.length) return;
    // the ones that have waited longest clear first
    cands.sort((a, b) => b.age - a.age);
    const pickFrom = cands.slice(0, Math.max(1, Math.ceil(cands.length / 2)));
    queueEvent(org, { type: 'unblock', task: pickFrom[Math.floor(R() * pickFrom.length)].id });
    return;
  }
  if (kind === 'review') {
    const cands = open.filter((t) => t.state === ST.ACTIVE && t.done > 0.5);
    if (!cands.length) return;
    queueEvent(org, { type: 'review', task: cands[Math.floor(R() * cands.length)].id });
    return;
  }
  if (kind === 'incident') {
    if (org.incidents.length >= 2) return;      // never more than two fires at once
    const cands = org.projects.filter((p) => !p.incident && p.progress > 0.1 && p.progress < 1);
    if (!cands.length) return;
    // the projects carrying the most load are the ones that fall over
    const weighted = [];
    cands.forEach((p) => {
      const w = 1 + p.risk * 2 + p.activeCount * 0.15;
      for (let i = 0; i < Math.ceil(w); i++) weighted.push(p);
    });
    queueEvent(org, { type: 'incident', project: weighted[Math.floor(R() * weighted.length)].id });
    return;
  }
  if (kind === 'milestone') {
    const cands = org.projects.filter((p) => p.milestones.some((m) => !m.done) && p.progress > 0.15);
    if (!cands.length) return;
    // whichever project has done the most work earns the floor
    cands.sort((a, b) => b.progress - a.progress);
    const top = cands.slice(0, Math.max(1, Math.ceil(cands.length / 3)));
    queueEvent(org, { type: 'milestone', project: top[Math.floor(R() * top.length)].id });
  }
}

const SEC_PER_DAY = 78;    // one simulated day of deadline pressure
const SEC_PER_HOUR = 22.0; // one task-hour of effort
