// The 2D editor canvas: camera, tools, selection, dragging, handles.
import { S, map, change, begin, end, emit, on, selected } from './store.js';
const changeUndo = change;
import { bakeMap } from './bake.js';
import { drawMap, drawGrid, mapBounds } from './render2d.js';
import { getTheme } from './themes.js';
import { assetImage } from './icons.js';
import {
  areaView, findElement, newRoom, newDoor, newStairs, newMarker, newLabel, elementBounds, rectArea, rectsToCells, cellsToRects, condActive, uid, elementTitle,
} from './model.js';

const cams = new Map();
let canvas, g, mini, mg;
let W = 0, H = 0, dpr = 1;
let baked = null, bakedKey = '';
let mouse = { sx: 0, sy: 0, gx: 0, gy: 0, inside: false };
let drag = null;
let hover = null;
let spaceDown = false;
let needs = true;
let pickMode = null; // { onPick(el, map) , label }

export const ROOM_TOOLS = { room: 'room', hall: 'hall', blocked: 'blocked', outdoor: 'outdoor' };

export function cam() {
  let c = cams.get(S.mapId);
  if (!c) { c = { cell: 28, ox: 0, oy: 0 }; cams.set(S.mapId, c); fit(c); }
  return c;
}

export function initEditor(cv, miniCv) {
  canvas = cv; g = cv.getContext('2d');
  mini = miniCv; mg = miniCv.getContext('2d');
  const ro = new ResizeObserver(resize);
  ro.observe(canvas.parentElement);
  resize();
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('dblclick', onDbl);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerleave', () => { mouse.inside = false; hover = null; request(); });
  canvas.addEventListener('pointerenter', () => { mouse.inside = true; });
  mini.addEventListener('pointerdown', miniPan);
  mini.addEventListener('pointermove', (e) => e.buttons & 1 && miniPan(e));
  window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !isTyping(e)) { spaceDown = true; canvas.style.cursor = 'grab'; } });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') { spaceDown = false; updateCursor(); } });
  on('change', () => { bakedKey = ''; request(); });
  on('view', () => { bakedKey = ''; request(); });
  on('map', () => { bakedKey = ''; request(); });
  on('selection', request);
  on('tool', () => { updateCursor(); request(); });
  requestAnimationFrame(loop);
}

function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  dpr = window.devicePixelRatio || 1;
  W = r.width; H = r.height;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  mini.width = Math.round(180 * dpr); mini.height = Math.round(120 * dpr);
  request();
}

export function request() { needs = true; }
function loop() {
  if (needs && S.mode === 'edit') { needs = false; render(); }
  requestAnimationFrame(loop);
}

/** The map as you're looking at it: just one area when an area is chosen in the Areas panel. */
let lastBakeAt = 0;
let dragBakeKey = '', dragBaked = null;
/** Ids of the rooms/doors/stairs being moved, resized or scaled right now (null if not dragging any). */
function draggedIds() {
  if (!drag) return null;
  let els = null;
  if ((drag.type === 'move' || drag.type === 'gscale') && drag.orig) els = drag.orig.map(([e]) => e);
  else if (drag.type === 'resize' && drag.el) els = [drag.el];
  if (!els) return null;
  els = els.filter((e) => e.rects || e.type === 'door');
  return els.length ? new Set(els.map((e) => e.id)) : null;
}
/** Draw the things being dragged, live, as simple shapes (fast, so dragging stays smooth). */
function drawDragged(T) {
  const ids = draggedIds();
  if (!ids) return;
  const c = cam();
  g.save();
  for (const e of map().elements) {
    if (!ids.has(e.id)) continue;
    if (e.rects) {
      g.fillStyle = e.kind === 'blocked' ? T.hatchBg : e.type === 'stairs' ? (T.stairs || T.hall) : e.kind === 'room' ? (e.color || T.room) : (e.color || T.hall);
      g.strokeStyle = T.line; g.lineWidth = Math.max(1.5, c.cell * 0.12);
      for (const r of e.rects) { const x = c.ox + r.x * c.cell, y = c.oy + r.y * c.cell; g.fillRect(x, y, r.w * c.cell, r.h * c.cell); g.strokeRect(x, y, r.w * c.cell, r.h * c.cell); }
    } else if (e.type === 'door') {
      g.strokeStyle = T.accent; g.lineWidth = 5; g.lineCap = 'round';
      const a = toScreen(e.x, e.y), b = e.orient === 'h' ? toScreen(e.x + e.len, e.y) : toScreen(e.x, e.y + e.len);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
  }
  g.restore();
}
export function viewMap() {
  const m = map();
  return S.areaFilter == null ? m : areaView(m, S.areaFilter);
}

export function getBaked() {
  const m = viewMap();
  const key = m.id + '|' + S.areaFilter + '|' + JSON.stringify(S.view.chapter) + S.view.time + [...S.view.flags].join() + S.view.useFlags;
  // While dragging, re-work-out the walls at most ~10× a second (big maps take a few dozen ms);
  // letting go always gives an exact update.
  const ids = draggedIds();
  if (ids) {
    // while dragging: the rest of the map is worked out once; the dragged things are drawn live on top
    const k = 'drag:' + m.id + [...ids].join();
    if (dragBakeKey !== k || !dragBaked) { dragBaked = bakeMap({ ...m, elements: m.elements.filter((e) => !ids.has(e.id)) }, S.view); dragBakeKey = k; }
    return dragBaked;
  }
  dragBakeKey = ''; dragBaked = null;
  if (!baked || bakedKey !== key) { baked = bakeMap(m, S.view); bakedKey = key; lastBakeAt = performance.now(); }
  return baked;
}

// ---- Coordinates ------------------------------------------------------------------
const toGrid = (sx, sy) => { const c = cam(); return { x: (sx - c.ox) / c.cell, y: (sy - c.oy) / c.cell }; };
const toScreen = (x, y) => { const c = cam(); return { x: c.ox + x * c.cell, y: c.oy + y * c.cell }; };
const snapHalf = (v, alt) => (alt || !S.snap ? Math.round(v * 8) / 8 : Math.round(v * 2) / 2);

export function fit(c = cam(), b = mapBounds(map())) {
  const pad = 2;
  const cell = Math.max(0.5, Math.min(64, Math.min((W || 800) / (b.w + pad * 2), (H || 600) / (b.h + pad * 2))));
  c.cell = cell;
  c.ox = (W || 800) / 2 - (b.x + b.w / 2) * cell;
  c.oy = (H || 600) / 2 - (b.y + b.h / 2) * cell;
  request();
}
export function zoomTo(b) {
  fit(cam(), { x: b.x - 2, y: b.y - 2, w: b.w + 4, h: b.h + 4 });
}
export function zoomBy(f, sx = W / 2, sy = H / 2) {
  const c = cam();
  const gp = toGrid(sx, sy);
  // you can always zoom out to see the whole map (plus some), however big it is
  const b = mapBounds(map());
  const fitCell = Math.min((W || 800) / (b.w + 4), (H || 600) / (b.h + 4));
  c.cell = Math.max(Math.min(4, fitCell * 0.5), Math.min(160, c.cell * f));
  c.ox = sx - gp.x * c.cell; c.oy = sy - gp.y * c.cell;
  request();
  emit('zoom', c.cell);
}
export function centerOn(x, y) {
  const c = cam();
  c.ox = W / 2 - x * c.cell; c.oy = H / 2 - y * c.cell;
  request();
}
export function mouseGrid() { return { x: mouse.gx, y: mouse.gy, inside: mouse.inside }; }

// ---- Picking ------------------------------------------------------------------------
function visibleEl(e) { return !e.hidden && condActive(e.cond, S.view); }

export function pickAt(x, y, { includeLocked = true } = {}) {
  const m = viewMap();
  const els = m.elements.filter((e) => visibleEl(e) && (includeLocked || !e.lockedEdit));
  // markers + labels first (topmost)
  for (let i = els.length - 1; i >= 0; i--) {
    const e = els[i];
    if (e.type === 'marker') {
      if (e.kind === 'trigger' || e.kind === 'prop') continue;
      if (Math.hypot(e.x - x, e.y - y) < 0.45) return e;
    }
  }
  for (let i = els.length - 1; i >= 0; i--) {
    const e = els[i];
    if (e.type === 'label') { const b = elementBounds(e); if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return e; }
  }
  for (let i = els.length - 1; i >= 0; i--) {
    const e = els[i];
    if (e.type !== 'door') continue;
    const d = e.orient === 'h'
      ? (x >= e.x - 0.1 && x <= e.x + e.len + 0.1 ? Math.abs(y - e.y) : 9)
      : (y >= e.y - 0.1 && y <= e.y + e.len + 0.1 ? Math.abs(x - e.x) : 9);
    if (d < 0.28) return e;
  }
  for (let i = els.length - 1; i >= 0; i--) {
    const e = els[i];
    if (e.type === 'marker' && (e.kind === 'prop' || e.kind === 'trigger')) {
      if (Math.abs(x - e.x) <= e.w / 2 && Math.abs(y - e.y) <= e.h / 2) return e;
    }
  }
  for (let i = els.length - 1; i >= 0; i--) {
    const e = els[i];
    if (e.type === 'stairs' && e.rects.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)) return e;
  }
  // rooms: smallest first so a room inside a hall wins
  const rooms = els.filter((e) => e.type === 'room' && e.rects.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h));
  rooms.sort((a, b) => rectArea(a) - rectArea(b));
  return rooms[0] ?? null;
}

