// Side panels: maps, tools, outliner, inspector, project settings, image library, issues, history.
import { S, map, change, emit, on, selected, history, undoTo } from './store.js';
import { h, select, toast, ask, confirmBox, $, modal } from './dom.js';
import {
  ROOM_KINDS, MARKER_KINDS, TRIGGER_TYPES, DOOR_STYLES, LOCK_STATES, LIGHTING, newMap, uid, elementBounds, elementTitle,
  condSummary, newMarker, newStairs, findElement, emptyCond,
} from './model.js';
import { ICON_NAMES, iconCanvas } from './icons.js';
import { allThemes, THEMES, THEME_KEYS, getTheme } from './themes.js';
import { zoomTo, startPick, request, fit, cloneElements } from './editor2d.js';
import { importImages, pickFile } from './export.js';
import { validate } from './validate.js';
import { pixelEditor } from './dialogs.js';
import { checklistPanel } from './checklist.js';

export const TOOLS = [
  { id: 'select', icon: '⬚', label: 'Select', key: 'E', hint: 'Click to select, drag to move, drag empty space to box-select. Shift-click adds. Alt-drag copies. Double-click a linked door/stairs to follow it.' },
  { id: 'pan', icon: '✋', label: 'Hand', key: 'H', hint: 'Drag to move around the map (or hold Space with any tool).' },
  { id: 'room', icon: '■', label: 'Room', key: 'R', hint: 'Drag to draw a room. Shift+drag adds to the selected room (L-shapes). Alt+drag cuts a hole.' },
  { id: 'hall', icon: '▭', label: 'Corridor', key: 'C', hint: 'Drag to draw hallway. Hallways join up with no walls between them.' },
  { id: 'outdoor', icon: '❀', label: 'Outdoor', key: 'O', hint: 'Drag to draw an outdoor area (no ceiling).' },
  { id: 'blocked', icon: '▩', label: 'Blocked', key: 'X', hint: 'Drag to draw a solid, hatched area (pillars, unexplored space).' },
  { id: 'door', icon: '🚪', label: 'Door', key: 'D', hint: 'Click a wall to add a door. Drag along the wall for a wider door.' },
  { id: 'stairs', icon: '☰', label: 'Stairs', key: 'S', hint: 'Drag to draw stairs, then link them to another floor in the inspector.' },
  { id: 'connect', icon: '🔗', label: 'Connect', key: 'L', hint: 'Click a door, stairs or spot, then click where it leads (on any map or area — switch on the left). Links both ways. Click empty floor to make an exit there.' },
  { id: 'marker', icon: '📍', label: 'Marker', key: 'M', hint: 'Click to place the marker type chosen below (characters, evidence, props, lights, triggers…).' },
  { id: 'label', icon: 'T', label: 'Label', key: 'T', hint: 'Click to add a text label.' },
  { id: 'erase', icon: '⌫', label: 'Erase', key: 'Q', hint: 'Click or drag over things to delete them.' },
];

export function setTool(id) {
  S.tool = id;
  emit('tool');
}

