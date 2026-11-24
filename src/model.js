// TVF Map Maker – project data model.
// Everything the editor, the 3D views and the exporters share lives here.
//
// Grid space: x grows right, y grows DOWN (like the screen). One grid cell = project.settings.cellSize metres.
// Rooms/stairs are made of integer-cell rects. Doors sit on cell edges. Markers use free (float) cell coordinates.

export const FORMAT = 'tvf-map';
export const VERSION = 1;

let counter = 0;
export function uid(prefix = 'e') {
  counter = (counter + 1) % 1296;
  return prefix + '_' + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 7) + counter.toString(36);
}

export const ROOM_KINDS = {
  room: { label: 'Room', help: 'A closed room. Walls all round; add doors to get in.' },
  hall: { label: 'Hallway', help: 'Walkable floor. Hallways join up with each other with no walls between them.' },
  outdoor: { label: 'Outdoor', help: 'Like a hallway but with no ceiling (courtyards, rooftops).' },
  blocked: { label: 'Blocked', help: 'Solid, hatched area. You cannot walk here (pillars, unexplored space).' },
};

export const MARKER_KINDS = {
  spawn:    { label: 'Player start', icon: 'start', help: 'Where the player appears in 3D walk mode.' },
  npc:      { label: 'Character', icon: 'person', help: 'A character standee. Use conditions to place them per chapter / time.' },
  hotspot:  { label: 'Investigation spot', icon: 'eye', help: 'Something to examine. Text shows when you press E in 3D.' },
  evidence: { label: 'Evidence / Truth Bullet', icon: 'bullet', help: 'A piece of evidence you can collect.' },
  prop:     { label: 'Prop', icon: 'box', help: 'Furniture placeholder (box or billboard). Give it a prefab ID for Unity.' },
  light:    { label: 'Light', icon: 'bulb', help: 'A point light in 3D.' },
  camera:   { label: 'Monitor camera', icon: 'cctv', help: 'A security camera / monitor. Shows its view cone.' },
  trigger:  { label: 'Trigger zone', icon: 'zap', help: 'An area that fires an event (announcement, cutscene, music change).' },
  portal:   { label: 'Exit / Portal', icon: 'arrow', help: 'A link to another map, e.g. "to the gym". Walk into it in 3D to travel.' },
  jump:     { label: 'Fast-travel point', icon: 'globe', help: 'A [JMP] point on the in-game map screen. The player can fast-travel here.' },
  fte:      { label: 'Free-time spot', icon: 'heart', help: 'Where a character hangs out during free time.' },
  note:     { label: 'Designer note', icon: 'note', help: 'A sticky note for your team. Not exported to the game.' },
};

export const TRIGGER_TYPES = ['announcement', 'cutscene', 'music', 'ambience', 'monokuma', 'dialogue', 'custom'];
export const DOOR_STYLES = ['door', 'double', 'opening', 'shutter'];
export const LOCK_STATES = { open: 'Open', locked: 'Locked', sealed: 'Sealed (taped)', barred: 'Barred shutter' };
export const LIGHTING = ['default', 'warm', 'cold', 'night', 'blacklight', 'emergency', 'crime scene', 'dark'];

export function emptyCond() {
  return { chMin: -1, chMax: -1, times: [], flag: '', notFlag: '' };
}
export function emptyLink() {
  return { mapId: '', targetId: '' };
}

export function newRoom(kind, rect, name) {
  return {
    id: uid(kind === 'hall' ? 'hall' : 'room'), type: 'room', kind,
    name: name ?? (kind === 'hall' ? 'Hallway' : kind === 'blocked' ? '' : kind === 'outdoor' ? 'Outside' : 'Room'),
    rects: [{ ...rect }],
    icon: '', asset: '', characterId: '', showLabel: kind === 'room', showIcon: true,
    color: '', floorColor: '', wallColor: '', wallHeight: 0, ceiling: kind !== 'outdoor',
    open: false, lighting: 'default', discover: 'enter', discoverFlag: '',
    locked: false, unlockChapter: -1, lockMsg: '', cond: emptyCond(), notes: '', tags: '', hidden: false, lockedEdit: false,
  };
}

