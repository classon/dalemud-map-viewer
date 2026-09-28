// Papercraft room scenes, drawn as SVG from a small JSON spec.
//
// A spec names a backdrop, a floor, lighting, props and effects:
//   { sky: 'day' | 'dusk' | 'night' | null,     // null for interiors
//     back: 'town' | 'wall' | 'plains' | 'forest' | 'stone' | 'wood' | ...,
//     floor: 'cobbles' | 'dirt' | 'grass' | 'planks' | 'marble' | 'water' | ...,
//     light: 'bright' | 'warm' | 'dim' | 'dark',
//     props: ['statue', ['torch', 0.2], ['barrel', 0.8, 1.2], ...],   // [name, x 0..1, scale]
//     fx: ['clouds', 'smoke', 'fog', ...] }
//
// Every shape is a "cut" paper piece: a polygon whose edges are subdivided and
// nudged a little, seeded by the room number, so edges look hand-cut but a
// room always renders the same. Layers cast soft shadows on the ones behind,
// and a fine grain sits over the whole scene. Animations are CSS classes
// (sc-*) defined in style.css.

const W = 348;
const H = 348;
const HORIZON = 244;        // where the back wall or sky meets the floor
const WALL_BASE = 206;      // bottom edge for things hung on the back wall
const MID_BASE = 272;       // feet of things standing on the floor
const FRONT_BASE = 336;     // feet of things in the foreground

let sceneCount = 0;

// Small deterministic RNG (mulberry32).
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- paper shapes
function makeKit(rand) {
  const n = (v) => Math.round(v * 10) / 10;
  const jitter = (amt) => (rand() - 0.5) * 2 * amt;

  // A polygon with hand-cut edges.
  function cut(points, amt = 0.7) {
    const out = [];
    for (let i = 0; i < points.length; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      const len = Math.hypot(x2 - x1, y2 - y1);
      const steps = Math.max(1, Math.ceil(len / 9));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const j = s === 0 ? 0 : amt;
        out.push([n(x1 + (x2 - x1) * t + jitter(j)), n(y1 + (y2 - y1) * t + jitter(j))]);
      }
    }
    return `M${out.map((p) => p.join(',')).join('L')}Z`;
  }
  const rect = (x, y, w, h, amt) => cut([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], amt);
  function ellipse(cx, cy, rx, ry, amt = 0.5, from = 0, to = Math.PI * 2) {
    const steps = Math.max(10, Math.round((Math.max(rx, ry) * (to - from)) / 5));
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const a = from + ((to - from) * i) / steps;
      pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
    }
    if (to - from < Math.PI * 2 - 0.01) pts.push([cx, cy]);
    return cut(pts, amt);
  }
  const path = (d, fill, extra = '') => `<path d="${d}" fill="${fill}"${extra}/>`;
  const piece = (d, fill, extra = '') => path(d, fill, ` stroke="rgba(0,0,0,.08)" stroke-width=".6"${extra}`);
  return { cut, rect, ellipse, path, piece, jitter, rand };
}

// ---------------------------------------------------------------- palettes
const SKY = {
  day: { top: '#a9cfe3', band: '#c5e0ec', sun: '#f7e3a1' },
  dusk: { top: '#d99a86', band: '#efc39a', sun: '#f6d58c' },
  night: { top: '#28324d', band: '#3a4668', sun: '#e9e4cf' },
  ether: { top: '#3b2d5c', band: '#5b4a86', sun: '#c9b8f0' },     // the ethereal web's otherworld
  storm: { top: '#3e4552', band: '#58606e', sun: '#9aa0a8' },
};
const WALLS = {
  stone: ['#b7ae9f', '#a39a8a'], wood: ['#a67752', '#8f6443'], plaster: ['#e4d5b8', '#d2c09d'],
  marble: ['#ece7df', '#d9d2c6'], white: ['#f4f2ec', '#e3dfd6'], grimy: ['#8d8268', '#776d55'],
  dark: ['#4d4640', '#3c3631'], cave: ['#5b5750', '#48443e'],
  hive: ['#c99a3e', '#b3862f'], silk: ['#b9b6c4', '#a19db0'],
};
const FLOORS = {
  cobbles: ['#9b9388', '#b1a99d'], dirt: ['#b58f63', '#a07c53'], grass: ['#86a85e', '#739650'],
  planks: ['#8d6445', '#7a5539'], marble: ['#e6e0d6', '#d3ccbf'], flagstone: ['#948e85', '#a8a298'],
  straw: ['#c9ad6a', '#b89a58'], water: ['#5f9dc0', '#78b3d1'], rubbish: ['#8c7d5e', '#776a4f'],
  leaves: ['#5b5a3a', '#7a6a3c'], web: ['#3a3450', '#cfc9e6'], cloud: ['#e9e6f2', '#ffffff'], rock: ['#5f5a52', '#716b62'],
};

// ---------------------------------------------------------------- backdrops
function drawSky(k, sky) {
  const c = SKY[sky];
  let out = k.path(`M0,0H${W}V${HORIZON}H0Z`, c.top);
  out += k.piece(k.rect(-4, HORIZON - 70, W + 8, 74, 1.2), c.band);
  if (sky === 'ether') {
    for (let i = 0; i < 3; i++) {
      out += `<g class="sc-glow" style="animation-delay:${-i}s">${k.piece(k.rect(-10, 40 + i * 50, W + 20, 16, 2.2), ['#6f5aa6', '#4f8a9e', '#7a4f8e'][i], ' opacity=".45"')}</g>`;
    }
  } else if (sky === 'storm') {
    // no sun; the lightning effect lights it up
  } else if (sky === 'night') {
    out += `<g class="sc-glow">${k.piece(k.ellipse(282, 52, 17, 17), c.sun)}</g>`;
  } else {
    out += k.piece(k.ellipse(282, 56, 20, 20), c.sun);
  }
  return out;
}

function drawWall(k, back) {
  const [base, shade] = WALLS[back] ?? WALLS.stone;
  let out = k.path(`M0,0H${W}V${HORIZON + 4}H0Z`, base);
  if (back === 'stone' || back === 'grimy' || back === 'cave' || back === 'dark') {
    for (let row = 0; row * 26 < HORIZON; row++) {
      const off = (row % 2) * 30;
      for (let x = -60 + off; x < W; x += 60) {
        out += k.piece(k.rect(x + 2, row * 26 + 2, 56, 22, 1), k.rand() < 0.5 ? base : shade, ' opacity=".55"');
      }
    }
  } else if (back === 'wood') {
    for (let x = 0; x < W; x += 29) out += k.piece(k.rect(x + 1, -2, 27, HORIZON + 6, 0.8), k.rand() < 0.5 ? base : shade);
  } else if (back === 'marble' || back === 'white') {
    out += k.piece(k.rect(-4, 12, W + 8, 16, 0.6), shade);
    out += k.piece(k.rect(-4, HORIZON - 26, W + 8, 30, 0.6), shade);
  } else if (back === 'hive') {
    // Honeycomb cells, a few glowing with grubs.
    for (let row = 0; row * 26 < HORIZON + 20; row++) {
      for (let col = -1; col * 30 < W + 30; col++) {
        const cx = col * 30 + (row % 2) * 15, cy = row * 26;
        const hex = [0, 1, 2, 3, 4, 5].map((i) => [cx + Math.cos(Math.PI / 6 + (i * Math.PI) / 3) * 15, cy + Math.sin(Math.PI / 6 + (i * Math.PI) / 3) * 15]);
        out += k.piece(k.cut(hex, 0.4), k.rand() < 0.2 ? '#e8c46a' : shade);
      }
    }
  } else if (back === 'silk') {
    for (let x = -10; x < W; x += 18) out += k.path(`M${x},0 Q${x + 9 + k.jitter(6)},${HORIZON / 2} ${x + k.jitter(4)},${HORIZON + 4}`, 'none', ` stroke="${shade}" stroke-width="5" opacity=".6"`);
  } else if (back === 'plaster') {
    out += k.piece(k.rect(-4, HORIZON - 34, W + 8, 38, 0.8), '#a67752');
    for (let x = 20; x < W; x += 70) out += k.piece(k.rect(x, 0, 12, HORIZON - 30, 0.6), '#a67752');
  }
  return out;
}

// Distant scenery for outdoor backdrops.
// `sky` is the sky palette, used to haze distant scenery. 'none' draws no
// scenery, for props that bring their own (like the alley).
function drawOutdoorBack(k, back, sky) {
  let out = '';
  if (back === 'town') {
    // A far-off skyline: smaller houses than anything a prop draws, then a
    // wash of sky colour over them so they read as distant.
    let x = -10;
    while (x < W) {
      const w = 30 + k.rand() * 22, h = 70 + k.rand() * 50;
      const colors = ['#cdb89a', '#b9a07f', '#d9c7a8', '#a88f70', '#c4a98a'];
      out += house(k, x, HORIZON, w, h, colors[Math.floor(k.rand() * colors.length)]);
      x += w - 3;
    }
    out += `<rect x="0" y="0" width="${W}" height="${HORIZON}" fill="${SKY[sky]?.band ?? '#c5e0ec'}" opacity=".4"/>`;
  } else if (back === 'wall') {
    out += cityWall(k, HORIZON, 118);
  } else if (back === 'plains') {
    out += k.piece(k.cut([[-5, HORIZON], [-5, 196], [60, 186], [140, 198], [230, 182], [W + 5, 194], [W + 5, HORIZON]], 1.2), '#9cb26d');
    out += k.piece(k.cut([[-5, HORIZON], [-5, 214], [90, 206], [200, 218], [W + 5, 208], [W + 5, HORIZON]], 1.2), '#8aa45e');
  } else if (back === 'forest') {
    out += k.piece(k.cut([[-5, HORIZON], [-5, 180], [W + 5, 172], [W + 5, HORIZON]], 1.2), '#5f7f48');
    for (let x = -10; x < W + 20; x += 26) out += pine(k, x + k.jitter(6), HORIZON - 30 + k.jitter(8), 0.7 + k.rand() * 0.3, '#4c6b3a');
    for (let x = 4; x < W + 20; x += 34) out += pine(k, x + k.jitter(6), HORIZON - 6, 0.9 + k.rand() * 0.3, '#3f5c31');
  } else if (back === 'river') {
    out += k.piece(k.cut([[-5, HORIZON], [-5, 200], [120, 194], [W + 5, 204], [W + 5, HORIZON]], 1.2), '#90a868');
    for (let x = 10; x < W; x += 40) out += roundTree(k, x + k.jitter(8), HORIZON - 26, 0.6);
  }
  return out;
}

