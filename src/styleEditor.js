// Style editor: make your own map styles with a live preview. Styles live in project.customThemes.
import { S, map, change, emit } from './store.js';
import { h, modal, toast, confirmBox } from './dom.js';
import { THEMES, getTheme } from './themes.js';
import { renderMapImage } from './render2d.js';
import { uid } from './model.js';
import { download, pickFile } from './export.js';

const FONTS = [
  ['"Press Start 2P", "VT323", monospace', 'Pixel (monospace)'],
  ['"VT323", monospace', 'Terminal'],
  ['"Segoe UI", sans-serif', 'Clean sans'],
  ['"Rajdhani", "Segoe UI", sans-serif', 'Condensed'],
  ['"Arial Black", Impact, sans-serif', 'Heavy'],
  ['Georgia, serif', 'Serif'],
  ['"Comic Sans MS", "Comic Neue", cursive', 'Comic'],
  ['"Consolas", monospace', 'Code'],
];

const GROUPS = [
  ['Map colours', [
    ['bg', 'Background'], ['hall', 'Hallway floor'], ['room', 'Room fill'], ['line', 'Walls / outline'], ['inner', 'Inner line (rooms)'],
    ['text', 'Text'], ['icon', 'Icons'], ['iconLight', 'Icon highlight'], ['hatch', 'Blocked hatch'], ['hatchBg', 'Blocked background'],
    ['grid', 'Grid lines'], ['accent', 'Accent (selection, links)'],
  ]],
  ['Glow', [['glow', 'Glow colour']]],
  ['Doors & stairs', [['doorMark', 'Door bar colour'], ['stairs', 'Stairs fill'], ['stairsLine', 'Stairs stripes']]],
  ['3D walk & building view', [
    ['floor3d', 'Hallway floor'], ['roomFloor3d', 'Room floor'], ['wall3d', 'Walls'], ['ceiling3d', 'Ceiling'],
    ['door3d', 'Doors'], ['trim3d', 'Trim / skirting'], ['sky3d', 'Sky / void'],
  ]],
];
const OPTIONAL = new Set(['doorMark', 'stairs', 'stairsLine', 'inner']);

const put = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));

