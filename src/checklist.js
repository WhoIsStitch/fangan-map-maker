// Checklist: paste a room list (by chapter, with floors) and track what's left to do for each room.
import { S, map, change, emit } from './store.js';
import { h, modal, toast, confirmBox } from './dom.js';
import { newRoom, newMap, uid, elementBounds } from './model.js';
import { bakeMap } from './bake.js';
import { mapBounds } from './render2d.js';

// An example room list, shown the first time you open the checklist. Replace it with your own.
export const DEFAULT_LIST = `Prologue:
Entrance Hall (F1)
Dormitory Corridor (F1)
Player's Room (F1)
Gym (F1)

Chapter 1:
Dining Hall (F1)
Kitchen (F1)
Warehouse (F1)

Chapter 2:
Library (F2)
Pool (F2)
Classroom (F2)`;

const MANUAL = [['props', 'Furnished (props)'], ['spots', 'Examine spots / evidence'], ['walked', 'Walked through in 3D']];

const norm = (s) => (s || '').toLowerCase().replace(/[’‘`]/g, "'").replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const floorNum = (f) => { const m = /(?:f\s*(\d+)|(\d+)\s*f)/i.exec(f || ''); return m ? +(m[1] ?? m[2]) : null; };

/** Read a pasted list: chapter headings ("Chapter 1:") then one room per line, optional "(F1)". */
export function parseList(text, project) {
  const out = [];
  let chapter = -1, order = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const n = norm(line);
    const ci = project.chapters.findIndex((c) => n.startsWith(norm(c)));
    if (ci >= 0 && (line.endsWith(':') || /:\s*\(.*\)$/.test(line) || n === norm(project.chapters[ci]))) { chapter = ci; continue; }
    if (/^[^()]*:$/.test(line)) { chapter = -1; continue; } // a heading we don't know
    const fm = /\(([^)]*)\)\s*$/.exec(line);
    out.push({ id: uid('plan'), name: line.replace(/\s*\([^)]*\)\s*$/, '').trim(), floor: fm ? fm[1].trim().toUpperCase() : '', chapter, order: order++, done: {} });
  }
  return out;
}

function planToText(plan, project) {
  const parts = [];
  const chs = [...new Set(plan.map((p) => p.chapter))].sort((a, b) => a - b);
  for (const c of chs) {
    parts.push((c >= 0 ? project.chapters[c] : 'No chapter') + ':');
    for (const p of plan.filter((x) => x.chapter === c)) parts.push(p.name + (p.floor ? ` (${p.floor})` : ''));
    parts.push('');
  }
  return parts.join('\n').trim();
}

/** Find the room (or whole map / area) a list entry refers to. */
function findPlace(p, project) {
  const want = norm(p.name);
  for (const m of project.maps) for (const e of m.elements) if (e.type === 'room' && e.kind !== 'blocked' && norm(e.name) === want) return { map: m, el: e };
  const m = project.maps.find((x) => norm(x.name) === want);
  return m ? { map: m, el: null } : null;
}

/** Work out every check for every entry. */
function evaluate(project, issues) {
  const unreachable = new Set(issues.filter((i) => /can't be reached/.test(i.text)).map((i) => i.elId));
  const bakes = new Map();
  const baked = (m) => { if (!bakes.has(m.id)) bakes.set(m.id, bakeMap(m, null, { ignoreConds: true })); return bakes.get(m.id); };
  return (project.plan || []).map((p) => {
    const f = findPlace(p, project);
    const checks = [];
    const add = (key, label, state, fix) => checks.push({ key, label, state, fix });
    add('drawn', 'Drawn', f ? 'ok' : 'todo', f ? null : 'draw');
    const fl = floorNum(p.floor);
    if (fl == null) add('floor', 'Floor', 'na');
    else add('floor', `On ${p.floor}`, !f ? 'todo' : (f.map.floor === fl ? 'ok' : 'bad'));
    const room = f?.el;
    if (room) {
      const want = p.chapter <= 0 ? null : p.chapter; // Prologue / no chapter = open from the start
      const has = room.unlockChapter ?? -1;
      const ok = want == null ? has <= 0 : has === want;
      add('lock', want == null ? 'Open from the start' : `Unlocks in ${project.chapters[want]}`, ok ? 'ok' : 'bad', ok ? null : 'lock');
      if (room.kind === 'room') {
        const b = baked(f.map);
        const door = room.open || b.openings.some((o) => o.a?.el === room || o.b?.el === room);
        add('door', 'Has a door', door ? 'ok' : 'todo');
        add('reach', 'Reachable', unreachable.has(room.id) ? 'bad' : 'ok');
      }
    } else if (f) add('lock', 'Whole map / area', 'na');
    for (const [k, label] of MANUAL) add(k, label, p.done?.[k] ? 'ok' : 'todo', 'tick');
    const scored = checks.filter((c) => c.state !== 'na');
    return { p, f, checks, done: scored.filter((c) => c.state === 'ok').length, total: scored.length };
  });
}

// ---- actions ---------------------------------------------------------------------------------
function setPlan(plan, label) { change(label, () => { S.project.plan = plan; }); }

function mapForFloor(fl) {
  const cur = map();
  const same = S.project.maps.filter((m) => m.floor === fl && !m.isArea);
  return same.find((m) => m.building === cur.building) ?? same[0] ?? null;
}

/** Draw a placeholder room for a missing entry on the right floor (making that floor if needed). */
function drawPlaceholder(item, nth = 0) {
  const fl = floorNum(item.p.floor) ?? map().floor ?? 1;
  let m = mapForFloor(fl);
  let made = null;
  if (!m) { made = newMap(fl + 'F', fl); made.building = map().building; made.elevation = (fl - 1) * S.project.settings.floorGap; m = made; }
  const b = m.elements.length ? mapBounds(m) : { x: 0, y: 0, w: 0, h: 0 };
  const r = newRoom('room', { x: Math.round(b.x + b.w + 3), y: Math.round(b.y), w: 6, h: 5 }, item.p.name);
  if (item.p.chapter > 0) r.unlockChapter = item.p.chapter;
  return { map: m, made, room: r };
}

function makeRooms(items) {
  if (!items.length) return;
  const made = [];
  change(items.length === 1 ? 'Draw ' + items[0].p.name : `Draw ${items.length} missing rooms`, () => {
    const counts = new Map();
    for (const it of items) {
      const fl = floorNum(it.p.floor) ?? 0;
      const n = counts.get(fl) || 0; counts.set(fl, n + 1);
      const res = drawPlaceholder(it, n);
      if (res.made && !S.project.maps.includes(res.made)) S.project.maps.push(res.made);
      const live = S.project.maps.find((x) => x.id === res.map.id);
      live.elements.push(res.room);
      made.push({ mapId: live.id, id: res.room.id });
    }
  });
  toast(`Drew ${made.length} placeholder room${made.length > 1 ? 's' : ''}. Move and resize ${made.length > 1 ? 'them' : 'it'} into place, then add doors.`);
  if (made.length === 1) emit('goto', { mapId: made[0].mapId, elId: made[0].id });
}

function applyLocks(items) {
  const fix = items.filter((it) => it.f?.el && it.checks.some((c) => c.key === 'lock' && c.state === 'bad'));
  if (!fix.length) return toast('Every room already unlocks in the right chapter.');
  change(`Set ${fix.length} unlock chapter${fix.length > 1 ? 's' : ''}`, () => {
    for (const it of fix) {
      const live = S.project.maps.find((m) => m.id === it.f.map.id).elements.find((e) => e.id === it.f.el.id);
      live.unlockChapter = it.p.chapter <= 0 ? -1 : it.p.chapter;
    }
  });
  toast(`Set the unlock chapter on ${fix.length} room${fix.length > 1 ? 's' : ''}.`);
}

function editList() {
  const ta = h('textarea', { style: { width: '100%', height: '50vh', fontFamily: 'Consolas, monospace' } });
  ta.value = S.project.plan?.length ? planToText(S.project.plan, S.project) : DEFAULT_LIST;
  modal('Room list', h('div', null,
    h('p', { class: 'hint' }, 'One room per line, under chapter headings like “Chapter 1:”. Add the floor in brackets, e.g. “Canteen (F1)”. Names are matched to the rooms on your maps.'),
    ta), [
    { label: 'Cancel' },
    { label: 'Use this list', primary: true, onclick: () => {
      const old = new Map((S.project.plan || []).map((p) => [norm(p.name), p]));
      const plan = parseList(ta.value, S.project).map((p) => ({ ...p, done: old.get(norm(p.name))?.done ?? {} })); // keep your ticks
      setPlan(plan, 'Update room list');
      toast(`Checklist has ${plan.length} rooms.`);
    } },
  ], { wide: true });
}

function copyText(items) {
  const lines = [S.project.name + ' — map checklist', ''];
  const chs = [...new Set(items.map((i) => i.p.chapter))];
  for (const c of chs) {
    lines.push(`## ${c >= 0 ? S.project.chapters[c] : 'No chapter'}`);
    for (const it of items.filter((i) => i.p.chapter === c)) {
      const todo = it.checks.filter((x) => x.state === 'todo' || x.state === 'bad').map((x) => x.label);
      lines.push(`- [${todo.length ? ' ' : 'x'}] ${it.p.name}${it.p.floor ? ` (${it.p.floor})` : ''}${todo.length ? ' — to do: ' + todo.join(', ') : ''}`);
    }
    lines.push('');
  }
  navigator.clipboard?.writeText(lines.join('\n')).then(() => toast('Checklist copied as text'), () => toast('Could not copy', 'error'));
}