function handlesFor(el) {
  if (!el || el.lockedEdit) return [];
  let b;
  if ((el.type === 'room' || el.type === 'stairs') && el.rects.length === 1) b = el.rects[0];
  else if (el.type === 'marker' && (el.kind === 'trigger' || el.kind === 'prop')) b = { x: el.x - el.w / 2, y: el.y - el.h / 2, w: el.w, h: el.h };
  else if (el.type === 'door') {
    return el.orient === 'h' ? [{ id: 'dl', x: el.x, y: el.y }, { id: 'dr', x: el.x + el.len, y: el.y }] : [{ id: 'dt', x: el.x, y: el.y }, { id: 'db', x: el.x, y: el.y + el.len }];
  } else return [];
  const { x, y, w, h } = b;
  return [
    { id: 'nw', x, y }, { id: 'n', x: x + w / 2, y }, { id: 'ne', x: x + w, y },
    { id: 'w', x, y: y + h / 2 }, { id: 'e', x: x + w, y: y + h / 2 },
    { id: 'sw', x, y: y + h }, { id: 's', x: x + w / 2, y: y + h }, { id: 'se', x: x + w, y: y + h },
  ];
}

function boxHandles(b) {
  const { x, y, w, h } = b;
  return [
    { id: 'nw', x, y }, { id: 'n', x: x + w / 2, y }, { id: 'ne', x: x + w, y },
    { id: 'w', x, y: y + h / 2 }, { id: 'e', x: x + w, y: y + h / 2 },
    { id: 'sw', x, y: y + h }, { id: 's', x: x + w / 2, y: y + h }, { id: 'se', x: x + w, y: y + h },
  ];
}
/** Several things selected (or one thing without its own handles) → a box around the lot that scales it all. */
function useGroupBox(sel) {
  if (sel.length > 1) return true;
  return sel.length === 1 && !!sel[0].rects && handlesFor(sel[0]).length === 0;
}
function editableSel() { return selected().filter((e) => !e.lockedEdit); }
function rotHandle(b) { const p = toScreen(b.x + b.w / 2, b.y); return { sx: p.x, sy: p.y - 28 }; }

function handleAt(sx, sy) {
  const sel = editableSel();
  if (!sel.length) return null;
  const b = groupBounds(sel);
  const r = rotHandle(b);
  if (Math.hypot(r.sx - sx, r.sy - sy) < 10) return { rot: true, b, sel, h: { id: 'rot' } };
  if (useGroupBox(sel)) {
    for (const h of boxHandles(b)) { const p = toScreen(h.x, h.y); if (Math.abs(p.x - sx) < 7 && Math.abs(p.y - sy) < 7) return { group: true, h, b, sel }; }
    return null;
  }
  if (sel.length !== 1) return null;
  for (const h of handlesFor(sel[0])) {
    const p = toScreen(h.x, h.y);
    if (Math.abs(p.x - sx) < 7 && Math.abs(p.y - sy) < 7) return { h, el: sel[0] };
  }
  return null;
}

/** Scale a whole selection to a new box (everything snaps back onto the grid). */
function groupScale(d, gp, e) {
  const o = d.b;
  const q = d.structural ? 1 : (S.snap && !e.altKey ? 0.5 : 0.125);
  const sn = (v) => Math.round(v / q) * q;
  let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
  if (d.h.includes('w')) x0 = Math.min(sn(gp.x), x1 - q);
  if (d.h.includes('e')) x1 = Math.max(sn(gp.x), x0 + q);
  if (d.h.includes('n')) y0 = Math.min(sn(gp.y), y1 - q);
  if (d.h.includes('s')) y1 = Math.max(sn(gp.y), y0 + q);
  if (e.shiftKey && d.h.length === 2) { // keep proportions on corners
    const s = Math.max((x1 - x0) / o.w, (y1 - y0) / o.h);
    if (d.h.includes('w')) x0 = x1 - sn(o.w * s); else x1 = x0 + sn(o.w * s);
    if (d.h.includes('n')) y0 = y1 - sn(o.h * s); else y1 = y0 + sn(o.h * s);
  }
  const sx = (x1 - x0) / o.w, sy = (y1 - y0) / o.h;
  const X = (v) => x0 + (v - o.x) * sx, Y = (v) => y0 + (v - o.y) * sy;
  d.newBox = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  for (const [el, src] of d.orig) {
    if (src.rects) {
      const cells = new Set();
      const keep = S.keepThick.has(src.type === 'stairs' ? 'stairs' : src.kind);
      for (const r of src.rects) {
        let rx0 = Math.round(X(r.x)), rx1 = Math.max(rx0 + 1, Math.round(X(r.x + r.w)));
        let ry0 = Math.round(Y(r.y)), ry1 = Math.max(ry0 + 1, Math.round(Y(r.y + r.h)));
        if (keep) {
          // keep the thin side (a corridor's width) as it was; only its length and position scale
          if (r.w <= r.h) { const cx = (X(r.x) + X(r.x + r.w)) / 2; rx0 = Math.round(cx - r.w / 2); rx1 = rx0 + r.w; }
          if (r.h <= r.w) { const cy = (Y(r.y) + Y(r.y + r.h)) / 2; ry0 = Math.round(cy - r.h / 2); ry1 = ry0 + r.h; }
        }
        for (const c of rectsToCells([{ x: rx0, y: ry0, w: rx1 - rx0, h: ry1 - ry0 }])) cells.add(c);
      }
      el.rects = cellsToRects(cells);
    } else if (src.type === 'door') {
      if (src.orient === 'h') { el.x = Math.round(X(src.x)); el.len = Math.max(1, Math.round(X(src.x + src.len)) - el.x); el.y = Math.round(Y(src.y)); }
      else { el.y = Math.round(Y(src.y)); el.len = Math.max(1, Math.round(Y(src.y + src.len)) - el.y); el.x = Math.round(X(src.x)); }
    } else {
      el.x = Math.round(X(src.x) * 8) / 8; el.y = Math.round(Y(src.y) * 8) / 8;
      if (src.kind === 'trigger' || src.kind === 'prop') { el.w = Math.max(0.25, src.w * sx); el.h = Math.max(0.25, src.h * sy); }
      if (src.type === 'label') el.size = Math.max(0.25, Math.round(src.size * Math.min(sx, sy) * 4) / 4);
    }
  }
}

