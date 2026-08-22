/* ============================================================
   tour.js — when nobody is driving, the city shows itself.
   After a stretch of no input the camera starts flying between
   whatever is most interesting right now, naming what it finds.
   Any input at all hands control straight back.
   ============================================================ */
'use strict';

const TOUR_IDLE = 20;      // seconds of stillness before it takes over
const TOUR_HOLD = 9;       // seconds per stop

const tour = {
  active: false,
  idle: 0,
  hold: 0,
  fade: 0,
  caption: '',
  sub: '',
  last: null,

  poke() {
    this.idle = 0;
    if (this.active) this.stop();
  },
  stop() {
    if (!this.active) return;
    this.active = false;
    this.hold = 0;
    if (typeof cam !== 'undefined') cam.follow = null;
  },

  update(dt, sim, city, org, ui) {
    if (ui.loader || ui.help) { this.idle = 0; this.fade = damp(this.fade, 0, 8, dt); return; }
    this.idle += dt;
    if (!this.active && this.idle > TOUR_IDLE) {
      this.active = true;
      this.hold = 0;
      this.last = null;
    }
    this.fade = damp(this.fade, this.active ? 1 : 0, this.active ? 2.2 : 8, dt);
    if (!this.active) return;

    this.hold -= dt;
    if (this.hold <= 0) {
      this.hold = TOUR_HOLD;
      this.next(sim, city, org, ui);
    }
  },

  /* pick the most interesting thing that is not what we just showed */
  next(sim, city, org, ui) {
    const stops = [];

    // something is on fire
    org.incidents.forEach((inc) => {
      const b = city.byProject[inc.project];
      if (b) stops.push({
        key: 'inc' + inc.project, weight: 100,
        x: b.x, y: b.y, s: 4.2,
        caption: `${inc.name.toUpperCase()} IS DOWN`,
        sub: 'responders on scene · the work inside has stopped',
      });
    });

    // the worst jam in the city
    let worst = null;
    for (const e of city.edges) {
      if (e.jam < 0.5) continue;
      if (!worst || e.jam > worst.jam) worst = e;
    }
    if (worst) {
      const a = city.nodes[worst.a], b = city.nodes[worst.b];
      stops.push({
        key: 'jam' + worst.id, weight: 55 + worst.jam * 20,
        x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, s: 7,
        caption: 'CONGESTION',
        sub: 'blocked work parked on a dependency · the queue is spreading',
      });
    }

    // the neighbourhood carrying the most
    const d = city.districts.slice().sort((p, q) => q.pressure - p.pressure)[0];
    if (d) stops.push({
      key: 'dist' + d.team, weight: 40 + d.pressure * 30,
      x: d.cx, y: d.cy, s: 1.8,
      caption: d.name.toUpperCase(),
      sub: `${(d.pressure * 100) | 0}% load · morale ${(org.teams[d.team].morale * 100) | 0}%`,
    });

    // whatever is furthest along
    const best = org.projects.slice().sort((p, q) => q.progress - p.progress)[0];
    if (best) {
      const b = city.byProject[best.id];
      if (b) stops.push({
        key: 'proj' + best.id, weight: 34,
        x: b.x, y: b.y, s: 4.6,
        caption: best.name.toUpperCase(),
        sub: `${(best.progress * 100) | 0}% · ${best.milestones.filter((m) => m.done).length} of ${best.milestones.length} floors up`,
      });
    }

    // a queue at the kerb, if anyone has capped their work
    const capped = org.projects.find((p) => p.queued > 1);
    if (capped) {
      const b = city.byProject[capped.id];
      if (b) stops.push({
        key: 'wip' + capped.id, weight: 60,
        x: b.x, y: b.y, s: 6.4,
        caption: `${capped.name.toUpperCase()} · WIP ${capped.activeCount}/${capped.wip}`,
        sub: `${capped.queued} waiting at the kerb`,
      });
    }

    // ride along with something
    const live = sim.agents.filter((a) => !a.resident && !a.dead && a.path && a.speed > 3);
    if (live.length) {
      const a = pick(live);
      stops.push({
        key: 'ride', weight: 45, follow: a,
        x: a.x, y: a.y, s: 12,
        caption: a.task.title.toUpperCase().slice(0, 34),
        sub: `${a.task.ownerName} · ${a.task.size} · ${a.task.state}`,
      });
    }

    // and the whole thing, from altitude
    stops.push({
      key: 'org', weight: 30,
      x: 0, y: 30, s: 0.95,
      caption: org.name,
      sub: `${org.projects.length} structures · ${org.tasks.filter((t) => t.state !== ST.DONE).length} open · ${org.shipped} shipped`,
    });

    const usable = stops.filter((st) => st.key !== this.last);
    const pool = usable.length ? usable : stops;
    let total = 0;
    pool.forEach((st) => (total += st.weight));
    let r = Math.random() * total, chosen = pool[pool.length - 1];
    for (const st of pool) { r -= st.weight; if (r <= 0) { chosen = st; break; } }

    this.last = chosen.key;
    this.caption = chosen.caption;
    this.sub = chosen.sub;
    flyTo(chosen.x, chosen.y, chosen.s, !!chosen.follow);
    cam.follow = chosen.follow || null;
    cam.tyaw += rr(-0.35, 0.35);
  },
};