function drawFloor(k, floor) {
  const [a, b] = FLOORS[floor] ?? FLOORS.dirt;
  let out = k.piece(k.rect(-4, HORIZON, W + 8, H - HORIZON + 4, 1), a);
  if (floor === 'cobbles' || floor === 'flagstone') {
    for (let row = 0; row < 6; row++) {
      const y = HORIZON + 6 + row * (8 + row * 2.2);
      const size = 10 + row * 5;
      for (let x = -size + (row % 2) * size * 0.5; x < W + size; x += size + 3) {
        out += k.piece(k.ellipse(x, y, size / 2, 3 + row * 1.1, 0.4), b, ' opacity=".7"');
      }
    }
  } else if (floor === 'planks') {
    for (let i = -6; i <= 6; i++) {
      const top = W / 2 + i * 22, bottom = W / 2 + i * 62;
      out += `<path d="M${top},${HORIZON}L${bottom},${H + 4}" stroke="${b}" stroke-width="2.2"/>`;
    }
  } else if (floor === 'marble') {
    for (let row = 0; row < 5; row++) {
      const y0 = HORIZON + row * 22, y1 = y0 + 22;
      for (let i = -6; i <= 6; i++) {
        if ((i + row) % 2) continue;
        const x0 = W / 2 + i * (26 + row * 7), x1 = W / 2 + (i + 1) * (26 + row * 7);
        const x2 = W / 2 + (i + 1) * (26 + (row + 1) * 7), x3 = W / 2 + i * (26 + (row + 1) * 7);
        out += k.path(k.cut([[x0, y0], [x1, y0], [x2, y1], [x3, y1]], 0.3), b);
      }
    }
  } else if (floor === 'grass') {
    for (let i = 0; i < 26; i++) {
      const x = k.rand() * W, y = HORIZON + 8 + k.rand() * (H - HORIZON - 10);
      out += k.piece(k.cut([[x - 3, y], [x, y - 7 - k.rand() * 5], [x + 3, y]], 0.3), b);
    }
  } else if (floor === 'water') {
    out += k.piece(k.rect(-4, HORIZON, W + 8, 10, 0.8), '#8fa66a');
    for (let row = 0; row < 5; row++) {
      out += `<g class="sc-flow" style="animation-delay:${-row * 1.3}s">${k.piece(k.rect(-40, HORIZON + 22 + row * 18, W + 80, 5, 1.4), b, ' opacity=".8"')}</g>`;
    }
  } else if (floor === 'web') {
    // Silk strands converging on a vanishing point.
    for (let i = -8; i <= 8; i++) out += `<path d="M${W / 2 + i * 6},${HORIZON} L${W / 2 + i * 60},${H + 4}" stroke="${b}" stroke-width="1.2" opacity=".6"/>`;
    for (let r = 0; r < 5; r++) out += `<path d="M-4,${HORIZON + 8 + r * r * 5} Q${W / 2},${HORIZON + 16 + r * r * 5} ${W + 4},${HORIZON + 8 + r * r * 5}" fill="none" stroke="${b}" stroke-width="1" opacity=".5"/>`;
  } else if (floor === 'cloud') {
    for (let i = 0; i < 9; i++) out += k.piece(k.ellipse(i * 44 - 10, HORIZON + 10 + (i % 2) * 18, 40, 20, 1), b, ' opacity=".9"');
  } else if (floor === 'dirt' || floor === 'straw' || floor === 'rubbish' || floor === 'leaves' || floor === 'rock') {
    for (let i = 0; i < 14; i++) {
      const x = k.rand() * W, y = HORIZON + 10 + k.rand() * (H - HORIZON - 16);
      out += k.piece(k.ellipse(x, y, 4 + k.rand() * 6, 1.6 + k.rand() * 1.5, 0.3), b, ' opacity=".8"');
    }
  }
  return out;
}

// ---------------------------------------------------------------- reusable bits
function house(k, x, base, w, h, color) {
  let out = k.piece(k.rect(x, base - h, w, h, 0.9), color);
  out += k.piece(k.cut([[x - 6, base - h + 2], [x + w / 2, base - h - 26 - k.rand() * 12], [x + w + 6, base - h + 2]], 1), '#8a5a44');
  for (let wy = base - h + 16; wy < base - 36; wy += 30) {
    for (let wx = x + 8; wx < x + w - 14; wx += 20) out += k.piece(k.rect(wx, wy, 10, 13, 0.4), '#f1dc9a');
  }
  out += k.piece(k.rect(x + w / 2 - 7, base - 26, 14, 26, 0.5), '#6e4a33');
  return out;
}

function cityWall(k, base, h) {
  let out = k.piece(k.rect(-6, base - h, W + 12, h + 4, 1), '#a79f92');
  for (let x = -6; x < W; x += 30) out += k.piece(k.rect(x, base - h - 14, 18, 16, 0.6), '#a79f92');
  for (let row = 0; row < h / 20; row++) {
    for (let x = (row % 2) * 20 - 20; x < W; x += 40) {
      out += k.piece(k.rect(x, base - h + row * 20 + 4, 36, 16, 0.8), '#978f82', ' opacity=".5"');
    }
  }
  return out;
}

function pine(k, x, base, s, color) {
  const w = 26 * s, h = 64 * s;
  let out = k.piece(k.rect(x - 2.5 * s, base - 8 * s, 5 * s, 10 * s, 0.3), '#6b4a32');
  for (let i = 0; i < 3; i++) {
    const y = base - 6 * s - i * h * 0.26;
    out += k.piece(k.cut([[x - w / 2 + i * 3 * s, y], [x, y - h * 0.5], [x + w / 2 - i * 3 * s, y]], 0.6), color);
  }
  return out;
}

function roundTree(k, x, base, s) {
  let out = k.piece(k.rect(x - 3 * s, base - 22 * s, 6 * s, 24 * s, 0.4), '#6b4a32');
  out += k.piece(k.ellipse(x, base - 36 * s, 20 * s, 18 * s, 0.9), '#6f944f');
  out += k.piece(k.ellipse(x - 7 * s, base - 40 * s, 10 * s, 9 * s, 0.6), '#82a85c');
  return out;
}

const PAPER_PERSON_COLORS = ['#b5524a', '#4f7ca8', '#c89a3c', '#6d8f4e', '#8b5f9e', '#3f6f6a', '#b0753f'];
function person(k, x, base, s, color) {
  let out = k.piece(k.cut([[x - 7 * s, base], [x - 5 * s, base - 22 * s], [x + 5 * s, base - 22 * s], [x + 7 * s, base]], 0.4), color);
  out += k.piece(k.ellipse(x, base - 27 * s, 4.6 * s, 4.8 * s, 0.3), '#e6c3a0');
  return out;
}

function flame(k, x, y, s = 1) {
  return `<g class="sc-flicker" style="animation-delay:${-(k.rand() * 2).toFixed(2)}s">`
    + k.piece(k.cut([[x - 5 * s, y], [x - 3 * s, y - 8 * s], [x, y - 15 * s], [x + 3 * s, y - 8 * s], [x + 5 * s, y]], 0.3), '#f0a23a')
    + k.piece(k.cut([[x - 2.5 * s, y], [x, y - 8 * s], [x + 2.5 * s, y]], 0.2), '#fbe08a') + '</g>';
}

function shelfRow(k, x, y, w, items) {
  let out = k.piece(k.rect(x, y, w, 4, 0.4), '#6e4a33');
  let cx = x + 4;
  while (cx < x + w - 6) {
    const kind = items[Math.floor(k.rand() * items.length)];
    out += kind(cx, y);
    cx += 9 + k.rand() * 4;
  }
  return out;
}

