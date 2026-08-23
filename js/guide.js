/* ============================================================
   guide.js — the first ninety seconds.

   A city is not self-explanatory. This flies you to each thing
   in turn and says what it is, then stands back and asks you to
   do one thing yourself. Runs once, skippable, replayable.
   ============================================================ */
'use strict';

const GUIDE_KEY = 'meridian.guided.v1';

const guide = {
  active: false,
  step: 0,
  t: 0,
  fade: 0,
  done: false,
  buttons: [],
  script: null,
  which: 'read',
  waiting: false,
  waitFrom: 0,
  subject: null,

  seen() {
    try { return !!localStorage.getItem(GUIDE_KEY); } catch (e) { return false; }
  },
  markSeen() {
    try { localStorage.setItem(GUIDE_KEY, String(Date.now())); } catch (e) { /* fine */ }
  },

  start(sim, city, org, ui, which) {
    this.which = which === 'run' ? 'run' : 'read';
    this.script = this.which === 'run' ? RUN_BEATS : BEATS;
    this.active = true;
    this.step = -1;
    this.t = 0;
    this.done = false;
    ui.help = false;
    tour.stop();
    tour.idle = -1e6;               // the idle tour must not butt in
    this.advance(sim, city, org, ui);
  },

  stop(ui, sim) {
    if (!this.active) return;
    this.active = false;
    this.waiting = false;
    this.buttons = [];
    this.markSeen();
    tour.idle = 0;
    if (ui) ui.selected = null;
    if (sim) sim.linkFrom = null;
  },

  /* move to the next beat, skipping any that have nothing to point at */
  advance(sim, city, org, ui) {
    const script = this.script || BEATS;
    for (let guard = 0; guard < script.length + 2; guard++) {
      this.step++;
      if (this.step >= script.length) { this.stop(ui, sim); return; }
      const beat = script[this.step];
      if (beat.setup) { try { beat.setup(sim, city, org); } catch (e) { /* a beat that cannot set up just gets skipped */ } }
      const aim = beat.aim(sim, city, org);
      if (!aim) continue;                       // nothing to show; try the next
      this.t = 0;
      this.waiting = false;
      this.subject = aim;
      this.title = typeof beat.title === 'function' ? beat.title(aim, org) : beat.title;
      this.body = typeof beat.body === 'function' ? beat.body(aim, org, sim) : beat.body;
      this.interactive = !!beat.interactive;
      this.offer = beat.offer || null;
      this.hold = beat.hold || 8;
      this.mark = beat.mark ? beat.mark(sim, org, aim) : null;
      ui.selected = aim.select || null;
      if (aim.select) {
        ui.focusTeam = aim.select.type === 'project' ? org.byId[aim.select.id].team
          : aim.select.type === 'team' ? aim.select.id : null;
      } else ui.focusTeam = null;
      flyTo(aim.x, aim.y, aim.s, !!aim.follow);
      cam.follow = aim.follow || null;
      if (beat.interactive) {
        this.waiting = true;
        this.waitFrom = sim.commands;
      }
      return;
    }
    this.stop(ui, sim);
  },

  update(dt, sim, city, org, ui) {
    this.fade = damp(this.fade, this.active ? 1 : 0, this.active ? 3 : 8, dt);
    if (!this.active) return;
    this.t += dt;
    if (ui.loader) return;

    // an interactive beat ends when they actually do the thing
    if (this.waiting) {
      const beat = (this.script || BEATS)[this.step];
      let ok = false;
      try {
        ok = beat.done ? beat.done(sim, org, this.mark) : sim.commands > this.waitFrom;
      } catch (e) { ok = sim.commands > this.waitFrom; }
      if (ok) {
        this.waiting = false;
        this.t = 0;
        this.hold = 4.2;
        this.body = beat.after || 'Exactly that.';
        this.title = beat.afterTitle || this.title;
      }
      return;
    }
    if (this.t > this.hold) this.advance(sim, city, org, ui);
  },
};

