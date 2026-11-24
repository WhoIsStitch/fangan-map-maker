// App state, undo/redo, autosave (IndexedDB) and backups.
import { newProject, migrate } from './model.js';

const listeners = new Map();
export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt).delete(fn);
}
export function emit(evt, data) {
  for (const fn of listeners.get(evt) ?? []) fn(data);
}

export const S = {
  project: newProject(),
  mapId: null,
  selection: new Set(),
  tool: 'select',
  markerKind: 'npc',
  view: { chapter: -1, time: -1, flags: new Set(), useFlags: false }, // -1 = show everything
  mode: 'edit',          // edit | walk | building | screen
  dirty: false,
  fileName: '',
  navStack: [],          // previous map ids for the Back button
  clipboard: null,
  snap: true,
  areaFilter: null,      // area id being viewed on the current map (null = whole map, '' = parts in no area)
  keepThick: new Set(JSON.parse(localStorage.getItem('tvf-keep-thick') || '["hall"]')), // kinds whose width stays the same when scaling a selection
  showGrid: true,
  playerPos: null,       // last 3D position {mapId,x,y}
};
S.mapId = S.project.maps[0].id;

export function map() {
  return S.project.maps.find((m) => m.id === S.mapId) ?? S.project.maps[0];
}
export function selected() {
  const m = map();
  return m.elements.filter((e) => S.selection.has(e.id));
}

// ---- History -----------------------------------------------------------------
const undoStack = [];
const redoStack = [];
const LIMIT = 200;
let pending = null;

function snapshot() {
  const { assets, ...rest } = S.project;
  return JSON.stringify(rest);
}
function restore(json) {
  const assets = S.project.assets;
  S.project = { ...JSON.parse(json), assets };
  if (!S.project.maps.find((m) => m.id === S.mapId)) S.mapId = S.project.maps[0].id;
  const ids = new Set(map().elements.map((e) => e.id));
  for (const id of [...S.selection]) if (!ids.has(id)) S.selection.delete(id);
}

/** Make a change with undo. fn mutates S.project. */
export function change(label, fn) {
  const before = { json: snapshot(), label, mapId: S.mapId };
  const r = fn();
  if (snapshot() === before.json) return r;
  undoStack.push(before);
  if (undoStack.length > LIMIT) undoStack.shift();
  redoStack.length = 0;
  touched(label);
  return r;
}

/** For drags: begin() takes the snapshot, end() records it if something changed. */
export function begin(label) {
  pending = { json: snapshot(), label, mapId: S.mapId };
}
export function end() {
  if (!pending) return;
  if (snapshot() !== pending.json) {
    undoStack.push(pending);
    if (undoStack.length > LIMIT) undoStack.shift();
    redoStack.length = 0;
    touched(pending.label);
  }
  pending = null;
}
export function cancel() {
  if (pending) { restore(pending.json); pending = null; emit('change'); }
}

export function undo() {
  const s = undoStack.pop();
  if (!s) return;
  redoStack.push({ json: snapshot(), label: s.label, mapId: S.mapId });
  restore(s.json);
  if (S.project.maps.find((m) => m.id === s.mapId)) S.mapId = s.mapId;
  touched('Undo ' + s.label, true);
}
export function redo() {
  const s = redoStack.pop();
  if (!s) return;
  undoStack.push({ json: snapshot(), label: s.label, mapId: S.mapId });
  restore(s.json);
  touched('Redo ' + s.label, true);
}
export function history() {
  return { undo: undoStack.map((s) => s.label), redo: redoStack.map((s) => s.label) };
}
/** Jump back n steps in one go (History panel). */
export function undoTo(n) {
  for (let i = 0; i < n; i++) undo();
}

function touched(label, quiet) {
  S.dirty = true;
  emit('change', { label });
  if (!quiet) emit('toast-soft', label);
  scheduleAutosave();
}

/** Replace the whole project (open / new). */
export function loadProject(p, fileName = '') {
  S.project = migrate(p);
  S.mapId = S.project.startMapId || S.project.maps[0].id;
  S.selection.clear();
  S.navStack = [];
  undoStack.length = 0;
  redoStack.length = 0;
  S.dirty = false;
  S.fileName = fileName;
  S.opened = true;
  emit('project');
  emit('change', {});
}