// ---------------------------------------------------------------------------------
export function initUI() {
  renderTools();
  renderMaps();
  renderOutliner();
  renderTab();
  on('change', () => { renderMaps(); renderOutliner(); renderTab(); scheduleIssues(); });
  on('project', () => { renderMaps(); renderOutliner(); renderTab(); scheduleIssues(); });
  on('map', () => { renderMaps(); renderOutliner(); renderTab(); });
  on('selection', () => { renderOutliner(); if (curTab === 'inspect' || curTab === 'images') renderTab(); });
  on('view', () => { renderOutliner(); renderTab(); });
  on('tool', renderTools);
  on('assets', () => { if (curTab === 'images' || curTab === 'inspect' || curTab === 'project') renderTab(); });
  on('focus-field', (k) => { setTab('inspect'); setTimeout(() => { const f = document.querySelector(`#tabBody [data-key="${k}"]`); f?.focus(); f?.select?.(); }, 20); });
  document.getElementById('rightTabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setTab(b.dataset.tab); });
  $('#addMapBtn').onclick = addMap;
  $('#addAreaBtn').onclick = () => newArea();
  on('change', renderAreas); on('map', renderAreas); on('project', renderAreas); on('selection', renderAreas);
  renderAreas();
  $('#outlineSearch').addEventListener('input', renderOutliner);
  $('#outlineAll').addEventListener('change', renderOutliner);
  scheduleIssues();
}

export function switchMap(id, { push = true } = {}) {
  if (id === S.mapId) return;
  if (push) S.navStack.push(S.mapId);
  if (S.navStack.length > 30) S.navStack.shift();
  S.mapId = id;
  S.areaFilter = null;
  S.selection.clear();
  emit('map');
  emit('selection');
}

// ---- Tools ----------------------------------------------------------------------------
function renderTools() {
  const box = $('#tools');
  box.replaceChildren(...TOOLS.map((t) => h('button', {
    class: S.tool === t.id ? 'on' : '',
    title: `${t.label} (${t.key}) — ${t.hint}\nDouble-click to keep this tool after each use.`,
    onclick: () => { S.toolLock = false; setTool(t.id); },
    ondblclick: () => { if (t.id === 'select' || t.id === 'pan') return; S.toolLock = true; setTool(t.id); },
  }, t.icon, h('small', null, t.label), h('kbd', null, S.tool === t.id && S.toolLock ? (S.shiftLock ? '⇧' : '🔒') : t.key))));
  const mk = $('#markerKinds');
  mk.classList.toggle('show', S.tool === 'marker');
  if (S.tool === 'marker') {
    mk.replaceChildren(...Object.entries(MARKER_KINDS).map(([k, info]) => {
      const ic = iconCanvas(info.icon, '#ffffff', 'rgba(255,255,255,.4)', 2);
      return h('button', { class: S.markerKind === k ? 'on' : '', title: info.help, onclick: () => { S.markerKind = k; renderTools(); emit('tool'); } }, ic ? h('img', { src: ic.toDataURL() }) : null, info.label);
    }));
  }
  const t = TOOLS.find((x) => x.id === S.tool);
  $('#stTool').textContent = t ? t.label + ': ' + t.hint : '';
}

// ---- Maps -------------------------------------------------------------------------------
function renderMaps() {
  const box = $('#mapList');
  const groups = new Map();
  for (const m of S.project.maps) {
    const b = m.building || '—';
    if (!groups.has(b)) groups.set(b, []);
    groups.get(b).push(m);
  }
  const kids = [];
  for (const [b, maps] of groups) {
    if (groups.size > 1 || b !== '—') kids.push(h('div', { class: 'map-group' }, b));
    maps.sort((a, c) => (c.floor ?? 0) - (a.floor ?? 0));
    for (const m of maps) {
      const linkCount = m.elements.filter((e) => e.link?.mapId).length;
      kids.push(h('div', {
        class: 'map-item' + (m.id === S.mapId ? ' on' : ''), title: `${m.name} — ${m.elements.length} objects, ${linkCount} links. Double-click to rename, right-click for more.`,
        onclick: () => switchMap(m.id), ondblclick: () => renameMap(m),
        oncontextmenu: (e) => { e.preventDefault(); mapMenu(m, e.clientX, e.clientY); },
      },
      h('span', { class: 'fl', title: m.isArea ? 'Area' : 'Floor' }, m.isArea ? '◧' : floorName(m.floor)), h('span', { class: 'nm' }, m.name),
      S.project.startMapId === m.id ? h('span', { class: 'star', title: 'Start map' }, '★') : null,
      linkCount ? h('span', { class: 'fl', title: linkCount + ' links' }, '⇄' + linkCount) : null));
    }
  }
  box.replaceChildren(...kids);
}
export const floorName = (f) => (f == null ? '' : f < 0 ? 'B' + -f : f === 0 ? 'G' : f + 'F');

async function addMap() {
  const cur = map();
  const name = await ask('New map', 'Name (e.g. "2F", "Gymnasium", "Courtyard")', floorName((cur.floor ?? 1) + 1));
  if (!name) return;
  const m = newMap(name, (cur.floor ?? 1) + 1);
  m.building = cur.building;
  m.elevation = (cur.elevation || 0) + S.project.settings.floorGap;
  change('Add map ' + name, () => S.project.maps.push(m));
  switchMap(m.id);
}
async function renameMap(m) {
  const n = await ask('Rename map', 'New name', m.name);
  if (n) change('Rename map', () => { S.project.maps.find((x) => x.id === m.id).name = n; });
}
async function mapMenu(m, x, y) {
  const { contextMenu } = await import('./dom.js');
  contextMenu(x, y, [
    { label: '✏️ Rename', action: () => renameMap(m) },
    { label: '★ Set as start map', action: () => change('Set start map', () => { S.project.startMapId = m.id; }) },
    { label: '⧉ Duplicate map', action: () => duplicateMap(m) },
    { label: '🚶 Walk this map', action: () => emit('walk-at', { mapId: m.id }) },
    '-',
    { label: '🗑 Delete map', action: () => deleteMap(m) },
  ]);
}
function duplicateMap(m) {
  const c = JSON.parse(JSON.stringify(m));
  c.id = uid('map'); c.name = m.name + ' copy';
  const fresh = cloneElements(m.elements, 0, 0);
  c.elements = fresh;
  change('Duplicate map', () => S.project.maps.push(c));
  switchMap(c.id);
}
async function deleteMap(m) {
  if (S.project.maps.length === 1) return toast('A project needs at least one map.', 'error');
  if (!(await confirmBox('Delete map', `Delete “${m.name}” and its ${m.elements.length} objects? You can undo this.`, 'Delete', true))) return;
  change('Delete map ' + m.name, () => {
    S.project.maps = S.project.maps.filter((x) => x.id !== m.id);
    if (S.project.startMapId === m.id) S.project.startMapId = S.project.maps[0].id;
  });
  if (S.mapId === m.id) switchMap(S.project.maps[0].id, { push: false });
  S.navStack = S.navStack.filter((id) => id !== m.id);
}

// ---- Areas: named parts of a map (a separate wing, a courtyard…) ------------------------------------
export function setAreaFilter(id) {
  S.areaFilter = id;
  S.selection.clear();
  emit('selection'); emit('view');
  renderAreas();
}
function renderAreas() {
  const m = map();
  const box = $('#areaList');
  if (!box) return;
  const areas = m.areas || [];
  const count = (id) => m.elements.filter((e) => (e.area || '') === id).length;
  const item = (id, name, n, title) => h('div', {
    class: 'map-item' + (S.areaFilter === id ? ' on' : ''), title,
    onclick: () => setAreaFilter(S.areaFilter === id ? null : id),
    ondblclick: () => id && renameArea(id),
    oncontextmenu: (e) => { e.preventDefault(); if (id) areaMenu(id, e.clientX, e.clientY); },
  }, h('span', { class: 'fl' }, id === null ? '▦' : '◧'), h('span', { class: 'nm' }, name), n != null ? h('span', { class: 'fl' }, n) : null);
  const kids = [item(null, 'Whole map', null, 'Show everything on this map')];
  if (areas.length) kids.push(item('', 'Not in an area', count(''), 'Things that are not in any area'));
  for (const a of areas) kids.push(item(a.id, a.name, count(a.id), 'Click to show only this area. Double-click to rename, right-click for more.'));
  if (!areas.length) kids.push(h('div', { class: 'hint' }, 'Select part of the map, then ＋ to make it its own area (e.g. a separate wing). Each area gets its own page on the map screen.'));
  box.replaceChildren(...kids);
}
/**
 * New area = its own workspace in this project (like a floor). If things are selected they MOVE into it,
 * keeping their positions and their links. It sits in the same building and on the same floor.
 */
async function newArea() {
  const sel = selected();
  const cur = map();
  const name = await ask('New area', sel.length
    ? `Name for the new area. The ${sel.length} selected thing${sel.length > 1 ? 's' : ''} will move into it as its own workspace.`
    : 'Name for the new area (an empty workspace in this project)', 'Area ' + (S.project.maps.filter((m) => m.isArea).length + 1));
  if (!name) return;
  const m = newMap(name, cur.floor);
  m.building = cur.building; m.elevation = cur.elevation; m.ox = cur.ox; m.oy = cur.oy; m.theme = cur.theme; m.isArea = true;
  const ids = new Set(sel.map((e) => e.id));
  change('New area ' + name, () => {
    S.project.maps.push(m);
    const src = S.project.maps.find((x) => x.id === cur.id);
    m.elements = src.elements.filter((e) => ids.has(e.id));
    src.elements = src.elements.filter((e) => !ids.has(e.id));
    // links pointing at moved things now point at the new area
    for (const mp of S.project.maps) for (const e of mp.elements) if (e.link?.mapId === cur.id && ids.has(e.link.targetId)) e.link = { ...e.link, mapId: m.id };
  });
  switchMap(m.id);
  setTimeout(() => fit(), 20);
  toast(ids.size ? `Moved ${ids.size} thing${ids.size > 1 ? 's' : ''} into the new area “${name}”. Use the Connect tool (L) to link it to ${cur.name}.` : `Made the area “${name}”.`);
}
async function renameArea(id) {
  const a = map().areas.find((x) => x.id === id);
  const n = await ask('Rename area', 'New name', a.name);
  if (n) change('Rename area', () => { map().areas.find((x) => x.id === id).name = n; });
}
async function areaMenu(id, x, y) {
  const { contextMenu } = await import('./dom.js');
  contextMenu(x, y, [
    { label: '✏️ Rename', action: () => renameArea(id) },
    { label: '⬚ Select everything in it', action: () => { S.selection = new Set(map().elements.filter((e) => e.area === id).map((e) => e.id)); emit('selection'); } },
    { label: '＋ Add the selection to it', action: () => { const ids = new Set(selected().map((e) => e.id)); change('Add to area', () => { for (const e of map().elements) if (ids.has(e.id)) e.area = id; }); } },
    '-',
    { label: '🗑 Delete area (keeps its rooms)', action: () => { change('Delete area', () => { const m = map(); m.areas = m.areas.filter((a) => a.id !== id); for (const e of m.elements) if (e.area === id) e.area = ''; }); if (S.areaFilter === id) setAreaFilter(null); } },
  ]);
}

// ---- Outliner -----------------------------------------------------------------------------
const TYPE_LABEL = { room: 'Room', door: 'Door', stairs: 'Stairs', marker: 'Marker', label: 'Label' };
function renderOutliner() {
  const q = $('#outlineSearch').value.trim().toLowerCase();
  const all = $('#outlineAll').checked || q.length > 0 && $('#outlineAll').checked;
  const maps = all ? S.project.maps : [map()];
  const rows = [];
  for (const m of maps) {
    const items = m.elements.filter((e) => {
      if (!q) return e.type !== 'door' || !!e.name || !!e.link?.mapId;
      return (elementTitle(e, S.project) + ' ' + (e.tags || '') + ' ' + (e.kind || '') + ' ' + e.type + ' ' + (e.text || '')).toLowerCase().includes(q);
    });
    if (!items.length) continue;
    if (all) rows.push(h('div', { class: 'ol-head' }, m.name));
    const order = { room: 0, stairs: 1, door: 2, marker: 3, label: 4 };
    items.sort((a, b) => order[a.type] - order[b.type] || elementTitle(a, S.project).localeCompare(elementTitle(b, S.project)));
    for (const e of items.slice(0, 400)) {
      const t = e.type === 'room' ? ROOM_KINDS[e.kind]?.label : e.type === 'marker' ? MARKER_KINDS[e.kind]?.label.split(' ')[0] : TYPE_LABEL[e.type];
      const cs = condSummary(e.cond, S.project);
      rows.push(h('div', {
        class: 'ol-item' + (S.selection.has(e.id) && m.id === S.mapId ? ' on' : ''), title: cs ? 'Only: ' + cs : '',
        onclick: (ev) => {
          if (m.id !== S.mapId) switchMap(m.id);
          if (!ev.shiftKey) S.selection.clear();
          S.selection.add(e.id);
          emit('selection');
          zoomTo(elementBounds(e));
        },
      },
      h('span', { class: 't' }, t), h('span', { class: 'n' }, elementTitle(e, S.project)),
      cs ? h('span', { class: 'm' }, '⏱') : null,
      e.link?.mapId ? h('span', { class: 'm' }, '⇄') : null,
      h('span', { class: 'eye', title: e.hidden ? 'Turned off — click to turn on' : 'Turn off (hide everywhere)', onclick: (ev) => { ev.stopPropagation(); change(e.hidden ? 'Show' : 'Hide', () => { findElement(S.project, e.id).el.hidden = !e.hidden; }); } }, e.hidden ? '◌' : '●')));
    }
  }
  $('#outliner').replaceChildren(...(rows.length ? rows : [h('div', { class: 'hint' }, q ? 'Nothing matches.' : 'Draw a room with the Room tool (R) to get started.')]));
}

// ---- Right tabs -------------------------------------------------------------------------------
let curTab = 'inspect';
export function setTab(t) {
  curTab = t;
  for (const b of document.querySelectorAll('#rightTabs button')) b.classList.toggle('on', b.dataset.tab === t);
  renderTab();
}
function renderTab() {
  const body = $('#tabBody');
  const focusKey = document.activeElement?.closest?.('#tabBody') ? document.activeElement.dataset.key : null;
  const scroll = body.scrollTop;
  let content;
  if (curTab === 'inspect') content = inspector();
  else if (curTab === 'project') content = projectPanel();
  else if (curTab === 'images') content = imagesPanel();
  else if (curTab === 'issues') content = issuesPanel();
  else if (curTab === 'checklist') content = checklistPanel(issues, {
    goto: (mapId, elId) => {
      if (mapId !== S.mapId) switchMap(mapId);
      const f = elId ? findElement(S.project, elId) : null;
      if (f) { S.selection = new Set([elId]); emit('selection'); zoomTo(elementBounds(f.el)); } else fit();
    },
  });
  else content = historyPanel();
  body.replaceChildren(content);
  body.scrollTop = scroll;
  if (focusKey) body.querySelector(`[data-key="${focusKey}"]`)?.focus();
}

// ---- Field helpers -----------------------------------------------------------------------
function setOn(ids, path, value, label) {
  change(label || 'Edit ' + path, () => {
    for (const id of ids) {
      const f = findElement(S.project, id);
      if (!f) continue;
      setPath(f.el, path, value);
    }
  });
}
function setPath(o, path, v) {
  const parts = path.split('.');
  let t = o;
  for (let i = 0; i < parts.length - 1; i++) t = t[parts[i]] ??= {};
  t[parts.at(-1)] = v;
}
function getPath(o, path) { return path.split('.').reduce((a, k) => a?.[k], o); }

function row(label, ...ctrl) { return h('div', { class: 'row' }, h('label', null, label), ctrl.length > 1 ? h('div', { class: 'pair' }, ctrl) : ctrl[0]); }
function sec(title, ...kids) { return h('div', { class: 'sec' }, h('h4', null, title), kids); }

function textField(ids, el, path, props = {}) {
  const tag = props.multiline ? 'textarea' : 'input';
  const inp = h(tag, { value: getPath(el, path) ?? '', dataset: { key: path }, placeholder: props.placeholder || '', rows: props.multiline ? 3 : null });
  inp.addEventListener('change', () => setOn(ids, path, inp.value, props.label));
  if (!props.multiline) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
  return inp;
}
function numField(ids, el, path, props = {}) {
  const inp = h('input', { type: 'number', value: getPath(el, path) ?? 0, step: props.step ?? 1, min: props.min, max: props.max, dataset: { key: path } });
  inp.addEventListener('change', () => { const v = parseFloat(inp.value); if (!isNaN(v)) setOn(ids, path, v, props.label); });
  return inp;
}
function checkField(ids, el, path, text, label) {
  const inp = h('input', { type: 'checkbox', checked: !!getPath(el, path) });
  inp.addEventListener('change', () => setOn(ids, path, inp.checked, label));
  return h('label', { class: 'tiny', style: { display: 'flex', gap: '5px' } }, inp, text);
}
function colorField(ids, el, path, fallback = '#888888') {
  const v = getPath(el, path);
  const inp = h('input', { type: 'color', value: v || fallback });
  inp.addEventListener('change', () => setOn(ids, path, inp.value));
  const clear = h('button', { class: 'mini', title: 'Use the style default', onclick: () => setOn(ids, path, '') }, v ? '✕' : 'default');
  return [inp, clear];
}
function selField(ids, el, path, options, label) {
  return select(options, getPath(el, path), (v) => setOn(ids, path, v, label), { dataset: { key: path } });
}
const charOptions = () => [['', '— none —'], ...S.project.characters.map((c) => [c.id, c.name])];
const flagOptions = (none = '— none —') => [['', none], ...S.project.flags.map((f) => [f.id, f.name])];

function condBlock(ids, el) {
  const c = el.cond || emptyCond();
  const chOpts = (any) => [['-1', any], ...S.project.chapters.map((n, i) => [String(i), n])];
  const setC = (k, v) => setOn(ids, 'cond.' + k, v, 'Edit conditions');
  const times = h('div', { class: 'chips' }, S.project.times.map((t, i) => h('span', {
    class: 'chip' + (c.times?.includes(i) ? ' on' : ''),
    onclick: () => { const cur = new Set(c.times || []); cur.has(i) ? cur.delete(i) : cur.add(i); setC('times', [...cur].sort()); },
  }, t)));
  const sum = condSummary(c, S.project);
  return sec('When does it exist?',
    h('div', { class: 'hint' }, sum ? 'Only: ' + sum : 'Always there. Narrow it down to make it appear only in some chapters, times of day or story states.'),
    row('Chapters', select(chOpts('from start'), String(c.chMin ?? -1), (v) => setC('chMin', +v)), select(chOpts('to end'), String(c.chMax ?? -1), (v) => setC('chMax', +v))),
    row('Time of day', times),
    row('Only if flag', select(flagOptions(), c.flag, (v) => setC('flag', v)), h('button', { class: 'mini', title: 'New flag', onclick: () => newFlag((id) => setC('flag', id)) }, '＋')),
    row('Unless flag', select(flagOptions(), c.notFlag, (v) => setC('notFlag', v))),
    sum ? h('button', { class: 'mini', onclick: () => setOn(ids, 'cond', emptyCond(), 'Clear conditions') }, 'Clear conditions') : null,
  );
}

async function newFlag(then) {
  const n = await ask('New story flag', 'Name, e.g. pool_open or has_key_card');
  if (!n) return;
  const id = uid('flag');
  change('Add flag', () => S.project.flags.push({ id, name: n.trim(), desc: '' }));
  then?.(id);
}

const iconUrlCache = new Map();
function iconPicker(ids, el, { pathIcon = 'icon', pathAsset = 'asset' } = {}) {
  const cur = el[pathAsset] ? 'asset:' + el[pathAsset] : el[pathIcon];
  const T = getTheme(S.project, map());
  const choose = (v) => change('Change icon', () => {
    for (const id of ids) {
      const f = findElement(S.project, id); if (!f) continue;
      if (v.startsWith('asset:')) { f.el[pathAsset] = v.slice(6); f.el[pathIcon] = ''; } else { f.el[pathIcon] = v; f.el[pathAsset] = ''; }
    }
  });
  const btns = [h('button', { class: 'none' + (!cur ? ' on' : ''), title: 'No icon', onclick: () => choose('') }, 'none')];
  // icons are shown exactly as they look on the map: the style's icon colour on its room colour
  const ink = T.icon;
  const tileBg = { background: T.room };
  for (const name of ICON_NAMES) {
    const key = name + ink + T.iconLight;
    if (!iconUrlCache.has(key)) iconUrlCache.set(key, iconCanvas(name, ink, T.iconLight || 'rgba(255,255,255,.6)', 3).toDataURL());
    btns.push(h('button', { class: cur === name ? 'on' : '', title: name, style: tileBg, onclick: () => choose(name) }, h('img', { src: iconUrlCache.get(key) })));
  }
  for (const [id, a] of Object.entries(S.project.assets)) {
    btns.push(h('button', { class: cur === 'asset:' + id ? 'on' : '', title: a.name + ' (your image)', style: tileBg, onclick: () => choose('asset:' + id) }, h('img', { src: a.data })));
  }
  return h('div', null,
    h('div', { class: 'icon-grid' }, btns),
    h('div', { class: 'btnrow' },
      h('button', { class: 'mini', onclick: async () => { const files = await pickFile('image/*'); const got = await importImages(files); if (got[0]) choose('asset:' + got[0]); } }, '⤒ Import image…'),
      h('button', { class: 'mini', onclick: () => pixelEditor(null, (id) => choose('asset:' + id)) }, '✎ Draw pixel icon…')));
}

function linkBlock(ids, el) {
  const l = el.link || { mapId: '', targetId: '' };
  const tm = S.project.maps.find((m) => m.id === l.mapId);
  const targets = tm ? tm.elements.filter((e) => e.type === 'door' || e.type === 'stairs' || (e.type === 'marker' && (e.kind === 'portal' || e.kind === 'spawn')) || (e.type === 'room' && e.kind === 'room')) : [];
  const setLink = (mapId, targetId, twoWay = true) => change('Link', () => {
    const me = findElement(S.project, el.id).el;
    const old = me.link?.targetId ? findElement(S.project, me.link.targetId) : null;
    if (old?.el.link?.targetId === me.id) old.el.link = { mapId: '', targetId: '' };
    me.link = { mapId, targetId };
    if (twoWay && targetId) {
      const t = findElement(S.project, targetId);
      if (t && 'link' in t.el) t.el.link = { mapId: map().id, targetId: me.id };
    }
  });
  const pick = () => {
    const back = S.mapId;
    startPick(`Click the door / stairs / exit this should lead to. Switch floors on the left if needed.`, (target, tmap) => {
      if (target.id === el.id) return toast('Pick something else', 'error');
      const me = findElement(S.project, el.id);
      if (!me) return;
      const ownerMap = me.map.id;
      change('Link', () => {
        me.el.link = { mapId: tmap.id, targetId: target.id };
        if ('link' in target) target.link = { mapId: ownerMap, targetId: me.el.id };
      });
      toast(`Linked to ${tmap.name} › ${elementTitle(target, S.project)}`);
      if (S.mapId !== back) switchMap(back, { push: false });
      S.selection = new Set([el.id]); emit('selection');
    });
  };
  const createOpposite = () => {
    if (!tm) return;
    const me = findElement(S.project, el.id).el;
    let copy;
    if (me.type === 'stairs') {
      copy = newStairs(me.rects[0], { n: 's', s: 'n', e: 'w', w: 'e' }[me.dir]);
      copy.goes = me.goes === 'up' ? 'down' : 'up';
      copy.name = 'Stairs to ' + map().name; copy.showLabel = me.showLabel;
    } else {
      const p = me.type === 'door' ? { x: me.orient === 'h' ? me.x + me.len / 2 : me.x, y: me.orient === 'h' ? me.y : me.y + me.len / 2 } : { x: me.x, y: me.y };
      copy = newMarker('portal', p.x, p.y);
      copy.name = 'To ' + map().name;
    }
    change('Create arrival point', () => {
      S.project.maps.find((m) => m.id === tm.id).elements.push(copy);
      me.link = { mapId: tm.id, targetId: copy.id };
      copy.link = { mapId: map().id, targetId: me.id };
    });
    toast(`Made a matching ${copy.type === 'stairs' ? 'staircase' : 'exit'} on ${tm.name} (same position) and linked them both ways.`);
  };
  return sec('Link to another map',
    h('div', { class: 'hint' }, 'Walk through it in 3D to travel. Double-click it in the editor to jump there.'),
    row('Goes to map', select([['', '— not linked —'], ...S.project.maps.map((m) => [m.id, m.name + (m.id === S.mapId ? ' (this map)' : '')])], l.mapId, (v) => setLink(v, '', false))),
    tm ? row('Arrive at', select([['', '— map start —'], ...targets.map((t) => [t.id, elementTitle(t, S.project) + ' (' + (t.type === 'marker' ? MARKER_KINDS[t.kind].label : t.type) + ')'])], l.targetId, (v) => setLink(l.mapId, v, true))) : null,
    h('div', { class: 'btnrow' },
      h('button', { class: 'mini', onclick: pick }, '🎯 Pick on map…'),
      tm && !l.targetId ? h('button', { class: 'mini', onclick: createOpposite, title: 'Make matching stairs / an exit at the same spot on the other map and link both ways' }, '✚ Make matching arrival') : null,
      tm ? h('button', { class: 'mini', onclick: () => emit('follow-link', el) }, 'Go there →') : null,
      l.mapId ? h('button', { class: 'mini danger', onclick: () => setLink('', '', false) }, 'Unlink') : null),
  );
}

// ---- Inspector ---------------------------------------------------------------------------------
function inspector() {
  const sel = selected();
  if (!sel.length) return mapPanel();
  if (sel.length > 1) return multiPanel(sel);
  const el = sel[0];
  const ids = [el.id];
  const head = h('div', { class: 'sec' },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
      h('b', { style: { fontSize: '15px', flex: 1 } }, elementTitle(el, S.project)),
      h('button', { class: 'mini', title: 'Copy id (for code)', onclick: () => { navigator.clipboard?.writeText(el.id); toast('Copied id ' + el.id); } }, '#id'),
      h('button', { class: 'mini', title: el.lockedEdit ? 'Unlock editing' : 'Lock so it cannot be moved or deleted by accident', onclick: () => setOn(ids, 'lockedEdit', !el.lockedEdit) }, el.lockedEdit ? '🔒' : '🔓')),
    h('div', { class: 'hint' }, el.type === 'room' ? ROOM_KINDS[el.kind]?.help : el.type === 'marker' ? MARKER_KINDS[el.kind]?.help : ''));
  const actions = h('div', { class: 'btnrow' },
    h('button', { class: 'mini', title: 'Rotate left ( [ )', onclick: () => emit('cmd', 'rotL') }, '⟲ Rotate'),
    h('button', { class: 'mini', title: 'Rotate right ( ] )', onclick: () => emit('cmd', 'rotR') }, '⟳ Rotate'),
    h('button', { class: 'mini', title: 'Flip left-right (Shift+H)', onclick: () => emit('cmd', 'flipH') }, '⇋ Flip'),
    h('button', { class: 'mini', title: 'Flip up-down (Shift+V)', onclick: () => emit('cmd', 'flipV') }, '⇵ Flip'),
    h('button', { class: 'mini', onclick: () => emit('walk-at', walkPointFor(el)) }, '🚶 Walk from here'),
    h('button', { class: 'mini', onclick: () => emit('cmd', 'duplicate') }, '⧉ Duplicate'),
    h('button', { class: 'mini', onclick: () => emit('cmd', 'prefab') }, '★ Save as prefab'),
    h('button', { class: 'mini danger', onclick: () => emit('cmd', 'delete') }, '🗑 Delete'));
  const parts = [head];
  if (el.type === 'room') parts.push(roomFields(ids, el));
  else if (el.type === 'door') parts.push(doorFields(ids, el));
  else if (el.type === 'stairs') parts.push(stairsFields(ids, el));
  else if (el.type === 'marker') parts.push(markerFields(ids, el));
  else if (el.type === 'label') parts.push(sec('Label',
    row('Text', textField(ids, el, 'text')), row('Size', numField(ids, el, 'size', { step: 0.25, min: 0.25 })),
    row('Colour', ...colorField(ids, el, 'color', '#3b2420')), row('Rotation°', numField(ids, el, 'rot', { step: 15 }))));
  if (map().areas?.length) parts.push(sec('Area', row('Part of', select([['', '— no area —'], ...map().areas.map((a) => [a.id, a.name])], el.area || '', (v) => setOn(ids, 'area', v, 'Change area')))));
  if (el.type !== 'marker' || el.kind !== 'note') parts.push(condBlock(ids, el));
  if ('notes' in el) parts.push(sec('Notes', textField(ids, el, 'notes', { multiline: true, placeholder: 'Notes for your team…' }), el.type === 'room' ? row('Tags', textField(ids, el, 'tags', { placeholder: 'dorm, crime-scene…' })) : null));
  parts.push(actions);
  return h('div', null, parts);
}