function nearestEdge(x, y) {
  const fx = x - Math.floor(x), fy = y - Math.floor(y);
  const dh = Math.min(fy, 1 - fy), dv = Math.min(fx, 1 - fx);
  if (dh < dv) return { orient: 'h', x: Math.floor(x), y: Math.round(y) };
  return { orient: 'v', x: Math.round(x), y: Math.floor(y) };
}

// ---- Pointer handling --------------------------------------------------------------
function local(e) {
  const r = canvas.getBoundingClientRect();
  return { sx: e.clientX - r.left, sy: e.clientY - r.top };
}

function onDown(e) {
  canvas.focus();
  if (document.activeElement && document.activeElement !== canvas && document.activeElement.blur) document.activeElement.blur();
  const { sx, sy } = local(e);
  const gp = toGrid(sx, sy);
  canvas.setPointerCapture(e.pointerId);
  if (e.button === 1 || e.button === 2 || spaceDown || S.tool === 'pan') {
    const c = cam();
    drag = { type: 'pan', sx, sy, ox: c.ox, oy: c.oy, button: e.button, moved: false };
    canvas.style.cursor = 'grabbing';
    return;
  }
  if (e.button !== 0) return;

  if (pickMode) {
    const el = pickAt(gp.x, gp.y);
    if (el || pickMode.allowEmpty) { const pm = pickMode; pickMode = null; emit('pickmode', null); pm.onPick(el, map(), gp); }
    return;
  }

  if (S.tool === 'connect') { startConnect(gp); return; }

  const tool = S.tool;
  if (tool === 'select') {
    const hd = handleAt(sx, sy);
    if (hd?.rot) {
      const c = toScreen(hd.b.x + hd.b.w / 2, hd.b.y + hd.b.h / 2);
      drag = { type: 'rotate', b: hd.b, cx: c.x, cy: c.y, a0: Math.atan2(sy - c.y, sx - c.x), steps: 0 };
      return;
    }
    if (hd?.group) {
      begin(`Scale ${hd.sel.length} item${hd.sel.length > 1 ? 's' : ''}`);
      drag = { type: 'gscale', h: hd.h.id, b: hd.b, orig: hd.sel.map((x) => [x, JSON.parse(JSON.stringify(x))]), structural: hd.sel.some((x) => x.type !== 'marker' && x.type !== 'label') };
      return;
    }
    if (hd) {
      begin('Resize ' + elementTitle(hd.el, S.project));
      drag = { type: 'resize', h: hd.h.id, el: hd.el, orig: JSON.parse(JSON.stringify(hd.el)), start: gp };
      return;
    }
    const el = pickAt(gp.x, gp.y);
    if (el) {
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        if (S.selection.has(el.id)) S.selection.delete(el.id); else S.selection.add(el.id);
        emit('selection');
        if (!S.selection.has(el.id)) return;
      } else if (!S.selection.has(el.id)) {
        S.selection.clear(); S.selection.add(el.id); emit('selection');
      }
      if (e.altKey) {
        // Alt-drag duplicates
        begin('Duplicate');
        duplicateSelection(0, 0, true);
      }
      const els = selected().filter((x) => !x.lockedEdit);
      if (!e.altKey) begin(els.length === 1 ? 'Move ' + elementTitle(els[0], S.project) : `Move ${els.length} items`);
      drag = { type: 'move', start: gp, orig: els.map((x) => [x, JSON.parse(JSON.stringify(x))]), structural: els.some((x) => x.type !== 'marker' && x.type !== 'label'), moved: false };
      return;
    }
    if (!(e.shiftKey || e.ctrlKey)) { S.selection.clear(); emit('selection'); }
    drag = { type: 'box', start: gp, cur: gp, add: e.shiftKey || e.ctrlKey, base: new Set(S.selection) };
    return;
  }

  if (ROOM_TOOLS[tool] || tool === 'stairs') {
    const sxg = Math.floor(gp.x), syg = Math.floor(gp.y);
    let mode = 'new';
    const sel = selected();
    if (e.shiftKey && !S.shiftLock && sel.length === 1 && sel[0].rects) mode = 'add'; // (Shift held for Shift+key tool lock = keep making new ones)
    else if (e.altKey) mode = 'cut';
    drag = { type: 'rect', tool, x0: sxg, y0: syg, x1: sxg, y1: syg, mode };
    return;
  }
  if (tool === 'door') {
    const ed = nearestEdge(gp.x, gp.y);
    drag = { type: 'door', ed, len: defaultDoorLen(), start: gp, moved: false };
    return;
  }
  if (tool === 'marker') {
    const k = S.markerKind;
    const mk = newMarker(k, snapHalf(gp.x, e.altKey), snapHalf(gp.y, e.altKey));
    if (k === 'trigger' || k === 'prop') { mk.x = Math.floor(gp.x) + mk.w / 2; mk.y = Math.floor(gp.y) + mk.h / 2; }
    if (k === 'npc' || k === 'fte') {
      // pick the next character that isn't on this map yet
      const used = new Set(map().elements.filter((x) => x.kind === k).map((x) => x.characterId));
      const next = S.project.characters.find((c) => !used.has(c.id)) ?? S.project.characters[0];
      if (next) { mk.characterId = next.id; mk.name = next.name; }
    }
    if (k === 'spawn') { tagArea(mk); change('Move player start', () => { map().elements = map().elements.filter((x) => !(x.type === 'marker' && x.kind === 'spawn')); map().elements.push(mk); }); }
    else { tagArea(mk); change('Add ' + mk.name, () => map().elements.push(mk)); }
    S.selection.clear(); S.selection.add(mk.id); emit('selection');
    toolDone();
    return;
  }
  if (tool === 'label') {
    const lb = newLabel(snapHalf(gp.x), snapHalf(gp.y), 'Label');
    tagArea(lb); change('Add label', () => map().elements.push(lb));
    S.selection.clear(); S.selection.add(lb.id); emit('selection');
    toolDone();
    emit('focus-field', 'text');
    return;
  }
  if (tool === 'erase') {
    const el = pickAt(gp.x, gp.y, { includeLocked: false });
    if (el) change('Delete ' + elementTitle(el, S.project), () => { map().elements = map().elements.filter((x) => x !== el); });
    drag = { type: 'erase' };
  }
}

