// 3D views: first-person walk mode and the stacked "building" view.
// World units are metres. Grid (x, y) -> world (x * cellSize, z = y * cellSize). Y is up.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { S, emit, on, change } from './store.js';
import { bakeMap, arrivalPoint, cellAt, doorCenter } from './bake.js';
import { getTheme } from './themes.js';
import { cellsToRects, condActive, lockedNow, findElement, elementTitle, roomCenter } from './model.js';
import { portraitFor, renderMapImage } from './render2d.js';
import { iconCanvas } from './icons.js';

let renderer, host, hud, mode = null, scene, camera, controls, raf = 0;
let world = null;        // walk-mode build result
let keys = new Set();
let player = { x: 0, y: 0, yaw: 0, pitch: 0, vx: 0, vy: 0, height: 0 };
let armed = true, armFrom = null, fading = 0, fadeTarget = null;
let message = null, lastRoom = null, minimapCache = null, collected = new Set();
const clock = new THREE.Clock();

const LIGHT_PRESETS = {
  default: { sky: '#ffffff', ground: '#776666', amb: 1.0, fog: null },
  warm: { sky: '#ffd9a8', ground: '#6a4a30', amb: 1.0 },
  cold: { sky: '#c6dcff', ground: '#3a4a66', amb: 0.95 },
  night: { sky: '#6070b0', ground: '#151a30', amb: 0.45 },
  blacklight: { sky: '#8a4cff', ground: '#200a40', amb: 0.6 },
  emergency: { sky: '#ff4040', ground: '#300000', amb: 0.6 },
  'crime scene': { sky: '#ff9a9a', ground: '#401010', amb: 0.75 },
  dark: { sky: '#404050', ground: '#0a0a10', amb: 0.25 },
};

// ---------------------------------------------------------------------------------
export function init3D(container, hudEl) {
  host = container; hud = hudEl;
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);
  new ResizeObserver(resize).observe(host);
  window.addEventListener('keydown', (e) => {
    if (!mode) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    keys.add(e.code);
    if (mode === 'walk') {
      if (e.code === 'KeyE' || e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); interact(); }
      if (e.code === 'KeyM') { hud.classList.toggle('hide-minimap'); }
      if (e.code === 'KeyC') { world.ceilings.forEach((m) => (m.visible = !m.visible)); }
      if (e.code === 'Minus' || e.code === 'Equal' || e.code === 'NumpadSubtract' || e.code === 'NumpadAdd') {
        // shrink / grow the whole map live: smaller squares = cosier rooms and shorter corridors
        const st = S.project.settings;
        const step = (e.code === 'Minus' || e.code === 'NumpadSubtract' ? -1 : 1) * (st.cellSize <= 0.6 ? 0.025 : 0.05);
        const next = Math.round(Math.max(0.2, Math.min(2, st.cellSize + step)) * 1000) / 1000;
        if (next === st.cellSize) return;
        change('Map scale ' + next + ' m', () => { S.project.settings.cellSize = next; });
        loadWalkMap(world.map, { x: player.x, y: player.y, face: player.yaw });
        emit('toast', { text: `Scale: ${next} m per square — rooms ${next < 1 ? 'smaller' : next > 1 ? 'bigger' : 'normal size'} (−/= to change, Ctrl+Z to undo)` });
      }
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());
  renderer.domElement.addEventListener('click', () => {
    if (mode === 'walk' && document.pointerLockElement !== renderer.domElement) renderer.domElement.requestPointerLock?.();
    else if (mode === 'walk' && message) message = null;
  });
  document.addEventListener('mousemove', (e) => {
    if (mode !== 'walk' || document.pointerLockElement !== renderer.domElement) return;
    player.yaw += e.movementX * 0.0022;
    player.pitch = Math.max(-1.35, Math.min(1.35, player.pitch - e.movementY * 0.0022));
  });
  renderer.domElement.addEventListener('pointerdown', onBuildingClick);
  renderer.domElement.addEventListener('pointermove', onBuildingHover);
  on('change', () => { if (mode === 'building') buildBuilding(); minimapCache = null; });
}

function resize() {
  if (!renderer) return;
  const r = host.getBoundingClientRect();
  renderer.setSize(r.width, r.height);
  if (camera) { camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix(); }
}

export function stop3D() {
  mode = null;
  cancelAnimationFrame(raf);
  if (document.pointerLockElement) document.exitPointerLock();
  controls?.dispose(); controls = null;
  if (scene) disposeScene(scene);
  scene = null; world = null;
  hud.innerHTML = '';
}

function disposeScene(s) {
  s.traverse((o) => {
    o.geometry?.dispose?.();
    if (o.material) for (const m of [].concat(o.material)) { m.map?.dispose?.(); m.dispose?.(); }
  });
}

// ---------------------------------------------------------------------------------
// Shared mesh building
const matCache = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.85, metalness: 0.02, ...opts }));
  return matCache.get(key);
}
function canvasTex(canvas, pixel = false) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  if (pixel) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; }
  t.needsUpdate = true;
  return t;
}

/**
 * Build one map as a THREE.Group.
 * opts: { ceilings, cutaway (0..1 wall height factor), forExport, view }
 */
