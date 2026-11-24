// Saving, opening and exporting.
import { S, loadProject, emit, autosaveNow, setDiskSaver } from './store.js';
import { bakeMap, arrivalPoint, doorCenter, cellAt } from './bake.js';
import { roomCenter, uid, migrate } from './model.js';
import { renderMapImage } from './render2d.js';
import { getTheme } from './themes.js';

export function download(name, data, type = 'application/json') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

const safe = (s) => (s || 'map').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'map';

// ---- Project files ----------------------------------------------------------------
let fileHandle = null;

// ---- Saving to the projects folder on disk (through the local server, no downloads) ----------------
export async function listDisk() {
  try {
    const r = await fetch('/api/projects');
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) return null;
    return await r.json();
  } catch { return null; }
}
export async function readDisk(file) {
  const r = await fetch('/api/projects/' + encodeURIComponent(file));
  if (!r.ok) throw new Error('Could not read ' + file);
  return r.json();
}
export async function saveToDisk(p = S.project) {
  if (!p.diskFile) {
    const list = await listDisk();
    if (!list) return { ok: false };
    let file = safe(p.name) + '.tvfmap.json';
    const clash = list.find((x) => x.file === file && x.id && x.id !== p.id);
    if (clash) file = safe(p.name) + '-' + p.id.slice(-5) + '.tvfmap.json';
    p.diskFile = file;
  }
  try {
    const r = await fetch('/api/projects/' + encodeURIComponent(p.diskFile), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p, null, 1) });
    if (!r.ok) return { ok: false, error: (await r.json().catch(() => ({}))).error };
    return { ok: true, file: p.diskFile };
  } catch (err) { return { ok: false, error: err.message }; }
}
setDiskSaver(async (p) => { if (p.diskFile) await saveToDisk(p); });

/**
 * Ctrl+S: save in this browser AND into MapMaker/projects/ on disk. Nothing is downloaded.
 * After the first save the disk file also keeps itself up to date with every autosave.
 * downloadCopy = true downloads a .tvfmap.json instead (to send to someone).
 */
export async function saveProject(downloadCopy = false) {
  if (downloadCopy) {
    const name = safe(S.project.name) + '.tvfmap.json';
    download(name, JSON.stringify(S.project, null, 1));
    emit('toast', { text: 'Downloaded a copy: ' + name });
    return;
  }
  await autosaveNow({ thumbs: true });
  const r = await saveToDisk(S.project);
  if (r.ok) await autosaveNow({ touch: false }); // remember the disk file name in the browser copy too
  S.dirty = false;
  emit('saved');
  emit('toast', r.ok
    ? { text: `Saved ✓  MapMaker/projects/${r.file} (it now keeps itself up to date)` }
    : { text: 'Saved in this browser ✓' + (r.error ? ' — disk save failed: ' + r.error : ' (start the app with Start Map Maker.cmd to also save to disk)') });
}

export function pickFile(accept = '.json') {
  return new Promise((res) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.multiple = accept.includes('image');
    inp.onchange = () => res([...inp.files]);
    inp.click();
  });
}

export async function openProject() {
  if (window.showOpenFilePicker) {
    try {
      const [h] = await window.showOpenFilePicker({ types: [{ description: 'TVF map project', accept: { 'application/json': ['.json'] } }] });
      const f = await h.getFile();
      const p = JSON.parse(await f.text());
      if (p.format === 'tvf-map-unity') throw new Error('That is a Unity export, not a project file. Open the .tvfmap.json file instead.');
      fileHandle = h;
      loadProject(p, f.name);
      emit('toast', { text: 'Opened ' + f.name });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (err instanceof SyntaxError || err.message.includes('Unity')) { emit('toast', { text: err.message, kind: 'error' }); return; }
    }
  }
  const [f] = await pickFile('.json');
  if (!f) return;
  try {
    const p = JSON.parse(await f.text());
    fileHandle = null;
    loadProject(p, f.name);
    emit('toast', { text: 'Opened ' + f.name });
  } catch (err) { emit('toast', { text: 'Could not open: ' + err.message, kind: 'error' }); }
}
export function forgetFileHandle() { fileHandle = null; }

/** Merge maps from another project file into this one (new ids for clashes). */
export async function importMapsFrom() {
  const [f] = await pickFile('.json');
  if (!f) return null;
  const other = migrate(JSON.parse(await f.text()));
  return other;
}

// ---- Images -------------------------------------------------------------------------
export function readImageFile(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

/** Add image files to the project's image library. Returns the new asset ids. */
export async function importImages(files) {
  const ids = [];
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    if (f.size > 8 * 1024 * 1024) { emit('toast', { text: `${f.name} is over 8 MB, skipped`, kind: 'error' }); continue; }
    const data = await readImageFile(f);
    const id = uid('img');
    S.project.assets[id] = { name: f.name.replace(/\.[^.]+$/, ''), data, addedAt: Date.now() };
    ids.push(id);
  }
  if (ids.length) { S.dirty = true; emit('assets'); emit('change', {}); }
  return ids;
}

