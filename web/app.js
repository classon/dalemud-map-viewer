import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

// Exit direction indices match the .wld file: D0..D5.
const DIRS = ['north', 'east', 'south', 'west', 'up', 'down'];
const OPPOSITE = [2, 3, 0, 1, 5, 4];
const VEC = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 1, 0], [0, -1, 0]];

const SPACING = 2.2;   // world units between grid cells
const CUBE = 1;        // room cube size
const DEFAULT_ZONE = 30;
const DEFAULT_ROOM = 3025; // The Common Square, when the URL names no room

const SECTOR_COLORS = {
  inside: '#8a7f72', city: '#9aa3ad', field: '#8cc56a', forest: '#3f8f4a',
  hills: '#b39359', mountain: '#8b6f5a', water_swim: '#4aa3df', water_noswim: '#2f6fb5',
  air: '#cfe8ff', underwater: '#1f4f8f', desert: '#e0c476', tree: '#5f7f2f',
};

// Scene colors come from the CSS variables so they follow the light/dark theme.
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
const COLOR_KEYS = [
  'twoway', 'oneway', 'warp', 'teleport', 'external', 'door', 'secret', 'accent', 'bg', 'grid-major', 'grid-minor',
  'mob-good', 'mob-neutral', 'mob-evil', 'death', 'peaceful', 'nomagic', 'player', 'world-node',
];
const COLORS = {};
function readColors() {
  for (const n of COLOR_KEYS) COLORS[n] = new THREE.Color(cssVar(n));
}
readColors();

// Tag a material with the color variable it uses so a theme switch can recolor it.
function themed(material, key) {
  material.color.copy(COLORS[key]);
  material.userData.colorKey = key;
  return material;
}

// ---------------------------------------------------------------- DOM refs
const $ = (sel) => document.querySelector(sel);
const viewport = $('#viewport');
const tooltip = $('#tooltip');
const zoneList = $('#zone-list');
const zoneFilter = $('#zone-filter');
const searchList = $('#search-list');
const searchStatus = $('#search-status');
const details = $('#room-details');
const mapTitle = $('#map-title');

// ---------------------------------------------------------------- state
const state = {
  index: [],
  zonesById: new Map(),   // id -> index entry
  zoneCache: new Map(),   // id -> loaded zone JSON
  zone: null,
  rooms: new Map(),       // vnum -> room (current zone)
  roomMeshes: new Map(),  // vnum -> mesh
  mobMeshes: new Map(),   // spawn id -> mesh
  selected: null,
  selectedMob: null,      // spawn from zone.mobs
  mobTab: 'stats',
  level: null,            // floor (grid y) shown on its own, or null for all
  info: null,             // { kind: 'mob' | 'item', vnum } prototype shown from search
  infoTab: 'stats',
  catalogs: {},           // 'mobs' | 'objects' -> Map(vnum -> prototype), loaded on demand
  side: 'zones',          // left pane tab
  queries: { zones: '', mobs: '', items: '' },
};

// ---------------------------------------------------------------- three.js setup
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(COLORS.bg);
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.12;

scene.add(new THREE.HemisphereLight(0xdde6ff, 0x20242c, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(0.6, 1, 0.4);
scene.add(sun);

const world = new THREE.Group();
scene.add(world);

const layers = {
  twoway: new THREE.Group(), oneway: new THREE.Group(), warp: new THREE.Group(),
  teleport: new THREE.Group(), external: new THREE.Group(), doors: new THREE.Group(),
  mobs: new THREE.Group(), markers: new THREE.Group(),
};

// Shared resources are reused across zones and never disposed.
const cubeGeometry = new THREE.BoxGeometry(CUBE, CUBE, CUBE);
const sectorMaterials = new Map();
function sectorMaterial(sector) {
  if (!sectorMaterials.has(sector)) {
    sectorMaterials.set(sector, new THREE.MeshStandardMaterial({
      color: SECTOR_COLORS[sector] ?? '#777', roughness: 0.75, metalness: 0.05,
    }));
  }
  return sectorMaterials.get(sector);
}

// Mobs are colored by alignment (the game's IS_GOOD/IS_EVIL cut-offs) and
// aggressive ones get a spiky shape.
const alignKind = (a) => (a >= 350 ? 'good' : a <= -350 ? 'evil' : 'neutral');

// Zone level ranges (from the game's HELP AREAS, or estimated from mob levels)
// map onto green → yellow → orange → red by the middle of the range. Zones open
// to every level, and zones without data, stay neutral.
const LEVEL_STOPS = [[1, '#3fb950'], [15, '#d9c12b'], [30, '#f0882a'], [45, '#e5484d']]
  .map(([level, hex]) => [level, new THREE.Color(hex)]);
function levelColor(levels) {
  if (!levels) return null;
  const max = levels.max ?? levels.min + 15; // "45+" and the like
  if (levels.min <= 1 && max >= 50) return null;
  const mid = (levels.min + Math.min(max, 60)) / 2;
  if (mid <= LEVEL_STOPS[0][0]) return LEVEL_STOPS[0][1].clone();
  for (let i = 1; i < LEVEL_STOPS.length; i++) {
    const [l1, c1] = LEVEL_STOPS[i];
    if (mid <= l1) {
      const [l0, c0] = LEVEL_STOPS[i - 1];
      return c0.clone().lerp(c1, (mid - l0) / (l1 - l0));
    }
  }
  return LEVEL_STOPS[LEVEL_STOPS.length - 1][1].clone();
}
const levelSource = (levels) => (levels.source === 'help'
  ? "advertised in the game's HELP AREAS"
  : 'estimated from the levels of the mobs that load there (middle half)');
function levelChip(levels) {
  if (!levels) return '';
  const color = levelColor(levels);
  return `<span class="lvl${color ? '' : ' lvl-any'}"${color ? ` style="--lvl:#${color.getHexString()}"` : ''}
    title="Levels ${esc(levels.text.replace('~', ''))}, ${levelSource(levels)}">${esc(levels.text)}</span>`;
}
const MOB_SIZE = 0.13;
const mobGeometry = new THREE.SphereGeometry(MOB_SIZE, 14, 10);
const aggroGeometry = new THREE.OctahedronGeometry(MOB_SIZE * 1.45);
const mobMaterials = Object.fromEntries(['good', 'neutral', 'evil'].map((k) => [
  k, themed(new THREE.MeshStandardMaterial({ roughness: 0.4, emissiveIntensity: 0.35 }), `mob-${k}`),
]));
// Death traps always get their own colour; peaceful and no-magic rooms get an
// outline in the "markers" layer.
const deathMaterial = themed(new THREE.MeshStandardMaterial({ roughness: 0.5, emissiveIntensity: 0.45 }), 'death');
const roomMaterial = (room) => (room.flags.includes('death') ? deathMaterial : sectorMaterial(room.sector));
const markerEdges = [1.14, 1.3].map((s) => new THREE.EdgesGeometry(new THREE.BoxGeometry(CUBE * s, CUBE * s, CUBE * s)));
const markerMaterials = {
  peaceful: themed(new THREE.LineBasicMaterial(), 'peaceful'),
  no_magic: themed(new THREE.LineBasicMaterial(), 'nomagic'),
};
const ROOM_WARNINGS = { death: 'death trap', peaceful: 'peaceful', no_magic: 'no magic' };

// Rooms on other floors are drawn with this when a single floor is shown.
const ghostMaterial = themed(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.1, depthWrite: false }), 'grid-major');
const sharedMaterials = new Set([...Object.values(mobMaterials), ghostMaterial, deathMaterial, ...Object.values(markerMaterials)]);

// Tag an object with the floors (grid y) it belongs to, for the floor filter.
const onLevels = (obj, ...ys) => {
  obj.userData.levels = ys;
  return obj;
};
const sharedGeometries = new Set([mobGeometry, aggroGeometry, ...markerEdges]);

// The selected room ("where you are"): a bright orange outline, a pulsing
// translucent shell around the cube, and a bobbing arrow above it that grows
// with camera distance so it stays easy to find when zoomed out.
const selectionBox = new THREE.Group();
const selectionShell = new THREE.Mesh(
  new THREE.BoxGeometry(CUBE * 1.3, CUBE * 1.3, CUBE * 1.3),
  themed(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.3, depthWrite: false }), 'player'),
);
const selectionBeacon = new THREE.Mesh(
  new THREE.ConeGeometry(0.28, 0.6, 16).rotateX(Math.PI), // tip pointing down
  themed(new THREE.MeshBasicMaterial(), 'player'),
);
selectionBox.add(
  new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(CUBE * 1.36, CUBE * 1.36, CUBE * 1.36)),
    themed(new THREE.LineBasicMaterial(), 'player'),
  ),
  selectionShell,
  selectionBeacon,
);
selectionBox.visible = false;
scene.add(selectionBox);

function animateSelection(time) {
  if (!selectionBox.visible) return;
  const t = time / 1000;
  selectionShell.material.opacity = 0.22 + 0.16 * (0.5 + 0.5 * Math.sin(t * 3));
  const size = THREE.MathUtils.clamp(camera.position.distanceTo(selectionBox.position) / 25, 1, 8);
  selectionBeacon.scale.setScalar(size);
  selectionBeacon.position.y = CUBE * 0.9 + 0.3 * size + 0.18 * size * (0.5 + 0.5 * Math.sin(t * 2.5));
}