export function buildMapGroup(m, project, opts = {}) {
  const T = getTheme(project, m);
  const st = project.settings;
  const cs = st.cellSize;
  const view = opts.view ?? S.view;
  const baked = bakeMap(m, view);
  const group = new THREE.Group();
  group.name = m.name;
  const H = st.wallHeight * (opts.cutaway ?? 1);
  const th = st.wallThickness;
  const doorH = Math.min(st.doorHeight, H);
  const out = { group, baked, doors: [], links: [], interact: [], ceilings: [], npcs: [], lights: [], stairs: [], pickables: [] };

  // Floors and blocked boxes
  for (const [el, cells] of baked.owned) {
    const kind = el.type === 'stairs' ? 'stairs' : el.kind;
    const rects = cellsToRects(cells);
    const elH = (el.wallHeight || st.wallHeight) * (opts.cutaway ?? 1);
    for (const r of rects) {
      if (kind === 'blocked') {
        const geo = new THREE.BoxGeometry(r.w * cs, elH, r.h * cs);
        const mesh = new THREE.Mesh(geo, mat(T.trim3d));
        mesh.position.set((r.x + r.w / 2) * cs, elH / 2, (r.y + r.h / 2) * cs);
        mesh.userData = { elId: el.id, mapId: m.id };
        group.add(mesh); out.pickables.push(mesh);
        continue;
      }
      if (kind === 'stairs') continue;
      const color = el.floorColor || (kind === 'room' ? T.roomFloor3d : T.floor3d);
      const geo = new THREE.PlaneGeometry(r.w * cs, r.h * cs);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, mat(color));
      mesh.position.set((r.x + r.w / 2) * cs, 0, (r.y + r.h / 2) * cs);
      mesh.receiveShadow = true;
      mesh.userData = { elId: el.id, mapId: m.id };
      group.add(mesh); out.pickables.push(mesh);
      if (opts.ceilings && el.ceiling !== false && kind !== 'outdoor') {
        const cg = new THREE.PlaneGeometry(r.w * cs, r.h * cs);
        cg.rotateX(Math.PI / 2);
        const cm = new THREE.Mesh(cg, mat(T.ceiling3d));
        cm.position.set((r.x + r.w / 2) * cs, elH, (r.y + r.h / 2) * cs);
        group.add(cm); out.ceilings.push(cm);
      }
    }
  }

  // Walls
  const roomH = (el) => (el && el.type === 'room' && el.wallHeight ? el.wallHeight : st.wallHeight) * (opts.cutaway ?? 1);
  for (const w of baked.walls) {
    const len = (w.o === 'h' ? w.x2 - w.x1 : w.y2 - w.y1) * cs;
    const h = Math.max(roomH(w.a), roomH(w.b));
    const color = (w.a?.wallColor || w.b?.wallColor) || T.wall3d;
    const geo = w.o === 'h' ? new THREE.BoxGeometry(len + th, h, th) : new THREE.BoxGeometry(th, h, len + th);
    const mesh = new THREE.Mesh(geo, mat(color));
    mesh.position.set(((w.x1 + w.x2) / 2) * cs, h / 2, ((w.y1 + w.y2) / 2) * cs);
    mesh.castShadow = true;
    group.add(mesh);
    // skirting trim
    const tg = w.o === 'h' ? new THREE.BoxGeometry(len + th, 0.12, th + 0.03) : new THREE.BoxGeometry(th + 0.03, 0.12, len + th);
    const trim = new THREE.Mesh(tg, mat(T.trim3d));
    trim.position.set(mesh.position.x, 0.06, mesh.position.z);
    group.add(trim);
  }

  // Doors: lintel above, a panel that opens, and a nameplate
  for (const d of baked.doors) {
    const info = baked.doorInfo.get(d);
    if (!info || info.inWall === 0) {
      if (d.link?.mapId) out.links.push({ el: d, kind: 'door' });
      continue;
    }
    const c = doorCenter(d);
    const len = d.len * cs;
    const h = Math.max(roomH(info.a?.el), roomH(info.b?.el));
    const horiz = d.orient === 'h';
    if (h > doorH + 0.01) {
      const lg = horiz ? new THREE.BoxGeometry(len, h - doorH, th) : new THREE.BoxGeometry(th, h - doorH, len);
      const lintel = new THREE.Mesh(lg, mat(info.a?.el.wallColor || info.b?.el.wallColor || T.wall3d));
      lintel.position.set(c.x * cs, doorH + (h - doorH) / 2, c.y * cs);
      group.add(lintel);
    }
    // frame
    const fg = horiz ? new THREE.BoxGeometry(len + 0.1, 0.08, th + 0.06) : new THREE.BoxGeometry(th + 0.06, 0.08, len + 0.1);
    const frame = new THREE.Mesh(fg, mat(T.trim3d));
    frame.position.set(c.x * cs, doorH, c.y * cs);
    group.add(frame);

    // shut if the door itself is locked, or it leads into a room that's locked in this chapter
    const lockRoom = [info.a?.el, info.b?.el].find((r) => r && r.type === 'room' && lockedNow(r, view));
    const door = { el: d, panels: [], open: 0, c, locked: lockedNow(d, view) || !!lockRoom, lockRoom };
    if (d.style !== 'opening') {
      const halves = d.style === 'double' && d.len >= 2 ? 2 : 1;
      for (let i = 0; i < halves; i++) {
        const pw = len / halves - 0.04;
        const pivot = new THREE.Group();
        const sign = i === 0 ? -1 : 1;
        // hinge at the outer end of each half
        const hx = horiz ? c.x * cs + sign * (len / 2) : c.x * cs;
        const hz = horiz ? c.y * cs : c.y * cs + sign * (len / 2);
        pivot.position.set(hx, 0, hz);
        const shutter = d.style === 'shutter' || d.lock === 'barred';
        const pg = horiz ? new THREE.BoxGeometry(pw, doorH - 0.02, 0.06) : new THREE.BoxGeometry(0.06, doorH - 0.02, pw);
        const panel = new THREE.Mesh(pg, mat(shutter ? '#77727a' : T.door3d, { roughness: 0.6 }));
        panel.position.set(horiz ? -sign * pw / 2 : 0, doorH / 2, horiz ? 0 : -sign * pw / 2);
        panel.castShadow = true;
        pivot.add(panel);
        // handle
        const hg = new THREE.BoxGeometry(horiz ? 0.12 : 0.1, 0.05, horiz ? 0.1 : 0.12);
        const handle = new THREE.Mesh(hg, mat('#d8c27a', { metalness: 0.7, roughness: 0.3 }));
        handle.position.set(horiz ? -sign * (pw - 0.12) : 0, 1.0, horiz ? 0 : -sign * (pw - 0.12));
        pivot.add(handle);
        pivot.userData.sign = sign;
        group.add(pivot);
        door.panels.push(pivot);
      }
      if (d.lock === 'sealed') {
        // police-tape X
        const tape = mat('#ffd400', { emissive: new THREE.Color('#403500') });
        for (const a of [0.7, -0.7]) {
          const tg = new THREE.BoxGeometry(horiz ? len * 1.15 : 0.02, 0.1, horiz ? 0.02 : len * 1.15);
          const t = new THREE.Mesh(tg, tape);
          t.position.set(c.x * cs, doorH * 0.5, c.y * cs);
          t.rotation[horiz ? 'z' : 'x'] = a;
          if (horiz) t.position.z += 0.06; else t.position.x += 0.06;
          group.add(t);
        }
      }
    }
    out.doors.push(door);
    if (d.link?.mapId) out.links.push({ el: d, kind: 'door' });
    if (door.locked) out.interact.push({ el: d, x: c.x, y: c.y, kind: 'door', lockRoom, project });

    // nameplate on the hall side of a room door (portrait / icon / room name)
    const roomSide = [info.a, info.b].find((s) => s?.kind === 'room');
    const otherSide = roomSide === info.a ? info.b : info.a;
    if (roomSide && otherSide && !opts.forExport) {
      const plate = nameplate(roomSide.el, project, T);
      if (plate) {
        const pw = Math.min(0.9, len * 0.8), ph = pw * (plate.image.height / plate.image.width);
        const pm = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), new THREE.MeshBasicMaterial({ map: plate, transparent: true }));
        // put it on the face of the wall towards the other side
        const toOther = roomSide === info.a ? 1 : -1; // a is north/west
        const off = th / 2 + 0.01;
        pm.position.set(c.x * cs + (horiz ? 0 : toOther * off), Math.min(h - ph / 2 - 0.05, doorH + ph / 2 + 0.12), c.y * cs + (horiz ? toOther * off : 0));
        pm.rotation.y = horiz ? (toOther > 0 ? 0 : Math.PI) : (toOther > 0 ? Math.PI / 2 : -Math.PI / 2);
        group.add(pm);
      }
    }
  }

  // Stairs
  for (const s of baked.stairs) {
    const r = s.rects[0];
    const alongZ = s.dir === 'n' || s.dir === 's';
    const length = (alongZ ? r.h : r.w) * cs, width = (alongZ ? r.w : r.h) * cs;
    const rise = Math.min(st.floorGap * 0.5, length * 0.6) * (s.goes === 'down' ? -1 : 1);
    const steps = Math.max(4, Math.round(length / 0.3));
    const stepMat = mat(T.floor3d);
    const sGroup = new THREE.Group();
    sGroup.position.set((r.x + r.w / 2) * cs, 0, (r.y + r.h / 2) * cs);
    sGroup.rotation.y = { n: 0, w: Math.PI / 2, s: Math.PI, e: -Math.PI / 2 }[s.dir] ?? 0;
    for (let i = 0; i < steps; i++) {
      const top = (rise * (i + 1)) / steps; // height of this step's tread
      // up: solid block from the floor to the tread. down: a thick slab under the tread.
      const hgt = rise >= 0 ? Math.max(0.02, top) : 0.25;
      const b = new THREE.Mesh(new THREE.BoxGeometry(width, hgt, length / steps), stepMat);
      // local -z is "forward" (direction of travel)
      b.position.set(0, top - hgt / 2, length / 2 - (length * (i + 0.5)) / steps);
      sGroup.add(b);
    }
    // side rails
    for (const sx of [-1, 1]) {
      const rg = new THREE.BoxGeometry(0.06, 0.06, length);
      const rail = new THREE.Mesh(rg, mat(T.trim3d));
      rail.position.set(sx * (width / 2 - 0.05), Math.abs(rise) / 2 + 0.9 * Math.sign(rise || 1), 0);
      rail.rotation.x = Math.atan2(rise, length) * 1;
      sGroup.add(rail);
    }
    group.add(sGroup);
    out.stairs.push({ el: s, rise });
    if (s.link?.mapId) out.links.push({ el: s, kind: 'stairs' });
  }

  // Markers
  let lightCount = 0;
  for (const mk of m.elements) {
    if (mk.type !== 'marker' || mk.hidden || !condActive(mk.cond, view) || mk.kind === 'note') continue;
    const px = mk.x * cs, pz = mk.y * cs;
    if (mk.kind === 'npc' || mk.kind === 'fte') {
      const ch = project.characters.find((c) => c.id === mk.characterId);
      const sp = standee(ch, mk, project, T);
      sp.position.set(px, 0, pz);
      sp.userData = { elId: mk.id, mapId: m.id };
      group.add(sp); out.npcs.push(sp); out.pickables.push(sp.children[0]);
      out.interact.push({ el: mk, x: mk.x, y: mk.y, kind: 'npc', name: ch?.name });
    } else if (mk.kind === 'prop') {
      const h = (mk.height || 0.9);
      let mesh;
      const img = mk.asset ? portraitFor({ asset: mk.asset }, project, T) : null;
      if (img) {
        const tex = canvasTex(toCanvas(img));
        const w = mk.w * cs, hh = w * (img.height / img.width);
        mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide }));
        mesh.position.set(px, hh / 2, pz);
      } else {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(mk.w * cs, h, mk.h * cs), mat(mk.color || '#9a7b6a'));
        mesh.position.set(px, h / 2, pz);
        mesh.castShadow = true;
      }
      mesh.rotation.y = -((mk.rot || 0) * Math.PI) / 180;
      group.add(mesh);
      if (mk.text) out.interact.push({ el: mk, x: mk.x, y: mk.y, kind: 'hotspot' });
    } else if (mk.kind === 'light') {
      if (opts.forExport) continue;
      if (lightCount++ < 12) {
        const l = new THREE.PointLight(new THREE.Color(mk.lightColor || '#ffe9c4'), (mk.intensity ?? 1) * 6, (mk.range || 6) * cs, 1.6);
        l.position.set(px, (mk.height > 1.5 ? mk.height : st.wallHeight - 0.3), pz);
        group.add(l); out.lights.push(l);
      }
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), new THREE.MeshBasicMaterial({ color: mk.lightColor || '#ffe9c4' }));
      bulb.position.set(px, st.wallHeight - 0.25, pz);
      group.add(bulb);
    } else if (mk.kind === 'hotspot' || mk.kind === 'evidence') {
      if (opts.forExport) continue;
      if (mk.kind === 'evidence' && collected.has(mk.id)) continue;
      const color = mk.kind === 'evidence' ? '#ff4060' : '#ffc400';
      const spark = new THREE.Mesh(new THREE.OctahedronGeometry(0.12), new THREE.MeshBasicMaterial({ color }));
      spark.position.set(px, mk.height > 0.2 && mk.height < 3 ? mk.height : 1.0, pz);
      spark.userData.spin = true;
      group.add(spark);
      out.interact.push({ el: mk, x: mk.x, y: mk.y, kind: mk.kind, mesh: spark });
    } else if (mk.kind === 'camera') {
      const cam = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.18, 0.35), mat('#333'));
      cam.position.set(px, st.wallHeight - 0.35, pz);
      cam.rotation.y = -((mk.rot || 0) * Math.PI) / 180;
      const lens = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff2050' }));
      lens.position.set(0, 0, -0.19); cam.add(lens);
      group.add(cam);
      if (mk.text) out.interact.push({ el: mk, x: mk.x, y: mk.y, kind: 'hotspot' });
    } else if (mk.kind === 'portal') {
      if (!opts.forExport) {
        const pg = new THREE.PlaneGeometry(cs * 0.9, 2.2);
        const pm = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ color: T.accent, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
        pm.position.set(px, 1.1, pz);
        pm.rotation.y = -((mk.rot || 0) * Math.PI) / 180;
        group.add(pm);
      }
      if (mk.link?.mapId) out.links.push({ el: mk, kind: 'portal' });
    } else if (mk.kind === 'trigger') {
      out.interact.push({ el: mk, x: mk.x, y: mk.y, kind: 'trigger' });
    }
  }
  return out;
}