/* ---------- the beats ------------------------------------- */
const BEATS = [
  {
    title: 'THIS IS AN ORGANISATION',
    body: 'Not a list of it — the thing itself. Every structure below is a project, '
        + 'every vehicle is a task, and the roads between them are dependencies.',
    hold: 9,
    aim: () => ({ x: 0, y: 30, s: 0.95 }),
  },
  {
    title: (a, org) => `${org.byId[a.select.id].name.toUpperCase()} — A PROJECT`,
    body: (a, org) => {
      const p = org.byId[a.select.id];
      const done = p.milestones.filter((m) => m.done).length;
      return `Each floor is a milestone that shipped — this one is ${done} of ${p.milestones.length} storeys up. `
           + `The lit windows are progress, filling from the ground. It is ${(p.progress * 100) | 0}% done.`;
    },
    hold: 10,
    aim: (sim, city, org) => {
      const p = org.projects.slice().sort((a, b) => b.progress - a.progress)[0];
      const b = p && city.byProject[p.id];
      if (!b) return null;
      return { x: b.x, y: b.y, s: 4.4, select: { type: 'project', id: p.id } };
    },
  },
  {
    title: 'EVERY VEHICLE IS A TASK',
    body: (a, org, sim) => {
      const t = a.follow.task;
      const kind = t.kind === 'walk' ? 'someone on foot' : t.kind === 'truck' ? 'a truck' : 'a van';
      return `${t.ownerName} is carrying "${t.title}". Its estimate is its mass — `
           + `${t.hours} hours makes it ${kind}, and heavy work is slow to start and slow to stop.`;
    },
    hold: 11,
    aim: (sim) => {
      const live = sim.agents.filter((x) => !x.resident && !x.dead && x.path && x.speed > 2
        && x.task.state !== ST.BLOCKED);
      if (!live.length) return null;
      live.sort((p, q) => q.mass - p.mass);
      const a = live[0];
      return { x: a.x, y: a.y, s: 11, follow: a, select: { type: 'task', id: a.task.id } };
    },
  },
  {
    title: 'BLOCKED WORK IS A TRAFFIC JAM',
    body: 'This task did not turn red on a board. It drove to the thing it is waiting for '
        + 'and parked. Everything behind it queues, and the congestion spreads down every '
        + 'road it touches until someone clears it.',
    hold: 11,
    aim: (sim, city, org) => {
      let worst = null;
      for (const e of city.edges) if (e.jam > 0.45 && (!worst || e.jam > worst.jam)) worst = e;
      if (worst) {
        const a = city.nodes[worst.a], b = city.nodes[worst.b];
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, s: 7.5 };
      }
      const t = org.tasks.find((x) => x.state === ST.BLOCKED);
      const ag = t && sim.byTask[t.id];
      if (!ag) return null;
      return { x: ag.x, y: ag.y, s: 9, select: { type: 'task', id: t.id } };
    },
  },
  {
    title: (a, org) => `${org.teams[a.select.id].name.toUpperCase()} — A TEAM`,
    body: (a, org, sim) => {
      const d = sim.city.districts[a.select.id];
      return `A team is a neighbourhood. The ground runs from their colour toward ember as the load rises — `
           + `this one is at ${(d.pressure * 100) | 0}%. Push it far enough and the weather over it turns.`;
    },
    hold: 10,
    aim: (sim, city) => {
      const d = city.districts.slice().sort((a, b) => b.pressure - a.pressure)[0];
      if (!d) return null;
      return { x: d.cx, y: d.cy, s: 1.8, select: { type: 'team', id: d.team } };
    },
  },
  {
    title: 'DEADLINES MAKE THE WEATHER',
    body: 'Nothing here is decoration. Pressure from approaching deadlines builds cloud, '
        + 'then rain, then storm cells that drift over the district causing them. '
        + 'A clear sky means the work is comfortable.',
    hold: 9,
    aim: (sim, city) => ({ x: 0, y: 30, s: 1.1 }),
  },
  {
    title: 'COMMANDS ORBIT WHAT THEY ACT ON',
    body: 'Select anything and its commands appear around it. Ship a milestone and the tower '
        + 'grows a floor. Cap work in progress and the excess parks at the kerb. '
        + 'You reach for the city, not for a toolbar.',
    hold: 11,
    aim: (sim, city, org) => {
      const p = org.projects.slice().sort((a, b) => b.activeCount - a.activeCount)[0];
      const b = p && city.byProject[p.id];
      if (!b) return null;
      return { x: b.x, y: b.y, s: 4.2, select: { type: 'project', id: p.id } };
    },
  },
  {
    title: 'YOUR TURN',
    body: 'This one is blocked, and the road behind it is backing up. '
        + 'Click ⊘ CLEAR in the ring around it and watch the queue drain.',
    afterTitle: 'THAT IS THE WHOLE IDEA',
    after: 'Every command does something you can watch happen, and the city carries the consequence.',
    hold: 30,
    interactive: true,
    aim: (sim, city, org) => {
      const t = org.tasks.find((x) => x.state === ST.BLOCKED && sim.byTask[x.id]);
      if (!t) return null;
      const a = sim.byTask[t.id];
      return { x: a.x, y: a.y, s: 9.5, select: { type: 'task', id: t.id } };
    },
  },
  {
    title: 'THAT IS HOW TO READ IT',
    body: 'Scroll to change altitude, drag to move, click anything to command it. '
        + 'X labels everything on screen, I builds the city from your own work, '
        + 'H is the legend. Leave it alone and it will start showing itself to you.',
    hold: 14,
    offer: 'run',
    aim: () => ({ x: 0, y: 30, s: 0.95 }),
  },
];