// ---- IndexedDB autosave + backups ----------------------------------------------
const DB = 'tvf-map-maker';
function db() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function kvSet(key, value) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
export async function kvGet(key) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction('kv', 'readonly');
    const r = tx.objectStore('kv').get(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function kvDelete(key) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction('kv', 'readwrite');
    tx.objectStore('kv').delete(key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

// ---- Project library (every project lives in this browser, listed on the home screen) ----
// 'projects-index' = [{ id, name, createdAt, updatedAt, openedAt, starred, trashed, stats, thumbs:[dataURL], theme }]
// 'proj:<id>'      = the project JSON
let thumbMaker = null;
export function setThumbMaker(fn) { thumbMaker = fn; }
let diskSaver = null;
export function setDiskSaver(fn) { diskSaver = fn; }
let lastDisk = 0;
let diskTimer = 0;
export async function getIndex() { return (await kvGet('projects-index')) || []; }
export async function setIndex(list) { await kvSet('projects-index', list); emit('library'); }
const lastThumb = new Map();

export async function saveToLibrary(p = S.project, { thumbs = false, opened = false, touch = true } = {}) {
  await kvSet('proj:' + p.id, JSON.stringify(p));
  const list = await getIndex();
  let e = list.find((x) => x.id === p.id);
  if (!e) { e = { id: p.id, createdAt: Date.now(), starred: false, trashed: false, thumbs: [] }; list.push(e); }
  e.name = p.name;
  if (touch) e.updatedAt = Date.now();
  if (opened) e.openedAt = Date.now();
  e.theme = p.settings.theme;
  e.stats = {
    maps: p.maps.length,
    rooms: p.maps.reduce((n, m) => n + m.elements.filter((x) => x.type === 'room' && x.kind === 'room').length, 0),
    characters: p.characters.length,
    links: p.maps.reduce((n, m) => n + m.elements.filter((x) => x.link?.mapId).length, 0),
    buildings: [...new Set(p.maps.map((m) => m.building).filter(Boolean))],
  };
  // thumbnails are slow to draw: only on Save / going home / first time, or at most every 2 minutes
  if (thumbMaker && (thumbs || !e.thumbs?.length || Date.now() - (lastThumb.get(p.id) || 0) > 120000)) {
    try { e.thumbs = thumbMaker(p); lastThumb.set(p.id, Date.now()); } catch (err) { console.warn('thumbnail failed', err); }
  }
  await setIndex(list);
}
export async function loadFromLibrary(id) {
  const json = await kvGet('proj:' + id);
  return json ? JSON.parse(json) : null;
}

let autoTimer = 0;
let lastBackup = 0;
export function scheduleAutosave() {
  clearTimeout(autoTimer);
  autoTimer = setTimeout(autosaveNow, 1200);
}
export async function autosaveNow(opts = {}) {
  clearTimeout(autoTimer);
  if (!S.opened) return; // nothing opened from the library yet (home screen still up)
  try {
    const json = JSON.stringify(S.project);
    await saveToLibrary(S.project, opts);
    await kvSet('lastOpen', { id: S.project.id, mapId: S.mapId, fileName: S.fileName });
    // keep the disk copy (MapMaker/projects/…) in step, at most every few seconds
    if (diskSaver && S.project.diskFile) {
      clearTimeout(diskTimer); // write the disk copy once you pause for a few seconds, not after every edit
      diskTimer = setTimeout(() => { lastDisk = Date.now(); diskSaver(S.project).then(() => { S.dirty = false; emit('saved'); }).catch(() => {}); }, 4000);
    }
    emit('autosaved', Date.now());
    if (Date.now() - lastBackup > 5 * 60 * 1000) {
      lastBackup = Date.now();
      const list = (await kvGet('backups')) || [];
      list.unshift({ savedAt: Date.now(), name: S.project.name, json });
      await kvSet('backups', list.slice(0, 12));
    }
  } catch (err) {
    console.error('Autosave failed', err);
    emit('toast', { text: 'Autosave failed: ' + err.message, kind: 'error' });
  }
}
export async function backupNow(note = 'Manual backup') {
  const list = (await kvGet('backups')) || [];
  list.unshift({ savedAt: Date.now(), name: S.project.name + ' – ' + note, json: JSON.stringify(S.project) });
  await kvSet('backups', list.slice(0, 12));
}
