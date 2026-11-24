// Entry point: wires the top bar, menus, modes, keyboard and startup.
import { S, map, change, emit, on, undo, redo, loadProject, kvGet, autosaveNow, backupNow, selected } from './store.js';
import { h, $, $$, toast, contextMenu, confirmBox, ask } from './dom.js';
import { pasteData, copyLook, pasteLook, arrange, zoomActual } from './editor2d.js';
import { initEditor, fit, zoomTo, zoomBy, nudge, duplicateSelection, copySelection, pasteClipboard, deleteSelection, transformSelection, cancelPick, isPicking, mouseGrid, screenToGrid, pickAt, cloneElements, request } from './editor2d.js';
import { initUI, setTool, switchMap, setTab, TOOLS, floorName } from './ui.js';
import { init3D, startWalk, startBuilding, stop3D, buildingOpts, buildBuilding, resetCollected } from './view3d.js';
import { initScreen, renderScreen, screenMap } from './mapscreen.js';
import { saveProject, openProject, exportUnity, exportCSharp, exportGLB, importImages, importMapsFrom, forgetFileHandle, download } from './export.js';
import { helpDialog, dormDialog, linkGraph, backupsDialog, commandPalette, pngDialog, flagsDialog, pixelEditor, gotoElement } from './dialogs.js';
import { allThemes } from './themes.js';
import { newProject, elementBounds, elementTitle, findElement, newMarker, uid } from './model.js';
import { sampleProject } from './generators.js';
import { arrivalPoint, bakeMap } from './bake.js';
import { initHome, openHome, prepareLibrary, isHomeOpen } from './home.js';
import { styleEditor } from './styleEditor.js';
import { saveToLibrary } from './store.js';

// ---- boot ---------------------------------------------------------------------------
initEditor($('#editor'), $('#minimap'));
initUI();
init3D($('#view3d'), $('#hud3d'));
initScreen($('#screenView'));
wireTopBar();
wireKeyboard();
wireDrop();
wireEvents();
setMode('edit');
startup();

async function startup() {
  initHome($('#home'), () => { setMode('edit'); setTimeout(() => fit(), 30); refreshTop(); });
  try {
    await prepareLibrary();
  } catch (err) {
    console.error(err);
    toast('Could not read saved projects: ' + err.message, 'error');
  }
  await openHome();
  refreshTop();
}

async function goHome() {
  if (S.mode !== 'edit') setMode('edit');
  await openHome({ canGoBack: true });
}

// ---- modes --------------------------------------------------------------------------
function setMode(mode, at) {
  S.mode = mode;
  for (const c of [...document.body.classList]) if (c.startsWith('mode-')) document.body.classList.remove(c);
  document.body.classList.add('mode-' + mode);
  for (const b of $$('.modes button')) b.classList.toggle('on', b.dataset.mode === mode);
  if (mode === 'walk') { startWalk(at); setTimeout(() => $('#view3d canvas')?.focus(), 30); }
  else if (mode === 'building') { startBuilding(); renderBuildingBar(); }
  else stop3D();
  if (mode === 'screen') { screenMap(S.mapId); renderScreen(); }
  if (mode === 'edit') request();
}

function renderBuildingBar() {
  const bar = $('#buildingBar');
  const buildings = [...new Set(S.project.maps.map((m) => m.building).filter(Boolean))];
  const range = (k, min, max, step, label) => h('label', null, label, h('input', { type: 'range', min, max, step, value: buildingOpts[k], oninput: (e) => { buildingOpts[k] = +e.target.value; buildBuilding(); } }));
  const chk = (k, label) => h('label', null, h('input', { type: 'checkbox', checked: buildingOpts[k], onchange: (e) => { buildingOpts[k] = e.target.checked; buildBuilding(); } }), label);
  bar.replaceChildren(
    h('select', { onchange: (e) => { buildingOpts.building = e.target.value; buildingOpts.isolate = ''; buildBuilding(true); renderBuildingBar(); } }, h('option', { value: '' }, 'All buildings'), buildings.map((b) => h('option', { value: b, selected: buildingOpts.building === b }, b))),
    h('select', { onchange: (e) => { buildingOpts.isolate = e.target.value; buildBuilding(true); } }, h('option', { value: '' }, 'All floors'), S.project.maps.filter((m) => !buildingOpts.building || m.building === buildingOpts.building).map((m) => h('option', { value: m.id, selected: buildingOpts.isolate === m.id }, m.name))),
    range('explode', 1, 4, 0.1, 'Spread floors'), range('cutaway', 0.1, 1, 0.05, 'Wall height'),
    chk('links', 'Show links'), chk('ceilings', 'Roofs'),
  );
}