function walkPointFor(el) {
  const b = elementBounds(el);
  return { mapId: S.mapId, x: b.x + b.w / 2, y: b.y + b.h / 2 + (el.type === 'door' ? 0.8 : 0), face: 0 };
}

function roomFields(ids, el) {
  const area = el.rects.reduce((a, r) => a + r.w * r.h, 0) * S.project.settings.cellSize ** 2;
  const b = elementBounds(el);
  return h('div', null,
    sec('Room',
      row('Name', textField(ids, el, 'name', { placeholder: 'e.g. Dining Hall' })),
      row('Type', selField(ids, el, 'kind', Object.entries(ROOM_KINDS).map(([k, v]) => [k, v.label]))),
      row('Show', checkField(ids, el, 'showLabel', 'name'), checkField(ids, el, 'showIcon', 'icon')),
      h('div', { class: 'hint' }, `${b.w} × ${b.h} cells · ${Math.round(area * 10) / 10} m² · ${el.rects.length} piece${el.rects.length > 1 ? 's' : ''}`)),
    el.kind !== 'blocked' ? sec('Icon / picture', row('Owner', select(charOptions(), el.characterId, (v) => setOn(ids, 'characterId', v, 'Set dorm owner'))),
      h('div', { class: 'hint' }, 'Owner shows that character’s portrait (dorm rooms) on the map and on the door nameplate in 3D.'),
      iconPicker(ids, el)) : null,
    sec('Look',
      row('Map colour', ...colorField(ids, el, 'color', getTheme(S.project, map()).room)),
      row('3D floor', ...colorField(ids, el, 'floorColor', getTheme(S.project, map()).roomFloor3d)),
      row('3D walls', ...colorField(ids, el, 'wallColor', getTheme(S.project, map()).wall3d)),
      row('Wall height', numField(ids, el, 'wallHeight', { step: 0.25, min: 0 }), h('span', { class: 'hint' }, 'm, 0 = default')),
      row('Lighting', selField(ids, el, 'lighting', LIGHTING.map((l) => [l, l]))),
      row('', checkField(ids, el, 'ceiling', 'Has a ceiling')),
      row('', checkField(ids, el, 'open', 'Open plan (no walls to neighbours)'))),
    el.kind === 'room' ? sec('In-game map',
      row('Appears', select([['always', 'Always shown'], ['enter', 'After first visit'], ['flag', 'When a flag is set']], el.discover, (v) => setOn(ids, 'discover', v))),
      el.discover === 'flag' ? row('Flag', selField(ids, el, 'discoverFlag', flagOptions())) : null,
      row('', checkField(ids, el, 'locked', 'Always locked'))) : null,
    el.kind === 'room' || el.kind === 'outdoor' ? chapterLockBlock(ids, el, 'room') : null,
  );
}