const mobSelection = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(MOB_SIZE * 3.2, MOB_SIZE * 3.2, MOB_SIZE * 3.2)),
  themed(new THREE.LineBasicMaterial(), 'accent'),
);
mobSelection.visible = false;
scene.add(mobSelection);

function resize() {
  const { clientWidth: w, clientHeight: h } = viewport;
  if (!w || !h) return;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewport);

// ---------------------------------------------------------------- compass
// OrbitControls' azimuth is the camera's angle around the vertical axis. At 0
// the camera looks toward -z (north) with +x (east) to the right, and each
// compass direction sits that many radians clockwise from screen-up.
const compassRose = document.getElementById('compass-rose');
const compassLetters = [...document.querySelectorAll('#compass text')];
let compassAngle = null;

function updateCompass() {
  const theta = controls.getAzimuthalAngle();
  if (theta === compassAngle) return;
  compassAngle = theta;
  compassRose.setAttribute('transform', `rotate(${THREE.MathUtils.radToDeg(theta)})`);
  for (const t of compassLetters) {
    const a = theta + Number(t.dataset.dir) * Math.PI / 2;
    t.setAttribute('x', (Math.sin(a) * 24.5).toFixed(2));
    t.setAttribute('y', (-Math.cos(a) * 24.5).toFixed(2));
  }
}

// Swing the camera round to face north, keeping its height and distance.
document.getElementById('compass').addEventListener('click', () => {
  const offset = camera.position.clone().sub(controls.target);
  camera.position.set(controls.target.x, camera.position.y, controls.target.z + Math.hypot(offset.x, offset.z));
});

renderer.setAnimationLoop((time) => {
  if (worldOpen) {
    renderWorldFrame();
    return;
  }
  controls.update();
  updateCompass();
  animateSelection(time);
  renderer.render(scene, camera);
});

// ---------------------------------------------------------------- geometry helpers
const toWorld = ([x, y, z]) => new THREE.Vector3(x * SPACING, y * SPACING, z * SPACING);
const dirVec = (d) => new THREE.Vector3(...VEC[d]);

function tube(curve, colorKey, radius = 0.05, segments = 1) {
  const geo = new THREE.TubeGeometry(curve, segments, radius, 6, false);
  return new THREE.Mesh(geo, themed(new THREE.MeshBasicMaterial(), colorKey));
}

function arrowOn(curve, colorKey, t = 0.62) {
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.14, 0.38, 10),
    themed(new THREE.MeshBasicMaterial(), colorKey),
  );
  cone.position.copy(curve.getPointAt(t));
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangentAt(t).normalize());
  return cone;
}

// True when b sits a whole number of grid steps from a along direction d.
function isAligned(a, b, d) {
  const v = VEC[d];
  const delta = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const k = delta[0] * v[0] + delta[1] * v[1] + delta[2] * v[2];
  return k >= 1 && delta.every((c, i) => c === k * v[i]);
}

// Arc used for off-grid exits: bulges upward and toward the exit direction so
// several warps between the same pair of rooms stay distinguishable.
function warpCurve(from, to, d) {
  const out = dirVec(d);
  if (from.distanceTo(to) < 0.01) {
    // Exit leading back into the same room.
    const up = new THREE.Vector3(0, 1.2, 0);
    return new THREE.CubicBezierCurve3(
      from, from.clone().addScaledVector(out, 1.8).add(up),
      from.clone().addScaledVector(out, 1.8).sub(up), from.clone(),
    );
  }
  const mid = from.clone().lerp(to, 0.5);
  const lift = from.distanceTo(to) * 0.3 + 0.8;
  const control = mid.add(new THREE.Vector3(0, lift, 0)).addScaledVector(out, 1.2);
  return new THREE.QuadraticBezierCurve3(from, control, to);
}

function disposeGroup(group) {
  group.traverse((obj) => {
    if (obj.geometry && obj.geometry !== cubeGeometry && !sharedGeometries.has(obj.geometry)) obj.geometry.dispose();
    if (obj.material && ![...sectorMaterials.values()].includes(obj.material) && !sharedMaterials.has(obj.material)) {
      obj.material.dispose();
    }
  });
  group.clear();
}

// ---------------------------------------------------------------- zone building
const pickables = [];

function buildZone(zone) {
  for (const layer of Object.values(layers)) disposeGroup(layer);
  disposeGroup(world);
  pickables.length = 0;
  state.rooms = new Map(zone.rooms.map((r) => [r.vnum, r]));
  state.roomMeshes.clear();
  state.mobMeshes.clear();

  for (const room of zone.rooms) {
    const mesh = new THREE.Mesh(cubeGeometry, roomMaterial(room));
    mesh.position.copy(toWorld(room.pos));
    mesh.userData = { vnum: room.vnum, levels: [room.pos[1]], room: true };
    world.add(mesh);
    ['peaceful', 'no_magic'].filter((f) => room.flags.includes(f)).forEach((flag, i) => {
      const outline = new THREE.LineSegments(markerEdges[i], markerMaterials[flag]);
      outline.position.copy(mesh.position);
      layers.markers.add(onLevels(outline, room.pos[1]));
    });
    pickables.push(mesh);
    state.roomMeshes.set(room.vnum, mesh);
  }

  const drawnPairs = new Set();
  for (const room of zone.rooms) {
    const from = toWorld(room.pos);
    for (const exit of room.exits) {
      if (exit.dir < 0 || exit.dir > 5) continue;
      if (exit.flags?.includes('door')) addDoor(room, exit);

      const target = state.rooms.get(exit.to);
      if (!target) {
        addExternal(room, exit);
        continue;
      }
      const back = target.exits.find((e) => e.dir === OPPOSITE[exit.dir] && e.to === room.vnum);
      const pairKey = [room.vnum, target.vnum].sort((a, b) => a - b).join('-') + ':' + Math.min(exit.dir, OPPOSITE[exit.dir]);
      if (back) {
        if (drawnPairs.has(pairKey)) continue;
        drawnPairs.add(pairKey);
      }
      const to = toWorld(target.pos);
      const aligned = room.vnum !== target.vnum && isAligned(room.pos, target.pos, exit.dir);
      const kind = !aligned ? 'warp' : back ? 'twoway' : 'oneway';
      const curve = aligned ? new THREE.LineCurve3(from, to) : warpCurve(from, to, exit.dir);
      const group = layers[kind];
      const ys = [room.pos[1], target.pos[1]];
      group.add(onLevels(tube(curve, kind, 0.05, aligned ? 1 : 24), ...ys));
      if (!back) group.add(onLevels(arrowOn(curve, kind), ...ys));
    }

    if (room.teleport) {
      const target = state.rooms.get(room.teleport.target);
      if (target) {
        const to = toWorld(target.pos);
        const mid = from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, from.distanceTo(to) * 0.4 + 1, 0));
        const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(curve.getPoints(40)),
          themed(new THREE.LineDashedMaterial({ dashSize: 0.3, gapSize: 0.2 }), 'teleport'),
        );
        line.computeLineDistances();
        const ys = [room.pos[1], target.pos[1]];
        layers.teleport.add(onLevels(line, ...ys), onLevels(arrowOn(curve, 'teleport', 0.8), ...ys));
      }
    }
  }

  const box = new THREE.Box3().setFromObject(world);
  buildGrid(box);
  addMobs(zone);

  for (const layer of Object.values(layers)) world.add(layer);
  applyLayerVisibility();
  state.level = null;
  renderFloors(zone);
  applyLevelFilter();
  fitCamera(box);
}

// A faint floor grid under the lowest level for orientation. GridHelper bakes
// its colors into the geometry, so a theme switch rebuilds it.
let grid = null;
let gridBox = null;
function buildGrid(box = gridBox) {
  if (!box) return;
  gridBox = box;
  if (grid) {
    grid.geometry.dispose();
    grid.material.dispose();
    grid.removeFromParent();
  }
  const size = box.getSize(new THREE.Vector3());
  const span = Math.ceil(Math.max(size.x, size.z) / SPACING + 4) * SPACING;
  grid = new THREE.GridHelper(span, Math.round(span / SPACING), COLORS['grid-major'], COLORS['grid-minor']);
  const center = box.getCenter(new THREE.Vector3());
  grid.position.set(center.x, box.min.y - 0.4, center.z);
  world.add(grid);
  placeGrid();
}

// With one floor shown, the grid sits just under that floor.
function placeGrid() {
  if (!grid || !gridBox) return;
  grid.position.y = state.level == null ? gridBox.min.y - 0.4 : state.level * SPACING - CUBE / 2 - 0.4;
}

// ---------------------------------------------------------------- floor filter
const floorsEl = document.getElementById('floors');

function renderFloors(zone) {
  const counts = new Map();
  for (const r of zone.rooms) counts.set(r.pos[1], (counts.get(r.pos[1]) ?? 0) + 1);
  const levels = [...counts.keys()].sort((a, b) => b - a);
  floorsEl.hidden = levels.length < 2;
  floorsEl.innerHTML = `<div class="floors-label" title="Show one floor of this zone at a time">Floors</div>`
    + `<button data-level="" title="Show every floor">All</button>`
    + levels.map((y) => `<button data-level="${y}" title="Floor ${y} · ${counts.get(y)} rooms">${y > 0 ? '+' : ''}${y}</button>`).join('');
  updateFloorButtons();
}