// colour helpers: keep "#rrggbb" or "rgba(r,g,b,a)"
function parse(c) {
  if (!c) return { hex: '#000000', a: 0, empty: true };
  if (c.startsWith('#')) {
    let x = c.slice(1);
    if (x.length === 3) x = x.split('').map((ch) => ch + ch).join('');
    return { hex: '#' + x.slice(0, 6), a: x.length === 8 ? parseInt(x.slice(6), 16) / 255 : 1 };
  }
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (m) {
    const [r, g, b, a = 1] = m[1].split(',').map((s) => parseFloat(s));
    return { hex: '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''), a };
  }
  return { hex: '#888888', a: 1 };
}
function build(hex, a) {
  if (a >= 0.999) return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${Math.round(a * 100) / 100})`;
}

export function styleEditor(startId) {
  const project = S.project;
  const current = startId || map().theme || project.settings.theme || 'dr1';
  let draft = { ...getTheme(project, { theme: current }) };
  let editingId = project.customThemes.some((t) => t.id === current) ? current : null;
  if (!editingId) { draft.name = (THEMES[current]?.name ?? 'Style') + ' (my version)'; }
  let applyTo = 'project';
  const preview = h('canvas', { class: 'se-preview' });
  const form = h('div', { class: 'se-form' });
  const side = h('div', { class: 'se-side' });
  let raf = 0;

  const redraw = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const r = preview.getBoundingClientRect();
      const W = Math.max(200, r.width), H = Math.max(160, r.height);
      const dpr = devicePixelRatio || 1;
      preview.width = W * dpr; preview.height = H * dpr;
      const g = preview.getContext('2d');
      g.scale(dpr, dpr);
      g.fillStyle = draft.bg; g.fillRect(0, 0, W, H);
      const { canvas } = renderMapImage(map(), project, draft, { pxPerCell: 22, margin: 1, transparent: true, view: S.view });
      const s = Math.min((W - 20) / canvas.width, (H - 64) / canvas.height, 1.4);
      g.drawImage(canvas, (W - canvas.width * s) / 2, (H - 54 - canvas.height * s) / 2 + 4, canvas.width * s, canvas.height * s);
      // 3D colour strip
      const keys = ['floor3d', 'roomFloor3d', 'wall3d', 'ceiling3d', 'door3d', 'trim3d', 'sky3d'];
      const bw = (W - 20) / keys.length;
      keys.forEach((k, i) => {
        g.fillStyle = draft[k]; g.fillRect(10 + i * bw, H - 44, bw - 4, 26);
        g.fillStyle = draft.text; g.font = '10px system-ui'; g.fillText(k.replace('3d', ''), 12 + i * bw, H - 6);
      });
    });
  };

  const colourRow = (key, label) => {
    const opt = OPTIONAL.has(key);
    const v = parse(draft[key]);
    const col = h('input', { type: 'color', value: v.hex });
    const alpha = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: v.empty ? 1 : v.a, title: 'Opacity' });
    const on = opt ? h('input', { type: 'checkbox', checked: !!draft[key] && !v.empty, title: 'Use this colour (off = default look)' }) : null;
    const update = () => {
      draft[key] = on && !on.checked ? '' : build(col.value, +alpha.value);
      redraw();
    };
    col.addEventListener('input', () => { if (on) on.checked = true; update(); });
    alpha.addEventListener('input', () => { if (on) on.checked = true; update(); });
    on?.addEventListener('change', update);
    return h('div', { class: 'se-row' }, h('label', null, label), on ?? h('span'), col, alpha);
  };

  const renderForm = () => {
    const name = h('input', { value: draft.name || '', placeholder: 'Style name' });
    name.addEventListener('input', () => { draft.name = name.value; });
    const font = h('select', null, FONTS.map(([v, l]) => h('option', { value: v, selected: draft.font === v }, l)), !FONTS.some(([v]) => v === draft.font) ? h('option', { value: draft.font, selected: true }, 'Custom: ' + draft.font) : null);
    font.addEventListener('change', () => { draft.font = font.value; redraw(); });
    const customFont = h('input', { placeholder: 'or type any installed font, e.g. "Courier New"' });
    customFont.addEventListener('change', () => { if (customFont.value.trim()) { draft.font = `"${customFont.value.trim().replace(/"/g, '')}", sans-serif`; redraw(); } });
    const glowSize = h('input', { type: 'range', min: 0, max: 30, step: 1, value: draft.glowSize ?? 0, style: { gridColumn: '2 / 5' } });
    glowSize.addEventListener('input', () => { draft.glowSize = +glowSize.value; redraw(); });
    const pixel = h('input', { type: 'checkbox', checked: !!draft.pixel });
    pixel.addEventListener('change', () => { draft.pixel = pixel.checked; redraw(); });
    put(form,
      h('div', { class: 'se-row' }, h('label', null, 'Name'), name),
      h('div', { class: 'se-row' }, h('label', null, 'Font'), font),
      h('div', { class: 'se-row' }, h('label', null, ''), customFont),
      h('div', { class: 'se-row' }, h('label', null, 'Crisp pixel images'), pixel),
      GROUPS.map(([title, keys]) => [
        h('h4', null, title),
        keys.map(([k, l]) => colourRow(k, l)),
        title === 'Glow' ? h('div', { class: 'se-row' }, h('label', null, 'Glow size'), glowSize) : null,
        title === 'Doors & stairs' ? h('div', { class: 'hint' }, 'Tick “Door bar colour” to draw doors as a coloured bar (V3 look) instead of little ticks.') : null,
      ]),
    );
  };

  const renderSide = () => {
    put(side,
      h('div', { class: 'hint' }, 'Start from a preset:'),
      Object.entries(THEMES).map(([id, t]) => h('button', { class: 'se-style', onclick: () => { draft = { ...t, name: t.name + ' (my version)' }; editingId = null; renderForm(); renderSide(); redraw(); } },
        h('span', { class: 'se-sw' }, ['bg', 'hall', 'room', 'line', 'accent'].map((k) => h('i', { style: { background: t[k] } }))), t.name)),
      h('div', { class: 'hint', style: { marginTop: '10px' } }, 'Your styles:'),
      project.customThemes.length ? project.customThemes.map((t) => h('button', { class: 'se-style' + (t.id === editingId ? ' on' : ''), onclick: () => { draft = { ...THEMES.dr1, ...t }; editingId = t.id; renderForm(); renderSide(); redraw(); } },
        h('span', { class: 'se-sw' }, ['bg', 'hall', 'room', 'line', 'accent'].map((k) => h('i', { style: { background: t[k] } }))), t.name)) : h('div', { class: 'hint' }, 'None yet. Edit a preset and press Save.'),
      h('div', { class: 'btnrow', style: { marginTop: '10px' } },
        h('button', { class: 'mini', title: 'Load a style someone shared (.tvfstyle.json)', onclick: async () => {
          const [f] = await pickFile('.json');
          if (!f) return;
          try { const t = JSON.parse(await f.text()); if (!t.bg || !t.hall) throw new Error('not a style file'); draft = { ...THEMES.dr1, ...t }; editingId = null; renderForm(); redraw(); toast('Loaded ' + (t.name || 'style') + ' — press Save to keep it'); } catch (e) { toast('Could not read style: ' + e.message, 'error'); }
        } }, '⤒ Import'),
        h('button', { class: 'mini', title: 'Save this style as a file to share', onclick: () => { const { id, ...t } = draft; download((draft.name || 'style').replace(/[^\w\- ]+/g, '') + '.tvfstyle.json', JSON.stringify(t, null, 1)); } }, '⤓ Export'),
        editingId ? h('button', { class: 'mini danger', onclick: async () => {
          if (!(await confirmBox('Delete style', `Delete “${draft.name}”? Maps using it go back to the project default.`, 'Delete', true))) return;
          const id = editingId;
          change('Delete style', () => {
            S.project.customThemes = S.project.customThemes.filter((t) => t.id !== id);
            if (S.project.settings.theme === id) S.project.settings.theme = 'dr1';
            for (const m of S.project.maps) if (m.theme === id) m.theme = '';
          });
          editingId = null; renderSide();
        } }, '🗑 Delete') : null),
    );
  };

  const save = (asNew) => {
    const id = !asNew && editingId ? editingId : uid('theme');
    const t = { ...draft, id, name: draft.name || 'My style' };
    change(editingId && !asNew ? 'Edit style' : 'Add style', () => {
      const list = S.project.customThemes;
      const i = list.findIndex((x) => x.id === id);
      if (i >= 0) list[i] = t; else list.push(t);
      if (applyTo === 'project') S.project.settings.theme = id;
      else S.project.maps.find((m) => m.id === S.mapId).theme = id;
    });
    editingId = id;
    renderSide();
    toast(`Saved “${t.name}”${applyTo === 'project' ? ' and set it as the project style' : ' for this map'}`);
    emit('view');
  };

  const applySel = h('select', { onchange: (e) => { applyTo = e.target.value; } }, h('option', { value: 'project' }, 'Use for the whole project'), h('option', { value: 'map' }, 'Use for this map only'));
  renderForm(); renderSide();
  modal('🎨 Style editor', h('div', { class: 'se' }, side, h('div', { class: 'se-mid' }, preview, h('div', { class: 'hint' }, 'Preview of “' + map().name + '”. Changes show live.')), form), [
    { label: 'Close' },
    { label: 'Save as new style', onclick: () => { save(true); return false; } },
    { label: 'Save', primary: true, onclick: () => { save(false); return false; } },
  ], { wide: true });
  setTimeout(redraw, 30);
  window.addEventListener('resize', redraw, { once: true });
  applySel.style.marginRight = 'auto';
  // put the "use for" picker into the footer
  setTimeout(() => document.querySelector('.modal:last-child footer, .modal-back:last-child footer')?.prepend(applySel), 0);
}