function onMove(e) {
  if (!canvas) return;
  const { sx, sy } = local(e);
  const gp = toGrid(sx, sy);
  mouse = { sx, sy, gx: gp.x, gy: gp.y, inside: mouse.inside || !!drag };
  emit('cursor', gp);
  if (!drag) {
    const newHover = S.tool === 'select' || S.tool === 'erase' || pickMode ? pickAt(gp.x, gp.y) : null;
    if (newHover !== hover) { hover = newHover; }
    updateCursor(sx, sy);
    request();
    return;
  }
  if (drag.type === 'pan') {
    const c = cam();
    c.ox = drag.ox + (sx - drag.sx); c.oy = drag.oy + (sy - drag.sy);
    if (Math.abs(sx - drag.sx) + Math.abs(sy - drag.sy) > 3) drag.moved = true;
  } else if (drag.type === 'move') {
    let dx = gp.x - drag.start.x, dy = gp.y - drag.start.y;
    if (drag.structural || (S.snap && !e.altKey)) {
      const q = drag.structural ? 1 : 0.5;
      dx = Math.round(dx / q) * q; dy = Math.round(dy / q) * q;
    }
    if (dx || dy) drag.moved = true;
    for (const [el, o] of drag.orig) translateFrom(el, o, dx, dy);
    bakedKey = '';
  } else if (drag.type === 'gscale') {
    groupScale(drag, gp, e);
    bakedKey = '';
  } else if (drag.type === 'rotate') {
    let da = Math.atan2(sy - drag.cy, sx - drag.cx) - drag.a0;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    drag.angle = da;
    drag.steps = Math.round(da / (Math.PI / 2));
  } else if (drag.type === 'resize') {
    resizeDrag(drag, gp, e);
    bakedKey = '';
  } else if (drag.type === 'box') {
    drag.cur = gp;
    boxSelect(drag); // live, like Figma: everything the box touches is selected as you drag
  } else if (drag.type === 'rect') {
    drag.x1 = Math.floor(gp.x); drag.y1 = Math.floor(gp.y);
  } else if (drag.type === 'door') {
    const ed = drag.ed;
    const along = ed.orient === 'h' ? gp.x - ed.x : gp.y - ed.y;
    if (Math.abs(along) > 0.6) drag.moved = true;
    if (drag.moved) drag.len = Math.max(1, Math.min(40, Math.ceil(along)));
  } else if (drag.type === 'erase' && e.buttons & 1) {
    const el = pickAt(gp.x, gp.y, { includeLocked: false });
    if (el) change('Delete ' + elementTitle(el, S.project), () => { map().elements = map().elements.filter((x) => x !== el); });
  }
  request();
}

function onUp(e) {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (d.type === 'pan') {
    updateCursor();
    if (d.button === 2 && !d.moved) emit('context', { x: mouse.gx, y: mouse.gy, sx: e.clientX, sy: e.clientY, el: pickAt(mouse.gx, mouse.gy) });
  } else if (d.type === 'rotate') {
    const n = ((d.steps % 4) + 4) % 4;
    if (n) change(`Rotate ${n * 90}°`, () => { for (let i = 0; i < n; i++) transformSelection(1, false); });
  } else if (d.type === 'move' || d.type === 'resize' || d.type === 'gscale') {
    end();
    emit('selection');
  } else if (d.type === 'box') {
    boxSelect(d);
    emit('selection');
  } else if (d.type === 'rect') {
    finishRect(d);
  } else if (d.type === 'door') {
    const ed = d.ed;
    const door = newDoor(ed.x, ed.y, ed.orient, d.len);
    // replace any door already on these edges
    change('Add door', () => {
      const m = map();
      m.elements = m.elements.filter((x) => !(x.type === 'door' && x.orient === door.orient && overlapsDoor(x, door)));
      m.elements.push(tagArea(door));
    });
    S.selection.clear(); S.selection.add(door.id); emit('selection');
    toolDone();
  }
  request();
}

/** Select everything the box touches (not just things fully inside it). */
function boxSelect(d) {
  const x0 = Math.min(d.start.x, d.cur.x), x1 = Math.max(d.start.x, d.cur.x);
  const y0 = Math.min(d.start.y, d.cur.y), y1 = Math.max(d.start.y, d.cur.y);
  const next = new Set(d.add ? d.base : []);
  if (x1 - x0 > 0.05 || y1 - y0 > 0.05) {
    const hits = (b) => b.x < x1 && b.x + b.w > x0 && b.y < y1 && b.y + b.h > y0;
    for (const el of viewMap().elements) {
      if (!visibleEl(el) || el.lockedEdit) continue;
      const touched = el.rects ? el.rects.some(hits) : hits(elementBounds(el));
      if (touched) next.add(el.id);
    }
  }
  const same = next.size === S.selection.size && [...next].every((id) => S.selection.has(id));
  if (!same) { S.selection = next; request(); } // panels update once, when you let go
}

function overlapsDoor(a, b) {
  if (a.orient === 'h') return a.y === b.y && a.x < b.x + b.len && b.x < a.x + a.len;
  return a.x === b.x && a.y < b.y + b.len && b.y < a.y + a.len;
}

function finishRect(d) {
  const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1);
  const rect = { x, y, w: Math.abs(d.x1 - d.x0) + 1, h: Math.abs(d.y1 - d.y0) + 1 };
  const m = map();
  if (d.mode === 'cut') {
    const cut = rectsToCells([rect]);
    const sel = selected().filter((e) => e.rects);
    const targets = sel.length ? sel : m.elements.filter((e) => e.rects && visibleEl(e) && !e.lockedEdit);
    change('Cut out area', () => {
      for (const t of targets) {
        const cells = rectsToCells(t.rects);
        let hit = false;
        for (const c of cut) if (cells.delete(c)) hit = true;
        if (!hit) continue;
        t.rects = cellsToRects(cells);
      }
      m.elements = m.elements.filter((e) => !e.rects || e.rects.length);
    });
    toolDone();
    return;
  }
  if (d.mode === 'add') {
    const t = selected()[0];
    change('Extend ' + elementTitle(t, S.project), () => {
      const cells = rectsToCells(t.rects);
      for (const c of rectsToCells([rect])) cells.add(c);
      t.rects = cellsToRects(cells);
    });
    toolDone();
    return;
  }
  let el;
  if (d.tool === 'stairs') el = newStairs(rect, rect.h >= rect.w ? 'n' : 'e');
  else {
    el = newRoom(d.tool, rect);
    if (d.tool === 'room') el.name = 'Room ' + (m.elements.filter((e) => e.type === 'room' && e.kind === 'room').length + 1);
  }
  tagArea(el); change('Add ' + elementTitle(el, S.project), () => m.elements.push(el));
  S.selection.clear(); S.selection.add(el.id); emit('selection');
  toolDone();
}

/** A click with the Door tool makes a door about 1 m wide, whatever the grid scale (drag for other widths). */
function defaultDoorLen() { return Math.max(1, Math.round(1 / (S.project.settings.cellSize || 1))); }

/** New things drawn while viewing one area belong to that area. */
function tagArea(el) { if (S.areaFilter != null) el.area = S.areaFilter; return el; }

/** Like Figma: after drawing one thing, go back to the Select tool (unless the tool is locked by double-clicking it). */
function toolDone() {
  if (S.toolLock) return;
  S.tool = 'select';
  emit('tool');
}

function translateFrom(el, o, dx, dy) {
  if (el.rects) el.rects = o.rects.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }));
  else { el.x = o.x + dx; el.y = o.y + dy; }
}

function resizeDrag(d, gp, e) {
  const el = d.el, o = d.orig;
  if (el.type === 'door') {
    if (el.orient === 'h') {
      const gx = Math.round(gp.x);
      if (d.h === 'dl') { const r = o.x + o.len; el.x = Math.min(gx, r - 1); el.len = r - el.x; }
      else { el.len = Math.max(1, gx - o.x); }
    } else {
      const gy = Math.round(gp.y);
      if (d.h === 'dt') { const b = o.y + o.len; el.y = Math.min(gy, b - 1); el.len = b - el.y; }
      else { el.len = Math.max(1, gy - o.y); }
    }
    return;
  }
  const isMarker = el.type === 'marker';
  const b = isMarker ? { x: o.x - o.w / 2, y: o.y - o.h / 2, w: o.w, h: o.h } : { ...o.rects[0] };
  const q = isMarker && !(S.snap && !e.altKey) ? 0.125 : isMarker ? 0.5 : 1;
  const sn = (v) => Math.round(v / q) * q;
  let x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
  if (d.h.includes('w')) x0 = Math.min(sn(gp.x), x1 - q);
  if (d.h.includes('e')) x1 = Math.max(sn(gp.x), x0 + q);
  if (d.h.includes('n')) y0 = Math.min(sn(gp.y), y1 - q);
  if (d.h.includes('s')) y1 = Math.max(sn(gp.y), y0 + q);
  if (isMarker) { el.w = x1 - x0; el.h = y1 - y0; el.x = x0 + el.w / 2; el.y = y0 + el.h / 2; }
  else el.rects = [{ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }];
}