function updateFloorButtons() {
  for (const b of floorsEl.querySelectorAll('button')) {
    const level = b.dataset.level === '' ? null : Number(b.dataset.level);
    b.setAttribute('aria-pressed', String(level === state.level));
  }
}

function setLevel(level) {
  state.level = level;
  applyLevelFilter();
  updateFloorButtons();
}

// Objects tagged with floors show only on the chosen floor; rooms elsewhere
// stay as faint ghosts for context and can't be picked.
function applyLevelFilter() {
  const level = state.level;
  world.traverse((obj) => {
    const levels = obj.userData.levels;
    if (!levels) return;
    const here = level == null || levels.includes(level);
    if (obj.userData.room) {
      obj.userData.ghost = !here;
      obj.material = here ? roomMaterial(state.rooms.get(obj.userData.vnum)) : ghostMaterial;
    } else {
      obj.visible = here;
    }
  });
  placeGrid();
  // Selection outlines hide with their room's floor.
  const shown = (room) => Boolean(room) && (level == null || room.pos[1] === level);
  selectionBox.visible = shown(state.selected) && state.roomMeshes.has(state.selected.vnum);
  mobSelection.visible = Boolean(state.selectedMob) && state.mobMeshes.has(state.selectedMob.id)
    && shown(state.rooms.get(state.selectedMob.room));
}

floorsEl.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-level]');
  if (b) setLevel(b.dataset.level === '' ? null : Number(b.dataset.level));
});

// Mob markers sit on top of their room cube, three to a row, stacking upward
// when a room is crowded.
function addMobs(zone) {
  const perRoom = new Map();
  for (const spawn of zone.mobs) {
    const room = state.rooms.get(spawn.room);
    if (!room) continue;
    const k = perRoom.get(spawn.room) ?? 0;
    perRoom.set(spawn.room, k + 1);
    const proto = zone.mobProtos[spawn.mob];
    const aggressive = proto.flags?.includes('aggressive');
    const mesh = new THREE.Mesh(aggressive ? aggroGeometry : mobGeometry, mobMaterials[alignKind(proto.alignment ?? 0)]);
    const step = MOB_SIZE * 2.4;
    const col = k % 3, row = Math.floor(k / 3) % 3, layer = Math.floor(k / 9);
    mesh.position.copy(toWorld(room.pos)).add(new THREE.Vector3(
      (col - 1) * step, CUBE / 2 + MOB_SIZE * 1.3 + layer * step, (row - 1) * step,
    ));
    mesh.userData = { mobId: spawn.id, levels: [room.pos[1]] };
    layers.mobs.add(mesh);
    pickables.push(mesh);
    state.mobMeshes.set(spawn.id, mesh);
  }
}

function addDoor(room, exit) {
  const secret = exit.flags.includes('secret');
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.62, 0.08),
    themed(new THREE.MeshBasicMaterial(), secret ? 'secret' : 'door'),
  );
  const out = dirVec(exit.dir);
  plate.position.copy(toWorld(room.pos)).addScaledVector(out, CUBE / 2 + 0.12);
  // Face the plate along the exit direction; vertical exits get a hatch.
  plate.lookAt(plate.position.clone().add(out));
  layers.doors.add(onLevels(plate, room.pos[1]));
}

function addExternal(room, exit) {
  const from = toWorld(room.pos);
  const to = from.clone().addScaledVector(dirVec(exit.dir), SPACING * 0.75);
  const colorKey = exit.missing ? 'secret' : 'external';
  layers.external.add(onLevels(tube(new THREE.LineCurve3(from, to), colorKey, 0.04), room.pos[1]));
  const ghost = new THREE.Mesh(
    new THREE.BoxGeometry(CUBE * 0.4, CUBE * 0.4, CUBE * 0.4),
    themed(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.75 }), colorKey),
  );
  ghost.position.copy(to);
  ghost.userData = { vnum: exit.to, external: true, zone: exit.toZone, missing: exit.missing, levels: [room.pos[1]] };
  layers.external.add(ghost);
  pickables.push(ghost);
}

// Place the camera on its usual diagonal, just far enough back that every
// corner of the zone's bounding box is in view horizontally and vertically.
function fitCamera(box) {
  resize(); // make sure the aspect ratio is current
  const center = box.getCenter(new THREE.Vector3());
  const toCamera = new THREE.Vector3(0, 0.75, 0.9).normalize();
  const right = new THREE.Vector3(0, 1, 0).cross(toCamera).normalize();
  const up = toCamera.clone().cross(right);
  const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const tanH = tanV * camera.aspect;
  let dist = 6;
  for (let i = 0; i < 8; i++) {
    const corner = new THREE.Vector3(
      i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z,
    ).sub(center);
    // A corner at depth (dist - corner·toCamera) fits when its sideways and
    // vertical offsets are within that depth times the half-angle tangents.
    const needed = corner.dot(toCamera)
      + Math.max(Math.abs(corner.dot(right)) / tanH, Math.abs(corner.dot(up)) / tanV);
    dist = Math.max(dist, needed);
  }
  dist *= 1.05; // a little breathing room
  controls.target.copy(center);
  camera.position.copy(center).addScaledVector(toCamera, dist);
  camera.near = dist / 100;
  camera.far = dist * 20;
  camera.updateProjectionMatrix();
}

function applyLayerVisibility() {
  for (const input of document.querySelectorAll('.legend input')) {
    layers[input.dataset.layer].visible = input.checked;
  }
}
document.querySelector('.legend').addEventListener('change', applyLayerVisibility);

// ---------------------------------------------------------------- theme
const themeToggle = $('#theme-toggle');

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const next = theme === 'light' ? 'dark' : 'light';
  themeToggle.title = themeToggle.ariaLabel = `Switch to ${next} mode`;
  readColors();
  renderer.setClearColor(COLORS.bg);
  scene.traverse((obj) => {
    const key = obj.material?.userData.colorKey;
    if (key) obj.material.color.copy(COLORS[key]);
  });
  for (const m of [...Object.values(mobMaterials), deathMaterial]) m.emissive.copy(m.color);
  document.dispatchEvent(new Event('themechange'));
  buildGrid();
}

themeToggle.addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  try { localStorage.setItem('theme', theme); } catch {}
  applyTheme(theme);
});
applyTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

const credits = $('#credits');
$('#credits-open').addEventListener('click', () => credits.showModal());
credits.addEventListener('click', (e) => {
  if (e.target === credits) credits.close(); // click on the backdrop
});

// ---------------------------------------------------------------- picking
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function pick(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(
    pickables.filter((o) => o.visible && o.parent?.visible !== false && !o.userData.ghost), false,
  )[0];
  return hit?.object ?? null;
}

// Show the tooltip by the pointer, flipping to the left or above it when it
// would run off the map pane.
function showTooltipAt(e) {
  tooltip.hidden = false;
  const rect = viewport.getBoundingClientRect();
  let x = e.clientX - rect.left + 14, y = e.clientY - rect.top + 12;
  if (x + tooltip.offsetWidth > rect.width - 4) x = e.clientX - rect.left - tooltip.offsetWidth - 10;
  if (y + tooltip.offsetHeight > rect.height - 4) y = e.clientY - rect.top - tooltip.offsetHeight - 10;
  tooltip.style.left = `${Math.max(4, x)}px`;
  tooltip.style.top = `${Math.max(4, y)}px`;
}

let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  if (worldOpen) {
    worldClick(e);
    return;
  }
  const obj = pick(e);
  if (!obj) return;
  const { vnum, external, zone, missing, mobId } = obj.userData;
  if (mobId != null) {
    selectMob(mobId);
  } else if (external) {
    if (!missing && zone != null) goTo(zone, vnum);
  } else {
    selectRoom(vnum);
  }
});
renderer.domElement.addEventListener('dblclick', (e) => {
  if (worldOpen) return;
  const obj = pick(e);
  if (obj && !obj.userData.external) controls.target.copy(obj.position);
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (worldOpen) {
    worldPointerMove(e);
    return;
  }
  const obj = pick(e);
  renderer.domElement.style.cursor = obj ? 'pointer' : '';
  if (!obj) { tooltip.hidden = true; return; }
  const { vnum, external, zone, missing, mobId } = obj.userData;
  let text;
  if (mobId != null) {
    const proto = mobProto(state.zone.mobs[mobId]);
    text = `${proto.name}  · level ${proto.level ?? '?'}`;
  } else if (!external) {
    const room = state.rooms.get(vnum);
    const warnings = room.flags.filter((f) => ROOM_WARNINGS[f]).map((f) => ROOM_WARNINGS[f]);
    text = `${room.name}  #${vnum}${warnings.length ? `  ⚠ ${warnings.join(', ')}` : ''}`;
  }
  else if (missing) text = `Exit to #${vnum} (room does not exist)`;
  else text = `→ #${vnum} in ${state.zonesById.get(zone)?.name ?? `zone ${zone}`}`;
  tooltip.textContent = text;
  showTooltipAt(e);
});
renderer.domElement.addEventListener('pointerleave', () => { tooltip.hidden = true; });