// ---- PNG -------------------------------------------------------------------------------
export function exportPNG(map, { scale = 24, transparent = false, labels = true, icons = true, view = S.view, discovered = null } = {}) {
  const T = getTheme(S.project, map);
  const { canvas } = renderMapImage(map, S.project, T, { pxPerCell: scale, transparent, labels, icons, view, discovered });
  canvas.toBlob((b) => download(safe(map.name) + '.png', b, 'image/png'));
}

// ---- Unity ---------------------------------------------------------------------------
export function buildUnityExport(project = S.project) {
  const st = project.settings;
  const upm = st.unitsPerMetre;
  const cs = st.cellSize;
  const U = (v) => +(v * cs * upm).toFixed(4);    // grid -> unity
  const M = (v) => +(v * upm).toFixed(4);         // metres -> unity
  const cond = (c) => ({ chMin: c?.chMin ?? -1, chMax: c?.chMax ?? -1, times: c?.times ?? [], flag: c?.flag ?? '', notFlag: c?.notFlag ?? '' });
  const link = (l) => ({ mapId: l?.mapId ?? '', targetId: l?.targetId ?? '' });
  const deg = (r) => +(((r * 180) / Math.PI + 360) % 360).toFixed(2);

  const out = {
    format: 'tvf-map-unity', version: 1, project: project.name, exportedAt: new Date().toISOString(),
    unitsPerMetre: upm, cellSize: M(cs), wallHeight: M(st.wallHeight), doorHeight: M(st.doorHeight),
    wallThickness: M(st.wallThickness), eyeHeight: M(st.eyeHeight), startMapId: project.startMapId,
    chapters: project.chapters, times: project.times,
    flags: project.flags.map((f) => ({ id: f.id, name: f.name, desc: f.desc || '' })),
    characters: project.characters.map((c) => ({ id: c.id, name: c.name, color: c.color })),
    evidence: project.evidence.map((e) => ({ id: e.id, name: e.name, desc: e.desc || '' })),
    maps: [],
  };
  for (const m of project.maps) {
    const baked = bakeMap(m, null, { ignoreConds: true });
    const arrival = (el) => { const a = arrivalPoint(baked, el) ?? { x: 0, y: 0, face: 0 }; return { x: U(a.x), y: 0, z: -U(a.y), rotY: deg(a.face || 0) }; };
    const roomOf = (x, y) => cellAt(baked, x, y)?.el?.id ?? '';
    const md = {
      id: m.id, name: m.name, building: m.building || '', floor: m.floor ?? 1,
      elevation: M(m.elevation || 0), ox: U(m.ox || 0), oz: -U(m.oy || 0),
      rooms: [], walls: [], doors: [], stairs: [], markers: [], labels: [],
    };
    for (const e of m.elements) {
      if (e.type !== 'room') continue;
      const c = roomCenter(e);
      md.rooms.push({
        id: e.id, name: e.name || '', kind: e.kind, icon: e.asset ? 'asset:' + e.asset : e.icon || '', characterId: e.characterId || '',
        color: e.color || '', floorColor: e.floorColor || '', wallColor: e.wallColor || '', ceiling: e.ceiling !== false && e.kind !== 'outdoor',
        height: M(e.wallHeight || st.wallHeight), lighting: e.lighting || 'default', discover: e.discover || 'enter', discoverFlag: e.discoverFlag || '',
        locked: !!e.locked, unlockChapter: e.unlockChapter ?? -1, lockMsg: e.lockMsg || '', tags: e.tags || '', notes: e.notes || '', cond: cond(e.cond),
        center: { x: U(c.x), y: 0, z: -U(c.y) },
        rects: e.rects.map((r) => ({ cx: U(r.x + r.w / 2), cz: -U(r.y + r.h / 2), w: U(r.w), d: U(r.h) })),
      });
    }
    const hOf = (el) => M(el && el.type === 'room' && el.wallHeight ? el.wallHeight : st.wallHeight);
    for (const w of baked.walls) {
      md.walls.push({ ax: U(w.x1), az: -U(w.y1), bx: U(w.x2), bz: -U(w.y2), base: 0, height: Math.max(hOf(w.a), hOf(w.b)), roomA: w.a?.id ?? '', roomB: w.b?.id ?? '' });
    }
    for (const d of m.elements.filter((e) => e.type === 'door')) {
      const c = doorCenter(d);
      const info = baked.doorInfo.get(d);
      md.doors.push({
        id: d.id, name: d.name || '', x: U(c.x), z: -U(c.y), width: U(d.len), height: M(st.doorHeight), rotY: d.orient === 'h' ? 0 : 90,
        style: d.style, lock: d.lock, lockMsg: d.lockMsg || '', unlockFlag: d.unlockFlag || '', unlockChapter: d.unlockChapter ?? -1,
        roomA: info?.a?.el.id ?? '', roomB: info?.b?.el.id ?? '', link: link(d.link), cond: cond(d.cond), arrival: arrival(d),
      });
    }
    for (const s of m.elements.filter((e) => e.type === 'stairs')) {
      const r = s.rects[0];
      md.stairs.push({
        id: s.id, name: s.name || '', cx: U(r.x + r.w / 2), cz: -U(r.y + r.h / 2), w: U(r.w), d: U(r.h),
        rotY: { n: 0, e: 90, s: 180, w: 270 }[s.dir] ?? 0, goes: s.goes, unlockChapter: s.unlockChapter ?? -1, lockMsg: s.lockMsg || '', link: link(s.link), cond: cond(s.cond), arrival: arrival(s),
      });
    }
    for (const k of m.elements.filter((e) => e.type === 'marker' && e.kind !== 'note')) {
      md.markers.push({
        id: k.id, kind: k.kind, name: k.name || '', x: U(k.x), y: 0, z: -U(k.y), rotY: k.rot || 0,
        w: U(k.w || 1), d: U(k.h || 1), height: M(k.height || 1),
        characterId: k.characterId || '', pose: k.pose || '', text: k.text || '', evidenceId: k.evidenceId || '', required: !!k.required,
        icon: k.asset ? 'asset:' + k.asset : k.icon || '', color: k.color || '', prefab: k.prefab || '',
        lightColor: k.lightColor || '#ffffff', intensity: k.intensity ?? 1, range: U(k.range || 6),
        triggerType: k.kind === 'trigger' ? k.triggerType : '', once: !!k.once, eventId: k.eventId || '',
        roomId: roomOf(k.x, k.y), link: link(k.link), cond: cond(k.cond), arrival: arrival(k),
      });
    }
    for (const l of m.elements.filter((e) => e.type === 'label')) {
      md.labels.push({ id: l.id, text: l.text || '', x: U(l.x), z: -U(l.y), size: l.size || 1, cond: cond(l.cond) });
    }
    out.maps.push(md);
  }
  return out;
}