/* ---------- the second walkthrough: how to run it ---------
   The first tour teaches you to read the city. This one puts
   your hands on it, and makes you feel what each lever costs.
---------------------------------------------------------- */
const RUN_BEATS = [
  {
    title: 'THE CITY HAS VITAL SIGNS',
    body: 'Bottom left: what is moving, what is stuck, what is open and what has shipped. '
        + 'Above them, the pulse is work landing over time — a flat line means nothing is '
        + 'getting out. Point at any instrument to have it explain itself, or press X to '
        + 'label everything at once.',
    hold: 13,
    aim: () => ({ x: 0, y: 30, s: 0.95 }),
  },
  {
    title: 'STOP STARTING, START FINISHING',
    body: 'This project has a lot in flight at once. Press ≡ WIP to cap it.',
    afterTitle: 'THE EXCESS WENT BACK OUTSIDE',
    after: 'The work over the cap drove back and parked at the kerb — least finished first. '
         + 'None of it progresses while it sits there. Free a slot and the front of the queue pulls in.',
    hold: 40,
    interactive: true,
    mark: (sim, org, aim) => aim.select.id,
    done: (sim, org, id) => !!(org.byId[id] && org.byId[id].wip > 0),
    aim: (sim, city, org) => {
      const p = org.projects.slice().sort((a, b) => b.activeCount - a.activeCount)[0];
      const b = p && city.byProject[p.id];
      if (!b) return null;
      return { x: b.x, y: b.y, s: 4.6, select: { type: 'project', id: p.id } };
    },
  },
  {
    title: 'THE VALVE ON NEW WORK',
    body: 'Bottom left, above the pulse: this is how fast work enters the city at all. '
        + 'Close it — drag it down, or press [ a few times — and watch the coast roads empty.',
    afterTitle: 'THE GATES ARE CLOSING',
    after: 'Nothing new is arriving now, so the backlog will drain. Open it past 100% and the '
         + 'highways flood instead. It is the city\'s metabolism, and it is yours to set.',
    hold: 40,
    interactive: true,
    done: (sim, org) => org.intake < 0.62,
    aim: () => ({ x: 0, y: 30, s: 1.05 }),
  },
  {
    title: 'SPEED IS BORROWED, NOT FREE',
    body: 'This neighbourhood is under load. Press ◈ CRUNCH and everything here moves faster.',
    afterTitle: 'MORALE JUST PAID FOR IT',
    after: 'Watch the morale bar. It recovers slowly on its own, faster if you ☾ REST them — '
         + 'which costs output while it lasts. Let it fall below a third and people leave the city.',
    hold: 40,
    interactive: true,
    mark: (sim, org, aim) => org.teams[aim.select.id].morale,
    done: (sim, org, was) => org.teams.some((t) => t.morale < was - 0.08),
    aim: (sim, city, org) => {
      const d = city.districts.slice().sort((a, b) => b.pressure - a.pressure)[0];
      if (!d) return null;
      return { x: d.cx, y: d.cy, s: 1.9, select: { type: 'team', id: d.team } };
    },
  },
  {
    title: 'SOMETHING IS DOWN',
    body: 'A structure has failed. Everything inside it has stopped and responders are on '
        + 'their way. Press ⚠ RESPOND to bring it back.',
    afterTitle: 'BACK UP',
    after: 'Ignore one for ninety seconds and it burns out on its own: a floor comes off the '
         + 'tower, the milestone is un-shipped, the deadline pulls in, and the team wears it.',
    hold: 40,
    interactive: true,
    setup: (sim, city, org) => {
      if (org.incidents.length) return;
      const p = org.projects.find((x) => !x.incident && x.progress > 0.1);
      if (p) sim.startIncident(p);
    },
    mark: (sim, org) => (org.incidents[0] ? org.incidents[0].project : null),
    done: (sim, org, id) => !id || !(org.byId[id] && org.byId[id].incident),
    aim: (sim, city, org) => {
      const inc = org.incidents[0];
      const b = inc && city.byProject[inc.project];
      if (!b) return null;
      return { x: b.x, y: b.y, s: 4.4, select: { type: 'project', id: inc.project } };
    },
  },
  {
    title: 'YOU CAN LAY ROADS TOO',
    body: 'Press ⇉ LINK, then click any other structure. A dependency is created and the road '
        + 'is built between them, section by section.',
    afterTitle: 'THE ROAD IS GOING IN',
    after: 'A survey line runs ahead of the paving, and traffic uses it the moment it connects. '
         + '✂ CUT demolishes one again and releases whatever was waiting on it.',
    hold: 45,
    interactive: true,
    mark: (sim, org) => org.deps.length,
    done: (sim, org, was) => org.deps.length > was,
    aim: (sim, city, org) => {
      const p = org.projects.slice().sort((a, b) => a.progress - b.progress)[0];
      const b = p && city.byProject[p.id];
      if (!b) return null;
      return { x: b.x, y: b.y, s: 3.6, select: { type: 'project', id: p.id } };
    },
  },
  {
    title: 'EVERYTHING HAS A COST',
    body: 'Nothing you press is free, and the city carries the consequence rather than '
        + 'reporting it. Leave it alone and every effect wears off — it drifts back to its own '
        + 'equilibrium without you. Shift+G replays this; G replays how to read it.',
    hold: 13,
    aim: () => ({ x: 0, y: 30, s: 0.95 }),
  },
];
