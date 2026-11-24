// Dialogs: pixel icon editor, help, dorm generator, link graph, backups, command palette, PNG export, flags.
import { S, map, change, emit, kvGet, loadProject } from './store.js';
import { h, modal, toast, select } from './dom.js';
import { uid, elementTitle, elementBounds, findElement, MARKER_KINDS } from './model.js';
import { dormRow } from './generators.js';
import { exportPNG } from './export.js';
import { zoomTo, mouseGrid } from './editor2d.js';

// ---- Pixel icon editor ---------------------------------------------------------------------
export function pixelEditor(assetId, onSaved) {
  const existing = assetId ? S.project.assets[assetId] : null;
  let size = existing?.grid?.size ?? 16;
  let grid = existing?.grid?.cells ? [...existing.grid.cells] : new Array(size * size).fill('');
  let color = '#3b2420';
  let tool = 'pen';
  let mirror = false;
  const palette = ['#3b2420', '#ffffff', '#f4a3a0', '#e8465a', '#ffcf4a', '#33c46b', '#2aa8ff', '#7a4cff', '#000000', '#888888'];
  const name = h('input', { value: existing?.name ?? 'My icon' });
  const gridEl = h('div', { class: 'pix-grid' });
  const preview = h('canvas', { width: 64, height: 64, style: { imageRendering: 'pixelated', width: '64px', height: '64px', background: '#f4e8ea', borderRadius: '4px' } });
  let painting = false;
  const paint = (i) => {
    const set = (j) => {
      if (tool === 'fill') return;
      grid[j] = tool === 'erase' ? '' : color;
    };
    if (tool === 'fill') {
      const target = grid[i], rep = color;
      if (target === rep) return;
      const st = [i];
      while (st.length) { const k = st.pop(); if (grid[k] !== target) continue; grid[k] = rep; const x = k % size, y = Math.floor(k / size); if (x > 0) st.push(k - 1); if (x < size - 1) st.push(k + 1); if (y > 0) st.push(k - size); if (y < size - 1) st.push(k + size); }
    } else {
      set(i);
      if (mirror) { const x = i % size, y = Math.floor(i / size); set(y * size + (size - 1 - x)); }
    }
    draw();
  };
  const draw = () => {
    gridEl.style.gridTemplateColumns = `repeat(${size}, ${Math.floor(352 / size)}px)`;
    if (gridEl.children.length !== size * size) {
      gridEl.replaceChildren(...grid.map((_, i) => {
        const d = h('div', { style: { width: Math.floor(352 / size) + 'px', height: Math.floor(352 / size) + 'px' } });
        d.addEventListener('pointerdown', (e) => { painting = true; if (e.button === 2) { const t = tool; tool = 'erase'; paint(i); tool = t; } else paint(i); });
        d.addEventListener('pointerenter', (e) => { if (painting && e.buttons) paint(i); });
        d.addEventListener('contextmenu', (e) => e.preventDefault());
        return d;
      }));
    }
    grid.forEach((c, i) => { gridEl.children[i].style.background = c || ''; });
    const g = preview.getContext('2d');
    preview.width = size; preview.height = size;
    g.clearRect(0, 0, size, size);
    grid.forEach((c, i) => { if (c) { g.fillStyle = c; g.fillRect(i % size, Math.floor(i / size), 1, 1); } });
  };
  window.addEventListener('pointerup', () => { painting = false; });
  const colorInp = h('input', { type: 'color', value: color, oninput: (e) => { color = e.target.value; } });
  const toolBtns = h('div', { class: 'btnrow' }, [['pen', '✎ Pen'], ['erase', '⌫ Eraser'], ['fill', '◪ Fill']].map(([t, l]) => h('button', { class: 'mini' + (tool === t ? ' on' : ''), onclick: (e) => { tool = t; [...e.target.parentElement.children].forEach((b) => b.classList.remove('on')); e.target.classList.add('on'); } }, l)));
  const body = h('div', { style: { display: 'flex', gap: '16px', flexWrap: 'wrap' } },
    gridEl,
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '180px' } },
      h('label', null, 'Name', name),
      h('label', null, 'Size ', select([['8', '8×8'], ['12', '12×12'], ['16', '16×16'], ['24', '24×24'], ['32', '32×32']], String(size), (v) => {
        const n = +v; const ng = new Array(n * n).fill('');
        for (let y = 0; y < Math.min(n, size); y++) for (let x = 0; x < Math.min(n, size); x++) ng[y * n + x] = grid[y * size + x];
        size = n; grid = ng; gridEl.replaceChildren(); draw();
      })),
      toolBtns,
      h('div', { class: 'chips' }, palette.map((c) => h('span', { class: 'chip', style: { background: c, width: '22px', height: '22px', padding: 0 }, onclick: () => { color = c; colorInp.value = c; if (tool === 'erase') tool = 'pen'; } })), colorInp),
      h('label', { class: 'tiny' }, h('input', { type: 'checkbox', onchange: (e) => { mirror = e.target.checked; } }), 'Mirror left/right'),
      h('div', { class: 'btnrow' }, h('button', { class: 'mini', onclick: () => { grid.fill(''); draw(); } }, 'Clear')),
      h('div', { class: 'hint' }, 'Right-click erases. Preview:'), preview));
  draw();
  modal(existing ? 'Edit pixel icon' : 'Draw a pixel icon', body, [
    { label: 'Cancel' },
    { label: 'Save icon', primary: true, onclick: () => {
      const data = preview.toDataURL('image/png');
      const id = assetId || uid('img');
      S.project.assets[id] = { name: name.value || 'Icon', data, pixel: true, grid: { size, cells: grid }, addedAt: existing?.addedAt ?? Date.now() };
      S.dirty = true;
      emit('assets'); emit('change', {});
      toast('Icon saved to your images');
      onSaved?.(id);
    } },
  ], { wide: true });
}

