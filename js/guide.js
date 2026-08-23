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
  waiting: false,
  waitFrom: 0,
  subject: null,

  seen() {
    try { return !!localStorage.getItem(GUIDE_KEY); } catch (e) { return false; }
  },
  markSeen() {
    try { localStorage.setItem(GUIDE_KEY, String(Date.now())); } catch (e) { /* fine */ }
  },

  start(sim, city, org, ui) {
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
    for (let guard = 0; guard < BEATS.length + 2; guard++) {
      this.step++;
      if (this.step >= BEATS.length) { this.stop(ui, sim); return; }
      const beat = BEATS[this.step];
      const aim = beat.aim(sim, city, org);
      if (!aim) continue;                       // nothing to show; try the next
      this.t = 0;
      this.waiting = false;
      this.subject = aim;
      this.title = typeof beat.title === 'function' ? beat.title(aim, org) : beat.title;
      this.body = typeof beat.body === 'function' ? beat.body(aim, org, sim) : beat.body;
      this.interactive = !!beat.interactive;
      this.hold = beat.hold || 8;
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

    // an interactive beat ends when they actually do something
    if (this.waiting) {
      if (sim.commands > this.waitFrom) {
        this.waiting = false;
        this.t = 0;
        this.hold = 3.2;
        this.body = BEATS[this.step].after || 'Exactly that.';
        this.title = BEATS[this.step].afterTitle || this.title;
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
    title: 'THAT IS THE TOUR',
    body: 'Scroll to change altitude, drag to move, click anything to command it. '
        + 'Press I to build the city out of your own work, and H for the legend. '
        + 'Leave it alone and it will start showing itself to you.',
    hold: 10,
    aim: () => ({ x: 0, y: 30, s: 0.95 }),
  },
];
