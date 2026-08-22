# MERIDIAN — a city that is the work

A productivity surface with no task table, no project card, and no list.
The organisation is rendered as a living city, and you navigate it by moving
through space rather than by clicking through screens.

Open `index.html`. No build, no server, no dependencies.

---

## The mapping

| In the city | In the work |
|---|---|
| A **structure** | a project. Its floors are shipped milestones; its lit windows are progress. |
| **People and vehicles** | tasks in motion. The vehicle's mass is the estimate — a 40-hour task is a truck and accelerates like one. |
| **Roads** | dependencies, traced through real streets by shortest path. |
| **Neighbourhoods** | teams. The ground runs from team colour to ember as their load rises. |
| **Weather** | deadlines. Pressure builds cloud, then rain, then storm cells that drift over the district causing it. |
| **Traffic jams** | blocked work. A blocked task parks on the dependency it is waiting on and everything queues behind it. |
| **Rising light** | finished work, flying downtown to the org core. |
| **The spire** | the organisation. One ring per team, brightening as work lands. |

## Five altitudes

`ORGANISATION → NEIGHBOURHOOD → PROJECT → TASK → ACTIVITY`

Zoom is continuous; the altitude labels only name where you are. Detail is
earned by descending: at height a tower is just the light it emits, at street
level it has floor bands, windows, a crane, and a beacon. Map symbols work the
other way — dependency flow arrows are bright from above and fade out as you
reach the street, because at street level the road itself is the evidence.

## Physics, not state changes

Nothing pops into existence.

- New work **drives in** through a city gate on the shore and takes the
  highway to its building.
- A blockage doesn't recolour a row — the task **drives to the thing it is
  waiting on and stops there**. Vehicles behind it slow, then queue, then back
  up through the junction. Congestion bleeds into touching roads at 46% per
  hop, so a single stall reddens a whole corridor and clears from the outside in.
- A milestone landing **raises a floor**: the tower grows, dust rings out
  across the ground, the crane climbs, windows light from the ground up.
- A finished task is **absorbed** by its building and leaves as motes of light
  that fall toward downtown under gravity and charge the core.
- Idle projects **decay** — unlit windows, dimming facades.
- Mass matters: heavy tasks accelerate slowly and take longer to clear a jam.

## Controls

| | |
|---|---|
| drag | move over the city |
| scroll | altitude (anchored on the cursor) |
| shift+drag, `Q`/`E` | rotate |
| click | building → project · vehicle → task · ground → team |
| double-click | descend into whatever is under the cursor |
| `esc` | ascend one level |
| `F` | lock onto a moving task and ride with it |
| `1`–`5` | jump to an altitude |
| `space` | hold time |
| `H` | legend |
| `R` | reset rotation |

When you are tracking something, anything standing between you and it turns to
glass, and a locator beam marks it through the skyline.

## Files

```
index.html      shell
css/style.css   frame
js/util.js      math, noise, easing, colour
js/data.js      the organisation: teams, projects, tasks, and the event stream
js/city.js      island, neighbourhoods, road graph, plots, dependency routing
js/sim.js       agents, car-following, congestion spread, weather, effects
js/render.js    camera and the axonometric renderer
js/hud.js       instrumentation, tracking labels, readouts
js/main.js      boot, input, picking, navigation
```

Everything is deterministic from a seed, so the same city is laid out every
time; only the live event stream differs.

`window.APP` exposes `{org, city, sim, cam, ui, flyTo, gotoLevel, select}` for
inspection.
