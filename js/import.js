/* ============================================================
   import.js — build the city out of real work.

   Two ways in:
     · drop a .json file anywhere on the page (schema below)
     · type owner/repo and pull a public GitHub repository

   The schema is written for humans, so everything refers to
   things by name rather than by id.

   {
     "name": "ACME",
     "teams":    [{ "name": "Platform", "tag": "PLT", "hue": 196,
                    "motto": "core services", "people": ["Ada Vane"] }],
     "projects": [{ "name": "Edge Router", "team": "Platform",
                    "milestones": ["scoping","alpha","ga"], "done": 1,
                    "deadlineDays": 12, "scale": 0.8 }],
     "tasks":    [{ "title": "fix the retry path", "project": "Edge Router",
                    "owner": "Ada Vane", "size": "M",
                    "state": "active", "progress": 0.3 }],
     "deps":     [{ "from": "Edge Router", "to": "Auth Mesh" }]
   }

   Only `projects` is required. Everything else is inferred.
   ============================================================ */
'use strict';

const SIZE_BY_KEY = { S: SIZES[0], M: SIZES[1], L: SIZES[2], XL: SIZES[3] };
const VALID_STATE = [ST.INBOUND, ST.QUEUED, ST.ACTIVE, ST.BLOCKED, ST.REVIEW, ST.DONE];

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/* ---------- spec -> the internal organisation ------------- */
function orgFromSpec(spec) {
  if (!spec || !Array.isArray(spec.projects) || !spec.projects.length) {
    throw new Error('needs at least one entry in "projects"');
  }
  seed(hashString(String(spec.name || 'city')));

  const org = {
    name: String(spec.name || 'IMPORTED').toUpperCase().slice(0, 18),
    day: spec.day != null ? +spec.day : 0.30,
    intake: spec.intake != null ? clamp(+spec.intake, 0, 2) : 1,
    incidents: [],
    teams: [], projects: [], tasks: [], deps: [],
    byId: {}, shipped: spec.shipped | 0, events: [],
    imported: true, source: spec.source || 'file',
  };

  /* teams — inferred from the projects if none were given */
  let teamSpecs = Array.isArray(spec.teams) && spec.teams.length ? spec.teams.slice() : null;
  if (!teamSpecs) {
    const names = [...new Set(spec.projects.map((p) => p.team).filter(Boolean))];
    teamSpecs = (names.length ? names : ['Everyone']).map((n) => ({ name: n }));
  }
  teamSpecs = teamSpecs.slice(0, 8);
  const teamIndex = new Map();
  teamSpecs.forEach((t, i) => {
    const name = String(t.name || `Team ${i + 1}`);
    const team = {
      id: i,
      name: name.slice(0, 22),
      tag: (t.tag || name.replace(/[^a-z]/gi, '').slice(0, 3) || 'T' + i).toUpperCase(),
      hue: t.hue != null ? t.hue : Math.round((i / teamSpecs.length) * 320 + 8),
      motto: (t.motto || '').slice(0, 30),
      people: [], projects: [], pressure: 0, morale: t.morale != null ? clamp(t.morale) : 0.72,
    };
    const people = Array.isArray(t.people) && t.people.length ? t.people : null;
    if (people) people.forEach((n) => team.people.push({ id: uid('p'), name: String(n).slice(0, 24), team: i, load: 0 }));
    org.teams.push(team);
    teamIndex.set(name.toLowerCase(), team);
  });
  const fallbackTeam = org.teams[0];
  const teamFor = (n) => (n && teamIndex.get(String(n).toLowerCase())) || fallbackTeam;

  /* projects */
  const projIndex = new Map();
  spec.projects.slice(0, 60).forEach((ps) => {
    const team = teamFor(ps.team);
    const mnames = Array.isArray(ps.milestones) && ps.milestones.length
      ? ps.milestones.slice(0, 10).map(String)
      : MILESTONES.slice(0, ri(4, 7));
    const doneCount = clamp(ps.done | 0, 0, mnames.length - 1);
    const p = {
      id: uid('P'),
      name: String(ps.name || 'Untitled').slice(0, 22),
      team: team.id,
      scale: ps.scale != null ? clamp(ps.scale, 0.4, 1) : rr(0.55, 1),
      milestones: mnames.map((m, i) => ({ name: String(m).slice(0, 14), done: i < doneCount })),
      built: doneCount,
      progress: 0,
      deadlineDay: ps.deadlineDays != null ? Math.max(0.5, +ps.deadlineDays) : rr(2.5, 26),
      tasks: [], risk: 0,
      priority: ps.priority != null ? +ps.priority : 1,
      focusUntil: 0,
      wip: ps.wip | 0,
      incident: null,
      lastShip: -99, activity: 0,
    };
    team.projects.push(p.id);
    org.projects.push(p);
    org.byId[p.id] = p;
    projIndex.set(p.name.toLowerCase(), p);
  });

  // people are required for capacity; invent them where they were not supplied
  org.teams.forEach((t) => {
    const want = Math.max(3, Math.min(10, t.projects.length * 2));
    while (t.people.length < want) {
      t.people.push({ id: uid('p'), name: `${pick(FIRST)} ${pick(LAST)}`, team: t.id, load: 0 });
    }
  });

  /* tasks */
  const taskSpecs = Array.isArray(spec.tasks) ? spec.tasks : [];
  taskSpecs.slice(0, 420).forEach((ts) => {
    const p = projIndex.get(String(ts.project || '').toLowerCase()) || org.projects[0];
    const size = SIZE_BY_KEY[String(ts.size || '').toUpperCase()] || pick(SIZES.slice(0, 2));
    let state = String(ts.state || ST.ACTIVE).toLowerCase();
    if (!VALID_STATE.includes(state)) state = ST.ACTIVE;
    const owner = ts.owner
      ? { name: String(ts.owner).slice(0, 24) }
      : pick(org.teams[p.team].people);
    const t = {
      id: uid('t'),
      title: String(ts.title || 'untitled task').slice(0, 48),
      project: p.id, team: p.team,
      size: size.key, mass: size.mass, kind: size.kind, hours: size.hours,
      done: state === ST.DONE ? 1 : clamp(ts.progress != null ? +ts.progress : rr(0, 0.6)),
      owner: owner.id || uid('p'), ownerName: owner.name,
      state, blockedBy: null, age: 0, heat: 1, createdDay: 0,
      log: [{ day: 0, text: ts.createdText || 'imported' }],
      url: ts.url || null,
    };
    p.tasks.push(t.id);
    org.tasks.push(t);
    org.byId[t.id] = t;
    if (state === ST.DONE && spec.shipped == null) org.shipped++;
  });
  // a project with no work at all would be a dead building
  org.projects.forEach((p) => {
    while (p.tasks.length < 2) {
      const t = makeTask(p, org, chance(0.85) ? ST.ACTIVE : ST.INBOUND);
      t.done = rr(0, 0.5);
      p.tasks.push(t.id); org.tasks.push(t); org.byId[t.id] = t;
    }
  });

  /* dependencies */
  const deps = Array.isArray(spec.deps) ? spec.deps : [];
  deps.slice(0, 120).forEach((d) => {
    const from = projIndex.get(String(d.from || '').toLowerCase());
    const to = projIndex.get(String(d.to || '').toLowerCase());
    if (!from || !to || from === to) return;
    if (org.deps.some((x) => x.from === from.id && x.to === to.id)) return;
    org.deps.push({ id: uid('D'), from: from.id, to: to.id, weight: 1, edges: null });
  });
  // a city with no roads between neighbourhoods is just a set of villages
  if (org.deps.length < Math.min(6, org.projects.length)) {
    for (let i = 0; i < org.projects.length && org.deps.length < org.projects.length * 0.6; i++) {
      const a = org.projects[i], b = pick(org.projects);
      if (a === b) continue;
      if (org.deps.some((x) => (x.from === b.id && x.to === a.id) || (x.from === a.id && x.to === b.id))) continue;
      org.deps.push({ id: uid('D'), from: b.id, to: a.id, weight: 1, edges: null });
    }
  }

  // blocked tasks need something to be blocked on
  org.tasks.forEach((t) => {
    if (t.state !== ST.BLOCKED) return;
    const ups = org.deps.filter((d) => d.to === t.project);
    if (ups.length) t.blockedBy = pick(ups).from;
    else t.state = ST.ACTIVE;
  });

  org.projects.forEach((p) => recomputeProject(p, org));
  return org;
}