// ---------------------------------------------------------------- details pane
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// MUD text is hard-wrapped at ~80 columns; an indented line starts a new
// paragraph. Rejoin the rest so it wraps to the pane width.
function prose(text) {
  const paragraphs = [];
  for (const line of text.replace(/\t/g, '   ').split('\n')) {
    if (!line.trim()) continue;
    if (!paragraphs.length || /^\s/.test(line)) paragraphs.push(line.trim());
    else paragraphs[paragraphs.length - 1] += ' ' + line.trim();
  }
  return paragraphs.length
    ? paragraphs.map((p) => `<p class="desc">${esc(p)}</p>`).join('')
    : '<p class="muted">(no description)</p>';
}

function roomLabel(vnum, zoneId) {
  const local = state.rooms.get(vnum);
  if (local) return `${esc(local.name)} <span class="muted">#${vnum}</span>`;
  const other = state.zoneCache.get(zoneId)?.rooms.find((r) => r.vnum === vnum);
  const zoneName = state.zonesById.get(zoneId)?.name ?? `zone ${zoneId}`;
  return `${other ? esc(other.name) + ' ' : ''}<span class="muted">#${vnum} · ${esc(zoneName)}</span>`;
}

const mobProto = (spawn) => state.zone.mobProtos[spawn.mob];
const objProto = (vnum) => state.zone?.objProtos[vnum] ?? state.catalogs.objects?.get(vnum)
  ?? { vnum, name: `object #${vnum}`, malformed: 'not in object file' };
const malformedNote = (p) => (p.malformed
  ? `<p class="warn-text">This entry is malformed in the world file (${esc(p.malformed)}); only part of it could be read.</p>` : '');
const chipList = (items, warn = []) => items.map((f) => `<span class="chip${warn.includes(f) ? ' warn' : ''}">${esc(f)}</span>`).join('');
const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function mobButton(spawn) {
  const proto = mobProto(spawn);
  const kind = alignKind(proto.alignment ?? 0);
  return `<button class="link mob-link" data-mob="${spawn.id}"><span class="dot dot-${kind}"></span>${esc(titleCase(proto.name))}</button>
    <span class="muted">L${proto.level ?? '?'}</span>`;
}

// An object's details; inst adds the contents a container loads with.
function itemBody(o, inst = null, { whereLink = true } = {}) {
  const rows = [['type', o.type], ...(o.stats ?? [])];
  if (o.wear?.length) rows.push(['worn', o.wear.join(', ')]);
  if (o.weight != null) rows.push(['weight', o.weight], ['value', `${o.cost} coins`], ['rent', `${o.rent} / day`]);
  const affects = (o.affects ?? []).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('');
  const contents = inst?.contents?.length
    ? `<div class="item-sub">Contains</div><div class="items">${inst.contents.map((c) => itemHtml(c)).join('')}</div>` : '';
  const extras = (o.extras ?? []).map((x) => `<details class="extra"><summary>${esc(x.keywords)}</summary>${prose(x.desc)}</details>`).join('');
  return `${malformedNote(o)}
    ${o.long ? `<p class="muted">${esc(o.long)}</p>` : ''}
    <table class="kv">${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
    ${affects ? `<div class="item-sub">Affects</div><table class="kv">${affects}</table>` : ''}
    ${o.extra?.length ? `<div class="chips">${chipList(o.extra, ['magic', 'artifact'])}</div>` : ''}
    ${extras}
    ${contents}
    ${whereLink ? `<button class="link small" data-info="item" data-vnum="${o.vnum}">Everywhere this item loads →</button>` : ''}`;
}

// An object instance as an expandable card; containers nest their contents.
function itemHtml(inst, label = '') {
  const o = objProto(inst.obj);
  return `<details class="item">
    <summary>${label ? `<span class="item-slot">${esc(label)}</span>` : ''}<span class="item-name">${esc(o.name)}</span>
      <span class="muted">#${o.vnum}</span></summary>
    <div class="item-body">${itemBody(o, inst)}</div>
  </details>`;
}

function mobStatsHtml(p) {
  const stat = (k, v) => (v == null || v === '' ? '' : `<tr><th>${k}</th><td>${v}</td></tr>`);
  const listRow = (k, arr) => (arr?.length ? stat(k, esc(arr.join(', '))) : '');
  return `
    <table class="kv">
      ${stat('Level', p.level)}
      ${stat('Class', esc(p.classes?.length ? p.classes.join(', ') : 'none'))}
      ${stat('Race', esc(p.race))}
      ${stat('Sex', esc(p.sex))}
      ${stat('Alignment', `${p.alignment} <span class="muted">(${alignKind(p.alignment ?? 0)})</span>`)}
      ${stat('Hit points', p.hp && `${esc(p.hp.text)} <span class="muted">≈ ${p.hp.avg}</span>`)}
      ${stat('Damage', p.damage && `${esc(p.damage.text)} <span class="muted">≈ ${p.damage.avg}</span>`)}
      ${stat('Attacks', p.attacks)}
      ${stat('Armor class', p.ac)}
      ${stat('THAC0', p.thac0)}
      ${stat('Gold', p.gold)}
      ${stat('Experience', p.exp ?? (p.format ? '<span class="muted">computed at load</span>' : null))}
      ${stat('Position', p.position && esc(p.position === p.defaultPosition ? p.position : `${p.position} (default ${p.defaultPosition})`))}
      ${listRow('Resists', p.resist)}
      ${listRow('Immune', p.immune)}
      ${listRow('Susceptible', p.susceptible)}
      ${listRow('Affected by', p.affects)}
    </table>
    ${p.flags?.length ? `<h3>Behaviour</h3><div class="chips">${chipList(p.flags, ['aggressive', 'meta aggressive', 'deadly'])}</div>` : ''}`;
}

function mobDescHtml(p) {
  return `<h3>Description</h3>
    ${p.long ? `<p class="muted">${esc(p.long)}</p>` : ''}
    ${prose(p.desc ?? '')}
    ${p.sounds ? `<h3>Sounds</h3>${p.sounds.near ? prose(p.sounds.near) : ''}${p.sounds.far ? `<p class="muted">From afar: ${esc(p.sounds.far)}</p>` : ''}` : ''}`;
}

function renderMob(spawn) {
  const p = mobProto(spawn);
  const room = state.rooms.get(spawn.room);
  const leader = spawn.follows != null ? state.zone.mobs[spawn.follows] : null;
  const followers = state.zone.mobs.filter((m) => m.follows === spawn.id);
  const eqCount = spawn.equipment.length + spawn.inventory.length;
  const tab = state.mobTab;

  const stats = `${mobStatsHtml(p)}
    ${leader ? `<h3>Follows</h3><p>${mobButton(leader)}</p>` : ''}
    ${followers.length ? `<h3>Followers</h3><ul class="plain">${followers.map((f) => `<li>${mobButton(f)}</li>`).join('')}</ul>` : ''}
    ${mobDescHtml(p)}
    <p><button class="link small" data-info="mob" data-vnum="${p.vnum}">Everywhere this mob loads →</button></p>`;

  const worn = [...spawn.equipment].sort((a, b) => a.pos - b.pos);
  const equipment = `
    <h3>Worn</h3>
    ${worn.length ? `<div class="items">${worn.map((e) => itemHtml(e, e.slot)).join('')}</div>` : '<p class="muted">Nothing</p>'}
    <h3>Carried</h3>
    ${spawn.inventory.length ? `<div class="items">${spawn.inventory.map((i) => itemHtml(i)).join('')}</div>` : '<p class="muted">Nothing</p>'}`;

  details.innerHTML = `
    <button class="link back" data-vnum="${spawn.room}" data-zone="">← ${esc(room?.name ?? `room #${spawn.room}`)}</button>
    <h2>${esc(titleCase(p.name))}</h2>
    <div class="meta">mob #${p.vnum} · ${esc(p.keywords ?? '')}</div>
    ${malformedNote(p)}
    <div class="tabs" role="tablist">
      <button role="tab" data-tab="stats" aria-selected="${tab === 'stats'}">Stats</button>
      <button role="tab" data-tab="equipment" aria-selected="${tab === 'equipment'}">Equipment <span class="count">${eqCount}</span></button>
    </div>
    <div class="tab-panel">${tab === 'stats' ? stats : equipment}</div>`;
}

// GitHub Pages lets browsers reuse files for 10 minutes. Revalidating makes
// regenerated data show up straight away; unchanged files cost a 304.
const fetchData = (url) => fetch(url, { cache: 'no-cache' });

// ---------------------------------------------------------------- prototype views (from search)
async function loadCatalog(name) {
  if (!state.catalogs[name]) {
    state.catalogs[name] = fetchData(`data/${name}.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load ${name}.json: ${res.status}`);
        return res.json();
      })
      .then((list) => new Map(list.map((p) => {
        // Rooms are also found by their description; mobs and items by keywords.
        const extra = name === 'rooms' ? p.desc.replace(/\s+/g, ' ') : p.keywords ?? '';
        p.search = `${p.name} ${extra} #${p.vnum}`.toLowerCase();
        return [p.vnum, p];
      })));
  }
  return state.catalogs[name];
}

