// Real 3D for the V3 / alt map screens: the same floors, walls, doors and stairs as walk mode,
// seen from a tilted overhead (orthographic) camera. The map-screen picture (room colours, icons) lies on the floor.
import * as THREE from 'three';
import { buildMapGroup } from './view3d.js';
import { cellsToRects } from './model.js';
import { bakeMap } from './bake.js';

const ELEV = 34 * Math.PI / 180; // camera tilt (same feel as the old flat version)
let renderer = null, scene = null, camera = null, group = null, canvas = null;
let cs = 1;
const ray = new THREE.Raycaster();
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

export function isoCanvas() {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    canvas = renderer.domElement;
    canvas.className = 'v3-cv v3-gl';
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -500, 2000);
  }
  return canvas;
}

function disposeGroup(g) {
  g.traverse((o) => {
    o.geometry?.dispose?.();
    for (const m of [].concat(o.material || [])) { if (m.map && m.userData?.own) m.map.dispose(); if (m.userData?.own) m.dispose(); }
  });
}

/** Build the 3D floor for a map. img = the flat map-screen picture; bx/by/margin/P = how it lines up with the grid. */
export function isoBuild(m, project, view, img, bounds, margin, P, theme) {
  isoCanvas();
  cs = project.settings.cellSize || 1;
  if (group) { scene.remove(group); disposeGroup(group); }
  group = new THREE.Group();
  // walls, doors, stairs from the walk-mode builder, cut down to a low "dollhouse" height
  const built = buildMapGroup(m, project, { view, cutaway: 0.4, ceilings: false, forExport: true });
  for (const n of built.npcs) built.group.remove(n); // characters are drawn as sprites on top instead
  group.add(built.group);
  // floor slabs with real thickness under every floor area
  const slabMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.hall || '#888'), roughness: 0.9 });
  slabMat.color.multiplyScalar(0.45);
  slabMat.userData.own = true;
  const baked = bakeMap(m, view);
  const T = 0.35;
  for (const [, cells] of baked.owned) for (const r of cellsToRects(cells)) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(r.w * cs, T, r.h * cs), slabMat);
    box.position.set((r.x + r.w / 2) * cs, -T / 2 - 0.01, (r.y + r.h / 2) * cs);
    group.add(box);
  }
  // the map-screen picture laid on the floor (colours, icons, door marks)
  const tex = new THREE.CanvasTexture(img);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const w = (img.width / P) * cs, h = (img.height / P) * cs;
  const picMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  picMat.userData.own = true;
  const pic = new THREE.Mesh(new THREE.PlaneGeometry(w, h), picMat);
  pic.rotation.x = -Math.PI / 2;
  pic.position.set((bounds.x - margin) * cs + w / 2, 0.02, (bounds.y - margin) * cs + h / 2);
  pic.renderOrder = 1;
  group.add(pic);
  scene.add(group);
  // light like the building view
  if (!scene.getObjectByName('isoHemi')) {
    const hemi = new THREE.HemisphereLight(0xffffff, 0x404040, 1.5); hemi.name = 'isoHemi'; scene.add(hemi);
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9); sun.position.set(20, 40, 10); scene.add(sun);
  }
}

/**
 * Point the camera. focus = grid point shown at screen (cx, cy); ppc = screen pixels per grid cell.
 * The view comes from the south-east, so grid x runs right-and-down and grid y left-and-down (as before).
 */
export function isoCamera(W, H, cx, cy, focus, ppc) {
  if (!camera) return;
  const ppw = ppc / cs; // pixels per world unit
  camera.left = -cx / ppw; camera.right = (W - cx) / ppw;
  camera.top = cy / ppw; camera.bottom = -(H - cy) / ppw;
  const t = new THREE.Vector3(focus.x * cs, 0, focus.y * cs);
  const dist = 200;
  const dir = new THREE.Vector3(Math.cos(ELEV) * Math.SQRT1_2, Math.sin(ELEV), Math.cos(ELEV) * Math.SQRT1_2);
  camera.position.copy(t).addScaledVector(dir, dist);
  camera.up.set(0, 1, 0);
  camera.lookAt(t);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

export function isoRender(W, H, dpr) {
  if (!renderer) return;
  renderer.setPixelRatio(dpr);
  const s = renderer.getSize(new THREE.Vector2());
  if (Math.round(s.x) !== Math.round(W) || Math.round(s.y) !== Math.round(H)) renderer.setSize(W, H, false);
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  renderer.render(scene, camera);
}

/** Grid point (and height in metres) → screen pixels. */
export function isoProject(gx, gy, W, H, h = 0) {
  const v = new THREE.Vector3(gx * cs, h, gy * cs).project(camera);
  return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H };
}

/** Screen pixels → grid point on the floor. */
export function isoUnproject(X, Y, W, H) {
  ray.setFromCamera(new THREE.Vector2((X / W) * 2 - 1, -(Y / H) * 2 + 1), camera);
  const p = new THREE.Vector3();
  if (!ray.ray.intersectPlane(ground, p)) return { x: 0, y: 0 };
  return { x: p.x / cs, y: p.z / cs };
}