// ---- Help ---------------------------------------------------------------------------------------
export function helpDialog() {
  const keys = [
    ['Select / Hand (pan)', 'E (or V) / H'], ['Room / Corridor', 'R / C'], ['Outdoor / Blocked', 'O / X'], ['Door / Stairs', 'D / S'],
    ['Marker / Label / Erase', 'M / T / Q'], ['Move up / down a layer', '] / ['], ['Keep a tool after use', 'Double-click it'],
    ['Undo / Redo', 'Ctrl+Z / Ctrl+Shift+Z'], ['Copy / Cut / Paste', 'Ctrl+C / X / V'], ['Paste in place', 'Ctrl+Shift+V'], ['Duplicate (repeats your last step)', 'Ctrl+D'],
    ['Copy look / Paste look', 'Ctrl+Alt+C / V'], ['Duplicate while dragging', 'Alt+drag'], ['Delete', 'Del / Backspace'], ['Rename', 'Enter / Ctrl+R'],
    ['Select all', 'Ctrl+A'], ['Nudge (×5 with Shift)', 'Arrows'], ['Bring forward / to front', 'Ctrl+] / Ctrl+Shift+]'], ['Send back / to back', 'Ctrl+[ / Ctrl+Shift+['],
    ['Hide / Lock', 'Ctrl+Shift+H / L'], ['Rotate 90° / Flip', ', . / Shift+H, Shift+V'],
    ['Pan', 'Scroll, Space+drag, H'], ['Zoom', 'Ctrl+scroll, pinch, Ctrl + / -'], ['Zoom to fit / selection / 100%', 'Shift+1 / Shift+2 / Shift+0'], ['Grid / free move', 'G / hold Alt'],
    ['Previous / next floor', 'PgUp / PgDn'], ['Back (after following a link)', 'Alt+←'], ['Walk in 3D from the cursor', 'Tab'], ['Building view', 'B'],
    ['Search & commands', 'Ctrl+/ or Ctrl+K'], ['Save / Open', 'Ctrl+S / Ctrl+O'], ['Cancel / deselect', 'Esc'], ['This help', '?'],
  ];
  modal('Shortcuts & tips', h('div', null,
    h('div', { class: 'keys' }, keys.map(([a, k]) => h('div', null, h('span', null, a), h('kbd', null, k)))),
    h('h4', null, 'Tips'),
    h('ul', { class: 'hint', style: { fontSize: '12px' } },
      h('li', null, 'Rooms are made from grid cells. Shift+drag with a room selected adds an L-shape; Alt+drag cuts a hole.'),
      h('li', null, 'Hallways join each other automatically. Rooms get walls; click a wall with the Door tool to get in.'),
      h('li', null, 'To connect two maps: select stairs, a door or an Exit marker, then “Link to another map” › Pick on map. Links are two-way.'),
      h('li', null, 'Use the chapter / time pickers at the top to see the map as it is at that point in the story. Set “When does it exist?” on anything.'),
      h('li', null, 'Everything autosaves in this browser. Use File › Save to keep a .tvfmap.json file to share with your team.'),
      h('li', null, 'Export › For Unity writes a .json the TVF importer (TVF › Map Maker › Import Map…) turns into a level.'))), [], { wide: true });
}