// Load locations grouped by zone; each one jumps to that spot on the map.
function loadsHtml(loads, kind) {
  if (!loads.length) {
    return `<p class="muted">No zone reset loads this ${kind === 'mob' ? 'mob' : 'item'} at boot. It may only appear
      through a shop, a special procedure, or not at all.</p>`;
  }
  const byZone = new Map();
  for (const l of loads) {
    if (!byZone.has(l.zone)) byZone.set(l.zone, []);
    byZone.get(l.zone).push(l);
  }
  return [...byZone].map(([zoneId, rows]) => `
    <div class="load-zone">${esc(state.zonesById.get(zoneId)?.name ?? `zone ${zoneId}`)} <span class="count">${rows.length}</span></div>
    <ul class="plain loads">${rows.map((l) => `<li>
      <button class="link" data-load-zone="${l.zone}" data-load-room="${l.room}" data-load-mob="${l.mob ?? ''}"
        data-load-tab="${kind === 'item' && l.mob != null ? 'equipment' : 'stats'}">${esc(l.roomName)} <span class="muted">#${l.room}</span></button>
      ${kind === 'item' ? `<div class="exit-note">${esc(l.holder ? `${l.how} · ${l.holder}` : l.how)}</div>` : ''}
    </li>`).join('')}</ul>`).join('');
}

function infoTabs(tabs) {
  return `<div class="tabs" role="tablist">${tabs.map(([key, label]) => `
    <button role="tab" data-info-tab="${key}" aria-selected="${state.infoTab === key}">${label}</button>`).join('')}</div>`;
}

const backButton = () => `<button class="link back" data-close-info>← Back to ${
  state.selectedMob ? esc(mobProto(state.selectedMob).name) : esc(state.selected?.name ?? 'map')}</button>`;

async function renderInfo() {
  const { kind, vnum } = state.info;
  const catalog = await loadCatalog(kind === 'mob' ? 'mobs' : 'objects');
  if (state.info?.kind !== kind || state.info.vnum !== vnum) return; // superseded while loading
  const p = catalog.get(vnum);
  if (!p) {
    details.innerHTML = `${backButton()}<p class="muted">No ${kind} #${vnum}.</p>`;
    return;
  }
  const loadsTab = `Loads <span class="count">${p.loads.length}</span>`;
  if (kind === 'mob') {
    const tab = state.infoTab === 'loads' ? 'loads' : 'stats';
    details.innerHTML = `${backButton()}
      <h2><span class="dot dot-${alignKind(p.alignment ?? 0)}"></span> ${esc(titleCase(p.name))}</h2>
      <div class="meta">mob #${p.vnum} · ${esc(p.keywords ?? '')}</div>
      ${malformedNote(p)}
      ${infoTabs([['stats', 'Stats'], ['loads', loadsTab]])}
      <div class="tab-panel">${tab === 'stats' ? mobStatsHtml(p) + mobDescHtml(p)
        : `<p class="muted small-note">Equipment is set per load; open one to see what it wears.</p>${loadsHtml(p.loads, 'mob')}`}</div>`;
  } else {
    const tab = state.infoTab === 'loads' ? 'loads' : 'stats';
    details.innerHTML = `${backButton()}
      <h2>${esc(titleCase(p.name))}</h2>
      <div class="meta">item #${p.vnum} · ${esc(p.keywords ?? '')}</div>
      ${infoTabs([['stats', 'Details'], ['loads', loadsTab]])}
      <div class="tab-panel">${tab === 'stats' ? `<div class="item-body flat">${itemBody(p, null, { whereLink: false })}</div>`
        : loadsHtml(p.loads, 'item')}</div>`;
  }
}

function showInfo(kind, vnum, tab = 'stats') {
  state.info = { kind, vnum };
  state.infoTab = tab;
  highlightResult();
  renderInfo().catch(showError);
  writeHash();
}

function closeInfo() {
  state.info = null;
  highlightResult();
  if (state.selectedMob) renderMob(state.selectedMob);
  else renderDetails(state.selected);
  writeHash();
}

function renderDetails(room) {
  if (!room) {
    details.innerHTML = '<p class="muted">Select a room on the map.</p>';
    return;
  }
  const exits = [...room.exits].sort((a, b) => a.dir - b.dir);
  const exitItems = exits.map((exit) => {
    const target = state.rooms.get(exit.to);
    const notes = [];
    let targetHtml;
    if (exit.missing) {
      targetHtml = `<span class="muted">#${exit.to} (missing room)</span>`;
    } else {
      targetHtml = `<button class="link" data-vnum="${exit.to}" data-zone="${exit.toZone ?? ''}">${roomLabel(exit.to, exit.toZone)}</button>`;
    }
    if (target) {
      const back = target.exits.some((e) => e.dir === OPPOSITE[exit.dir] && e.to === room.vnum);
      if (!back) notes.push(target.exits.some((e) => e.to === room.vnum) ? 'returns by a different direction' : 'one-way');
      if (target.vnum !== room.vnum && !isAligned(room.pos, target.pos, exit.dir)) notes.push('off-grid');
    }
    if (exit.toZone != null) notes.push('leads to another zone');
    const chips = (exit.flags ?? []).map((f) => `<span class="chip${f === 'secret' ? ' warn' : ''}">${esc(f)}</span>`);
    if (exit.key) chips.push(`<span class="chip">key #${exit.key}</span>`);
    return `<li>
      <div class="exit-head"><span class="exit-dir">${DIRS[exit.dir] ?? `dir ${exit.dir}`}</span>${targetHtml}</div>
      ${notes.length ? `<div class="exit-note">${esc(notes.join(' · '))}</div>` : ''}
      ${exit.keywords ? `<div class="exit-note">Keywords: ${esc(exit.keywords)}</div>` : ''}
      ${chips.length ? `<div class="chips" style="margin-top:4px">${chips.join('')}</div>` : ''}
      ${exit.desc ? `<div class="exit-note">${esc(exit.desc)}</div>` : ''}
    </li>`;
  });

  // Rooms in this zone that lead here without this room leading back.
  const incoming = [];
  for (const other of state.rooms.values()) {
    if (other.vnum === room.vnum) continue;
    for (const e of other.exits) {
      if (e.to === room.vnum && !room.exits.some((x) => x.to === other.vnum)) {
        incoming.push(`<li><div class="exit-head"><span class="exit-dir">${DIRS[e.dir]}</span>
          <button class="link" data-vnum="${other.vnum}" data-zone="">from ${roomLabel(other.vnum)}</button></div></li>`);
      }
    }
  }

  const flagChips = room.flags.map((f) => `<span class="chip${f === 'death' ? ' warn' : ''}">${esc(f.replace('_', ' '))}</span>`);
  let teleport = '';
  if (room.teleport) {
    const t = room.teleport;
    teleport = `<h3>Teleport</h3><p>Every ${t.time} ticks to
      <button class="link" data-vnum="${t.target}" data-zone="${t.toZone ?? ''}">${roomLabel(t.target, t.toZone)}</button>
      ${t.flags.length ? `<span class="muted">(${esc(t.flags.join(', '))})</span>` : ''}</p>`;
  }
  const extras = room.extras.map((x) => `<details class="extra"><summary>${esc(x.keywords)}</summary>${prose(x.desc)}</details>`);
  const mobsHere = state.zone.mobs.filter((m) => m.room === room.vnum);
  const itemsHere = room.items ?? [];

  details.innerHTML = `
    <h2>${esc(room.name)}</h2>
    <div class="meta">#${room.vnum} · ${esc(room.sector.replace('_', ' '))} · grid ${room.pos.join(', ')}</div>
    ${flagChips.length ? `<div class="chips">${flagChips.join('')}</div>` : ''}
    <h3>Description</h3>
    ${prose(room.desc)}
    ${mobsHere.length ? `<h3>Mobs here</h3><ul class="plain">${mobsHere.map((m) => `<li>${mobButton(m)}</li>`).join('')}</ul>` : ''}
    ${itemsHere.length ? `<h3>Items here</h3><div class="items">${itemsHere.map((i) => itemHtml(i)).join('')}</div>` : ''}
    <h3>Exits</h3>
    ${exitItems.length ? `<ul class="exits">${exitItems.join('')}</ul>` : '<p class="muted">None</p>'}
    ${incoming.length ? `<h3>One-way entrances</h3><ul class="exits">${incoming.join('')}</ul>` : ''}
    ${teleport}
    ${extras.length ? `<h3>Look at</h3>${extras.join('')}` : ''}
  `;
}

details.addEventListener('click', (e) => {
  const infoBtn = e.target.closest('button[data-info]');
  if (infoBtn) {
    showInfo(infoBtn.dataset.info, Number(infoBtn.dataset.vnum), 'loads');
    return;
  }
  const infoTab = e.target.closest('button[data-info-tab]');
  if (infoTab) {
    state.infoTab = infoTab.dataset.infoTab;
    renderInfo().catch(showError);
    return;
  }
  if (e.target.closest('button[data-close-info]')) {
    closeInfo();
    return;
  }
  const loadBtn = e.target.closest('button[data-load-zone]');
  if (loadBtn) {
    const { loadZone: z, loadRoom: r, loadMob: m, loadTab: tab } = loadBtn.dataset;
    state.info = null;
    highlightResult();
    goTo(Number(z), Number(r), m === '' ? null : Number(m), tab).catch(showError);
    return;
  }
  const tabBtn = e.target.closest('button[data-tab]');
  if (tabBtn) {
    state.mobTab = tabBtn.dataset.tab;
    renderMob(state.selectedMob);
    return;
  }
  const mobBtn = e.target.closest('button[data-mob]');
  if (mobBtn) {
    selectMob(Number(mobBtn.dataset.mob));
    return;
  }
  const btn = e.target.closest('button.link');
  if (!btn) return;
  const vnum = Number(btn.dataset.vnum);
  const zone = btn.dataset.zone === '' ? null : Number(btn.dataset.zone);
  if (zone == null || zone === state.zone?.id) {
    selectRoom(vnum);
    const mesh = state.roomMeshes.get(vnum);
    if (mesh) controls.target.copy(mesh.position);
  } else {
    goTo(zone, vnum);
  }
});

