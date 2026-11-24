// Project home screen: every project saved in this browser, shown as cards with live map thumbnails.
import { S, loadProject, getIndex, setIndex, saveToLibrary, loadFromLibrary, kvGet, kvSet, kvDelete, autosaveNow, setThumbMaker, emit, on } from './store.js';
import { h, toast, ask, confirmBox, contextMenu, modal } from './dom.js';
import { renderMapImage } from './render2d.js';
import { getTheme, THEMES } from './themes.js';
import { newProject, migrate, uid } from './model.js';
import { sampleProject } from './generators.js';
import { download, pickFile, listDisk, readDisk } from './export.js';

let root, view = 'recents', search = '', sort = 'updated', layout = localStorage.getItem('tvf-home-layout') || 'grid';
let onOpened = () => {};
let hoverTimer = 0;

// ---- thumbnails --------------------------------------------------------------------------------
export function makeThumbs(p) {
  const order = [p.maps.find((m) => m.id === p.startMapId), ...p.maps.filter((m) => m.id !== p.startMapId)].filter(Boolean).slice(0, 4);
  return order.map((m) => {
    const T = getTheme(p, m);
    const W = 400, H = 225;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = T.bg; g.fillRect(0, 0, W, H);
    if (m.elements.length) {
      const { canvas } = renderMapImage(m, p, T, { pxPerCell: 12, margin: 1, transparent: true, labels: false });
      const s = Math.min((W - 24) / canvas.width, (H - 24) / canvas.height, 2.2);
      g.imageSmoothingEnabled = true;
      g.drawImage(canvas, (W - canvas.width * s) / 2, (H - canvas.height * s) / 2, canvas.width * s, canvas.height * s);
    } else {
      g.fillStyle = T.grid || 'rgba(0,0,0,.1)';
      for (let x = 0; x < W; x += 16) g.fillRect(x, 0, 1, H);
      for (let y = 0; y < H; y += 16) g.fillRect(0, y, W, 1);
    }
    g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(8, H - 26, Math.min(W - 16, 14 + m.name.length * 8), 18);
    g.fillStyle = '#fff'; g.font = 'bold 12px system-ui'; g.fillText(m.name, 15, H - 13);
    return c.toDataURL('image/jpeg', 0.82);
  });
}
setThumbMaker(makeThumbs);

// ---- setup -------------------------------------------------------------------------------------
export function initHome(el, opened) {
  root = el;
  onOpened = opened;
  on('library', () => { if (isHomeOpen()) render(); });
  root.addEventListener('dragover', (e) => e.preventDefault());
  root.addEventListener('drop', async (e) => {
    e.preventDefault();
    const files = [...e.dataTransfer.files].filter((f) => f.name.endsWith('.json'));
    for (const f of files) await importFile(f);
  });
  window.addEventListener('keydown', (e) => {
    if (!isHomeOpen() || document.querySelector('.modal-back')) return;
    const typing = e.target.tagName === 'INPUT';
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); root.querySelector('.hm-search')?.focus(); }
    else if (e.key === 'Escape' && !typing && root.dataset.back) closeHome();
  }, true);
}

export function isHomeOpen() { return root?.classList.contains('show'); }

/** Called once at start-up: moves the old single autosave into the library and seeds the sample. */
export async function prepareLibrary() {
  let list = await getIndex();
  if (!list.length) {
    const old = await kvGet('autosave');
    if (old?.json) {
      try {
        const p = migrate(JSON.parse(old.json));
        await saveToLibrary(p, { thumbs: true, opened: true });
        await kvSet('lastOpen', { id: p.id, mapId: old.mapId });
        await kvDelete('autosave');
      } catch (err) { console.warn(err); }
    }
    list = await getIndex();
    if (!list.length) await saveToLibrary(sampleProject(), { thumbs: true });
  }
}

export async function openHome({ canGoBack = false } = {}) {
  if (canGoBack && S.project) await autosaveNow({ thumbs: true, touch: false });
  root.dataset.back = canGoBack ? '1' : '';
  root.classList.add('show');
  document.body.classList.add('home-open');
  await render();
  setTimeout(() => root.querySelector('.hm-search')?.focus({ preventScroll: true }), 50);
}
export function closeHome() {
  root.classList.remove('show');
  document.body.classList.remove('home-open');
  clearInterval(hoverTimer);
}

