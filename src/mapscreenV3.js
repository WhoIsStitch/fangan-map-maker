// V3-style map screen: tilted isometric floor, PLACE / STUDENT list with [JMP] points, floor stack, crosshair + GO!.
import { S, emit, scheduleAutosave } from './store.js';
import { h } from './dom.js';
import { renderMapImage } from './render2d.js';
import { THEMES, getTheme } from './themes.js';
import { bakeMap, cellAt } from './bake.js';
import { condActive, roomCenter, elementTitle, cellsToRects } from './model.js';
import { isoCanvas, isoBuild, isoCamera, isoRender, isoProject, isoUnproject } from './iso3d.js';
import { assetImage } from './icons.js';

const P = 32;              // pixels per grid cell in the flat render
const MARGIN = 2;
const SQ = 0.56;           // vertical squash of the tilt
const C = Math.SQRT1_2;
const THICK = 9;           // fake floor thickness, px

// Colour helpers
export function toRgb(c) {
  if (!c) return [255, 45, 138];
  if (c.startsWith('#')) { let x = c.slice(1); if (x.length === 3) x = [...x].map((ch) => ch + ch).join(''); const n = parseInt(x.slice(0, 6), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  const m = /rgba?\(([^)]+)\)/.exec(c); if (m) return m[1].split(',').slice(0, 3).map((v) => +v);
  return [255, 45, 138];
}
export const rgbaOf = (c, a) => { const [r, g, b] = toRgb(c); return `rgba(${r},${g},${b},${a})`; };
export function mixHex(a, b, t) { const x = toRgb(a), y = toRgb(b); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join(''); }

// The V3 look, coloured by the project's (or this map's) style: the accent becomes the pink/red,
// the style's hallway / room / line colours are used for the floor.
let A = '#ff2d8a';
let T = THEMES.v3;
export function v3Theme(base) {
  const acc = base.accent || '#ff2d8a';
  return {
    ...THEMES.v3, bg: 'transparent', hall: base.hall, room: base.room, roomAlt: base.room, line: base.line, inner: '',
    glow: rgbaOf(base.line, 0.55), glowSize: 3, icon: base.icon, iconLight: base.iconLight || 'rgba(255,255,255,.35)',
    hatch: base.hatch || acc, hatchBg: base.hatchBg || mixHex(acc, '#000000', 0.75), doorMark: acc, stairs: mixHex(acc, '#000000', 0.2), stairsLine: '#ffffff',
    text: base.text, accent: acc, font: base.font,
  };
}

const st = {
  host: null, mapId: null, tab: 'place', sel: 0, k: 1, fu: 0, fv: 0, tu: 0, tv: 0, follow: true, raf: 0,
  img: null, bounds: null, proj: null, projKey: '', items: [], students: [], cv: null, bg: null, bgKey: '',
  go: null, list: null, floorCv: null, floorPaths: [], drag: null, W: 0, H: 0, dpr: 1, keysBound: false,
};

export function floorLong(m) {
  const n = (m.name || '').trim();
  let r = /^(\d+)\s*F$/i.exec(n);
  if (r) { const v = +r[1]; const suf = v % 100 >= 11 && v % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][v % 10] || 'th'; return `${v}${suf} Floor`; }
  r = /^B\s*(\d*)\s*F?$/i.exec(n);
  if (r) return r[1] && +r[1] > 1 ? 'Basement ' + r[1] : 'Basement';
  return n;
}

const vis = (e) => !e.hidden && condActive(e.cond, S.view);
const curMap = () => S.project.maps.find((m) => m.id === st.mapId) ?? S.project.maps[0];
const floorsOf = (m) => S.project.maps.filter((x) => (x.building || '') === (m.building || '')).sort((a, b) => (a.floor ?? 0) - (b.floor ?? 0));