function onWheel(e) {
  e.preventDefault();
  const { sx, sy } = local(e);
  const k = e.deltaMode === 1 ? 30 : 1;
  // Figma: Ctrl/Cmd + scroll (or trackpad pinch) zooms, scroll pans, Shift + scroll pans sideways
  if (e.ctrlKey || e.metaKey) { zoomBy(Math.pow(1.0025, -e.deltaY * k), sx, sy); return; }
  const c = cam();
  if (e.shiftKey) c.ox -= (e.deltaY || e.deltaX) * k;
  else { c.ox -= e.deltaX * k; c.oy -= e.deltaY * k; }
  request();
}

function onDbl(e) {
  const { sx, sy } = local(e);
  const gp = toGrid(sx, sy);
  const el = pickAt(gp.x, gp.y);
  if (!el) return;
  if (el.link?.mapId) { emit('follow-link', el); return; }
  if (el.type === 'label') emit('focus-field', 'text');
  else emit('focus-field', 'name');
}

function miniPan(e) {
  const r = mini.getBoundingClientRect();
  const info = mini._info;
  if (!info) return;
  const gx = info.b.x + (e.clientX - r.left - info.ox) / info.s;
  const gy = info.b.y + (e.clientY - r.top - info.oy) / info.s;
  centerOn(gx, gy);
}

function updateCursor(sx, sy) {
  if (!canvas) return;
  if (spaceDown || S.tool === 'pan') { canvas.style.cursor = 'grab'; return; }
  if (pickMode) { canvas.style.cursor = 'crosshair'; return; }
  if (S.tool === 'select') {
    if (sx !== undefined) {
      const hd = handleAt(sx, sy);
      if (hd?.rot) { canvas.style.cursor = 'grab'; return; }
      if (hd) {
        const id = hd.h.id;
        canvas.style.cursor = id === 'n' || id === 's' || id === 'dt' || id === 'db' ? 'ns-resize' : id === 'e' || id === 'w' || id === 'dl' || id === 'dr' ? 'ew-resize' : id === 'nw' || id === 'se' ? 'nwse-resize' : 'nesw-resize';
        return;
      }
    }
    canvas.style.cursor = hover ? 'move' : 'default';
    return;
  }
  canvas.style.cursor = S.tool === 'erase' ? 'not-allowed' : 'crosshair';
}

