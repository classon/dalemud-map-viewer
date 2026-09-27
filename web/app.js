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

const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
const COLORS = Object.fromEntries(
  ['twoway', 'oneway', 'warp', 'teleport', 'external', 'door', 'secret', 'accent', 'bg']
    .map((n) => [n, new THREE.Color(cssVar(n))]),
);

// ---------------------------------------------------------------- DOM refs
const $ = (sel) => document.querySelector(sel);
const viewport = $('#viewport');
const tooltip = $('#tooltip');
const zoneList = $('#zone-list');
const zoneFilter = $('#zone-filter');
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
  selected: null,
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

const selectionBox = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(CUBE * 1.35, CUBE * 1.35, CUBE * 1.35)),
  new THREE.LineBasicMaterial({ color: COLORS.accent }),
);
selectionBox.visible = false;
scene.add(selectionBox);

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

function tube(curve, color, radius = 0.05, segments = 1) {
  const geo = new THREE.TubeGeometry(curve, segments, radius, 6, false);
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
}

function arrowOn(curve, color, t = 0.62) {
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.14, 0.38, 10),
    new THREE.MeshBasicMaterial({ color }),
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
    if (obj.geometry && obj.geometry !== cubeGeometry) obj.geometry.dispose();
    if (obj.material && ![...sectorMaterials.values()].includes(obj.material)) obj.material.dispose();
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
      const color = COLORS[kind];
      const curve = aligned ? new THREE.LineCurve3(from, to) : warpCurve(from, to, exit.dir);
      const group = layers[kind];
      group.add(tube(curve, color, 0.05, aligned ? 1 : 24));
      if (!back) group.add(arrowOn(curve, color));
    }

    if (room.teleport) {
      const target = state.rooms.get(room.teleport.target);
      if (target) {
        const to = toWorld(target.pos);
        const mid = from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, from.distanceTo(to) * 0.4 + 1, 0));
        const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(curve.getPoints(40)),
          new THREE.LineDashedMaterial({ color: COLORS.teleport, dashSize: 0.3, gapSize: 0.2 }),
        );
        line.computeLineDistances();
        layers.teleport.add(line, arrowOn(curve, COLORS.teleport, 0.8));
      }
    }
  }

  // A faint floor grid under the lowest level for orientation.
  const box = new THREE.Box3().setFromObject(world);
  const size = box.getSize(new THREE.Vector3());
  const span = Math.ceil(Math.max(size.x, size.z) / SPACING + 4) * SPACING;
  const grid = new THREE.GridHelper(span, Math.round(span / SPACING), 0x39404c, 0x242933);
  const center = box.getCenter(new THREE.Vector3());
  grid.position.set(center.x, box.min.y - 0.4, center.z);
  world.add(grid);

  for (const layer of Object.values(layers)) world.add(layer);
  applyLayerVisibility();
  fitCamera(box);
}

function addDoor(room, exit) {
  const secret = exit.flags.includes('secret');
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.62, 0.08),
    new THREE.MeshBasicMaterial({ color: secret ? COLORS.secret : COLORS.door }),
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
  const color = exit.missing ? COLORS.secret : COLORS.external;
  layers.external.add(tube(new THREE.LineCurve3(from, to), color, 0.04));
  const ghost = new THREE.Mesh(
    new THREE.BoxGeometry(CUBE * 0.4, CUBE * 0.4, CUBE * 0.4),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75 }),
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
  const { vnum, external, zone, missing } = obj.userData;
  if (external) {
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
  const { vnum, external, zone, missing } = obj.userData;
  let text;
  if (!external) text = `${state.rooms.get(vnum).name}  #${vnum}`;
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

  details.innerHTML = `
    <h2>${esc(room.name)}</h2>
    <div class="meta">#${room.vnum} · ${esc(room.sector.replace('_', ' '))} · grid ${room.pos.join(', ')}</div>
    ${flagChips.length ? `<div class="chips">${flagChips.join('')}</div>` : ''}
    <h3>Description</h3>
    ${prose(room.desc)}
    <h3>Exits</h3>
    ${exitItems.length ? `<ul class="exits">${exitItems.join('')}</ul>` : '<p class="muted">None</p>'}
    ${incoming.length ? `<h3>One-way entrances</h3><ul class="exits">${incoming.join('')}</ul>` : ''}
    ${teleport}
    ${extras.length ? `<h3>Look at</h3>${extras.join('')}` : ''}
  `;
}

details.addEventListener('click', (e) => {
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
function selectRoom(vnum) {
  const room = state.rooms.get(vnum) ?? null;
  state.selected = room;
  const mesh = room && state.roomMeshes.get(vnum);
  selectionBox.visible = Boolean(mesh);
  if (mesh) selectionBox.position.copy(mesh.position);
  renderDetails(room);
  writeHash();
}

async function loadZone(id) {
  if (!state.zoneCache.has(id)) {
    const entry = state.zonesById.get(id);
    const res = await fetch(`data/${entry.file}`);
    if (!res.ok) throw new Error(`Failed to load ${entry.file}: ${res.status}`);
    state.zoneCache.set(id, await res.json());
  }
  return state.zoneCache.get(id);
}

async function goTo(zoneId, vnum) {
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
  const start = state.rooms.has(vnum) ? vnum : state.zone.rooms[0]?.vnum;
  selectRoom(start);
  const mesh = state.roomMeshes.get(start);
  if (mesh && vnum != null && state.rooms.has(vnum)) controls.target.copy(mesh.position);
}

function writeHash() {
  const hash = `#zone=${state.zone?.id ?? ''}${state.selected ? `&room=${state.selected.vnum}` : ''}`;
  if (location.hash !== hash) history.replaceState(null, '', hash);
}

function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  const zone = params.has('zone') ? Number(params.get('zone')) : null;
  const room = params.has('room') ? Number(params.get('room')) : null;
  return { zone, room };
}

// ---------------------------------------------------------------- zone list
function renderZoneList() {
  const q = zoneFilter.value.trim().toLowerCase();
  zoneList.innerHTML = state.index
    .filter((z) => !q || z.name.toLowerCase().includes(q) || String(z.id) === q)
    .map((z) => `<li><button data-zone="${z.id}" class="${z.id === state.zone?.id ? 'active' : ''}" title="Rooms #${z.bottom}–${z.top}">
        <span>${esc(z.name)}</span><span class="count">${z.roomCount}</span></button></li>`)
    .join('');
}
zoneFilter.addEventListener('input', renderZoneList);
zoneList.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-zone]');
  if (btn) goTo(Number(btn.dataset.zone), null);
});

// ---------------------------------------------------------------- boot
async function init() {
  const res = await fetch('data/zones.json');
  if (!res.ok) throw new Error('data/zones.json not found. Run tools/convert_world.py first.');
  state.index = await res.json();
  state.zonesById = new Map(state.index.map((z) => [z.id, z]));
  renderZoneList();
  const { zone, room } = readHash();
  await goTo(zone ?? (state.zonesById.has(DEFAULT_ZONE) ? DEFAULT_ZONE : state.index[0].id), room);
}

init().catch((err) => {
  console.error(err);
  details.innerHTML = `<p class="muted">Error: ${esc(err.message)}</p>`;
});