/** "Unlocks in chapter X": locked (with a lock on the map, doors shut in 3D) in every chapter before that. */
function chapterLockBlock(ids, el, what) {
  const opts = [['-1', 'Always open'], ...S.project.chapters.map((c, i) => [String(i), c])];
  const ch = el.unlockChapter ?? -1;
  return sec('Chapter lock',
    row('Unlocks in', select(opts, String(ch), (v) => setOn(ids, 'unlockChapter', +v, 'Set unlock chapter'))),
    h('div', { class: 'hint' }, ch >= 0
      ? `Locked before ${S.project.chapters[ch]}. Pick a chapter in the top bar to preview it.${what === 'room' ? ' Doors into this room stay shut in walk mode.' : ''}`
      : 'Open in every chapter. Pick a chapter here to keep it locked until then.'),
    ch >= 0 && !(what === 'door' && el.lock !== 'open') ? row('Message', textField(ids, el, 'lockMsg', { multiline: true, placeholder: `It won't open until ${S.project.chapters[ch]}.` })) : null,
    h('div', { class: 'btnrow' }, h('button', { class: 'mini', onclick: () => setTab('checklist') }, '☑ Checklist: set every room’s chapter from your list…')));
}

function doorFields(ids, el) {
  return h('div', null,
    sec('Door',
      row('Name', textField(ids, el, 'name', { placeholder: 'optional' })),
      row('Style', selField(ids, el, 'style', DOOR_STYLES.map((s) => [s, s]))),
      row('Width', numField(ids, el, 'len', { min: 1, max: 20 }), h('span', { class: 'hint' }, 'cells')),
      row('Lock', selField(ids, el, 'lock', Object.entries(LOCK_STATES))),
      el.lock !== 'open' ? row('Message', textField(ids, el, 'lockMsg', { multiline: true, placeholder: "It's locked." })) : null,
      el.lock !== 'open' ? row('Unlocks with', selField(ids, el, 'unlockFlag', flagOptions('— never —'))) : null),
    chapterLockBlock(ids, el, 'door'),
    linkBlock(ids, el));
}