// ---- Rendering -----------------------------------------------------------------------
function render() {
  const m = map();
  const T = getTheme(S.project, m);
  const c = cam();
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = T.bg; g.fillRect(0, 0, W, H);

  // reference image
  if (m.bg.asset && m.bg.visible) {
    const img = assetImage(S.project, m.bg.asset, request);
    if (img) {
      g.save(); g.globalAlpha = m.bg.opacity;
      g.imageSmoothingEnabled = true;
      g.drawImage(img, c.ox + m.bg.x * c.cell, c.oy + m.bg.y * c.cell, img.naturalWidth * m.bg.scale * c.cell, img.naturalHeight * m.bg.scale * c.cell);
      g.restore();
    }
  }
  if (S.showGrid) drawGrid(g, { cell: c.cell, ox: c.ox, oy: c.oy, width: W, height: H }, T);

  const b = getBaked();
  const vm = viewMap();
  if (vm !== m) {
    // the rest of the map, faded, so you can see where this area sits
    g.save(); g.globalAlpha = 0.16;
    drawMap(g, m, { cell: c.cell, ox: c.ox, oy: c.oy, theme: T, project: S.project, view: S.view, editor: false, labels: false, noGlow: true });
    g.restore();
  }
  drawMap(g, vm, {
    cell: c.cell, ox: c.ox, oy: c.oy, theme: T, project: S.project, view: S.view, baked: b,
    editor: true, selection: S.selection, onImage: request, grid: false,
  });
  drawDragged(T);

  // Ghosts of things hidden by the current chapter/time filter
  g.save(); g.setLineDash([4, 4]); g.strokeStyle = T.accent; g.globalAlpha = 0.35; g.lineWidth = 1;
  for (const el of m.elements) {
    if (el.hidden || condActive(el.cond, S.view)) continue;
    const bb = elementBounds(el); const p = toScreen(bb.x, bb.y);
    g.strokeRect(p.x, p.y, bb.w * c.cell, bb.h * c.cell);
  }
  g.restore();

  // Player position from walk mode
  if (S.playerPos && S.playerPos.mapId === m.id) {
    const p = toScreen(S.playerPos.x, S.playerPos.y);
    g.save(); g.translate(p.x, p.y); g.rotate(S.playerPos.face || 0);
    g.fillStyle = '#2aa8ff'; g.strokeStyle = '#fff'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, -10); g.lineTo(7, 7); g.lineTo(0, 3); g.lineTo(-7, 7); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }

  // Selection outlines
  g.save();
  g.strokeStyle = T.accent; g.lineWidth = 2;
  for (const el of selected()) {
    if (el.type === 'marker' && el.kind !== 'trigger' && el.kind !== 'prop') continue;
    g.setLineDash([6, 4]);
    if (el.rects) for (const r of el.rects) { const p = toScreen(r.x, r.y); g.strokeRect(p.x + 2, p.y + 2, r.w * c.cell - 4, r.h * c.cell - 4); }
    else if (el.type === 'door') {
      g.setLineDash([]); g.lineWidth = 5; g.globalAlpha = 0.6;
      const a = toScreen(el.x, el.y), bb = el.orient === 'h' ? toScreen(el.x + el.len, el.y) : toScreen(el.x, el.y + el.len);
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(bb.x, bb.y); g.stroke(); g.globalAlpha = 1; g.lineWidth = 2;
    } else { const bb = elementBounds(el); const p = toScreen(bb.x, bb.y); g.strokeRect(p.x - 2, p.y - 2, bb.w * c.cell + 4, bb.h * c.cell + 4); }
  }
  g.setLineDash([]);
  const sel = editableSel();
  const square = (p) => { g.fillStyle = '#fff'; g.strokeStyle = T.accent; g.lineWidth = 2; g.fillRect(p.x - 5, p.y - 5, 10, 10); g.strokeRect(p.x - 5, p.y - 5, 10, 10); };
  if (sel.length && drag?.type !== 'move') {
    const b = drag?.type === 'gscale' && drag.newBox ? drag.newBox : groupBounds(sel);
    const group = useGroupBox(sel);
    if (group) {
      // the selection box: drag a handle to scale everything inside it
      const p = toScreen(b.x, b.y);
      g.strokeStyle = T.accent; g.lineWidth = 1.5; g.setLineDash([]);
      g.strokeRect(p.x, p.y, b.w * c.cell, b.h * c.cell);
      for (const h of boxHandles(b)) square(toScreen(h.x, h.y));
      if (drag?.type === 'gscale') sizeTag(p.x + (b.w * c.cell) / 2, p.y - 10, `${fmt(b.w)} × ${fmt(b.h)}`);
    } else if (sel.length === 1) for (const h of handlesFor(sel[0])) square(toScreen(h.x, h.y));
    // rotate knob above the top edge
    const r = rotHandle(b), top = toScreen(b.x + b.w / 2, b.y);
    g.strokeStyle = T.accent; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(top.x, top.y); g.lineTo(r.sx, r.sy + 7); g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(r.sx, r.sy, 7, 0, Math.PI * 2); g.fill(); g.stroke();
    g.beginPath(); g.arc(r.sx, r.sy, 3.5, -2.5, 1.2); g.stroke();
  }
  if (drag?.type === 'rotate') {
    // preview of where the selection will end up (90° steps)
    const b = drag.b, ang = drag.steps * (Math.PI / 2);
    g.save(); g.translate(drag.cx, drag.cy); g.rotate(ang);
    g.setLineDash([6, 4]); g.strokeStyle = '#2aa8ff'; g.lineWidth = 2;
    g.strokeRect((-b.w * c.cell) / 2, (-b.h * c.cell) / 2, b.w * c.cell, b.h * c.cell);
    g.restore();
    g.save(); g.strokeStyle = 'rgba(42,168,255,.5)'; g.setLineDash([2, 4]);
    g.beginPath(); g.moveTo(drag.cx, drag.cy); g.lineTo(drag.cx + Math.cos(drag.a0 + (drag.angle || 0)) * 60, drag.cy + Math.sin(drag.a0 + (drag.angle || 0)) * 60); g.stroke(); g.restore();
    sizeTag(drag.cx, drag.cy - (b.h * c.cell) / 2 - 40, `${((drag.steps % 4) + 4) % 4 * 90}°`);
  }
  g.restore();

  // Hover
  if (hover && !S.selection.has(hover.id) && !drag) {
    g.save(); g.strokeStyle = S.tool === 'erase' ? '#ff3355' : pickMode ? '#2aa8ff' : T.accent; g.globalAlpha = 0.7; g.lineWidth = 2;
    const bb = elementBounds(hover); const p = toScreen(bb.x, bb.y);
    if (hover.rects) for (const r of hover.rects) { const q = toScreen(r.x, r.y); g.strokeRect(q.x, q.y, r.w * c.cell, r.h * c.cell); }
    else g.strokeRect(p.x - 2, p.y - 2, bb.w * c.cell + 4, bb.h * c.cell + 4);
    g.restore();
    tooltip(hover);
  }

  // Tool previews
  if (drag?.type === 'box') {
    const a = toScreen(drag.start.x, drag.start.y), bb = toScreen(drag.cur.x, drag.cur.y);
    g.save(); g.fillStyle = 'rgba(42,168,255,.12)'; g.strokeStyle = '#2aa8ff'; g.setLineDash([4, 3]);
    g.fillRect(a.x, a.y, bb.x - a.x, bb.y - a.y); g.strokeRect(a.x, a.y, bb.x - a.x, bb.y - a.y); g.restore();
  }
  if (drag?.type === 'rect') {
    const x = Math.min(drag.x0, drag.x1), y = Math.min(drag.y0, drag.y1);
    const w = Math.abs(drag.x1 - drag.x0) + 1, h = Math.abs(drag.y1 - drag.y0) + 1;
    const p = toScreen(x, y);
    g.save();
    g.fillStyle = drag.mode === 'cut' ? 'rgba(255,40,80,.25)' : 'rgba(42,168,255,.22)';
    g.strokeStyle = drag.mode === 'cut' ? '#ff2850' : '#2aa8ff'; g.lineWidth = 2;
    g.fillRect(p.x, p.y, w * c.cell, h * c.cell); g.strokeRect(p.x, p.y, w * c.cell, h * c.cell);
    sizeTag(p.x + (w * c.cell) / 2, p.y - 10, `${w} × ${h}  (${fmt(w * S.project.settings.cellSize)} × ${fmt(h * S.project.settings.cellSize)} m)`);
    g.restore();
  }
  if (drag?.type === 'resize' && drag.el.rects) {
    const r = drag.el.rects[0]; const p = toScreen(r.x, r.y);
    sizeTag(p.x + (r.w * c.cell) / 2, p.y - 10, `${r.w} × ${r.h}  (${fmt(r.w * S.project.settings.cellSize)} × ${fmt(r.h * S.project.settings.cellSize)} m)`);
  }
  if (S.tool === 'door' && mouse.inside) {
    const ed = drag?.type === 'door' ? drag.ed : nearestEdge(mouse.gx, mouse.gy);
    const len = drag?.type === 'door' ? drag.len : defaultDoorLen();
    const a = toScreen(ed.x, ed.y), bb = ed.orient === 'h' ? toScreen(ed.x + len, ed.y) : toScreen(ed.x, ed.y + len);
    g.save(); g.strokeStyle = '#2aa8ff'; g.lineWidth = 6; g.globalAlpha = 0.8; g.lineCap = 'round';
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(bb.x, bb.y); g.stroke(); g.restore();
  }
  if ((ROOM_TOOLS[S.tool] || S.tool === 'stairs') && mouse.inside && !drag) {
    const p = toScreen(Math.floor(mouse.gx), Math.floor(mouse.gy));
    g.save(); g.strokeStyle = '#2aa8ff'; g.globalAlpha = 0.6; g.strokeRect(p.x, p.y, c.cell, c.cell); g.restore();
  }
  if (S.tool === 'marker' && mouse.inside && !drag) {
    const p = toScreen(snapHalf(mouse.gx), snapHalf(mouse.gy));
    g.save(); g.fillStyle = '#2aa8ff'; g.globalAlpha = 0.5; g.beginPath(); g.arc(p.x, p.y, Math.max(5, c.cell * 0.3), 0, Math.PI * 2); g.fill(); g.restore();
  }
  if (pickMode) {
    g.save(); g.fillStyle = 'rgba(42,168,255,.9)'; g.fillRect(0, 0, W, 30);
    g.fillStyle = '#fff'; g.font = '14px system-ui'; g.textBaseline = 'middle';
    g.fillText('🔗 ' + pickMode.label + '  (Esc to cancel)', 12, 15); g.restore();
  }
  renderMini(m, T, b);
}

function tooltip(el) {
  const text = elementTitle(el, S.project) + (el.link?.mapId ? '  →  ' + (S.project.maps.find((m) => m.id === el.link.mapId)?.name ?? '?') + ' (double-click to go)' : '');
  g.save(); g.font = '12px system-ui';
  const w = g.measureText(text).width + 12;
  let x = mouse.sx + 14, y = mouse.sy + 18;
  if (x + w > W) x = W - w - 4;
  g.fillStyle = 'rgba(20,10,14,.88)'; g.fillRect(x, y, w, 20);
  g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(text, x + 6, y + 10);
  g.restore();
}
function sizeTag(x, y, text) {
  g.save(); g.font = 'bold 12px system-ui';
  const w = g.measureText(text).width + 10;
  g.fillStyle = '#2aa8ff'; g.fillRect(x - w / 2, y - 10, w, 18);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, x, y - 1);
  g.restore();
}
const fmt = (n) => (Math.round(n * 10) / 10).toString();