// ---------------------------------------------------------------- selection & navigation
function highlightRoom(room) {
  state.selected = room;
  // Follow the selection onto its floor when a single floor is shown.
  if (room && state.level != null && room.pos[1] !== state.level) setLevel(room.pos[1]);
  const mesh = room && state.roomMeshes.get(room.vnum);
  selectionBox.visible = Boolean(mesh);
  if (mesh) selectionBox.position.copy(mesh.position);
}

function selectRoom(vnum) {
  const room = state.rooms.get(vnum) ?? null;
  state.info = null;
  highlightResult();
  highlightRoom(room);
  state.selectedMob = null;
  mobSelection.visible = false;
  renderDetails(room);
  writeHash();
}

function selectMob(id, tab = null) {
  const spawn = state.zone.mobs[id];
  if (!spawn) return;
  state.info = null;
  highlightResult();
  if (tab) state.mobTab = tab;
  else if (state.selectedMob !== spawn) state.mobTab = 'stats';
  state.selectedMob = spawn;
  highlightRoom(state.rooms.get(spawn.room) ?? null);
  const mesh = state.mobMeshes.get(id);
  mobSelection.visible = Boolean(mesh);
  if (mesh) mobSelection.position.copy(mesh.position);
  renderMob(spawn);
  writeHash();
}

// ---------------------------------------------------------------- world overview
// Zones as a 3D force-directed graph, drawn with the same renderer but its own
// scene and camera: spheres sized by room count, rods weighted by the number of
// exits between two zones. Depth gives the graph far more room than a flat
// layout; links are faint until you hover a zone, which lights up its own
// links and neighbours and fades the rest.
const worldEl = $('#world');
const worldLabels = $('#world-labels');
const worldToggle = $('#world-toggle');
const mapPane = document.querySelector('.map');

const worldScene = new THREE.Scene();
worldScene.add(new THREE.HemisphereLight(0xdde6ff, 0x20242c, 1.2));
const worldSun = new THREE.DirectionalLight(0xffffff, 1.3);
worldSun.position.set(0.5, 1, 0.7);
worldScene.add(worldSun);
const worldCamera = new THREE.PerspectiveCamera(45, 1, 1, 20000);
const worldControls = new OrbitControls(worldCamera, renderer.domElement);
worldControls.enabled = false;
worldControls.enableDamping = true;
worldControls.dampingFactor = 0.12;
new ResizeObserver(() => {
  const { clientWidth: w, clientHeight: h } = viewport;
  if (w && h) { worldCamera.aspect = w / h; worldCamera.updateProjectionMatrix(); }
}).observe(viewport);

const worldMaterials = {
  node: themed(new THREE.MeshStandardMaterial({ roughness: 0.6 }), 'world-node'),
  hot: themed(new THREE.MeshStandardMaterial({ roughness: 0.4, emissiveIntensity: 0.35 }), 'accent'),
  faded: themed(new THREE.MeshStandardMaterial({ roughness: 0.6, transparent: true, opacity: 0.15, depthWrite: false }), 'world-node'),
  edge: themed(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.2, depthWrite: false }), 'twoway'),
  edgeHot: themed(new THREE.MeshBasicMaterial(), 'accent'),
  edgeFaded: themed(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.04, depthWrite: false }), 'twoway'),
};

// One material per level colour; zones without one use the neutral node colour.
const levelMaterials = new Map();
function zoneMaterial(z) {
  const color = levelColor(z.levels);
  if (!color) return worldMaterials.node;
  const key = color.getHexString();
  if (!levelMaterials.has(key)) levelMaterials.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.55 }));
  return levelMaterials.get(key);
}

// The current zone keeps its level colour and gets an orange halo, like the
// room marker on the zone map.
const worldHalo = new THREE.Mesh(
  new THREE.SphereGeometry(1, 24, 16),
  themed(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false }), 'player'),
);
worldHalo.visible = false;
worldScene.add(worldHalo);

function rethemeWorld() {
  worldScene.traverse((obj) => {
    const key = obj.material?.userData.colorKey;
    if (key) obj.material.color.copy(COLORS[key]);
  });
  for (const m of Object.values(worldMaterials)) {
    m.color.copy(COLORS[m.userData.colorKey]);
    if (m.emissive) m.emissive.copy(m.color);
  }
  worldMaterials.node.emissive.setRGB(0, 0, 0);
  worldMaterials.faded.emissive.setRGB(0, 0, 0);
}
document.addEventListener('themechange', rethemeWorld);

let worldOpen = false;
let worldGraph = null;
let worldHover = null;

function layoutWorld() {
  const count = state.index.length;
  const nodes = state.index.map((z, i) => {
    // Deterministic start: points spread evenly over a sphere (golden spiral).
    const y = 1 - (2 * (i + 0.5)) / count, ring = Math.sqrt(1 - y * y), a = i * 2.399963;
    return {
      z, edges: [], r: 4 + Math.sqrt(z.roomCount) * 1.1,
      pos: new THREE.Vector3(Math.cos(a) * ring * 300, y * 300, Math.sin(a) * ring * 300), vel: new THREE.Vector3(),
    };
  });
  const byId = new Map(nodes.map((n) => [n.z.id, n]));
  const weights = new Map();
  for (const n of nodes) {
    for (const [to, c] of Object.entries(n.z.links ?? {})) {
      const m = byId.get(Number(to));
      if (!m || m === n) continue;
      const key = n.z.id < m.z.id ? `${n.z.id}-${m.z.id}` : `${m.z.id}-${n.z.id}`;
      weights.set(key, (weights.get(key) ?? 0) + c);
    }
  }
  const edges = [...weights].map(([key, w]) => {
    const [a, b] = key.split('-').map(Number);
    const e = { a: byId.get(a), b: byId.get(b), w };
    e.a.edges.push(e);
    e.b.edges.push(e);
    return e;
  });
  const linked = nodes.filter((n) => n.edges.length);
  const unlinked = nodes.filter((n) => !n.edges.length);

  // Spring embedder in 3D: every pair repels, linked zones attract, and a weak
  // pull toward the centre keeps the cluster together.
  const d = new THREE.Vector3();
  for (let step = 0, heat = 1; step < 500; step++, heat *= 0.992) {
    for (let i = 0; i < linked.length; i++) {
      for (let j = i + 1; j < linked.length; j++) {
        const p = linked[i], q = linked[j];
        d.subVectors(p.pos, q.pos);
        const d2 = Math.max(d.lengthSq(), 1);
        const minD = p.r + q.r + 25;
        const f = 9000 / d2 + (d2 < minD * minD ? 3 : 0);
        d.multiplyScalar(f / Math.sqrt(d2));
        p.vel.add(d);
        q.vel.sub(d);
      }
    }
    for (const { a, b } of edges) {
      d.subVectors(b.pos, a.pos);
      const len = Math.max(d.length(), 1);
      d.multiplyScalar(((len - (a.r + b.r + 45)) * 0.015) / len);
      a.vel.add(d);
      b.vel.sub(d);
    }
    for (const n of linked) {
      n.vel.addScaledVector(n.pos, -0.004);
      const cap = 20 * heat + 0.5;
      if (n.vel.length() > cap) n.vel.setLength(cap);
      n.pos.add(n.vel);
      n.vel.multiplyScalar(0.5);
    }
  }

  // Zones linked to nothing go on a ring under the cluster.
  const box = new THREE.Box3().setFromPoints(linked.map((n) => n.pos));
  const center = box.getCenter(new THREE.Vector3());
  const ringY = box.min.y - 140;
  const ringR = Math.max(90, (unlinked.length * 70) / (2 * Math.PI));
  unlinked.forEach((n, i) => {
    const a = (i / unlinked.length) * Math.PI * 2;
    n.pos.set(center.x + Math.cos(a) * ringR, ringY, center.z + Math.sin(a) * ringR);
  });
  const caption = unlinked.length ? new THREE.Vector3(center.x, ringY + 45, center.z) : null;
  return { nodes, edges, caption };
}

