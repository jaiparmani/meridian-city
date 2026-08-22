/* ============================================================
   actions.js — what you can DO to the city.
   Every command has a physical consequence you can watch
   happen: a floor rises, a queue drains, vehicles arrive from
   the coast, a storm breaks up. No dialogs, no forms.
   ============================================================ */
'use strict';

/* each action: id, label, glyph, hint, scope, enabled(), run(), cool */
const ACTIONS = [
  /* ---------- structures (projects) --------------------- */
  {
    id: 'ship', scope: 'project', glyph: '▲', label: 'SHIP',
    hint: 'close a milestone — the tower gains a floor',
    cool: 6,
    enabled: (sim, p) => p.milestones.some((m) => !m.done),
    run: (sim, p) => {
      const m = p.milestones.find((x) => !x.done);
      m.done = true;
      const b = sim.city.byProject[p.id];
      sim.growBuilding(b, m.name);
      sim.say(`${p.name} · ${m.name} shipped`, sim.org.teams[p.team].hue, true);
    },
  },
  {
    id: 'surge', scope: 'project', glyph: '⇢', label: 'SURGE',
    hint: 'three new tasks drive in from the coast',
    cool: 8,
    enabled: () => true,
    run: (sim, p) => {
      for (let i = 0; i < 3; i++) {
        setTimeout(() => queueEvent(sim.org, { type: 'arrive', project: p.id }), i * 420);
      }
      sim.say(`${p.name} · surge inbound`, 190, true);
      const b = sim.city.byProject[p.id];
      sim.ring(b.x, b.y, 0, Math.max(b.w, b.d) * 2.2, 190, 0.7);
    },
  },
  {
    id: 'extend', scope: 'project', glyph: '⊕', label: 'EXTEND',
    hint: 'push the deadline out — the weather eases',
    cool: 10,
    enabled: (sim, p) => p.progress < 1,
    run: (sim, p) => {
      p.deadlineDay += 9;
      recomputeProject(p, sim.org);
      const d = sim.city.districts[p.team];
      d.pressure = Math.max(0, d.pressure - 0.3);
      d.storm = Math.max(0, d.storm - 0.35);
      d.clearing = 1;
      const b = sim.city.byProject[p.id];
      sim.ring(b.x, b.y, 0, Math.max(b.w, b.d) * 3.4, 190, 0.9);
      sim.say(`${p.name} · deadline moved +9d`, 190, true);
    },
  },
  {
    id: 'focus', scope: 'project', glyph: '✦', label: 'FOCUS',
    hint: 'prioritise it — work moves faster here',
    cool: 12,
    enabled: (sim, p) => (p.priority || 1) < 1.5,
    run: (sim, p) => {
      p.priority = 2.2;
      p.focusUntil = sim.org.day + 3.5;
      const b = sim.city.byProject[p.id];
      b.glow = 1.4;
      sim.ring(b.x, b.y, 0, Math.max(b.w, b.d) * 3, b.hue, 1.2);
      for (let i = 0; i < 14; i++) sim.spawnMote(b, buildingHeight(b) * rr(0.2, 1));
      sim.say(`${p.name} · prioritised`, 46, true);
    },
  },

  {
    id: 'wip', scope: 'project', glyph: '≡', label: 'WIP',
    hint: 'cap work in progress — the rest waits at the kerb',
    cool: 2,
    enabled: () => true,
    run: (sim, p) => {
      const steps = [0, 6, 4, 2];
      p.wip = steps[(steps.indexOf(p.wip) + 1) % steps.length];
      const b = sim.city.byProject[p.id];
      let pushed = 0;
      if (p.wip > 0) {
        // stop starting, start finishing: the excess is sent back to the kerb,
        // least-finished first, so the cap does something you can see at once
        const active = p.tasks.map((id) => sim.org.byId[id])
          .filter((t) => t && t.state === ST.ACTIVE)
          .sort((x, y) => x.done - y.done);
        const excess = Math.max(0, active.length - p.wip);
        for (let i = 0; i < excess; i++) {
          const t = active[i];
          t.state = ST.QUEUED;
          t.queuedAt = sim.org.day;
          t.log.push({ day: sim.org.day, text: 'sent back to the queue' });
          const a2 = sim.byTask[t.id];
          if (a2) sim.sendHome(a2, 'toBuilding');
          pushed++;
        }
      }
      recomputeProject(p, sim.org);
      sim.ring(b.x, b.y, 0, Math.max(b.w, b.d) * 2, p.wip ? 46 : 190, 0.6);
      sim.say(p.wip
        ? `${p.name} · WIP capped at ${p.wip}${pushed ? ` — ${pushed} sent back` : ''}`
        : `${p.name} · WIP uncapped`, 46, true);
    },
  },
  {
    id: 'respond', scope: 'project', glyph: '⚠', label: 'RESPOND',
    hint: 'answer the incident — bring it back up',
    cool: 2,
    enabled: (sim, p) => !!p.incident,
    run: (sim, p) => {
      const inc = sim.org.incidents.find((i) => i.project === p.id);
      if (inc) sim.endIncident(inc, true);
      sim.org.teams[p.team].morale = clamp(sim.org.teams[p.team].morale + 0.06, 0.05, 1);
    },
  },

  {
    id: 'link', scope: 'project', glyph: '⇉', label: 'LINK',
    hint: 'build a road — pick what this one waits on',
    cool: 3,
    enabled: (sim, p) => sim.org.projects.length > 1,
    run: (sim, p) => {
      // arming only; the second click picks the other end
      sim.linkFrom = p.id;
      sim.say(`${p.name} · pick a structure to depend on`, 190, true);
    },
  },
  {
    id: 'cut', scope: 'project', glyph: '✂', label: 'CUT',
    hint: 'demolish a road into this structure',
    cool: 5,
    enabled: (sim, p) => sim.org.deps.some((d) => d.to === p.id),
    run: (sim, p) => {
      const dep = sim.org.deps.filter((d) => d.to === p.id).pop();
      if (dep) sim.cutDependency(dep.id);
    },
  },

  /* ---------- tasks (the things in motion) --------------- */
  {
    id: 'clear', scope: 'task', glyph: '⊘', label: 'CLEAR',
    hint: 'unblock it — the queue behind it drains',
    cool: 3,
    enabled: (sim, t) => t.state === ST.BLOCKED,
    run: (sim, t) => {
      queueEvent(sim.org, { type: 'unblock', task: t.id });
      const a = sim.byTask[t.id];
      if (a) sim.ring(a.x, a.y, 0, 60, 150, 1.1);
      sim.say(`${t.title} · cleared by hand`, 150, true);
    },
  },
  {
    id: 'expedite', scope: 'task', glyph: '⏵', label: 'EXPEDITE',
    hint: 'push it to the front — it moves and finishes faster',
    cool: 5,
    enabled: (sim, t) => t.state !== ST.DONE && !t.boost,
    run: (sim, t) => {
      t.boost = 3.0;
      t.log.push({ day: sim.org.day, text: 'expedited' });
      const a = sim.byTask[t.id];
      if (a) { a.vmax *= 1.55; a.priority = 1; sim.ring(a.x, a.y, 0, 46, 46, 0.9); }
      sim.say(`${t.title} · expedited`, 46, true);
    },
  },
  {
    id: 'reroute', scope: 'task', glyph: '⟲', label: 'REROUTE',
    hint: 'send it around the congestion',
    cool: 4,
    enabled: (sim, t) => t.state !== ST.DONE && t.state !== ST.BLOCKED,
    run: (sim, t) => {
      const a = sim.byTask[t.id];
      if (!a) return;
      const from = a.path ? a.path[a.pi] : a.home.driveNode;
      const p = routeNodes(sim.city, from, a.home.driveNode, true);
      a.mode = 'toBuilding';
      sim.setPath(a, p);
      sim.ring(a.x, a.y, 0, 40, 200, 0.7);
      sim.say(`${t.title} · rerouted`, 200, true);
    },
  },
  {
    id: 'hold', scope: 'task', glyph: '⊗', label: 'HOLD',
    hint: 'stop it where it stands — see the cost',
    cool: 4,
    enabled: (sim, t) => t.state === ST.ACTIVE || t.state === ST.REVIEW,
    run: (sim, t) => {
      const ups = sim.org.deps.filter((d) => d.to === t.project);
      const by = ups.length ? ups[0].from : null;
      if (by) queueEvent(sim.org, { type: 'block', task: t.id, by });
      else {
        t.state = ST.BLOCKED;
        const a = sim.byTask[t.id];
        if (a) { a.stopped = true; a.park = a.pi; }
      }
      sim.say(`${t.title} · held`, 8, true);
    },
  },

  /* ---------- neighbourhoods (teams) --------------------- */
  {
    id: 'hire', scope: 'team', glyph: '✚', label: 'HIRE',
    hint: 'add a resident — capacity goes up',
    cool: 8,
    enabled: () => true,
    run: (sim, team) => {
      const person = makePerson(team.id);
      team.people.push(person);
      const d = sim.city.districts[team.id];
      // they arrive: a vehicle comes in off the highway
      const gate = pick(sim.city.gates);
      const a = {
        id: 'h' + person.id, resident: true, task: { state: 'ambient', title: '', done: 0 },
        kind: 'car', mass: 1.6, hue: team.hue, vmax: 30, speed: 0, s: 0, edgeId: -1,
        dir: 1, path: null, pi: 0, x: 0, y: 0, ang: 0, stopped: false, park: -1,
        mode: 'circulate', wob: rnd() * TAU, trail: [], life: 0, alpha: 0,
        beacon: 0, seedv: rnd(), arriving: 1,
      };
      sim.agents.push(a);
      const p = routeNodes(sim.city, gate, d.gate);
      if (p) sim.setPath(a, p);
      team.projects.forEach((id) => recomputeProject(sim.org.byId[id], sim.org));
      team.morale = clamp(team.morale + 0.09, 0.05, 1);
      sim.ring(d.cx, d.cy, 0, 120, team.hue, 0.8);
      sim.say(`${team.name} · ${person.name} joined`, team.hue, true);
    },
  },
  {
    id: 'allhands', scope: 'team', glyph: '❖', label: 'ALL HANDS',
    hint: 'clear every blockage here at once',
    cool: 20,
    enabled: (sim, team) => sim.org.tasks.some((t) =>
      t.team === team.id && t.state === ST.BLOCKED),
    run: (sim, team) => {
      let n = 0;
      sim.org.tasks.forEach((t) => {
        if (t.team === team.id && t.state === ST.BLOCKED) {
          queueEvent(sim.org, { type: 'unblock', task: t.id });
          n++;
        }
      });
      const d = sim.city.districts[team.id];
      sim.ring(d.cx, d.cy, 0, Math.max(d.W, d.D) * 1.1, 150, 1.6);
      sim.say(`${team.name} · all hands — ${n} cleared`, 150, true);
    },
  },
  {
    id: 'crunch', scope: 'team', glyph: '◈', label: 'CRUNCH',
    hint: 'everything here moves faster — at a price',
    cool: 16,
    enabled: (sim, team) => !team.crunchUntil || sim.org.day > team.crunchUntil,
    run: (sim, team) => {
      team.crunchUntil = sim.org.day + 4;
      team.projects.forEach((id) => {
        const p = sim.org.byId[id];
        p.priority = 1.9;
        p.focusUntil = sim.org.day + 4;
        const b = sim.city.byProject[id];
        if (b) { b.glow = 1.1; b.lit = clamp(b.lit + 0.15); }
      });
      const d = sim.city.districts[team.id];
      d.pressure = Math.min(1.3, d.pressure + 0.25);
      // this is borrowed, not free
      team.morale = clamp(team.morale - 0.22, 0.05, 1);
      sim.ring(d.cx, d.cy, 0, Math.max(d.W, d.D) * 1.2, 30, 1.4);
      sim.say(`${team.name} · crunch — morale ${(team.morale * 100) | 0}%`, 30, true);
    },
  },
];