// ---- top bar --------------------------------------------------------------------------
function wireTopBar() {
  const name = $('#projName');
  name.addEventListener('change', () => change('Rename project', () => { S.project.name = name.value || 'Untitled'; }));
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });
  $('#homeBtn').onclick = goHome;
  $('#undoBtn').onclick = undo;
  $('#redoBtn').onclick = redo;
  for (const b of $$('.modes button')) b.onclick = () => setMode(b.dataset.mode, b.dataset.mode === 'walk' ? { mapId: S.mapId } : undefined);
  $('#chapterSel').onchange = (e) => { S.view.chapter = +e.target.value; emit('view'); };
  $('#timeSel').onchange = (e) => { S.view.time = +e.target.value; emit('view'); };
  $('#flagsBtn').onclick = flagsDialog;
  $('#themeSel').onchange = (e) => {
    if (e.target.value === '__edit') { e.target.value = S.project.settings.theme; styleEditor(); return; }
    change('Change style', () => { S.project.settings.theme = e.target.value; });
  };
  $('#helpBtn').onclick = helpDialog;
  $('#linkGraphBtn').onclick = () => linkGraph((id) => { setMode('edit'); switchMap(id); setTimeout(() => fit(), 20); });
  $('#snapChk').onchange = (e) => { S.snap = e.target.checked; };
  $('#thickBtn').onclick = (e) => {
    const kinds = [['hall', 'Corridors'], ['outdoor', 'Outdoor areas'], ['room', 'Rooms'], ['blocked', 'Blocked areas'], ['stairs', 'Stairs']];
    const toggle = (k) => {
      if (S.keepThick.has(k)) S.keepThick.delete(k); else S.keepThick.add(k);
      localStorage.setItem('tvf-keep-thick', JSON.stringify([...S.keepThick]));
      toast(`${kinds.find((x) => x[0] === k)[1]} will ${S.keepThick.has(k) ? 'keep their width' : 'stretch'} when you scale`);
    };
    const r = e.target.getBoundingClientRect();
    contextMenu(r.left, r.top - 190, kinds.map(([k, l]) => ({ label: (S.keepThick.has(k) ? '☑ ' : '☐ ') + l + ' keep their width', action: () => toggle(k) })));
  };
  $('#gridChk').onchange = (e) => { S.showGrid = e.target.checked; request(); };
  for (const m of $$('.menu')) {
    m.querySelector('button').addEventListener('click', (e) => { e.stopPropagation(); openMenu(m); });
    m.addEventListener('mouseenter', () => { if (document.querySelector('.dropdown')) openMenu(m); });
  }
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.menu')) closeMenus(); });
}