// ---------------------------------------------------------------------------------------------
export function renderV3(host, mapId) {
  st.host = host;
  if (mapId && mapId !== st.mapId) { st.mapId = mapId; st.sel = 0; hideCursor(); }
  if (!st.mapId || !S.project.maps.find((m) => m.id === st.mapId)) st.mapId = S.mapId;
  const m = curMap();
  bindKeys();
  T = v3Theme(getTheme(S.project, m));
  A = T.accent;

  // list items
  const jumps = m.elements.filter((e) => e.type === 'marker' && e.kind === 'jump' && vis(e))
    .map((e) => ({ kind: 'jump', label: '[JMP] ' + (e.name || 'Jump point'), x: e.x, y: e.y, el: e, mapId: m.id }));
  const rooms = m.elements.filter((e) => e.type === 'room' && e.kind === 'room' && e.name && vis(e))
    .map((e) => { const c = roomCenter(e); return { kind: 'room', label: e.name, x: c.x, y: c.y, el: e, mapId: m.id }; });
  st.students = [];
  for (const mp of S.project.maps) {
    const baked = bakeMap(mp, S.view);
    for (const e of mp.elements) {
      if (e.type !== 'marker' || e.kind !== 'npc' || !vis(e)) continue;
      const ch = S.project.characters.find((c) => c.id === e.characterId);
      if (!ch) continue;
      st.students.push({ kind: 'student', label: ch.name, ch, x: e.x, y: e.y, el: e, mapId: mp.id, room: cellAt(baked, e.x, e.y)?.el });
    }
  }
  st.items = st.tab === 'place' ? [...jumps, ...rooms] : st.students;
  st.sel = Math.max(0, Math.min(st.sel, st.items.length - 1));

  // flat render of the floor, then tilted in draw()
  const r = renderMapImage(m, S.project, T, { pxPerCell: P, margin: MARGIN, view: S.view, transparent: true, labels: false, icons: true, onImage: () => { st.projKey = ''; renderV3(host); } });
  st.img = r.canvas; st.bounds = r.bounds; st.projKey = ''; st.forceDraw = true;
  isoBuild(m, S.project, S.view, st.img, st.bounds, MARGIN, P, T);
  // floor pieces (merged rectangles) for drawing the 3D thickness as shapes
  {
    const bk = bakeMap(m, S.view);
    st.floorRects = [];
    for (const [, cells] of bk.owned) st.floorRects.push(...cellsToRects(cells));
  }

  // DOM
  const floors = floorsOf(m);
  const fi = floors.indexOf(m);
  st.cv = h('canvas', { class: 'v3-cv' });
  st.ov = h('canvas', { class: 'v3-cv v3-ov' }); // cursor layer (animated on its own)
  st.top = h('canvas', { class: 'v3-cv v3-top' }); // characters and pins, above the 3D floor
  st.ovDirty = true;
  st.go = h('button', { class: 'v3-go', title: 'Walk there (Enter)', onclick: go }, h('span', { class: 'v3-x' }, '↵'), h('b', null, 'GO!'), playerHead());
  st.list = h('div', { class: 'v3-list' }, st.items.length ? st.items.map((it, i) => row(it, i)) : h('div', { class: 'v3-empty' }, st.tab === 'place' ? 'No places on this floor yet. Name some rooms or add Fast-travel points.' : 'No characters placed for this chapter / time.'));
  st.floorCv = h('canvas', { class: 'v3-floor' });
  st.alt = S.project.settings.mapScreenStyle === 'v3alt';
  if (st.alt) {
    // Same tilted 3D map, different menu around it
    st.floorCv = null;
    const areaName = m.isArea || floorLong(m) === m.name ? m.name : (m.building || m.name);
    if (st.tab === 'student') st.list = portraitGrid();
    host.replaceChildren(h('div', { class: 'v3 v3alt', style: { '--v3a': A, '--v3d': mixHex(A, '#000000', 0.85), '--v3l': mixHex(A, '#ffffff', 0.35) } },
      st.cv, isoCanvas(), st.top, st.ov,
      h('div', { class: 'va-head' },
        h('div', { class: 'va-map' }, 'MAP'),
        h('div', { class: 'va-area' },
          h('button', { class: 'va-arrow', title: 'Previous (Q)', disabled: fi <= 0, onclick: () => stepFloor(-1) }, h('span', { class: 'va-key' }, 'Q'), '‹'),
          h('div', { class: 'va-name' }, areaName),
          h('button', { class: 'va-arrow', title: 'Next (E)', disabled: fi >= floors.length - 1, onclick: () => stepFloor(1) }, '›', h('span', { class: 'va-key' }, 'E'))),
        h('div', { class: 'va-sub' }, floorWords(m))),
      h('div', { class: 'va-panel' },
        h('div', { class: 'va-tabs' },
          h('div', { class: st.tab === 'place' ? 'on' : '', onclick: () => setTab('place') }, 'PLACE'),
          h('div', { class: st.tab === 'student' ? 'on' : '', onclick: () => setTab('student') }, 'STUDENT')),
        st.list),
      st.go,
      h('div', { class: 'va-prompts' }, h('span', null, 'CHANGE TAB ', h('kbd', null, 'Tab')), h('span', null, 'RETURN ', h('kbd', null, 'ESC'))),
      h('div', { class: 'v3-style' },
        h('span', null, S.view.chapter >= 0 ? S.project.chapters[S.view.chapter] : 'All chapters', ' · ', S.view.time >= 0 ? S.project.times[S.view.time] : 'any time'),
        h('button', { class: 'mini', onclick: () => setStyle('v3') }, 'V3 style'),
        h('button', { class: 'mini', onclick: () => setStyle('classic') }, 'Classic style')),
    ));
    wireCanvas();
    requestAnimationFrame(() => {
      sizeCanvas();
      if (st.fittedFor !== m.id) { st.fittedFor = m.id; const span = (st.img.width + st.img.height) * C; st.k = st.kt = Math.max(0.08, Math.min(1.6, (st.W * 1.0) / span)); }
      target(true);
      if (!st.raf) st.raf = requestAnimationFrame(frame);
    });
    return;
  }
  host.replaceChildren(h('div', { class: 'v3', style: { '--v3a': A, '--v3d': mixHex(A, '#000000', 0.85) } },
    st.cv, isoCanvas(), st.top, st.ov,
    h('div', { class: 'v3-mapbar' }, h('span', null, 'MAP')),
    h('div', { class: 'v3-title' },
      h('button', { class: 'v3-sh', title: 'Previous floor (Q)', disabled: fi <= 0, onclick: () => stepFloor(-1) }, 'Q'),
      h('div', { class: 'v3-t' }, (m.building ? m.building + ' - ' : '') + (floorLong(m) === m.name && m.floor != null ? floorLong({ name: floorShort(m) }) + ' - ' + m.name : floorLong(m))),
      h('button', { class: 'v3-sh', title: 'Next floor (E)', disabled: fi >= floors.length - 1, onclick: () => stepFloor(1) }, 'E')),
    h('div', { class: 'v3-panel' },
      h('div', { class: 'v3-tabs' },
        h('div', { class: st.tab === 'place' ? 'on' : '', onclick: () => setTab('place') }, 'PLACE'),
        h('div', { class: st.tab === 'student' ? 'on' : '', onclick: () => setTab('student') }, 'STUDENT')),
      st.list,
      h('div', { class: 'v3-floorhead' }, 'FLOOR'),
      st.floorCv),
    st.go,
    h('div', { class: 'v3-prompts' }, h('span', null, h('kbd', null, 'Tab'), ' Change tab'), h('span', null, h('kbd', null, 'Esc'), ' Return')),
    h('div', { class: 'v3-style' },
      h('span', null, S.view.chapter >= 0 ? S.project.chapters[S.view.chapter] : 'All chapters', ' · ', S.view.time >= 0 ? S.project.times[S.view.time] : 'any time'),
      h('button', { class: 'mini', onclick: () => setStyle('v3alt') }, 'Alt menu'),
      h('button', { class: 'mini', onclick: () => setStyle('classic') }, 'Classic style')),
  ));
  wireCanvas();
  requestAnimationFrame(() => {
    sizeCanvas();
    if (st.fittedFor !== m.id) {
      // start zoomed so the floor is a bit wider than the view, like the game
      st.fittedFor = m.id;
      const span = (st.img.width + st.img.height) * C;
      st.k = st.kt = Math.max(0.08, Math.min(1.6, (st.W * 1.15) / span));
    }
    drawFloorStack(floors, m);
    target(true);
    if (!st.raf) st.raf = requestAnimationFrame(frame);
  });
}

