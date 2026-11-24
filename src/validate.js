// Map checks. Each issue: { level: 'error'|'warn'|'info', text, mapId, elId }
import { bakeMap, reachable, cellAt, doorCenter } from './bake.js';
import { elementTitle, rectArea } from './model.js';

export function validate(project) {
  const issues = [];
  const add = (level, text, map, el) => issues.push({ level, text, mapId: map?.id, elId: el?.id });
  const ids = new Map();
  for (const m of project.maps) {
    const baked = bakeMap(m, null, { ignoreConds: true });
    for (const e of m.elements) {
      if (ids.has(e.id)) add('error', `Duplicate id ${e.id}`, m, e);
      ids.set(e.id, m);
    }
    // doors
    for (const d of baked.doors) {
      const info = baked.doorInfo.get(d);
      if (!info || info.inWall === 0) {
        if (!d.link?.mapId) add('warn', `Door is not on a wall (it does nothing)`, m, d);
      } else if (info.inWall < info.total) add('warn', `Door is only partly on a wall`, m, d);
    }
    // links
    for (const e of m.elements) {
      if (!e.link?.mapId) continue;
      const tm = project.maps.find((x) => x.id === e.link.mapId);
      if (!tm) { add('error', `${elementTitle(e, project)} links to a map that was deleted`, m, e); continue; }
      if (e.link.targetId) {
        const t = tm.elements.find((x) => x.id === e.link.targetId);
        if (!t) add('error', `${elementTitle(e, project)} links to something on “${tm.name}” that was deleted`, m, e);
        else if (!t.link?.mapId || t.link.targetId !== e.id) add('info', `One-way link: ${elementTitle(e, project)} → ${tm.name} › ${elementTitle(t, project)} (no link back)`, m, e);
      } else add('info', `${elementTitle(e, project)} links to “${tm.name}” but no arrival point is set (the player arrives at its start)`, m, e);
    }
    // markers outside floor
    for (const e of m.elements) {
      if (e.type !== 'marker' || e.kind === 'note' || e.kind === 'portal') continue;
      const c = cellAt(baked, e.x, e.y);
      if (!c) add('warn', `${elementTitle(e, project)} is outside every room`, m, e);
      else if (c.kind === 'blocked') add('warn', `${elementTitle(e, project)} is inside a blocked area`, m, e);
    }
    // overlapping rooms (room drawn over another room)
    const rooms = m.elements.filter((e) => e.type === 'room' && e.kind === 'room');
    for (const r of rooms) {
      const owned = baked.owned.get(r)?.size ?? 0;
      const area = rectArea(r);
      if (owned < area) add('warn', `“${elementTitle(r, project)}” is partly covered by another room`, m, r);
      if (!r.name) add('info', 'A room has no name', m, r);
      if (owned === 0) continue;
      // has a door?
      const hasDoor = baked.openings.some((o) => o.a?.el === r || o.b?.el === r) || r.open;
      if (!hasDoor) add('warn', `“${elementTitle(r, project)}” has no door`, m, r);
    }
    // unreachable from spawn / first hall
    const spawn = m.elements.find((e) => e.type === 'marker' && e.kind === 'spawn');
    let start = spawn ? { x: spawn.x, y: spawn.y } : null;
    if (!start) {
      const arrivals = [];
      for (const om of project.maps) for (const e of om.elements) if (e.link?.mapId === m.id && e.link.targetId) {
        const t = m.elements.find((x) => x.id === e.link.targetId);
        if (t) arrivals.push(t);
      }
      const t = arrivals[0];
      if (t) start = t.type === 'door' ? doorCenter(t) : t.rects ? { x: t.rects[0].x + 0.5, y: t.rects[0].y + 0.5 } : { x: t.x, y: t.y };
    }
    if (start) {
      // nudge door centres onto a cell
      const reach = new Set();
      for (const [dx, dy] of [[0, 0], [0.3, 0.3], [-0.3, -0.3]]) for (const id of reachable(baked, { x: start.x + dx, y: start.y + dy })) reach.add(id);
      for (const r of baked.rooms) if (r.kind !== 'blocked' && !reach.has(r.id) && baked.owned.get(r)?.size) add('warn', `“${elementTitle(r, project)}” can't be reached from the start`, m, r);
    } else if (m.elements.some((e) => e.type === 'room')) add('info', `“${m.name}” has no player start and nothing links into it`, m, null);
    // evidence
    for (const e of m.elements) if (e.type === 'marker' && e.kind === 'evidence' && !e.evidenceId) add('info', `Evidence spot “${e.name}” isn't tied to an evidence entry`, m, e);
    for (const e of m.elements) if (e.type === 'marker' && (e.kind === 'npc' || e.kind === 'fte') && !project.characters.find((c) => c.id === e.characterId)) add('warn', 'A character marker has no character chosen', m, e);
  }
  // required evidence not placed
  for (const ev of project.evidence) {
    const placed = project.maps.some((m) => m.elements.some((e) => e.evidenceId === ev.id));
    if (!placed) add('info', `Evidence “${ev.name}” isn't placed on any map`, null, null);
  }
  // assets used but missing
  const check = (id, m, e) => { if (id && !project.assets[id]) add('error', `Missing image for ${elementTitle(e, project)}`, m, e); };
  for (const m of project.maps) for (const e of m.elements) { check(e.asset, m, e); if (e.icon?.startsWith('asset:')) check(e.icon.slice(6), m, e); }
  const order = { error: 0, warn: 1, info: 2 };
  issues.sort((a, b) => order[a.level] - order[b.level]);
  return issues;
}