const MENUS = {
  file: () => [
    ['🏠 All projects…', goHome],
    ['📄 New project', newProjectCmd],
    ['📂 Open…', openProject, 'Ctrl+O'],
    ['💾 Save (browser + projects folder)', () => saveProject(false), 'Ctrl+S'],
    ['⤓ Download a copy (.tvfmap.json)', () => saveProject(true), 'Ctrl+Shift+S'],
    '-',
    ['⤵ Import maps from another project…', importMapsCmd],
    ['🖼 Import images…', async () => { const { pickFile } = await import('./export.js'); await importImages(await pickFile('image/*')); setTab('images'); }],
    '-',
    ['🏫 Load the sample school', async () => { if (await confirmBox('Load sample', 'Replace the open project with the sample school? (Your current project stays in Browser backups.)', 'Load sample')) { await backupNow('before loading sample'); forgetFileHandle(); loadProject(sampleProject()); setTimeout(fit, 30); } }],
    ['🛟 Browser backups…', backupsDialog],
  ],
  edit: () => [
    ['↶ Undo', undo, 'Ctrl+Z'], ['↷ Redo', redo, 'Ctrl+Y'], '-',
    ['✂ Cut', () => copySelection(true), 'Ctrl+X'], ['⧉ Copy', () => copySelection(), 'Ctrl+C'], ['📋 Paste', () => pasteClipboard(false), 'Ctrl+V'],
    ['📋 Paste in place', () => pasteClipboard(true), 'Ctrl+Shift+V'],
    ['🎨 Copy look', copyLook, 'Ctrl+Alt+C'], ['🎨 Paste look', pasteLook, 'Ctrl+Alt+V'],
    ['⧉ Duplicate', () => duplicateSelection(), 'Ctrl+D'], ['🗑 Delete', deleteSelection, 'Del'], '-',
    ['Select all', selectAll, 'Ctrl+A'], ['✏️ Rename', renameSelection, 'Ctrl+R'],
    ['⬆ Bring to front', () => arrange(2), 'Ctrl+Shift+]'], ['⬇ Send to back', () => arrange(-2), 'Ctrl+Shift+['],
    ['👁 Hide / show', () => toggleOnSelection('hidden', 'Hide / show'), 'Ctrl+Shift+H'], ['🔒 Lock / unlock', () => toggleOnSelection('lockedEdit', 'Lock / unlock'), 'Ctrl+Shift+L'],
    ['⬆ Move up a layer', () => arrange(1), ']'], ['⬇ Move down a layer', () => arrange(-1), '['],
    ['⟳ Rotate right', () => transformSelection(1), '.'], ['⟲ Rotate left', () => transformSelection(-1), ','],
    ['⇋ Flip horizontally', () => transformSelection('h'), 'Shift+H'], ['⇵ Flip vertically', () => transformSelection('v'), 'Shift+V'], '-',
    ['🔎 Search & commands…', palette, 'Ctrl+/'],
  ],
  tools: () => [
    ['🎨 Style editor…', () => styleEditor()],
    ['🛏 Generate dorm rooms…', dormDialog],
    ['✎ Draw a pixel icon…', () => pixelEditor(null)],
    ['★ Save selection as prefab', savePrefab],
    ['⇄ Show map links…', () => $('#linkGraphBtn').click()],
    ['✅ Check for problems', () => setTab('issues')],
    '-',
    ['🔁 Reset collected evidence (walk mode)', () => { resetCollected(); toast('Evidence reset'); }],
  ],
  export: () => [
    ['🎮 For Unity (.json)', () => { exportUnity(); toast('Exported. In Unity, use the importer from the unity folder (Map Maker › Import Map…).'); }],
    ['#️⃣ C# ids (MapIds.cs)', exportCSharp],
    ['📖 Unity format spec', () => window.open('docs/UNITY-FORMAT.md', '_blank')],
    '-',
    ['🖼 Map image (PNG)…', pngDialog],
    ['🧊 3D model of this map (.glb)', () => exportGLB('map')],
    ['🏢 3D model of every map (.glb)', () => exportGLB('all')],
    '-',
    ['⤓ Download project file (.tvfmap.json)', () => saveProject(true)],
    ['📦 Project without images', () => { const { assets, ...rest } = S.project; download(S.project.name + '.noimages.tvfmap.json', JSON.stringify({ ...rest, assets: {} }, null, 1)); }],
  ],
};
function openMenu(m) {
  closeMenus();
  const items = MENUS[m.dataset.menu]();
  const dd = h('div', { class: 'dropdown' }, items.map((it) => (it === '-' ? h('hr') : h('button', { onclick: () => { closeMenus(); it[1](); } }, it[0], it[2] ? h('kbd', null, it[2]) : null))));
  m.append(dd);
}
function closeMenus() { $$('.dropdown').forEach((d) => d.remove()); }

function refreshTop() {
  const p = S.project;
  if (document.activeElement !== $('#projName')) $('#projName').value = p.name;
  const ch = $('#chapterSel');
  ch.replaceChildren(h('option', { value: -1 }, 'All chapters'), ...p.chapters.map((c, i) => h('option', { value: i }, c)));
  ch.value = String(S.view.chapter);
  const tm = $('#timeSel');
  tm.replaceChildren(h('option', { value: -1 }, 'Any time'), ...p.times.map((c, i) => h('option', { value: i }, c)));
  tm.value = String(S.view.time);
  $('#flagsBtn').classList.toggle('on', S.view.useFlags);
  const th = $('#themeSel');
  th.replaceChildren(...allThemes(p).map((t) => h('option', { value: t.id }, t.name)), h('option', { value: '__edit' }, '🎨 Make / edit styles…'));
  th.value = p.settings.theme;
  $('#dirtyDot').classList.toggle('on', S.dirty);
  document.title = (S.dirty ? '• ' : '') + p.name + ' — Fangan Map Maker';
  renderCrumbs();
}