const ORD = ['Ground', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];
function floorWords(m) {
  const f = m.floor ?? 1;
  if (f < 0) return f === -1 ? 'Basement' : `Basement ${-f}`;
  return (ORD[f] ?? f + 'th') + ' Floor';
}

/** Student tab of the alt menu: a grid of portraits. People placed right now come first and can be picked; others are dimmed. */
function portraitGrid() {
  const tile = (ch, i, placed) => {
    const c = document.createElement('canvas');
    c.width = 72; c.height = 72;
    const g = c.getContext('2d');
    sprite(g, ch, 36, 66, false);
    // sprite() draws ~48px tall; scale up a little for the grid
    const big = document.createElement('canvas'); big.width = 72; big.height = 72;
    const bg = big.getContext('2d'); bg.imageSmoothingEnabled = false;
    bg.drawImage(c, -18, -30, 108, 108);
    return h('div', { class: 'va-tile' + (placed ? '' : ' off') + (placed && st.shown && i === st.sel ? ' on' : ''), title: ch.name + (placed ? '' : ' — not placed in this chapter / time'), onclick: placed ? () => select(i) : null, ondblclick: placed ? go : null }, big);
  };
  const placed = st.items.map((it, i) => tile(it.ch, i, true));
  const rest = S.project.characters.filter((c) => !st.items.some((it) => it.ch.id === c.id)).map((c) => tile(c, -1, false));
  return h('div', { class: 'va-grid' }, placed, rest);
}

function row(it, i) {
  const kids = [];
  if (it.kind === 'student') {
    const img = it.ch.asset && S.project.assets[it.ch.asset] ? `url(${S.project.assets[it.ch.asset].data})` : '';
    kids.push(h('span', { class: 'v3-dot', style: { backgroundColor: it.ch.color, backgroundImage: img } }));
  }
  kids.push(h('span', { class: 'v3-lbl' }, it.label));
  if (it.kind === 'student') {
    const mp = S.project.maps.find((x) => x.id === it.mapId);
    kids.push(h('span', { class: 'v3-sub' }, (mp ? mp.name : '') + (it.room ? ' · ' + elementTitle(it.room, S.project) : '')));
  }
  return h('div', { class: 'v3-it' + (st.shown && i === st.sel ? ' on' : ''), onclick: () => select(i), ondblclick: go }, kids);
}

function playerHead() {
  const ch = S.project.characters[0];
  if (!ch) return null;
  const img = ch.asset && S.project.assets[ch.asset] ? `url(${S.project.assets[ch.asset].data})` : '';
  return h('span', { class: 'v3-head', title: ch.name, style: { backgroundColor: ch.color, backgroundImage: img } }, img ? '' : ch.name.slice(0, 1));
}

function setTab(t) { if (st.tab === t) return; st.tab = t; st.sel = 0; hideCursor(); renderV3(st.host); }
function setStyle(s) { S.project.settings.mapScreenStyle = s; S.dirty = true; scheduleAutosave(); emit('screen-style'); }
function stepFloor(d) {
  const floors = floorsOf(curMap());
  const n = floors[floors.indexOf(curMap()) + d];
  if (n) { st.mapId = n.id; st.sel = 0; hideCursor(); st.tab = st.tab === 'student' ? 'student' : 'place'; renderV3(st.host); }
}

// The cursor (crosshair / beams, diamond, highlight, GO!) only appears once you pick something, and animates in.
function hideCursor() { st.shown = false; }
function showCursor() {
  st.shown = true;
  st.selAt = performance.now();
  if (st.go) { st.go.classList.remove('pop'); void st.go.offsetWidth; st.go.classList.add('pop'); }
}

function select(i) {
  if (!st.items.length) return;
  st.sel = (i + st.items.length) % st.items.length;
  const it = st.items[st.sel];
  showCursor();
  if (it.mapId !== st.mapId) { st.mapId = it.mapId; renderV3(st.host); showCursor(); return; }
  [...st.list.children].forEach((c, j) => c.classList.toggle('on', st.shown && j === st.sel));
  st.list.children[st.sel]?.scrollIntoView({ block: 'nearest' });
  target(false);
}

function target(snap) {
  const it = st.items[st.sel];
  const b = st.bounds;
  let gx, gy;
  if (st.shown && it && it.mapId === st.mapId) { gx = it.x; gy = it.y; } else { gx = b.x + b.w / 2; gy = b.y + b.h / 2; }
  st.tu = (gx - b.x + MARGIN) * P; st.tv = (gy - b.y + MARGIN) * P;
  st.follow = true;
  if (snap) { st.fu = st.tu; st.fv = st.tv; }
}

function go() {
  const it = st.items[st.sel];
  if (!it || !st.shown) return;
  emit('walk-at', { mapId: it.mapId, x: it.x, y: it.y + (it.kind === 'student' ? 0.9 : 0), face: it.kind === 'student' ? 0 : 0 });
}

// ---- keyboard ------------------------------------------------------------------------------
function bindKeys() {
  if (st.keysBound) return;
  st.keysBound = true;
  window.addEventListener('keydown', (e) => {
    if (S.mode !== 'screen' || !String(S.project.settings.mapScreenStyle || 'classic').startsWith('v3')) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') || document.querySelector('.modal-back')) return;
    const k = e.key;
    if (k === 'ArrowDown' || k === 's' || k === 'S') { e.preventDefault(); select(st.shown ? st.sel + 1 : st.sel); }
    else if (k === 'ArrowUp' || k === 'w' || k === 'W') { e.preventDefault(); select(st.shown ? st.sel - 1 : st.sel); }
    else if (k === 'Tab') { e.preventDefault(); setTab(st.tab === 'place' ? 'student' : 'place'); }
    else if (k === 'q' || k === 'Q' || k === 'PageDown') { e.preventDefault(); stepFloor(-1); }
    else if (k === 'e' || k === 'E' || k === 'PageUp') { e.preventDefault(); stepFloor(1); }
    else if (k === 'Enter' || k === ' ') { e.preventDefault(); go(); }
  });
}