export function exportUnity() {
  const data = buildUnityExport();
  download(safe(S.project.name) + '.tvfmap-unity.json', JSON.stringify(data, null, 1));
}

/** C# constants so code can refer to maps, flags, characters and evidence by name. */
export function exportCSharp() {
  const p = S.project;
  const ident = (s) => {
    let t = (s || 'Unnamed').replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^[^A-Za-z_]+/, '');
    t = t.charAt(0).toUpperCase() + t.slice(1);
    return t || 'Unnamed';
  };
  const block = (name, items) => {
    const used = new Set();
    const lines = items.map(([n, id]) => {
      let k = ident(n); let i = 2;
      while (used.has(k)) k = ident(n) + i++;
      used.add(k);
      return `        public const string ${k} = "${id}";`;
    });
    return `    public static class ${name}\n    {\n${lines.join('\n')}\n    }`;
  };
  const roomItems = [];
  for (const m of p.maps) for (const e of m.elements) if (e.type === 'room' && e.kind === 'room' && e.name) roomItems.push([m.name + ' ' + e.name, e.id]);
  const src = `// Generated by TVF Map Maker from "${p.name}" on ${new Date().toISOString()}.
// Do not edit by hand: re-export from the Map Maker instead.
namespace TVF.MapIds
{
${block('Maps', p.maps.map((m) => [m.name, m.id]))}

${block('Flags', p.flags.map((f) => [f.name, f.id]))}

${block('Characters', p.characters.map((c) => [c.name, c.id]))}

${block('Evidence', p.evidence.map((e) => [e.name, e.id]))}

${block('Rooms', roomItems)}

    public static class Chapters
    {
${p.chapters.map((c, i) => `        public const int ${ident(c)} = ${i};`).join('\n')}
    }

    public static class Times
    {
${p.times.map((c, i) => `        public const int ${ident(c)} = ${i};`).join('\n')}
    }
}
`;
  download('MapIds.cs', src, 'text/plain');
}

/** .glb of one map or the whole building (uses three.js GLTFExporter, loaded on demand). */
export async function exportGLB(which = 'map') {
  const THREE = await import('three');
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  const { buildMapGroup } = await import('./view3d.js');
  const root = new THREE.Group();
  const maps = which === 'map' ? [S.project.maps.find((m) => m.id === S.mapId)] : S.project.maps;
  const cs = S.project.settings.cellSize;
  for (const m of maps) {
    const b = buildMapGroup(m, S.project, { ceilings: true, forExport: true, view: null });
    b.group.position.set((m.ox || 0) * cs, m.elevation || 0, (m.oy || 0) * cs);
    if (which === 'map') b.group.position.set(0, 0, 0);
    root.add(b.group);
  }
  const ex = new GLTFExporter();
  const result = await ex.parseAsync(root, { binary: true });
  download(safe(which === 'map' ? maps[0].name : S.project.name) + '.glb', new Blob([result], { type: 'model/gltf-binary' }));
}
