import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { buildKnife } from '../characters/knife';
import { buildBody, stoneTexture, type JointPose } from '../characters/common';
import { buildMitt, buildPlate } from './plate';
import { Physics } from '../engine/physics';
import { mat, basic } from '../engine/psx';
import { canvasTexture, tex } from '../engine/textures';
import type { IngredientKind } from './ingredients';
import { box, counter, COUNTER_TOP, type Bin, type HotelSet, type Kitchen, type OvenRig, type StationId, type Waypoints } from './kitchen';

// Episode 2: "The Last Resort". The cursed hotel restaurant kitchen above the basement.
//
// Room: x in [-6, 6], z in [-4, 5] (same footprint as the basement), ceiling 3.4 m.
//   North wall (z = -4): the hot line. Fridge | counter | stove (pan, pot, fryer) | counter | OVEN | toaster counter.
//   Centre: the marble prep island (board + seasoning), also Gorgon gaze cover.
//   West wall: pantry crates, the rickety linen shelf further south.
//   South wall: rival counter (west half), dumbwaiter + room-service trolley, the pass with a hatch
//   that looks into the dining room of petrified guests (east half).
//   East wall: swinging double doors (Gorgon's entrance), a tall window, the sheet-tray rack.
// The dining room (z 5.2 .. 13) is visible through the hatch but walled off by a collider.

const H = 3.4;
const DH = 4.6; // dining room ceiling

// ---------------------------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------------------------

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const texCache = new Map<string, THREE.CanvasTexture>();
function cached(key: string, make: () => THREE.CanvasTexture): THREE.CanvasTexture {
  let t = texCache.get(key);
  if (!t) {
    t = make();
    texCache.set(key, t);
  }
  return t;
}

/** A repeat-adjusted copy of a shared texture (shares the image). */
function rep(t: THREE.Texture, rx: number, ry: number): THREE.Texture {
  const c = t.clone();
  c.repeat.set(rx, ry);
  c.needsUpdate = true;
  return c;
}