// ---------------------------------------------------------------- props
// Each prop draws around a local origin: (0,0) is its bottom centre. `layer`
// decides where that origin sits: 'wall' (hung on the back wall), 'mid'
// (standing on the floor), 'front' (foreground) or 'full' (fills the scene).
const PROPS = {
  // Architecture that fills the backdrop.
  'temple-facade': { layer: 'full', draw: (k) => {
    let out = k.piece(k.rect(40, 70, 268, 150, 0.8), '#ece7df');
    out += k.piece(k.cut([[26, 74], [174, 18], [322, 74]], 1), '#dcd5c9');
    out += k.piece(k.cut([[80, 66], [174, 34], [268, 66]], 0.8), '#c9a45a', ' opacity=".55"');
    for (let x = 58; x <= 280; x += 37) out += k.piece(k.rect(x, 80, 16, 134, 0.5), '#f6f2ea');
    out += k.piece(k.rect(144, 132, 60, 82, 0.6), '#5d4331');
    for (let i = 0; i < 5; i++) out += k.piece(k.rect(20 + i * 8, 214 + i * 12, W - 40 - i * 16, 12, 0.6), i % 2 ? '#e4ded3' : '#d6cfc2');
    return out;
  } },
  columns: { layer: 'full', draw: (k) => {
    let out = '';
    for (const x of [18, 88, 244, 314]) {
      out += k.piece(k.rect(x - 12, 18, 24, HORIZON - 10, 0.5), '#f6f2ea');
      out += k.piece(k.rect(x - 16, 12, 32, 10, 0.4), '#dcd5c9');
      out += k.piece(k.rect(x - 16, HORIZON - 2, 32, 10, 0.4), '#dcd5c9');
    }
    return out;
  } },
  mural: { layer: 'wall', draw: (k) => {
    let out = k.piece(k.rect(-70, -120, 140, 96, 0.8), '#d8c39b');
    out += k.piece(k.rect(-64, -114, 128, 84, 0.6), '#c7ad7d');
    out += person(k, -38, -34, 1.1, '#8d5a44') + person(k, 36, -34, 1.1, '#4f6f8f');
    out += k.piece(k.cut([[-12, -34], [-8, -96], [8, -96], [12, -34]], 0.5), '#6f5a44');
    out += k.piece(k.ellipse(0, -102, 9, 9), '#e6c3a0');
    out += k.piece(k.ellipse(0, -100, 16, 16, 0.6), '#f1d27a', ' opacity=".6"');
    return out;
  } },
  gate: { layer: 'full', draw: (k) => {
    let out = cityWall(k, HORIZON, 112);
    for (const x of [70, 278]) {
      out += k.piece(k.rect(x - 32, 64, 64, HORIZON - 60, 0.8), '#b3ab9e');
      for (let i = 0; i < 4; i++) out += k.piece(k.rect(x - 34 + i * 19, 50, 12, 16, 0.5), '#b3ab9e');
      out += k.piece(k.rect(x - 6, 96, 12, 20, 0.4), '#3b3430');
      out += `<g class="sc-sway-top">${k.piece(k.cut([[x, 20], [x + 26, 28], [x, 36]], 0.4), '#b5524a')}</g>`;
      out += k.piece(k.rect(x - 1.5, 18, 3, 34, 0.2), '#5a4636');
    }
    out += k.piece(k.rect(100, 92, 148, 16, 0.6), '#9d9486');
    out += k.piece(k.cut([[118, HORIZON], [118, 136], [174, 112], [230, 136], [230, HORIZON]], 0.8), '#6e4a33');
    for (let x = 126; x < 226; x += 16) out += k.piece(k.rect(x, 128, 4, HORIZON - 128, 0.3), '#5b3d2a');
    out += k.piece(k.rect(120, 176, 108, 6, 0.3), '#4a4a4a');
    return out;
  } },
  'city-wall': { layer: 'full', draw: (k) => cityWall(k, HORIZON, 150) },
  tower: { layer: 'mid', draw: (k) => {
    let out = k.piece(k.rect(-30, -230, 60, 230, 0.8), '#aea597');
    for (let i = 0; i < 4; i++) out += k.piece(k.rect(-34 + i * 19, -246, 12, 18, 0.5), '#aea597');
    for (const y of [-190, -140, -90]) out += k.piece(k.rect(-5, y, 10, 18, 0.4), '#3b3430');
    return out;
  } },
  houses: { layer: 'full', draw: (k) => {
    let out = '';
    let x = -12;
    while (x < W) {
      const w = 60 + k.rand() * 30;
      out += house(k, x, HORIZON + 2, w, 120 + k.rand() * 60, ['#d0bb9b', '#bda383', '#c8ae8e', '#a98f71'][Math.floor(k.rand() * 4)]);
      x += w + 2;
    }
    return out;
  } },
  'shop-fronts': { layer: 'full', draw: (k) => {
    let out = '';
    const colors = ['#d0bb9b', '#c8ae8e', '#bda383'];
    const awnings = [['#b5524a', '#f1e6d2'], ['#4f7ca8', '#f1e6d2'], ['#6d8f4e', '#f1e6d2']];
    for (let i = 0; i < 3; i++) {
      const x = -8 + i * 120;
      out += house(k, x, HORIZON + 2, 116, 150, colors[i]);
      const [a, b] = awnings[i];
      for (let s = 0; s < 6; s++) {
        out += k.piece(k.cut([[x + 8 + s * 17, 150], [x + 25 + s * 17, 150], [x + 25 + s * 17, 170], [x + 8 + s * 17, 170]], 0.4), s % 2 ? b : a);
      }
    }
    return out;
  } },
  alley: { layer: 'full', draw: (k) => {
    // A dark recessed backdrop behind the far buildings reads as narrow side
    // passages in the gaps, and keeps anything behind the alley from showing.
    let out = k.piece(k.rect(84, 96, 180, HORIZON - 94, 0.6), '#4f453b');
    out += house(k, -20, HORIZON + 2, 110, 210, '#8f7a64');
    out += house(k, 258, HORIZON + 2, 110, 200, '#7f6b58');
    out += house(k, 96, HORIZON - 14, 70, 120, '#a08a70');
    out += house(k, 170, HORIZON - 10, 86, 136, '#98826a');
    out += `<g class="sc-sway-top">${k.piece(k.cut([[96, 60], [258, 64], [258, 66], [96, 62]], 0.2), '#6b5a48')}`;
    for (let x = 110; x < 250; x += 22) out += k.piece(k.rect(x, 62, 12, 16, 0.4), ['#c9b27f', '#b5524a', '#e8e0cc', '#6f8fae'][Math.floor(k.rand() * 4)]);
    out += '</g>';
    return out;
  } },
  stairs: { layer: 'mid', draw: (k) => {
    let out = '';
    for (let i = 0; i < 7; i++) out += k.piece(k.rect(-40 + i * 12, -12 - i * 18, 56, 18, 0.5), i % 2 ? '#8d6445' : '#7a5539');
    out += k.piece(k.cut([[-44, 0], [44, -130], [48, -126], [-38, 0]], 0.4), '#5b3d2a');
    return out;
  } },
  bridge: { layer: 'full', draw: (k) => {
    // A stone span across the scene: parapet, deck, three arches and piers
    // standing in the water.
    let out = k.piece(k.cut([[-6, 170], [W + 6, 170], [W + 6, 268], [-6, 268]], 0.9), '#a39b8e');
    for (const [cx, rx] of [[58, 44], [174, 58], [290, 44]]) {
      out += k.piece(k.ellipse(cx, 268, rx, 66 - (58 - rx) * 0.4, 0.8, Math.PI, Math.PI * 2), '#4f7f9c');
    }
    for (let row = 0; row < 2; row++) {
      for (let x = (row % 2) * 18 - 18; x < W; x += 36) out += k.piece(k.rect(x, 176 + row * 13, 32, 10, 0.5), '#948c80', ' opacity=".6"');
    }
    out += k.piece(k.rect(-6, 160, W + 12, 12, 0.6), '#b3ab9e');
    for (let x = -4; x < W; x += 22) out += k.piece(k.rect(x, 146, 12, 16, 0.4), '#b3ab9e');
    return out;
  } },
  levee: { layer: 'full', draw: (k) => k.piece(k.cut([[-6, HORIZON + 30], [W + 6, HORIZON + 22], [W + 6, HORIZON + 40], [-6, HORIZON + 46]], 1), '#9a8a66') },
  stalls: { layer: 'mid', draw: (k) => {
    let out = '';
    for (const [x, c] of [[-100, '#b5524a'], [100, '#4f7ca8']]) {
      out += k.piece(k.rect(x - 34, -40, 68, 40, 0.6), '#a67752');
      out += k.piece(k.rect(x - 32, -86, 4, 48, 0.3), '#6e4a33') + k.piece(k.rect(x + 28, -86, 4, 48, 0.3), '#6e4a33');
      for (let s = 0; s < 5; s++) out += k.piece(k.cut([[x - 40 + s * 16, -100], [x - 24 + s * 16, -100], [x - 24 + s * 16, -84], [x - 40 + s * 16, -84]], 0.3), s % 2 ? '#f1e6d2' : c);
      for (let i = 0; i < 5; i++) out += k.piece(k.ellipse(x - 24 + i * 12, -44, 5, 4, 0.3), ['#d8b04a', '#b5524a', '#86a85e', '#e28a3c'][i % 4]);
    }
    return out;
  } },

  // Hung on the back wall.
  torch: { layer: 'wall', draw: (k) => k.piece(k.cut([[-3, -40], [3, -40], [2, -20], [-2, -20]], 0.3), '#5b3d2a')
    + k.piece(k.rect(-5, -44, 10, 5, 0.3), '#4a4a4a') + flame(k, 0, -44, 1.1) },
  window: { layer: 'wall', draw: (k) => {
    let out = k.piece(k.rect(-28, -96, 56, 70, 0.6), '#6e4a33');
    out += k.piece(k.rect(-23, -91, 46, 60, 0.5), '#a9cfe3');
    out += k.piece(k.rect(-2, -91, 4, 60, 0.3), '#6e4a33') + k.piece(k.rect(-23, -63, 46, 4, 0.3), '#6e4a33');
    return out;
  } },
  painting: { layer: 'wall', draw: (k) => {
    let out = k.piece(k.rect(-34, -110, 68, 80, 0.6), '#c9a45a');
    out += k.piece(k.rect(-28, -104, 56, 68, 0.5), '#e8b86a');
    out += k.piece(k.ellipse(0, -70, 16, 16, 0.4), '#f7e3a1');
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      out += k.piece(k.cut([[Math.cos(a) * 18, -70 + Math.sin(a) * 18], [Math.cos(a + 0.12) * 28, -70 + Math.sin(a + 0.12) * 28], [Math.cos(a - 0.12) * 28, -70 + Math.sin(a - 0.12) * 28]], 0.2), '#f3cf6a');
    }
    return out;
  } },
  sign: { layer: 'wall', draw: (k) => `<g class="sc-sway-top">${k.piece(k.rect(-1, -86, 2, 12, 0.1), '#5b3d2a')}${k.piece(k.rect(-22, -76, 44, 26, 0.6), '#c9a46a')}`
    + [0, 1, 2].map((i) => k.piece(k.rect(-15, -70 + i * 7, 22 + k.rand() * 8, 2.4, 0.2), '#6e4a33')).join('') + '</g>' },
  'bar-shelf': { layer: 'wall', draw: (k) => {
    let out = k.piece(k.rect(-80, -120, 160, 96, 0.8), '#7a5539');
    const bottle = (x, y) => k.piece(k.cut([[x - 3, y], [x - 3, y - 12], [x - 1.2, y - 16], [x - 1.2, y - 20], [x + 1.2, y - 20], [x + 1.2, y - 16], [x + 3, y - 12], [x + 3, y]], 0.2), ['#5e8f5a', '#8a3b36', '#c9a45a', '#5d7da3', '#d8d0bc'][Math.floor(k.rand() * 5)]);
    for (const y of [-92, -62, -32]) out += shelfRow(k, -76, y, 152, [bottle]);
    return out;
  } },
  shelves: { layer: 'wall', draw: (k, opts) => {
    let out = k.piece(k.rect(-90, -150, 180, 132, 0.8), '#7a5539');
    const goods = {
      bread: [(x, y) => k.piece(k.ellipse(x + 2, y - 5, 6, 5, 0.3), '#d6a25b'), (x, y) => k.piece(k.ellipse(x + 3, y - 4, 7, 4, 0.3), '#c48a45')],
      goods: [(x, y) => k.piece(k.rect(x - 3, y - 11, 9, 11, 0.3), '#c9a46a'), (x, y) => k.piece(k.ellipse(x + 1, y - 6, 5, 6, 0.3), '#8a6a4a'), (x, y) => k.piece(k.rect(x - 3, y - 7, 10, 7, 0.3), '#6f8fae')],
      potions: [(x, y) => k.piece(k.ellipse(x + 1, y - 5, 4.5, 5, 0.3), ['#8b5f9e', '#4f9ea8', '#b5524a', '#6d8f4e'][Math.floor(k.rand() * 4)]) + k.piece(k.rect(x - 0.5, y - 14, 3, 5, 0.2), '#d8d0bc')],
      scrolls: [(x, y) => k.piece(k.rect(x - 3, y - 13, 7, 13, 0.3), '#efe3c4'), (x, y) => k.piece(k.ellipse(x, y - 5, 4, 5, 0.3), '#e3d3ac')],
    }[opts?.goods ?? 'goods'];
    for (const y of [-116, -82, -48, -22]) out += shelfRow(k, -86, y, 172, goods);
    return out;
  } },
  'weapon-rack': { layer: 'wall', draw: (k) => {
    let out = k.piece(k.rect(-90, -120, 180, 10, 0.6), '#6e4a33');
    for (let i = 0; i < 7; i++) {
      const x = -78 + i * 26;
      if (i % 3 === 1) {
        out += k.piece(k.rect(x - 1.5, -118, 3, 90, 0.2), '#6e4a33') + k.piece(k.cut([[x - 10, -118], [x, -126], [x + 10, -118], [x + 10, -104], [x, -110], [x - 10, -104]], 0.3), '#b8bec6');
      } else {
        out += k.piece(k.cut([[x - 3, -108], [x + 3, -108], [x + 2, -34], [x, -28], [x - 2, -34]], 0.3), '#c9ced6') + k.piece(k.rect(x - 9, -112, 18, 4, 0.2), '#8a6a4a');
      }
    }
    return out;
  } },
  'armor-rack': { layer: 'wall', draw: (k) => {
    let out = '';
    out += k.piece(k.cut([[-70, -120], [-56, -126], [-42, -120], [-42, -100], [-70, -100]], 0.4), '#a9b0b8');
    out += k.piece(k.cut([[-24, -128], [24, -128], [30, -40], [-30, -40]], 0.6), '#8d949c');
    for (let y = -120; y < -44; y += 8) out += k.piece(k.rect(-24, y, 48, 3, 0.3), '#a9b0b8', ' opacity=".7"');
    out += k.piece(k.ellipse(62, -84, 24, 28, 0.6), '#b5524a') + k.piece(k.ellipse(62, -84, 10, 12, 0.4), '#d8b04a');
    return out;
  } },
  trophies: { layer: 'wall', draw: (k) => {
    let out = '';
    for (const [x, c] of [[-80, '#8a6a4a'], [0, '#6e6e6e'], [80, '#4f6b3a']]) {
      out += k.piece(k.ellipse(x, -96, 18, 20, 0.5), '#6e4a33');
      out += k.piece(k.ellipse(x, -96, 12, 13, 0.4), c);
      out += k.piece(k.cut([[x - 10, -106], [x - 22, -128], [x - 6, -110]], 0.3), '#e8e0cc') + k.piece(k.cut([[x + 10, -106], [x + 22, -128], [x + 6, -110]], 0.3), '#e8e0cc');
    }
    return out;
  } },
  icons: { layer: 'wall', draw: (k) => {
    let out = '';
    for (const x of [-80, 0, 80]) {
      out += k.piece(k.rect(x - 16, -120, 32, 44, 0.5), '#c9a45a');
      out += k.piece(k.rect(x - 3, -114, 6, 32, 0.3), '#f4f2ec') + k.piece(k.rect(x - 11, -104, 22, 6, 0.3), '#f4f2ec');
    }
    return out;
  } },
  'rules-board': { layer: 'wall', draw: (k) => {
    let out = k.piece(k.rect(-70, -150, 140, 124, 0.6), '#6e4a33');
    out += k.piece(k.rect(-60, -140, 120, 104, 0.6), '#efe3c4');
    for (let y = -130; y < -44; y += 9) out += k.piece(k.rect(-50, y, 60 + k.rand() * 40, 2.6, 0.2), '#8a6a4a');
    return out;
  } },
  blackboard: { layer: 'wall', draw: (k) => {
    let out = k.piece(k.rect(-60, -120, 120, 80, 0.6), '#6e4a33') + k.piece(k.rect(-54, -114, 108, 68, 0.5), '#2f3a33');
    for (let i = 0; i < 5; i++) out += k.piece(k.rect(-46 + k.rand() * 20, -104 + i * 12, 30 + k.rand() * 40, 2, 0.3), '#d8dcd6', ' opacity=".6"');
    return out;
  } },
  fireplace: { layer: 'wall', draw: (k) => {
    let out = k.piece(k.rect(-56, -110, 112, 110, 0.8), '#9b9388');
    out += k.piece(k.rect(-64, -116, 128, 12, 0.6), '#7a5539');
    out += k.piece(k.cut([[-34, 0], [-34, -60], [0, -76], [34, -60], [34, 0]], 0.6), '#2f2a26');
    out += k.piece(k.rect(-22, -8, 44, 8, 0.4), '#6e4a33');
    out += flame(k, -10, -8, 1.6) + flame(k, 6, -8, 2) + flame(k, 18, -8, 1.3);
    return out;
  } },
  cages: { layer: 'wall', draw: (k) => {
    let out = '';
    for (const [x, y, c] of [[-64, -118, '#d8b04a'], [0, -118, '#b5524a'], [64, -118, '#86a85e'], [-32, -58, '#8a6a4a'], [32, -58, '#6f8fae']]) {
      out += k.piece(k.rect(x - 24, y, 48, 46, 0.5), '#caa66a', ' opacity=".35"');
      out += `<g class="sc-bob" style="animation-delay:${-(k.rand() * 3).toFixed(2)}s">${k.piece(k.ellipse(x, y + 30, 10, 8, 0.4), c)}${k.piece(k.ellipse(x + 7, y + 22, 5, 5, 0.3), c)}</g>`;
      for (let b = -20; b <= 20; b += 8) out += k.piece(k.rect(x + b, y, 2, 46, 0.2), '#8a6a4a');
      out += k.piece(k.rect(x - 26, y - 3, 52, 5, 0.3), '#6e4a33') + k.piece(k.rect(x - 26, y + 44, 52, 5, 0.3), '#6e4a33');
    }
    return out;
  } },
  pipes: { layer: 'wall', draw: (k) => {
    let out = k.piece(k.ellipse(0, -30, 44, 34, 0.8), '#6f6a62');
    out += k.piece(k.ellipse(0, -28, 32, 24, 0.6), '#2f2a26');
    for (const [x, y, w] of [[-90, -80, 60], [40, -100, 70], [-110, -50, 40]]) out += k.piece(k.rect(x, y, w, 14, 0.5), '#8b8479');
    return out;
  } },

  // Standing on the floor.
  altar: { layer: 'mid', draw: (k) => k.piece(k.rect(-56, -50, 112, 50, 0.6), '#f4f2ec') + k.piece(k.rect(-64, -58, 128, 10, 0.5), '#e3dfd6')
    + k.piece(k.rect(-40, -40, 80, 30, 0.5), '#c9a45a', ' opacity=".4"') + flame(k, -48, -58, 0.9) + flame(k, 48, -58, 0.9) },
  'statue-seated': { layer: 'mid', draw: (k) => {
    let out = k.piece(k.rect(-46, -34, 92, 34, 0.6), '#d9d4cb');
    out += k.piece(k.cut([[-40, -34], [-36, -110], [36, -110], [40, -34]], 0.8), '#e8e4dc');
    out += k.piece(k.cut([[-26, -60], [-22, -150], [22, -150], [26, -60]], 0.8), '#f1eee8');
    out += k.piece(k.ellipse(0, -164, 15, 17, 0.5), '#f1eee8');
    out += k.piece(k.cut([[-15, -170], [0, -196], [15, -170]], 0.5), '#e8e4dc');
    out += k.piece(k.rect(30, -190, 5, 150, 0.3), '#dcd6cc');
    return out;
  } },
  statue: { layer: 'mid', draw: (k) => {
    let out = k.piece(k.rect(-26, -40, 52, 40, 0.6), '#9d9588');
    out += k.piece(k.cut([[-14, -40], [-10, -104], [10, -104], [14, -40]], 0.8), '#7f8b7a');
    out += k.piece(k.ellipse(0, -116, 11, 13, 0.5), '#7f8b7a');
    out += k.piece(k.cut([[10, -96], [34, -130], [38, -126], [16, -90]], 0.5), '#7f8b7a');
    out += k.piece(k.cut([[-10, -96], [-30, -80], [-26, -76], [-10, -86]], 0.5), '#7f8b7a');
    return out;
  } },
  well: { layer: 'mid', draw: (k) => {
    let out = k.piece(k.rect(-5, -96, 4, 96, 0.3), '#6e4a33') + k.piece(k.rect(37, -96, 4, 96, 0.3), '#6e4a33');
    out += k.piece(k.cut([[-12, -94], [18, -114], [48, -94]], 0.5), '#8a5a44');
    out += k.piece(k.rect(-8, -40, 52, 40, 0.6), '#9b9388');
    for (let i = 0; i < 4; i++) out += k.piece(k.rect(-6 + i * 13, -34, 11, 10, 0.3), '#b1a99d');
    out += `<g class="sc-sway-top">${k.piece(k.rect(17, -92, 1.5, 36, 0.1), '#5b3d2a')}${k.piece(k.rect(11, -58, 14, 12, 0.3), '#8a6a4a')}</g>`;
    return out;
  } },
  counter: { layer: 'mid', draw: (k) => k.piece(k.rect(-110, -52, 220, 52, 0.8), '#8d6445') + k.piece(k.rect(-116, -58, 232, 10, 0.6), '#6e4a33')
    + k.piece(k.rect(-100, -40, 60, 30, 0.5), '#7a5539', ' opacity=".6"') + k.piece(k.rect(40, -40, 60, 30, 0.5), '#7a5539', ' opacity=".6"') },
  'bar-counter': { layer: 'mid', draw: (k) => {
    let out = k.piece(k.rect(-130, -50, 260, 50, 0.8), '#7a5539') + k.piece(k.rect(-136, -58, 272, 10, 0.6), '#5b3d2a');
    for (const x of [-90, -40, 30, 86]) out += k.piece(k.cut([[x - 5, -58], [x - 6, -72], [x + 6, -72], [x + 5, -58]], 0.3), '#d8b04a', ' opacity=".9"') + k.piece(k.rect(x - 6, -76, 12, 5, 0.3), '#f4f2ec');
    return out;
  } },
  'table-set': { layer: 'mid', draw: (k) => {
    let out = '';
    for (const x of [-26, 26]) out += k.piece(k.rect(x - 10, -40, 20, 40, 0.4), '#6e4a33') + k.piece(k.rect(x + (x < 0 ? -12 : 8), -62, 4, 24, 0.3), '#6e4a33');
    out += k.piece(k.rect(-40, -46, 80, 8, 0.5), '#8d6445') + k.piece(k.rect(-4, -40, 8, 40, 0.3), '#6e4a33');
    out += k.piece(k.cut([[-12, -46], [-11, -56], [-5, -56], [-4, -46]], 0.2), '#d8b04a');
    out += k.piece(k.ellipse(12, -49, 6, 3, 0.2), '#c9a46a');
    return out;
  } },
  broken: { layer: 'mid', draw: (k) => {
    let out = '';
    for (let i = 0; i < 9; i++) {
      const x = -90 + k.rand() * 180, y = -4 - k.rand() * 8, a = k.rand() * 60 - 30, len = 20 + k.rand() * 26;
      out += `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${a.toFixed(0)})">${k.piece(k.rect(-len / 2, -3, len, 6, 0.4), k.rand() < 0.5 ? '#8d6445' : '#6e4a33')}</g>`;
    }
    out += `<g transform="rotate(-18)">${k.piece(k.rect(-20, -34, 40, 8, 0.4), '#8d6445')}</g>`;
    return out;
  } },
  'lab-table': { layer: 'mid', draw: (k) => {
    let out = k.piece(k.rect(-100, -48, 200, 10, 0.6), '#6e4a33') + k.piece(k.rect(-94, -40, 8, 40, 0.3), '#5b3d2a') + k.piece(k.rect(86, -40, 8, 40, 0.3), '#5b3d2a');
    for (const [x, c] of [[-70, '#6d8f4e'], [-30, '#8b5f9e'], [20, '#4f9ea8'], [64, '#b5524a']]) {
      out += k.piece(k.ellipse(x, -60, 10, 11, 0.4), c, ' opacity=".9"') + k.piece(k.rect(x - 2.5, -82, 5, 14, 0.2), '#d8d0bc');
      out += `<g class="sc-rise" style="animation-delay:${-(k.rand() * 4).toFixed(2)}s">${k.piece(k.ellipse(x, -90, 4, 4, 0.3), c, ' opacity=".6"')}</g>`;
    }
    out += k.piece(k.rect(-10, -90, 4, 44, 0.2), '#9d9588') + k.piece(k.rect(-10, -92, 60, 4, 0.2), '#9d9588');
    return out;
  } },
  pentagram: { layer: 'front', draw: (k) => {
    const pts = [];
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
      pts.push(`${(Math.cos(a) * 60).toFixed(1)},${(Math.sin(a) * 16 - 22).toFixed(1)}`);
    }
    return `<g class="sc-glow"><ellipse cx="0" cy="-22" rx="64" ry="18" fill="none" stroke="#b58ad8" stroke-width="2"/><polygon points="${pts.join(' ')}" fill="none" stroke="#b58ad8" stroke-width="2"/></g>`;
  } },
  orbs: { layer: 'mid', draw: (k) => {
    let out = '';
    for (let i = 0; i < 6; i++) {
      const x = -120 + i * 48 + k.jitter(10), y = -110 - k.rand() * 70;
      out += `<g class="sc-float" style="animation-delay:${-(k.rand() * 5).toFixed(2)}s">${k.piece(k.ellipse(x, y, 12, 12, 0.3), ['#b58ad8', '#7fc4d8', '#f0c75e'][i % 3], ' opacity=".75"')}${k.piece(k.ellipse(x - 3, y - 3, 4, 4, 0.2), '#fff', ' opacity=".7"')}</g>`;
    }
    return out;
  } },
  desk: { layer: 'mid', draw: (k) => {
    let out = k.piece(k.rect(-70, -46, 140, 46, 0.6), '#6e4a33') + k.piece(k.rect(-76, -52, 152, 10, 0.5), '#5b3d2a');
    for (let i = 0; i < 5; i++) out += k.piece(k.rect(-60 + i * 22 + k.jitter(3), -64 - k.rand() * 8, 18, 12, 0.4), '#efe3c4');
    out += k.piece(k.cut([[40, -52], [48, -80], [50, -80], [44, -52]], 0.2), '#f4f2ec');
    out += flame(k, -52, -70, 0.7);
    return out;
  } },
  coach: { layer: 'mid', draw: (k) => {
    let out = k.piece(k.rect(-80, -104, 150, 70, 0.8), '#8a3b36');
    out += k.piece(k.rect(-88, -112, 166, 12, 0.6), '#5b3d2a');
    out += k.piece(k.rect(-62, -92, 36, 30, 0.4), '#f1dc9a') + k.piece(k.rect(-14, -92, 36, 30, 0.4), '#f1dc9a');
    out += person(k, -44, -64, 0.8, '#4f7ca8') + person(k, 4, -64, 0.8, '#6d8f4e');
    for (const x of [-56, 44]) out += k.piece(k.ellipse(x, -22, 22, 22, 0.6), '#5b3d2a') + k.piece(k.ellipse(x, -22, 6, 6, 0.3), '#c9a45a');
    out += k.piece(k.cut([[70, -60], [120, -52], [120, -48], [70, -54]], 0.3), '#5b3d2a');
    out += k.piece(k.cut([[100, 0], [104, -60], [140, -64], [148, -40], [138, 0]], 0.8), '#8a6a4a');
    return out;
  } },
  crates: { layer: 'mid', draw: (k) => {
    let out = '';
    for (const [x, y, s] of [[-20, 0, 1], [16, 0, 0.9], [-4, -36, 0.8]]) {
      const w = 36 * s;
      out += k.piece(k.rect(x - w / 2, y - w, w, w, 0.5), '#b08b5c');
      out += k.piece(k.cut([[x - w / 2 + 3, y - 3], [x + w / 2 - 6, y - w + 3], [x + w / 2 - 3, y - w + 6], [x - w / 2 + 6, y - 3]], 0.3), '#8a6a4a');
    }
    return out;
  } },
  barrels: { layer: 'mid', draw: (k) => {
    let out = '';
    for (const x of [-18, 18]) {
      out += k.piece(k.cut([[x - 14, 0], [x - 17, -20], [x - 14, -40], [x + 14, -40], [x + 17, -20], [x + 14, 0]], 0.5), '#8d6445');
      out += k.piece(k.rect(x - 16, -30, 32, 4, 0.3), '#4a4a4a') + k.piece(k.rect(x - 16, -12, 32, 4, 0.3), '#4a4a4a');
    }
    return out;
  } },
  anchor: { layer: 'mid', draw: (k) => k.piece(k.rect(-4, -90, 8, 80, 0.3), '#5f656b') + k.piece(k.ellipse(0, -96, 10, 10, 0.3), '#5f656b')
    + k.piece(k.ellipse(0, -96, 5, 5, 0.2), '#d3ccbf') + k.piece(k.rect(-22, -76, 44, 6, 0.3), '#5f656b')
    + k.piece(k.ellipse(0, -18, 34, 18, 0.5, 0, Math.PI), '#5f656b') },
  'ship-wheel': { layer: 'wall', draw: (k) => {
    let out = '';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      out += `<line x1="0" y1="-80" x2="${(Math.cos(a) * 40).toFixed(1)}" y2="${(-80 + Math.sin(a) * 40).toFixed(1)}" stroke="#6e4a33" stroke-width="5" stroke-linecap="round"/>`;
    }
    out += `<circle cx="0" cy="-80" r="28" fill="none" stroke="#8d6445" stroke-width="7"/>` + k.piece(k.ellipse(0, -80, 8, 8, 0.3), '#5b3d2a');
    return out;
  } },
  dummy: { layer: 'mid', draw: (k) => {
    let out = k.piece(k.rect(-3, -100, 6, 100, 0.3), '#6e4a33');
    out += `<g class="sc-sway">${k.piece(k.cut([[-18, -40], [-14, -84], [14, -84], [18, -40]], 0.6), '#c9ad6a')}${k.piece(k.rect(-30, -78, 60, 8, 0.4), '#c9ad6a')}${k.piece(k.ellipse(0, -96, 12, 12, 0.4), '#d8c08a')}</g>`;
    return out;
  } },
  target: { layer: 'mid', draw: (k) => {
    let out = k.piece(k.rect(-4, -40, 8, 40, 0.3), '#6e4a33');
    for (const [r, c] of [[26, '#f4f2ec'], [20, '#b5524a'], [13, '#f4f2ec'], [6, '#b5524a']]) out += k.piece(k.ellipse(0, -62, r, r, 0.4), c);
    out += k.piece(k.cut([[4, -64], [34, -84], [35, -82], [5, -62]], 0.2), '#5b3d2a');
    return out;
  } },
  logs: { layer: 'front', draw: (k) => {
    let out = '';
    for (const x of [-90, 70]) out += k.piece(k.rect(x - 40, -18, 80, 18, 0.6), '#7a5539') + k.piece(k.ellipse(x + 40, -9, 6, 9, 0.3), '#c9a46a');
    return out;
  } },
  garbage: { layer: 'mid', draw: (k) => {
    let out = k.piece(k.cut([[-120, 0], [-90, -40], [-40, -56], [20, -44], [70, -60], [120, -30], [130, 0]], 1.4), '#7a6e55');
    for (let i = 0; i < 12; i++) {
      const x = -100 + k.rand() * 210, y = -10 - k.rand() * 36;
      out += k.piece(k.rect(x, y, 8 + k.rand() * 12, 5 + k.rand() * 8, 0.6), ['#8d6445', '#a9a18f', '#6f8f6a', '#b58f63', '#5f656b'][Math.floor(k.rand() * 5)]);
    }
    return out;
  } },
  lamp: { layer: 'mid', draw: (k) => k.piece(k.rect(-2.5, -120, 5, 120, 0.3), '#3b3430') + k.piece(k.rect(-9, -134, 18, 16, 0.4), '#3b3430')
    + `<g class="sc-glow">${k.piece(k.rect(-6, -131, 12, 11, 0.3), '#f6d58c')}</g>` },
  crowd: { layer: 'front', draw: (k) => {
    let out = '';
    for (let i = 0; i < 5; i++) {
      const x = -140 + i * 70 + k.jitter(12);
      out += `<g class="sc-bob" style="animation-delay:${-(k.rand() * 3).toFixed(2)}s">${person(k, x, 0, 1.3 + k.rand() * 0.3, PAPER_PERSON_COLORS[Math.floor(k.rand() * PAPER_PERSON_COLORS.length)])}</g>`;
    }
    return out;
  } },
  person: { layer: 'mid', draw: (k) => person(k, 0, 0, 1.6, PAPER_PERSON_COLORS[Math.floor(k.rand() * PAPER_PERSON_COLORS.length)]) },
  trees: { layer: 'mid', draw: (k) => {
    let out = '';
    for (let i = 0; i < 5; i++) out += pine(k, -150 + i * 75 + k.jitter(14), 4, 1.6 + k.rand() * 0.6, i % 2 ? '#4c6b3a' : '#3f5c31');
    return `<g class="sc-sway">${out}</g>`;
  } },
  'dark-trees': { layer: 'mid', draw: (k) => {
    let out = '';
    for (let i = 0; i < 6; i++) out += pine(k, -160 + i * 64 + k.jitter(10), 4, 1.8 + k.rand() * 0.8, i % 2 ? '#2f4230' : '#253626');
    return out;
  } },
  bushes: { layer: 'front', draw: (k) => {
    let out = '';
    for (const x of [-140, -60, 90, 150]) out += k.piece(k.ellipse(x, -14, 30 + k.rand() * 10, 20, 0.8), '#6f944f') + k.piece(k.ellipse(x - 10, -20, 14, 10, 0.5), '#82a85c');
    return out;
  } },
  stump: { layer: 'mid', draw: (k) => k.piece(k.rect(-16, -26, 32, 26, 0.5), '#7a5539') + k.piece(k.ellipse(0, -26, 16, 5, 0.3), '#c9a46a') },
  road: { layer: 'front', draw: (k) => k.piece(k.cut([[-60, 16], [-6, -92], [6, -92], [60, 16]], 1), '#c4a57a', ' opacity=".9"') },
  river: { layer: 'front', draw: (k) => {
    let out = k.piece(k.rect(-180, -70, 360, 70, 1), '#5f9dc0');
    for (let row = 0; row < 3; row++) out += `<g class="sc-flow" style="animation-delay:${-row * 1.7}s">${k.piece(k.rect(-220, -58 + row * 20, 420, 4, 1), '#8cc0db', ' opacity=".8"')}</g>`;
    return out;
  } },
  fountain: { layer: 'mid', draw: (k) => {
    let out = k.piece(k.ellipse(0, -10, 62, 14, 0.8), '#9d9588') + k.piece(k.ellipse(0, -14, 52, 9, 0.6), '#78b3d1');
    out += k.piece(k.rect(-6, -56, 12, 44, 0.3), '#9d9588') + k.piece(k.ellipse(0, -56, 22, 6, 0.4), '#9d9588');
    out += `<g class="sc-flicker">${k.piece(k.cut([[-3, -58], [0, -80], [3, -58]], 0.3), '#a9d6ea')}</g>`;
    return out;
  } },
  candles: { layer: 'mid', draw: (k) => {
    let out = '';
    for (const x of [-120, -100, 100, 120]) out += k.piece(k.rect(x - 3, -30 - (x % 3) * 4, 6, 30, 0.2), '#f4f2ec') + flame(k, x, -30 - (x % 3) * 4, 0.7);
    return out;
  } },
};