function buildWorld() {
  worldGraph = layoutWorld();
  const sphere = new THREE.SphereGeometry(1, 24, 16);
  const rod = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
  for (const n of worldGraph.nodes) {
    n.mesh = new THREE.Mesh(sphere, zoneMaterial(n.z));
    n.mesh.position.copy(n.pos);
    n.mesh.scale.setScalar(n.r);
    n.mesh.userData.node = n;
    worldScene.add(n.mesh);
    n.label = document.createElement('div');
    n.label.className = 'world-label off'; // fades in once placed
    n.label.textContent = n.z.name;
    worldLabels.append(n.label);
  }
  const up = new THREE.Vector3(0, 1, 0);
  for (const e of worldGraph.edges) {
    const dir = e.b.pos.clone().sub(e.a.pos);
    const len = dir.length();
    const width = 0.5 + Math.log2(e.w) * 0.45;
    e.mesh = new THREE.Mesh(rod, worldMaterials.edge);
    e.mesh.position.copy(e.a.pos).addScaledVector(dir, 0.5);
    e.mesh.quaternion.setFromUnitVectors(up, dir.normalize());
    e.mesh.scale.set(width, len, width);
    worldScene.add(e.mesh);
  }
  if (worldGraph.caption) {
    worldGraph.captionLabel = document.createElement('div');
    worldGraph.captionLabel.className = 'world-label world-caption off';
    worldGraph.captionLabel.textContent = 'Not linked to other zones';
    worldLabels.append(worldGraph.captionLabel);
  }
  rethemeWorld();
  fitWorldCamera();
}

function fitWorldCamera() {
  const center = new THREE.Box3().setFromPoints(worldGraph.nodes.map((n) => n.pos)).getCenter(new THREE.Vector3());
  const radius = Math.max(...worldGraph.nodes.map((n) => n.pos.distanceTo(center) + n.r));
  const vHalf = THREE.MathUtils.degToRad(worldCamera.fov / 2);
  const half = Math.min(vHalf, Math.atan(Math.tan(vHalf) * worldCamera.aspect));
  const dist = radius / Math.sin(half);
  worldControls.target.copy(center);
  worldCamera.position.copy(center).addScaledVector(new THREE.Vector3(0, 0.35, 1).normalize(), dist);
}

// Hovering a zone highlights it, its neighbours and the links between them.
function applyWorldHighlight() {
  const focus = worldHover;
  worldHalo.visible = false;
  const near = focus ? new Set([focus, ...focus.edges.map((e) => (e.a === focus ? e.b : e.a))]) : null;
  for (const n of worldGraph.nodes) {
    const current = n.z.id === state.zone?.id;
    const inFocus = !near || near.has(n);
    n.mesh.material = n === focus ? worldMaterials.hot : inFocus ? zoneMaterial(n.z) : worldMaterials.faded;
    if (current) {
      worldHalo.visible = true;
      worldHalo.position.copy(n.pos);
      worldHalo.scale.setScalar(n.r * 1.6 + 3);
    }
    // Label priority: current zone, hovered zone, its neighbours, then size.
    n.priority = (current ? 3e6 : 0) + (n === focus ? 2e6 : 0) + (near?.has(n) ? 1e6 : 0) + n.z.roomCount;
    n.labelHidden = !inFocus;
    n.label.classList.toggle('current', current);
    n.label.classList.toggle('hot', Boolean(near?.has(n)));
    n.label.classList.toggle('faded', !inFocus);
  }
  for (const e of worldGraph.edges) {
    e.mesh.material = !focus ? worldMaterials.edge
      : e.a === focus || e.b === focus ? worldMaterials.edgeHot : worldMaterials.edgeFaded;
  }
}

// HTML labels follow their spheres. Each frame they're placed in priority
// order and any label that would overlap one already placed is skipped, so
// zooming in makes room for more of them.
const labelPos = new THREE.Vector3();
function updateWorldLabels() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  const placed = [];
  const tryPlace = (el, pos, width, force = false) => {
    labelPos.copy(pos).project(worldCamera);
    const x = ((labelPos.x + 1) / 2) * w, y = ((1 - labelPos.y) / 2) * h;
    const rect = { l: x - width / 2 - 3, r: x + width / 2 + 3, t: y - 1, b: y + 15 };
    const fits = labelPos.z < 1 && (force || !placed.some((p) => rect.l < p.r && rect.r > p.l && rect.t < p.b && rect.b > p.t));
    // Fade rather than toggle display, and keep following the sphere while
    // hidden so a label fades back in at the right spot.
    el.classList.toggle('off', !fits);
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, 0)`;
    if (fits) placed.push(rect);
    return fits;
  };
  if (worldGraph.captionLabel) tryPlace(worldGraph.captionLabel, worldGraph.caption, 170, true);
  // Labels already showing get a bonus (below the hover tiers) so they don't
  // trade places with their neighbours every frame as the camera moves.
  const rank = (n) => n.priority + (n.labelShown ? 5e5 : 0);
  const order = [...worldGraph.nodes].sort((a, b) => rank(b) - rank(a));
  for (const n of order) {
    if (n.labelHidden) {
      n.label.classList.add('off');
      n.labelShown = false;
      continue;
    }
    n.labelWidth ??= n.z.name.length * 6.3 + 4;
    labelPos.copy(n.pos);
    labelPos.y -= n.r * 1.15;
    n.labelShown = tryPlace(n.label, labelPos.clone(), n.labelWidth, n.priority >= 3e6);
  }
}

function renderWorldFrame() {
  worldControls.update();
  updateWorldLabels();
  renderer.render(worldScene, worldCamera);
}

function worldPick(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, worldCamera);
  return raycaster.intersectObjects(worldGraph.nodes.map((n) => n.mesh), false)[0]?.object.userData.node ?? null;
}

// Hover intent: a zone lights up only after the pointer rests on it briefly,
// and the highlight lingers a moment after leaving, so sweeping across the
// map doesn't flash the whole graph. Nothing changes while dragging.
const HOVER_ENTER_MS = 150;
const HOVER_LEAVE_MS = 350;
let hoverPending;
let hoverTimer = null;

function scheduleWorldHover(node) {
  if (node === hoverPending) return;
  hoverPending = node;
  clearTimeout(hoverTimer);
  if (node === worldHover) return;
  hoverTimer = setTimeout(() => {
    worldHover = node;
    applyWorldHighlight();
  }, node ? HOVER_ENTER_MS : HOVER_LEAVE_MS);
}

function worldPointerMove(e) {
  if (e.buttons) { // orbiting or panning
    tooltip.hidden = true;
    return;
  }
  const node = worldPick(e);
  renderer.domElement.style.cursor = node ? 'pointer' : '';
  scheduleWorldHover(node);
  if (!node) { tooltip.hidden = true; return; }
  const lv = node.z.levels ? ` · levels ${node.z.levels.text}` : '';
  tooltip.textContent = `${node.z.name}${lv} · ${node.z.roomCount} rooms · ${node.z.mobCount ?? 0} mobs · linked to ${node.edges.length} zone${node.edges.length === 1 ? '' : 's'}`;
  showTooltipAt(e);
}

function worldClick(e) {
  const node = worldPick(e);
  if (!node) return;
  setWorldOpen(false);
  goTo(node.z.id, null).catch(showError);
}

function setWorldOpen(open) {
  worldOpen = open;
  worldEl.hidden = !open;
  mapPane.classList.toggle('world-mode', open);
  worldToggle.setAttribute('aria-pressed', String(open));
  worldToggle.textContent = open ? 'Back to zone' : 'World map';
  controls.enabled = !open;
  worldControls.enabled = open;
  tooltip.hidden = true;
  renderer.domElement.style.cursor = '';
  if (open) {
    if (!worldGraph) buildWorld();
    worldHover = null;
    applyWorldHighlight();
  }
}

worldToggle.addEventListener('click', () => setWorldOpen(!worldOpen));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && worldOpen && !credits.open) setWorldOpen(false);
});

// ---------------------------------------------------------------- numpad walking
// Numpad keys follow the selected room's exits like the game's movement
// commands. event.code names the physical key, so NumLock doesn't matter.
const NUMPAD_DIRS = { Numpad8: 0, Numpad6: 1, Numpad2: 2, Numpad4: 3, Numpad9: 4, Numpad3: 5 };
const toast = $('#toast');
let toastTimer = null;

function showToast(text) {
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1400);
}

// Move the orbit target to pos and the camera by the same amount, so the view
// pans without turning.
function panTo(pos) {
  const delta = pos.clone().sub(controls.target);
  controls.target.add(delta);
  camera.position.add(delta);
}

function walk(dir) {
  const room = state.selected;
  if (!room) return;
  const exit = room.exits.find((e) => e.dir === dir);
  if (!exit) {
    showToast(`No exit ${DIRS[dir]}.`);
    return;
  }
  if (exit.missing) {
    showToast(`The exit ${DIRS[dir]} leads to room #${exit.to}, which doesn't exist.`);
    return;
  }
  if (exit.toZone != null) {
    goTo(exit.toZone, exit.to).catch(showError);
    return;
  }
  selectRoom(exit.to);
  const mesh = state.roomMeshes.get(exit.to);
  if (mesh) panTo(mesh.position);
}

document.addEventListener('keydown', (e) => {
  const dir = NUMPAD_DIRS[e.code];
  if (dir == null || e.ctrlKey || e.metaKey || e.altKey || worldOpen) return;
  if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return;
  if (credits.open) return;
  e.preventDefault();
  walk(dir);
});

async function loadZone(id) {
  if (!state.zoneCache.has(id)) {
    const entry = state.zonesById.get(id);
    const res = await fetchData(`data/${entry.file}`);
    if (!res.ok) throw new Error(`Failed to load ${entry.file}: ${res.status}`);
    state.zoneCache.set(id, await res.json());
  }
  return state.zoneCache.get(id);
}