const htex = {
  /** Cream and black marble tiles laid on the diagonal. One repeat = 0.9 m. */
  floor: () =>
    cached('h-floor', () =>
      canvasTexture(64, 64, (g, w, h) => {
        const r = rng(7);
        g.fillStyle = '#ddd3bd';
        g.fillRect(0, 0, w, h);
        // faint veins in the cream marble
        g.strokeStyle = 'rgba(150,135,110,0.35)';
        g.lineWidth = 0.35;
        for (let i = 0; i < 14; i++) {
          let x = r() * w;
          let y = r() * h;
          g.beginPath();
          g.moveTo(x, y);
          for (let k = 0; k < 6; k++) {
            x += (r() - 0.3) * 8;
            y += (r() - 0.5) * 8;
            g.lineTo(x, y);
          }
          g.stroke();
        }
        // black diamonds at even lattice points (half diagonal 16)
        const hd = 16;
        for (let i = 0; i <= 4; i += 2)
          for (let j = 0; j <= 4; j += 2) {
            const cx = i * hd;
            const cy = j * hd;
            g.fillStyle = '#1d1b1c';
            g.beginPath();
            g.moveTo(cx, cy - hd);
            g.lineTo(cx + hd, cy);
            g.lineTo(cx, cy + hd);
            g.lineTo(cx - hd, cy);
            g.closePath();
            g.fill();
          }
        // grout
        g.strokeStyle = 'rgba(90,80,64,0.55)';
        g.lineWidth = 0.5;
        for (let k = -64; k <= 128; k += hd) {
          g.beginPath();
          g.moveTo(k, 0);
          g.lineTo(k + 64, 64);
          g.moveTo(k, 64);
          g.lineTo(k + 64, 0);
          g.stroke();
        }
        // grime and old stains
        for (let i = 0; i < 90; i++) {
          g.fillStyle = `rgba(70,50,30,${0.08 + r() * 0.15})`;
          g.beginPath();
          g.ellipse(r() * w, r() * h, 0.4 + r() * 1.4, 0.3 + r(), r() * 3, 0, Math.PI * 2);
          g.fill();
        }
      }, 1, 8),
    ),
  /** Faded burgundy damask wallpaper with tarnished gold motifs. One repeat = 0.7 m. */
  wallpaper: () =>
    cached('h-wallpaper', () =>
      canvasTexture(64, 64, (g, w, h) => {
        const r = rng(19);
        g.fillStyle = '#5c2027';
        g.fillRect(0, 0, w, h);
        // faint vertical stripes
        for (let x = 0; x < w; x += 8) {
          g.fillStyle = 'rgba(255,220,180,0.035)';
          g.fillRect(x, 0, 3, h);
        }
        // ogee lattice: two sine curves per column crossing into lozenges
        g.strokeStyle = 'rgba(196,156,96,0.30)';
        g.lineWidth = 0.7;
        for (const ph of [0, Math.PI]) {
          for (let cx = 0; cx <= w; cx += 32) {
            g.beginPath();
            for (let y = 0; y <= h; y += 1) {
              const x = cx + Math.sin((y / h) * Math.PI * 2 + ph) * 16;
              if (y === 0) g.moveTo(x, y);
              else g.lineTo(x, y);
            }
            g.stroke();
          }
        }
        // small fleur in each lozenge
        const fleur = (cx: number, cy: number) => {
          g.fillStyle = 'rgba(196,156,96,0.26)';
          g.beginPath();
          g.ellipse(cx, cy, 1.6, 4.5, 0, 0, Math.PI * 2);
          g.fill();
          for (const sd of [-1, 1]) {
            g.beginPath();
            g.ellipse(cx + sd * 2.6, cy + 1.5, 1.1, 3, sd * 0.7, 0, Math.PI * 2);
            g.fill();
          }
          g.fillRect(cx - 3, cy + 4, 6, 0.8);
        };
        for (const [x, y] of [[0, 0], [32, 0], [64, 0], [16, 32], [48, 32], [0, 64], [32, 64], [64, 64]]) fleur(x, y);
        // fading, water stains and soot
        for (let i = 0; i < 40; i++) {
          g.fillStyle = `rgba(30,10,8,${0.05 + r() * 0.08})`;
          g.beginPath();
          g.ellipse(r() * w, r() * h, 2 + r() * 8, 2 + r() * 6, r() * 3, 0, Math.PI * 2);
          g.fill();
        }
      }, 1, 10),
    ),
  /** Dark green painted wainscot panels. One repeat = 0.8 m wide, 1.1 m tall. */
  wainscot: () =>
    cached('h-wainscot', () =>
      canvasTexture(32, 44, (g, w, h) => {
        g.fillStyle = '#1e3a2d';
        g.fillRect(0, 0, w, h);
        // raised panel with bevels
        g.fillStyle = '#244636';
        g.fillRect(4, 6, w - 8, h - 14);
        g.fillStyle = 'rgba(255,255,255,0.10)';
        g.fillRect(4, 6, w - 8, 1);
        g.fillRect(4, 6, 1, h - 14);
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(4, h - 9, w - 8, 1);
        g.fillRect(w - 5, 6, 1, h - 14);
        // skirting
        g.fillStyle = '#132a20';
        g.fillRect(0, h - 4, w, 4);
        // scuffs
        const r = rng(3);
        for (let i = 0; i < 18; i++) {
          g.fillStyle = `rgba(10,6,4,${0.15 + r() * 0.2})`;
          g.fillRect(r() * w, h - 8 + r() * 6, 1 + r() * 4, 0.5);
        }
      }, 1, 8),
    ),
  /** White subway tile with grey grout and some grease. One repeat = 0.6 m square. */
  subway: () =>
    cached('h-subway', () =>
      canvasTexture(48, 48, (g, w, h) => {
        const r = rng(11);
        g.fillStyle = '#8f8a80';
        g.fillRect(0, 0, w, h);
        const tw = 12;
        const th = 6;
        for (let row = 0; row < h / th; row++) {
          const off = row % 2 ? tw / 2 : 0;
          for (let x = -tw; x < w + tw; x += tw) {
            const v = 228 + r() * 14;
            g.fillStyle = `rgb(${v},${v - 4},${v - 12})`;
            g.fillRect(x + off + 0.4, row * th + 0.4, tw - 0.8, th - 0.8);
            g.fillStyle = 'rgba(255,255,255,0.5)';
            g.fillRect(x + off + 0.8, row * th + 0.8, tw - 2, 0.6);
          }
        }
        for (let i = 0; i < 26; i++) {
          g.fillStyle = `rgba(120,90,40,${0.04 + r() * 0.08})`;
          g.beginPath();
          g.ellipse(r() * w, r() * h, 1 + r() * 4, 1 + r() * 5, 0, 0, Math.PI * 2);
          g.fill();
        }
      }, 1, 6),
    ),
  /** White Carrara marble. */
  marble: () =>
    cached('h-marble', () =>
      canvasTexture(64, 64, (g, w, h) => {
        const r = rng(29);
        g.fillStyle = '#ece8e0';
        g.fillRect(0, 0, w, h);
        for (let i = 0; i < 9; i++) {
          g.strokeStyle = `rgba(110,110,118,${0.25 + r() * 0.3})`;
          g.lineWidth = 0.3 + r() * 0.7;
          let x = r() * w;
          let y = -4;
          g.beginPath();
          g.moveTo(x, y);
          while (y < h + 4) {
            x += (r() - 0.5) * 9;
            y += 3 + r() * 5;
            g.lineTo(x, y);
          }
          g.stroke();
        }
      }, 1, 5),
    ),
  /** Burgundy hotel carpet with a gold lattice. One repeat = 1 m. */
  carpet: () =>
    cached('h-carpet', () =>
      canvasTexture(32, 32, (g, w, h) => {
        g.fillStyle = '#4a1218';
        g.fillRect(0, 0, w, h);
        g.strokeStyle = 'rgba(200,150,70,0.55)';
        g.lineWidth = 0.8;
        g.beginPath();
        g.moveTo(16, 0);
        g.lineTo(32, 16);
        g.lineTo(16, 32);
        g.lineTo(0, 16);
        g.closePath();
        g.stroke();
        g.fillStyle = 'rgba(200,150,70,0.5)';
        for (const [x, y] of [[16, 16], [0, 0], [32, 0], [0, 32], [32, 32]]) {
          g.beginPath();
          g.arc(x, y, 2.4, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = 'rgba(20,40,30,0.6)';
        g.beginPath();
        g.arc(16, 16, 1.1, 0, Math.PI * 2);
        g.fill();
      }, 1, 16),
    ),
  /** Pressed-tin ceiling tiles, cream paint gone yellow. One repeat = 0.6 m. */
  tin: () =>
    cached('h-tin', () =>
      canvasTexture(32, 32, (g, w, h) => {
        g.fillStyle = '#cfc2a2';
        g.fillRect(0, 0, w, h);
        g.strokeStyle = 'rgba(255,250,230,0.3)';
        g.lineWidth = 1;
        g.strokeRect(2, 2, w - 4, h - 4);
        g.strokeStyle = 'rgba(60,50,30,0.22)';
        g.strokeRect(3, 3, w - 6, h - 6);
        g.beginPath();
        g.arc(16, 16, 7, 0, Math.PI * 2);
        g.stroke();
        g.strokeStyle = 'rgba(255,250,230,0.3)';
        g.beginPath();
        g.arc(16, 16, 5, 0, Math.PI * 2);
        g.stroke();
        const r = rng(5);
        for (let i = 0; i < 10; i++) {
          g.fillStyle = `rgba(90,60,20,${0.1 + r() * 0.15})`;
          g.beginPath();
          g.ellipse(r() * w, r() * h, 1 + r() * 4, 1 + r() * 3, 0, 0, Math.PI * 2);
          g.fill();
        }
      }, 1, 8),
    ),
  /** Torn patch of wallpaper showing plaster underneath (alpha-tested decal). */
  peel: (seed: number) =>
    cached(`h-peel-${seed}`, () =>
      canvasTexture(48, 48, (g, w, h) => {
        const r = rng(seed);
        g.clearRect(0, 0, w, h);
        const pts: [number, number][] = [];
        const n = 22;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const rad = 13 + r() * 9;
          pts.push([w / 2 + Math.cos(a) * rad, h / 2 + Math.sin(a) * rad * 1.2]);
        }
        // torn paper rim (lighter backing)
        g.fillStyle = '#e6d8b8';
        g.beginPath();
        pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.closePath();
        g.fill();
        // plaster
        g.fillStyle = '#b5aa92';
        g.beginPath();
        pts.forEach(([x, y], i) => {
          const px = w / 2 + (x - w / 2) * 0.86;
          const py = h / 2 + (y - h / 2) * 0.86;
          if (i) g.lineTo(px, py);
          else g.moveTo(px, py);
        });
        g.closePath();
        g.fill();
        for (let i = 0; i < 30; i++) {
          g.fillStyle = `rgba(80,70,50,${0.1 + r() * 0.2})`;
          g.beginPath();
          g.ellipse(w / 2 + (r() - 0.5) * 26, h / 2 + (r() - 0.5) * 30, 0.5 + r() * 2, 0.5 + r() * 2, 0, 0, Math.PI * 2);
          g.fill();
        }
        g.strokeStyle = 'rgba(60,50,40,0.6)';
        g.lineWidth = 0.4;
        g.beginPath();
        g.moveTo(w / 2 - 6, h / 2 - 8);
        g.lineTo(w / 2 + 1, h / 2 + 2);
        g.lineTo(w / 2 - 2, h / 2 + 10);
        g.stroke();
      }, 1, 6),
    ),
  /** "Employee of the Century": an oil portrait of Gorgon in a gilt frame. */
  portrait: () =>
    cached('h-portrait', () =>
      canvasTexture(64, 80, (g, w, h) => {
        g.fillStyle = '#8a6a2a';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#c9a24a';
        g.fillRect(2, 2, w - 4, h - 4);
        g.fillStyle = '#6a4a1a';
        g.fillRect(5, 5, w - 10, h - 18);
        const grad = g.createRadialGradient(32, 30, 4, 32, 34, 34);
        grad.addColorStop(0, '#3a4a2a');
        grad.addColorStop(1, '#141810');
        g.fillStyle = grad;
        g.fillRect(6, 6, w - 12, h - 20);
        // snakes for hair
        g.strokeStyle = '#4f7a2e';
        g.lineWidth = 2.2;
        g.lineCap = 'round';
        for (let i = 0; i < 9; i++) {
          const a = -Math.PI + (i / 8) * Math.PI;
          g.beginPath();
          g.moveTo(32 + Math.cos(a) * 9, 26 + Math.sin(a) * 9);
          g.quadraticCurveTo(32 + Math.cos(a) * 18 + 4, 22 + Math.sin(a) * 16, 32 + Math.cos(a) * 20, 24 + Math.sin(a) * 19);
          g.stroke();
        }
        // face + chef's whites
        g.fillStyle = '#7f9a5a';
        g.beginPath();
        g.ellipse(32, 30, 9, 11, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#e8e2d0';
        g.beginPath();
        g.moveTo(14, 62);
        g.quadraticCurveTo(32, 36, 50, 62);
        g.closePath();
        g.fill();
        g.fillStyle = '#d8ff60';
        g.fillRect(27, 28, 3, 2);
        g.fillRect(34, 28, 3, 2);
        g.fillStyle = '#2a1010';
        g.fillRect(28, 36, 8, 1.5);
        // brass plaque
        g.fillStyle = '#d8b860';
        g.fillRect(12, h - 12, w - 24, 8);
        g.fillStyle = '#2a1e08';
        g.font = 'bold 4px Georgia, serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('EMPLOYEE OF THE CENTURY', 32, h - 8);
      }, 1, 6),
    ),
};

// ---------------------------------------------------------------------------------------------
// Sky shader for the tall windows. Parallax-correct (infinitely far), with "reveals".
// ---------------------------------------------------------------------------------------------

const SKY_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const SKY_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uReveal;
uniform vec3 uFacing;
varying vec3 vWorld;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  float a = hash(i), b = hash(i + vec2(1,0)), c = hash(i + vec2(0,1)), d = hash(i + vec2(1,1));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main() {
  vec3 d = normalize(vWorld - cameraPosition);
  vec3 f = normalize(uFacing);
  vec3 r = normalize(cross(vec3(0.0, 1.0, 0.0), f));
  float az = atan(dot(d, r), dot(d, f));
  float el = asin(clamp(d.y, -1.0, 1.0));
  vec2 s = vec2(az, el);

  // Night sky: deep blue fading to near-black overhead.
  vec3 col = mix(vec3(0.010, 0.014, 0.035), vec3(0.05, 0.07, 0.15), smoothstep(0.7, 0.0, el));
  vec2 sp = s * 70.0;
  vec2 id = floor(sp);
  float h = hash(id);
  col += vec3(0.9, 0.9, 1.0) * step(0.982, h) * smoothstep(0.35, 0.0, length(fract(sp) - 0.5)) * (0.55 + 0.45 * sin(uTime * 2.0 + h * 50.0));
  float cl = noise(s * vec2(3.5, 9.0) + vec2(uTime * 0.012, 0.0)) * 0.7 + noise(s * vec2(9.0, 20.0)) * 0.3;
  col = mix(col, vec3(0.07, 0.075, 0.10), smoothstep(0.55, 0.85, cl) * 0.7 * smoothstep(-0.05, 0.15, el));

  // Moon (which, on a bad night, is a dinner plate).
  vec2 mp = vec2(-0.32, 0.42);
  float md = length((s - mp) * vec2(1.0, 1.0));
  float plate = smoothstep(0.25, 0.55, uReveal);
  col += vec3(0.25, 0.28, 0.36) * exp(-md * 9.0) * 0.6;
  vec3 moon = mix(vec3(0.95, 0.93, 0.84) - noise(s * 60.0) * 0.12, vec3(0.97, 0.96, 0.92), plate);
  col = mix(col, moon, smoothstep(0.085, 0.08, md));
  col = mix(col, vec3(0.9, 0.62, 0.2), plate * smoothstep(0.006, 0.0, abs(md - 0.07)));
  col = mix(col, vec3(0.75, 0.73, 0.68), plate * smoothstep(0.004, 0.0, abs(md - 0.05)) * 0.6);

  // Below the horizon: a black sea with a moon path.
  if (el < 0.0) {
    float wv = noise(vec2(az * 30.0, el * 120.0 + uTime * 0.5));
    vec3 sea = vec3(0.008, 0.012, 0.025) + vec3(0.25, 0.27, 0.32) * smoothstep(0.6, 0.95, wv) * exp(-abs(az - mp.x) * 6.0) * smoothstep(-0.5, 0.0, el);
    col = mix(sea, col, smoothstep(-0.006, 0.0, el));
  }

  // Reveal 1: the world outside is an endless facade of identical hotel windows.
  float rw = smoothstep(0.05, 0.45, uReveal);
  if (rw > 0.0) {
    vec2 g = vec2(az * 30.0 + uTime * 0.05, el * 26.0 / max(0.25, cos(el)));
    vec2 c = fract(g);
    float win = step(0.28, c.x) * step(c.x, 0.72) * step(0.22, c.y) * step(c.y, 0.82);
    vec3 fac = vec3(0.10, 0.065, 0.055) * (0.7 + 0.3 * noise(g * 3.0));
    vec3 lit = vec3(1.25, 0.82, 0.38) * (0.85 + 0.15 * sin(uTime * 1.3));
    vec3 wc = mix(fac, lit, win);
    wc = mix(wc, vec3(0.35, 0.05, 0.06), win * step(0.62, c.y) * 0.85); // identical drawn curtains
    col = mix(col, wc, rw);
  }

  // Reveal 2: a vast slit-pupilled eye opens across the sky and watches.
  float eo = smoothstep(0.55, 1.0, uReveal);
  if (eo > 0.0) {
    vec2 e = (s - vec2(0.0, 0.1)) / vec2(0.4, 0.2);
    float lid = (1.0 - e.x * e.x) * eo;
    float inside = step(abs(e.x), 1.0) * smoothstep(lid, lid - 0.04, abs(e.y));
    vec2 po = vec2(sin(uTime * 0.6) * 0.18, sin(uTime * 0.37) * 0.05);
    vec2 q = (e - po) * vec2(1.0, 0.62);
    float ir = length(q);
    vec3 sclera = mix(vec3(0.6, 0.55, 0.34), vec3(0.4, 0.1, 0.06), smoothstep(0.3, 1.0, length(e)));
    vec3 iris = mix(vec3(0.75, 0.95, 0.15), vec3(0.15, 0.4, 0.05), ir / 0.34) * (0.8 + 0.2 * noise(vec2(atan(q.y, q.x) * 8.0, ir * 10.0)));
    vec3 ec = mix(sclera, iris * 1.4, smoothstep(0.35, 0.33, ir));
    ec = mix(ec, vec3(0.0), smoothstep(0.06, 0.04, abs(q.x) / (1.0 - smoothstep(0.0, 0.3, abs(q.y)) + 0.001) * 0.5) * step(ir, 0.33));
    col = mix(col, ec, inside);
    col = mix(col, vec3(0.05, 0.01, 0.01), step(abs(e.x), 1.0) * smoothstep(0.05, 0.0, abs(abs(e.y) - lid)) * step(0.02, eo));
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------------------------
// Petrified diners
// ---------------------------------------------------------------------------------------------

type DinerPose = 'menu' | 'toast' | 'point' | 'fork' | 'cheek' | 'rest' | 'scream';

function buildDiner(pose: DinerPose, stone: THREE.Material, opts: { hat?: 'top' | 'cloche' | 'bun' | 'none'; wide?: boolean }): { group: THREE.Group; head: THREE.Object3D } {
  const group = new THREE.Group();
  const body = buildBody({
    hipHeight: 0.95,
    hipHalfWidth: opts.wide ? 0.11 : 0.09,
    legRadius: opts.wide ? 0.065 : 0.055,
    torsoLength: 0.5,
    waistHalfWidth: opts.wide ? 0.17 : 0.14,
    chestHalfWidth: opts.wide ? 0.2 : 0.17,
    torsoDepth: 0.7,
    shoulderHalfWidth: opts.wide ? 0.22 : 0.19,
    upperArm: 0.28,
    foreArm: 0.26,
    armRadius: 0.045,
    neckLength: 0.08,
    neckRadius: 0.045,
    footLength: 0.24,
    shirt: stone,
    sleeve: stone,
    pants: stone,
    shoe: stone,
    skin: stone,
  });
  group.add(body.root);
  body.hips.position.y = 0.5;
  const J = body.joints;
  // Head.
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 18, 14), stone);
  head.scale.set(0.92, 1.08, 1);
  head.position.y = 0.1;
  J.head.add(head);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.05, 6), stone);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 0.09, 0.11);
  J.head.add(nose);
  if (opts.hat === 'top') {
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.015, 20), stone);
    brim.position.y = 0.19;
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.1, 0.2, 20), stone);
    crown.position.y = 0.29;
    J.head.add(brim, crown);
  } else if (opts.hat === 'cloche') {
    const cl = new THREE.Mesh(new THREE.SphereGeometry(0.125, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), stone);
    cl.position.y = 0.12;
    const brim = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.02, 6, 20), stone);
    brim.rotation.x = Math.PI / 2;
    brim.position.y = 0.11;
    J.head.add(cl, brim);
  } else if (opts.hat === 'bun') {
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 10), stone);
    bun.position.set(0, 0.2, -0.06);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.112, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), stone);
    hair.position.y = 0.11;
    J.head.add(bun, hair);
  }
  // Seated legs.
  J.hipL.rotation.set(-1.5, 0, 0.06);
  J.hipR.rotation.set(-1.5, 0, -0.06);
  J.kneeL.rotation.set(1.42, 0, 0);
  J.kneeR.rotation.set(1.42, 0, 0);
  const P: Record<DinerPose, JointPose> = {
    rest: { spine: [0.08, 0, 0], shoulderL: [-0.65, 0, 0.05], shoulderR: [-0.65, 0, -0.05], elbowL: [-0.9, 0, 0], elbowR: [-0.9, 0, 0] },
    menu: { spine: [0.05, 0, 0], neck: [0.25, 0, 0], shoulderL: [-0.85, 0, -0.25], shoulderR: [-0.85, 0, 0.25], elbowL: [-1.3, 0, 0], elbowR: [-1.3, 0, 0] },
    toast: { spine: [-0.05, 0, 0], neck: [-0.2, 0, 0], shoulderL: [-0.6, 0, 0.05], elbowL: [-0.9, 0, 0], shoulderR: [-2.1, 0, -0.2], elbowR: [-0.5, 0, 0] },
    point: { spine: [0.0, 0.25, 0], neck: [0, -0.3, 0], shoulderL: [-0.6, 0, 0.05], elbowL: [-0.9, 0, 0], shoulderR: [-1.55, 0.3, -0.25], elbowR: [-0.1, 0, 0] },
    fork: { spine: [0.12, 0, 0], neck: [0.1, 0, 0], shoulderL: [-0.6, 0, 0.05], elbowL: [-0.9, 0, 0], shoulderR: [-0.75, 0, -0.35], elbowR: [-2.0, 0, 0] },
    cheek: { spine: [0.15, -0.1, 0.05], neck: [0.1, 0.2, 0.1], shoulderL: [-0.45, 0, 0.12], elbowL: [-2.35, 0, 0], shoulderR: [-0.65, 0, -0.05], elbowR: [-0.9, 0, 0] },
    scream: { spine: [-0.12, 0, 0], neck: [-0.25, 0, 0], shoulderL: [-0.6, 0, 0.75], elbowL: [-2.2, 0, 0], shoulderR: [-0.6, 0, -0.75], elbowR: [-2.2, 0, 0] },
  };
  for (const [k, v] of Object.entries(P[pose])) (J as Record<string, THREE.Group>)[k].rotation.set(v[0], v[1], v[2]);
  // Props in hand.
  if (pose === 'menu') {
    const menu = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.36, 0.012), stone);
    menu.position.set(-0.06, -0.06, 0.04);
    menu.rotation.set(0.2, 0, 0);
    body.handR.add(menu);
  } else if (pose === 'toast') {
    const glass = new THREE.Group();
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.018, 0.08, 14), stone);
    bowl.position.y = 0.09;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.08, 6), stone);
    stem.position.y = 0.03;
    glass.add(bowl, stem);
    glass.rotation.x = 2.4;
    glass.position.set(0, -0.02, 0.02);
    body.handR.add(glass);
  } else if (pose === 'fork' || pose === 'point') {
    const fk = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.16, 0.008), stone);
    fk.position.set(0, -0.08, 0.01);
    body.handR.add(fk);
  }
  return { group, head };
}

