// Preview of the in-game map screen: Place list (fast travel), Student locations, fog of war.
import { S, emit, on, scheduleAutosave } from './store.js';
import { renderV3 } from './mapscreenV3.js';
import { h } from './dom.js';
import { renderMapImage } from './render2d.js';
import { getTheme } from './themes.js';
import { bakeMap, cellAt } from './bake.js';
import { condActive, elementTitle, roomCenter } from './model.js';

const PX = 44; // pixels per cell: high enough to stay sharp when you zoom in
let host, tab = 'place', mapId = null, chosen = null, playerView = false;
const visited = new Set();

export function initScreen(el) { host = el; }

export function renderScreen() {
  if (!host) return;
  if (String(S.project.settings.mapScreenStyle || 'classic').startsWith('v3')) { renderV3(host, v3Pending); v3Pending = null; return; }
  if (!mapId || !S.project.maps.find((m) => m.id === mapId)) mapId = S.mapId;
  const m = S.project.maps.find((x) => x.id === mapId);
  const sameBuilding = S.project.maps.filter((x) => x.building === m.building).sort((a, b) => (a.floor ?? 0) - (b.floor ?? 0));
  const idx = sameBuilding.indexOf(m);
  const T = getTheme(S.project, m);
  const vis = (e) => !e.hidden && condActive(e.cond, S.view);
  const discovered = playerView ? new Set(m.elements.filter((e) => e.type === 'room' && (e.discover === 'always' || visited.has(e.id) || (e.discover === 'flag' && S.view.flags.has(e.discoverFlag)))).map((e) => e.id)) : null;

  const rooms = m.elements.filter((e) => e.type === 'room' && e.kind === 'room' && e.name && vis(e) && (!discovered || discovered.has(e.id)));
  const students = [];
  for (const mp of S.project.maps) {
    const baked = bakeMap(mp, S.view);
    for (const e of mp.elements) {
      if (e.type !== 'marker' || e.kind !== 'npc' || !vis(e)) continue;
      const ch = S.project.characters.find((c) => c.id === e.characterId);
      if (!ch) continue;
      const room = cellAt(baked, e.x, e.y)?.el;
      students.push({ ch, e, map: mp, room });
    }
  }

  const { canvas, bounds, margin } = renderMapImage(m, S.project, T, { pxPerCell: PX, view: S.view, discovered, transparent: true, onImage: () => setTimeout(renderScreen, 50) });
  const g = canvas.getContext('2d');
  const toPx = (x, y) => [(x - bounds.x + margin) * PX, (y - bounds.y + margin) * PX];
  // student pins on this floor
  for (const s of students) if (s.map.id === m.id) {
    const [px, py] = toPx(s.e.x, s.e.y);
    g.fillStyle = s.ch.color; g.strokeStyle = '#fff'; g.lineWidth = 2;
    g.beginPath(); g.arc(px, py, 7, 0, Math.PI * 2); g.fill(); g.stroke();
  }
  if (chosen) {
    const el = m.elements.find((e) => e.id === chosen);
    if (el) {
      g.save(); g.strokeStyle = T.accent; g.lineWidth = 4; g.shadowColor = T.accent; g.shadowBlur = 12;
      if (el.rects) for (const r of el.rects) { const [x, y] = toPx(r.x, r.y); g.strokeRect(x + 2, y + 2, r.w * PX - 4, r.h * PX - 4); }
      else { const [x, y] = toPx(el.x, el.y); g.beginPath(); g.arc(x, y, 14, 0, Math.PI * 2); g.stroke(); }
      g.restore();
    }
  }

  const list = tab === 'place'
    ? rooms.map((r) => h('div', { class: 'ms-item' + (chosen === r.id ? ' on' : ''), onclick: () => { chosen = r.id; visited.add(r.id); renderScreen(); }, ondblclick: () => emit('walk-at', { mapId: m.id, ...roomCenter(r) }) }, r.name, r.locked ? h('span', { class: 'sub' }, '🔒') : null))
    : students.map((s) => h('div', { class: 'ms-item' + (chosen === s.e.id ? ' on' : ''), onclick: () => { mapId = s.map.id; chosen = s.e.id; renderScreen(); } },
      h('span', { class: 'dot', style: { backgroundColor: s.ch.color, backgroundImage: s.ch.asset && S.project.assets[s.ch.asset] ? `url(${S.project.assets[s.ch.asset].data})` : '' } }),
      s.ch.name, h('span', { class: 'sub' }, `${s.map.name}${s.room ? ' · ' + elementTitle(s.room, S.project) : ''}`)));

  host.replaceChildren(
    h('div', { class: 'ms-side' },
      h('div', { class: 'ms-title' }, 'MAP'),
      h('div', { class: 'ms-floor' },
        h('button', { disabled: idx <= 0, onclick: () => { mapId = sameBuilding[idx - 1].id; chosen = null; renderScreen(); } }, '◀'),
        h('div', { class: 'nm' }, (m.building ? m.building + ' – ' : '') + m.name),
        h('button', { disabled: idx >= sameBuilding.length - 1, onclick: () => { mapId = sameBuilding[idx + 1].id; chosen = null; renderScreen(); } }, '▶')),
      h('div', { class: 'ms-tabs' }, h('button', { class: tab === 'place' ? 'on' : '', onclick: () => { tab = 'place'; renderScreen(); } }, 'PLACE'), h('button', { class: tab === 'student' ? 'on' : '', onclick: () => { tab = 'student'; renderScreen(); } }, 'STUDENT')),
      h('div', { class: 'ms-list' }, list.length ? list : h('div', { class: 'ms-item' }, tab === 'place' ? 'No named rooms here yet' : 'No characters placed for this chapter / time')),
      h('div', { class: 'hint' }, 'Double-click a place to walk there. Clicking a place marks it as visited.')),
    panZoomArea(canvas, m.id,
      h('div', { class: 'ms-opts' },
        h('button', { class: 'mini', title: 'Back to the whole map', onclick: () => { cam = { z: 1, tx: 0, ty: 0, mapId: m.id }; renderScreen(); } }, '⤢ Reset view'),
        h('label', { class: 'tiny' }, h('input', { type: 'checkbox', checked: playerView, onchange: (e) => { playerView = e.target.checked; renderScreen(); } }), 'As the player sees it (fog of war)'),
        playerView ? h('button', { class: 'mini', onclick: () => { visited.clear(); renderScreen(); } }, 'Forget visits') : null,
        h('button', { class: 'mini primary', title: 'Tilted V3-style map screen', onclick: () => { S.project.settings.mapScreenStyle = 'v3'; S.dirty = true; scheduleAutosave(); emit('screen-style'); } }, 'V3 style'),
        h('button', { class: 'mini primary', title: 'Tilted 3D map with the alternative menu', onclick: () => { S.project.settings.mapScreenStyle = 'v3alt'; S.dirty = true; scheduleAutosave(); emit('screen-style'); } }, 'V3 alt menu'),
        h('span', { class: 'hint' }, S.view.chapter >= 0 ? S.project.chapters[S.view.chapter] : 'All chapters', ' · ', S.view.time >= 0 ? S.project.times[S.view.time] : 'any time'))),
  );
}
// ---- move around the classic map: drag to pan, scroll to zoom towards the mouse ----
let cam = { z: 1, tx: 0, ty: 0, mapId: null };
function panZoomArea(canvas, id, ...extra) {
  if (cam.mapId !== id) cam = { z: 1, tx: 0, ty: 0, mapId: id };
  const view = h('div', { class: 'ms-view' }, canvas);
  const apply = () => { view.style.transform = `translate(${cam.tx}px, ${cam.ty}px) scale(${cam.z})`; };
  apply();
  const area = h('div', { class: 'ms-map' }, view, ...extra);
  area.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = area.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    // z = 1 is the whole map fitted to the panel; allow zooming out to a fifth of that, in to 10×
    const nz = Math.max(0.2, Math.min(10, cam.z * Math.pow(1.0018, -e.deltaY * (e.deltaMode === 1 ? 30 : 1))));
    cam.tx = px - (px - cam.tx) * (nz / cam.z);
    cam.ty = py - (py - cam.ty) * (nz / cam.z);
    cam.z = nz;
    apply();
  }, { passive: false });
  let drag = null;
  area.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.ms-opts')) return;
    drag = { x: e.clientX, y: e.clientY, tx: cam.tx, ty: cam.ty };
    area.setPointerCapture(e.pointerId);
    area.style.cursor = 'grabbing';
  });
  area.addEventListener('pointermove', (e) => {
    if (!drag) return;
    cam.tx = drag.tx + (e.clientX - drag.x); cam.ty = drag.ty + (e.clientY - drag.y);
    apply();
  });
  area.addEventListener('pointerup', () => { drag = null; area.style.cursor = ''; });
  return area;
}

export function screenMap(id) { mapId = id; chosen = null; v3Pending = id; }
let v3Pending = null;
on('screen-style', () => { if (S.mode === 'screen') { v3Pending = mapId; renderScreen(); } });