function toCanvas(img) {
  if (img instanceof HTMLCanvasElement) return img;
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height;
  c.getContext('2d').drawImage(img, 0, 0);
  return c;
}

function nameplate(room, project, T) {
  const img = portraitFor(room, project, T);
  const ch = room.characterId ? project.characters.find((c) => c.id === room.characterId) : null;
  if (!img && !ch && !room.name) return null;
  const c = document.createElement('canvas');
  c.width = 128; c.height = img || ch ? 128 : 48;
  const g = c.getContext('2d');
  g.fillStyle = T.room; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = T.line; g.lineWidth = 6; g.strokeRect(3, 3, c.width - 6, c.height - 6);
  if (img) {
    g.imageSmoothingEnabled = !(img instanceof HTMLCanvasElement);
    const s = 96, ar = (img.width || 1) / (img.height || 1);
    const w = ar > 1 ? s : s * ar, h = ar > 1 ? s / ar : s;
    g.drawImage(img, 64 - w / 2, 64 - h / 2, w, h);
  } else if (ch) {
    g.fillStyle = ch.color; g.beginPath(); g.arc(64, 56, 34, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText((ch.initials || ch.name.slice(0, 2)).toUpperCase(), 64, 58);
    g.fillStyle = T.text; g.font = 'bold 16px sans-serif'; g.fillText(ch.name, 64, 108);
  } else {
    g.fillStyle = T.text; g.font = 'bold 18px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(room.name.slice(0, 12), 64, 25);
  }
  return canvasTex(c, true);
}

function standee(ch, mk, project, T) {
  const grp = new THREE.Group();
  const img = ch?.asset ? portraitFor({ asset: ch.asset }, project, T) : null;
  const height = mk.height > 1.2 ? mk.height : 1.7;
  let canvas;
  if (img) canvas = toCanvas(img);
  else {
    canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 300;
    const g = canvas.getContext('2d');
    const col = ch?.color || '#999';
    g.fillStyle = col;
    g.beginPath(); g.arc(64, 52, 36, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(20, 300); g.lineTo(26, 130); g.quadraticCurveTo(64, 96, 102, 130); g.lineTo(108, 300); g.closePath(); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 22px sans-serif'; g.textAlign = 'center';
    g.fillText(ch?.name ?? mk.name ?? '?', 64, 200);
  }
  const w = height * (canvas.width / canvas.height);
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, height), new THREE.MeshStandardMaterial({ map: canvasTex(canvas), transparent: true, alphaTest: 0.3, side: THREE.DoubleSide }));
  plane.position.y = height / 2;
  grp.add(plane);
  grp.userData.billboard = true;
  // little shadow disc
  const sh = new THREE.Mesh(new THREE.CircleGeometry(w * 0.35, 20), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.25 }));
  sh.rotation.x = -Math.PI / 2; sh.position.y = 0.01;
  grp.add(sh);
  return grp;
}