function stairsFields(ids, el) {
  const dirs = [['n', '↑ North'], ['e', '→ East'], ['s', '↓ South'], ['w', '← West']];
  return h('div', null,
    sec('Stairs',
      row('Name', textField(ids, el, 'name')),
      row('Show name', checkField(ids, el, 'showLabel', 'on the map')),
      row('Climb toward', h('div', { class: 'chips' }, dirs.map(([d, l]) => h('span', { class: 'chip' + (el.dir === d ? ' on' : ''), onclick: () => setOn(ids, 'dir', d) }, l)))),
      row('Goes', select([['up', 'Up'], ['down', 'Down']], el.goes, (v) => setOn(ids, 'goes', v)))),
    chapterLockBlock(ids, el, 'stairs'),
    linkBlock(ids, el));
}

function markerFields(ids, el) {
  const k = el.kind;
  const parts = [];
  const general = [
    row('Type', select(Object.entries(MARKER_KINDS).map(([key, v]) => [key, v.label]), k, (v) => setOn(ids, 'kind', v, 'Change marker type'))),
    k !== 'npc' ? row('Name', textField(ids, el, 'name')) : null,
    row('Position', numField(ids, el, 'x', { step: 0.5 }), numField(ids, el, 'y', { step: 0.5 })),
  ];
  if (['npc', 'fte', 'spawn', 'camera', 'portal', 'prop'].includes(k)) general.push(row('Facing°', numField(ids, el, 'rot', { step: 45 }), h('div', { class: 'chips' }, [['↑', 0], ['→', 90], ['↓', 180], ['←', 270]].map(([a, d]) => h('span', { class: 'chip' + ((el.rot || 0) % 360 === d ? ' on' : ''), onclick: () => setOn(ids, 'rot', d) }, a)))));
  parts.push(sec(MARKER_KINDS[k]?.label ?? 'Marker', general));
  if (k === 'npc' || k === 'fte') {
    parts.push(sec('Character',
      row('Who', select(charOptions(), el.characterId, (v) => setOn(ids, 'characterId', v, 'Set character')), h('button', { class: 'mini', title: 'Edit characters', onclick: () => setTab('project') }, '✎')),
      row('Pose / sprite', textField(ids, el, 'pose', { placeholder: 'e.g. happy (expression id)' })),
      row(k === 'fte' ? 'Event id' : 'Says (3D)', textField(ids, el, k === 'fte' ? 'eventId' : 'text', { multiline: k !== 'fte', placeholder: k === 'fte' ? 'free-time event id' : 'Line shown when you talk to them in walk mode' })),
      k === 'fte' ? row('Description', textField(ids, el, 'text', { multiline: true })) : null,
      row('Height (m)', numField(ids, el, 'height', { step: 0.05, min: 0 }), h('span', { class: 'hint' }, '<1.2 = default'))));
  }
  if (k === 'hotspot') parts.push(sec('Examine', row('Text', textField(ids, el, 'text', { multiline: true, placeholder: 'What you see when you examine it' })), row('Height (m)', numField(ids, el, 'height', { step: 0.1 })), row('Event id', textField(ids, el, 'eventId', { placeholder: 'optional, for Unity' }))));
  if (k === 'evidence') {
    const evOpts = [['', '— choose —'], ...S.project.evidence.map((e) => [e.id, e.name])];
    parts.push(sec('Evidence',
      row('Truth Bullet', select(evOpts, el.evidenceId, (v) => setOn(ids, 'evidenceId', v)), h('button', { class: 'mini', onclick: async () => { const n = await ask('New evidence', 'Name', el.name); if (!n) return; const id = uid('ev'); change('Add evidence', () => { S.project.evidence.push({ id, name: n, desc: '' }); findElement(S.project, el.id).el.evidenceId = id; }); } }, '＋')),
      row('', checkField(ids, el, 'required', 'Required before the trial')),
      row('Found text', textField(ids, el, 'text', { multiline: true })),
      row('Height (m)', numField(ids, el, 'height', { step: 0.1 }))));
  }
  if (k === 'prop') parts.push(sec('Prop',
    row('Size (cells)', numField(ids, el, 'w', { step: 0.5, min: 0.25 }), numField(ids, el, 'h', { step: 0.5, min: 0.25 })),
    row('Height (m)', numField(ids, el, 'height', { step: 0.1, min: 0 })),
    row('Colour', ...colorField(ids, el, 'color', '#9a7b6a')),
    row('Unity prefab', textField(ids, el, 'prefab', { placeholder: 'e.g. Bed_Single' })),
    row('Examine text', textField(ids, el, 'text', { multiline: true, placeholder: 'optional' })),
    h('div', { class: 'hint' }, 'Icon shows on the 2D map. Pick one of your images to show it as a flat cut-out in 3D.'),
    iconPicker(ids, el)));
  if (k === 'light') parts.push(sec('Light', row('Colour', h('input', { type: 'color', value: el.lightColor, onchange: (e) => setOn(ids, 'lightColor', e.target.value) })), row('Brightness', numField(ids, el, 'intensity', { step: 0.1, min: 0 })), row('Range (cells)', numField(ids, el, 'range', { step: 1, min: 1 }))));
  if (k === 'camera') parts.push(sec('Camera', row('Text', textField(ids, el, 'text', { multiline: true, placeholder: 'Examine text' }))));
  if (k === 'trigger') parts.push(sec('Trigger',
    row('Event type', selField(ids, el, 'triggerType', TRIGGER_TYPES.map((t) => [t, t]))),
    row('Event id', textField(ids, el, 'eventId', { placeholder: 'e.g. ch1_night_announcement' })),
    row('Size (cells)', numField(ids, el, 'w', { step: 0.5, min: 0.5 }), numField(ids, el, 'h', { step: 0.5, min: 0.5 })),
    row('', checkField(ids, el, 'once', 'Only fire once')),
    row('Preview text', textField(ids, el, 'text', { multiline: true }))));
  if (k === 'portal') { parts.push(sec('Look', row('Label', textField(ids, el, 'text', { placeholder: 'optional' })), iconPicker(ids, el))); parts.push(linkBlock(ids, el)); }
  if (k === 'note') parts.push(sec('Note', textField(ids, el, 'text', { multiline: true }), row('Colour', ...colorField(ids, el, 'color', '#ffe680'))));
  return h('div', null, parts);
}