// The minimap's map is drawn once per change; each frame only the blue view box moves.
let miniCache = null;
function renderMini(m, T, b) {
  const mw = 180, mh = 120;
  if (!miniCache || miniCache.b !== b || miniCache.T !== T || miniCache.dpr !== dpr) {
    const c = document.createElement('canvas');
    c.width = Math.round(mw * dpr); c.height = Math.round(mh * dpr);
    const cg = c.getContext('2d');
    cg.setTransform(dpr, 0, 0, dpr, 0, 0);
    cg.fillStyle = T.bg; cg.globalAlpha = 0.92; cg.fillRect(0, 0, mw, mh); cg.globalAlpha = 1;
    const bb = mapBounds(m);
    const s = Math.min((mw - 12) / bb.w, (mh - 12) / bb.h);
    const ox = (mw - bb.w * s) / 2, oy = (mh - bb.h * s) / 2;
    drawMap(cg, m, { cell: s, ox: ox - bb.x * s, oy: oy - bb.y * s, theme: T, project: S.project, view: S.view, baked: b, editor: false, labels: false, icons: false, noGlow: true });
    miniCache = { b, T, dpr, canvas: c, info: { b: bb, s, ox, oy } };
  }
  mg.setTransform(1, 0, 0, 1, 0, 0);
  mg.clearRect(0, 0, mini.width, mini.height);
  mg.drawImage(miniCache.canvas, 0, 0);
  mg.setTransform(dpr, 0, 0, dpr, 0, 0);
  mini._info = miniCache.info;
  const { b: bb, s, ox, oy } = miniCache.info;
  const c = cam();
  const vx = (-c.ox / c.cell - bb.x) * s + ox, vy = (-c.oy / c.cell - bb.y) * s + oy;
  mg.strokeStyle = '#2aa8ff'; mg.lineWidth = 1.5;
  mg.strokeRect(vx, vy, (W / c.cell) * s, (H / c.cell) * s);
}

// ---- Operations used by menus / keyboard ------------------------------------------------
/**
 * Connect tool: click the "from" thing (door, stairs, exit — or empty floor / a room, which makes an exit there),
 * then click the "to" thing on any map or area. Both get linked to each other.
 */
function startConnect(gp) {
  const makeExit = (pt, name) => {
    const p = newMarker('portal', snapHalf(pt.x), snapHalf(pt.y));
    p.name = name;
    tagArea(p);
    change('Add exit', () => map().elements.push(p));
    return p;
  };
  let src = pickAt(gp.x, gp.y);
  if (!src || !('link' in src)) src = makeExit(gp, src?.type === 'room' ? 'Exit from ' + elementTitle(src, S.project) : 'Exit');
  const fromMap = S.mapId, srcId = src.id;
  S.selection = new Set([srcId]); emit('selection');
  startPick(`Now click where “${elementTitle(src, S.project)}” leads. Switch map or area on the left if it’s somewhere else. Empty floor = new arrival spot.`, (target, tmap, pt) => {
    let t = target;
    if (t && t.id === srcId) { emit('toast', { text: 'Pick a different place to connect to', kind: 'error' }); return; }
    if (!t || !('link' in t)) t = makeExit(pt, 'From ' + (S.project.maps.find((m) => m.id === fromMap)?.name ?? 'another map'));
    const tid = t.id, tmapId = tmap.id;
    change('Connect', () => {
      const s = findElement(S.project, srcId)?.el, tt = findElement(S.project, tid)?.el;
      if (!s || !tt) return;
      s.link = { mapId: tmapId, targetId: tid };
      tt.link = { mapId: fromMap, targetId: srcId };
    });
    emit('toast', { text: `🔗 Connected: ${elementTitle(findElement(S.project, srcId).el, S.project)} ⇄ ${tmap.name} › ${elementTitle(findElement(S.project, tid).el, S.project)}` });
    if (S.tool === 'connect') toolDone();
    if (tmapId !== fromMap) emit('goto', { mapId: fromMap, elId: srcId });
  }, { allowEmpty: true });
}

export function startPick(label, onPick, opts = {}) {
  pickMode = { label, onPick, ...opts };
  emit('pickmode', pickMode);
  request();
}
export function cancelPick() {
  if (!pickMode) return false;
  pickMode = null; emit('pickmode', null); request();
  return true;
}
export function isPicking() { return !!pickMode; }

export function cloneElements(els, dx, dy) {
  const idMap = new Map();
  const out = els.map((e) => {
    const c = JSON.parse(JSON.stringify(e));
    c.id = uid(e.type === 'marker' ? e.kind : e.type);
    idMap.set(e.id, c.id);
    if (c.rects) c.rects = c.rects.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }));
    else { c.x += dx; c.y += dy; }
    return c;
  });
  return out;
}