// ---- Dorm generator -------------------------------------------------------------------------------
export function dormDialog() {
  const g = mouseGrid();
  const o = { x: Math.floor(g.x) || 0, y: Math.floor(g.y) || 0, count: S.project.characters.length, roomW: 3, roomH: 5, hallH: 3, sides: 'both', makeHall: true, assign: true, namePrefix: 'Dorm' };
  const num = (k, label, min = 1) => h('div', { class: 'row' }, h('label', null, label), (() => { const i = h('input', { type: 'number', value: o[k], min }); i.oninput = () => { o[k] = +i.value; }; return i; })());
  modal('Generate a row of dorm rooms', h('div', null,
    h('p', { class: 'hint' }, 'Makes rooms with doors along a hallway. Rooms can be given to characters so their portraits show on the map and door nameplates.'),
    num('count', 'How many'), num('roomW', 'Room width'), num('roomH', 'Room depth'), num('hallH', 'Hall width'),
    num('x', 'Start x', -999), num('y', 'Start y', -999),
    h('div', { class: 'row' }, h('label', null, 'Rooms on'), select([['both', 'Both sides'], ['top', 'North side'], ['bottom', 'South side']], o.sides, (v) => { o.sides = v; })),
    h('div', { class: 'row' }, h('label', null, ''), h('label', { class: 'tiny' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { o.makeHall = e.target.checked; } }), 'Also make the hallway')),
    h('div', { class: 'row' }, h('label', null, ''), h('label', { class: 'tiny' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => { o.assign = e.target.checked; } }), 'Give rooms to characters, in order')),
  ), [
    { label: 'Cancel' },
    { label: 'Generate', primary: true, onclick: () => {
      const els = dormRow({ ...o, characters: o.assign ? S.project.characters.map((c) => c.id) : [], charNames: Object.fromEntries(S.project.characters.map((c) => [c.id, c.name])) });
      change('Generate dorms', () => map().elements.push(...els));
      S.selection = new Set(els.map((e) => e.id)); emit('selection');
      toast(`Made ${els.filter((e) => e.type === 'room' && e.kind === 'room').length} rooms`);
    } },
  ]);
}