export function newDoor(x, y, orient, len = 1) {
  return {
    id: uid('door'), type: 'door', name: '', x, y, orient, len,
    style: len >= 2 ? 'double' : 'door', lock: 'open', lockMsg: '', unlockFlag: '', unlockChapter: -1,
    link: emptyLink(), cond: emptyCond(), notes: '', hidden: false, lockedEdit: false,
  };
}

export function newStairs(rect, dir = 'n') {
  return {
    id: uid('stairs'), type: 'stairs', name: 'Stairs', rects: [{ ...rect }], dir, goes: 'up',
    link: emptyLink(), cond: emptyCond(), notes: '', hidden: false, lockedEdit: false, showLabel: false,
  };
}

export function newMarker(kind, x, y) {
  const m = {
    id: uid(kind), type: 'marker', kind, name: MARKER_KINDS[kind]?.label ?? kind, x, y, rot: 0,
    characterId: '', pose: '', text: '', evidenceId: '', required: false,
    icon: '', asset: '', color: '', w: 1, h: 1, height: 1, prefab: '',
    lightColor: '#ffe9c4', intensity: 1, range: 6,
    triggerType: 'announcement', once: true, eventId: '',
    link: emptyLink(), cond: emptyCond(), notes: '', hidden: false, lockedEdit: false,
  };
  if (kind === 'trigger') { m.w = 2; m.h = 2; }
  if (kind === 'prop') { m.w = 1; m.h = 1; m.height = 0.9; m.icon = 'box'; }
  if (kind === 'portal') { m.icon = 'arrow'; m.text = ''; }
  if (kind === 'note') { m.text = 'Note'; m.name = 'Note'; }
  return m;
}

export function newLabel(x, y, text = 'Label') {
  return { id: uid('label'), type: 'label', x, y, text, size: 1, color: '', rot: 0, cond: emptyCond(), hidden: false, lockedEdit: false };
}

export function newMap(name = 'New map', floor = 1) {
  return {
    id: uid('map'), name, building: 'School', floor, elevation: (floor - 1) * 4,
    ox: 0, oy: 0,            // where this map sits in the building view (grid cells)
    areas: [],               // named parts of this map: [{ id, name }]; elements have .area = area id

    theme: '', notes: '',
    bg: { asset: '', x: 0, y: 0, scale: 0.1, opacity: 0.5, visible: true, locked: true },
    elements: [],
  };
}

export const DEFAULT_CAST = [
  ['Stitch', '#4aa3ff'], ['Nina', '#ff8fb1'], ['King', '#ffcf4a'], ['Cameron', '#8fd18f'],
  ['Maia', '#c79bff'], ['Alfie', '#ff9a52'], ['Amelia', '#ff5e7a'], ['Atlantis', '#4ad6d6'],
  ['Christie', '#f2a7e8'], ['Drago', '#9b6b4a'], ['Lola', '#e04f4f'], ['Rossisco', '#7a7aff'],
];

export function newProject(name = 'Untitled project') {
  const map = newMap('1F', 1);
  return {
    format: FORMAT, version: VERSION, id: uid('proj'), name,
    settings: {
      cellSize: 1,            // metres per grid cell
      unitsPerMetre: 1.36,    // TVF scale: Stitch is 5'9" = 2.376 units, so 1 m ≈ 1.36 units
      wallHeight: 3,          // metres
      doorHeight: 2.2,
      doorWidth: 1,           // cells; default door length
      wallThickness: 0.12,
      eyeHeight: 1.43,        // metres (1.95 Unity units / 1.36)
      floorGap: 4,            // metres between floors in the building view
      walkSpeed: 1.9, runSpeed: 4.1,
      fov: 60,                // walk-mode camera field of view (degrees, vertical) — matches the TVF overworld camera
      theme: 'dr1',
      mapScreenStyle: 'classic', // classic (DR1 flat) | v3 (tilted)
    },
    chapters: ['Prologue', 'Chapter 1', 'Chapter 2', 'Chapter 3', 'Chapter 4', 'Chapter 5', 'Chapter 6', 'Epilogue'],
    times: ['Morning', 'Daytime', 'Evening', 'Nighttime'],
    flags: [],
    characters: DEFAULT_CAST.map(([n, c]) => ({ id: 'chr_' + n.toLowerCase(), name: n, color: c, asset: '', initials: n.slice(0, 2) })),
    evidence: [],
    customThemes: [],
    prefabs: [],
    versions: [],
    plan: [],                 // checklist: [{ id, name, floor, chapter, done }]
    assets: {},               // id -> { name, data (dataURL) }
    startMapId: map.id,
    maps: [map],
  };
}