// ---------------------------------------------------------------------------------------------

export function buildHotelKitchen(scene: THREE.Scene, physics: Physics, ingredientMeshes: Record<IngredientKind, () => THREE.Object3D>): Kitchen {
  const root = new THREE.Group();
  root.name = 'hotelKitchen';
  scene.add(root);
  const pickables: THREE.Object3D[] = [];
  const tag = (o: THREE.Object3D, data: Record<string, unknown>) => {
    o.userData = { ...o.userData, ...data };
    pickables.push(o);
    return o;
  };
  const thin = <T extends THREE.Object3D>(o: T): T => {
    o.traverse((c) => (c.userData.noShadow = true));
    return o;
  };

  // ---------- materials ----------
  const steelTex = tex.steel();
  const mSteel = mat(0xe2e5e8, { map: steelTex, roughness: 0.25, metalness: 0.45 });
  const mCabinet = mat(0xc4c8cc, { map: steelTex, roughness: 0.35, metalness: 0.4 });
  const mGreenCab = mat(0x24432f, { roughness: 0.55 });
  const mMarble = mat(0xffffff, { map: htex.marble(), roughness: 0.18 });
  const mBrass = mat(0xc9a050, { roughness: 0.28, metalness: 1 });
  const mBrassDull = mat(0x9a7a3a, { roughness: 0.45, metalness: 0.9 });
  const mChrome = mat(0xe4e6ea, { roughness: 0.12, metalness: 1 });
  const mDark = mat(0x1c1c20, { roughness: 0.6 });
  const mBlack = mat(0x0e0e10, { roughness: 0.4 });
  const mWood = mat(0xffffff, { map: tex.wood() });
  const mWalnut = mat(0x6a4630, { map: tex.wood(), roughness: 0.5 });
  const mCream = mat(0xe8dcc0, { roughness: 0.6 });
  const mVelvet = mat(0x5a1018, { roughness: 0.95 });
  const mCloth = mat(0xf3f0e8, { roughness: 0.95 });
  const mStone = mat(0xa8a39a, { map: stoneTexture(true), roughness: 0.9 });
  const mStoneDark = mat(0x8e8a82, { map: stoneTexture(true), roughness: 0.9 });
  const wpTex = htex.wallpaper();
  const wsTex = htex.wainscot();
  const wallpaperMat = (len: number, h: number) => mat(0xffffff, { map: rep(wpTex, len / 0.7, h / 0.7), roughness: 0.85 });
  const wainscotMat = (len: number) => mat(0xffffff, { map: rep(wsTex, len / 0.8, 1), roughness: 0.55 });

  // ---------- room shell ----------
  const floorMat = mat(0xffffff, { map: rep(htex.floor(), 13 / 0.9, 10 / 0.9), roughness: 0.32 });
  box(root, physics, [0, -0.1, 0.5], [13, 0.2, 10], floorMat);
  const ceil = box(root, null, [0, H + 0.1, 0.5], [12.4, 0.2, 9.4], mat(0xffffff, { map: rep(htex.tin(), 12 / 0.6, 9 / 0.6), roughness: 0.6, metalness: 0.2 }));
  ceil.userData.noShadow = true;

  /** Wall segment along x (north/south) or z (east/west), wallpapered, with wainscot + rail + crown on the room side. */
  const wallX = (x0: number, x1: number, zc: number, inward: number, y0 = 0, y1 = H, collide = true, dress = true) => {
    const len = x1 - x0;
    box(root, collide ? physics : null, [(x0 + x1) / 2, (y0 + y1) / 2, zc], [len, y1 - y0, 0.2], wallpaperMat(len, y1 - y0));
    if (!dress) return;
    const zf = zc + inward * 0.1;
    if (y0 < 1.1) box(root, null, [(x0 + x1) / 2, 0.55, zf + inward * 0.02], [len, 1.1, 0.04], wainscotMat(len));
    if (y0 < 1.1 && y1 > 1.1) box(root, null, [(x0 + x1) / 2, 1.11, zf + inward * 0.035], [len, 0.04, 0.05], mBrassDull).userData.noShadow = true;
    if (y1 >= H - 0.01) box(root, null, [(x0 + x1) / 2, H - 0.08, zf + inward * 0.05], [len, 0.16, 0.1], mCream).userData.noShadow = true;
  };
  const wallZ = (z0: number, z1: number, xc: number, inward: number, y0 = 0, y1 = H, collide = true, dress = true) => {
    const len = z1 - z0;
    box(root, collide ? physics : null, [xc, (y0 + y1) / 2, (z0 + z1) / 2], [0.2, y1 - y0, len], wallpaperMat(len, y1 - y0));
    if (!dress) return;
    const xf = xc + inward * 0.1;
    if (y0 < 1.1) box(root, null, [xf + inward * 0.02, 0.55, (z0 + z1) / 2], [0.04, 1.1, len], wainscotMat(len));
    if (y0 < 1.1 && y1 > 1.1) box(root, null, [xf + inward * 0.035, 1.11, (z0 + z1) / 2], [0.05, 0.04, len], mBrassDull).userData.noShadow = true;
    if (y1 >= H - 0.01) box(root, null, [xf + inward * 0.05, H - 0.08, (z0 + z1) / 2], [0.1, 0.16, len], mCream).userData.noShadow = true;
  };
  // North wall.
  wallX(-6.2, 6.2, -4.1, 1);
  // West wall.
  wallZ(-4, 5, -6.1, 1);
  // South wall with the service hatch over the pass (x 1.3 .. 4.0, y 0.9 .. 2.25).
  const HATCH = { x0: 1.3, x1: 4.0, y0: COUNTER_TOP, y1: 2.25 };
  wallX(-6.2, HATCH.x0, 5.1, -1);
  wallX(HATCH.x1, 6.2, 5.1, -1);
  wallX(HATCH.x0, HATCH.x1, 5.1, -1, HATCH.y1, H, true, true);
  wallX(HATCH.x0, HATCH.x1, 5.1, -1, 0, HATCH.y0, true, false);
  // Invisible pane in the hatch: the dining room is for looking at, not walking (or throwing) into.
  physics.addBox({ x: (HATCH.x0 + HATCH.x1) / 2, y: (HATCH.y0 + HATCH.y1) / 2 + 0.6, z: 5.12 }, { x: HATCH.x1 - HATCH.x0, y: HATCH.y1 - HATCH.y0 + 1.2, z: 0.16 });
  // Brass hatch frame.
  box(root, null, [(HATCH.x0 + HATCH.x1) / 2, HATCH.y1 + 0.03, 4.99], [HATCH.x1 - HATCH.x0 + 0.12, 0.06, 0.06], mBrass);
  for (const x of [HATCH.x0, HATCH.x1]) box(root, null, [x, (HATCH.y0 + HATCH.y1) / 2, 4.99], [0.06, HATCH.y1 - HATCH.y0, 0.06], mBrass);
  // East wall with the doorway at z 1.8 .. 3.2.
  wallZ(-4, 1.8, 6.1, -1);
  wallZ(3.2, 5, 6.1, -1);
  wallZ(1.8, 3.2, 6.1, -1, 2.4, H, false, false);
  physics.addBox({ x: 6.1, y: 1.2, z: 2.5 }, { x: 0.2, y: 2.4, z: 1.4 }); // keep the player in
  // Door casing.
  for (const z of [1.76, 3.24]) box(root, null, [5.98, 1.2, z], [0.06, 2.4, 0.08], mWalnut);
  box(root, null, [5.98, 2.43, 2.5], [0.06, 0.08, 1.56], mWalnut);

  // Swinging double doors: walnut with brass kick plates and round portholes (hinges at z 1.8 and 3.2).
  const doorL = new THREE.Group();
  const doorR = new THREE.Group();
  doorL.position.set(6.05, 0, 1.8);
  doorR.position.set(6.05, 0, 3.2);
  const porthole = basic(0xffd890);
  for (const [g, s] of [[doorL, 1], [doorR, -1]] as [THREE.Group, number][]) {
    box(g, null, [0, 1.17, s * 0.35], [0.06, 2.2, 0.68], mWalnut);
    box(g, null, [-0.035, 0.18, s * 0.35], [0.01, 0.3, 0.64], mBrass);
    const ph = new THREE.Mesh(new THREE.CircleGeometry(0.13, 24), porthole);
    ph.rotation.y = -Math.PI / 2;
    ph.position.set(-0.035, 1.5, s * 0.35);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.015, 8, 24), mBrass);
    ring.rotation.y = Math.PI / 2;
    ring.position.set(-0.04, 1.5, s * 0.35);
    const push = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.3, 0.1), mBrass);
    push.position.set(-0.035, 1.1, s * 0.12);
    g.add(ph, ring, push);
  }
  root.add(doorL, doorR);
  // A sliver of hotel corridor behind the doors.
  {
    const cor = new THREE.Group();
    const carpet = mat(0xffffff, { map: rep(htex.carpet(), 4, 3) });
    box(cor, null, [8.0, -0.05, 2.5], [3.8, 0.1, 3.2], carpet);
    box(cor, null, [8.0, 2.6, 2.5], [3.8, 0.1, 3.2], mCream);
    box(cor, null, [8.0, 1.3, 0.85], [3.8, 2.6, 0.1], wallpaperMat(3.8, 2.6));
    box(cor, null, [8.0, 1.3, 4.15], [3.8, 2.6, 0.1], wallpaperMat(3.8, 2.6));
    box(cor, null, [9.9, 1.3, 2.5], [0.1, 2.6, 3.2], wallpaperMat(3.2, 2.6));
    const sconce = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8), basic(0xffc070));
    sconce.position.set(9.8, 1.8, 2.5);
    cor.add(sconce);
    thin(cor);
    root.add(cor);
  }

  // Peeling wallpaper: torn patches showing plaster, with curled flaps.
  const peel = (pos: [number, number, number], rotY: number, size: number, seed: number, flap: boolean) => {
    const m = mat(0xffffff, { map: htex.peel(seed), roughness: 0.9 });
    m.alphaTest = 0.5;
    const d = new THREE.Mesh(new THREE.PlaneGeometry(size, size), m);
    d.position.set(...pos);
    d.rotation.y = rotY;
    d.userData.noShadow = true;
    root.add(d);
    if (flap) {
      const g = new THREE.PlaneGeometry(size * 0.45, size * 0.6, 1, 10);
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const t = (size * 0.3 - p.getY(i)) / (size * 0.6); // 0 at the top (still stuck) .. 1 at the curled end
        p.setZ(i, t * t * size * 0.35);
        p.setY(i, p.getY(i) + t * t * size * 0.08);
      }
      g.computeVertexNormals();
      const fm = mat(0xffffff, { map: rep(wpTex, 0.4, 0.5), side: THREE.DoubleSide, roughness: 0.9 });
      const f = new THREE.Mesh(g, fm);
      f.position.set(pos[0], pos[1] - size * 0.25, pos[2]);
      f.rotation.y = rotY;
      f.translateX(size * 0.18);
      f.translateZ(0.005);
      f.rotateZ(0.25);
      root.add(f);
    }
  };
  peel([-5.975, 2.35, 3.6], Math.PI / 2, 0.7, 31, true);
  peel([-4.9, 2.7, 4.975], Math.PI, 0.55, 47, true);
  peel([5.975, 2.0, 4.3], -Math.PI / 2, 0.5, 53, false);
  peel([-5.975, 2.9, -1.2], Math.PI / 2, 0.45, 61, true);
  peel([0.9, 2.95, 4.975], Math.PI, 0.4, 71, false);

  // ---------- north wall: the hot line ----------
  // Subway tile backsplash.
  box(root, null, [0.65, 1.6, -3.985], [10.7, 1.4, 0.02], mat(0xffffff, { map: rep(htex.subway(), 10.7 / 0.6, 1.4 / 0.6), roughness: 0.2 })).userData.noShadow = true;
  box(root, null, [0.65, 2.31, -3.975], [10.7, 0.03, 0.03], mBrassDull).userData.noShadow = true;
  // Reach-in fridge (NW corner).
  box(root, physics, [-5.3, 1.05, -3.55], [1.2, 2.1, 0.9], mat(0xc4c8cc, { map: steelTex, roughness: 0.35, metalness: 0.6 }));
  box(root, null, [-5.3, 1.05, -3.095], [0.01, 2.0, 0.01], mDark);
  for (const x of [-5.42, -5.18]) box(root, null, [x, 1.2, -3.06], [0.03, 0.55, 0.04], mBrass);
  const fridgeSign = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.14), basic(0xffffff, { map: tex.sign('KNOCK FIRST', '#e8d8a8', '#2a1a10', 128, 26) }));
  fridgeSign.position.set(-5.3, 1.75, -3.094);
  root.add(fridgeSign);
  counter(root, physics, -4.7, -1.6, -4, -3.3, mCabinet, mSteel);

  // Stove block x in [-1.6, 1.1].
  box(root, null, [-0.25, 0.45, -3.65], [2.7, 0.9, 0.7], mDark);
  physics.addBox({ x: -0.25, y: 0.45, z: -3.65 }, { x: 2.7, y: 0.9, z: 0.7 });
  box(root, null, [-0.25, 0.905, -3.65], [2.7, 0.02, 0.7], mat(0xffffff, { map: tex.stoveTop() }));
  box(root, null, [-0.25, 0.86, -3.295], [2.7, 0.06, 0.02], mBrass);
  box(root, null, [-0.7, 0.45, -3.29], [1.2, 0.5, 0.02], mBlack);
  box(root, null, [-0.7, 0.62, -3.27], [0.9, 0.025, 0.03], mChrome);
  for (let i = 0; i < 5; i++) {
    const k = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 14), mChrome);
    k.rotation.x = Math.PI / 2;
    k.position.set(-1.4 + i * 0.3 + (i > 2 ? 0.9 : 0), 0.78, -3.27);
    root.add(k);
  }
  counter(root, physics, 1.1, 3.1, -4, -3.3, mCabinet, mSteel);
  // Fire extinguisher bracket (the game spawns the extinguisher at (2.7, top, -3.6)).
  const fireSign = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.1), basic(0xffffff, { map: tex.sign('FIRE', '#ffffff', '#b81414', 64, 22) }));
  fireSign.position.set(2.7, 1.55, -3.97);
  root.add(fireSign);
  box(root, null, [2.7, 1.2, -3.96], [0.12, 0.05, 0.06], mDark);

  // Big copper-trimmed hood over the stove and oven.
  box(root, null, [1.55, 2.62, -3.6], [6.6, 0.55, 0.85], mSteel);
  box(root, null, [1.55, 2.33, -3.17], [6.6, 0.05, 0.05], mBrass).userData.noShadow = true;
  box(root, null, [1.55, 3.12, -3.75], [2.0, 0.5, 0.5], mSteel);
  const resortSign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.42), basic(0xffffff, { map: tex.sign('THE LAST RESORT', '#e8c870', '#1a2e22', 256, 42) }));
  resortSign.position.set(-0.25, 2.62, -3.17);
  root.add(resortSign);

  const stations: Record<StationId, THREE.Vector3> = {
    board: new THREE.Vector3(-1.5, COUNTER_TOP, -0.62),
    prep: new THREE.Vector3(0.15, COUNTER_TOP, -0.62),
    pan: new THREE.Vector3(-1.15, COUNTER_TOP + 0.03, -3.6),
    pot: new THREE.Vector3(-0.25, COUNTER_TOP, -3.6),
    fryer: new THREE.Vector3(0.65, COUNTER_TOP, -3.6),
    oven: new THREE.Vector3(3.9, 0.81, -3.45),
    plateA: new THREE.Vector3(2.0, COUNTER_TOP, 4.62),
    plateB: new THREE.Vector3(3.3, COUNTER_TOP, 4.62),
  };

  // Frying pan, stock pot, deep fryer: the familiar basement kit.
  const pan = new THREE.Group();
  pan.position.copy(stations.pan);
  const panBase = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.17, 0.05, 24), mat(0x2a2a2e, { roughness: 0.45, metalness: 0.5 }));
  panBase.position.y = 0.025;
  const panHandle = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.025, 0.04), mat(0x161616));
  panHandle.position.set(0, 0.04, 0.32);
  panHandle.rotation.y = Math.PI / 2;
  pan.add(panBase, panHandle);
  root.add(pan);
  tag(panBase, { station: 'pan' });
  const burnerGlow = basic(0xff5a1a, { transparent: true, opacity: 0.7 });
  for (const sx of [stations.pan.x, stations.pot.x]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.015, 6, 24), burnerGlow);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(sx, COUNTER_TOP + 0.012, -3.6);
    root.add(ring);
  }
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.2, 0.3, 28, 1, true), mat(0xb8bcc0, { map: steelTex, side: THREE.DoubleSide, roughness: 0.3, metalness: 0.7 }));
  pot.position.set(stations.pot.x, COUNTER_TOP + 0.15, stations.pot.z);
  root.add(pot);
  const water = new THREE.Mesh(new THREE.CircleGeometry(0.21, 28), basic(0x6f8fa0, { transparent: true, opacity: 0.85 }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(stations.pot.x, COUNTER_TOP + 0.25, stations.pot.z);
  root.add(water);
  tag(water, { station: 'pot' });
  physics.addCylinder({ x: stations.pot.x, y: COUNTER_TOP + 0.1, z: stations.pot.z }, 0.1, 0.22);
  box(root, null, [stations.fryer.x, COUNTER_TOP + 0.1, stations.fryer.z], [0.5, 0.2, 0.45], mSteel);
  physics.addBox({ x: stations.fryer.x, y: COUNTER_TOP + 0.05, z: stations.fryer.z }, { x: 0.5, y: 0.1, z: 0.45 });
  const oil = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.37), basic(0xc8901e));
  oil.rotation.x = -Math.PI / 2;
  oil.position.set(stations.fryer.x, COUNTER_TOP + 0.205, stations.fryer.z);
  root.add(oil);
  tag(oil, { station: 'fryer' });

  // Oven mitts on a hook beside the stove; the mirror pan hangs above the counter further west.
  const mitts = new THREE.Group();
  mitts.position.set(-1.9, 1.2, -3.9);
  for (const dx of [-0.07, 0.07]) {
    const m = buildMitt();
    m.position.x = dx;
    m.rotation.set(Math.PI, 0, dx * 1.5);
    m.position.y = 0.27;
    mitts.add(m);
  }
  box(root, null, [mitts.position.x, mitts.position.y + 0.3, -3.96], [0.05, 0.05, 0.08], mBrass);
  mitts.traverse((o) => (o as THREE.Mesh).isMesh && tag(o, { mitts: true }));
  root.add(mitts);
  const mirrorHook = new THREE.Vector3(-3.4, 1.45, -3.92);
  box(root, null, [mirrorHook.x, mirrorHook.y + 0.32, -3.96], [0.05, 0.05, 0.08], mBrass);

  // ---------- the oven ----------
  const oven = buildOven();
  root.add(oven.group);

  function buildOven(): OvenRig {
    const g = new THREE.Group();
    const X = 3.9;
    const ZF = -3.0; // front face
    const ovSteel = mat(0xe4e7ea, { map: steelTex, roughness: 0.22, metalness: 0.45 });
    const enamel = mat(0x1a1a1e, { roughness: 0.5, emissive: 0x000000 });
    // Shell: base, top, side cheeks, back. The chamber opening is x 3.4..4.4, y 0.55..1.25.
    const shell: [number, number, number, number, number, number][] = [
      [X, 0.3, -3.5, 1.6, 0.5, 1.0],
      [X, 1.45, -3.5, 1.6, 0.4, 1.0],
      [3.25, 0.9, -3.5, 0.3, 0.7, 1.0],
      [4.55, 0.9, -3.5, 0.3, 0.7, 1.0],
      [X, 0.9, -3.95, 1.0, 0.7, 0.1],
    ];
    for (const [x, y, z, sx, sy, sz] of shell) {
      box(g, null, [x, y, z], [sx, sy, sz], ovSteel);
      physics.addBox({ x, y, z }, { x: sx, y: sy, z: sz });
    }
    box(g, null, [X, 0.03, -3.48], [1.5, 0.06, 0.96], mBlack); // kick plate
    box(g, null, [X, 1.645, ZF + 0.005], [1.62, 0.03, 0.03], mBrass).userData.noShadow = true;
    box(g, null, [X, 0.07, ZF + 0.005], [1.62, 0.03, 0.03], mBrass).userData.noShadow = true;
    // Cast-iron feet so it reads as a big freestanding range oven.
    for (const sx of [-0.72, 0.72]) box(g, null, [X + sx, 0.03, ZF - 0.06], [0.1, 0.06, 0.1], mBlack);
    // Chamber lining (dark enamel) just inside the opening.
    box(g, null, [X, 0.56, -3.45], [1.0, 0.02, 0.9], enamel);
    box(g, null, [X, 1.24, -3.45], [1.0, 0.02, 0.9], enamel);
    box(g, null, [3.41, 0.9, -3.45], [0.02, 0.68, 0.9], enamel);
    box(g, null, [4.39, 0.9, -3.45], [0.02, 0.68, 0.9], enamel);
    const backPanel = box(g, null, [X, 0.9, -3.89], [0.98, 0.68, 0.02], enamel);
    // Wire rack the trays slide onto.
    const RACK_Y = 0.8;
    for (let i = 0; i < 9; i++) {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.86, 6), mChrome);
      rod.rotation.x = Math.PI / 2;
      rod.position.set(3.5 + i * 0.1, RACK_Y - 0.005, -3.46);
      rod.userData.noShadow = true;
      g.add(rod);
    }
    for (const z of [-3.85, -3.07]) box(g, null, [X, RACK_Y - 0.005, z], [0.96, 0.01, 0.01], mChrome);
    physics.addBox({ x: X, y: RACK_Y - 0.01, z: -3.46 }, { x: 0.96, y: 0.02, z: 0.84 });
    // Invisible pane over the oven mouth so loose food can't be thrown or knocked into the chamber.
    physics.addBox({ x: X, y: 0.9, z: ZF - 0.03 }, { x: 1.0, y: 0.7, z: 0.04 });
    // Interior bulb + light.
    const bulbMat = basic(0x3a3020);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), bulbMat);
    bulb.position.set(4.3, 1.18, -3.8);
    g.add(bulb);
    const light = new THREE.PointLight(0xffc070, 0, 1.6, 2);
    light.position.set(X, 1.12, -3.5);
    g.add(light);

    // Door: bottom-hinged, drops forward. Pivot on the hinge line.
    const door = new THREE.Group();
    door.position.set(X, 0.55, ZF + 0.01);
    const dw = 1.02;
    const dh = 0.7;
    const frame: [number, number, number, number][] = [
      [0, 0.08, dw, 0.16],
      [0, dh - 0.08, dw, 0.16],
      [-dw / 2 + 0.07, dh / 2, 0.14, dh],
      [dw / 2 - 0.07, dh / 2, 0.14, dh],
    ];
    for (const [x, y, w, h] of frame) {
      const m = box(door, null, [x, y, 0.025], [w, h, 0.05], ovSteel);
      tag(m, { station: 'oven' });
    }
    const glassMat = mat(0x1a120c, { transparent: true, opacity: 0.45, roughness: 0.05, metalness: 0.2, emissive: 0x000000 });
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(dw - 0.28, dh - 0.32), glassMat);
    glass.position.set(0, dh / 2, 0.03);
    door.add(glass);
    tag(glass, { station: 'oven' });
    const glassIn = glass.clone();
    glassIn.position.z = 0.0;
    glassIn.rotation.y = Math.PI;
    door.add(glassIn);
    // Handle bar.
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.8, 14), mChrome);
    handle.rotation.z = Math.PI / 2;
    handle.position.set(0, dh - 0.07, 0.11);
    door.add(handle);
    tag(handle, { station: 'oven' });
    for (const x of [-0.36, 0.36]) {
      const so = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.06, 8), mChrome);
      so.rotation.x = Math.PI / 2;
      so.position.set(x, dh - 0.07, 0.08);
      door.add(so);
    }
    g.add(door);
    // Invisible aim box over the oven mouth, so the target doesn't flicker as the door swings.
    const aimBox = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.85, 1.0), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, opacity: 0 }));
    aimBox.position.set(X, 0.95, ZF - 0.4);
    g.add(aimBox);
    aimBox.userData.noShadow = true;
    tag(aimBox, { station: 'oven', aimVolume: true });

    // Control panel (right cheek): knobs + power lamp.
    for (let i = 0; i < 3; i++) {
      const k = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.035, 18), mBlack);
      k.rotation.x = Math.PI / 2;
      k.position.set(4.55, 1.08 - i * 0.16, ZF + 0.02);
      const pip = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.03, 0.01), mChrome);
      pip.position.set(4.55, 1.095 - i * 0.16, ZF + 0.04);
      g.add(k, pip);
    }
    const lampMat = basic(0x301008);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), lampMat);
    lamp.position.set(4.55, 0.68, ZF + 0.01);
    g.add(lamp);
    const plateSign = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.11), basic(0xffffff, { map: tex.sign('GRAND ROYALE', '#2a1e08', '#d0b060', 128, 22) }));
    plateSign.position.set(4.05, 1.47, ZF + 0.002);
    g.add(plateSign);
    tag(plateSign, { station: 'oven' });

    // Clip-on kitchen timer with a big LED display, top-left of the oven front.
    const timer = new THREE.Group();
    timer.position.set(3.42, 1.46, ZF);
    const tBody = new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.2, 0.05, 3, 0.02), mat(0xf2efe6, { roughness: 0.4 }));
    tBody.position.z = 0.03;
    timer.add(tBody);
    const clip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.025, 0.1), mBlack);
    clip.position.set(0, 0.21, -0.02);
    const clipTab = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.12, 0.012), mBlack);
    clipTab.position.set(0, 0.15, 0.055);
    timer.add(clip, clipTab);
    const tc = document.createElement('canvas');
    tc.width = 320;
    tc.height = 144;
    const tctx = tc.getContext('2d')!;
    const timerTex = new THREE.CanvasTexture(tc);
    timerTex.colorSpace = THREE.SRGBColorSpace;
    timerTex.anisotropy = 4;
    const display = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.144), basic(0xffffff, { map: timerTex }));
    display.position.set(0, -0.005, 0.0565);
    timer.add(display);
    tag(display, { station: 'oven' });
    tag(tBody, { station: 'oven' });
    g.add(timer);

    let timerKey = '';
    let lastSeconds: number | null = null;
    let lastReady = false;
    const drawTimer = (text: string, mode: 'idle' | 'run' | 'ready' | 'off') => {
      const key = text + mode;
      if (key === timerKey) return;
      timerKey = key;
      const c = tctx;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.fillStyle = mode === 'ready' ? '#0f2a0c' : '#0b0c0b';
      c.fillRect(0, 0, 320, 144);
      c.strokeStyle = '#3a3a34';
      c.lineWidth = 8;
      c.strokeRect(4, 4, 312, 136);
      c.font = 'bold 104px "Courier New", Courier, monospace';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = 'rgba(255,60,30,0.08)';
      c.fillText('88:88', 160, 78);
      if (mode !== 'off') {
        const col = mode === 'ready' ? '#9dff6a' : mode === 'run' ? '#ff4a26' : '#7a3020';
        c.shadowColor = col;
        c.shadowBlur = mode === 'idle' ? 0 : 18;
        c.fillStyle = col;
        c.fillText(text, 160, 78);
        c.shadowBlur = 0;
      }
      if (mode === 'ready' || mode === 'off') {
        c.font = 'bold 22px Arial, sans-serif';
        c.fillStyle = mode === 'ready' ? '#d8ffb0' : '#4a6a40';
        c.fillText('READY', 160, 128);
      }
      timerTex.needsUpdate = true;
    };
    const fmt = (s: number) => {
      const t = Math.max(0, Math.ceil(s));
      return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    };
    const refreshTimer = () => {
      if (lastSeconds === null) drawTimer('--:--', 'idle');
      else if (lastReady) drawTimer(fmt(lastSeconds), Math.floor(performance.now() / 260) % 2 === 0 ? 'ready' : 'off');
      else drawTimer(fmt(lastSeconds), 'run');
    };
    refreshTimer();

    const warmA = new THREE.Color(0xffd890);
    const warmB = new THREE.Color(0xff6a18);
    const tmp = new THREE.Color();
    const rig: OvenRig & { refreshTimer(): void } = {
      group: g,
      rack: new THREE.Vector3(X, RACK_Y, -3.45),
      front: new THREE.Vector3(X, 0, -2.0),
      setDoor(open: number) {
        door.rotation.x = THREE.MathUtils.clamp(open, 0, 1) * (Math.PI / 2 - 0.04);
      },
      setLight(on: boolean, glow: number) {
        glow = THREE.MathUtils.clamp(glow, 0, 1);
        tmp.copy(warmA).lerp(warmB, glow);
        light.color.copy(tmp);
        light.intensity = on ? 1.4 + glow * 1.6 : 0;
        bulbMat.color.copy(on ? tmp : new THREE.Color(0x3a3020));
        glassMat.emissive.copy(tmp).multiplyScalar(on ? 0.08 + glow * 0.35 : 0);
        enamel.emissive.copy(tmp).multiplyScalar(on ? 0.05 + glow * 0.25 : 0);
        backPanel.material = enamel;
        lampMat.color.set(on ? 0xff3010 : 0x301008);
      },
      setTimer(seconds: number | null, ready: boolean) {
        lastSeconds = seconds;
        lastReady = ready;
        refreshTimer();
      },
      refreshTimer,
    };
    rig.setDoor(0);
    rig.setLight(false, 0);
    return rig;
  }

  // NE counter with the spring-loaded toaster.
  counter(root, physics, 4.7, 6.0, -4, -3.3, mCabinet, mSteel);
  const toasterG = new THREE.Group();
  const toasterBase = new THREE.Vector3(5.3, COUNTER_TOP, -3.62);
  toasterG.position.copy(toasterBase);
  toasterG.userData.toaster = true;
  {
    const body = new THREE.Mesh(new RoundedBoxGeometry(0.32, 0.21, 0.2, 4, 0.045), mChrome);
    body.position.y = 0.105;
    toasterG.add(body);
    tag(body, { toaster: true });
    for (const dz of [-0.04, 0.04]) {
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.012, 0.028), mBlack);
      slot.position.set(0, 0.206, dz);
      toasterG.add(slot);
    }
    for (const sx of [-1, 1]) {
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.012, 0.16), mBlack);
      foot.position.set(sx * 0.12, 0.006, 0);
      toasterG.add(foot);
    }
    const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.015, 14), mBlack);
    dial.rotation.x = Math.PI / 2;
    dial.position.set(-0.09, 0.07, 0.105);
    toasterG.add(dial);
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 6, 16), mBrass);
    coil.position.set(0.09, 0.12, 0.103);
    toasterG.add(coil);
  }
  const lever = new THREE.Group();
  lever.position.set(0.165, 0.16, 0);
  const leverKnob = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.022, 0.05), mBlack);
  leverKnob.position.x = 0.02;
  lever.add(leverKnob);
  const leverTrack = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.13, 0.012), mBlack);
  leverTrack.position.set(0.161, 0.105, 0);
  toasterG.add(lever, leverTrack);
  root.add(toasterG);
  physics.addBox({ x: toasterBase.x, y: COUNTER_TOP + 0.1, z: toasterBase.z }, { x: 0.32, y: 0.2, z: 0.2 });
  const toasterSign = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.1), basic(0xffffff, { map: tex.sign('MIND THE TOAST', '#2a1e08', '#e8d8a8', 128, 26) }));
  toasterSign.position.set(5.3, 1.45, -3.975);
  root.add(toasterSign);

  // Sheet-tray speed rack south of the toaster counter, against the east wall.
  const trayRack: THREE.Vector3[] = [];
  {
    const rg = new THREE.Group();
    const RX = 5.65;
    const RZ = -3.0;
    const mAlu = mat(0xc0c4c8, { roughness: 0.35, metalness: 0.8 });
    for (const dx of [-0.27, 0.27])
      for (const dz of [-0.24, 0.24]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.6, 0.03), mAlu);
        post.position.set(RX + dx, 0.8, RZ + dz);
        rg.add(post);
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 10), mBlack);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(RX + dx, 0.03, RZ + dz);
        rg.add(wheel);
      }
    const levels = [0.12, 0.34, 0.58, 0.82, 1.06, 1.3, 1.55];
    for (const y of levels) {
      for (const dz of [-0.2, 0.2]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.012, 0.04), mAlu);
        rail.position.set(RX, y, RZ + dz);
        rail.userData.noShadow = true;
        rg.add(rail);
      }
    }
    // Spare trays stacked on the bottom slides (decor), and three empty slides where the game spawns real trays.
    const sheetTray = (y: number) => {
      const t = new THREE.Group();
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.006, 0.32), mAlu);
      t.add(base);
      for (const [x, z, w, d] of [[0, 0.16, 0.45, 0.008], [0, -0.16, 0.45, 0.008], [0.225, 0, 0.008, 0.32], [-0.225, 0, 0.008, 0.32]]) {
        const lip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.022, d), mAlu);
        lip.position.set(x, 0.011, z);
        t.add(lip);
      }
      t.position.set(RX, y + 0.009, RZ);
      rg.add(t);
    };
    sheetTray(levels[0]);
    sheetTray(levels[1]);
    for (const y of [levels[2], levels[3], levels[4]]) {
      physics.addBox({ x: RX, y: y, z: RZ }, { x: 0.54, y: 0.012, z: 0.44 });
      trayRack.push(new THREE.Vector3(RX, y + 0.01, RZ));
    }
    physics.addBox({ x: RX, y: 0.25, z: RZ }, { x: 0.58, y: 0.5, z: 0.52 });
    physics.addBox({ x: RX + 0.27, y: 0.8, z: RZ }, { x: 0.04, y: 1.6, z: 0.52 });
    root.add(rg);
    const traySign = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.09), basic(0xffffff, { map: tex.sign('TRAYS', '#e8d8a8', '#1a2e22', 96, 22) }));
    traySign.position.set(RX - 0.31, 1.72, RZ);
    traySign.rotation.y = -Math.PI / 2;
    root.add(traySign);
  }

  // ---------- the island ----------
  counter(root, physics, -2.6, 1.4, -1.0, 0.4, mGreenCab, mMarble);
  box(root, null, [-0.6, 0.07, -0.3], [3.9, 0.14, 1.3], mBrassDull); // kick plate
  for (const z of [-1.04, 0.44]) {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 3.6, 12), mBrass);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(-0.6, 0.72, z);
    bar.userData.noShadow = true;
    root.add(bar);
  }
  // Cutting board + knife.
  tag(box(root, null, [stations.board.x, COUNTER_TOP + 0.02, stations.board.z], [0.7, 0.04, 0.45], mWood), { station: 'board' });
  const boardKnife = buildKnife();
  boardKnife.rotation.set(0, Math.PI / 2 + 0.15, Math.PI / 2);
  boardKnife.position.set(stations.board.x + 0.05, COUNTER_TOP + 0.046, stations.board.z + 0.17);
  root.add(boardKnife);
  // Seasoning tray (dark green enamel) with brass-capped shakers.
  tag(box(root, null, [stations.prep.x, COUNTER_TOP + 0.01, stations.prep.z], [0.6, 0.02, 0.45], mat(0x2c4a3a, { roughness: 0.4 })), { station: 'prep' });
  for (const [dx, c] of [[0.35, 0xeeeeee], [0.45, 0x333333]] as [number, number][]) {
    const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.13, 16), mat(c, { roughness: 0.3 }));
    sh.position.set(stations.prep.x + dx, COUNTER_TOP + 0.065, stations.prep.z - 0.15);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.036, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), mBrass);
    cap.position.set(sh.position.x, COUNTER_TOP + 0.13, sh.position.z);
    root.add(sh, cap);
  }
  // A brass bowl of lemons on the south half of the island (dressing).
  {
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat(0xc9a050, { roughness: 0.3, metalness: 1, side: THREE.DoubleSide }));
    bowl.position.set(-0.6, COUNTER_TOP + 0.16, 0.12);
    root.add(bowl);
    const lemonMat = mat(0xe8c830, { roughness: 0.5 });
    for (let i = 0; i < 4; i++) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 10), lemonMat);
      l.scale.set(1, 0.85, 1.25);
      l.position.set(-0.6 + Math.cos(i * 1.7) * 0.06, COUNTER_TOP + 0.08 + (i === 3 ? 0.05 : 0), 0.12 + Math.sin(i * 1.7) * 0.06);
      root.add(l);
    }
  }

  // ---------- west wall: pantry + linen shelf ----------
  counter(root, physics, -5.9, -5.0, -2.85, 1.25, mGreenCab, mWalnut);
  const binKinds = ['sourdough', 'tomato', 'mushroom', 'cheese', 'potato', 'steak', 'beef', 'pastry', 'greens'] as IngredientKind[];
  const bins: Bin[] = [];
  const crateMat = mat(0x8a6a3a, { map: tex.wood() });
  const crateKinds = binKinds.filter((k) => !!(ingredientMeshes as Partial<Record<IngredientKind, () => THREE.Object3D>>)[k]);
  crateKinds.forEach((kind, i) => {
    const z = -2.6 + i * 0.44;
    const crate = new THREE.Group();
    crate.position.set(-5.45, COUNTER_TOP, z);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.38), crateMat);
    base.position.y = 0.07;
    crate.add(base);
    for (let k = 0; k < 2; k++) {
      const sample = ingredientMeshes[kind]();
      sample.position.set(-0.1 + k * 0.2, 0.16, 0);
      sample.rotation.y = k * 1.3;
      sample.scale.setScalar(0.85);
      crate.add(sample);
    }
    root.add(crate);
    tag(base, { bin: kind });
    crate.children.forEach((c) => c !== base && tag(c, { bin: kind }));
    bins.push({ kind, pos: crate.position.clone(), mesh: crate });
  });
  // Open shelves of jars above the pantry.
  {
    const jarCols = [0xb8402a, 0xd8b048, 0x6a8a3a, 0xe8dcc0, 0x7a3a5a, 0xc87a2a];
    const r = rng(17);
    for (const y of [1.65, 2.15]) {
      box(root, null, [-5.8, y, -0.8], [0.32, 0.04, 4.0], mWalnut);
      for (let z = -2.6; z < 1.1; z += 0.22 + r() * 0.1) {
        const jh = 0.14 + r() * 0.1;
        const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, jh, 12), mat(jarCols[Math.floor(r() * jarCols.length)], { roughness: 0.3 }));
        jar.position.set(-5.8, y + 0.02 + jh / 2, z);
        const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.02, 12), mBrass);
        lid.position.set(-5.8, y + 0.03 + jh, z);
        root.add(jar, lid);
      }
      for (const z of [-2.6, -0.8, 1.0]) box(root, null, [-5.86, y - 0.08, z], [0.18, 0.12, 0.03], mBrassDull);
    }
    const pantrySign = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.24), basic(0xffffff, { map: tex.sign('LARDER', '#e8c870', '#1a2e22', 128, 28) }));
    pantrySign.position.set(-5.975, 2.75, -0.8);
    pantrySign.rotation.y = Math.PI / 2;
    root.add(pantrySign);
  }

  // Rickety linen shelf against the west wall, south of the pantry (same spot type as the basement's).
  const shelfG = new THREE.Group();
  shelfG.position.set(-5.68, 0, 2.6);
  const mWire = mat(0xc8b070, { roughness: 0.35, metalness: 0.85 });
  for (const [dx, dz] of [[-0.2, -0.5], [-0.2, 0.5], [0.2, -0.5], [0.2, 0.5]]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1.8, 10), mWire);
    post.position.set(dx, 0.9, dz);
    shelfG.add(post);
  }
  const shelfSpots: THREE.Vector3[] = [];
  for (const y of [0.45, 0.95, 1.45]) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.02, 1.04), mWire);
    board.position.y = y;
    shelfG.add(board);
    physics.addBox({ x: shelfG.position.x, y, z: shelfG.position.z }, { x: 0.44, y: 0.02, z: 1.04 });
    for (const dz of [-0.3, 0, 0.3]) shelfSpots.push(new THREE.Vector3(shelfG.position.x + 0.02, y + 0.12, shelfG.position.z + dz));
  }
  // Folded linens on top and a towel draped over the side.
  for (const dz of [-0.3, 0.05, 0.35]) {
    const stack = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, 0.26), mat(0xeee8dc, { roughness: 0.95 }));
    stack.position.set(0, 1.8 + 0.08, dz);
    shelfG.add(stack);
  }
  const towel = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.55), mat(0xd8d0c0, { side: THREE.DoubleSide, roughness: 0.95 }));
  towel.position.set(0.0, 1.2, 0.53);
  towel.userData.noShadow = true;
  shelfG.add(towel);
  root.add(shelfG);
  physics.addBox({ x: shelfG.position.x - 0.22, y: 0.9, z: shelfG.position.z }, { x: 0.04, y: 1.8, z: 1.04 });
  const shelfSign = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.12), basic(0xffffff, { map: tex.sign('DO NOT LEAN', '#2a1e08', '#d0b060', 128, 32) }));
  shelfSign.position.set(shelfG.position.x + 0.23, 1.68, shelfG.position.z);
  shelfSign.rotation.y = Math.PI / 2;
  root.add(shelfSign);

  // Trash can against the west end of the island.
  const trash = new THREE.Vector3(-2.95, 0, -0.3);
  {
    const trashG = new THREE.Group();
    trashG.position.copy(trash);
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.22, 0.72, 28, 1, true), mat(0x23402f, { roughness: 0.45, metalness: 0.3, side: THREE.DoubleSide }));
    can.position.y = 0.36;
    const canBottom = new THREE.Mesh(new THREE.CircleGeometry(0.22, 24), mat(0x1a1a1a));
    canBottom.rotation.x = -Math.PI / 2;
    canBottom.position.y = 0.02;
    const canRim = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.018, 8, 28), mBrass);
    canRim.rotation.x = Math.PI / 2;
    canRim.position.y = 0.72;
    const binBag = new THREE.Mesh(new THREE.CircleGeometry(0.24, 24), mat(0x111111, { roughness: 0.3 }));
    binBag.rotation.x = -Math.PI / 2;
    binBag.position.y = 0.55;
    trashG.add(can, canBottom, canRim, binBag);
    root.add(trashG);
    [can, canRim, binBag].forEach((m) => tag(m, { trash: true }));
    const trashSign = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.1), basic(0xffffff, { map: tex.sign('TRASH', '#2a1e08', '#d0b060', 96, 28) }));
    trashSign.position.set(trash.x - 0.255, 0.45, trash.z);
    trashSign.rotation.y = -Math.PI / 2;
    root.add(trashSign);
    physics.addCylinder({ x: trash.x, y: 0.2, z: trash.z }, 0.2, 0.26);
  }

  // ---------- south wall: rivals, dumbwaiter, the pass ----------
  counter(root, physics, -5.9, -0.9, 4.3, 5.0, mCabinet, mSteel);
  for (const x of [-4.4, -3.0, -1.6]) {
    box(root, null, [x, COUNTER_TOP + 0.02, 4.65], [0.6, 0.04, 0.4], mWood);
    box(root, null, [x + 0.45, COUNTER_TOP + 0.08, 4.6], [0.26, 0.14, 0.26], mat(0x44484c, { roughness: 0.4, metalness: 0.5 }));
  }
  // Employee of the Century.
  {
    const portrait = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.0), mat(0xffffff, { map: htex.portrait(), roughness: 0.6 }));
    portrait.position.set(-3.0, 2.25, 4.97);
    portrait.rotation.y = Math.PI;
    root.add(portrait);
    box(root, null, [-3.0, 2.25, 4.99], [0.9, 1.1, 0.03], mBrass);
    const lampArm = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.6, 8), mBrass);
    lampArm.rotation.z = Math.PI / 2;
    lampArm.position.set(-3.0, 2.85, 4.88);
    root.add(lampArm);
    const lampBar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.03), basic(0xfff0c0));
    lampBar.position.set(-3.0, 2.83, 4.86);
    root.add(lampBar);
  }
  // Dumbwaiter hatch with a ROOM SERVICE plaque.
  box(root, null, [-0.25, 1.35, 4.985], [0.9, 0.85, 0.03], mBrassDull);
  box(root, null, [-0.25, 1.35, 4.975], [0.02, 0.8, 0.02], mDark);
  const rsSign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.16), basic(0xffffff, { map: tex.sign('ROOM SERVICE', '#e8c870', '#3a0c12', 128, 24) }));
  rsSign.position.set(-0.25, 1.95, 4.97);
  rsSign.rotation.y = Math.PI;
  root.add(rsSign);

  // The pass: steel counter at the hatch, heat lamps, plates, bells, ticket printer.
  counter(root, physics, 0.4, 4.6, 4.3, 5.0, mCabinet, mSteel);
  for (const id of ['plateA', 'plateB'] as const) {
    const p = stations[id];
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.2, 6), mBrass);
    rod.position.set(p.x, HATCH.y1 + 0.0, 4.72);
    rod.userData.noShadow = true;
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.17, 0.16, 20, 1, true), mat(0xb08a40, { side: THREE.DoubleSide, roughness: 0.35, metalness: 0.9 }));
    shade.position.set(p.x, HATCH.y1 - 0.17, 4.72);
    shade.userData.noShadow = true;
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.17, 20), basic(0xff7a2a));
    glow.rotation.x = Math.PI / 2;
    glow.position.set(p.x, HATCH.y1 - 0.24, 4.72);
    root.add(rod, shade, glow);
  }
  const passPlates = {} as Record<'plateA' | 'plateB', THREE.Group>;
  for (const id of ['plateA', 'plateB'] as const) {
    const p = stations[id];
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.008, 0.56), mat(0x1c1c1c, { roughness: 0.9 }));
    pad.position.set(p.x, COUNTER_TOP + 0.004, p.z);
    root.add(pad);
    tag(pad, { station: id });
    const plate = buildPlate();
    plate.position.set(p.x, COUNTER_TOP + 0.008, p.z);
    plate.visible = false;
    plate.children.forEach((c) => tag(c, { station: id }));
    root.add(plate);
    passPlates[id] = plate;
  }
  const plateStack = new THREE.Vector3(0.8, COUNTER_TOP, 4.62);
  for (let i = 0; i < 6; i++) {
    const pl = buildPlate();
    pl.position.set(plateStack.x, COUNTER_TOP + i * 0.026, plateStack.z);
    pl.rotation.y = i * 0.7;
    pl.children.forEach((c) => tag(c, { plateStack: true }));
    root.add(pl);
  }
  physics.addCylinder({ x: plateStack.x, y: COUNTER_TOP + 0.08, z: plateStack.z }, 0.08, 0.24);
  // Service bell (chrome on black, the one you ring to serve): between the plates, at the hatch.
  const bell = new THREE.Vector3(2.65, COUNTER_TOP, 4.74);
  {
    const bellG = new THREE.Group();
    bellG.position.copy(bell);
    const bellBase = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.075, 0.025, 20), mBlack);
    bellBase.position.y = 0.012;
    const bellDome = new THREE.Mesh(new THREE.SphereGeometry(0.062, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mChrome);
    bellDome.position.y = 0.024;
    const bellBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.03, 8), mChrome);
    bellBtn.position.y = 0.095;
    bellG.add(bellBase, bellDome, bellBtn);
    root.add(bellG);
    tag(bellDome, { bell: true });
    tag(bellBtn, { bell: true });
  }
  // Desk bell (brass on a walnut block, reception style) at the east end of the pass.
  const deskBell = new THREE.Vector3(4.3, COUNTER_TOP, 4.6);
  {
    const g = new THREE.Group();
    g.position.copy(deskBell);
    const block = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.035, 0.16, 2, 0.01), mWalnut);
    block.position.y = 0.0175;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.058, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mBrass);
    dome.position.y = 0.035;
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.03, 8), mBrass);
    btn.position.y = 0.105;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), mBrass);
    knob.position.y = 0.122;
    g.add(block, dome, btn, knob);
    root.add(g);
    [block, dome, btn, knob].forEach((m) => tag(m, { deskBell: true }));
    const card = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.06), basic(0xffffff, { map: tex.sign('PLEASE RING', '#2a1e08', '#f0e6c8', 96, 30) }));
    card.position.set(deskBell.x, COUNTER_TOP + 0.04, deskBell.z - 0.1);
    card.rotation.x = -0.5;
    root.add(card);
  }
  // Order rail across the hatch header, with tickets.
  {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, HATCH.x1 - HATCH.x0, 10), mBrass);
    rail.rotation.z = Math.PI / 2;
    rail.position.set((HATCH.x0 + HATCH.x1) / 2, HATCH.y1 + 0.2, 4.97);
    rail.userData.noShadow = true;
    root.add(rail);
    const ticketTex = canvasTexture(16, 32, (g2, w, h) => {
      g2.fillStyle = '#f4efe2';
      g2.fillRect(0, 0, w, h);
      g2.fillStyle = '#3a3a3a';
      for (let y = 4; y < h - 2; y += 3) g2.fillRect(2, y, 6 + ((y * 7) % 6), 1);
      g2.fillStyle = '#a02020';
      g2.fillRect(2, 1, 8, 1.5);
    }, 1, 4);
    for (const [x, rot] of [[1.6, 0.04], [2.1, -0.05], [3.55, 0.03]]) {
      const t = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.16), basic(0xffffff, { map: ticketTex }));
      t.position.set(x, HATCH.y1 + 0.12, 4.955);
      t.rotation.set(0, Math.PI, rot);
      root.add(t);
    }
    const passSign = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.2), basic(0xffffff, { map: tex.sign('SERVICE', '#e8c870', '#1a2e22', 128, 26) }));
    passSign.position.set((HATCH.x0 + HATCH.x1) / 2, HATCH.y1 + 0.6, 4.985);
    passSign.rotation.y = Math.PI;
    root.add(passSign);
  }
  // Ticket printer on a brass bracket above the plate stack, mouth facing the kitchen.
  const printerG = new THREE.Group();
  printerG.position.set(0.8, 1.5, 4.82);
  {
    box(printerG, null, [0, -0.02, 0.06], [0.3, 0.02, 0.24], mBrassDull);
    const body = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.15, 0.2, 2, 0.02), mat(0x2a2a2e, { roughness: 0.5 }));
    body.position.set(0, 0.075, 0.0);
    printerG.add(body);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.008, 0.02), mBlack);
    slot.position.set(0, 0.12, -0.1);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), basic(0x40ff60));
    led.position.set(0.08, 0.04, -0.1);
    printerG.add(slot, led);
    printerG.rotation.y = 0; // mouth faces -Z (the kitchen)
  }
  root.add(printerG);
  const printerMouth = new THREE.Vector3(0.8, 1.62, 4.715);
  const paperGeo = new THREE.PlaneGeometry(0.08, 1);
  paperGeo.translate(0, -0.5, 0);
  const paper = new THREE.Mesh(paperGeo, mat(0xf6f2e6, { side: THREE.DoubleSide, roughness: 0.9 }));
  paper.position.copy(printerMouth);
  paper.rotation.y = Math.PI;
  paper.scale.y = 0.08;
  paper.userData.noShadow = true;
  root.add(paper);

  // ---------- room-service trolley (no physics body: the game adds one) ----------
  const trolleySpawn = new THREE.Vector3(-0.25, 0, 3.55);
  const trolleyG = new THREE.Group();
  trolleyG.position.copy(trolleySpawn);
  const trolleyLocks: THREE.Object3D[] = [];
  const TROLLEY_TOP = 0.88;
  {
    const W = 0.9;
    const D = 0.55;
    const mTop = mat(0xd8dcde, { map: steelTex, roughness: 0.3, metalness: 0.7 });
    for (const y of [0.32, TROLLEY_TOP - 0.01]) {
      box(trolleyG, null, [0, y - 0.01, 0], [W, 0.02, D], mTop);
      for (const [x, z, w, d] of [[0, D / 2, W, 0.01], [0, -D / 2, W, 0.01], [W / 2, 0, 0.01, D], [-W / 2, 0, 0.01, D]]) box(trolleyG, null, [x, y + 0.015, z], [w, 0.03, d], mBrass);
    }
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, TROLLEY_TOP - 0.1, 10), mBrass);
        post.position.set((sx * W) / 2 - sx * 0.02, 0.1 + (TROLLEY_TOP - 0.1) / 2, (sz * D) / 2 - sz * 0.02);
        trolleyG.add(post);
        // Caster: fork + wheel.
        const cx = (sx * W) / 2 - sx * 0.05;
        const cz = (sz * D) / 2 - sz * 0.05;
        const fork = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.03), mDark);
        fork.position.set(cx, 0.085, cz);
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.025, 16), mBlack);
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(cx, 0.05, cz);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.03, 10), mChrome);
        hub.rotation.x = Math.PI / 2;
        hub.position.copy(wheel.position);
        trolleyG.add(fork, wheel, hub);
        // Wheel lock: a red foot tab on a pivot. rotation.x: -0.5 released (tab up), +0.35 locked (pressed down).
        const lock = new THREE.Group();
        lock.position.set(cx + sx * 0.035, 0.09, cz);
        const tab = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.012, 0.07), mat(0xc81e1e, { roughness: 0.5 }));
        tab.position.set(0, 0, sz * 0.04);
        lock.add(tab);
        lock.rotation.x = -0.5 * sz;
        lock.userData.trolleyLock = true;
        trolleyG.add(lock);
        trolleyLocks.push(lock);
      }
    // Push handle at the -x end.
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, D - 0.04, 12), mBrass);
    handle.rotation.x = Math.PI / 2;
    handle.position.set(-W / 2 - 0.09, TROLLEY_TOP + 0.08, 0);
    trolleyG.add(handle);
    for (const sz of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.13, 8), mBrass);
      arm.rotation.z = Math.PI / 2 - 0.5;
      arm.position.set(-W / 2 - 0.05, TROLLEY_TOP + 0.04, (sz * (D - 0.04)) / 2);
      trolleyG.add(arm);
    }
    // Linen skirt on the lower shelf front.
    const skirt = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.04, 0.18), mCloth);
    skirt.position.set(0, TROLLEY_TOP - 0.1, D / 2 + 0.005);
    skirt.userData.noShadow = true;
    trolleyG.add(skirt);
  }
  root.add(trolleyG);

  // ---------- east wall: tall window ----------
  const skyMats: THREE.ShaderMaterial[] = [];
  const skyMat = (facing: THREE.Vector3) => {
    const m = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: { uTime: { value: 0 }, uReveal: { value: 0 }, uFacing: { value: facing } },
      side: THREE.DoubleSide,
    });
    skyMats.push(m);
    return m;
  };
  /** A tall sash window: sky plane + frame, mullions and velvet drapes. `rotY` turns the +Z-facing build to face the room. */
  const tallWindow = (parent: THREE.Object3D, pos: THREE.Vector3, rotY: number, w: number, h: number, facing: THREE.Vector3, frameMat: THREE.Material) => {
    const g = new THREE.Group();
    g.position.copy(pos);
    g.rotation.y = rotY;
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(w, h), skyMat(facing));
    sky.position.y = h / 2;
    g.add(sky);
    const ft = 0.07;
    box(g, null, [0, h + ft / 2, 0.03], [w + ft * 2, ft, 0.08], frameMat);
    box(g, null, [0, -ft / 2, 0.06], [w + ft * 2 + 0.06, ft, 0.14], frameMat);
    for (const s of [-1, 1]) box(g, null, [s * (w / 2 + ft / 2), h / 2, 0.03], [ft, h + ft * 2, 0.08], frameMat);
    box(g, null, [0, h / 2, 0.02], [0.035, h, 0.04], frameMat);
    for (let i = 1; i < 4; i++) box(g, null, [0, (h * i) / 4, 0.02], [w, 0.03, 0.04], frameMat);
    // Drapes with folds.
    for (const s of [-1, 1]) {
      const dg = new THREE.PlaneGeometry(w * 0.32, h + 0.4, 14, 1);
      const p = dg.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 55) * 0.03);
      dg.computeVertexNormals();
      const d = new THREE.Mesh(dg, mat(0x6a1420, { side: THREE.DoubleSide, roughness: 0.95 }));
      d.position.set(s * (w / 2 + w * 0.1), h / 2 + 0.1, 0.12);
      g.add(d);
    }
    box(g, null, [0, h + 0.25, 0.14], [w * 1.7, 0.03, 0.03], mBrass);
    parent.add(g);
    return g;
  };
  tallWindow(root, new THREE.Vector3(5.98, 0.85, -1.15), -Math.PI / 2, 1.0, 2.15, new THREE.Vector3(1, 0, 0), mCream);
  // Moonlight from the window.
  const moon = new THREE.PointLight(0x7a90c8, 1.2, 4.5, 1.5);
  moon.position.set(5.2, 2.2, -1.15);
  scene.add(moon);

  // ---------- dining room (beyond the hatch) ----------
  const dining = new THREE.Group();
  root.add(dining);
  const diners: THREE.Vector3[] = [];
  {
    const DZ0 = 5.2;
    const DZ1 = 13;
    const DX0 = -6.2;
    const DX1 = 7.6;
    const dw = DX1 - DX0;
    const dd = DZ1 - DZ0;
    const cx = (DX0 + DX1) / 2;
    const cz = (DZ0 + DZ1) / 2;
    box(dining, null, [cx, -0.05, cz], [dw, 0.1, dd], mat(0xffffff, { map: rep(htex.carpet(), dw, dd), roughness: 0.95 }));
    box(dining, null, [cx, DH + 0.1, cz], [dw, 0.2, dd], mat(0xffffff, { map: rep(htex.tin(), dw / 0.6, dd / 0.6), roughness: 0.6 }));
    // Walls (wallpaper + wainscot) - far wall has the tall windows.
    const dWall = (c: [number, number, number], s: [number, number, number], len: number) => {
      box(dining, null, c, s, wallpaperMat(len, DH));
    };
    dWall([cx, DH / 2, DZ1 + 0.1], [dw, DH, 0.2], dw);
    dWall([DX0 - 0.1, DH / 2, cz], [0.2, DH, dd], dd);
    dWall([DX1 + 0.1, DH / 2, cz], [0.2, DH, dd], dd);
    box(dining, null, [cx, 0.55, DZ1 - 0.02], [dw, 1.1, 0.04], wainscotMat(dw));
    box(dining, null, [DX0 + 0.02, 0.55, cz], [0.04, 1.1, dd], wainscotMat(dd));
    box(dining, null, [DX1 - 0.02, 0.55, cz], [0.04, 1.1, dd], wainscotMat(dd));
    box(dining, null, [cx, DH - 0.1, DZ1 - 0.05], [dw, 0.2, 0.1], mCream);
    // Kitchen side of the dining room (back of the hatch wall) above the kitchen's 3.4 m ceiling.
    box(dining, null, [cx, (H + DH) / 2, 5.1], [dw, DH - H, 0.2], wallpaperMat(dw, DH - H));
    // Three tall windows on the far wall.
    for (const x of [-1.4, 2.65, 6.0]) tallWindow(dining, new THREE.Vector3(x, 0.7, DZ1 - 0.01), Math.PI, 1.5, 3.3, new THREE.Vector3(0, 0, 1), mCream);
    // Brass wall sconces between the windows.
    for (const x of [0.62, 4.33]) {
      const sc = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), basic(0xffc878));
      sc.position.set(x, 2.4, DZ1 - 0.15);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.12), mBrass);
      arm.position.set(x, 2.3, DZ1 - 0.06);
      dining.add(sc, arm);
    }
    // Chandelier.
    const ch = new THREE.Group();
    ch.position.set(2.6, DH - 0.9, 8.6);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.9, 8), mBrass);
    stem.position.y = 0.45;
    const hub = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 10), mBrass);
    const ringC = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.02, 8, 40), mBrass);
    ringC.rotation.x = Math.PI / 2;
    ch.add(stem, hub, ringC);
    const flameMat = basic(0xffd890);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const cnd = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.12, 8), mCream);
      cnd.position.set(Math.cos(a) * 0.6, 0.07, Math.sin(a) * 0.6);
      const fl = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), flameMat);
      fl.scale.y = 1.6;
      fl.position.set(Math.cos(a) * 0.6, 0.17, Math.sin(a) * 0.6);
      const drop = new THREE.Mesh(new THREE.OctahedronGeometry(0.03, 0), basic(0xdde8ff));
      drop.position.set(Math.cos(a + 0.3) * 0.5, -0.12, Math.sin(a + 0.3) * 0.5);
      ch.add(cnd, fl, drop);
    }
    dining.add(ch);

    // Tables, chairs, candles and petrified guests.
    const tableAt = (x: number, z: number, guests: { a: number; pose: DinerPose; hat?: 'top' | 'cloche' | 'bun' | 'none'; wide?: boolean; dark?: boolean }[], reserved = false) => {
      const tg = new THREE.Group();
      tg.position.set(x, 0, z);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.03, 32), mCloth);
      top.position.y = 0.755;
      const skirtC = new THREE.Mesh(new THREE.CylinderGeometry(0.61, 0.68, 0.72, 32, 1, true), mCloth);
      skirtC.position.y = 0.38;
      tg.add(top, skirtC);
      const holder = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.05, 12), mBrass);
      holder.position.y = 0.795;
      const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.18, 10), mCream);
      candle.position.y = 0.91;
      const flame = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), flameMat);
      flame.scale.y = 1.8;
      flame.position.y = 1.03;
      flame.userData.candle = true;
      tg.add(holder, candle, flame);
      candles.push(flame);
      if (reserved) {
        const card = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.08), basic(0xffffff, { map: tex.sign('RESERVED: G.', '#2a1e08', '#f0e6c8', 112, 32) }));
        card.position.set(0, 0.81, -0.2);
        card.rotation.set(-0.3, Math.PI, 0);
        tg.add(card);
      }
      for (const gst of guests) {
        const dx = Math.sin(gst.a);
        const dz = Math.cos(gst.a);
        // Place setting.
        const pl = buildPlate();
        pl.scale.setScalar(0.6);
        pl.position.set(dx * 0.38, 0.772, dz * 0.38);
        tg.add(pl);
        // Chair + guest, facing the table centre.
        const seat = new THREE.Group();
        seat.position.set(dx * 0.95, 0, dz * 0.95);
        seat.rotation.y = gst.a + Math.PI;
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.06, 0.46), mVelvet);
        s.position.set(0, 0.46, -0.05);
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.7, 0.05), mWalnut);
        back.position.set(0, 0.84, -0.28);
        seat.add(s, back);
        for (const [lx, lz] of [[-0.2, -0.26], [0.2, -0.26], [-0.2, 0.16], [0.2, 0.16]]) {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.44, 0.04), mWalnut);
          leg.position.set(lx, 0.22, lz);
          seat.add(leg);
        }
        const d = buildDiner(gst.pose, gst.dark ? mStoneDark : mStone, { hat: gst.hat, wide: gst.wide });
        seat.add(d.group);
        tg.add(seat);
        dinerHeads.push(d.head);
      }
      dining.add(tg);
    };
    const candles: THREE.Mesh[] = [];
    const dinerHeads: THREE.Object3D[] = [];
    // Angle a: direction from the table centre to the chair (0 = toward +z, far wall; PI = toward the hatch).
    tableAt(1.5, 6.9, [
      { a: -Math.PI / 2, pose: 'menu', hat: 'bun' },
      { a: Math.PI / 2, pose: 'toast', hat: 'top', wide: true, dark: true },
    ]);
    tableAt(4.1, 7.5, [{ a: 0.15, pose: 'point', hat: 'none', dark: true }]);
    tableAt(-1.7, 8.5, [
      { a: 0.5, pose: 'cheek', hat: 'cloche' },
      { a: Math.PI + 0.4, pose: 'rest', hat: 'top' },
    ]);
    tableAt(2.6, 10.0, [
      { a: -0.6, pose: 'fork', hat: 'none', wide: true },
      { a: 1.9, pose: 'scream', hat: 'bun', dark: true },
    ]);
    tableAt(5.8, 10.6, [{ a: -1.2, pose: 'rest', hat: 'cloche', dark: true }]);
    tableAt(-0.8, 11.5, [], true);
    dining.userData.candles = candles;
    dining.updateMatrixWorld(true);
    for (const h of dinerHeads) diners.push(h.getWorldPosition(new THREE.Vector3()));
    diningCandles = candles;
    diningFlame = flameMat;
  }
  thin(dining);

  // ---------- lighting ----------
  scene.add(new THREE.HemisphereLight(0xa89a88, 0x2a1a14, 0.5));
  const fluoro: THREE.SpotLight[] = [];
  const tubes: THREE.Mesh[] = [];
  for (const [x, z] of [
    [-3.1, -1.9],
    [1.3, -1.9],
    [-1.8, 2.4],
    [3.0, 2.3],
  ]) {
    // Brass pendant lamps: domed shade on a rod, a bare bulb glowing under it, and a wide shadow-casting spot.
    const l = new THREE.SpotLight(0xffe4b8, 16, 11, 1.2, 0.8, 1.6);
    l.position.set(x, 2.48, z);
    l.target.position.set(x, 0, z);
    l.castShadow = true;
    l.shadow.mapSize.set(1024, 1024);
    l.shadow.bias = -0.0004;
    l.shadow.normalBias = 0.02;
    l.shadow.camera.near = 0.2;
    l.shadow.camera.far = 11;
    scene.add(l, l.target);
    fluoro.push(l);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, H - 2.7, 6), mBrass);
    rod.position.set(x, (H + 2.7) / 2, z);
    const canopy = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.04, 14), mBrass);
    canopy.position.set(x, H - 0.02, z);
    const shade = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), mat(0x24432f, { side: THREE.DoubleSide, roughness: 0.4, metalness: 0.3 }));
    shade.position.set(x, 2.4 + 0.3 * 0.96, z);
    shade.scale.y = 0.8;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.012, 6, 28), mBrass);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(x, 2.55, z);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), basic(0xfff0c8));
    bulb.position.set(x, 2.56, z);
    [rod, canopy, shade, rim, bulb].forEach((m) => (m.userData.noShadow = true));
    root.add(rod, canopy, shade, rim, bulb);
    tubes.push(bulb);
  }
  const passLight = new THREE.PointLight(0xff9a50, 3.6, 3.2, 1.6);
  passLight.position.set(2.65, 1.65, 4.55);
  scene.add(passLight);
  // Dining room: chandelier glow and cold moonlight from the tall windows.
  const chandelier = new THREE.PointLight(0xffc080, 9, 11, 1.4);
  chandelier.position.set(2.6, DH - 1.1, 8.6);
  scene.add(chandelier);
  const diningMoon = new THREE.PointLight(0x6a80c0, 5, 9, 1.4);
  diningMoon.position.set(2.6, 2.6, 12.2);
  scene.add(diningMoon);
  scene.fog = new THREE.Fog(0x0b0908, 12, 30);
  scene.background = new THREE.Color(0x0b0908);

  // ---------- Gorgon's walking graph ----------
  const waypoints: Waypoints = {
    nodes: {
      offstage: new THREE.Vector3(8.5, 0, 2.5),
      door: new THREE.Vector3(5.3, 0, 2.5),
      east: new THREE.Vector3(4.6, 0, 0.9),
      judge: new THREE.Vector3(5.15, 0, 3.95),
      pass: new THREE.Vector3(2.65, 0, 3.6),
      southE: new THREE.Vector3(2.6, 0, 2.2),
      southM: new THREE.Vector3(-0.4, 0, 2.0),
      southW: new THREE.Vector3(-3.4, 0, 2.2),
      west: new THREE.Vector3(-4.05, 0, -0.2),
      backW: new THREE.Vector3(-3.8, 0, -2.15),
      backM: new THREE.Vector3(-1.5, 0, -2.15),
      backC: new THREE.Vector3(0.6, 0, -2.15),
      oven: new THREE.Vector3(3.9, 0, -2.05),
      backE: new THREE.Vector3(4.85, 0, -1.4),
    },
    edges: [
      ['offstage', 'door'],
      ['door', 'east'],
      ['door', 'judge'],
      ['judge', 'pass'],
      ['pass', 'southE'],
      ['east', 'southE'],
      ['east', 'backE'],
      ['southE', 'southM'],
      ['southM', 'southW'],
      ['southW', 'west'],
      ['west', 'backW'],
      ['backW', 'backM'],
      ['backM', 'backC'],
      ['backC', 'oven'],
      ['oven', 'backE'],
    ],
  };

  // ---------- hotel set ----------
  let windowT = 0;
  let windowReveal = 0;
  const hotel: HotelSet = {
    trolley: { group: trolleyG, spawn: trolleySpawn.clone(), size: new THREE.Vector3(0.9, TROLLEY_TOP, 0.55), top: TROLLEY_TOP, locks: trolleyLocks },
    toaster: {
      group: toasterG,
      slot: new THREE.Vector3(toasterBase.x, COUNTER_TOP + 0.21, toasterBase.z),
      setLever(t: number) {
        lever.position.y = 0.16 - THREE.MathUtils.clamp(t, 0, 1) * 0.1;
      },
      setRattle(t: number) {
        const n = performance.now();
        toasterG.position.set(
          toasterBase.x + Math.sin(n * 0.31) * 0.004 * t,
          toasterBase.y + Math.abs(Math.sin(n * 0.47)) * 0.007 * t,
          toasterBase.z + Math.sin(n * 0.23 + 1) * 0.003 * t,
        );
        toasterG.rotation.set(Math.sin(n * 0.29) * 0.03 * t, 0, Math.sin(n * 0.37) * 0.05 * t);
      },
    },
    deskBell: deskBell.clone(),
    printer: { group: printerG, mouth: printerMouth.clone(), paper },
    trayRack,
    diners,
    setWindows(t: number, reveal: number) {
      windowT = t;
      windowReveal = THREE.MathUtils.clamp(reveal, 0, 1);
      for (const m of skyMats) {
        m.uniforms.uTime.value = windowT;
        m.uniforms.uReveal.value = windowReveal;
      }
    },
  };

  const ovenRig = oven as OvenRig & { refreshTimer(): void };
  return {
    root,
    pickables,
    stations,
    bins,
    bell,
    shelf: { group: shelfG, front: new THREE.Vector3(shelfG.position.x + 0.5, 0, shelfG.position.z), spots: shelfSpots },
    passPlates,
    plateStack,
    boardKnife,
    trash,
    mirrorHook,
    mitts,
    oven: ovenRig,
    hotel,
    extinguisher: new THREE.Vector3(2.7, COUNTER_TOP + 0.05, -3.6),
    spawn: new THREE.Vector3(-0.6, 0, -2.0),
    judgeSpot: waypoints.nodes.judge,
    rivalSpots: [new THREE.Vector3(-4.4, 0, 3.85), new THREE.Vector3(-3.0, 0, 3.85), new THREE.Vector3(-1.6, 0, 3.85)],
    statueSpots: [new THREE.Vector3(2.5, 0, -1.2), new THREE.Vector3(-3.7, 0, -1.35), new THREE.Vector3(1.9, 0, 1.4)],
    door: { left: doorL, right: doorR, pos: new THREE.Vector3(6, 0, 2.5) },
    lights: { fluoro, tubes, pass: passLight },
    waypoints,
    update(t: number, dread: number) {
      fluoro.forEach((l, i) => {
        let on = 1;
        const s = Math.sin(t * (7 + i * 3.1)) * Math.sin(t * (1.3 + i));
        if (s > 0.97 - dread * 0.25) on = 0.12;
        // Old wiring: a gentle brownout wobble on top of the stutters.
        const wob = 0.93 + 0.07 * Math.sin(t * (2.1 + i * 0.7));
        l.intensity = (16 - dread * 7) * on * wob;
        (tubes[i].material as THREE.MeshBasicMaterial).color.setRGB(1, 0.94, 0.78).multiplyScalar(0.3 + 0.7 * on);
      });
      passLight.intensity = 3.6 + Math.sin(t * 3) * 0.15;
      chandelier.intensity = (9 - dread * 4) * (0.92 + 0.08 * Math.sin(t * 5.3) * Math.sin(t * 1.7));
      diningCandles.forEach((c, i) => (c.scale.y = 1.6 + Math.sin(t * 9 + i * 2.3) * 0.25));
      diningFlame.color.setRGB(1, 0.85 + Math.sin(t * 7) * 0.03, 0.56);
      for (const m of skyMats) m.uniforms.uTime.value = Math.max(windowT, t);
      ovenRig.refreshTimer();
    },
  };
}

// Set while building the dining room; read by update().
let diningCandles: THREE.Mesh[] = [];
let diningFlame: THREE.MeshBasicMaterial = basic(0xffd890);