async function openProjectId(id) {
  const p = await loadFromLibrary(id);
  if (!p) return toast('That project could not be found in this browser.', 'error');
  const last = await kvGet('lastOpen');
  loadProject(p);
  if (last?.id === id && last.mapId && S.project.maps.find((m) => m.id === last.mapId)) { S.mapId = last.mapId; emit('map'); }
  await saveToLibrary(S.project, { opened: true, touch: false });
  await kvSet('lastOpen', { id, mapId: S.mapId });
  closeHome();
  onOpened(S.project);
}

async function createProject(kind) {
  let p;
  if (kind === 'sample') p = sampleProject();
  else {
    const name = await ask('New project', 'What is it called?', 'My fangan');
    if (name === null) return;
    p = newProject(name.trim() || 'Untitled project');
  }
  await saveToLibrary(p, { thumbs: true });
  await openProjectId(p.id);
}

async function importFile(f) {
  try {
    const raw = JSON.parse(await f.text());
    if (raw.format === 'tvf-map-unity') throw new Error('That is a Unity export. Open the .tvfmap.json project file instead.');
    const p = migrate(raw);
    const list = await getIndex();
    if (list.some((x) => x.id === p.id)) {
      const replace = await confirmBox('Project already here', `“${p.name}” is already in your projects. Replace the copy in this browser with the file, or keep both?`, 'Replace');
      if (!replace) { p.id = uid('proj'); p.name += ' (copy)'; }
    }
    await saveToLibrary(p, { thumbs: true });
    toast('Added ' + p.name);
    return p;
  } catch (err) { toast('Could not open ' + f.name + ': ' + err.message, 'error'); return null; }
}

// ---- actions on one project ------------------------------------------------------------------------
async function patch(id, fn) {
  const list = await getIndex();
  const e = list.find((x) => x.id === id);
  if (!e) return;
  fn(e, list);
  await setIndex(list);
}
async function renameProject(e) {
  const n = await ask('Rename project', 'New name', e.name);
  if (!n) return;
  const p = await loadFromLibrary(e.id);
  if (!p) return;
  p.name = n;
  if (S.project?.id === e.id) S.project.name = n;
  await saveToLibrary(p, { touch: false });
  emit('change', {});
}
async function duplicateProject(e) {
  const p = await loadFromLibrary(e.id);
  if (!p) return;
  p.id = uid('proj'); p.name = e.name + ' copy';
  await saveToLibrary(p, { thumbs: true });
  toast('Duplicated ' + e.name);
}
async function downloadProject(e) {
  const p = await loadFromLibrary(e.id);
  if (p) download((p.name || 'project').replace(/[^\w\- ]+/g, '') + '.tvfmap.json', JSON.stringify(p, null, 1));
}
async function deleteForever(e) {
  if (!(await confirmBox('Delete forever', `Permanently delete “${e.name}” from this browser? This can’t be undone. (Download it first if you might want it later.)`, 'Delete forever', true))) return;
  await kvDelete('proj:' + e.id);
  await patch(e.id, (x, list) => list.splice(list.indexOf(x), 1));
}
function cardMenu(e, x, y) {
  contextMenu(x, y, [
    e.trashed ? null : { label: '📂 Open', action: () => openProjectId(e.id) },
    e.trashed ? null : { label: '✏️ Rename', action: () => renameProject(e) },
    e.trashed ? null : { label: '⧉ Duplicate', action: () => duplicateProject(e) },
    { label: '⤓ Download project file', action: () => downloadProject(e) },
    e.trashed ? null : { label: e.starred ? '☆ Unstar' : '★ Star', action: () => patch(e.id, (q) => { q.starred = !q.starred; }) },
    '-',
    e.trashed ? { label: '↩ Restore', action: () => patch(e.id, (q) => { q.trashed = false; }) } : { label: '🗑 Move to trash', action: () => { if (S.project?.id === e.id && root.dataset.back) root.dataset.back = ''; patch(e.id, (q) => { q.trashed = true; q.trashedAt = Date.now(); }); toast('Moved to trash'); } },
    e.trashed ? { label: '⛔ Delete forever', action: () => deleteForever(e) } : null,
  ]);
}

