/* ============================================================
   explain.js — nothing on screen should be unexplained.

   One body of copy, delivered two ways: as a hover line when
   you point at an instrument, and as a labelled exploded view
   when you hold the whole interface up to the light (X).

   The HUD registers a spot each time it draws something; this
   file owns what that thing means.
   ============================================================ */
'use strict';

/* what each instrument is, and what a bad reading looks like */
const EXPLAIN = {
  'org.name':    ['THE ORGANISATION', 'Its name, the day, and the weather it is having. The day advances on its own; deadlines are measured against it.'],
  'org.weather': ['WEATHER', 'Deadline pressure across every project. Above ~40% brings cloud, above ~60% rain and storms over the districts causing it.'],
  'ladder':      ['ALTITUDE', 'Where you are on the zoom ladder, from the whole organisation down to one person walking.'],
  'rail':        ['ALTITUDE RAIL', 'The same five rungs, vertically. Scroll to move between them, or press 1–5 to jump.'],
  'compass':     ['COMPASS', 'Which way north is. Shift-drag or Q and E to rotate the city.'],
  'feed':        ['SIGNAL', 'What the city has done recently. Lines marked ▸ in amber are commands you gave; the rest is the city acting on its own.'],
  'pulse':       ['CITY PULSE', 'Work finished over the last few minutes. A flat line means nothing is landing — usually everything is blocked or waiting.'],
  'count.active':  ['ACTIVE', 'Tasks being worked right now. These are the vehicles circulating their block. Healthy is roughly 80–120 for a city this size.'],
  'count.blocked': ['BLOCKED', 'Tasks parked on a dependency, each one damming a road. Past about 20 the arteries start to seize and everything slows.'],
  'count.open':    ['OPEN', 'Everything unfinished: active, arriving, blocked, waiting, in review. Arrivals stop at 190.'],
  'count.shipped': ['SHIPPED', 'Work completed since the city was built. Each one flew downtown as a mote of light and charged the spire.'],
  'intake':      ['INTAKE VALVE', 'How fast new work enters the city at all. Close it and the coast roads empty while the backlog drains. Drag it, or use [ and ].'],
  'time':        ['TIME', 'Hold the clock, or run it from a quarter speed up to four times. Fast-forward takes more small steps rather than bigger ones, so traffic still behaves.'],
  'sound':       ['SOUND', 'The city synthesised — traffic, jams, rain, sirens, a bell when a milestone lands. Nothing plays until you ask.'],
  'panel.milestones': ['MILESTONE LADDER', 'The floors of the building, bottom to top. Filled rungs have shipped; each one that lands raises the tower by a storey.'],
  'panel.swarm':      ['TASK SWARM', 'Every task on this project as a dot. The inner ring is done, the middle is moving, the outer ring is blocked. Dot size is the estimate.'],
  'panel.deadline':   ['DEADLINE', 'How long until this project is due. It turns amber inside six days and red once it is overdue, and the weather above the district follows it.'],
  'panel.risk':       ['LOAD', 'Remaining work against the time and people available. A full arc means this project cannot land on time at the current rate.'],
  'panel.wip':        ['WORK IN PROGRESS', 'The cap you set, and how many are waiting at the kerb because of it. Capping pushes the least-finished work back out.'],
  'panel.morale':     ['MORALE', 'Multiplies everything this team gets done. Crunch spends it, rest restores it. Below a third, people start leaving the city for good.'],
  /* things in the world, labelled only in the exploded view */
  'w.core':      ['THE SPIRE', 'The organisation itself. One ring per team, brightening as work lands and turning from cyan to ember as risk climbs.'],
  'w.building':  ['A STRUCTURE', 'A project. Floors are milestones shipped and lit windows are progress. The roof beacon blinks red if anything inside is blocked.'],
  'w.agent':     ['A TASK', 'Someone carrying a piece of work. Its estimate is its mass — a big task is a truck and accelerates like one.'],
  'w.road':      ['A ROAD', 'A dependency between two projects, routed through streets that actually exist. It reddens when work stalls on it.'],
  'w.district':  ['A NEIGHBOURHOOD', 'A team. The ground runs from their colour toward ember as their load rises.'],
};

const explain = {
  spots: [],
  mode: false,
  fade: 0,
  hover: null,

  reset() { this.spots = []; },

  /* the HUD calls this as it draws each instrument */
  spot(key, x, y, w, h) {
    if (!EXPLAIN[key]) return;
    this.spots.push({ key, x, y, w, h });
  },

  at(mx, my) {
    // last registered wins, so things drawn on top are found first
    for (let i = this.spots.length - 1; i >= 0; i--) {
      const s = this.spots[i];
      if (mx >= s.x && mx <= s.x + s.w && my >= s.y && my <= s.y + s.h) return s;
    }
    return null;
  },

  toggle() {
    this.mode = !this.mode;
    return this.mode;
  },

  update(dt) {
    this.fade = damp(this.fade, this.mode ? 1 : 0, this.mode ? 5 : 8, dt);
  },

  text(key) { return EXPLAIN[key] || null; },
  lastDrawn: 0,
};