// ---- canvas ---------------------------------------------------------------------------------
function sizeCanvas() {
  const r = st.cv.getBoundingClientRect();
  st.dpr = window.devicePixelRatio || 1;
  st.W = r.width; st.H = r.height;
  st.cv.width = Math.round(r.width * st.dpr); st.cv.height = Math.round(r.height * st.dpr);
  if (st.ov) { st.ov.width = st.cv.width; st.ov.height = st.cv.height; }
  if (st.top) { st.top.width = st.cv.width; st.top.height = st.cv.height; }
  st.forceDraw = true;
}

function mat() {
  const k = st.k;
  return { a: k * C, b: k * C * SQ, c: -k * C, d: k * C * SQ };
}
function center() { return { cx: st.W * 0.6, cy: st.H * 0.56 }; }
function offset() {
  const { a, b, c, d } = mat();
  const { cx, cy } = center();
  return { e: cx - (a * st.fu + c * st.fv), f: cy - (b * st.fu + d * st.fv) };
}
/** Point the 3D camera at the current focus / zoom. */
function setCamera() {
  const { cx, cy } = center();
  isoCamera(st.W, st.H, cx, cy, { x: st.fu / P + st.bounds.x - MARGIN, y: st.fv / P + st.bounds.y - MARGIN }, st.k * P);
}
function proj(gx, gy) { return isoProject(gx, gy, st.W, st.H); }
function unproj(X, Y) { return isoUnproject(X, Y, st.W, st.H); }

/** A darkened copy of the flat floor, made once per map (used for the fake thickness). */
function darkImage() {
  if (st.dark && st.darkSrc === st.img) return st.dark;
  const c = document.createElement('canvas');
  c.width = st.img.width; c.height = st.img.height;
  const g = c.getContext('2d');
  g.filter = 'brightness(28%) saturate(140%)';
  g.drawImage(st.img, 0, 0);
  st.dark = c; st.darkSrc = st.img;
  return c;
}

/**
 * The tilted, extruded floor. Built once per zoom level; while the zoom is changing the last build is
 * simply scaled, and a sharp one is rebuilt when the zoom settles.
 */
function projected(allowRebuild) {
  const key = st.dpr + '|' + st.img.width + 'x' + st.img.height;
  // Build at most ~2600px wide (zooming further just scales it), and only rebuild when the zoom changed a lot.
  const w = st.img.width, hh = st.img.height;
  const kMax = 2600 / ((w + hh) * C * st.dpr);
  const kBuild = Math.min(st.k, kMax);
  st.kMax = kMax;
  if (st.proj && st.projKey === key && (!allowRebuild || Math.abs(st.proj.k - kBuild) / kBuild < 0.12)) return st.proj;
  const kSave = st.k; st.k = kBuild;
  const { a, b, c, d } = mat();
  st.k = kSave;
  const xs = [0, a * w, c * hh, a * w + c * hh], ys = [0, b * w, d * hh, b * w + d * hh];
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const dpr = st.dpr;
  const oc = document.createElement('canvas');
  oc.width = Math.ceil((maxX - minX + 20) * dpr); oc.height = Math.ceil((maxY - minY + THICK + 20) * dpr);
  const g = oc.getContext('2d');
  // thickness: the pre-darkened copy stacked downward (no per-layer filters, so it's cheap)
  const dark = darkImage();
  for (let i = THICK; i >= 1; i -= 1.5) {
    g.setTransform(a * dpr, b * dpr, c * dpr, d * dpr, (10 - minX) * dpr, (10 - minY + i) * dpr);
    g.drawImage(dark, 0, 0);
  }
  g.setTransform(a * dpr, b * dpr, c * dpr, d * dpr, (10 - minX) * dpr, (10 - minY) * dpr);
  g.shadowColor = 'rgba(255,255,255,.65)'; g.shadowBlur = 4 * dpr;
  g.drawImage(st.img, 0, 0);
  st.proj = { canvas: oc, minX: minX - 10, minY: minY - 10, k: kBuild };
  st.projKey = key;
  return st.proj;
}

