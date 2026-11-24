// Turns a map's rooms/halls/doors into walls, floors and openings.
// Used by the 2D renderer (outlines), the 3D views (meshes + collision), the validator and the Unity export.
//
// Edge keys: 'h,x,y' = the top edge of cell (x,y) (horizontal line from (x,y) to (x+1,y)).
//            'v,x,y' = the left edge of cell (x,y) (vertical line from (x,y) to (x,y+1)).

import { condActive } from './model.js';

const OPEN_KINDS = new Set(['hall', 'outdoor', 'stairs']);

export function bakeMap(map, view = null, opts = {}) {
  const cells = new Map(); // "x,y" -> { el, kind }
  const rooms = [];
  const stairs = [];
  const doors = [];
  const visible = (e) => !e.hidden && (opts.ignoreConds || condActive(e.cond, view));

  // Later elements paint over earlier ones; halls first so rooms drawn over a hall win.
  const order = map.elements.filter((e) => (e.type === 'room' || e.type === 'stairs') && visible(e));
  // What covers what: corridors / outdoor sit under rooms by default (so overlapping edges keep their walls).
  // Bring to front / Send to back ( ] / [ ) set a layer number "z" that overrides this; same layer = drawing order.
  const rank = (e) => (e.z || 0) * 2 + (e.type === 'room' && (e.kind === 'hall' || e.kind === 'outdoor') ? 0 : 1);
  const idx = new Map(order.map((e, i) => [e, i]));
  order.sort((a, b) => rank(a) - rank(b) || idx.get(a) - idx.get(b));
  for (const e of order) {
    const kind = e.type === 'stairs' ? 'stairs' : e.kind;
    for (const r of e.rects) for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) cells.set(r.x + i + ',' + (r.y + j), { el: e, kind });
    (e.type === 'stairs' ? stairs : rooms).push(e);
  }
  for (const e of map.elements) if (e.type === 'door' && visible(e)) doors.push(e);

  const doorEdges = new Map(); // edgeKey -> door
  for (const d of doors) for (let i = 0; i < d.len; i++) {
    const k = d.orient === 'h' ? `h,${d.x + i},${d.y}` : `v,${d.x},${d.y + i}`;
    doorEdges.set(k, d);
  }

  const joined = (a, b) => {
    if (!a || !b) return false;
    if (a.el === b.el) return true;
    if (a.kind === 'blocked' || b.kind === 'blocked') return false;
    if (OPEN_KINDS.has(a.kind) && OPEN_KINDS.has(b.kind)) return true;
    if ((a.el.open && b.kind !== 'blocked') || (b.el.open && a.kind !== 'blocked')) return true;
    return false;
  };

  // Collect wall edges: between two cells that are not joined (and at least one is solid floor).
  const wallEdges = new Map(); // key -> { a, b }  a = cell above/left, b = below/right
  const openings = []; // door edges actually in a wall
  const checkEdge = (key, a, b) => {
    const floorA = a && a.kind !== 'blocked', floorB = b && b.kind !== 'blocked';
    if (!floorA && !floorB) {
      if (a && b) return; // blocked next to blocked: they merge into one solid area, no line between
      if ((a && !b) || (!a && b)) wallEdges.set(key, { a, b });
      return;
    }
    if (joined(a, b)) return;
    wallEdges.set(key, { a, b });
  };
  const seen = new Set();
  for (const [k, c] of cells) {
    const [x, y] = k.split(',').map(Number);
    const edges = [
      [`h,${x},${y}`, cells.get(`${x},${y - 1}`), c],
      [`h,${x},${y + 1}`, c, cells.get(`${x},${y + 1}`)],
      [`v,${x},${y}`, cells.get(`${x - 1},${y}`), c],
      [`v,${x + 1},${y}`, c, cells.get(`${x + 1},${y}`)],
    ];
    for (const [ek, a, b] of edges) {
      if (seen.has(ek)) continue;
      seen.add(ek);
      checkEdge(ek, a, b);
    }
  }

  // Door edges cut holes in walls.
  const doorInfo = new Map(); // door -> { inWall, sides }
  for (const [k, d] of doorEdges) {
    const w = wallEdges.get(k);
    if (w) { wallEdges.delete(k); openings.push({ key: k, door: d, a: w.a, b: w.b }); }
    const info = doorInfo.get(d) || { inWall: 0, total: 0, a: null, b: null };
    info.total++;
    if (w) { info.inWall++; info.a = info.a || w.a; info.b = info.b || w.b; }
    doorInfo.set(d, info);
  }

  // Merge edges into straight segments with the same rooms on each side.
  const segs = mergeEdges(wallEdges);

  // Floors: per element, greedy rects over the cells it actually owns.
  const owned = new Map();
  for (const [k, c] of cells) {
    if (!owned.has(c.el)) owned.set(c.el, new Set());
    owned.get(c.el).add(k);
  }

  return { map, cells, rooms, stairs, doors, doorEdges, doorInfo, wallEdges, walls: segs, openings, owned, visible };
}