// ---- rendering -----------------------------------------------------------------------------------
export function ago(t) {
  if (!t) return 'never';
  const s = Math.max(1, Math.round((Date.now() - t) / 1000));
  const units = [[31536000, 'year'], [2592000, 'month'], [604800, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];
  for (const [n, u] of units) if (s >= n) { const v = Math.floor(s / n); return `${v} ${u}${v > 1 ? 's' : ''} ago`; }
  return 'just now';
}

async function render() {
  const all = await getIndex();
  const live = all.filter((e) => !e.trashed);
  let list = view === 'trash' ? all.filter((e) => e.trashed) : view === 'starred' ? live.filter((e) => e.starred) : live;
  const q = search.trim().toLowerCase();
  if (q) list = list.filter((e) => (e.name + ' ' + (e.stats?.buildings || []).join(' ')).toLowerCase().includes(q));
  const key = { updated: (e) => -(e.updatedAt || 0), opened: (e) => -(e.openedAt || e.updatedAt || 0), created: (e) => -(e.createdAt || 0), name: (e) => e.name.toLowerCase() }[sort];
  list = [...list].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  const lastOpen = await kvGet('lastOpen');
  const hero = view === 'recents' && !q ? live.find((e) => e.id === lastOpen?.id) : null;
  const titles = { recents: 'Recent projects', all: 'All projects', starred: 'Starred', trash: 'Trash', disk: 'Projects folder' };
  const usage = await navigator.storage?.estimate?.().catch(() => null);

  const nav = (id, icon, label, count) => h('button', { class: 'hm-nav' + (view === id ? ' on' : ''), onclick: () => { view = id; render(); } }, h('span', null, icon), label, count != null ? h('span', { class: 'hm-count' }, count) : null);

  const side = h('aside', { class: 'hm-side' },
    h('div', { class: 'hm-brand' }, h('span', { class: 'logo' }, '▦'), ' TVF ', h('b', null, 'MAP MAKER')),
    h('input', { class: 'hm-search', placeholder: '🔍  Search projects', value: search, oninput: (e) => { search = e.target.value; render().then(() => { const s = root.querySelector('.hm-search'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }); } }),
    nav('recents', '🕘', 'Recents'),
    nav('all', '▦', 'All projects', live.length),
    nav('starred', '★', 'Starred', live.filter((e) => e.starred).length || null),
    nav('trash', '🗑', 'Trash', all.filter((e) => e.trashed).length || null),
    nav('disk', '📁', 'Projects folder'),
    h('div', { class: 'hm-sechead' }, 'Starred'),
    live.filter((e) => e.starred).length
      ? live.filter((e) => e.starred).map((e) => h('button', { class: 'hm-nav small', onclick: () => openProjectId(e.id) }, h('span', { class: 'hm-sw', style: { background: (THEMES[e.theme] || THEMES.dr1).accent } }), e.name))
      : h('div', { class: 'hm-hint' }, 'Star a project to pin it here.'),
    h('div', { class: 'grow' }),
    usage ? h('div', { class: 'hm-hint' }, `Browser storage: ${(usage.usage / 1048576).toFixed(1)} MB used`) : null,
    h('div', { class: 'hm-hint' }, 'Projects are kept in this browser. Download a project file to share it or back it up.'),
  );

  if (view === 'disk') { root.replaceChildren(side, await diskView(all)); return; }
  const cards = list.map((e) => card(e));
  const newCard = view !== 'trash' && !q ? h('div', { class: 'hm-card hm-new', onclick: () => createProject('blank') }, h('div', { class: 'hm-thumb' }, h('span', null, '＋')), h('div', { class: 'hm-meta' }, h('b', null, 'New blank project'), h('span', null, 'Start from an empty grid'))) : null;

  const main = h('main', { class: 'hm-main' },
    h('header', { class: 'hm-top' },
      root.dataset.back ? h('button', { class: 'hm-btn', onclick: closeHome, title: 'Back to the project you had open (Esc)' }, '← Back to ' + (S.project?.name ?? 'project')) : null,
      h('h1', null, titles[view]),
      h('div', { class: 'grow' }),
      view !== 'trash' ? [
        h('button', { class: 'hm-btn primary', onclick: () => createProject('blank') }, '＋ New project'),
        h('button', { class: 'hm-btn', onclick: async () => { const files = await pickFile('.json'); for (const f of files) { const p = await importFile(f); if (p && files.length === 1) openProjectId(p.id); } } }, '📂 Open file'),
        h('button', { class: 'hm-btn', onclick: () => createProject('sample'), title: 'A ready-made school with 3 linked maps to explore' }, '🏫 Sample school'),
      ] : (all.some((e) => e.trashed) ? h('button', { class: 'hm-btn danger', onclick: async () => {
        const t = all.filter((e) => e.trashed);
        if (!(await confirmBox('Empty trash', `Permanently delete ${t.length} project(s) from this browser? This can’t be undone.`, 'Empty trash', true))) return;
        for (const e of t) await kvDelete('proj:' + e.id);
        await setIndex(all.filter((e) => !e.trashed));
      } }, 'Empty trash') : null),
      h('select', { class: 'hm-sort', onchange: (e) => { sort = e.target.value; render(); } },
        [['updated', 'Last edited'], ['opened', 'Last opened'], ['created', 'Date created'], ['name', 'Name']].map(([v, l]) => h('option', { value: v, selected: sort === v }, l))),
      h('div', { class: 'hm-seg' },
        h('button', { class: layout === 'grid' ? 'on' : '', title: 'Grid', onclick: () => { layout = 'grid'; localStorage.setItem('tvf-home-layout', layout); render(); } }, '▦'),
        h('button', { class: layout === 'list' ? 'on' : '', title: 'List', onclick: () => { layout = 'list'; localStorage.setItem('tvf-home-layout', layout); render(); } }, '☰'))),
    hero ? heroCard(hero) : null,
    list.length || newCard
      ? h('div', { class: layout === 'grid' ? 'hm-grid' : 'hm-list' }, layout === 'grid' ? newCard : null, cards)
      : h('div', { class: 'hm-empty' }, view === 'trash' ? 'Trash is empty.' : view === 'starred' ? 'No starred projects yet. Right-click a project › Star.' : q ? 'No projects match “' + search + '”.' : 'No projects yet.'),
    h('div', { class: 'hm-drop' }, 'Tip: drop .tvfmap.json files anywhere here to add them.'),
  );
  root.replaceChildren(side, main);
}

/** Projects saved into MapMaker/projects/ with Ctrl+S (read through the local server). */
async function diskView(all) {
  const files = await listDisk();
  const head = h('header', { class: 'hm-top' }, h('h1', null, 'Projects folder'), h('div', { class: 'grow' }),
    h('button', { class: 'hm-btn', onclick: () => render() }, '↻ Refresh'));
  if (!files) return h('main', { class: 'hm-main' }, head, h('div', { class: 'hm-empty' }, 'The projects folder is only available when the app runs from Start Map Maker.cmd.'));
  const rows = files.sort((a, b) => b.savedAt - a.savedAt).map((f) => {
    const lib = all.find((e) => e.id === f.id);
    return h('div', { class: 'hm-row', onclick: () => openDiskFile(f, lib) },
      lib?.thumbs?.[0] ? h('img', { src: lib.thumbs[0] }) : h('span', { class: 'hm-nothumb' }, '📄'),
      h('b', null, f.name), h('span', null, f.file), h('span', null, (f.size / 1024).toFixed(0) + ' KB'),
      h('span', null, 'Saved ' + ago(f.savedAt)), h('span'), h('span'));
  });
  return h('main', { class: 'hm-main' }, head,
    h('div', { class: 'hm-hint', style: { padding: '0 0 12px' } }, 'Files in MapMaker\\projects\\. Ctrl+S in the editor saves here, and the file then keeps itself up to date. Put this folder in Git or a shared drive to work as a team.'),
    rows.length ? h('div', { class: 'hm-list' }, rows) : h('div', { class: 'hm-empty' }, 'Nothing saved to disk yet. Open a project and press Ctrl+S.'));
}

async function openDiskFile(f, lib) {
  try {
    const p = migrate(await readDisk(f.file));
    p.diskFile = f.file;
    if (lib && (lib.updatedAt || 0) > f.savedAt + 2000) {
      const useDisk = await confirmBox('Which copy?', `The copy of “${p.name}” in this browser was edited after the file on disk was saved. Open the disk file anyway (replacing the browser copy)?`, 'Use the disk file');
      if (!useDisk) return openProjectId(lib.id);
    }
    await saveToLibrary(p, { thumbs: true, touch: false });
    await openProjectId(p.id);
  } catch (err) { toast('Could not open ' + f.file + ': ' + err.message, 'error'); }
}

function thumbBox(e, big = false) {
  const thumbs = e.thumbs?.length ? e.thumbs : [];
  const img = h('img', { src: thumbs[0] || '', alt: '' });
  const box = h('div', { class: 'hm-thumb' + (big ? ' big' : '') }, thumbs[0] ? img : h('span', { class: 'hm-nothumb' }, '▦'),
    thumbs.length > 1 ? h('div', { class: 'hm-dots' }, thumbs.map((_, i) => h('i', { class: i === 0 ? 'on' : '' }))) : null);
  // flip through the maps on hover
  box.addEventListener('mouseenter', () => {
    if (thumbs.length < 2) return;
    let i = 0;
    clearInterval(hoverTimer);
    hoverTimer = setInterval(() => {
      i = (i + 1) % thumbs.length; img.src = thumbs[i];
      box.querySelectorAll('.hm-dots i').forEach((d, j) => d.classList.toggle('on', j === i));
    }, 850);
  });
  box.addEventListener('mouseleave', () => { clearInterval(hoverTimer); img.src = thumbs[0] || ''; box.querySelectorAll('.hm-dots i').forEach((d, j) => d.classList.toggle('on', j === 0)); });
  return box;
}

function card(e) {
  const s = e.stats || {};
  const accent = (THEMES[e.theme] || THEMES.dr1).accent;
  const open = () => (e.trashed ? null : openProjectId(e.id));
  const star = h('button', { class: 'hm-star' + (e.starred ? ' on' : ''), title: e.starred ? 'Unstar' : 'Star', onclick: (ev) => { ev.stopPropagation(); patch(e.id, (q) => { q.starred = !q.starred; }); } }, e.starred ? '★' : '☆');
  const more = h('button', { class: 'hm-more', title: 'More', onclick: (ev) => { ev.stopPropagation(); cardMenu(e, ev.clientX, ev.clientY); } }, '⋯');
  const current = S.project?.id === e.id && root.dataset.back;
  if (layout === 'list') {
    return h('div', { class: 'hm-row' + (e.trashed ? ' trashed' : ''), onclick: open, oncontextmenu: (ev) => { ev.preventDefault(); cardMenu(e, ev.clientX, ev.clientY); } },
      h('img', { src: e.thumbs?.[0] || '' }),
      h('b', null, e.name, current ? h('span', { class: 'hm-tag' }, 'open') : null),
      h('span', null, `${s.maps ?? '?'} map${s.maps === 1 ? '' : 's'} · ${s.rooms ?? 0} rooms`),
      h('span', null, (s.buildings || []).join(', ')),
      h('span', null, 'Edited ' + ago(e.updatedAt)),
      star, more);
  }
  return h('div', { class: 'hm-card' + (e.trashed ? ' trashed' : ''), onclick: open, oncontextmenu: (ev) => { ev.preventDefault(); cardMenu(e, ev.clientX, ev.clientY); }, title: e.trashed ? 'In the trash — right-click to restore' : 'Open ' + e.name },
    thumbBox(e), star, more,
    h('div', { class: 'hm-meta' },
      h('div', { class: 'hm-name' }, h('span', { class: 'hm-sw', style: { background: accent } }), h('b', null, e.name), current ? h('span', { class: 'hm-tag' }, 'open') : null),
      h('span', null, e.trashed ? 'In trash · ' + ago(e.trashedAt) : 'Edited ' + ago(e.updatedAt)),
      h('div', { class: 'hm-chips' },
        h('i', null, `${s.maps ?? '?'} map${s.maps === 1 ? '' : 's'}`), h('i', null, `${s.rooms ?? 0} rooms`),
        s.links ? h('i', null, `⇄ ${s.links}`) : null, s.characters ? h('i', null, `👤 ${s.characters}`) : null)));
}

function heroCard(e) {
  const s = e.stats || {};
  return h('section', { class: 'hm-hero', onclick: () => openProjectId(e.id) },
    thumbBox(e, true),
    h('div', { class: 'hm-hero-info' },
      h('div', { class: 'hm-kicker' }, 'Continue where you left off'),
      h('h2', null, e.name),
      h('p', null, `Edited ${ago(e.updatedAt)} · opened ${ago(e.openedAt)}`),
      h('div', { class: 'hm-chips big' },
        h('i', null, `${s.maps ?? '?'} maps`), h('i', null, `${s.rooms ?? 0} rooms`), h('i', null, `⇄ ${s.links ?? 0} links`), h('i', null, `👤 ${s.characters ?? 0} characters`),
        ...(s.buildings || []).map((b) => h('i', null, '🏢 ' + b))),
      h('button', { class: 'hm-btn primary big', onclick: (ev) => { ev.stopPropagation(); openProjectId(e.id); } }, 'Continue editing →')));
}

export { modal };
