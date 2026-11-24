// Draws a map in a theme. Used by the editor canvas, the minimap, the map-screen preview and PNG export.
import { bakeMap, doorCenter } from './bake.js';
import { iconCanvas, assetImage } from './icons.js';
import { roomCenter, condActive, lockedNow, MARKER_KINDS, elementBounds, cellsToRects } from './model.js';

const hatchCache = new Map();
function hatchPattern(g, color, bg, cell) {
  const key = color + bg + Math.round(cell);
  if (hatchCache.has(key)) return g.createPattern(hatchCache.get(key), 'repeat');
  const s = Math.max(4, Math.round(cell / 4));
  const c = document.createElement('canvas');
  c.width = c.height = s * 2;
  const h = c.getContext('2d');
  h.fillStyle = bg; h.fillRect(0, 0, s * 2, s * 2);
  h.fillStyle = color;
  // checker dither, like the DR maps
  const p = Math.max(1, Math.round(s / 3));
  for (let y = 0; y < s * 2; y += p) for (let x = (y / p) % 2 ? p : 0; x < s * 2; x += p * 2) h.fillRect(x, y, p, p);
  hatchCache.set(key, c);
  return g.createPattern(c, 'repeat');
}

/**
 * opts: { cell (px per grid cell), ox, oy (screen px of grid 0,0), view (cond state), editor (bool: show markers/grid/notes),
 *         theme, project, selection:Set, hover, discovered:Set|null, highlight:Set, labels:true, icons:true, onImage }
 */