// ---- Conditions -------------------------------------------------------------

/** Is an element present for the chosen view state? view = { chapter, time, flags:Set } (-1 = any). */
/**
 * Is a room or door locked at this point in the story?
 *  - "Show as locked" ticked (rooms), or a door's lock state isn't Open
 *  - or it only unlocks in a later chapter than the one picked in the top bar
 * With "All chapters" picked, chapter locks are ignored (everything shows as open).
 */
export function lockedNow(el, view) {
  if (!el) return false;
  if (el.type === 'room' && el.locked) return true;
  if (el.type === 'door' && el.lock && el.lock !== 'open') return true;
  if (el.unlockChapter >= 0 && view && view.chapter >= 0 && view.chapter < el.unlockChapter) return true;
  return false;
}

export function condActive(cond, view) {
  if (!cond || !view) return true;
  if (view.chapter >= 0) {
    if (cond.chMin >= 0 && view.chapter < cond.chMin) return false;
    if (cond.chMax >= 0 && view.chapter > cond.chMax) return false;
  }
  if (view.time >= 0 && cond.times && cond.times.length && !cond.times.includes(view.time)) return false;
  if (view.useFlags) {
    if (cond.flag && !view.flags.has(cond.flag)) return false;
    if (cond.notFlag && view.flags.has(cond.notFlag)) return false;
  }
  return true;
}

export function condSummary(cond, project) {
  if (!cond) return '';
  const parts = [];
  const ch = project.chapters;
  if (cond.chMin >= 0 || cond.chMax >= 0) {
    if (cond.chMin === cond.chMax) parts.push(ch[cond.chMin] ?? '?');
    else parts.push(`${cond.chMin >= 0 ? ch[cond.chMin] : 'start'} → ${cond.chMax >= 0 ? ch[cond.chMax] : 'end'}`);
  }
  if (cond.times?.length) parts.push(cond.times.map((t) => project.times[t]).join('/'));
  if (cond.flag) parts.push('if ' + flagName(project, cond.flag));
  if (cond.notFlag) parts.push('unless ' + flagName(project, cond.notFlag));
  return parts.join(', ');
}
function flagName(project, id) {
  return project.flags.find((f) => f.id === id)?.name ?? id;
}

// ---- Geometry helpers --------------------------------------------------------

export function elementBounds(el) {
  if (el.rects) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of el.rects) { x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  if (el.type === 'door') return el.orient === 'h' ? { x: el.x, y: el.y - 0.15, w: el.len, h: 0.3 } : { x: el.x - 0.15, y: el.y, w: 0.3, h: el.len };
  if (el.type === 'marker') {
    if (el.kind === 'trigger' || el.kind === 'prop') return { x: el.x - el.w / 2, y: el.y - el.h / 2, w: el.w, h: el.h };
    return { x: el.x - 0.4, y: el.y - 0.4, w: 0.8, h: 0.8 };
  }
  if (el.type === 'label') {
    const w = Math.max(1, (el.text?.length ?? 4) * 0.42 * (el.size || 1));
    return { x: el.x - w / 2, y: el.y - 0.4 * (el.size || 1), w, h: 0.8 * (el.size || 1) };
  }
  return { x: el.x ?? 0, y: el.y ?? 0, w: 1, h: 1 };
}

export function rectArea(el) {
  return el.rects ? el.rects.reduce((a, r) => a + r.w * r.h, 0) : 0;
}

export function roomCenter(el) {
  // centre of the largest rect – where the icon/label goes
  if (!el.rects?.length) return { x: el.x ?? 0, y: el.y ?? 0 };
  let best = el.rects[0];
  for (const r of el.rects) if (r.w * r.h > best.w * best.h) best = r;
  return { x: best.x + best.w / 2, y: best.y + best.h / 2 };
}