function multiPanel(sel) {
  const ids = sel.map((e) => e.id);
  const rooms = sel.filter((e) => e.type === 'room');
  const types = {};
  for (const e of sel) types[e.type] = (types[e.type] || 0) + 1;
  const align = (how) => change('Align', () => {
    const bs = sel.map((e) => [findElement(S.project, e.id).el, elementBounds(e)]);
    const minX = Math.min(...bs.map(([, b]) => b.x)), maxX = Math.max(...bs.map(([, b]) => b.x + b.w));
    const minY = Math.min(...bs.map(([, b]) => b.y)), maxY = Math.max(...bs.map(([, b]) => b.y + b.h));
    for (const [e, b] of bs) {
      let dx = 0, dy = 0;
      if (how === 'left') dx = minX - b.x; if (how === 'right') dx = maxX - (b.x + b.w);
      if (how === 'top') dy = minY - b.y; if (how === 'bottom') dy = maxY - (b.y + b.h);
      if (e.rects) { dx = Math.round(dx); dy = Math.round(dy); e.rects = e.rects.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy })); } else { e.x += dx; e.y += dy; }
    }
  });
  const distribute = (axis) => change('Distribute', () => {
    const list = sel.map((e) => [findElement(S.project, e.id).el, elementBounds(e)]).sort((a, b) => (axis === 'x' ? a[1].x - b[1].x : a[1].y - b[1].y));
    if (list.length < 3) return;
    const first = list[0][1], last = list.at(-1)[1];
    const span = axis === 'x' ? last.x - first.x : last.y - first.y;
    list.forEach(([e, b], i) => {
      const target = (axis === 'x' ? first.x : first.y) + (span * i) / (list.length - 1);
      let d = target - (axis === 'x' ? b.x : b.y);
      if (e.rects) { d = Math.round(d); e.rects = e.rects.map((r) => ({ ...r, [axis]: r[axis] + d })); } else e[axis] += d;
    });
  });
  return h('div', null,
    sec(`${sel.length} selected`, h('div', { class: 'hint' }, Object.entries(types).map(([t, n]) => `${n} ${t}${n > 1 ? 's' : ''}`).join(', ')),
      h('div', { class: 'btnrow' }, ['left', 'right', 'top', 'bottom'].map((a) => h('button', { class: 'mini', onclick: () => align(a) }, 'Align ' + a))),
      h('div', { class: 'btnrow' }, h('button', { class: 'mini', onclick: () => distribute('x') }, '⇹ Distribute across'), h('button', { class: 'mini', onclick: () => distribute('y') }, '⇳ Distribute down')),
      h('div', { class: 'btnrow' }, h('button', { class: 'mini', onclick: () => emit('cmd', 'rotL') }, '⟲ Rotate'), h('button', { class: 'mini', onclick: () => emit('cmd', 'rotR') }, '⟳ Rotate'), h('button', { class: 'mini', onclick: () => emit('cmd', 'flipH') }, '⇋ Flip'), h('button', { class: 'mini', onclick: () => emit('cmd', 'flipV') }, '⇵ Flip')),
      h('div', { class: 'btnrow' }, h('button', { class: 'mini', onclick: () => emit('cmd', 'duplicate') }, '⧉ Duplicate'), h('button', { class: 'mini', onclick: () => emit('cmd', 'prefab') }, '★ Save as prefab'), h('button', { class: 'mini danger', onclick: () => emit('cmd', 'delete') }, '🗑 Delete'))),
    rooms.length === sel.length ? sec('Rooms', row('Type', select([['', '—'], ...Object.entries(ROOM_KINDS).map(([k, v]) => [k, v.label])], '', (v) => v && setOn(ids, 'kind', v))), row('Map colour', ...colorField(ids, rooms[0], 'color', getTheme(S.project, map()).room)), row('Lighting', select([['', '—'], ...LIGHTING.map((l) => [l, l])], '', (v) => v && setOn(ids, 'lighting', v)))) : null,
    map().areas?.length ? sec('Area', row('Put all in', select([['__', '— choose —'], ['', '— no area —'], ...map().areas.map((a) => [a.id, a.name])], '__', (v) => v !== '__' && setOn(ids, 'area', v, 'Change area')))) : null,
    condBlock(ids, sel[0]),
    h('div', { class: 'hint' }, 'Conditions shown are the first item’s; changing them sets all selected items.'));
}

function mapPanel() {
  const m = map();
  const ids = [];
  const setM = (k, v, label) => change(label || 'Edit map', () => { setPath(S.project.maps.find((x) => x.id === m.id), k, v); });
  const inp = (k, props = {}) => {
    const i = h('input', { type: props.type || 'text', value: getPath(m, k) ?? '', step: props.step, dataset: { key: 'map.' + k }, list: props.list });
    i.addEventListener('change', () => setM(k, props.type === 'number' ? parseFloat(i.value) || 0 : i.value));
    return i;
  };
  const buildings = [...new Set(S.project.maps.map((x) => x.building).filter(Boolean))];
  const counts = {};
  for (const e of m.elements) { const k = e.type === 'marker' ? e.kind : e.type === 'room' ? e.kind : e.type; counts[k] = (counts[k] || 0) + 1; }
  void ids;
  return h('div', null,
    sec('Map', row('Name', inp('name')), row('Building', inp('building', { list: 'buildingList' })), h('datalist', { id: 'buildingList' }, buildings.map((b) => h('option', { value: b }))),
      row('Floor no.', inp('floor', { type: 'number' }), h('span', { class: 'hint' }, floorName(m.floor))),
      row('Height (m)', inp('elevation', { type: 'number', step: 0.5 }), h('span', { class: 'hint' }, 'above ground')),
      row('Offset', inp('ox', { type: 'number' }), inp('oy', { type: 'number' })),
      h('div', { class: 'hint' }, 'Offset moves this map in the Building view and in Unity (in cells), e.g. to place the gym beside the school.'),
      row('Style', select([['', 'Project default'], ...allThemes(S.project).map((t) => [t.id, t.name])], m.theme, (v) => setM('theme', v))),
      row('', h('label', { class: 'tiny' }, h('input', { type: 'checkbox', checked: S.project.startMapId === m.id, onchange: () => change('Set start map', () => { S.project.startMapId = m.id; }) }), 'Game starts on this map'))),
    sec('Trace over a picture',
      h('div', { class: 'hint' }, 'Put a reference image (an official map, a sketch, a screenshot) under the grid and draw over it.'),
      row('Image', select([['', '— none —'], ...Object.entries(S.project.assets).map(([id, a]) => [id, a.name])], m.bg.asset, (v) => setM('bg.asset', v)),
        h('button', { class: 'mini', onclick: async () => { const got = await importImages(await pickFile('image/*')); if (got[0]) setM('bg.asset', got[0], 'Set reference image'); } }, '⤒')),
      m.bg.asset ? [
        row('Opacity', h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: m.bg.opacity, oninput: (e) => { m.bg.opacity = +e.target.value; request(); }, onchange: (e) => setM('bg.opacity', +e.target.value) })),
        row('Scale', h('input', { type: 'range', min: 0.01, max: 0.5, step: 0.001, value: m.bg.scale, oninput: (e) => { m.bg.scale = +e.target.value; request(); }, onchange: (e) => setM('bg.scale', +e.target.value) })),
        row('Position', inp('bg.x', { type: 'number', step: 0.5 }), inp('bg.y', { type: 'number', step: 0.5 })),
        row('', h('label', { class: 'tiny' }, h('input', { type: 'checkbox', checked: m.bg.visible, onchange: (e) => setM('bg.visible', e.target.checked) }), 'Visible')),
        h('div', { class: 'hint' }, 'Scale = grid cells per image pixel. Tip: line up one known room, then lower the opacity.'),
      ] : null),
    sec('Contents', h('div', { class: 'hint' }, Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(' · ') || 'Empty map. Pick the Room tool (R) and drag on the grid.')),
    sec('Notes', (() => { const t = h('textarea', { value: m.notes || '', rows: 3, placeholder: 'Notes about this map…' }); t.addEventListener('change', () => setM('notes', t.value)); return t; })()),
    h('div', { class: 'btnrow' }, h('button', { class: 'mini', onclick: () => fit() }, '⤢ Fit to view (F)'), h('button', { class: 'mini', onclick: () => emit('walk-at', { mapId: m.id }) }, '🚶 Walk this map')),
  );
}