function background() {
  const key = st.W + 'x' + st.H + '|' + st.dpr + '|' + A + '|' + st.alt;
  if (st.bg && st.bgKey === key) return st.bg;
  const W = st.W, H = st.H, dpr = st.dpr;
  const c = document.createElement('canvas');
  c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  if (st.alt) {
    // alt menu background: glowing colour wash, fine grid, a few thin white strokes, dark edges
    const rg2 = g.createRadialGradient(W * 0.6, H * 0.45, 30, W * 0.6, H * 0.45, Math.max(W, H) * 0.85);
    rg2.addColorStop(0, mixHex(A, '#000000', 0.25)); rg2.addColorStop(0.5, mixHex(A, '#000000', 0.55)); rg2.addColorStop(1, mixHex(A, '#000000', 0.88));
    g.fillStyle = rg2; g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,.045)'; g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x < W; x += 22) { g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); }
    for (let y = 0; y < H; y += 22) { g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); }
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,.09)'; g.beginPath();
    for (let x = 0; x < W; x += 110) { g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); }
    for (let y = 0; y < H; y += 110) { g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); }
    g.stroke();
    let seed = 11;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 7; i++) {
      g.strokeStyle = `rgba(255,255,255,${0.06 + rnd() * 0.12})`; g.lineWidth = 0.8 + rnd() * 1.4;
      const x0 = rnd() * W, y0 = rnd() < 0.5 ? -20 : H + 20, x1 = x0 + (rnd() - 0.3) * W * 0.6;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y0 < 0 ? H + 20 : -20); g.stroke();
    }
    const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)');
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
    st.bg = c; st.bgKey = key;
    return c;
  }
  const rg = g.createRadialGradient(W * 0.62, H * 0.5, 40, W * 0.62, H * 0.5, Math.max(W, H) * 0.8);
  rg.addColorStop(0, mixHex(A, '#000000', 0.62)); rg.addColorStop(0.55, mixHex(A, '#000000', 0.8)); rg.addColorStop(1, mixHex(A, '#000000', 0.93));
  g.fillStyle = rg; g.fillRect(0, 0, W, H);
  // triangle floor (seeded so it doesn't flicker)
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  // triangle colours all come from the style: its accent (lighter and darker), room colour, hallway colour and black
  const pal = [rgbaOf(A, .28), rgbaOf(mixHex(A, '#ffffff', 0.35), .16), rgbaOf(T.room, .4), 'rgba(0,0,0,.35)', rgbaOf(A, .18), rgbaOf(mixHex(A, '#000000', 0.6), .35), rgbaOf(T.hall, .1)];
  g.save();
  g.translate(W * 0.5, H * 0.55);
  g.transform(1, 0, -0.35, 0.62, 0, 0);
  const s = 150;
  for (let j = -8; j < 8; j++) for (let i = -9; i < 9; i++) {
    const x = i * s, y = j * s;
    for (const tri of [[[x, y], [x + s, y], [x, y + s]], [[x + s, y], [x + s, y + s], [x, y + s]]]) {
      g.fillStyle = pal[Math.floor(rnd() * pal.length)];
      g.beginPath(); g.moveTo(...tri[0]); g.lineTo(...tri[1]); g.lineTo(...tri[2]); g.closePath(); g.fill();
    }
  }
  g.restore();
  // halftone circle
  g.fillStyle = rgbaOf(A, .12);
  const cx = W * 0.62, cy = H * 0.5, R = Math.min(W, H) * 0.42;
  for (let y = cy - R; y < cy + R; y += 9) for (let x = cx - R; x < cx + R; x += 9) {
    const d = Math.hypot(x - cx, y - cy) / R;
    if (d > 1) continue;
    g.beginPath(); g.arc(x, y, 2.6 * (1 - d * 0.6), 0, Math.PI * 2); g.fill();
  }
  // darken the top for the header bars
  const tg = g.createLinearGradient(0, 0, 0, H * 0.25);
  tg.addColorStop(0, 'rgba(0,0,0,.55)'); tg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = tg; g.fillRect(0, 0, W, H * 0.25);
  st.bg = c; st.bgKey = key;
  return c;
}

function frame() {
  if (S.mode !== 'screen' || !st.cv?.isConnected) { st.raf = 0; return; }
  st.raf = requestAnimationFrame(frame);
  const r = st.cv.getBoundingClientRect();
  if (Math.abs(r.width - st.W) > 1 || Math.abs(r.height - st.H) > 1) sizeCanvas();
  let moving = false;
  if (st.follow) {
    st.fu += (st.tu - st.fu) * 0.16; st.fv += (st.tv - st.fv) * 0.16;
    if (Math.abs(st.tu - st.fu) + Math.abs(st.tv - st.fv) > 0.3) moving = true; else { st.fu = st.tu; st.fv = st.tv; }
  }
  if (st.kt && Math.abs(st.kt - st.k) > 1e-4) { st.k += (st.kt - st.k) * 0.25; moving = true; if (Math.abs(st.kt - st.k) < 1e-3) st.k = st.kt; }
  // the cursor lives on its own light layer, so animating it never redraws the map underneath
  drawCursor();
  // only redraw the map when something changed (keeps the page idle while you read the list)
  const sig = [st.fu.toFixed(2), st.fv.toFixed(2), st.k.toFixed(4), st.sel, st.W, st.H, st.mapId, st.tab, st.proj?.k, st.projKey, st.shown].join('|');
  const settled = !moving && performance.now() - (st.lastZoom || 0) > 160;
  const kWant = Math.min(st.k, st.kMax ?? st.k);
  const needSharp = settled && st.proj && Math.abs(st.proj.k - kWant) / kWant >= 0.12;
  if (sig === st.lastSig && !needSharp && !st.forceDraw) return;
  st.lastSig = sig; st.forceDraw = false;
  draw(needSharp || !st.proj);
}

/** Glowing beams through the screen centre, drawn once per size/colour (blur is slow, so never per frame). */
function beamsImage() {
  const { cx, cy } = center();
  const key = [st.W, st.H, st.dpr, A, cx, cy].join('|');
  if (st.beams && st.beamsKey === key) return st.beams;
  const c = document.createElement('canvas');
  c.width = Math.round(st.W * st.dpr); c.height = Math.round(st.H * st.dpr);
  const g = c.getContext('2d');
  g.scale(st.dpr, st.dpr);
  const L = Math.hypot(st.W, st.H);
  for (const [ang, col] of [[Math.PI * 0.33, mixHex(A, '#ffffff', 0.15)], [-Math.PI * 0.17, mixHex(A, '#ffffff', 0.4)]]) {
    const dx = Math.cos(ang) * L, dy = Math.sin(ang) * L;
    const grad = g.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    grad.addColorStop(0, rgbaOf(col, 0)); grad.addColorStop(0.42, rgbaOf(col, 0.55)); grad.addColorStop(0.5, rgbaOf(col, 0.95)); grad.addColorStop(0.58, rgbaOf(col, 0.55)); grad.addColorStop(1, rgbaOf(col, 0));
    g.save(); g.strokeStyle = grad; g.lineWidth = 3; g.shadowColor = col; g.shadowBlur = 16;
    g.beginPath(); g.moveTo(cx - dx, cy - dy); g.lineTo(cx + dx, cy + dy); g.stroke();
    g.shadowBlur = 0; g.lineWidth = 10; g.globalAlpha = 0.18; g.stroke(); g.restore();
  }
  st.beams = c; st.beamsKey = key;
  return c;
}