function renderCrumbs() {
  const m = map();
  $('#crumbs').replaceChildren(...[
    S.navStack.length ? h('button', { title: 'Back (Alt+←)', onclick: goBack }, '← ' + (S.project.maps.find((x) => x.id === S.navStack.at(-1))?.name ?? 'Back')) : null,
    h('span', { class: 'path' }, (m.building ? m.building + ' › ' : '') + m.name + ' (' + floorName(m.floor) + ')'),
  ].filter(Boolean));
}
function goBack() {
  const id = S.navStack.pop();
  if (id && S.project.maps.find((m) => m.id === id)) switchMap(id, { push: false });
  renderCrumbs();
}

// ---- commands ----------------------------------------------------------------------------
async function newProjectCmd() {
  const name = await ask('New project', 'Project name (the one you have open stays in All projects)', 'My fangan');
  if (name === null) return;
  await autosaveNow({ thumbs: true, touch: false });
  forgetFileHandle();
  const p = newProject(name.trim() || 'Untitled project');
  await saveToLibrary(p, { thumbs: true, opened: true });
  loadProject(p);
  setTimeout(fit, 30);
}
async function importMapsCmd() {
  const other = await importMapsFrom();
  if (!other) return;
  const ids = new Set(S.project.maps.map((m) => m.id));
  change('Import maps', () => {
    for (const m of other.maps) {
      const c = JSON.parse(JSON.stringify(m));
      if (ids.has(c.id)) c.id = uid('map');
      S.project.maps.push(c);
    }
    Object.assign(S.project.assets, other.assets);
    for (const c of other.characters) if (!S.project.characters.find((x) => x.id === c.id)) S.project.characters.push(c);
    for (const f of other.flags) if (!S.project.flags.find((x) => x.id === f.id)) S.project.flags.push(f);
    for (const e of other.evidence) if (!S.project.evidence.find((x) => x.id === e.id)) S.project.evidence.push(e);
  });
  toast(`Imported ${other.maps.length} map(s) from “${other.name}”`);
}
function selectAll() {
  S.selection = new Set(map().elements.filter((e) => !e.hidden).map((e) => e.id));
  emit('selection');
}
async function savePrefab() {
  const els = selected();
  if (!els.length) return toast('Select some things first (box-select with the Select tool).', 'error');
  const name = await ask('Save prefab', 'Name for this reusable piece', els.length === 1 ? elementTitle(els[0], S.project) : 'Prefab');
  if (!name) return;
  let x0 = Infinity, y0 = Infinity;
  for (const e of els) { const b = elementBounds(e); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); }
  const shifted = cloneElements(els, -Math.floor(x0), -Math.floor(y0));
  for (const e of shifted) if (e.link) e.link = { mapId: '', targetId: '' };
  change('Save prefab', () => S.project.prefabs.push({ id: uid('pf'), name, elements: shifted }));
  toast(`Saved prefab “${name}”. Place it from Project › Prefabs.`);
}
function placePrefab(pf) {
  setMode('edit');
  const g = mouseGrid();
  const at = g.inside ? { x: Math.floor(g.x), y: Math.floor(g.y) } : { x: 0, y: 0 };
  const copies = cloneElements(pf.elements, at.x, at.y);
  change('Place ' + pf.name, () => map().elements.push(...copies));
  S.selection = new Set(copies.map((c) => c.id)); emit('selection');
  zoomTo(copies.reduce((b, e) => { const eb = elementBounds(e); return { x: Math.min(b.x, eb.x), y: Math.min(b.y, eb.y), w: Math.max(b.w, eb.x + eb.w - Math.min(b.x, eb.x)), h: Math.max(b.h, eb.y + eb.h - Math.min(b.y, eb.y)) }; }, { x: Infinity, y: Infinity, w: 0, h: 0 }));
}
function followLink(el) {
  const l = el.link;
  if (!l?.mapId) return;
  const tm = S.project.maps.find((m) => m.id === l.mapId);
  if (!tm) return toast('That link points at a deleted map.', 'error');
  setMode('edit');
  switchMap(tm.id);
  const t = l.targetId ? tm.elements.find((e) => e.id === l.targetId) : null;
  if (t) { S.selection = new Set([t.id]); emit('selection'); zoomTo(elementBounds(t)); }
  else setTimeout(() => fit(), 10);
  toast('→ ' + tm.name + (t ? ' › ' + elementTitle(t, S.project) : ''));
  renderCrumbs();
}
function palette() {
  const actions = [
    ...TOOLS.map((t) => ({ label: 'Tool: ' + t.label, run: () => setTool(t.id) })),
    { label: 'Walk in 3D', run: () => setMode('walk', { mapId: S.mapId }) },
    { label: 'Building view', run: () => setMode('building') },
    { label: 'Map screen preview', run: () => setMode('screen') },
    { label: 'Export for Unity', run: exportUnity },
    { label: 'Export PNG…', run: pngDialog },
    { label: 'Generate dorm rooms…', run: dormDialog },
    { label: 'Draw a pixel icon…', run: () => pixelEditor(null) },
    { label: 'Save project', run: () => saveProject() },
    { label: 'Fit map to view', run: () => fit() },
  ];
  commandPalette(actions, (mapId, elId) => { setMode('edit'); gotoElement(mapId, elId, switchMap); if (!elId) setTimeout(fit, 10); });
}