function mergeEdges(wallEdges) {
  const segs = [];
  const used = new Set();
  const sideId = (w) => (w.a?.el.id ?? '') + '|' + (w.b?.el.id ?? '');
  for (const [k, w] of wallEdges) {
    if (used.has(k)) continue;
    const [o, xs, ys] = k.split(',');
    let x = +xs, y = +ys;
    const sid = sideId(w);
    if (o === 'h') {
      // walk left to the start
      while (wallEdges.has(`h,${x - 1},${y}`) && !used.has(`h,${x - 1},${y}`) && sideId(wallEdges.get(`h,${x - 1},${y}`)) === sid) x--;
      let x2 = x;
      while (wallEdges.has(`h,${x2},${y}`) && !used.has(`h,${x2},${y}`) && sideId(wallEdges.get(`h,${x2},${y}`)) === sid) { used.add(`h,${x2},${y}`); x2++; }
      segs.push({ o: 'h', x1: x, y1: y, x2, y2: y, a: w.a?.el ?? null, b: w.b?.el ?? null, aKind: w.a?.kind, bKind: w.b?.kind });
    } else {
      while (wallEdges.has(`v,${x},${y - 1}`) && !used.has(`v,${x},${y - 1}`) && sideId(wallEdges.get(`v,${x},${y - 1}`)) === sid) y--;
      let y2 = y;
      while (wallEdges.has(`v,${x},${y2}`) && !used.has(`v,${x},${y2}`) && sideId(wallEdges.get(`v,${x},${y2}`)) === sid) { used.add(`v,${x},${y2}`); y2++; }
      segs.push({ o: 'v', x1: x, y1: y, x2: x, y2, a: w.a?.el ?? null, b: w.b?.el ?? null, aKind: w.a?.kind, bKind: w.b?.kind });
    }
  }
  return segs;
}

/** Which element owns the cell at a (float) grid point? */
export function cellAt(baked, x, y) {
  return baked.cells.get(Math.floor(x) + ',' + Math.floor(y)) ?? null;
}

/** Door geometry helper: centre + which side is which. */
export function doorCenter(d) {
  return d.orient === 'h' ? { x: d.x + d.len / 2, y: d.y } : { x: d.x, y: d.y + d.len / 2 };
}

/** The walkable spot just in front of a door/stairs/marker, used when arriving through a link. */
export function arrivalPoint(baked, el) {
  const p = rawArrival(baked, el);
  return p ? onFloor(baked, p, el) : p;
}