// ---- Project panel ------------------------------------------------------------------------------
function projectPanel() {
  const p = S.project;
  const setP = (path, v, label) => change(label || 'Project setting', () => setPath(S.project, path, v));
  const num = (path, step = 0.1, label) => { const i = h('input', { type: 'number', step, value: getPath(p, path), dataset: { key: path } }); i.addEventListener('change', () => setP(path, parseFloat(i.value) || 0, label)); return i; };
  const editableList = (path, label) => {
    const arr = getPath(p, path);
    return h('div', null, arr.map((name, i) => h('div', { class: 'list-item' },
      h('span', { class: 'hint', style: { width: '18px' } }, i),
      (() => { const inp = h('input', { value: name }); inp.addEventListener('change', () => change('Rename', () => { getPath(S.project, path)[i] = inp.value; })); return inp; })(),
      h('button', { class: 'mini danger', title: 'Remove (conditions use the number, so later entries shift)', onclick: () => change('Remove ' + label, () => { getPath(S.project, path).splice(i, 1); }) }, '✕'))),
    h('button', { class: 'mini', onclick: () => change('Add ' + label, () => { getPath(S.project, path).push(label + ' ' + (arr.length + 1)); }) }, '＋ Add ' + label));
  };
  const chars = p.characters.map((c, i) => {
    const pic = h('div', { class: 'pic', title: 'Click to set a portrait', style: { backgroundColor: c.color, backgroundImage: c.asset && p.assets[c.asset] ? `url(${p.assets[c.asset].data})` : '' } }, c.asset ? '' : (c.initials || c.name.slice(0, 2)).toUpperCase());
    pic.onclick = () => choosePortrait(c.id);
    const name = h('input', { value: c.name });
    name.addEventListener('change', () => change('Rename character', () => { S.project.characters[i].name = name.value; }));
    const col = h('input', { type: 'color', value: c.color });
    col.addEventListener('change', () => change('Character colour', () => { S.project.characters[i].color = col.value; }));
    return h('div', { class: 'char-row' }, pic, name, col, h('button', { class: 'mini danger', onclick: async () => { if (await confirmBox('Remove character', `Remove ${c.name}? Markers that use them will show “?”.`, 'Remove', true)) change('Remove character', () => S.project.characters.splice(i, 1)); } }, '✕'));
  });
  const T = getTheme(p, null);
  return h('div', null,
    sec('Project',
      row('Default style', select(allThemes(p).map((t) => [t.id, t.name]), p.settings.theme, (v) => setP('settings.theme', v))),
      h('div', { class: 'btnrow' }, h('button', { class: 'mini primary', onclick: () => import('./styleEditor.js').then((m) => m.styleEditor()) }, '🎨 Style editor (make your own)…'))),
    p.customThemes.length ? sec('Custom styles', p.customThemes.map((t, ti) => h('details', null, h('summary', null, t.name),
      row('Name', (() => { const i = h('input', { value: t.name }); i.onchange = () => change('Rename style', () => { S.project.customThemes[ti].name = i.value; }); return i; })()),
      THEME_KEYS.filter((k) => /^#/.test(t[k] || '')).map((k) => row(k, (() => { const i = h('input', { type: 'color', value: t[k] }); i.onchange = () => change('Edit style', () => { S.project.customThemes[ti][k] = i.value; }); return i; })())),
      h('button', { class: 'mini danger', onclick: () => change('Delete style', () => S.project.customThemes.splice(ti, 1)) }, 'Delete style')))) : null,
    sec('Scale & 3D',
      row('Room scale', (() => {
        const v = p.settings.cellSize;
        const out = h('span', { class: 'hint' }, v + ' m');
        const sl = h('input', { type: 'range', min: 0.2, max: 2, step: 0.025, value: v, oninput: (e) => { out.textContent = e.target.value + ' m'; }, onchange: (e) => setP('settings.cellSize', +e.target.value, 'Map scale') });
        return h('div', { class: 'pair' }, sl, out);
      })()),
      h('div', { class: 'btnrow' }, [['Fine grid', 0.375], ['Cosy', 0.7], ['Snug', 0.85], ['Normal', 1], ['Roomy', 1.25]].map(([l, v]) => h('button', { class: 'mini' + (p.settings.cellSize === v ? ' on' : ''), onclick: () => setP('settings.cellSize', v, 'Map scale') }, `${l} (${v} m)`))),
      h('div', { class: 'hint' }, 'How big one grid square is in real life. Smaller makes every room cosier and every corridor shorter in walk mode and in Unity, without redrawing anything. Tip: in walk mode press − / = to try it live.'),
      row('Unity units/m', num('settings.unitsPerMetre', 0.01)),
      h('div', { class: 'hint' }, 'Unity’s default is 1 unit = 1 m. If your characters are built bigger or smaller, set this so a metre matches.'),
      row('Camera view°', num('settings.fov', 1)),
      h('div', { class: 'hint' }, 'Walk-mode field of view. Use the same value as your game’s camera; higher makes rooms look bigger and corridors longer.'),
      row('Wall height', num('settings.wallHeight', 0.25)),
      row('Door height', num('settings.doorHeight', 0.1)),
      row('Wall thickness', num('settings.wallThickness', 0.02)),
      row('Eye height', num('settings.eyeHeight', 0.05)),
      row('Walk / run m/s', num('settings.walkSpeed', 0.1), num('settings.runSpeed', 0.1)),
      row('Floor spacing', num('settings.floorGap', 0.5))),
    sec('Chapters', h('div', { class: 'hint' }, 'Used by “When does it exist?” and the chapter picker at the top.'), editableList('chapters', 'Chapter')),
    sec('Times of day', editableList('times', 'Time')),
    sec('Story flags', h('div', { class: 'hint' }, 'On/off switches your story sets (has_key, pool_open…). Exported to Unity and as C# constants.'),
      p.flags.map((f, i) => h('div', { class: 'list-item' },
        (() => { const inp = h('input', { value: f.name }); inp.onchange = () => change('Rename flag', () => { S.project.flags[i].name = inp.value; }); return inp; })(),
        (() => { const inp = h('input', { value: f.desc || '', placeholder: 'what it means' }); inp.onchange = () => change('Describe flag', () => { S.project.flags[i].desc = inp.value; }); return inp; })(),
        h('button', { class: 'mini danger', onclick: () => change('Delete flag', () => S.project.flags.splice(i, 1)) }, '✕'))),
      h('button', { class: 'mini', onclick: () => newFlag() }, '＋ Add flag')),
    sec('Characters', h('div', { class: 'hint' }, 'Click a circle to give them a portrait / standee image.'), chars,
      h('div', { class: 'btnrow' },
        h('button', { class: 'mini', onclick: () => { const id = uid('chr'); change('Add character', () => S.project.characters.push({ id, name: 'New character', color: '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'), asset: '', initials: '' })); } }, '＋ Add character'),
        h('button', { class: 'mini', title: 'Pick several images; each is matched to a character by file name (e.g. Nina.png)', onclick: bulkPortraits }, '⤒ Import portraits by name…'))),
    sec('Evidence / Truth Bullets', p.evidence.map((ev, i) => h('div', { class: 'list-item' },
      (() => { const inp = h('input', { value: ev.name }); inp.onchange = () => change('Rename evidence', () => { S.project.evidence[i].name = inp.value; }); return inp; })(),
      (() => { const inp = h('input', { value: ev.desc || '', placeholder: 'description' }); inp.onchange = () => change('Describe evidence', () => { S.project.evidence[i].desc = inp.value; }); return inp; })(),
      h('button', { class: 'mini danger', onclick: () => change('Delete evidence', () => S.project.evidence.splice(i, 1)) }, '✕'))),
    h('button', { class: 'mini', onclick: () => change('Add evidence', () => S.project.evidence.push({ id: uid('ev'), name: 'New evidence', desc: '' })) }, '＋ Add evidence')),
    sec('Prefabs (reusable pieces)', h('div', { class: 'hint' }, 'Select things on the map and press “Save as prefab”. Place them again from here.'),
      p.prefabs.map((pf, i) => h('div', { class: 'list-item' }, h('span', { style: { flex: 1 } }, `★ ${pf.name} (${pf.elements.length})`),
        h('button', { class: 'mini', onclick: () => emit('place-prefab', pf) }, 'Place'),
        h('button', { class: 'mini danger', onclick: () => change('Delete prefab', () => S.project.prefabs.splice(i, 1)) }, '✕')))),
    sec('Versions', h('div', { class: 'hint' }, 'Named snapshots kept inside the project file (e.g. “Chapter 1 final”).'),
      p.versions.map((v, i) => h('div', { class: 'list-item' }, h('span', { style: { flex: 1 } }, v.name, h('span', { class: 'hint' }, ' ' + new Date(v.at).toLocaleString())),
        h('button', { class: 'mini', onclick: () => emit('restore-version', i) }, 'Restore'),
        h('button', { class: 'mini danger', onclick: () => change('Delete version', () => S.project.versions.splice(i, 1)) }, '✕'))),
      h('div', { class: 'btnrow' }, h('button', { class: 'mini', onclick: () => emit('save-version') }, '＋ Save a version now'), h('button', { class: 'mini', onclick: () => emit('backups') }, '🛟 Browser backups…'))),
    h('div', { class: 'hint' }, 'Style colours: ', h('span', { style: { color: T.accent } }, T.name)),
  );
}

