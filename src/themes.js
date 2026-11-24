// Map styles. 2D colours are for the editor / map-screen / PNG export; *3d colours are used by the 3D views.

export const THEMES = {
  dr1: {
    name: 'Pink pixel', bg: '#fff6f4', hall: '#f9dcd8', room: '#f4a3a0', roomAlt: '#ef8f8c',
    line: '#3b2420', inner: '#fff2ee', glow: 'rgba(255,90,90,.75)', glowSize: 14, text: '#3b2420',
    icon: '#3b2420', iconLight: 'rgba(255,255,255,.6)', hatch: '#3b2420', hatchBg: '#f9dcd8', grid: 'rgba(59,36,32,.08)',
    accent: '#e8465a', font: '"Press Start 2P", "VT323", monospace', pixel: true,
    floor3d: '#d8c2bf', roomFloor3d: '#c99d97', wall3d: '#f1dcd7', ceiling3d: '#efe4e1', door3d: '#b23b4a', trim3d: '#4b2a26', sky3d: '#1b0d12',
  },
  sdr2: {
    name: 'Tropical green', bg: '#f4fff9', hall: '#d6f5e5', room: '#93d9b5', roomAlt: '#7ccfa4',
    line: '#24493c', inner: '#effff6', glow: 'rgba(60,200,140,.7)', glowSize: 12, text: '#24493c',
    icon: '#24493c', iconLight: 'rgba(255,255,255,.6)', hatch: '#24493c', hatchBg: '#cdeedd', grid: 'rgba(36,73,60,.08)',
    accent: '#22a06b', font: '"VT323", monospace', pixel: true,
    floor3d: '#c9d9cf', roomFloor3d: '#a9c4b2', wall3d: '#e4f1ea', ceiling3d: '#eef6f1', door3d: '#2f7d5b', trim3d: '#24493c', sky3d: '#0b1a14',
  },
  v3: {
    name: 'Purple neon', bg: '#170a1f', hall: '#a9a7b4', room: '#2b2833', roomAlt: '#38343f',
    line: '#ffffff', inner: 'rgba(255,255,255,.15)', glow: 'rgba(255,45,140,.8)', glowSize: 10, text: '#ffffff',
    icon: '#ffffff', iconLight: 'rgba(255,255,255,.35)', hatch: '#ff2d8a', hatchBg: '#2b1430', grid: 'rgba(255,255,255,.06)',
    accent: '#ff2d8a', font: '"Rajdhani", "Segoe UI", sans-serif', pixel: false,
    floor3d: '#8f8b96', roomFloor3d: '#5a5560', wall3d: '#c9c4cf', ceiling3d: '#2e2a33', door3d: '#ff2d8a', trim3d: '#1b1720', sky3d: '#12061a',
  },
  neon: {
    name: 'Neon green (menu)', bg: '#05130a', hall: '#0e3519', room: '#1a6a2c', roomAlt: '#21803a',
    line: '#7dff4a', inner: 'rgba(125,255,74,.28)', glow: 'rgba(90,255,60,.8)', glowSize: 14, text: '#dcffd2',
    icon: '#e8ffe0', iconLight: 'rgba(190,255,170,.4)', hatch: '#5cff3a', hatchBg: '#0a2612', grid: 'rgba(125,255,74,.08)',
    accent: '#4dff2e', font: '"Press Start 2P", "VT323", monospace', pixel: true,
    floor3d: '#24452b', roomFloor3d: '#2c5c34', wall3d: '#a6dca7', ceiling3d: '#163a1f', door3d: '#4dff2e', trim3d: '#0a2612', sky3d: '#031008',
  },
  despair: {
    name: 'Despair red', bg: '#120606', hall: '#4a1418', room: '#7d151d', roomAlt: '#951b24',
    line: '#ff5a5a', inner: 'rgba(255,120,120,.25)', glow: 'rgba(255,40,40,.85)', glowSize: 16, text: '#ffd6d6',
    icon: '#ffd6d6', iconLight: 'rgba(255,200,200,.35)', hatch: '#ff5a5a', hatchBg: '#2a0b0d', grid: 'rgba(255,90,90,.07)',
    accent: '#ff3b3b', font: '"VT323", monospace', pixel: true,
    floor3d: '#5a2226', roomFloor3d: '#6e1d23', wall3d: '#8a2a30', ceiling3d: '#2a0c0e', door3d: '#ff3b3b', trim3d: '#1a0607', sky3d: '#080202',
  },
  blueprint: {
    name: 'Blueprint', bg: '#0f3566', hall: '#174a86', room: '#1d5aa0', roomAlt: '#2366b3',
    line: '#d7ebff', inner: 'rgba(215,235,255,.25)', glow: 'rgba(0,0,0,0)', glowSize: 0, text: '#e6f2ff',
    icon: '#e6f2ff', iconLight: 'rgba(230,242,255,.3)', hatch: '#d7ebff', hatchBg: '#123d74', grid: 'rgba(215,235,255,.12)',
    accent: '#7cc4ff', font: '"Consolas", monospace', pixel: false,
    floor3d: '#7d93ad', roomFloor3d: '#6a819b', wall3d: '#cfdcec', ceiling3d: '#dfe7f1', door3d: '#3d7cc9', trim3d: '#203854', sky3d: '#0a1a30',
  },
  paper: {
    name: 'Print (black on white)', bg: '#ffffff', hall: '#f1f1f1', room: '#d9d9d9', roomAlt: '#cccccc',
    line: '#111111', inner: '#ffffff', glow: 'rgba(0,0,0,0)', glowSize: 0, text: '#111111',
    icon: '#111111', iconLight: 'rgba(255,255,255,.7)', hatch: '#111111', hatchBg: '#eeeeee', grid: 'rgba(0,0,0,.07)',
    accent: '#444444', font: '"Segoe UI", sans-serif', pixel: false,
    floor3d: '#cfcfcf', roomFloor3d: '#bdbdbd', wall3d: '#efefef', ceiling3d: '#f7f7f7', door3d: '#555555', trim3d: '#222222', sky3d: '#202020',
  },
};

export const THEME_KEYS = ['bg', 'hall', 'room', 'roomAlt', 'line', 'inner', 'glow', 'text', 'icon', 'hatch', 'hatchBg', 'accent',
  'floor3d', 'roomFloor3d', 'wall3d', 'ceiling3d', 'door3d', 'trim3d', 'sky3d'];

export function getTheme(project, map) {
  const key = map?.theme || project.settings.theme || 'dr1';
  const custom = project.customThemes.find((t) => t.id === key);
  if (custom) return { ...THEMES.dr1, ...custom };
  return THEMES[key] || THEMES.dr1;
}

export function allThemes(project) {
  return [...Object.entries(THEMES).map(([id, t]) => ({ id, name: t.name })), ...project.customThemes.map((t) => ({ id: t.id, name: t.name + ' (custom)' }))];
}