/** The selection cursor: room highlight, beams / crosshair, diamond / ring. Animated, on the overlay canvas. */
function drawCursor() {
  const ov = st.ov;
  if (!ov) return;
  const g = ov.getContext('2d');
  const it = st.items[st.sel];
  const on = st.shown && it && it.mapId === st.mapId;
  if (!on) { if (st.ovDirty) { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, ov.width, ov.height); st.ovDirty = false; } return; }
  st.ovDirty = true;
  const dpr = st.dpr;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, ov.width, ov.height);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const { cx, cy } = center();
  const now = performance.now();
  const t = Math.min(1, (now - (st.selAt || 0)) / 350);
  const ease = 1 - Math.pow(1 - t, 3);
  const pulse = 1 + Math.sin(now / 260) * 0.05;

  if (it.kind === 'room') {
    // no blur here (it would be per frame): a double outline gives the glow instead
    g.save(); g.globalAlpha = ease;
    g.fillStyle = rgbaOf(A, .2);
    for (const pass of [[8, rgbaOf(A, 0.25 * pulse)], [3, A]]) {
      g.strokeStyle = pass[1]; g.lineWidth = pass[0];
      for (const r of it.el.rects) {
        const pts = [proj(r.x, r.y), proj(r.x + r.w, r.y), proj(r.x + r.w, r.y + r.h), proj(r.x, r.y + r.h)];
        g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath();
        if (pass[0] === 3) g.fill();
        g.stroke();
      }
    }
    g.restore();
  }

  if (st.alt) {
    // beams sweep out from the chosen place (cached image, scaled from the centre)
    const b = beamsImage();
    const sc = 0.25 + 0.75 * ease;
    g.save(); g.globalAlpha = ease;
    g.translate(cx, cy); g.scale(sc, sc); g.translate(-cx, -cy);
    g.drawImage(b, 0, 0, st.W, st.H);
    g.restore();
    // diamond spins and shrinks into place, then breathes
    const s = (1 + (1 - ease) * 0.9) * pulse;
    g.save(); g.globalAlpha = ease; g.translate(cx, cy - 10); g.rotate(Math.PI / 4 + (1 - ease) * Math.PI); g.scale(s, s);
    g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 4; g.strokeRect(-26, -26, 52, 52);
    g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 1.5; g.strokeRect(-26, -26, 52, 52);
    g.restore();
  } else {
    // crosshair grows out from the chosen place, then a soft pulsing ring
    g.save(); g.strokeStyle = rgbaOf(A, .85 * ease); g.lineWidth = 1.6;
    const lx = st.W * ease, ly = st.H * ease;
    g.beginPath(); g.moveTo(cx - lx, cy); g.lineTo(cx + lx, cy); g.moveTo(cx, cy - ly); g.lineTo(cx, cy + ly); g.stroke();
    g.strokeStyle = rgbaOf(A, 0.6 * ease); g.lineWidth = 2;
    g.beginPath(); g.arc(cx, cy, (18 + (1 - ease) * 40) * pulse, 0, Math.PI * 2); g.stroke();
    g.restore();
  }
}

function draw(sharp) {
  void sharp;
  const dpr = st.dpr;
  const bg = st.cv.getContext('2d');
  bg.setTransform(1, 0, 0, 1, 0, 0);
  bg.drawImage(background(), 0, 0);
  // the floor, walls, doors and stairs in real 3D
  setCamera();
  isoRender(st.W, st.H, dpr);
  // characters and pins on their own layer above it
  const g = st.top.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, st.top.width, st.top.height);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const m = curMap();
  const it = st.items[st.sel];
  const onThisMap = st.shown && it && it.mapId === st.mapId;

  // characters standing on this floor, back to front
  const people = st.students.filter((s) => s.mapId === m.id).map((s) => ({ ...s, p: proj(s.x, s.y) }));
  const pp = S.playerPos && S.playerPos.mapId === m.id ? { ch: S.project.characters[0], p: proj(S.playerPos.x, S.playerPos.y), player: true } : null;
  if (pp?.ch) people.push(pp);
  people.sort((a, b) => a.p.y - b.p.y);
  for (const s of people) sprite(g, s.ch, s.p.x, s.p.y, s.player);

  // fast-travel pins
  for (const [i, j] of st.items.entries()) {
    if (j.kind !== 'jump' || j.mapId !== m.id) continue;
    const p = proj(j.x, j.y);
    pin(g, p.x, p.y, st.shown && i === st.sel && st.tab === 'place');
  }

  // GO! button follows the selection
  if (st.go) {
    if (onThisMap) {
      st.go.style.display = 'flex';
      const p = proj(it.x, it.y);
      st.go.style.left = Math.round(p.x - 125) + 'px';
      st.go.style.top = Math.round(p.y + (it.kind === 'jump' ? 26 : 34)) + 'px';
    } else st.go.style.display = 'none';
  }
}

/**
 * Stairs drawn as stacked 3D steps in the tilted view.
 * Up: steps rise towards the direction you climb. Down: steps sink into the floor (clipped to the stairwell).
 */