// ---- Link graph ----------------------------------------------------------------------------------------
export function linkGraph(onOpen) {
  const cv = h('canvas', { class: 'graph-canvas' });
  const m = modal('How your maps connect', h('div', null, h('p', { class: 'hint' }, 'Each box is a map; lines are links (stairs, doors, exits). Click a map to open it.'), cv), [], { wide: true });
  const nodes = [];
  requestAnimationFrame(() => {
    const r = cv.getBoundingClientRect();
    cv.width = r.width * devicePixelRatio; cv.height = r.height * devicePixelRatio;
    const g = cv.getContext('2d');
    g.scale(devicePixelRatio, devicePixelRatio);
    const buildings = [...new Set(S.project.maps.map((x) => x.building || '—'))];
    const colW = r.width / buildings.length;
    for (const [bi, b] of buildings.entries()) {
      const maps = S.project.maps.filter((x) => (x.building || '—') === b).sort((a, c) => (c.floor ?? 0) - (a.floor ?? 0));
      const rowH = Math.min(90, (r.height - 60) / Math.max(1, maps.length));
      maps.forEach((mp, i) => nodes.push({ m: mp, x: colW * bi + colW / 2, y: 50 + rowH * i + rowH / 2, w: Math.min(colW - 30, 170), h: Math.min(46, rowH - 14) }));
      g.fillStyle = '#a796ad'; g.font = 'bold 12px system-ui'; g.textAlign = 'center'; g.fillText(b.toUpperCase(), colW * bi + colW / 2, 24);
    }
    const byId = new Map(nodes.map((n) => [n.m.id, n]));
    const pairs = new Map();
    for (const n of nodes) for (const e of n.m.elements) {
      if (!e.link?.mapId || !byId.has(e.link.mapId)) continue;
      const key = [n.m.id, e.link.mapId].sort().join('|');
      const p = pairs.get(key) || { a: n, b: byId.get(e.link.mapId), labels: [] };
      p.labels.push(elementTitle(e, S.project));
      pairs.set(key, p);
    }
    g.strokeStyle = '#ff3d7f'; g.lineWidth = 2;
    for (const p of pairs.values()) {
      g.beginPath();
      if (p.a === p.b) { g.arc(p.a.x + p.a.w / 2, p.a.y, 16, -Math.PI / 2, Math.PI / 2); }
      else { g.moveTo(p.a.x, p.a.y); g.bezierCurveTo(p.a.x + 40, p.a.y, p.b.x - 40, p.b.y, p.b.x, p.b.y); }
      g.stroke();
      const mx = (p.a.x + p.b.x) / 2 + (p.a === p.b ? p.a.w / 2 + 20 : 0), my = (p.a.y + p.b.y) / 2;
      g.fillStyle = '#fff'; g.font = '11px system-ui'; g.textAlign = 'center';
      g.fillText([...new Set(p.labels)].slice(0, 2).join(', ') + (p.labels.length > 2 ? '…' : ''), mx, my - 4);
    }
    for (const n of nodes) {
      g.fillStyle = n.m.id === S.mapId ? '#ff3d7f' : '#2a2130'; g.strokeStyle = '#ff3d7f';
      g.fillRect(n.x - n.w / 2, n.y - n.h / 2, n.w, n.h); g.strokeRect(n.x - n.w / 2, n.y - n.h / 2, n.w, n.h);
      g.fillStyle = '#fff'; g.font = 'bold 13px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(n.m.name + (S.project.startMapId === n.m.id ? ' ★' : ''), n.x, n.y);
    }
  });
  cv.addEventListener('click', (e) => {
    const r = cv.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const n = nodes.find((k) => Math.abs(x - k.x) < k.w / 2 && Math.abs(y - k.y) < k.h / 2);
    if (n) { m.close(); onOpen(n.m.id); }
  });
}

// ---- Backups -----------------------------------------------------------------------------------------------
export async function backupsDialog() {
  const list = (await kvGet('backups')) || [];
  const auto = await kvGet('autosave');
  const restore = (json, label) => { try { loadProject(JSON.parse(json)); toast('Restored ' + label); } catch (e) { toast('Could not restore: ' + e.message, 'error'); } };
  modal('Browser backups', h('div', null,
    h('p', { class: 'hint' }, 'The Map Maker autosaves a second after every change and keeps a backup every 5 minutes, in this browser only. Restoring replaces what is open now (you can undo by restoring the autosave again).'),
    auto ? h('div', { class: 'list-item' }, h('span', { style: { flex: 1 } }, '⏱ Latest autosave — ' + new Date(auto.savedAt).toLocaleString())) : null,
    list.length ? list.map((b) => h('div', { class: 'list-item' }, h('span', { style: { flex: 1 } }, `${b.name} — ${new Date(b.savedAt).toLocaleString()} (${Math.round(b.json.length / 1024)} KB)`), h('button', { class: 'mini', onclick: () => restore(b.json, b.name) }, 'Restore'))) : h('p', { class: 'hint' }, 'No backups yet.'),
  ), []);
}