// ---- keyboard -------------------------------------------------------------------------------
function typing(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
function wireKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (isHomeOpen()) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (ctrl && k === 's') { e.preventDefault(); saveProject(e.shiftKey); return; }
    if (ctrl && k === 'o') { e.preventDefault(); openProject(); return; }
    if (ctrl && k === 'k') { e.preventDefault(); palette(); return; }
    if (typing(e) || document.querySelector('.modal-back')) return;
    if (e.key === 'Tab' && S.mode === 'screen' && String(S.project.settings.mapScreenStyle).startsWith('v3')) return; // map screen uses Tab to switch lists
    if (e.key === 'Tab') {
      e.preventDefault();
      if (S.mode === 'edit') { const g = mouseGrid(); setMode('walk', g.inside ? { mapId: S.mapId, x: g.x, y: g.y, face: 0 } : { mapId: S.mapId }); }
      else { const pp = S.playerPos; setMode('edit'); if (pp && S.mode === 'edit' && pp.mapId !== S.mapId) switchMap(pp.mapId); }
      return;
    }
    if (S.mode === 'walk') { if (e.key === 'Escape' && !document.pointerLockElement) setMode('edit'); return; }
    if (S.mode !== 'edit') {
      if (e.key === 'Escape') setMode('edit');
      if (k === 'b' && S.mode === 'building') setMode('edit');
      return;
    }
    // ---- Figma-style shortcuts ----
    const code = e.code;
    if (ctrl) {
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
      else if (e.altKey && k === 'c') { e.preventDefault(); copyLook(); }
      else if (e.altKey && k === 'v') { e.preventDefault(); pasteLook(); }
      else if (k === 'v') { pasteInPlace = e.shiftKey; /* the paste event below does the work */ }
      else if (k === 'c' || k === 'x') { /* handled by the copy / cut events below */ }
      else if (k === 'd') { e.preventDefault(); duplicateSelection(); }
      else if (k === 'a') { e.preventDefault(); selectAll(); }
      else if (k === 'r') { e.preventDefault(); renameSelection(); }
      else if (k === '/') { e.preventDefault(); palette(); }
      else if (code === 'BracketRight') { e.preventDefault(); arrange(e.shiftKey ? 2 : 1); }
      else if (code === 'BracketLeft') { e.preventDefault(); arrange(e.shiftKey ? -2 : -1); }
      else if (e.shiftKey && k === 'h') { e.preventDefault(); toggleOnSelection('hidden', 'Hide / show'); }
      else if (e.shiftKey && k === 'l') { e.preventDefault(); toggleOnSelection('lockedEdit', 'Lock / unlock'); }
      else if (k === '=' || k === '+') { e.preventDefault(); zoomBy(1.25); }
      else if (k === '-') { e.preventDefault(); zoomBy(0.8); }
      else if (k === '0') { e.preventDefault(); zoomActual(); }
      return;
    }
    if (e.shiftKey && code === 'Digit1') { e.preventDefault(); fit(); return; }
    if (e.shiftKey && code === 'Digit2') { e.preventDefault(); zoomToSelection(); return; }
    if (e.shiftKey && code === 'Digit0') { e.preventDefault(); zoomActual(); return; }
    if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); goBack(); return; }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key]) { e.preventDefault(); const [dx, dy] = arrows[e.key]; nudge(dx * (e.shiftKey ? 5 : 1), dy * (e.shiftKey ? 5 : 1)); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
    if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); renameSelection(); return; }
    if (e.key === 'Escape') { if (!cancelPick()) { S.selection.clear(); emit('selection'); S.toolLock = false; setTool('select'); } return; }
    if (e.key === '?' || e.key === 'F1') { e.preventDefault(); helpDialog(); return; }
    if (e.key === '[') { arrange(-1); return; }   // move down a layer
    if (e.key === ']') { arrange(1); return; }    // move up a layer
    if (e.key === ',') { transformSelection(-1); return; } // rotate left
    if (e.key === '.') { transformSelection(1); return; }  // rotate right
    if (k === 'e' || k === 'v') { S.toolLock = false; setTool('select'); return; }
    if (e.key === '+' || e.key === '=') { zoomBy(1.25); return; }
    if (e.key === '-') { zoomBy(0.8); return; }
    if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); stepFloor(e.key === 'PageUp' ? 1 : -1); return; }
    if (e.shiftKey && k === 'h') { transformSelection('h'); return; }
    if (e.shiftKey && k === 'v') { transformSelection('v'); return; }
    if (e.shiftKey && k === 'f') { zoomToSelection(); return; }
    if (e.shiftKey) {
      // Shift + tool key: keep that tool on until Shift is let go (Shift+X = keep drawing blocked areas)
      const tool = TOOLS.find((t) => t.key.toLowerCase() === k);
      if (tool && tool.id !== 'select' && tool.id !== 'pan' && !e.repeat) { S.toolLock = true; S.shiftLock = true; S.shiftLockCode = e.code; setTool(tool.id); }
      return;
    }
    if (k === 'f') { fit(); return; }
    if (k === 'g') { S.showGrid = !S.showGrid; $('#gridChk').checked = S.showGrid; request(); return; }
    if (k === 'b') { setMode('building'); return; }
    const tool = TOOLS.find((t) => t.key.toLowerCase() === k);
    if (tool) { S.toolLock = false; setTool(tool.id); }
  });

  const releaseShiftLock = () => {
    if (!S.shiftLock) return;
    S.shiftLock = false; S.toolLock = false;
    setTool('select');
  };
  // the tool stays on only while BOTH Shift and the tool key are held
  window.addEventListener('keyup', (e) => { if (e.key === 'Shift' || e.code === S.shiftLockCode) releaseShiftLock(); });
  window.addEventListener('blur', releaseShiftLock);

  // Copy / cut / paste through the browser's own clipboard events: works in Firefox without permission prompts,
  // and lets you paste between tabs and windows.
  const editingCanvas = (e) => S.mode === 'edit' && !isHomeOpen() && !typing(e) && !document.querySelector('.modal-back');
  document.addEventListener('copy', (e) => {
    if (!editingCanvas(e) || !S.selection.size) return;
    const text = copySelection(false, true);
    if (text) { e.clipboardData.setData('text/plain', text); e.preventDefault(); }
  });
  document.addEventListener('cut', (e) => {
    if (!editingCanvas(e) || !S.selection.size) return;
    const text = copySelection(true, true);
    if (text) { e.clipboardData.setData('text/plain', text); e.preventDefault(); }
  });
  document.addEventListener('paste', async (e) => {
    if (!editingCanvas(e)) return;
    const inPlace = pasteInPlace; pasteInPlace = false;
    const text = e.clipboardData?.getData('text/plain') || '';
    if (text.includes('"tvf-map-clip"')) { e.preventDefault(); try { pasteData(JSON.parse(text), inPlace); } catch { pasteData(S.clipboard, inPlace); } return; }
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      e.preventDefault();
      const ids = await importImages(files);
      toast(`Pasted ${ids.length} image${ids.length > 1 ? 's' : ''} into your Images`);
      setTab('images');
      return;
    }
    if (S.clipboard) { e.preventDefault(); pasteData(S.clipboard, inPlace); }
  });
}
let pasteInPlace = false;