function drawStairs3D(g, s) {
  const r = s.rects[0];
  if (!r) return;
  const dir = s.dir || 'n';
  const along = dir === 'n' || dir === 's' ? r.h : r.w; // length in cells
  const n = Math.max(4, Math.min(12, Math.round(along * (S.project.settings.cellSize || 1) / 0.3)));
  const H = 30 * st.k * Math.min(1, along / 4 + 0.4);          // total rise on screen
  const up = s.goes !== 'down';
  const base = T.stairs || A;
  const topCol = mixHex(base, '#ffffff', 0.28), riserCol = base, sideCol = mixHex(base, '#000000', 0.38), edge = rgbaOf(T.line || '#ffffff', 0.55);
  // the cell rectangle of step i (0 = the end you start from)
  const stepRect = (i) => {
    const t0 = i / n, t1 = (i + 1) / n;
    if (dir === 'n') return { x0: r.x, x1: r.x + r.w, y0: r.y + r.h * (1 - t1), y1: r.y + r.h * (1 - t0) };
    if (dir === 's') return { x0: r.x, x1: r.x + r.w, y0: r.y + r.h * t0, y1: r.y + r.h * t1 };
    if (dir === 'e') return { x0: r.x + r.w * t0, x1: r.x + r.w * t1, y0: r.y, y1: r.y + r.h };
    return { x0: r.x + r.w * (1 - t1), x1: r.x + r.w * (1 - t0), y0: r.y, y1: r.y + r.h };
  };
  const lift = (p, hh) => ({ x: p.x, y: p.y - hh });
  const poly = (pts, fill) => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); g.fillStyle = fill; g.fill(); g.strokeStyle = edge; g.lineWidth = 1; g.stroke(); };

  g.save();
  if (!up) {
    // a stairwell going down: clip to the hole in the floor and draw the far walls first
    const hole = [proj(r.x, r.y), proj(r.x + r.w, r.y), proj(r.x + r.w, r.y + r.h), proj(r.x, r.y + r.h)];
    g.beginPath(); hole.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); g.clip();
    g.fillStyle = mixHex(base, '#000000', 0.7); g.fill();
  }
  // each step is a box from the floor (or the bottom of the well) to its tread height
  const boxes = [];
  for (let i = 0; i < n; i++) {
    const q = stepRect(i);
    const corners = [proj(q.x0, q.y0), proj(q.x1, q.y0), proj(q.x1, q.y1), proj(q.x0, q.y1)];
    const top = up ? H * (i + 1) / n : -H * (i + 1) / n;
    const bottom = up ? 0 : -H * 1.05;
    const cy = corners.reduce((a, p) => a + p.y, 0) / 4 - (top + bottom) / 2;
    boxes.push({ corners, top, bottom, cy });
  }
  boxes.sort((a, b) => a.cy - b.cy); // back to front
  for (const b of boxes) {
    const sides = [];
    for (let k = 0; k < 4; k++) {
      const a = b.corners[k], c = b.corners[(k + 1) % 4];
      sides.push({ pts: [lift(a, b.bottom), lift(c, b.bottom), lift(c, b.top), lift(a, b.top)], my: (a.y + c.y) / 2 });
    }
    sides.sort((p, q) => p.my - q.my);
    sides.forEach((sd, k) => poly(sd.pts, k >= 2 ? riserCol : sideCol)); // the two nearest faces are the bright risers
    poly(b.corners.map((p) => lift(p, b.top)), topCol);
  }
  g.restore();
}