/* ---------- GitHub ---------------------------------------- */
async function ghJSON(url) {
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (res.status === 403) throw new Error('GitHub rate limit reached — try again in a while');
  if (res.status === 404) throw new Error('repository not found (must be public)');
  if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
  return res.json();
}

const BLOCK_RE = /(?:blocked\s+by|depends\s+on|blocked\s+on)\s+#(\d+)/gi;

async function specFromGitHub(repoPath, onProgress) {
  const m = String(repoPath).trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/+$/, '');
  const parts = m.split('/');
  if (parts.length < 2) throw new Error('use the form owner/repo');
  const owner = parts[0], repo = parts[1];

  onProgress && onProgress('reading ' + owner + '/' + repo);
  const [milestones, page1] = await Promise.all([
    ghJSON(`https://api.github.com/repos/${owner}/${repo}/milestones?state=all&per_page=100`),
    ghJSON(`https://api.github.com/repos/${owner}/${repo}/issues?state=all&per_page=100&page=1`),
  ]);
  let issues = page1;
  if (page1.length === 100) {
    onProgress && onProgress('reading more issues');
    try { issues = issues.concat(await ghJSON(`https://api.github.com/repos/${owner}/${repo}/issues?state=all&per_page=100&page=2`)); } catch (e) { /* one page is enough */ }
  }
  if (!issues.length) throw new Error('that repository has no issues to build from');
  onProgress && onProgress(`${issues.length} issues · ${milestones.length} milestones`);

  /* labels become neighbourhoods */
  const labelCount = new Map();
  issues.forEach((i) => (i.labels || []).forEach((l) => {
    const n = typeof l === 'string' ? l : l.name;
    labelCount.set(n, (labelCount.get(n) || 0) + 1);
  }));
  const topLabels = [...labelCount.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 6).map((e) => e[0]);
  const teams = (topLabels.length ? topLabels : ['issues']).map((n, i) => ({
    name: n.replace(/[-_/]/g, ' ').slice(0, 22),
    tag: n.replace(/[^a-z]/gi, '').slice(0, 3).toUpperCase() || 'L' + i,
    motto: `${labelCount.get(n) || 0} issues`,
  }));
  const teamOf = (issue) => {
    const names = (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
    const hit = topLabels.find((t) => names.includes(t));
    return hit ? hit.replace(/[-_/]/g, ' ').slice(0, 22) : teams[0].name;
  };

  /* milestones become structures; without them, buckets of labels do */
  const now = Date.now();
  let projects, projectOf;
  if (milestones.length >= 2) {
    projects = milestones.slice(0, 40).map((ms) => {
      const total = (ms.open_issues || 0) + (ms.closed_issues || 0);
      const doneFrac = total ? ms.closed_issues / total : 0;
      const steps = MILESTONES.slice(0, 6);
      return {
        name: String(ms.title).slice(0, 22),
        team: teamOf(issues.find((i) => i.milestone && i.milestone.number === ms.number) || {}),
        milestones: steps,
        done: Math.round(doneFrac * (steps.length - 1)),
        deadlineDays: ms.due_on
          ? Math.max(0.5, (new Date(ms.due_on).getTime() - now) / 86400000)
          : 6 + (total % 20),
        scale: clamp(0.45 + total / 60, 0.45, 1),
      };
    });
    const bare = { name: 'Unscheduled', team: teams[0].name, deadlineDays: 20, scale: 0.7 };
    projects.push(bare);
    projectOf = (i) => (i.milestone ? String(i.milestone.title).slice(0, 22) : 'Unscheduled');
  } else {
    const names = (topLabels.length ? topLabels : ['issues']).slice(0, 12);
    projects = names.map((n) => ({
      name: n.replace(/[-_/]/g, ' ').slice(0, 22),
      team: n.replace(/[-_/]/g, ' ').slice(0, 22),
      deadlineDays: 4 + (labelCount.get(n) || 1) % 24,
      scale: clamp(0.45 + (labelCount.get(n) || 1) / 40, 0.45, 1),
    }));
    projectOf = (i) => {
      const ns = (i.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
      const hit = names.find((t) => ns.includes(t));
      return (hit || names[0]).replace(/[-_/]/g, ' ').slice(0, 22);
    };
  }

  /* issues become traffic */
  const byNumber = new Map(issues.map((i) => [i.number, i]));
  const tasks = [];
  const deps = [];
  issues.forEach((i) => {
    const isPR = !!i.pull_request;
    const labels = (i.labels || []).map((l) => (typeof l === 'string' ? l : l.name).toLowerCase());
    const blocked = labels.some((l) => /block|wait|hold/.test(l));
    let state;
    if (i.state === 'closed') state = ST.DONE;
    else if (isPR) state = ST.REVIEW;
    else if (blocked) state = ST.BLOCKED;
    else if (i.assignee) state = ST.ACTIVE;
    else state = ST.INBOUND;
    const weight = (i.comments || 0) + (i.body ? i.body.length / 900 : 0);
    const size = weight > 14 ? 'XL' : weight > 7 ? 'L' : weight > 2 ? 'M' : 'S';
    const proj = projectOf(i);
    tasks.push({
      title: String(i.title).slice(0, 48),
      project: proj,
      owner: (i.assignee && i.assignee.login) || (i.user && i.user.login) || null,
      size, state,
      progress: state === ST.DONE ? 1 : clamp((i.comments || 0) / 12),
      url: i.html_url,
      createdText: `opened #${i.number}`,
    });
    // "blocked by #123" in the body becomes a road between two structures
    if (i.body) {
      let mm;
      BLOCK_RE.lastIndex = 0;
      while ((mm = BLOCK_RE.exec(i.body)) !== null) {
        const other = byNumber.get(+mm[1]);
        if (!other) continue;
        const from = projectOf(other);
        if (from && from !== proj) deps.push({ from, to: proj });
      }
    }
  });

  return {
    name: repo,
    source: `github:${owner}/${repo}`,
    teams, projects, tasks, deps,
  };
}

async function orgFromGitHub(repoPath, onProgress) {
  return orgFromSpec(await specFromGitHub(repoPath, onProgress));
}


/* ---------- the city, back out as a spec ------------------
   Serialising to the same shape we import means saving,
   exporting and loading are all one code path.
---------------------------------------------------------- */
function specFromOrg(org) {
  const teamName = (id) => org.teams[id].name;
  const projName = (id) => (org.byId[id] ? org.byId[id].name : null);
  return {
    v: 1,
    name: org.name,
    day: +org.day.toFixed(3),
    intake: +org.intake.toFixed(2),
    shipped: org.shipped,
    source: org.source || 'demo',
    teams: org.teams.map((t) => ({
      name: t.name, tag: t.tag, hue: t.hue, motto: t.motto,
      morale: +t.morale.toFixed(3),
      people: t.people.map((p) => p.name),
    })),
    projects: org.projects.map((p) => ({
      name: p.name,
      team: teamName(p.team),
      milestones: p.milestones.map((m) => m.name),
      done: p.milestones.filter((m) => m.done).length,
      deadlineDays: +(p.deadlineDay - org.day).toFixed(2),
      scale: +p.scale.toFixed(2),
      wip: p.wip | 0,
      priority: +(p.priority || 1).toFixed(2),
    })),
    tasks: org.tasks.map((t) => ({
      title: t.title,
      project: projName(t.project),
      owner: t.ownerName,
      size: t.size,
      state: t.state,
      progress: +t.done.toFixed(3),
      url: t.url || undefined,
    })).filter((t) => t.project),
    deps: org.deps.map((d) => ({ from: projName(d.from), to: projName(d.to) }))
      .filter((d) => d.from && d.to),
  };
}