// ---------------------------------------------------------------- spider realm (Arachnos)
function orbWeb(k, cx, cy, r, colors) {
  // Spokes, then a spiral of short strands between them.
  let out = '';
  const spokes = 14;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2 + k.jitter(0.05);
    out += `<line x1="${cx}" y1="${cy}" x2="${(cx + Math.cos(a) * r).toFixed(1)}" y2="${(cy + Math.sin(a) * r).toFixed(1)}" stroke="${colors[i % colors.length]}" stroke-width="1.3"/>`;
  }
  let pts = '';
  for (let t = 0; t < spokes * 7; t++) {
    const a = (t / spokes) * Math.PI * 2, rr = 8 + (t / (spokes * 7)) * (r - 8);
    pts += `${t ? 'L' : 'M'}${(cx + Math.cos(a) * rr).toFixed(1)},${(cy + Math.sin(a) * rr).toFixed(1)}`;
  }
  out += `<path d="${pts}" fill="none" stroke="${colors[0]}" stroke-width=".9" opacity=".85"/>`;
  return out;
}
const RAINBOW = ['#ff6b6b', '#ffb347', '#ffe66d', '#7bd389', '#5fb6e8', '#8a7bd8', '#e07bd0'];
const SILK = ['#e8e6f0'];

function spider(k, x, y, s, body = '#2f2a2e', mark = '#b5524a') {
  // Eight legs, each bending up to a high knee and down to a foot, fanned
  // from the front pair (reaching forward and up) to the back pair.
  let out = '';
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const hipX = x + side * 5 * s, hipY = y - 2 * s + i * 2 * s;
      const kneeX = x + side * (18 + i * 5) * s, kneeY = y - (22 - i * 4) * s;
      const footX = x + side * (26 + i * 9) * s, footY = y + (14 + i * 2) * s;
      out += `<path d="M${hipX.toFixed(1)},${hipY.toFixed(1)} L${kneeX.toFixed(1)},${kneeY.toFixed(1)} L${footX.toFixed(1)},${footY.toFixed(1)}" fill="none" stroke="${body}" stroke-width="${(2.2 * s).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
  }
  out += k.piece(k.ellipse(x, y + 6 * s, 14 * s, 12 * s, 0.4), body);
  out += k.piece(k.ellipse(x, y - 6 * s, 8 * s, 7 * s, 0.3), body);
  out += k.piece(k.cut([[x - 4 * s, y + 2 * s], [x, y + 10 * s], [x + 4 * s, y + 2 * s], [x, y - 1 * s]], 0.2), mark);
  out += `<circle cx="${x - 2.5 * s}" cy="${y - 8 * s}" r="${1.2 * s}" fill="#f0c75e"/><circle cx="${x + 2.5 * s}" cy="${y - 8 * s}" r="${1.2 * s}" fill="#f0c75e"/>`;
  return out;
}

Object.assign(PROPS, {
  web: { layer: 'full', draw: (k, opts) => `<g class="sc-glow">${orbWeb(k, opts?.x ?? 174, opts?.y ?? 118, opts?.r ?? 112, opts?.rainbow ? RAINBOW : SILK)}</g>` },
  cobwebs: { layer: 'full', draw: (k) => {
    let out = '';
    for (const [cx, dir] of [[0, 1], [W, -1]]) {
      for (let i = 0; i <= 5; i++) {
        const a = (i / 5) * (Math.PI / 2);
        out += `<line x1="${cx}" y1="0" x2="${(cx + dir * Math.cos(a) * 90).toFixed(1)}" y2="${(Math.sin(a) * 90).toFixed(1)}" stroke="#e8e6f0" stroke-width="1" opacity=".75"/>`;
      }
      for (const r of [25, 45, 65, 85]) out += `<path d="M${cx + dir * r},0 Q${cx + dir * r * 0.62},${r * 0.62} ${cx},${r}" fill="none" stroke="#e8e6f0" stroke-width=".9" opacity=".7"/>`;
    }
    return out;
  } },
  canopy: { layer: 'full', draw: (k) => {
    // Deep woods behind, dark trunks framing the scene under a heavy leaf
    // canopy, strung with webs.
    let out = k.path(`M0,0H${W}V${HORIZON + 4}H0Z`, '#2a3a2a');
    for (let i = 0; i < 12; i++) {
      const x = k.rand() * W, w = 6 + k.rand() * 10;
      out += k.piece(k.rect(x, 20, w, HORIZON - 16, 0.6), '#34463a', ' opacity=".8"');
    }
    out += k.piece(k.rect(-4, HORIZON - 40, W + 8, 44, 1.5), '#304531', ' opacity=".7"');
    for (const [x, w] of [[-20, 70], [300, 64], [110, 26], [220, 22]]) {
      out += k.piece(k.cut([[x, HORIZON + 4], [x + w * 0.2, 0], [x + w * 0.8, 0], [x + w, HORIZON + 4]], 1), w > 40 ? '#3d3226' : '#4a3d2e');
    }
    for (let i = 0; i < 9; i++) out += k.piece(k.ellipse(i * 44 - 10 + k.jitter(8), 8 + k.jitter(10), 42, 30, 1.2), i % 2 ? '#2f4a2c' : '#3b5a33');
    out += `<g opacity=".6">${orbWeb(k, 78, 120, 40, SILK)}${orbWeb(k, 262, 90, 34, SILK)}</g>`;
    return out;
  } },
  branch: { layer: 'front', draw: (k, opts) => {
    // A thick limb underfoot, rising from the lower left and tapering off to
    // the right, with a knot and a smaller branch.
    let out = k.piece(k.cut([[-200, 14], [-200, -96], [-60, -104], [60, -118], [200, -150], [200, -118], [60, -80], [-60, -46], [-200, -34]], 1.6), '#5b4331');
    out += k.piece(k.cut([[-200, -92], [-60, -100], [60, -114], [200, -146], [200, -138], [60, -104], [-60, -88], [-200, -80]], 0.8), '#7a5f47');
    out += k.piece(k.cut([[20, -104], [70, -170], [80, -166], [36, -98]], 0.8), '#5b4331');
    out += k.piece(k.ellipse(-40, -72, 10, 7, 0.4), '#3d2e22');
    for (let i = 0; i < 10; i++) out += `<path d="M${(-190 + i * 38).toFixed(0)},${(-60 - i * 5).toFixed(0)} l18,-4" stroke="#4a3727" stroke-width="1.4"/>`;
    if (opts?.fuzz) {
      for (let i = 0; i < 90; i++) {
        const t = k.rand();
        const cx = -190 + t * 380, cy = -94 - t * 50 + k.rand() * 26;
        out += `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="1.6" fill="#9cc46a"/>`;
      }
    }
    return out;
  } },
  strand: { layer: 'front', draw: (k, opts) => `<g class="sc-glow"><path d="M-200,${opts?.dy ?? -20} Q0,${(opts?.dy ?? -20) + 30} 200,${opts?.dy ?? -20}" fill="none" stroke="${opts?.color ?? '#e8e6f0'}" stroke-width="4" stroke-linecap="round"/></g>` },
  ravine: { layer: 'full', draw: (k) => k.piece(k.cut([[-6, HORIZON + 4], [-6, 150], [70, 164], [110, 210], [120, HORIZON + 4]], 1.2), '#6f6456')
    + k.piece(k.cut([[W + 6, HORIZON + 4], [W + 6, 146], [270, 160], [236, 214], [226, HORIZON + 4]], 1.2), '#665b4e')
    + k.piece(k.rect(120, 214, 106, 34, 1), '#231f26') },
  spider: { layer: 'mid', draw: (k, opts) => `<g class="sc-bob">${spider(k, 0, -40, 2.2, opts?.body, opts?.mark)}</g>` },
  'hanging-spider': { layer: 'wall', draw: (k) => `<g class="sc-float"><line x1="0" y1="-210" x2="0" y2="-70" stroke="#e8e6f0" stroke-width="1"/>${spider(k, 0, -60, 0.9)}</g>` },
  spiders: { layer: 'front', draw: (k) => {
    let out = '';
    for (let i = 0; i < 7; i++) {
      const x = -150 + i * 50 + k.jitter(12), y = -10 - k.rand() * 30;
      const carry = k.rand() < 0.5 ? k.piece(k.ellipse(x + 2, y - 14, 9, 5, 0.3), '#c9b8a0') : '';
      out += `<g class="sc-bob" style="animation-delay:${-(k.rand() * 2).toFixed(2)}s">${spider(k, x, y, 0.8)}${carry}</g>`;
    }
    return out;
  } },
  ballooning: { layer: 'wall', draw: (k) => {
    let out = '';
    for (let i = 0; i < 9; i++) {
      const x = -160 + k.rand() * 320, y = -190 + k.rand() * 140;
      out += `<g class="sc-float" style="animation-delay:${-(k.rand() * 5).toFixed(2)}s"><line x1="${x.toFixed(0)}" y1="${(y - 26).toFixed(0)}" x2="${x.toFixed(0)}" y2="${y.toFixed(0)}" stroke="#e8e6f0" stroke-width=".8"/>${spider(k, x, y, 0.28)}</g>`;
    }
    return out;
  } },
  cocoons: { layer: 'wall', draw: (k) => {
    let out = '';
    for (const x of [-120, -40, 50, 130]) {
      const len = 30 + k.rand() * 20;
      out += `<g class="sc-sway-top" style="animation-delay:${-(k.rand() * 3).toFixed(2)}s"><line x1="${x}" y1="-200" x2="${x}" y2="${(-150 + k.rand() * 20).toFixed(0)}" stroke="#e8e6f0" stroke-width="1"/>${k.piece(k.ellipse(x, -130, 10, len / 2, 0.8), '#dcd8e4')}`
        + [0, 1, 2].map((i) => `<path d="M${x - 10},${-140 + i * 9} q10,5 20,0" fill="none" stroke="#b9b6c4" stroke-width="1"/>`).join('') + '</g>';
    }
    return out;
  } },
  bones: { layer: 'front', draw: (k) => {
    let out = '';
    for (let i = 0; i < 7; i++) {
      const x = -140 + k.rand() * 280, y = -4 - k.rand() * 10, a = k.rand() * 180;
      out += `<g transform="translate(${x.toFixed(0)},${y.toFixed(0)}) rotate(${a.toFixed(0)})">${k.piece(k.rect(-12, -2, 24, 4, 0.3), '#e8e0cc')}${k.piece(k.ellipse(-12, 0, 3.5, 3.5, 0.2), '#e8e0cc')}${k.piece(k.ellipse(12, 0, 3.5, 3.5, 0.2), '#e8e0cc')}</g>`;
    }
    out += k.piece(k.ellipse(40, -12, 11, 10, 0.4), '#e8e0cc') + `<circle cx="36" cy="-13" r="2.4" fill="#2f2a26"/><circle cx="44" cy="-13" r="2.4" fill="#2f2a26"/>`;
    return out;
  } },
  minecart: { layer: 'mid', draw: (k) => {
    let out = '';
    for (const y of [0, -6]) out += k.piece(k.rect(-170, y - 2, 340, 3, 0.4), '#6e6e6e');
    for (let x = -160; x < 170; x += 22) out += k.piece(k.rect(x, -8, 6, 10, 0.3), '#5b3d2a');
    out += k.piece(k.cut([[-50, -14], [-56, -54], [56, -54], [50, -14]], 0.6), '#6b5e55');
    for (let i = 0; i < 8; i++) out += k.piece(k.ellipse(-40 + i * 11, -56 - (i % 2) * 4, 7, 6, 0.3), i % 3 ? '#d8b04a' : '#c9ced6');
    for (const x of [-32, 32]) out += k.piece(k.ellipse(x, -12, 9, 9, 0.3), '#3b3430');
    return out;
  } },
  ghosts: { layer: 'mid', draw: (k) => {
    let out = '';
    for (let i = 0; i < 4; i++) {
      const x = -120 + i * 80 + k.jitter(14), y = -30 - k.rand() * 40;
      out += `<g class="sc-float" style="animation-delay:${-(k.rand() * 5).toFixed(2)}s" opacity=".55">${k.piece(k.cut([[x - 16, y], [x - 14, y - 44], [x, y - 58], [x + 14, y - 44], [x + 16, y], [x + 8, y - 8], [x, y], [x - 8, y - 8]], 1), '#dfe8f2')}<circle cx="${x - 5}" cy="${y - 40}" r="2.6" fill="#2f3440"/><circle cx="${x + 5}" cy="${y - 40}" r="2.6" fill="#2f3440"/></g>`;
    }
    return out;
  } },
  chair: { layer: 'mid', draw: (k) => k.piece(k.rect(-26, -110, 8, 110, 0.4), '#3b3430') + k.piece(k.rect(18, -110, 8, 110, 0.4), '#3b3430')
    + k.piece(k.rect(-30, -50, 60, 10, 0.4), '#4d4640') + k.piece(k.rect(-26, -110, 52, 40, 0.5), '#4d4640') + k.piece(k.rect(-26, -40, 8, 40, 0.3), '#3b3430') },
  shack: { layer: 'mid', draw: (k) => {
    let out = k.piece(k.cut([[-70, 0], [-66, -80], [66, -86], [70, 0]], 1.2), '#6b5a48');
    out += k.piece(k.cut([[-86, -76], [0, -126], [86, -82]], 1.2), '#4a3d2e');
    for (let x = -60; x < 64; x += 14) out += `<line x1="${x}" y1="-80" x2="${x + k.jitter(2)}" y2="0" stroke="#5b4a3a" stroke-width="1.2"/>`;
    out += `<g class="sc-glow">${k.piece(k.rect(18, -60, 24, 20, 0.4), '#f6d58c')}</g>` + k.piece(k.rect(-40, -52, 26, 52, 0.4), '#3b3430');
    return out;
  } },
  dragon: { layer: 'mid', draw: (k, opts) => {
    const c = opts?.color ?? '#8a3b36', d = opts?.dark ?? '#6a2b28';
    let out = k.piece(k.cut([[-10, -90], [-120, -190], [-90, -110], [-150, -140], [-60, -70]], 1), d);   // wing
    out += k.piece(k.cut([[-110, 0], [-120, -30], [-60, -80], [40, -90], [90, -60], [100, 0]], 1.2), c);  // body
    out += k.piece(k.cut([[60, -80], [100, -150], [120, -160], [150, -150], [130, -130], [110, -128], [90, -70]], 0.8), c); // neck and head
    out += k.piece(k.cut([[120, -160], [128, -182], [132, -158]], 0.3), '#e8e0cc');
    out += `<circle cx="136" cy="-148" r="3" fill="#f0c75e" class="sc-glow"/>`;
    out += k.piece(k.cut([[-110, -10], [-200, 10], [-190, 20], [-100, 4]], 0.8), c);
    for (let i = 0; i < 6; i++) out += k.piece(k.cut([[-60 + i * 22, -84 + i], [-50 + i * 22, -100 + i], [-40 + i * 22, -86 + i]], 0.3), d);
    return out;
  } },
  wormkin: { layer: 'mid', draw: (k) => `<g class="sc-bob">${k.piece(k.cut([[-60, 0], [-50, -20], [-10, -24], [20, -40], [40, -48], [52, -40], [40, -30], [20, -10], [30, 0]], 0.8), '#5f8f5a')}${k.piece(k.cut([[-10, -24], [0, -40], [8, -24]], 0.4), '#4a7046')}<circle cx="46" cy="-44" r="2" fill="#f0c75e"/></g>` },
  hoard: { layer: 'front', draw: (k) => {
    let out = k.piece(k.cut([[-160, 4], [-120, -34], [-40, -52], [40, -44], [120, -30], [160, 4]], 1.4), '#d8b04a');
    for (let i = 0; i < 28; i++) out += k.piece(k.ellipse(-140 + k.rand() * 280, -4 - k.rand() * 36, 5, 3, 0.2), k.rand() < 0.2 ? ['#b5524a', '#4f9ea8', '#8b5f9e', '#6d8f4e'][i % 4] : '#f0c75e');
    out += k.piece(k.rect(60, -60, 50, 34, 0.5), '#6e4a33') + k.piece(k.rect(58, -66, 54, 10, 0.4), '#8d6445') + k.piece(k.rect(82, -58, 6, 8, 0.2), '#d8b04a');
    return out;
  } },
  tomes: { layer: 'mid', draw: (k) => {
    let out = '';
    for (const [x, n] of [[-90, 5], [-50, 3], [70, 4]]) {
      for (let i = 0; i < n; i++) out += k.piece(k.rect(x - 16 + k.jitter(3), -12 - i * 10, 32, 9, 0.3), ['#8a3b36', '#4f6f8f', '#6d5a3a', '#3f6f6a'][(i + n) % 4]);
    }
    out += `<g transform="translate(10,-6) rotate(-14)">${k.piece(k.cut([[-18, 0], [-14, -26], [14, -26], [18, 0]], 0.4), '#8d949c')}</g>`;
    out += `<g transform="translate(120,-4) rotate(30)">${k.piece(k.cut([[-3, 0], [3, 0], [2, -46], [0, -52], [-2, -46]], 0.2), '#c9ced6')}</g>`;
    return out;
  } },
  kirin: { layer: 'mid', draw: (k) => {
    let out = `<g class="sc-glow">${k.piece(k.ellipse(0, -60, 90, 70, 1.5), '#f6e6a8', ' opacity=".25"')}</g>`;
    out += k.piece(k.cut([[-60, -40], [-50, -76], [30, -80], [50, -50], [40, -36]], 0.8), '#f1eee8');
    for (const x of [-50, -30, 20, 36]) out += k.piece(k.rect(x - 3, -44, 6, 44, 0.3), '#e3dfd6');
    out += k.piece(k.cut([[30, -78], [60, -120], [78, -116], [72, -96], [48, -70]], 0.6), '#f1eee8');
    out += k.piece(k.cut([[66, -118], [80, -152], [74, -114]], 0.3), '#d8b04a');
    out += k.piece(k.cut([[20, -80], [44, -114], [36, -80]], 0.5), '#d8b04a');
    out += k.piece(k.cut([[-60, -64], [-84, -50], [-78, -44], [-58, -54]], 0.5), '#d8b04a');
    out += `<g opacity=".7">${[-100, -60, 60, 100].map((x) => `<line x1="${x}" y1="-170" x2="${x / 3}" y2="-60" stroke="#e8e6f0" stroke-width="1.4"/>`).join('')}</g>`;
    return out;
  } },
  'web-door': { layer: 'full', draw: (k) => {
    let out = k.piece(k.cut([[64, HORIZON + 4], [64, 90], [174, 24], [284, 90], [284, HORIZON + 4]], 1), '#4a4460');
    out += `<g opacity=".9">${orbWeb(k, 174, 140, 100, ['#d9d2f0'])}</g>`;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      out += `<text x="${(174 + Math.cos(a) * 70).toFixed(0)}" y="${(144 + Math.sin(a) * 70).toFixed(0)}" font-size="12" fill="#f0c75e" text-anchor="middle" class="sc-glow" style="animation-delay:${-i * 0.4}s">${'ᚠᚢᚦᚨᚱᚲᚷᚹ'[i]}</text>`;
    }
    return out;
  } },
  wasps: { layer: 'wall', draw: (k) => {
    let out = '';
    for (let i = 0; i < 6; i++) {
      const x = -150 + k.rand() * 300, y = -180 + k.rand() * 120;
      out += `<g class="sc-buzz" style="animation-delay:${-(k.rand() * 2).toFixed(2)}s">${k.piece(k.ellipse(x, y, 8, 4, 0.2), '#e8c46a')}${k.piece(k.rect(x - 2, y - 4, 3, 8, 0.1), '#2f2a26')}${k.piece(k.ellipse(x - 2, y - 6, 5, 3, 0.2), '#e8f0f8', ' opacity=".7"')}</g>`;
    }
    return out;
  } },
  grubs: { layer: 'front', draw: (k) => {
    let out = '';
    for (let i = 0; i < 8; i++) out += `<g class="sc-bob" style="animation-delay:${-(k.rand() * 3).toFixed(2)}s">${k.piece(k.ellipse(-150 + i * 42 + k.jitter(8), -8, 14, 7, 0.4), '#efe3c4')}</g>`;
    return out;
  } },
  thief: { layer: 'mid', draw: (k) => person(k, 0, 0, 2.4, '#3b3430') + k.piece(k.cut([[18, -44], [52, -60], [54, -56], [20, -40]], 0.2), '#c9ced6') },
});

// ---------------------------------------------------------------- effects
const FX = {
  clouds: (k) => {
    let out = '';
    for (let i = 0; i < 3; i++) {
      const x = 30 + i * 110 + k.jitter(20), y = 30 + k.rand() * 50;
      out += `<g class="sc-drift" style="animation-delay:${-(k.rand() * 30).toFixed(1)}s">${k.piece(k.ellipse(x, y, 30, 10, 0.8), '#f4f1ea')}${k.piece(k.ellipse(x + 12, y - 6, 16, 10, 0.6), '#f4f1ea')}</g>`;
    }
    return out;
  },
  stars: (k) => {
    let out = '';
    for (let i = 0; i < 24; i++) {
      out += `<circle class="sc-twinkle" style="animation-delay:${-(k.rand() * 4).toFixed(2)}s" cx="${(k.rand() * W).toFixed(0)}" cy="${(k.rand() * 150).toFixed(0)}" r="${(0.8 + k.rand() * 1.2).toFixed(1)}" fill="#f4f1ea"/>`;
    }
    return out;
  },
  birds: (k) => {
    let out = '';
    for (let i = 0; i < 3; i++) {
      const x = 40 + i * 30, y = 70 + i * 10;
      out += `<g class="sc-fly" style="animation-delay:${-(i * 2.5).toFixed(1)}s"><path d="M${x - 7},${y} q4,-5 7,0 q3,-5 7,0" fill="none" stroke="#3b3430" stroke-width="1.6"/></g>`;
    }
    return out;
  },
  smoke: (k) => {
    let out = '';
    for (let i = 0; i < 4; i++) out += `<g class="sc-rise" style="animation-delay:${-(i * 1.5).toFixed(1)}s">${k.piece(k.ellipse(60 + i * 70, 180, 16, 12, 0.8), '#7d776f', ' opacity=".35"')}</g>`;
    return out;
  },
  fog: (k) => {
    let out = '';
    for (let i = 0; i < 3; i++) out += `<g class="sc-drift" style="animation-delay:${-(i * 9).toFixed(1)}s">${k.piece(k.rect(-60, 250 + i * 22, W + 120, 16, 3), '#e8e6e0', ' opacity=".35"')}</g>`;
    return out;
  },
  magic: (k) => {
    let out = '';
    for (let i = 0; i < 14; i++) {
      out += `<circle class="sc-twinkle" style="animation-delay:${-(k.rand() * 3).toFixed(2)}s" cx="${(20 + k.rand() * (W - 40)).toFixed(0)}" cy="${(40 + k.rand() * 220).toFixed(0)}" r="${(1.2 + k.rand() * 1.6).toFixed(1)}" fill="${['#e6c8ff', '#b8f0ff', '#fff2b0'][i % 3]}"/>`;
    }
    return out;
  },
  dust: (k) => {
    let out = '';
    for (let i = 0; i < 10; i++) out += `<circle class="sc-float" style="animation-delay:${-(k.rand() * 5).toFixed(2)}s" cx="${(k.rand() * W).toFixed(0)}" cy="${(60 + k.rand() * 200).toFixed(0)}" r="1.2" fill="#fff4d6" opacity=".7"/>`;
    return out;
  },
  flies: (k) => {
    let out = '';
    for (let i = 0; i < 6; i++) out += `<g class="sc-buzz" style="animation-delay:${-(k.rand() * 2).toFixed(2)}s"><circle cx="${(90 + k.rand() * 170).toFixed(0)}" cy="${(200 + k.rand() * 40).toFixed(0)}" r="1.4" fill="#2f2a26"/></g>`;
    return out;
  },
  lightning: (k) => `<g class="sc-flash">${k.path(k.cut([[210, 0], [190, 60], [206, 62], [180, 130], [228, 50], [210, 48], [230, 0]], 0.5), '#fff7c2')}</g>`
    + '<g class="sc-flash"><rect width="348" height="348" fill="#ffffff" opacity=".2"/></g>', // the group fades; the sky flash stays faint
  shimmer: (k) => {
    let out = '';
    for (let i = 0; i < 20; i++) {
      out += `<circle class="sc-twinkle" style="animation-delay:${-(k.rand() * 3).toFixed(2)}s" cx="${(k.rand() * W).toFixed(0)}" cy="${(k.rand() * 260).toFixed(0)}" r="${(1 + k.rand() * 1.8).toFixed(1)}" fill="${['#c9b8f0', '#9fe0ea', '#f5c6ef'][i % 3]}"/>`;
    }
    return out;
  },
  sunbeam: (k) => `<g class="sc-glow">${k.path(k.cut([[150, -10], [200, -10], [260, HORIZON], [110, HORIZON]], 1), '#fff4c8', ' opacity=".25"')}</g>`,
};

const LIGHT = {
  bright: '',
  warm: '<rect width="348" height="348" fill="#ffae4a" opacity=".12"/>',
  dim: '<rect width="348" height="348" fill="#1d1c33" opacity=".28"/>',
  dark: '<rect width="348" height="348" fill="#0e0d1a" opacity=".5"/>',
  holy: '<rect width="348" height="348" fill="#fff0c0" opacity=".14"/>',
};

const LAYER_BASE = { wall: WALL_BASE, mid: MID_BASE, front: FRONT_BASE };

// Render a spec to an SVG string. `seed` (the room vnum) fixes the jitter.
export function renderScene(spec, seed) {
  const k = makeKit(rng(seed * 2654435761));
  const id = `sc${++sceneCount}`;
  const shadow = (depth) => `filter="url(#${id}-s${depth})"`;
  const layers = { full: [], wall: [], mid: [], front: [] };

  const props = (spec.props ?? []).map((p) => (Array.isArray(p) ? p : [p]));
  // Props without a position spread across the scene, per layer.
  const autoCount = {};
  for (const [name, x] of props) {
    const layer = PROPS[name]?.layer;
    if (layer && x == null) autoCount[layer] = (autoCount[layer] ?? 0) + 1;
  }
  const autoIndex = {};
  for (const [name, x, scale = 1, opts] of props) {
    const prop = PROPS[name];
    if (!prop) continue;
    if (prop.layer === 'full') {
      layers.full.push(prop.draw(k, opts));
      continue;
    }
    let px = x;
    if (px == null) {
      const i = (autoIndex[prop.layer] = (autoIndex[prop.layer] ?? 0) + 1);
      px = i / (autoCount[prop.layer] + 1);
    }
    const tx = (px * W).toFixed(1);
    const ty = LAYER_BASE[prop.layer];
    layers[prop.layer].push(`<g transform="translate(${tx},${ty}) scale(${scale})">${prop.draw(k, opts)}</g>`);
  }

  const back = spec.sky
    ? drawSky(k, spec.sky) + (spec.fx?.includes('stars') ? FX.stars(k) : '') + (spec.fx?.includes('clouds') ? FX.clouds(k) : '')
      + (spec.fx?.includes('birds') ? FX.birds(k) : '') + drawOutdoorBack(k, spec.back, spec.sky)
    : drawWall(k, spec.back ?? 'stone');
  const fx = (spec.fx ?? []).filter((f) => !['stars', 'clouds', 'birds'].includes(f) && FX[f]).map((f) => FX[f](k)).join('');

  return `<svg class="scene" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img">
  <defs>
    ${[1, 2, 3].map((d) => `<filter id="${id}-s${d}" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="${d * 0.6}" dy="${d * 1.2}" stdDeviation="${d * 0.9}" flood-color="#1a1208" flood-opacity="${0.22 + d * 0.06}"/></filter>`).join('')}
    <filter id="${id}-grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="${seed % 97}" stitchTiles="stitch"/>
      <feColorMatrix values="0 0 0 0 .45  0 0 0 0 .38  0 0 0 0 .3  0 0 0 .55 0"/>
    </filter>
    <clipPath id="${id}-clip"><rect width="${W}" height="${H}" rx="10"/></clipPath>
  </defs>
  <g clip-path="url(#${id}-clip)">
    <g>${back}</g>
    <g ${shadow(1)}>${drawFloor(k, spec.floor ?? 'dirt')}</g>
    <g ${shadow(2)}>${layers.full.join('')}</g>
    <g ${shadow(1)}>${layers.wall.join('')}</g>
    <g ${shadow(2)}>${layers.mid.join('')}</g>
    <g ${shadow(3)}>${layers.front.join('')}</g>
    <g>${fx}</g>
    ${LIGHT[spec.light ?? 'bright'] ?? ''}
    <rect width="${W}" height="${H}" filter="url(#${id}-grain)" opacity=".35" style="mix-blend-mode:multiply"/>
  </g>
</svg>`;
}

export const SCENE_PROPS = Object.keys(PROPS);
export const SCENE_FX = Object.keys(FX);