async function makeCustomTheme() {
  const base = getTheme(S.project, map());
  const n = await ask('New style', 'Name for your style', 'My style');
  if (!n) return;
  const id = uid('theme');
  change('Add style', () => { S.project.customThemes.push({ ...base, id, name: n }); S.project.settings.theme = id; });
  toast('Style added. Edit its colours under Project › Custom styles.');
}

async function choosePortrait(charId) {
  const files = await pickFile('image/*');
  const got = await importImages(files.slice(0, 1));
  if (got[0]) change('Set portrait', () => { S.project.characters.find((c) => c.id === charId).asset = got[0]; });
}
async function bulkPortraits() {
  const files = await pickFile('image/*');
  let matched = 0;
  const byName = new Map(S.project.characters.map((c) => [c.name.toLowerCase(), c.id]));
  const pairs = [];
  for (const f of files) {
    const base = f.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z]/g, ' ').trim().split(/\s+/)[0];
    const id = byName.get(base);
    if (!id) continue;
    const [aid] = await importImages([f]);
    pairs.push([id, aid]); matched++;
  }
  change('Import portraits', () => { for (const [cid, aid] of pairs) S.project.characters.find((c) => c.id === cid).asset = aid; });
  toast(`Matched ${matched} of ${files.length} images to characters by name.`);
}

// ---- Images ---------------------------------------------------------------------------------------
function imagesPanel() {
  const assets = Object.entries(S.project.assets).sort((a, b) => (b[1].addedAt || 0) - (a[1].addedAt || 0));
  const zone = h('div', { class: 'drop-zone', onclick: async () => importImages(await pickFile('image/*')) }, '⤒ Click or drop images here', h('br'), h('small', null, 'PNG, JPG, GIF, WebP, SVG — icons, portraits, props, reference maps'));
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); zone.classList.remove('over'); importImages([...e.dataTransfer.files]); });
  const sel = selected();
  const target = sel.length === 1 ? sel[0] : null;
  const useOn = (id) => {
    if (!target) return toast('Select a room, prop, exit or character marker first.', 'error');
    if (target.type === 'marker' && (target.kind === 'npc' || target.kind === 'fte') && target.characterId) {
      change('Set portrait', () => { S.project.characters.find((c) => c.id === target.characterId).asset = id; });
    } else if (target.type === 'room' || target.type === 'marker') {
      change('Set image', () => { const e = findElement(S.project, target.id).el; e.asset = id; e.icon = ''; });
    } else return toast('Images can go on rooms, props, exits and characters.', 'error');
  };
  const usage = (id) => {
    let n = 0;
    for (const m of S.project.maps) { if (m.bg.asset === id) n++; for (const e of m.elements) if (e.asset === id || e.icon === 'asset:' + id) n++; }
    for (const c of S.project.characters) if (c.asset === id) n++;
    return n;
  };
  return h('div', null,
    zone,
    h('div', { class: 'btnrow' }, h('button', { class: 'mini', onclick: () => pixelEditor(null) }, '✎ Draw a pixel icon…')),
    h('div', { class: 'hint' }, target ? `“Use” puts the image on: ${elementTitle(target, S.project)}` : 'Select something on the map, then press “Use” on an image. You can also drag images straight onto a room.'),
    h('div', { class: 'img-lib' }, assets.map(([id, a]) => {
      const name = h('input', { value: a.name, title: 'Rename' });
      name.onchange = () => { S.project.assets[id].name = name.value; S.dirty = true; emit('change', {}); };
      const n = usage(id);
      return h('div', { class: 'img-card', title: `${a.name} — used ${n} time${n === 1 ? '' : 's'}` },
        h('div', { class: 'th' }, h('img', { src: a.data, draggable: true, ondragstart: (e) => e.dataTransfer.setData('text/tvf-asset', id) })),
        name,
        h('div', { class: 'acts' },
          h('button', { onclick: () => useOn(id), title: 'Use on the selected thing' }, 'Use'),
          a.pixel ? h('button', { onclick: () => pixelEditor(id), title: 'Edit pixels' }, '✎') : null,
          h('button', { class: 'danger', title: 'Delete image', onclick: async () => {
            if (n && !(await confirmBox('Delete image', `“${a.name}” is used ${n} time(s). Delete it anyway?`, 'Delete', true))) return;
            delete S.project.assets[id]; S.dirty = true; emit('assets'); emit('change', {});
          } }, '✕')));
    })),
    assets.length ? null : h('div', { class: 'hint', style: { marginTop: '10px' } }, 'No images yet. The built-in pixel icons are always available in the icon picker.'));
}

// ---- Issues / History -------------------------------------------------------------------------------
let issues = [];
let issueTimer = 0;
function scheduleIssues() {
  clearTimeout(issueTimer);
  issueTimer = setTimeout(() => {
    issues = validate(S.project);
    const n = issues.filter((i) => i.level !== 'info').length;
    $('#issueCount').textContent = n ? String(n) : '';
    if (curTab === 'issues' || curTab === 'checklist') renderTab();
  }, 400);
}
function issuesPanel() {
  const icon = { error: '⛔', warn: '⚠️', info: 'ℹ️' };
  return h('div', null,
    h('div', { class: 'hint' }, issues.length ? `${issues.length} thing${issues.length > 1 ? 's' : ''} to look at. Click one to jump to it.` : '✅ No problems found.'),
    issues.map((it) => h('div', { class: 'issue', onclick: () => {
      if (it.mapId && it.mapId !== S.mapId) switchMap(it.mapId);
      if (it.elId) { const f = findElement(S.project, it.elId); if (f) { S.selection = new Set([it.elId]); emit('selection'); zoomTo(elementBounds(f.el)); } }
    } }, h('span', { class: 'lv' }, icon[it.level]), h('span', null, it.text, it.mapId ? h('span', { class: 'mp' }, S.project.maps.find((m) => m.id === it.mapId)?.name) : null))));
}
function historyPanel() {
  const hs = history();
  const n = hs.undo.length;
  return h('div', null,
    h('div', { class: 'hint' }, 'Click a step to go back to it. Everything is also autosaved in this browser.'),
    h('div', { class: 'hist-item' + (n === 0 ? ' cur' : ''), onclick: () => undoTo(n) }, '⟲ Start'),
    hs.undo.map((label, i) => h('div', { class: 'hist-item' + (i === n - 1 ? ' cur' : ''), onclick: () => undoTo(n - 1 - i) }, label)),
    [...hs.redo].reverse().map((label) => h('div', { class: 'hist-item redo' }, label)));
}

export { modal, THEMES };