function addLights(sc, T, preset = 'default', strength = 1) {
  const p = LIGHT_PRESETS[preset] || LIGHT_PRESETS.default;
  const hemi = new THREE.HemisphereLight(new THREE.Color(p.sky), new THREE.Color(p.ground), 1.6 * p.amb * strength);
  hemi.name = 'hemi';
  sc.add(hemi);
  sc.add(new THREE.AmbientLight(0xffffff, 0.45 * strength));
  const dir = new THREE.DirectionalLight(0xffffff, 0.9 * strength);
  dir.position.set(10, 20, 6);
  dir.name = 'sun';
  sc.add(dir);
  return hemi;
}

// ---------------------------------------------------------------------------------
// WALK MODE
export function startWalk(at = null) {
  stop3D();
  mode = 'walk';
  resize();
  const m = S.project.maps.find((x) => x.id === (at?.mapId ?? S.mapId));
  loadWalkMap(m, at);
  hud.innerHTML = `
    <div class="w-loc"><span class="w-map"></span><b class="w-room"></b></div>
    <canvas class="w-mini" width="220" height="160"></canvas>
    <div class="w-cross"></div>
    <div class="w-prompt"></div>
    <div class="w-msg"></div>
    <div class="w-help">Click to look around · WASD move · Shift run · E examine / talk · M minimap · C ceiling · − / = room scale · Tab back to the editor</div>
    <div class="w-fade"></div>`;
  clock.getDelta();
  loop();
}