// ---- panel -----------------------------------------------------------------------------------
export function checklistPanel(issues, { goto }) {
  const plan = S.project.plan || [];
  if (!plan.length) {
    return h('div', null,
      h('p', null, 'Turn your room list into a checklist. For every room it tracks whether it is drawn, on the right floor, locked until the right chapter, has a door and can be reached, plus your own ticks.'),
      h('div', { class: 'btnrow' }, h('button', { class: 'primary', onclick: editList }, '📋 Add your room list…')));
  }
  const items = evaluate(S.project, issues);
  const done = items.reduce((a, i) => a + i.done, 0), total = items.reduce((a, i) => a + i.total, 0);
  const missing = items.filter((i) => !i.f);
  const icon = { ok: '✓', todo: '○', bad: '✗', na: '–' };
  const chs = [...new Set(items.map((i) => i.p.chapter))];
  const bar = (d, t) => h('div', { class: 'ck-bar' }, h('i', { style: { width: (t ? (100 * d) / t : 0) + '%' } }));

  return h('div', { class: 'ck' },
    h('div', { class: 'ck-head' }, h('b', null, `${done} / ${total} done`), h('span', { class: 'hint' }, ` · ${items.filter((i) => i.done === i.total).length} of ${items.length} rooms finished`)),
    bar(done, total),
    h('div', { class: 'btnrow' },
      h('button', { class: 'mini', onclick: () => applyLocks(items), title: 'Set every room’s “Unlocks in” chapter from the list' }, '🔒 Apply all chapter locks'),
      missing.length ? h('button', { class: 'mini', onclick: () => makeRooms(missing) }, `＋ Draw ${missing.length} missing`) : null,
      h('button', { class: 'mini', onclick: editList }, '✎ Edit list'),
      h('button', { class: 'mini', onclick: () => copyText(items) }, '⧉ Copy as text')),
    chs.map((c) => {
      const its = items.filter((i) => i.p.chapter === c);
      const d = its.reduce((a, i) => a + i.done, 0), t = its.reduce((a, i) => a + i.total, 0);
      return h('details', { class: 'ck-ch', open: d < t },
        h('summary', null, h('b', null, c >= 0 ? S.project.chapters[c] : 'No chapter'), h('span', { class: 'hint' }, ` ${d}/${t}`), bar(d, t)),
        its.map((it) => h('div', { class: 'ck-item' + (it.done === it.total ? ' done' : '') },
          h('div', { class: 'ck-name' },
            h('a', { href: '#', onclick: (e) => { e.preventDefault(); if (it.f) goto(it.f.map.id, it.f.el?.id); else makeRooms([it]); }, title: it.f ? `Go to it (${it.f.map.name})` : 'Not on any map yet — click to draw a placeholder' }, it.p.name),
            it.p.floor ? h('span', { class: 'ck-chip' }, it.p.floor) : null,
            it.f ? h('span', { class: 'hint' }, ' ' + it.f.map.name) : null),
          h('div', { class: 'ck-checks' }, it.checks.map((c) => h('span', {
            class: 'ck-c ' + c.state, title: c.label + ({ ok: ' — done', todo: ' — to do', bad: ' — needs fixing', na: ' — doesn’t apply' }[c.state]) + (c.fix === 'lock' ? ' (click to fix)' : c.fix === 'draw' ? ' (click to draw)' : c.fix === 'tick' ? ' (click to tick)' : ''),
            onclick: () => {
              if (c.fix === 'tick') change((it.p.done?.[c.key] ? 'Untick ' : 'Tick ') + c.label, () => { const p = S.project.plan.find((x) => x.id === it.p.id); p.done = { ...(p.done || {}), [c.key]: !p.done?.[c.key] }; });
              else if (c.fix === 'lock') applyLocks([it]);
              else if (c.fix === 'draw') makeRooms([it]);
              else if (it.f) goto(it.f.map.id, it.f.el?.id);
            },
          }, icon[c.state] + ' ' + c.label))))));
    }),
    h('div', { class: 'btnrow', style: { marginTop: '12px' } },
      h('button', { class: 'mini danger', onclick: async () => { if (await confirmBox('Clear checklist', 'Remove the room list and your ticks? (Rooms on the maps are not touched.)', 'Clear', true)) setPlan([], 'Clear checklist'); } }, 'Clear checklist')));
}
void elementBounds;