export function drawMap(g, map, opts) {
  const { cell, ox, oy, theme: T, project } = opts;
  const baked = opts.baked ?? bakeMap(map, opts.view);
  const X = (x) => ox + x * cell;
  const Y = (y) => oy + y * cell;
  const lw = Math.max(1.5, cell * 0.12);
  const visible = (e) => !e.hidden && condActive(e.cond, opts.view);

  // Floors. Each room's squares are merged into a few big rectangles once per bake (a big map has tens of
  // thousands of squares; drawing them one by one every frame made editing laggy).
  const ownedSorted = [...baked.owned.entries()];
  const rectsOf = (el, cells) => {
    if (!baked._rects) baked._rects = new Map();
    let r = baked._rects.get(el);
    if (!r) { r = cellsToRects(cells); baked._rects.set(el, r); }
    return r;
  };
  const floorPath = (rects) => {
    const path = new Path2D();
    for (const r of rects) path.rect(X(r.x) - 0.5, Y(r.y) - 0.5, r.w * cell + 1, r.h * cell + 1);
    return path;
  };
  const undiscovered = (el) => opts.discovered && el.type === 'room' && el.kind === 'room' && !opts.discovered.has(el.id);
  // glow pass: draw the whole floor silhouette with a shadow
  if (T.glowSize > 0 && !opts.noGlow) {
    g.save();
    g.shadowColor = T.glow;
    g.shadowBlur = T.glowSize * Math.min(2, cell / 24) * (opts.glowScale ?? 1);
    g.fillStyle = T.hall;
    // one shape for the whole floor, blurred once
    const path = new Path2D();
    for (const [el, cells] of ownedSorted) for (const r of rectsOf(el, cells)) path.rect(X(r.x) - 0.5, Y(r.y) - 0.5, r.w * cell + 1, r.h * cell + 1);
    g.fill(path);
    g.restore();
  }
  for (const [el, cells] of ownedSorted) {
    const kind = el.type === 'stairs' ? 'stairs' : el.kind;
    let fill;
    if (kind === 'blocked' || undiscovered(el)) fill = hatchPattern(g, T.hatch, T.hatchBg, cell);
    else if (kind === 'room') fill = el.color || T.room;
    else if (kind === 'stairs') fill = T.stairs || T.hall;
    else fill = el.color || T.hall;
    g.fillStyle = fill;
    g.fill(floorPath(rectsOf(el, cells)));
  }

  // Background image / grid are drawn by the editor before this; grid lines on top of floors for the editor
  if (opts.grid) drawGrid(g, opts, T);

  // Stairs stripes
  for (const s of baked.stairs) {
    const r = s.rects[0];
    g.save();
    g.strokeStyle = T.stairsLine || T.line; g.lineWidth = Math.max(1, cell * (T.stairsLine ? 0.1 : 0.06));
    const steps = Math.max(3, Math.round((s.dir === 'n' || s.dir === 's' ? r.h : r.w) * 2.5));
    for (let i = 1; i < steps; i++) {
      g.beginPath();
      if (s.dir === 'n' || s.dir === 's') { const yy = Y(r.y + (r.h * i) / steps); g.moveTo(X(r.x), yy); g.lineTo(X(r.x + r.w), yy); }
      else { const xx = X(r.x + (r.w * i) / steps); g.moveTo(xx, Y(r.y)); g.lineTo(xx, Y(r.y + r.h)); }
      g.stroke();
    }
    // arrow showing which way is up
    const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    const ic = iconCanvas(s.goes === 'down' ? 'down' : 'up', T.icon, T.iconLight, 1);
    if (ic) {
      const sz = Math.min(r.w, r.h) * cell * 0.55;
      g.save();
      g.translate(X(c.x), Y(c.y));
      g.rotate({ n: 0, e: Math.PI / 2, s: Math.PI, w: -Math.PI / 2 }[s.dir] ?? 0);
      g.imageSmoothingEnabled = false;
      g.drawImage(ic, -sz / 2, -sz / 2, sz, sz);
      g.restore();
    }
    g.restore();
  }

  // Inner light line inside rooms (DR1 style double outline)
  if (T.inner && cell >= 10) {
    g.save();
    g.strokeStyle = T.inner; g.lineWidth = Math.max(1, lw * 0.45);
    for (const w of baked.walls) {
      for (const [side, el] of [[-1, w.a], [1, w.b]]) {
        if (!el || el.type !== 'room' || el.kind !== 'room') continue;
        const off = side * lw * 1.1;
        g.beginPath();
        if (w.o === 'h') { g.moveTo(X(w.x1) + lw, Y(w.y1) + off); g.lineTo(X(w.x2) - lw, Y(w.y2) + off); }
        else { g.moveTo(X(w.x1) + off, Y(w.y1) + lw); g.lineTo(X(w.x2) + off, Y(w.y2) - lw); }
        g.stroke();
      }
    }
    g.restore();
  }

  // Walls
  g.save();
  g.strokeStyle = T.line; g.lineWidth = lw; g.lineCap = 'square';
  g.beginPath();
  for (const w of baked.walls) { g.moveTo(X(w.x1), Y(w.y1)); g.lineTo(X(w.x2), Y(w.y2)); }
  g.stroke();
  g.restore();

  // Doors: little ticks at each end of the gap (DR style), plus a lock badge
  for (const d of baked.doors) {
    const sel = opts.selection?.has(d.id);
    if (T.doorMark) {
      // V3 style: a short coloured bar where the door is
      g.save(); g.strokeStyle = T.doorMark; g.lineWidth = Math.max(2, lw * 1.5); g.lineCap = 'butt';
      const inset = d.len * cell * 0.2;
      g.beginPath();
      if (d.orient === 'h') { g.moveTo(X(d.x) + inset, Y(d.y)); g.lineTo(X(d.x + d.len) - inset, Y(d.y)); }
      else { g.moveTo(X(d.x), Y(d.y) + inset); g.lineTo(X(d.x), Y(d.y + d.len) - inset); }
      g.stroke(); g.restore();
      continue;
    }
    g.save();
    g.strokeStyle = sel ? T.accent : T.line;
    g.lineWidth = Math.max(1.2, lw * 0.7);
    const t = cell * 0.22;
    const ends = d.orient === 'h'
      ? [[d.x, d.y], [d.x + d.len, d.y]]
      : [[d.x, d.y], [d.x, d.y + d.len]];
    g.beginPath();
    for (const [x, y] of ends) {
      if (d.orient === 'h') { g.moveTo(X(x), Y(y) - t); g.lineTo(X(x), Y(y) + t); }
      else { g.moveTo(X(x) - t, Y(y)); g.lineTo(X(x) + t, Y(y)); }
    }
    g.stroke();
    if (d.style === 'shutter' || d.lock === 'barred') {
      g.setLineDash([cell * 0.12, cell * 0.12]);
      g.beginPath(); g.moveTo(X(ends[0][0]), Y(ends[0][1])); g.lineTo(X(ends[1][0]), Y(ends[1][1])); g.stroke();
    }
    g.restore();
    const info = baked.doorInfo.get(d);
    if (opts.editor && info && info.inWall === 0) {
      // door not on a wall: draw it as a dashed red line so it's obvious
      g.save(); g.strokeStyle = '#ff2050'; g.setLineDash([4, 3]); g.lineWidth = 2;
      g.beginPath(); g.moveTo(X(ends[0][0]), Y(ends[0][1])); g.lineTo(X(ends[1][0]), Y(ends[1][1])); g.stroke(); g.restore();
    }
    if (lockedNow(d, opts.view) && cell >= 12) {
      const c = doorCenter(d);
      const ic = iconCanvas('lock', T.icon, T.iconLight, 1);
      const sz = cell * 0.5;
      g.imageSmoothingEnabled = false;
      g.drawImage(ic, X(c.x) - sz / 2, Y(c.y) - sz / 2, sz, sz * (ic.height / ic.width));
    }
    if (opts.editor && d.link?.mapId) linkBadge(g, X(doorCenter(d).x), Y(doorCenter(d).y), cell, T);
  }

  // Room icons, portraits and labels
  const fontPx = Math.max(7, Math.min(22, cell * 0.42));
  for (const el of baked.rooms) {
    if (el.kind === 'blocked' || undiscovered(el)) continue;
    const c = roomCenter(el);
    const b = el.rects.reduce((best, r) => (r.w * r.h > best.w * best.h ? r : best), el.rects[0]);
    const boxW = b.w * cell, boxH = b.h * cell;
    let iconDrawn = false;
    if (el.showIcon !== false && opts.icons !== false) {
      const sz = Math.min(boxW, boxH) * 0.62;
      const img = portraitFor(el, project, T, opts.onImage);
      if (img && sz > 6) {
        g.save();
        g.imageSmoothingEnabled = !T.pixel;
        const ar = (img.width || 1) / (img.height || 1);
        let w = sz, h = sz;
        if (ar > 1) h = sz / ar; else w = sz * ar;
        g.drawImage(img, X(c.x) - w / 2, Y(c.y) - h / 2 - (el.showLabel && el.name ? fontPx * 0.4 : 0), w, h);
        g.restore();
        iconDrawn = true;
      } else if (el.characterId && sz > 6) {
        const ch = project.characters.find((k) => k.id === el.characterId);
        if (ch) { initialsBadge(g, X(c.x), Y(c.y), sz * 0.8, ch, T); iconDrawn = true; }
      }
    }
    if (opts.labels !== false && el.showLabel && el.name && cell >= 8) {
      g.save();
      g.font = `${fontPx}px ${T.font}`;
      g.fillStyle = T.text; g.textAlign = 'center'; g.textBaseline = iconDrawn ? 'top' : 'middle';
      const ty = iconDrawn ? Y(c.y) + Math.min(boxW, boxH) * 0.28 : Y(c.y);
      fitText(g, el.name, X(c.x), ty, boxW - 6);
      g.restore();
    }
    if (lockedNow(el, opts.view)) {
      // locked at this point in the story: dim the room and put a padlock on it
      const cells = baked.owned.get(el);
      if (cells) {
        g.save(); g.fillStyle = 'rgba(0,0,0,.38)';
        const path = new Path2D();
        for (const q of rectsOf(el, cells)) path.rect(X(q.x), Y(q.y), q.w * cell, q.h * cell);
        g.fill(path); g.restore();
      }
      const ic = iconCanvas('lock', T.icon, T.iconLight, 1);
      const sz = Math.max(10, cell * 0.5);
      g.save(); g.imageSmoothingEnabled = false;
      g.drawImage(ic, X(b.x) + 4, Y(b.y) + 4, sz, sz * (ic.height / ic.width));
      g.restore();
    }
  }
  // Hall labels
  for (const el of baked.rooms) {
    if (el.kind === 'room' || el.kind === 'blocked' || !el.showLabel || !el.name || opts.labels === false) continue;
    const c = roomCenter(el);
    g.save(); g.font = `${fontPx * 0.9}px ${T.font}`; g.fillStyle = T.text; g.globalAlpha = 0.75;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(el.name, X(c.x), Y(c.y)); g.restore();
  }
  // chapter-locked stairs: dim + padlock
  for (const s of baked.stairs) {
    if (!lockedNow(s, opts.view)) continue;
    const r = s.rects[0];
    g.save(); g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(X(r.x), Y(r.y), r.w * cell, r.h * cell);
    const ic = iconCanvas('lock', T.icon, T.iconLight, 1); const sz = Math.max(10, cell * 0.6);
    g.imageSmoothingEnabled = false; g.drawImage(ic, X(r.x + r.w / 2) - sz / 2, Y(r.y + r.h / 2) - sz / 2, sz, sz * (ic.height / ic.width));
    g.restore();
  }
  for (const s of baked.stairs) {
    if (!s.showLabel || !s.name) continue;
    const r = s.rects[0];
    g.save(); g.font = `${fontPx * 0.85}px ${T.font}`; g.fillStyle = T.text; g.textAlign = 'center';
    g.fillText(s.name, X(r.x + r.w / 2), Y(r.y + r.h) + fontPx); g.restore();
  }
  if (opts.editor) for (const s of baked.stairs) if (s.link?.mapId) { const r = s.rects[0]; linkBadge(g, X(r.x + r.w) - cell * 0.3, Y(r.y) + cell * 0.3, cell, T); }

  // Labels
  for (const el of map.elements) {
    if (el.type !== 'label' || !visible(el) || opts.labels === false) continue;
    g.save();
    g.translate(X(el.x), Y(el.y));
    if (el.rot) g.rotate((el.rot * Math.PI) / 180);
    g.font = `${fontPx * (el.size || 1)}px ${T.font}`;
    g.fillStyle = el.color || T.text; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(el.text, 0, 0);
    g.restore();
  }

  // Markers
  for (const el of map.elements) {
    if (el.type !== 'marker' || !visible(el)) continue;
    if (!opts.editor && !opts.markersInStyle?.has(el.kind)) continue;
    drawMarker(g, el, X(el.x), Y(el.y), cell, T, project, opts);
  }
  return baked;
}