function loadWalkMap(m, at) {
  if (scene) disposeScene(scene);
  const T = getTheme(S.project, m);
  scene = new THREE.Scene();
  scene.background = new THREE.Color(T.sky3d);
  const isNight = S.view.time >= 0 && /night/i.test(S.project.times[S.view.time] || '');
  scene.fog = new THREE.Fog(new THREE.Color(T.sky3d), 18, 60);
  addLights(scene, T, isNight ? 'night' : 'default');
  // same field of view as the game's overworld camera (60° by default); wider makes rooms look bigger and corridors longer
  camera = new THREE.PerspectiveCamera(S.project.settings.fov || 60, 1, 0.05, 300);
  resize();
  world = buildMapGroup(m, S.project, { ceilings: true });
  world.map = m;
  scene.add(world.group);
  S.playerPos = { mapId: m.id, x: 0, y: 0 };
  // where to start
  let start = null;
  if (at?.x !== undefined) start = { x: at.x, y: at.y, face: at.face ?? 0 };
  else if (at?.targetId) { const t = m.elements.find((e) => e.id === at.targetId); start = arrivalPoint(world.baked, t); }
  if (!start) {
    const sp = m.elements.find((e) => e.type === 'marker' && e.kind === 'spawn');
    if (sp) start = { x: sp.x, y: sp.y, face: ((sp.rot || 0) * Math.PI) / 180 };
  }
  if (!start) {
    const hall = [...world.baked.cells.entries()].find(([, c]) => c.kind === 'hall') ?? [...world.baked.cells.entries()].find(([, c]) => c.kind !== 'blocked');
    if (hall) { const [x, y] = hall[0].split(',').map(Number); start = { x: x + 0.5, y: y + 0.5, face: 0 }; }
    else start = { x: 0, y: 0, face: 0 };
  }
  player.x = start.x; player.y = start.y; player.yaw = start.face || 0; player.pitch = 0;
  player.height = 0;
  armed = false; armFrom = { x: start.x, y: start.y };
  lastRoom = null; minimapCache = null;
  emit('walk-map', m.id);
}

function travel(link) {
  const target = S.project.maps.find((x) => x.id === link.mapId);
  if (!target) { showMessage('This leads nowhere yet', 'The link points at a map that no longer exists.'); armed = false; armFrom = { x: player.x, y: player.y }; return; }
  fading = 0.0001;
  fadeTarget = { mapId: target.id, targetId: link.targetId };
}

function loop() {
  if (mode !== 'walk') return;
  raf = requestAnimationFrame(loop);
  const frameDt = Math.min(0.25, clock.getDelta());
  // fixed small steps so movement is the same at any frame rate
  const steps = Math.max(1, Math.ceil(frameDt / 0.034));
  for (let i = 0; i < steps; i++) step(frameDt / steps);
  render3dFrame(frameDt);
}

function step(dt) {
  const st = S.project.settings;
  const cs = st.cellSize;

  // fade / travel
  const fadeEl = hud.querySelector('.w-fade');
  if (fading) {
    if (fadeTarget && fading + dt * 3 >= 1) player.vx = player.vy = 0;
    fading += dt * 3;
    if (fadeTarget && fading >= 1) {
      const t = fadeTarget; fadeTarget = null;
      const m = S.project.maps.find((x) => x.id === t.mapId);
      loadWalkMap(m, { targetId: t.targetId });
      fading = 1.0001;
    }
    if (!fadeTarget && fading > 2) fading = 0;
    if (fadeEl) fadeEl.style.opacity = fading ? String(fading <= 1 ? fading : Math.max(0, 2 - fading)) : '0';
  }

  // movement
  if (!message && !fadeTarget) {
    const run = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const speed = (run ? st.runSpeed : st.walkSpeed) / cs;
    let fx = 0, fz = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) fz -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) fz += 1;
    if (keys.has('KeyA')) fx -= 1;
    if (keys.has('KeyD')) fx += 1;
    if (keys.has('ArrowLeft')) player.yaw -= dt * 2.2;
    if (keys.has('ArrowRight')) player.yaw += dt * 2.2;
    const len = Math.hypot(fx, fz) || 1;
    fx /= len; fz /= len;
    const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
    const tx = (fx * cos - fz * sin) * speed, ty = (fx * sin + fz * cos) * speed;
    const k = 1 - Math.exp(-dt * 12);
    player.vx += (tx - player.vx) * k; player.vy += (ty - player.vy) * k;
    moveWithCollision(player.vx * dt, player.vy * dt);
  }

  // stairs height
  let targetH = 0;
  for (const s of world.stairs) {
    const r = s.el.rects[0];
    if (player.x >= r.x && player.x <= r.x + r.w && player.y >= r.y && player.y <= r.y + r.h) {
      const p = { n: (r.y + r.h - player.y) / r.h, s: (player.y - r.y) / r.h, e: (player.x - r.x) / r.w, w: (r.x + r.w - player.x) / r.w }[s.el.dir] ?? 0;
      targetH = s.rise * Math.max(0, Math.min(1, p));
    }
  }
  player.height += (targetH - player.height) * Math.min(1, dt * 14);

  // doors open when near
  for (const d of world.doors) {
    const dist = Math.hypot(player.x - d.c.x, player.y - d.c.y) * cs;
    const want = !d.locked && dist < 2.2 ? 1 : 0;
    d.open += (want - d.open) * Math.min(1, dt * 6);
    for (const p of d.panels) p.rotation.y = d.open * 1.45 * p.userData.sign * (d.el.orient === 'h' ? 1 : -1);
  }

  // links
  if (!armed && armFrom && Math.hypot(player.x - armFrom.x, player.y - armFrom.y) > 1.3) armed = true;
  if (armed && !fading) {
    for (const l of world.links) {
      if (hitLink(l)) {
        armed = false; armFrom = { x: player.x, y: player.y };
        if (lockedNow(l.el, S.view)) {
          // chapter-locked stairs / exits: you can't go through yet
          const ch = l.el.unlockChapter >= 0 ? S.project.chapters[l.el.unlockChapter] : '';
          showMessage(l.el.name || 'Stairs', l.el.lockMsg || (ch ? `The way is blocked until ${ch}.` : 'The way is blocked.'));
          player.vx = -player.vx; player.vy = -player.vy;
        } else travel(l.el.link);
        break;
      }
    }
  }
}