function groupBounds(els) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of els) { const b = elementBounds(e); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
const isStructural = (els) => els.some((e) => e.type !== 'marker' && e.type !== 'label');

// Smart duplicate (like Figma): Ctrl+D puts the copy right next to the original. Move that copy and press Ctrl+D
// again, and the next copy repeats the same step — handy for rows of dorm rooms.
let lastDup = null;
export function duplicateSelection(dx, dy, inPlace = false) {
  const els = selected();
  if (!els.length) return;
  if (inPlace) {
    const copies = cloneElements(els, 0, 0);
    map().elements.push(...copies);
    S.selection = new Set(copies.map((c) => c.id));
    emit('selection');
    return;
  }
  const ids = els.map((e) => e.id);
  if (dx === undefined) {
    if (lastDup && lastDup.mapId === S.mapId && ids.length === lastDup.copyIds.length && ids.every((id) => lastDup.copyIds.includes(id))) {
      const src = map().elements.filter((e) => lastDup.srcIds.includes(e.id));
      if (src.length) { const a = groupBounds(src), b = groupBounds(els); dx = b.x - a.x; dy = b.y - a.y; }
    }
    if (dx === undefined || (dx === 0 && dy === 0)) {
      const b = groupBounds(els);
      dx = isStructural(els) ? Math.max(1, Math.round(b.w)) : 1; dy = 0;
    }
  }
  const copies = cloneElements(els, dx, dy);
  for (const c of copies) if (c.link) c.link = { mapId: '', targetId: '' };
  change(`Duplicate ${els.length} item${els.length > 1 ? 's' : ''}`, () => map().elements.push(...copies));
  lastDup = { mapId: S.mapId, srcIds: ids, copyIds: copies.map((c) => c.id) };
  S.selection = new Set(copies.map((c) => c.id));
  emit('selection');
}

/** Copy (or cut) the selection. Returns the clipboard text so the copy event can put it on the system clipboard. */
export function copySelection(cut = false, viaEvent = false) {
  const els = selected();
  if (!els.length) return null;
  const b = groupBounds(els);
  const data = { kind: 'tvf-map-clip', mapId: S.mapId, bounds: b, elements: JSON.parse(JSON.stringify(els)) };
  S.clipboard = data;
  const text = JSON.stringify(data);
  if (!viaEvent) { try { navigator.clipboard?.writeText(text)?.catch?.(() => {}); } catch { /* ignore */ } }
  if (cut) change('Cut', () => { map().elements = map().elements.filter((e) => !S.selection.has(e.id)); S.selection.clear(); });
  emit('selection');
  emit('toast', { text: `${cut ? 'Cut' : 'Copied'} ${els.length} item${els.length > 1 ? 's' : ''}` });
  return text;
}

/**
 * Paste. inPlace (Ctrl+Shift+V) = exactly where it was copied from.
 * Otherwise it lands centred on the mouse (or the middle of the view if the mouse is elsewhere).
 */
export function pasteData(data, inPlace = false) {
  if (!data?.elements?.length) return;
  const b = data.bounds ?? groupBounds(data.elements);
  let dx = 0, dy = 0;
  if (!inPlace) {
    const c = cam();
    const target = mouse.inside ? { x: mouse.gx, y: mouse.gy } : { x: (W / 2 - c.ox) / c.cell, y: (H / 2 - c.oy) / c.cell };
    dx = target.x - (b.x + b.w / 2); dy = target.y - (b.y + b.h / 2);
    const q = isStructural(data.elements) ? 1 : 0.5;
    dx = Math.round(dx / q) * q; dy = Math.round(dy / q) * q;
  }
  const copies = cloneElements(data.elements, dx, dy);
  for (const c of copies) { if (c.link) c.link = { mapId: '', targetId: '' }; if (S.areaFilter != null) c.area = S.areaFilter; }
  change(`Paste ${copies.length} item${copies.length > 1 ? 's' : ''}`, () => map().elements.push(...copies));
  S.selection = new Set(copies.map((c) => c.id));
  emit('selection');
}

/** Paste from the menu (no paste event): try the system clipboard, else the internal one. */
export async function pasteClipboard(inPlace = false) {
  let data = S.clipboard;
  try {
    const t = await navigator.clipboard?.readText?.();
    if (t && t.includes('tvf-map-clip')) data = JSON.parse(t);
  } catch { /* Firefox doesn't allow reading the clipboard here; use our own copy */ }
  pasteData(data, inPlace);
}

/** Figma's Ctrl+Alt+C / Ctrl+Alt+V: copy the look of one thing and paste it onto others. */
const LOOK_KEYS = ['color', 'floorColor', 'wallColor', 'icon', 'asset', 'lighting', 'wallHeight', 'ceiling', 'showLabel', 'showIcon', 'open', 'style', 'size', 'height', 'lightColor', 'intensity', 'range'];
let lookClip = null;
export function copyLook() {
  const el = selected()[0];
  if (!el) return;
  lookClip = { type: el.type, props: Object.fromEntries(LOOK_KEYS.filter((k) => k in el).map((k) => [k, el[k]])) };
  emit('toast', { text: 'Copied the look of ' + elementTitle(el, S.project) });
}
export function pasteLook() {
  if (!lookClip) return emit('toast', { text: 'Copy a look first (Ctrl+Alt+C)' });
  const els = selected().filter((e) => e.type === lookClip.type);
  if (!els.length) return emit('toast', { text: 'Select something of the same kind to paste the look onto' });
  change('Paste look', () => { for (const e of els) for (const [k, v] of Object.entries(lookClip.props)) if (k in e) e[k] = v; });
}

export function arrange(dir) {
  const ids = new Set(selected().map((e) => e.id));
  if (!ids.size) return;
  // Layers: each thing has a layer number "z" (0 = normal). Corridors sit under rooms on the same layer.
  //  ] / [        move one layer up / down
  //  Ctrl+Shift+] / [  go above / below everything
  const labels = { 1: 'Move up a layer', '-1': 'Move down a layer', 2: 'Bring to front', '-2': 'Send to back' };
  change(labels[dir], () => {
    const m = map();
    const sel = m.elements.filter((e) => ids.has(e.id));
    const others = m.elements.filter((e) => !ids.has(e.id));
    const zs = others.map((e) => e.z || 0);
    for (const e of sel) {
      if (dir === 2) e.z = Math.max(0, ...zs) + 1;
      else if (dir === -2) e.z = Math.min(0, ...zs) - 1;
      else e.z = (e.z || 0) + dir;
      if (e.z === 0) delete e.z;
    }
    // keep drawing order matching for things on the same layer
    m.elements = dir > 0 ? [...others, ...sel] : [...sel, ...others];
  });
  const z = selected()[0]?.z || 0;
  emit('toast', { text: `${labels[dir]} — layer ${z}${z === 0 ? ' (normal)' : ''}` });
}

export function zoomActual() {
  const c = cam();
  const cx = (W / 2 - c.ox) / c.cell, cy = (H / 2 - c.oy) / c.cell;
  c.cell = 28; c.ox = W / 2 - cx * 28; c.oy = H / 2 - cy * 28;
  request(); emit('zoom', 28);
}

export function nudge(dx, dy) {
  const els = selected().filter((e) => !e.lockedEdit);
  if (!els.length) return;
  change('Nudge', () => {
    const structural = els.some((e) => e.type !== 'marker' && e.type !== 'label');
    const q = structural ? 1 : 0.5;
    for (const e of els) translateFrom(e, JSON.parse(JSON.stringify(e)), dx * q, dy * q);
  });
}

/** Rotate (dir=1 clockwise, -1 anticlockwise) or flip ('h'/'v') the selection around its centre. */
export function transformSelection(op, withUndo = true) {
  const els = selected().filter((e) => !e.lockedEdit);
  if (!els.length) return;
  const change = withUndo ? changeUndo : (_label, fn) => fn();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of els) { const b = e.type === 'door' ? (e.orient === 'h' ? { x: e.x, y: e.y, w: e.len, h: 0 } : { x: e.x, y: e.y, w: 0, h: e.len }) : elementBounds(e); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  let cx = Math.round(x0 + x1) / 2, cy = Math.round(y0 + y1) / 2;
  if (op === 1 || op === -1) { if (!Number.isInteger(cx + cy)) cx = Math.floor(cx); }
  const rot = (x, y) => (op === 1 ? [cx - (y - cy), cy + (x - cx)] : [cx + (y - cy), cy - (x - cx)]);
  const dirs = ['n', 'e', 's', 'w'];
  change(op === 'h' ? 'Flip horizontally' : op === 'v' ? 'Flip vertically' : 'Rotate', () => {
    for (const e of els) {
      if (op === 'h' || op === 'v') {
        const fx = op === 'h';
        if (e.rects) e.rects = e.rects.map((r) => (fx ? { ...r, x: 2 * cx - r.x - r.w } : { ...r, y: 2 * cy - r.y - r.h }));
        else if (e.type === 'door') {
          if (fx) e.x = e.orient === 'h' ? 2 * cx - e.x - e.len : 2 * cx - e.x;
          else e.y = e.orient === 'v' ? 2 * cy - e.y - e.len : 2 * cy - e.y;
        } else { if (fx) e.x = 2 * cx - e.x; else e.y = 2 * cy - e.y; if ('rot' in e) e.rot = fx ? -e.rot : 180 - e.rot; }
        if (e.type === 'stairs') e.dir = fx ? { e: 'w', w: 'e' }[e.dir] ?? e.dir : { n: 's', s: 'n' }[e.dir] ?? e.dir;
        continue;
      }
      if (e.rects) {
        e.rects = e.rects.map((r) => {
          const [ax, ay] = rot(r.x, r.y), [bx, by] = rot(r.x + r.w, r.y + r.h);
          return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
        });
        if (e.type === 'stairs') e.dir = dirs[(dirs.indexOf(e.dir) + (op === 1 ? 1 : 3)) % 4];
      } else if (e.type === 'door') {
        const [ax, ay] = rot(e.x, e.y);
        const [bx, by] = e.orient === 'h' ? rot(e.x + e.len, e.y) : rot(e.x, e.y + e.len);
        e.orient = e.orient === 'h' ? 'v' : 'h';
        e.x = Math.min(ax, bx); e.y = Math.min(ay, by);
      } else {
        const [nx, ny] = rot(e.x, e.y); e.x = nx; e.y = ny;
        if ('rot' in e) e.rot = ((e.rot || 0) + (op === 1 ? 90 : -90) + 360) % 360;
        if (e.kind === 'trigger' || e.kind === 'prop') { const t = e.w; e.w = e.h; e.h = t; }
      }
    }
  });
}

export function deleteSelection() {
  const els = selected().filter((e) => !e.lockedEdit);
  if (!els.length) return;
  change(`Delete ${els.length === 1 ? elementTitle(els[0], S.project) : els.length + ' items'}`, () => {
    const ids = new Set(els.map((e) => e.id));
    map().elements = map().elements.filter((e) => !ids.has(e.id));
  });
  S.selection.clear(); emit('selection');
}

export function canvasEl() { return canvas; }
export function screenToGrid(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return toGrid(clientX - r.left, clientY - r.top);
}