ACTIONS.push({
  id: 'rest', scope: 'team', glyph: '☾', label: 'REST',
  hint: 'stand the team down — morale recovers, output dips',
  cool: 25,
  enabled: (sim, team) => team.morale < 0.7,
  run: (sim, team) => {
    team.morale = clamp(team.morale + 0.3, 0.05, 1);
    team.crunchUntil = 0;
    team.projects.forEach((id) => {
      const p = sim.org.byId[id];
      p.priority = Math.min(p.priority || 1, 0.75);
      p.focusUntil = sim.org.day + 2;
    });
    const d = sim.city.districts[team.id];
    d.pressure = Math.max(0, d.pressure - 0.15);
    sim.ring(d.cx, d.cy, 0, Math.max(d.W, d.D) * 1.1, 200, 1.1);
    sim.say(`${team.name} · stood down — morale ${(team.morale * 100) | 0}%`, 200, true);
  },
});

const ACTIONS_BY_SCOPE = {
  project: ACTIONS.filter((a) => a.scope === 'project'),
  task: ACTIONS.filter((a) => a.scope === 'task'),
  team: ACTIONS.filter((a) => a.scope === 'team'),
};

/* resolve the selection into the thing an action operates on */
function actionTarget(sim, sel) {
  if (!sel) return null;
  if (sel.type === 'project') return sim.org.byId[sel.id];
  if (sel.type === 'task') return sim.org.byId[sel.id];
  if (sel.type === 'team') return sim.org.teams[sel.id];
  return null;
}

function actionsFor(sim, sel) {
  if (!sel) return [];
  const target = actionTarget(sim, sel);
  if (!target) return [];
  return (ACTIONS_BY_SCOPE[sel.type] || []).map((a) => ({
    def: a,
    ok: a.enabled(sim, target),
    cool: sim.cooldown(a.id, sel.id),
  }));
}

function runAction(sim, sel, def) {
  const target = actionTarget(sim, sel);
  if (!target) return false;
  if (!def.enabled(sim, target)) return false;
  if (sim.cooldown(def.id, sel.id) > 0) return false;
  def.run(sim, target);
  sim.setCooldown(def.id, sel.id, def.cool);
  sim.commands++;
  return true;
}