function render3dFrame(dt) {
  if (mode !== 'walk' || !world) return;
  const st = S.project.settings;
  const cs = st.cellSize;
  const eye = st.eyeHeight + player.height + Math.sin(performance.now() / 160) * Math.min(0.03, Math.hypot(player.vx, player.vy) * 0.006);
  camera.position.set(player.x * cs, eye, player.y * cs);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = -player.yaw;
  camera.rotation.x = player.pitch;
  for (const n of world.npcs) {
    n.rotation.y = Math.atan2(camera.position.x - n.position.x, camera.position.z - n.position.z);
  }
  world.group.traverse((o) => { if (o.userData.spin) { o.rotation.y += dt * 2; o.position.y += Math.sin(performance.now() / 300) * 0.0015; } });

  updateHud();
  S.playerPos = { mapId: world.map.id, x: player.x, y: player.y, face: player.yaw };
  renderer.render(scene, camera);
}

function hitLink(l) {
  const e = l.el;
  if (l.kind === 'door') {
    const c = doorCenter(e);
    const along = e.orient === 'h' ? Math.abs(player.x - c.x) : Math.abs(player.y - c.y);
    const across = e.orient === 'h' ? Math.abs(player.y - c.y) : Math.abs(player.x - c.x);
    return along < e.len / 2 && across < 0.3;
  }
  if (l.kind === 'stairs') {
    const r = e.rects[0];
    const inside = player.x >= r.x && player.x <= r.x + r.w && player.y >= r.y && player.y <= r.y + r.h;
    if (!inside) return false;
    const p = { n: (r.y + r.h - player.y) / r.h, s: (player.y - r.y) / r.h, e: (player.x - r.x) / r.w, w: (r.x + r.w - player.x) / r.w }[e.dir] ?? 0;
    return p > 0.85;
  }
  return Math.hypot(player.x - e.x, player.y - e.y) < 0.55;
}

function moveWithCollision(dx, dy) {
  const cs = S.project.settings.cellSize;
  const r = 0.28 / cs;
  const segs = collisionSegments();
  const steps = Math.ceil(Math.hypot(dx, dy) / (r * 0.5)) || 1;
  for (let s = 0; s < steps; s++) {
    player.x += dx / steps; player.y += dy / steps;
    for (let it = 0; it < 2; it++) for (const w of segs) {
      // closest point on axis-aligned segment
      let cx, cy;
      if (w.o === 'h') { cx = Math.max(w.x1, Math.min(w.x2, player.x)); cy = w.y1; }
      else { cx = w.x1; cy = Math.max(w.y1, Math.min(w.y2, player.y)); }
      const ddx = player.x - cx, ddy = player.y - cy;
      const d = Math.hypot(ddx, ddy);
      if (d < r && d > 1e-6) { player.x = cx + (ddx / d) * r; player.y = cy + (ddy / d) * r; }
      else if (d <= 1e-6) { if (w.o === 'h') player.y += r; else player.x += r; }
    }
  }
}

let segCache = null, segKey = null;
function collisionSegments() {
  if (segKey === world) return segCache;
  const out = [...world.baked.walls];
  for (const d of world.doors) {
    if (!d.locked) continue;
    const e = d.el;
    out.push(e.orient === 'h' ? { o: 'h', x1: e.x, y1: e.y, x2: e.x + e.len, y2: e.y } : { o: 'v', x1: e.x, y1: e.y, x2: e.x, y2: e.y + e.len });
  }
  // solid props
  for (const mk of world.map.elements) {
    if (mk.type !== 'marker' || mk.kind !== 'prop' || mk.hidden || mk.asset || !condActive(mk.cond, S.view)) continue;
    const x0 = mk.x - mk.w / 2, x1 = mk.x + mk.w / 2, y0 = mk.y - mk.h / 2, y1 = mk.y + mk.h / 2;
    out.push({ o: 'h', x1: x0, y1: y0, x2: x1, y2: y0 }, { o: 'h', x1: x0, y1: y1, x2: x1, y2: y1 }, { o: 'v', x1: x0, y1: y0, x2: x0, y2: y1 }, { o: 'v', x1: x1, y1: y0, x2: x1, y2: y1 });
  }
  segCache = out; segKey = world;
  return out;
}