// ---- Command palette ---------------------------------------------------------------------------------------
export function commandPalette(actions, onGoto) {
  document.querySelector('.palette')?.remove();
  const input = h('input', { placeholder: 'Jump to a room, character, map… or type a command' });
  const res = h('div', { class: 'res' });
  const box = h('div', { class: 'palette' }, input, res);
  document.body.append(box);
  input.focus();
  let items = [], idx = 0;
  const all = [];
  for (const a of actions) all.push({ k: 'Action', label: a.label, run: a.run });
  for (const m of S.project.maps) {
    all.push({ k: 'Map', label: m.name + (m.building ? ' · ' + m.building : ''), run: () => onGoto(m.id, null) });
    for (const e of m.elements) {
      if (e.type === 'door' && !e.name) continue;
      if (e.type === 'room' && !e.name) continue;
      all.push({ k: e.type === 'marker' ? MARKER_KINDS[e.kind]?.label.split(' ')[0] : e.type, label: elementTitle(e, S.project) + '  —  ' + m.name, run: () => onGoto(m.id, e.id) });
    }
  }
  const renderRes = () => {
    const q = input.value.toLowerCase().trim();
    const words = q.split(/\s+/).filter(Boolean);
    items = all.filter((it) => words.every((w) => (it.label + ' ' + it.k).toLowerCase().includes(w))).slice(0, 60);
    idx = Math.min(idx, Math.max(0, items.length - 1));
    res.replaceChildren(...items.map((it, i) => h('div', { class: 'it' + (i === idx ? ' on' : ''), onmousedown: (e) => { e.preventDefault(); close(); it.run(); } }, h('span', { class: 'k' }, it.k), it.label)));
  };
  const close = () => box.remove();
  input.addEventListener('input', () => { idx = 0; renderRes(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') { idx = Math.min(items.length - 1, idx + 1); renderRes(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { idx = Math.max(0, idx - 1); renderRes(); e.preventDefault(); }
    else if (e.key === 'Enter' && items[idx]) { close(); items[idx].run(); }
  });
  input.addEventListener('blur', () => setTimeout(close, 100));
  renderRes();
}

// ---- PNG export options -------------------------------------------------------------------------------------
export function pngDialog() {
  const o = { scale: 24, transparent: false, labels: true, icons: true, which: 'current', state: 'current' };
  const chk = (k, l) => h('label', { class: 'tiny' }, h('input', { type: 'checkbox', checked: o[k], onchange: (e) => { o[k] = e.target.checked; } }), l);
  modal('Export map image (PNG)', h('div', null,
    h('p', { class: 'hint' }, 'A clean picture of the map in its style, for the in-game map screen, a wiki or your design doc.'),
    h('div', { class: 'row' }, h('label', null, 'Maps'), select([['current', 'This map'], ['all', 'Every map (one file each)']], o.which, (v) => { o.which = v; })),
    h('div', { class: 'row' }, h('label', null, 'Pixels / cell'), (() => { const i = h('input', { type: 'number', value: o.scale, min: 4, max: 128 }); i.oninput = () => { o.scale = +i.value; }; return i; })()),
    h('div', { class: 'row' }, h('label', null, 'Story state'), select([['current', 'As shown now (chapter/time picker)'], ['all', 'Everything']], o.state, (v) => { o.state = v; })),
    h('div', { class: 'row' }, h('label', null, ''), h('div', null, chk('labels', 'Names'), chk('icons', 'Icons'), chk('transparent', 'Transparent background'))),
  ), [
    { label: 'Cancel' },
    { label: 'Export', primary: true, onclick: () => {
      const maps = o.which === 'all' ? S.project.maps : [map()];
      maps.forEach((m, i) => setTimeout(() => exportPNG(m, { scale: o.scale, transparent: o.transparent, labels: o.labels, icons: o.icons, view: o.state === 'all' ? null : S.view }), i * 300));
    } },
  ]);
}

// ---- Story flags popover ----------------------------------------------------------------------------------------
export function flagsDialog() {
  const body = h('div', null,
    h('p', { class: 'hint' }, 'Tick the flags that are “on” to preview the map in that story state. Things with “Only if flag” / “Unless flag” appear or disappear.'),
    h('label', { class: 'tiny' }, h('input', { type: 'checkbox', checked: S.view.useFlags, onchange: (e) => { S.view.useFlags = e.target.checked; emit('view'); } }), 'Test flags (off = ignore flag conditions)'),
    S.project.flags.length ? S.project.flags.map((f) => h('div', null, h('label', { class: 'tiny' }, h('input', { type: 'checkbox', checked: S.view.flags.has(f.id), onchange: (e) => { if (e.target.checked) S.view.flags.add(f.id); else S.view.flags.delete(f.id); S.view.useFlags = true; emit('view'); } }), f.name, f.desc ? h('span', { class: 'hint' }, ' — ' + f.desc) : null))) : h('p', { class: 'hint' }, 'No flags yet. Add them in Project › Story flags.'));
  modal('Story flags', body, []);
}

export function gotoElement(mapId, elId, switchMap) {
  if (mapId !== S.mapId) switchMap(mapId);
  if (elId) {
    const f = findElement(S.project, elId);
    if (f) { S.selection = new Set([elId]); emit('selection'); zoomTo(elementBounds(f.el)); }
  }
}