function fitText(g, text, x, y, maxW) {
  let t = text;
  if (g.measureText(t).width > maxW && maxW > 10) {
    while (t.length > 1 && g.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    t += '…';
  }
  g.fillText(t, x, y);
}

function linkBadge(g, x, y, cell, T) {
  const r = Math.max(5, cell * 0.22);
  g.save();
  g.fillStyle = T.accent; g.strokeStyle = '#fff'; g.lineWidth = 1.5;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.stroke();
  g.strokeStyle = '#fff'; g.lineWidth = Math.max(1, r * 0.25);
  g.beginPath(); g.moveTo(x - r * 0.45, y + r * 0.45); g.lineTo(x + r * 0.45, y - r * 0.45);
  g.moveTo(x - r * 0.05, y - r * 0.45); g.lineTo(x + r * 0.45, y - r * 0.45); g.lineTo(x + r * 0.45, y + r * 0.05);
  g.stroke();
  g.restore();
}

export function portraitFor(el, project, T, onImage) {
  if (el.asset) return assetImage(project, el.asset, onImage);
  if (el.characterId) {
    const ch = project.characters.find((c) => c.id === el.characterId);
    if (ch?.asset) return assetImage(project, ch.asset, onImage);
    return null;
  }
  if (el.icon?.startsWith('asset:')) return assetImage(project, el.icon.slice(6), onImage);
  if (el.icon) return iconCanvas(el.icon, T.icon, T.iconLight, 4);
  return null;
}

export function initialsBadge(g, x, y, size, ch, T) {
  g.save();
  g.fillStyle = ch.color || T.accent;
  g.strokeStyle = T.line; g.lineWidth = Math.max(1, size * 0.06);
  g.beginPath(); g.arc(x, y, size / 2, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = '#fff'; g.font = `bold ${Math.round(size * 0.42)}px ${T.font}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText((ch.initials || ch.name.slice(0, 2)).toUpperCase(), x, y + 1);
  g.restore();
}

export function drawMarker(g, el, x, y, cell, T, project, opts = {}) {
  const sel = opts.selection?.has(el.id);
  if (el.kind === 'trigger') {
    g.save();
    g.fillStyle = 'rgba(255,200,0,.18)'; g.strokeStyle = sel ? T.accent : '#e0a800'; g.setLineDash([5, 4]); g.lineWidth = 1.5;
    g.fillRect(x - (el.w * cell) / 2, y - (el.h * cell) / 2, el.w * cell, el.h * cell);
    g.strokeRect(x - (el.w * cell) / 2, y - (el.h * cell) / 2, el.w * cell, el.h * cell);
    g.restore();
  }
  if (el.kind === 'prop') {
    g.save();
    g.translate(x, y); g.rotate(((el.rot || 0) * Math.PI) / 180);
    g.fillStyle = el.color || 'rgba(120,90,80,.35)'; g.strokeStyle = sel ? T.accent : T.line; g.lineWidth = 1.2;
    g.fillRect((-el.w * cell) / 2, (-el.h * cell) / 2, el.w * cell, el.h * cell);
    g.strokeRect((-el.w * cell) / 2, (-el.h * cell) / 2, el.w * cell, el.h * cell);
    const ic = el.icon && !el.icon.startsWith('asset:') ? iconCanvas(el.icon, T.icon, T.iconLight, 1) : null;
    const img = el.asset ? assetImage(project, el.asset, opts.onImage) : ic;
    if (img) {
      const sz = Math.min(el.w, el.h) * cell * 0.7;
      g.imageSmoothingEnabled = !!el.asset;
      g.drawImage(img, -sz / 2, -sz / 2, sz, sz * ((img.height || 1) / (img.width || 1)));
    }
    g.restore();
    return;
  }
  if (el.kind === 'camera') {
    g.save(); g.translate(x, y); g.rotate(((el.rot || 0) * Math.PI) / 180);
    g.fillStyle = 'rgba(255,60,90,.12)';
    g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, cell * 4, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); g.closePath(); g.fill();
    g.restore();
  }
  const r = Math.max(6, cell * 0.34);
  if (el.kind === 'npc' || el.kind === 'fte') {
    const ch = project.characters.find((c) => c.id === el.characterId);
    const img = ch?.asset ? assetImage(project, ch.asset, opts.onImage) : null;
    if (img) {
      g.save();
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.clip();
      g.fillStyle = ch.color; g.fill();
      const s = r * 2.6;
      g.drawImage(img, x - s / 2, y - r * 1.0, s, s * (img.height / img.width));
      g.restore();
      g.save(); g.strokeStyle = sel ? T.accent : T.line; g.lineWidth = 2; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke(); g.restore();
    } else {
      initialsBadge(g, x, y, r * 2, ch || { name: el.name || '?', color: '#999' }, T);
    }
    if (el.kind === 'fte') { const ic = iconCanvas('heart', '#ff4a7a', '#fff', 1); g.drawImage(ic, x + r * 0.4, y - r * 1.3, r, r * 0.9); }
    facingTick(g, x, y, r, el.rot, T);
  } else {
    const info = MARKER_KINDS[el.kind];
    const colors = { spawn: '#33c46b', hotspot: '#ffb400', evidence: '#e8465a', light: '#ffd24a', camera: '#555', trigger: '#e0a800', portal: T.accent, note: '#ffe680', jump: '#ff2d8a' };
    g.save();
    g.fillStyle = el.color || colors[el.kind] || T.accent;
    g.strokeStyle = sel ? '#fff' : 'rgba(0,0,0,.6)'; g.lineWidth = sel ? 2.5 : 1.2;
    g.beginPath();
    if (el.kind === 'evidence') { g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath(); }
    else if (el.kind === 'note') g.rect(x - r, y - r, r * 2, r * 2);
    else g.arc(x, y, r, 0, Math.PI * 2);
    g.fill(); g.stroke();
    const ic = iconCanvas(el.kind === 'portal' && el.icon && !el.icon.startsWith('asset:') ? el.icon : info?.icon, '#fff', 'rgba(255,255,255,.5)', 1);
    if (ic) {
      g.imageSmoothingEnabled = false;
      const s = r * 1.15;
      g.translate(x, y);
      if (el.kind === 'portal') g.rotate(((el.rot || 0) * Math.PI) / 180 - Math.PI / 2 + Math.PI);
      g.drawImage(ic, -s / 2, (-s / 2) * (ic.height / ic.width), s, s * (ic.height / ic.width));
    }
    g.restore();
    if (el.kind === 'spawn') facingTick(g, x, y, r, el.rot, T);
    if (el.kind === 'portal' && opts.editor && el.link?.mapId) linkBadge(g, x + r, y - r, cell * 0.8, T);
    if (el.kind === 'evidence' && el.required) { g.save(); g.fillStyle = '#fff'; g.font = `bold ${r}px sans-serif`; g.textAlign = 'center'; g.fillText('!', x, y - r * 1.2); g.restore(); }
  }
  if (sel) {
    g.save(); g.strokeStyle = T.accent; g.lineWidth = 2; g.setLineDash([3, 3]);
    g.beginPath(); g.arc(x, y, r + 4, 0, Math.PI * 2); g.stroke(); g.restore();
  }
}

function facingTick(g, x, y, r, rot, T) {
  const a = ((rot || 0) * Math.PI) / 180;
  g.save(); g.translate(x, y); g.rotate(a);
  g.fillStyle = T.accent;
  g.beginPath(); g.moveTo(0, -r - 6); g.lineTo(-4, -r - 1); g.lineTo(4, -r - 1); g.closePath(); g.fill();
  g.restore();
}

function drawGrid(g, opts, T) {
  const { cell, ox, oy, width, height } = opts;
  if (cell < 5) return;
  g.save();
  g.strokeStyle = T.grid; g.lineWidth = 1;
  g.beginPath();
  const x0 = Math.floor(-ox / cell), x1 = Math.ceil((width - ox) / cell);
  const y0 = Math.floor(-oy / cell), y1 = Math.ceil((height - oy) / cell);
  for (let x = x0; x <= x1; x++) { const px = Math.round(ox + x * cell) + 0.5; g.moveTo(px, 0); g.lineTo(px, height); }
  for (let y = y0; y <= y1; y++) { const py = Math.round(oy + y * cell) + 0.5; g.moveTo(0, py); g.lineTo(width, py); }
  g.stroke();
  // every 5 cells a stronger line
  g.globalAlpha = 0.9; g.beginPath();
  for (let x = Math.ceil(x0 / 5) * 5; x <= x1; x += 5) { const px = Math.round(ox + x * cell) + 0.5; g.moveTo(px, 0); g.lineTo(px, height); }
  for (let y = Math.ceil(y0 / 5) * 5; y <= y1; y += 5) { const py = Math.round(oy + y * cell) + 0.5; g.moveTo(0, py); g.lineTo(width, py); }
  g.stroke();
  g.restore();
}
export { drawGrid };

/** Bounds of everything on a map, in grid units. */
export function mapBounds(map) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of map.elements) {
    const b = elementBounds(e);
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
  }
  if (!isFinite(x0)) return { x: 0, y: 0, w: 20, h: 14 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Render a whole map to a new canvas (PNG export / map screen). */
export function renderMapImage(map, project, theme, { pxPerCell = 24, margin = 2, view = null, transparent = false, labels = true, icons = true, discovered = null, markers = null, onImage } = {}) {
  const b = mapBounds(map);
  const c = document.createElement('canvas');
  c.width = Math.ceil((b.w + margin * 2) * pxPerCell);
  c.height = Math.ceil((b.h + margin * 2) * pxPerCell);
  const g = c.getContext('2d');
  if (!transparent) { g.fillStyle = theme.bg; g.fillRect(0, 0, c.width, c.height); }
  drawMap(g, map, {
    cell: pxPerCell, ox: (margin - b.x) * pxPerCell, oy: (margin - b.y) * pxPerCell, view, theme, project,
    labels, icons, discovered, editor: false, markersInStyle: markers, onImage,
  });
  return { canvas: c, bounds: b, margin };
}