function nearestInteractable() {
  const fwd = { x: Math.sin(player.yaw), y: -Math.cos(player.yaw) };
  let best = null, bestScore = Infinity;
  const cs = S.project.settings.cellSize;
  for (const it of world.interact) {
    if (it.kind === 'trigger') continue;
    if (it.kind === 'evidence' && collected.has(it.el.id)) continue;
    const dx = it.x - player.x, dy = it.y - player.y;
    const dist = Math.hypot(dx, dy) * cs;
    if (dist > 2.2) continue;
    const dot = (dx * fwd.x + dy * fwd.y) / (Math.hypot(dx, dy) || 1);
    if (dot < 0.45 && dist > 0.7) continue;
    const score = dist - dot;
    if (score < bestScore) { bestScore = score; best = it; }
  }
  return best;
}

function interact() {
  if (message) { message = null; return; }
  const it = nearestInteractable();
  if (!it) return;
  const e = it.el;
  if (it.kind === 'door') {
    const ch = (x) => (x?.unlockChapter >= 0 ? S.project.chapters[x.unlockChapter] : '');
    const r = it.lockRoom;
    const msg = e.lockMsg || r?.lockMsg
      || (e.lock && e.lock !== 'open' ? { locked: "It's locked.", sealed: "It's been sealed off.", barred: 'A heavy shutter blocks the way.' }[e.lock] : '')
      || (ch(e) || ch(r) ? `It won't open until ${ch(e) || ch(r)}.` : "It's locked.");
    showMessage(r ? elementTitle(r, S.project) : e.name || 'Door', msg);
  }
  else if (it.kind === 'npc') showMessage(it.name || e.name, e.text || '…');
  else if (it.kind === 'evidence') {
    collected.add(e.id);
    if (it.mesh) it.mesh.visible = false;
    const ev = S.project.evidence.find((x) => x.id === e.evidenceId);
    showMessage('Truth Bullet acquired!', `${ev?.name || e.name}${ev?.desc ? ' — ' + ev.desc : e.text ? ' — ' + e.text : ''}`);
  } else showMessage(e.name || 'Examine', e.text || 'Nothing special.');
}

function showMessage(title, text) {
  message = { title, text };
  if (document.pointerLockElement) { /* keep looking locked; E or click closes */ }
}

function triggerCheck() {
  for (const it of world.interact) {
    if (it.kind !== 'trigger') continue;
    const e = it.el;
    const inside = Math.abs(player.x - e.x) <= e.w / 2 && Math.abs(player.y - e.y) <= e.h / 2;
    if (inside && !it.inside) {
      it.inside = true;
      if (!(e.once && it.fired)) { it.fired = true; showMessage('⚡ ' + (e.name || 'Trigger') + ' [' + e.triggerType + ']', e.text || e.eventId || 'Trigger fired.'); }
    } else if (!inside) it.inside = false;
  }
}

function updateHud() {
  triggerCheck();
  const cell = cellAt(world.baked, player.x, player.y);
  const room = cell?.el;
  const locEl = hud.querySelector('.w-room');
  hud.querySelector('.w-map').textContent = world.map.name + ' · ';
  if (room !== lastRoom) {
    lastRoom = room;
    locEl.textContent = room ? elementTitle(room, S.project) : '';
    locEl.classList.remove('pop'); void locEl.offsetWidth; locEl.classList.add('pop');
    // room lighting preset
    const hemi = scene.getObjectByName('hemi');
    const isNight = S.view.time >= 0 && /night/i.test(S.project.times[S.view.time] || '');
    const p = LIGHT_PRESETS[room?.lighting && room.lighting !== 'default' ? room.lighting : isNight ? 'night' : 'default'];
    if (hemi) { hemi.color.set(p.sky); hemi.groundColor.set(p.ground); hemi.intensity = 1.6 * p.amb; }
  }
  const it = message ? null : nearestInteractable();
  const pr = hud.querySelector('.w-prompt');
  pr.textContent = it ? `[E] ${it.kind === 'npc' ? 'Talk to ' + (it.name || '') : it.kind === 'door' ? 'Try the door' : it.kind === 'evidence' ? 'Pick up' : 'Examine ' + (it.el.name || '')}` : '';
  const msg = hud.querySelector('.w-msg');
  if (message) { msg.style.display = 'block'; msg.innerHTML = `<div class="w-msg-name"></div><div class="w-msg-text"></div><div class="w-msg-more">▼</div>`; msg.querySelector('.w-msg-name').textContent = message.title; msg.querySelector('.w-msg-text').textContent = message.text; }
  else msg.style.display = 'none';
  drawMinimap();
}

function drawMinimap() {
  const c = hud.querySelector('.w-mini');
  if (!c || hud.classList.contains('hide-minimap')) return;
  const g = c.getContext('2d');
  if (!minimapCache) {
    const T = getTheme(S.project, world.map);
    minimapCache = renderMapImage(world.map, S.project, T, { pxPerCell: 12, margin: 1, view: S.view, labels: false });
  }
  const { canvas: img, bounds: b, margin } = minimapCache;
  const ppc = 12;
  const px = (player.x - b.x + margin) * ppc, py = (player.y - b.y + margin) * ppc;
  g.clearRect(0, 0, c.width, c.height);
  g.save();
  g.globalAlpha = 0.9;
  g.drawImage(img, c.width / 2 - px, c.height / 2 - py);
  g.restore();
  g.save(); g.translate(c.width / 2, c.height / 2); g.rotate(player.yaw);
  g.fillStyle = '#2aa8ff'; g.strokeStyle = '#fff'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 6); g.lineTo(0, 3); g.lineTo(-6, 6); g.closePath(); g.fill(); g.stroke();
  g.restore();
}

// ---------------------------------------------------------------------------------
// BUILDING VIEW
export const buildingOpts = { explode: 1, cutaway: 0.45, links: true, building: '', isolate: '', ceilings: false };
let bWorld = null, hovered = null;