/** Turn a set of "x,y" cell keys into a few rectangles (greedy rows-then-grow). */
export function cellsToRects(cellSet) {
  const cells = new Set(cellSet);
  const rects = [];
  const keys = [...cells].map((k) => k.split(',').map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  for (const [sx, sy] of keys) {
    if (!cells.has(sx + ',' + sy)) continue;
    let w = 1;
    while (cells.has(sx + w + ',' + sy)) w++;
    let h = 1;
    grow: for (;;) {
      for (let i = 0; i < w; i++) if (!cells.has(sx + i + ',' + (sy + h))) break grow;
      h++;
    }
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) cells.delete(sx + i + ',' + (sy + j));
    rects.push({ x: sx, y: sy, w, h });
  }
  return rects;
}

export function rectsToCells(rects) {
  const s = new Set();
  for (const r of rects) for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) s.add(r.x + i + ',' + (r.y + j));
  return s;
}

/** Bring an older or partial project file up to date. */
export function migrate(p) {
  const base = newProject(p.name);
  const out = { ...base, ...p, settings: { ...base.settings, ...(p.settings || {}) } };
  for (const k of ['chapters', 'times', 'flags', 'characters', 'evidence', 'customThemes', 'prefabs', 'versions', 'plan']) if (!Array.isArray(out[k])) out[k] = base[k];
  out.assets = out.assets || {};
  out.maps = (out.maps || []).map((m) => {
    const nm = { ...newMap(m.name, m.floor ?? 1), ...m };
    nm.bg = { ...newMap().bg, ...(m.bg || {}) };
    nm.elements = (m.elements || []).map((e) => {
      let d;
      if (e.type === 'room') d = newRoom(e.kind || 'room', { x: 0, y: 0, w: 1, h: 1 });
      else if (e.type === 'door') d = newDoor(0, 0, 'h');
      else if (e.type === 'stairs') d = newStairs({ x: 0, y: 0, w: 1, h: 1 });
      else if (e.type === 'marker') d = newMarker(e.kind || 'note', 0, 0);
      else d = newLabel(0, 0);
      const r = { ...d, ...e };
      r.cond = { ...emptyCond(), ...(e.cond || {}) };
      if ('link' in d) r.link = { ...emptyLink(), ...(e.link || {}) };
      return r;
    });
    return nm;
  });
  if (!out.maps.length) out.maps = [newMap('1F', 1)];
  if (!out.maps.find((m) => m.id === out.startMapId)) out.startMapId = out.maps[0].id;
  out.format = FORMAT; out.version = VERSION;
  return out;
}

/** A map limited to one area ('' = the parts not in any area). Maps without areas are returned whole. */
export function areaView(map, areaId) {
  if (areaId == null || !map.areas?.length) return map;
  return { ...map, elements: map.elements.filter((e) => (e.area || '') === areaId) };
}

/** Map-screen pages: one per area (plus the leftover part), or one per map when it has no areas. */
export function screenPages(project) {
  const pages = [];
  for (const m of project.maps) {
    if (!m.areas?.length) { pages.push({ key: m.id + '|', map: m, area: null, name: m.name }); continue; }
    const loose = m.elements.some((e) => !e.area && e.type === 'room');
    if (loose) pages.push({ key: m.id + '|', map: m, area: '', name: m.name });
    for (const a of m.areas) pages.push({ key: m.id + '|' + a.id, map: m, area: a.id, name: m.name + ' – ' + a.name, areaName: a.name });
  }
  return pages;
}

export function findElement(project, id) {
  for (const m of project.maps) for (const e of m.elements) if (e.id === id) return { map: m, el: e };
  return null;
}

export function elementTitle(el, project) {
  if (!el) return '';
  if (el.type === 'room') return el.name || (ROOM_KINDS[el.kind]?.label ?? 'Room');
  if (el.type === 'door') return el.name || (el.link?.mapId ? 'Linked door' : 'Door');
  if (el.type === 'stairs') return el.name || 'Stairs';
  if (el.type === 'label') return '“' + (el.text || '') + '”';
  if (el.type === 'marker') {
    if (el.kind === 'npc' && el.characterId) return project?.characters.find((c) => c.id === el.characterId)?.name ?? el.name;
    return el.name || MARKER_KINDS[el.kind]?.label;
  }
  return el.id;
}