function zoomToSelection() {
  const s = selected();
  if (!s.length) return;
  zoomTo(s.map(elementBounds).reduce((a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x), h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y) })));
}
function renameSelection() {
  const s = selected();
  if (s.length !== 1) return;
  emit('focus-field', s[0].type === 'label' ? 'text' : 'name');
}
function toggleOnSelection(key, label) {
  const els = selected();
  if (!els.length) return;
  const to = !els.every((e) => e[key]);
  change(label, () => { for (const e of els) e[key] = to; });
}
function stepFloor(dir) {
  const m = map();
  const same = S.project.maps.filter((x) => x.building === m.building).sort((a, b) => (a.floor ?? 0) - (b.floor ?? 0));
  const i = same.indexOf(m);
  const next = same[i + dir];
  if (next) { switchMap(next.id); toast(next.name); }
}

// ---- drag & drop images -------------------------------------------------------------------------
function wireDrop() {
  const stage = $('#stage');
  const hint = $('#dropHint');
  let depth = 0;
  stage.addEventListener('dragenter', (e) => { if ([...e.dataTransfer.types].includes('Files') || [...e.dataTransfer.types].includes('text/tvf-asset')) { depth++; hint.classList.add('show'); } });
  stage.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) hint.classList.remove('show'); });
  stage.addEventListener('dragover', (e) => e.preventDefault());
  stage.addEventListener('drop', async (e) => {
    e.preventDefault(); depth = 0; hint.classList.remove('show');
    if (S.mode !== 'edit') { await importImages([...e.dataTransfer.files]); setTab('images'); return; }
    let id = e.dataTransfer.getData('text/tvf-asset');
    if (!id) {
      const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
      if (!files.length) {
        const json = [...e.dataTransfer.files].find((f) => f.name.endsWith('.json'));
        if (json) { try { loadProject(JSON.parse(await json.text()), json.name); toast('Opened ' + json.name); } catch (err) { toast('Could not open: ' + err.message, 'error'); } }
        return;
      }
      const ids = await importImages(files);
      if (ids.length > 1) { toast(`Added ${ids.length} images to your library`); setTab('images'); return; }
      id = ids[0];
    }
    if (!id) return;
    const g = screenToGrid(e.clientX, e.clientY);
    const target = pickAt(g.x, g.y);
    if (target && (target.type === 'room' || (target.type === 'marker' && ['prop', 'portal'].includes(target.kind)))) {
      change('Set image', () => { const el = findElement(S.project, target.id).el; el.asset = id; el.icon = ''; });
      toast(`Image set on ${elementTitle(target, S.project)}`);
    } else if (target?.type === 'marker' && (target.kind === 'npc' || target.kind === 'fte') && target.characterId) {
      change('Set portrait', () => { S.project.characters.find((c) => c.id === target.characterId).asset = id; });
      toast('Portrait set');
    } else {
      const p = newMarker('prop', Math.round(g.x * 2) / 2, Math.round(g.y * 2) / 2);
      p.asset = id; p.icon = ''; p.name = S.project.assets[id]?.name ?? 'Prop';
      change('Add image prop', () => map().elements.push(p));
      S.selection = new Set([p.id]); emit('selection');
    }
  });
}