/** Make sure an arrival spot is on walkable floor; if not, use the nearest floor cell (never outside the map). */
function onFloor(baked, p, el) {
  const ok = (x, y) => { const c = cellAt(baked, x, y); return c && c.kind !== 'blocked' && c.kind !== 'stairs'; };
  if (ok(p.x, p.y)) return p;
  // try a step around the thing itself first (an exit placed on a doorway, wall or edge)
  const ox = el?.x ?? p.x, oy = el?.y ?? p.y;
  const around = [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  for (const [dx, dy] of around) if (ok(ox + dx, oy + dy)) return { x: ox + dx, y: oy + dy, face: Math.atan2(dx, -dy) || p.face };
  // otherwise the closest floor cell anywhere on the map
  let best = null, bd = Infinity;
  for (const [k, c] of baked.cells) {
    if (c.kind === 'blocked' || c.kind === 'stairs') continue;
    const [cx, cy] = k.split(',').map(Number);
    const d = (cx + 0.5 - p.x) ** 2 + (cy + 0.5 - p.y) ** 2;
    if (d < bd) { bd = d; best = { x: cx + 0.5, y: cy + 0.5, face: p.face }; }
  }
  return best ?? p;
}

function rawArrival(baked, el) {
  if (!el) return null;
  if (el.type === 'door') {
    const c = doorCenter(el);
    const sides = el.orient === 'h' ? [[0, -0.9], [0, 0.9]] : [[-0.9, 0], [0.9, 0]];
    // prefer the hall side (the side that is open floor and not the room the door belongs to)
    let best = null;
    for (const [dx, dy] of sides) {
      const cell = cellAt(baked, c.x + dx, c.y + dy);
      if (!cell || cell.kind === 'blocked') continue;
      const score = cell.kind === 'hall' || cell.kind === 'outdoor' ? 2 : 1;
      if (!best || score > best.score) best = { x: c.x + dx, y: c.y + dy, score, face: Math.atan2(dx, -dy) };
    }
    return best ?? { x: c.x, y: c.y + 0.9, face: Math.PI };
  }
  if (el.type === 'stairs') {
    const r = el.rects[0];
    // arrive at the low end of the stairs, facing out of them
    const v = { n: [0, 1], s: [0, -1], e: [-1, 0], w: [1, 0] }[el.dir] ?? [0, 1];
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const half = Math.abs(v[0]) ? r.w / 2 : r.h / 2;
    const px = cx + v[0] * (half + 0.8), py = cy + v[1] * (half + 0.8);
    return { x: px, y: py, face: Math.atan2(v[0], -v[1]) };
  }
  if (el.type === 'room') {
    const r = el.rects[0];
    return { x: r.x + r.w / 2, y: r.y + r.h / 2, face: 0 };
  }
  const a = ((el.rot || 0) * Math.PI) / 180;
  if (el.type === 'marker' && el.kind === 'portal') {
    // an exit's arrow points "out"; arriving players stand a step inside, facing in
    return { x: el.x - Math.sin(a) * 1.0, y: el.y + Math.cos(a) * 1.0, face: a + Math.PI };
  }
  return { x: el.x, y: el.y, face: a };
}

/** Flood fill from the player start over joined cells + doors. Returns the set of reachable element ids. */
export function reachable(baked, start) {
  const out = new Set();
  if (!start) return out;
  const startKey = Math.floor(start.x) + ',' + Math.floor(start.y);
  if (!baked.cells.has(startKey)) return out;
  const q = [startKey];
  const seen = new Set(q);
  while (q.length) {
    const k = q.pop();
    const c = baked.cells.get(k);
    out.add(c.el.id);
    const [x, y] = k.split(',').map(Number);
    const nb = [
      [x, y - 1, `h,${x},${y}`], [x, y + 1, `h,${x},${y + 1}`],
      [x - 1, y, `v,${x},${y}`], [x + 1, y, `v,${x + 1},${y}`],
    ];
    for (const [nx, ny, ek] of nb) {
      const nk = nx + ',' + ny;
      if (seen.has(nk)) continue;
      const n = baked.cells.get(nk);
      if (!n || n.kind === 'blocked') continue;
      if (baked.wallEdges.has(ek)) continue; // wall (door edges were removed from wallEdges)
      seen.add(nk);
      q.push(nk);
    }
  }
  return out;
}
