import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

// Exit direction indices match the .wld file: D0..D5.
const DIRS = ['north', 'east', 'south', 'west', 'up', 'down'];
const OPPOSITE = [2, 3, 0, 1, 5, 4];
const VEC = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 1, 0], [0, -1, 0]];

const SPACING = 2.2;   // world units between grid cells
const CUBE = 1;        // room cube size
const DEFAULT_ZONE = 30;

const SECTOR_COLORS = {
  inside: '#8a7f72', city: '#9aa3ad', field: '#8cc56a', forest: '#3f8f4a',
  hills: '#b39359', mountain: '#8b6f5a', water_swim: '#4aa3df', water_noswim: '#2f6fb5',
  air: '#cfe8ff', underwater: '#1f4f8f', desert: '#e0c476', tree: '#5f7f2f',
};

// Scene colors come from the CSS variables so they follow the light/dark theme.
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
const COLOR_KEYS = [
  'twoway', 'oneway', 'warp', 'teleport', 'external', 'door', 'secret', 'accent', 'bg', 'grid-major', 'grid-minor',
  'mob-good', 'mob-neutral', 'mob-evil',
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
  mobs: new THREE.Group(),
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
const MOB_SIZE = 0.13;
const mobGeometry = new THREE.SphereGeometry(MOB_SIZE, 14, 10);
const aggroGeometry = new THREE.OctahedronGeometry(MOB_SIZE * 1.45);
const mobMaterials = Object.fromEntries(['good', 'neutral', 'evil'].map((k) => [
  k, themed(new THREE.MeshStandardMaterial({ roughness: 0.4, emissiveIntensity: 0.35 }), `mob-${k}`),
]));
const sharedMaterials = new Set([...Object.values(mobMaterials)]);
const sharedGeometries = new Set([mobGeometry, aggroGeometry]);

const selectionBox = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(CUBE * 1.35, CUBE * 1.35, CUBE * 1.35)),
  themed(new THREE.LineBasicMaterial(), 'accent'),
);
selectionBox.visible = false;
scene.add(selectionBox);

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

renderer.setAnimationLoop(() => {
  controls.update();
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
    const mesh = new THREE.Mesh(cubeGeometry, sectorMaterial(room.sector));
    mesh.position.copy(toWorld(room.pos));
    mesh.userData = { vnum: room.vnum };
    world.add(mesh);
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
      group.add(tube(curve, kind, 0.05, aligned ? 1 : 24));
      if (!back) group.add(arrowOn(curve, kind));
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
        layers.teleport.add(line, arrowOn(curve, 'teleport', 0.8));
      }
    }
  }

  const box = new THREE.Box3().setFromObject(world);
  buildGrid(box);
  addMobs(zone);

  for (const layer of Object.values(layers)) world.add(layer);
  applyLayerVisibility();
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
}

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
    mesh.userData = { mobId: spawn.id };
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
  layers.doors.add(plate);
}

function addExternal(room, exit) {
  const from = toWorld(room.pos);
  const to = from.clone().addScaledVector(dirVec(exit.dir), SPACING * 0.75);
  const colorKey = exit.missing ? 'secret' : 'external';
  layers.external.add(tube(new THREE.LineCurve3(from, to), colorKey, 0.04));
  const ghost = new THREE.Mesh(
    new THREE.BoxGeometry(CUBE * 0.4, CUBE * 0.4, CUBE * 0.4),
    themed(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.75 }), colorKey),
  );
  ghost.position.copy(to);
  ghost.userData = { vnum: exit.to, external: true, zone: exit.toZone, missing: exit.missing };
  layers.external.add(ghost);
  pickables.push(ghost);
}

function fitCamera(box) {
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 4);
  const dist = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.85;
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(0, 0.75, 0.9).normalize().multiplyScalar(dist));
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
  for (const m of Object.values(mobMaterials)) m.emissive.copy(m.color);
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
  const hit = raycaster.intersectObjects(pickables.filter((o) => o.parent?.visible !== false), false)[0];
  return hit?.object ?? null;
}

let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
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
  const obj = pick(e);
  if (obj && !obj.userData.external) controls.target.copy(obj.position);
});
renderer.domElement.addEventListener('pointermove', (e) => {
  const obj = pick(e);
  renderer.domElement.style.cursor = obj ? 'pointer' : '';
  if (!obj) { tooltip.hidden = true; return; }
  const { vnum, external, zone, missing, mobId } = obj.userData;
  let text;
  if (mobId != null) {
    const proto = mobProto(state.zone.mobs[mobId]);
    text = `${proto.name}  · level ${proto.level ?? '?'}`;
  } else if (!external) text = `${state.rooms.get(vnum).name}  #${vnum}`;
  else if (missing) text = `Exit to #${vnum} (room does not exist)`;
  else text = `→ #${vnum} in ${state.zonesById.get(zone)?.name ?? `zone ${zone}`}`;
  tooltip.textContent = text;
  tooltip.hidden = false;
  const rect = viewport.getBoundingClientRect();
  tooltip.style.left = `${e.clientX - rect.left + 14}px`;
  tooltip.style.top = `${e.clientY - rect.top + 12}px`;
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
        p.search = `${p.name} ${p.keywords ?? ''} #${p.vnum}`.toLowerCase();
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
  if (!state.zonesById.has(zoneId)) zoneId = state.index[0].id;
  if (state.zone?.id !== zoneId) {
    const zone = await loadZone(zoneId);
    state.zone = zone;
    buildZone(zone);
    mapTitle.innerHTML = `${esc(zone.name)}<small>#${zone.bottom}–${zone.top} · ${zone.rooms.length} rooms</small>`;
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
const PLACEHOLDERS = { zones: 'Filter zones…', mobs: 'Search mobs by name, keyword or #vnum…', items: 'Search items by name, keyword or #vnum…' };

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
  const catalogName = side === 'mobs' ? 'mobs' : 'objects';
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
    results.push([rank, p.loads.length ? 0 : 1, name.replace(/^(an?|the|some) /, ''), p]);
  }
  results.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2]));
  const shown = results.slice(0, SEARCH_LIMIT);
  searchList.innerHTML = shown.map(([, , , p]) => {
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
    b.classList.toggle('active', state.info?.kind === b.dataset.result && state.info.vnum === Number(b.dataset.vnum));
  }
}

searchList.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-result]');
  if (b) showInfo(b.dataset.result, Number(b.dataset.vnum));
});

function renderZoneList() {
  const q = zoneFilter.value.trim().toLowerCase();
  zoneList.innerHTML = state.index
    .filter((z) => !q || z.name.toLowerCase().includes(q) || String(z.id) === q)
    .map((z) => `<li><button data-zone="${z.id}" class="${z.id === state.zone?.id ? 'active' : ''}" title="Rooms #${z.bottom}–${z.top}">
        <span>${esc(z.name)}</span><span class="count">${z.roomCount}</span></button></li>`)
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
  await goTo(zone ?? (state.zonesById.has(DEFAULT_ZONE) ? DEFAULT_ZONE : state.index[0].id), room, mob);
  if (info) showInfo(info.kind, info.vnum);
}

function showError(err) {
  console.error(err);
  details.innerHTML = `<p class="muted">Error: ${esc(err.message)}</p>`;
}

init().catch(showError);
