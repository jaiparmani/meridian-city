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
      const t = makeTask(p, org, chance(0.72) ? ST.ACTIVE : ST.INBOUND);
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
      const rate = (1 / (t.hours * SEC_PER_HOUR)) * dt;
      t.done = clamp(t.done + rate);
      p.activity = Math.min(1, p.activity + dt * 0.12);
      if (t.done >= 1) queueEvent(org, { type: 'complete', task: t.id });
    }
  });

  org.projects.forEach((p) => {
    p.activity = Math.max(0, p.activity - dt * 0.05);
    recomputeProject(p, org);
  });

  // stochastic events, scaled by city size
  org._acc = (org._acc || 0) + dt;
  while (org._acc > 1.6) {
    org._acc -= 1.6;
    rollEvent(org);
  }
  return drainEvents(org);
}

function queueEvent(org, ev) { org.events.push(ev); }
function drainEvents(org) { const e = org.events; org.events = []; return e; }

function rollEvent(org) {
  const r = Math.random();
  const open = org.tasks.filter((t) => t.state !== ST.DONE);
  if (!open.length) return;

  if (r < 0.24) {
    // new work arrives from outside the city
    const p = org.projects[Math.floor(Math.random() * org.projects.length)];
    queueEvent(org, { type: 'arrive', project: p.id });
  } else if (r < 0.40) {
    // something gets blocked
    const cands = open.filter((t) => t.state === ST.ACTIVE);
    if (!cands.length) return;
    const t = cands[Math.floor(Math.random() * cands.length)];
    const ups = org.deps.filter((d) => d.to === t.project);
    if (!ups.length) return;
    queueEvent(org, { type: 'block', task: t.id, by: ups[Math.floor(Math.random() * ups.length)].from });
  } else if (r < 0.68) {
    // something gets unblocked
    const cands = open.filter((t) => t.state === ST.BLOCKED);
    if (!cands.length) return;
    queueEvent(org, { type: 'unblock', task: cands[Math.floor(Math.random() * cands.length)].id });
  } else if (r < 0.86) {
    // a task moves into review
    const cands = open.filter((t) => t.state === ST.ACTIVE && t.done > 0.5);
    if (!cands.length) return;
    queueEvent(org, { type: 'review', task: cands[Math.floor(Math.random() * cands.length)].id });
  } else {
    // a milestone lands — the building grows a floor
    const cands = org.projects.filter((p) => p.milestones.some((m) => !m.done) && p.progress > 0.1);
    if (!cands.length) return;
    queueEvent(org, { type: 'milestone', project: cands[Math.floor(Math.random() * cands.length)].id });
  }
}

const SEC_PER_DAY = 78;    // one simulated day of deadline pressure
const SEC_PER_HOUR = 7.0;  // one task-hour of effort