// ---- events ------------------------------------------------------------------------------------
function wireEvents() {
  on('change', refreshTop);
  on('project', () => { refreshTop(); setTimeout(fit, 20); });
  on('map', () => { renderCrumbs(); if (S.mode === 'screen') { screenMap(S.mapId); renderScreen(); } });
  on('view', () => { refreshTop(); if (S.mode === 'screen') renderScreen(); if (S.mode === 'building') buildBuilding(); });
  on('saved', refreshTop);
  on('toast', (t) => toast(t.text, t.kind));
  on('autosaved', (t) => { $('#stSaved').textContent = 'Autosaved ' + new Date(t).toLocaleTimeString(); });
  on('cursor', (g) => {
    const cs = S.project.settings.cellSize;
    $('#stCursor').textContent = `x ${g.x.toFixed(1)}  y ${g.y.toFixed(1)}  (${(g.x * cs).toFixed(1)} m, ${(g.y * cs).toFixed(1)} m)`;
  });
  on('selection', () => { const n = S.selection.size; $('#stSel').textContent = n ? n + ' selected' : ''; });
  on('zoom', (c) => { $('#stZoom').textContent = Math.round((c / 28) * 100) + '%'; });
  on('follow-link', followLink);
  on('goto', ({ mapId, elId }) => { setMode('edit'); gotoElement(mapId, elId, switchMap); });
  on('walk-at', (at) => setMode('walk', at));
  on('place-prefab', placePrefab);
  on('backups', backupsDialog);
  on('cmd', (c) => { if (c === 'duplicate') duplicateSelection(); else if (c === 'delete') deleteSelection(); else if (c === 'prefab') savePrefab(); else if (c === 'rotL') transformSelection(-1); else if (c === 'rotR') transformSelection(1); else if (c === 'flipH') transformSelection('h'); else if (c === 'flipV') transformSelection('v'); });
  on('save-version', async () => {
    const name = await ask('Save version', 'Name this version', 'Version ' + (S.project.versions.length + 1));
    if (!name) return;
    const { assets, versions, ...rest } = S.project;
    change('Save version', () => S.project.versions.push({ name, at: Date.now(), json: JSON.stringify(rest) }));
    toast('Saved version “' + name + '”');
  });
  on('restore-version', async (i) => {
    const v = S.project.versions[i];
    if (!(await confirmBox('Restore version', `Go back to “${v.name}”? Your current state is backed up first, and this can be undone.`, 'Restore'))) return;
    const data = JSON.parse(v.json);
    change('Restore version ' + v.name, () => {
      const versions = S.project.versions, assets = S.project.assets;
      Object.assign(S.project, data, { versions, assets });
    });
    if (!S.project.maps.find((m) => m.id === S.mapId)) switchMap(S.project.maps[0].id, { push: false });
    emit('project');
  });
  on('walk-map', (id) => { if (S.mapId !== id) { S.mapId = id; S.selection.clear(); emit('map'); } });

  // editor right-click menu
  on('context', ({ x, y, sx, sy, el }) => {
    if (el && !S.selection.has(el.id)) { S.selection = new Set([el.id]); emit('selection'); }
    contextMenu(sx, sy, [
      el?.link?.mapId ? { label: '➜ Follow link to ' + (S.project.maps.find((m) => m.id === el.link.mapId)?.name ?? '?'), action: () => followLink(el) } : null,
      { label: '🚶 Walk from here', action: () => setMode('walk', { mapId: S.mapId, x, y, face: 0 }) },
      el ? { label: '✏️ Edit', action: () => setTab('inspect') } : null,
      el ? { label: '⧉ Duplicate', key: 'Ctrl+D', action: () => duplicateSelection() } : null,
      el ? { label: '⟳ Rotate', key: ']', action: () => transformSelection(1) } : null,
      el ? { label: '⬆ Bring to front', action: () => change('Bring to front', () => { const m = map(); const e = m.elements.find((q) => q.id === el.id); m.elements = m.elements.filter((q) => q !== e); m.elements.push(e); }) } : null,
      el ? { label: '⬇ Send to back', action: () => change('Send to back', () => { const m = map(); const e = m.elements.find((q) => q.id === el.id); m.elements = m.elements.filter((q) => q !== e); m.elements.unshift(e); }) } : null,
      el ? { label: '★ Save as prefab', action: savePrefab } : null,
      { label: '📋 Paste here', key: 'Ctrl+V', action: pasteClipboard },
      { label: '📍 Add character here', action: () => { S.markerKind = 'npc'; const mk = newMarker('npc', Math.round(x * 2) / 2, Math.round(y * 2) / 2); const used = new Set(map().elements.filter((q) => q.kind === 'npc').map((q) => q.characterId)); const c = S.project.characters.find((q) => !used.has(q.id)) ?? S.project.characters[0]; if (c) { mk.characterId = c.id; mk.name = c.name; } change('Add character', () => map().elements.push(mk)); S.selection = new Set([mk.id]); emit('selection'); } },
      el ? '-' : null,
      el ? { label: '🗑 Delete', key: 'Del', action: deleteSelection } : null,
    ]);
  });
  window.addEventListener('beforeunload', () => { autosaveNow(); });
  void arrivalPoint; void bakeMap; void isPicking;
}