function pin(g, x, y, selected) {
  const top = y - 52;
  g.save();
  g.strokeStyle = A; g.lineWidth = 4; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x, y); g.lineTo(x, top + 16); g.stroke();
  g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(x, y, 7, 3, 0, 0, Math.PI * 2); g.fill();
  if (selected) {
    g.strokeStyle = A; g.lineWidth = 3; g.shadowColor = A; g.shadowBlur = 12;
    g.beginPath(); g.arc(x, top, 30, 0, Math.PI * 2); g.stroke();
    g.shadowBlur = 0; g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(x, top, 26, 0, Math.PI * 2); g.stroke();
  }
  g.fillStyle = A; g.strokeStyle = '#fff'; g.lineWidth = 2.5;
  g.beginPath(); g.arc(x, top, 17, 0, Math.PI * 2); g.fill(); g.stroke();
  // globe lines
  g.strokeStyle = '#fff'; g.lineWidth = 1.6;
  g.beginPath(); g.arc(x, top, 10, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.ellipse(x, top, 4.5, 10, 0, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(x - 10, top); g.lineTo(x + 10, top); g.moveTo(x - 8.5, top - 5); g.lineTo(x + 8.5, top - 5); g.moveTo(x - 8.5, top + 5); g.lineTo(x + 8.5, top + 5); g.stroke();
  g.restore();
}

export function sprite(g, ch, x, y, isPlayer) {
  if (!ch) return;
  g.save();
  g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.ellipse(x, y, 12, 4.5, 0, 0, Math.PI * 2); g.fill();
  const img = ch.asset ? assetImage(S.project, ch.asset, () => {}) : null;
  if (img) {
    const hh = 48, w = hh * (img.naturalWidth / img.naturalHeight);
    g.imageSmoothingEnabled = true;
    g.drawImage(img, x - w / 2, y - hh, w, hh);
  } else {
    // little chibi stand-in: body, head, hair in the character's colour
    g.fillStyle = shade(ch.color, -0.35);
    roundRect(g, x - 8, y - 22, 16, 20, 5); g.fill();
    g.fillStyle = '#f3d6c6'; g.beginPath(); g.arc(x, y - 30, 10, 0, Math.PI * 2); g.fill();
    g.fillStyle = ch.color; g.beginPath(); g.arc(x, y - 32, 10.5, Math.PI * 1.02, Math.PI * 1.98); g.fill();
    g.fillRect(x - 10.5, y - 33, 4, 9); g.fillRect(x + 6.5, y - 33, 4, 9);
    g.fillStyle = '#2a1a1a'; g.fillRect(x - 4.5, y - 29, 2, 3); g.fillRect(x + 2.5, y - 29, 2, 3);
    g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 1;
    g.beginPath(); g.arc(x, y - 30, 10, 0, Math.PI * 2); g.stroke();
  }
  if (isPlayer) { g.fillStyle = '#2aa8ff'; g.beginPath(); g.moveTo(x, y - 52); g.lineTo(x - 6, y - 60); g.lineTo(x + 6, y - 60); g.closePath(); g.fill(); }
  g.restore();
}
function roundRect(g, x, y, w, hh, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + hh, r); g.arcTo(x + w, y + hh, x, y + hh, r); g.arcTo(x, y + hh, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function shade(hex, amt) {
  const n = parseInt((hex || '#888888').slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + 255 * amt)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function drawFloorStack(floors, m) {
  const cv = st.floorCv;
  const r = cv.getBoundingClientRect();
  const dpr = st.dpr;
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  const W = r.width, H = r.height;
  // one layer per floor number; maps on the same floor (areas like "Dorms") share that layer as pieces
  const byFloor = new Map();
  for (const fl of floors) {
    const f = fl.floor ?? 0;
    if (!byFloor.has(f)) byFloor.set(f, []);
    byFloor.get(f).push(fl);
  }
  const levels = [...byFloor.keys()].sort((a, b) => a - b);
  for (const f of levels) byFloor.get(f).sort((a, b) => (a.isArea ? 1 : 0) - (b.isArea ? 1 : 0)); // the floor itself first, then its areas
  const n = levels.length;
  const gap = Math.min(42, (H - 70) / Math.max(1, n - 1 || 1));
  const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  st.floorPaths = [];
  levels.forEach((f, i) => {
    const cy = H - 40 - i * gap, cx = W / 2;
    const Apt = [cx - 95, cy + 6], Bpt = [cx + 5, cy - 30], Cpt = [cx + 95, cy - 2], Dpt = [cx - 5, cy + 34];
    const pieces = byFloor.get(f);
    const hasCurrent = pieces.some((p) => p.id === m.id);
    pieces.forEach((fl, j) => {
      const t0 = j / pieces.length, t1 = (j + 1) / pieces.length;
      // split the tile from its left-back edge to its right-front edge
      const p0 = lerp(Apt, Dpt, t0), p1 = lerp(Apt, Dpt, t1), q1 = lerp(Bpt, Cpt, t1), q0 = lerp(Bpt, Cpt, t0);
      const p = new Path2D();
      p.moveTo(...p0); p.lineTo(...q0); p.lineTo(...q1); p.lineTo(...p1); p.closePath();
      const on = fl.id === m.id;
      g.fillStyle = on ? rgbaOf(A, .92) : hasCurrent ? rgbaOf(A, .28) : 'rgba(255,255,255,.1)';
      g.strokeStyle = on ? '#fff' : 'rgba(255,255,255,.35)'; g.lineWidth = 1.5;
      g.fill(p); g.stroke(p);
      if (pieces.length > 1) {
        // small name on each piece
        const mid = lerp(lerp(p0, p1, 0.5), lerp(q0, q1, 0.5), 0.5);
        g.save(); g.translate(mid[0], mid[1]); g.rotate(-0.36);
        g.fillStyle = on ? '#fff' : 'rgba(255,255,255,.7)'; g.font = '700 11px "Segoe UI", sans-serif'; g.textAlign = 'center';
        g.fillText(fl.isArea ? fl.name.slice(0, 10) : floorShort(fl), 0, 4);
        g.restore();
      }
      st.floorPaths.push([p, fl.id]);
    });
    // the floor's name on the tile's front edge
    g.save(); g.translate(cx + 48, cy + 26); g.rotate(-0.36);
    g.fillStyle = hasCurrent ? '#fff' : 'rgba(255,255,255,.75)'; g.font = '900 18px "Arial Black", "Segoe UI", sans-serif';
    g.textAlign = 'center'; g.fillText(f < 0 ? 'B' + -f : f === 0 ? 'G' : f + 'F', 0, 0);
    g.restore();
  });
  cv.onclick = (e) => {
    const b = cv.getBoundingClientRect();
    const x = e.clientX - b.left, y = e.clientY - b.top;
    for (let i = st.floorPaths.length - 1; i >= 0; i--) {
      const [p, id] = st.floorPaths[i];
      if (g.isPointInPath(p, x * dpr, y * dpr)) { st.mapId = id; st.sel = 0; hideCursor(); renderV3(st.host); return; }
    }
  };
}
export function floorShort(m) { const f = m.floor ?? 0; return f < 0 ? 'B' + -f : f === 0 ? 'G' : f + 'F'; }

function wireCanvas() {
  const cv = st.cv;
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    // how far out you can go depends on the map: always far enough to see all of it with room to spare
    const span = (st.img.width + st.img.height) * C;
    const fitK = Math.min((st.W * 0.9) / span, (st.H * 0.9) / (span * SQ + THICK));
    const minK = Math.min(0.35, fitK * 0.6);
    st.kt = Math.max(minK, Math.min(2.6, (st.kt || st.k) * Math.pow(1.0015, -e.deltaY)));
    st.lastZoom = performance.now();
  }, { passive: false });
  cv.addEventListener('pointerdown', (e) => {
    cv.setPointerCapture(e.pointerId);
    st.drag = { x: e.clientX, y: e.clientY, fu: st.fu, fv: st.fv, moved: false };
  });
  cv.addEventListener('pointermove', (e) => {
    if (!st.drag) return;
    const dX = e.clientX - st.drag.x, dY = e.clientY - st.drag.y;
    if (Math.abs(dX) + Math.abs(dY) > 4) st.drag.moved = true;
    if (!st.drag.moved) return;
    st.follow = false;
    const r = cv.getBoundingClientRect();
    setCamera();
    const g0 = unproj(st.drag.px ?? (st.drag.x - r.left), st.drag.py ?? (st.drag.y - r.top));
    const g1 = unproj(e.clientX - r.left, e.clientY - r.top);
    st.fu -= (g1.x - g0.x) * P; st.fv -= (g1.y - g0.y) * P;
    st.drag.px = e.clientX - r.left; st.drag.py = e.clientY - r.top;
  });
  cv.addEventListener('pointerup', (e) => {
    const d = st.drag; st.drag = null;
    if (!d || d.moved) return;
    const r = cv.getBoundingClientRect();
    const X = e.clientX - r.left, Y = e.clientY - r.top;
    // pins first (they stick up above the floor)
    for (const [i, it] of st.items.entries()) {
      if (it.kind !== 'jump' || it.mapId !== st.mapId) continue;
      const p = proj(it.x, it.y);
      if (Math.hypot(X - p.x, Y - (p.y - 52)) < 20) return select(i);
    }
    const gp = unproj(X, Y);
    const baked = bakeMap(curMap(), S.view);
    const cell = cellAt(baked, gp.x, gp.y);
    if (!cell) return;
    if (st.tab !== 'place') { st.tab = 'place'; renderV3(st.host); }
    const i = st.items.findIndex((it) => it.el.id === cell.el.id);
    if (i >= 0) select(i);
  });
  cv.addEventListener('dblclick', go);
}
