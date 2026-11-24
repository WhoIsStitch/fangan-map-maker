// Tiny DOM helpers.
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    if ('type' in props) el.type = props.type;
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false || k === 'type') continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k in el && typeof v !== 'string') el[k] = v;
      else if (k === 'value' || k === 'checked' || k === 'selected') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

export function select(options, value, onchange, props = {}) {
  const s = h('select', props, options.map(([v, label]) => h('option', { value: v }, label)));
  s.value = value ?? '';
  s.addEventListener('change', () => onchange(s.value));
  return s;
}

export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

let toastWrap;
export function toast(text, kind = '') {
  toastWrap = toastWrap || document.getElementById('toasts');
  const t = h('div', { class: 'toast ' + kind }, text);
  toastWrap.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 6000 : 2600);
}

/** Modal dialog. Returns { close, body }. */
export function modal(title, body, buttons = [], opts = {}) {
  const root = document.getElementById('modalRoot');
  const back = h('div', { class: 'modal-back' });
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); opts.onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  const box = h('div', { class: 'modal' + (opts.wide ? ' wide' : '') },
    h('header', null, title, h('button', { class: 'x mini', onclick: close, title: 'Close (Esc)' }, '✕')),
    h('div', { class: 'body' }, body),
    buttons.length ? h('footer', null, buttons.map((b) => h('button', { class: b.primary ? 'primary' : b.danger ? 'danger' : '', onclick: () => { if (b.onclick?.() !== false) close(); } }, b.label))) : null,
  );
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });
  back.append(box);
  root.append(back);
  setTimeout(() => box.querySelector('input,select,textarea')?.focus(), 30);
  return { close, box };
}

export function ask(title, label, value = '') {
  return new Promise((res) => {
    const inp = h('input', { value, style: { width: '100%' } });
    let done = false;
    const m = modal(title, h('div', null, h('p', { class: 'hint' }, label), inp), [
      { label: 'Cancel', onclick: () => { done = true; res(null); } },
      { label: 'OK', primary: true, onclick: () => { done = true; res(inp.value); } },
    ], { onClose: () => { if (!done) res(null); } });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { done = true; res(inp.value); m.close(); } });
  });
}

export function confirmBox(title, text, okLabel = 'OK', danger = false) {
  return new Promise((res) => {
    let done = false;
    modal(title, h('p', null, text), [
      { label: 'Cancel', onclick: () => { done = true; res(false); } },
      { label: okLabel, primary: !danger, danger, onclick: () => { done = true; res(true); } },
    ], { onClose: () => { if (!done) res(false); } });
  });
}

export function contextMenu(x, y, items) {
  document.querySelectorAll('.ctx').forEach((c) => c.remove());
  const menu = h('div', { class: 'ctx', style: { left: x + 'px', top: y + 'px' } },
    items.filter(Boolean).map((it) => (it === '-' ? h('hr') : h('button', { onclick: () => { menu.remove(); it.action(); } }, it.label, it.key ? h('kbd', null, it.key) : null))));
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  if (r.right > innerWidth) menu.style.left = innerWidth - r.width - 6 + 'px';
  if (r.bottom > innerHeight) menu.style.top = innerHeight - r.height - 6 + 'px';
  setTimeout(() => document.addEventListener('pointerdown', function off(e) { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('pointerdown', off); } }), 0);
  return menu;
}