export function startBuilding() {
  stop3D();
  mode = 'building';
  resize();
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
  resize();
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.screenSpacePanning = true;
  buildBuilding(true);
  hud.innerHTML = `<div class="b-help">Drag to orbit · Right-drag to pan · Scroll to zoom · Click a room to open it in the editor</div><div class="b-tip"></div>`;
  const tick = () => {
    if (mode !== 'building') return;
    raf = requestAnimationFrame(tick);
    controls.update();
    renderer.render(scene, camera);
  };
  tick();
}

export function buildBuilding(frame = false) {
  if (mode !== 'building') return;
  for (const c of [...scene.children]) { scene.remove(c); }
  const T = getTheme(S.project, null);
  scene.background = new THREE.Color(T.sky3d);
  addLights(scene, T, 'default', 1.1);
  const cs = S.project.settings.cellSize;
  const maps = S.project.maps.filter((m) => (!buildingOpts.building || m.building === buildingOpts.building) && (!buildingOpts.isolate || m.id === buildingOpts.isolate));
  bWorld = { pickables: [], groups: new Map() };
  const box = new THREE.Box3();
  for (const m of maps) {
    const built = buildMapGroup(m, S.project, { ceilings: buildingOpts.ceilings, cutaway: buildingOpts.cutaway });
    built.group.position.set((m.ox || 0) * cs, (m.elevation || 0) * buildingOpts.explode, (m.oy || 0) * cs);
    scene.add(built.group);
    bWorld.groups.set(m.id, built);
    bWorld.pickables.push(...built.pickables);
    // floor label
    const lab = textSprite(`${m.name}${m.building ? '  ·  ' + m.building : ''}`, T);
    const bb = new THREE.Box3().setFromObject(built.group);
    if (!bb.isEmpty()) { lab.position.set(bb.min.x - 0.5, (m.elevation || 0) * buildingOpts.explode + 0.6, bb.min.z - 0.5); box.union(bb); }
    scene.add(lab);
  }
  // link lines between maps
  if (buildingOpts.links) {
    const pts = [];
    for (const m of maps) for (const e of m.elements) {
      if (!e.link?.mapId || !bWorld.groups.has(e.link.mapId)) continue;
      const a = worldPos(m, e);
      const tm = S.project.maps.find((x) => x.id === e.link.mapId);
      const te = tm.elements.find((x) => x.id === e.link.targetId);
      const b = te ? worldPos(tm, te) : worldPos(tm, { x: 0, y: 0 });
      pts.push(a, b);
    }
    if (pts.length) {
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(T.accent), linewidth: 2, depthTest: false, transparent: true }));
      lines.renderOrder = 10;
      scene.add(lines);
      for (let i = 0; i < pts.length; i += 2) for (const p of [pts[i], pts[i + 1]]) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(T.accent), depthTest: false }));
        s.position.copy(p); s.renderOrder = 11; scene.add(s);
      }
    }
  }
  if (frame && !box.isEmpty()) {
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    camera.position.set(c.x + size * 0.6, c.y + size * 0.7, c.z + size * 0.8);
    controls.target.copy(c);
    camera.far = size * 10; camera.updateProjectionMatrix();
  }
}

function worldPos(m, e) {
  const cs = S.project.settings.cellSize;
  let p;
  if (e.type === 'door') p = doorCenter(e);
  else if (e.rects) p = roomCenter(e);
  else p = { x: e.x, y: e.y };
  return new THREE.Vector3(((m.ox || 0) + p.x) * cs, (m.elevation || 0) * buildingOpts.explode + 1.2, ((m.oy || 0) + p.y) * cs);
}

function textSprite(text, T) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = 'bold 40px sans-serif';
  c.width = Math.ceil(g.measureText(text).width + 40); c.height = 64;
  g.font = 'bold 40px sans-serif';
  g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff'; g.textBaseline = 'middle'; g.fillText(text, 20, 34);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(c), depthTest: false }));
  sp.scale.set(c.width / 64, 1, 1);
  sp.center.set(0, 0);
  sp.renderOrder = 12;
  return sp;
}

const ray = new THREE.Raycaster();
function pickBuilding(e) {
  const r = renderer.domElement.getBoundingClientRect();
  const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(v, camera);
  const hit = ray.intersectObjects(bWorld?.pickables ?? [], false)[0];
  if (!hit) return null;
  let o = hit.object;
  while (o && !o.userData.elId) o = o.parent;
  return o?.userData ?? null;
}
let downAt = null;
function onBuildingClick(e) {
  if (mode !== 'building') return;
  downAt = { x: e.clientX, y: e.clientY };
  renderer.domElement.addEventListener('pointerup', (u) => {
    if (!downAt || Math.hypot(u.clientX - downAt.x, u.clientY - downAt.y) > 4) return;
    const p = pickBuilding(u);
    if (p) emit('goto', { mapId: p.mapId, elId: p.elId });
  }, { once: true });
}
function onBuildingHover(e) {
  if (mode !== 'building') return;
  const p = pickBuilding(e);
  const tip = hud.querySelector('.b-tip');
  if (!tip) return;
  if (p) {
    const f = findElement(S.project, p.elId);
    tip.textContent = f ? `${f.map.name} › ${elementTitle(f.el, S.project)}` : '';
    tip.style.display = 'block'; tip.style.left = e.clientX - host.getBoundingClientRect().left + 14 + 'px'; tip.style.top = e.clientY - host.getBoundingClientRect().top + 14 + 'px';
  } else tip.style.display = 'none';
  hovered = p;
}

// Debug helper (browser console): __tvfWalk()
window.__tvfWalk = (set) => { if (set) Object.assign(player, set); return { ...player, map: world?.map.name, armed, message, keys: [...keys] }; };

export function screenshot3D() {
  return renderer?.domElement.toDataURL('image/png');
}
export function resetCollected() { collected.clear(); }
export const iconForHud = iconCanvas;