async function goTo(zoneId, vnum, mobId = null, mobTab = null) {
  if (worldOpen) setWorldOpen(false);
  if (!state.zonesById.has(zoneId)) zoneId = state.index[0].id;
  if (state.zone?.id !== zoneId) {
    const zone = await loadZone(zoneId);
    state.zone = zone;
    buildZone(zone);
    const levels = state.zonesById.get(zoneId)?.levels;
    mapTitle.innerHTML = `${esc(zone.name)}<small>#${zone.bottom}–${zone.top} · ${zone.rooms.length} rooms${
      levels ? ` · levels ${esc(levels.text)}` : ''}</small>`;
    for (const btn of zoneList.querySelectorAll('button')) {
      btn.classList.toggle('active', Number(btn.dataset.zone) === zoneId);
    }
  }
  if (mobId != null && state.zone.mobs[mobId]) {
    selectMob(mobId, mobTab);
    const mesh = state.mobMeshes.get(mobId);
    if (mesh) controls.target.copy(mesh.position);
    return;
  }
  const start = state.rooms.has(vnum) ? vnum : state.zone.rooms[0]?.vnum;
  selectRoom(start);
  const mesh = state.roomMeshes.get(start);
  if (mesh && vnum != null && state.rooms.has(vnum)) controls.target.copy(mesh.position);
}

function writeHash() {
  const hash = `#zone=${state.zone?.id ?? ''}${state.selected ? `&room=${state.selected.vnum}` : ''}`
    + (state.selectedMob ? `&mob=${state.selectedMob.id}` : '')
    + (state.info ? `&${state.info.kind === 'mob' ? 'mobinfo' : 'item'}=${state.info.vnum}` : '');
  if (location.hash !== hash) history.replaceState(null, '', hash);
}

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const zone = params.has('zone') ? Number(params.get('zone')) : null;
  const room = params.has('room') ? Number(params.get('room')) : null;
  const mob = params.has('mob') ? Number(params.get('mob')) : null;
  let info = null;
  if (params.has('mobinfo')) info = { kind: 'mob', vnum: Number(params.get('mobinfo')) };
  if (params.has('item')) info = { kind: 'item', vnum: Number(params.get('item')) };
  return { zone, room, mob, info };
}

// ---------------------------------------------------------------- left pane: zones, mob and item search
const SEARCH_LIMIT = 200;
const PLACEHOLDERS = {
  zones: 'Filter zones…', rooms: 'Search room names and descriptions…', mobs: 'Search mobs by name, keyword or #vnum…', items: 'Search items by name, keyword or #vnum…',
};
const CATALOG_FOR = { rooms: 'rooms', mobs: 'mobs', items: 'objects' };

// A short excerpt of a room description around the first matched word.
function snippet(desc, words) {
  const text = desc.replace(/\s+/g, ' ').trim();
  const lower = text.toLowerCase();
  const at = Math.min(...words.map((w) => lower.indexOf(w)).filter((i) => i >= 0));
  if (!Number.isFinite(at)) return '';
  const start = Math.max(0, at - 30);
  const end = Math.min(text.length, at + 70);
  // Split the raw text on the search words, then escape each piece, so a
  // match never lands inside an HTML entity.
  const pattern = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  const html = text.slice(start, end).split(pattern)
    .map((part, i) => (i % 2 ? `<mark>${esc(part)}</mark>` : esc(part))).join('');
  return `${start > 0 ? '…' : ''}${html}${end < text.length ? '…' : ''}`;
}

function setSide(side) {
  state.queries[state.side] = zoneFilter.value;
  state.side = side;
  zoneFilter.value = state.queries[side];
  zoneFilter.placeholder = PLACEHOLDERS[side];
  for (const b of document.querySelectorAll('[data-side]')) b.setAttribute('aria-selected', String(b.dataset.side === side));
  zoneList.hidden = side !== 'zones';
  searchList.hidden = side === 'zones';
  searchStatus.hidden = side === 'zones';
  if (side === 'zones') renderZoneList();
  else runSearch();
  zoneFilter.focus();
}
document.querySelector('.side-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-side]');
  if (b && b.dataset.side !== state.side) setSide(b.dataset.side);
});

// Every word must appear in the name, keywords or "#vnum". Names that start
// with the query rank first, then other name matches, then keyword-only ones.
async function runSearch() {
  const side = state.side;
  const catalogName = CATALOG_FOR[side];
  if (!state.catalogs[catalogName]) searchStatus.textContent = 'Loading…';
  const catalog = await loadCatalog(catalogName);
  if (state.side !== side) return;
  const q = zoneFilter.value.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const results = [];
  for (const p of catalog.values()) {
    if (!words.every((w) => p.search.includes(w))) continue;
    const name = p.name.toLowerCase();
    const rank = !q ? 0 : name.startsWith(q) || name.replace(/^(an?|the|some) /, '').startsWith(q) ? 0 : words.every((w) => name.includes(w)) ? 1 : 2;
    results.push([rank, (p.loads?.length ?? 1) ? 0 : 1, name.replace(/^(an?|the|some) /, ''), p]);
  }
  results.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2]));
  const shown = results.slice(0, SEARCH_LIMIT);
  searchList.innerHTML = shown.map(([rank, , , p]) => {
    if (side === 'rooms') {
      const zoneName = state.zonesById.get(p.zone)?.name ?? `zone ${p.zone}`;
      return `<li><button data-result="room" data-vnum="${p.vnum}" data-zone="${p.zone}" class="result">
        <span class="result-main"><span class="result-name">${esc(p.name)}</span>
        <span class="result-sub">#${p.vnum} · ${esc(zoneName)}</span>
        ${rank === 2 ? `<span class="result-snippet">${snippet(p.desc, words)}</span>` : ''}</span></button></li>`;
    }
    const kind = side === 'mobs' ? 'mob' : 'item';
    const sub = side === 'mobs' ? `L${p.level ?? '?'} · ${esc(p.race ?? '')}` : esc(p.type ?? '');
    const lead = side === 'mobs' ? `<span class="dot dot-${alignKind(p.alignment ?? 0)}"></span>` : '';
    return `<li><button data-result="${kind}" data-vnum="${p.vnum}" class="result${p.loads.length ? '' : ' unloaded'}">
      ${lead}<span class="result-main"><span class="result-name">${esc(titleCase(p.name))}</span>
      <span class="result-sub">#${p.vnum} · ${sub}</span></span>
      <span class="count" title="Loads at boot">${p.loads.length || '–'}</span></button></li>`;
  }).join('');
  searchStatus.textContent = !results.length ? 'No matches.'
    : results.length > SEARCH_LIMIT ? `Showing ${SEARCH_LIMIT} of ${results.length}. Keep typing to narrow it down.`
      : `${results.length} ${results.length === 1 ? 'match' : 'matches'}`;
  highlightResult();
}

function highlightResult() {
  for (const b of searchList.querySelectorAll('button[data-result]')) {
    const vnum = Number(b.dataset.vnum);
    const active = b.dataset.result === 'room'
      ? !state.info && !state.selectedMob && state.selected?.vnum === vnum
      : state.info?.kind === b.dataset.result && state.info.vnum === vnum;
    b.classList.toggle('active', active);
  }
}

searchList.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-result]');
  if (!b) return;
  if (b.dataset.result === 'room') goTo(Number(b.dataset.zone), Number(b.dataset.vnum)).then(highlightResult, showError);
  else showInfo(b.dataset.result, Number(b.dataset.vnum));
});

function renderZoneList() {
  const q = zoneFilter.value.trim().toLowerCase();
  zoneList.innerHTML = state.index
    .filter((z) => !q || z.name.toLowerCase().includes(q) || String(z.id) === q)
    .map((z) => `<li><button data-zone="${z.id}" class="${z.id === state.zone?.id ? 'active' : ''}" title="Rooms #${z.bottom}–${z.top}">
        <span>${esc(z.name)}</span><span class="zone-meta">${levelChip(z.levels)}<span class="count">${z.roomCount}</span></span></button></li>`)
    .join('');
}
zoneFilter.addEventListener('input', () => {
  if (state.side === 'zones') renderZoneList();
  else runSearch().catch(showError);
});
zoneList.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-zone]');
  if (btn) goTo(Number(btn.dataset.zone), null);
});

// ---------------------------------------------------------------- boot
async function init() {
  const res = await fetchData('data/zones.json');
  if (!res.ok) throw new Error('data/zones.json not found. Run tools/convert_world.py first.');
  state.index = await res.json();
  state.zonesById = new Map(state.index.map((z) => [z.id, z]));
  renderZoneList();
  const { zone, room, mob, info } = readHash();
  if (zone == null && state.zonesById.has(DEFAULT_ZONE)) {
    await goTo(DEFAULT_ZONE, DEFAULT_ROOM);
  } else {
    await goTo(zone ?? state.index[0].id, room, mob);
  }
  if (info) showInfo(info.kind, info.vnum);
}

function showError(err) {
  console.error(err);
  details.innerHTML = `<p class="muted">Error: ${esc(err.message)}</p>`;
}

init().catch(showError);
