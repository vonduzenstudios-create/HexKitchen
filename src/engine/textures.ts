import * as THREE from 'three';

// All textures are drawn at tiny resolutions with Canvas 2D and sampled with nearest filtering.

type Painter = (g: CanvasRenderingContext2D, w: number, h: number) => void;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function canvasTexture(w: number, h: number, paint: Painter, repeat = 1): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  paint(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  return t;
}

function speckle(g: CanvasRenderingContext2D, w: number, h: number, n: number, color: string, seed: number, size = 1): void {
  const r = rng(seed);
  g.fillStyle = color;
  for (let i = 0; i < n; i++) g.fillRect(Math.floor(r() * w), Math.floor(r() * h), size, size);
}

const cache = new Map<string, THREE.CanvasTexture>();
function cached(key: string, make: () => THREE.CanvasTexture): THREE.CanvasTexture {
  let t = cache.get(key);
  if (!t) {
    t = make();
    cache.set(key, t);
  }
  return t;
}

export const tex = {
  /** Black and white checker floor with grime. */
  floor: () =>
    cached('floor', () =>
      canvasTexture(64, 64, (g, w, h) => {
        const s = 16;
        for (let y = 0; y < h; y += s)
          for (let x = 0; x < w; x += s) {
            g.fillStyle = ((x + y) / s) % 2 === 0 ? '#d8d2c0' : '#2a2626';
            g.fillRect(x, y, s, s);
          }
        speckle(g, w, h, 160, 'rgba(60,40,20,0.35)', 3);
        speckle(g, w, h, 40, 'rgba(120,20,10,0.25)', 7, 2);
        g.strokeStyle = 'rgba(0,0,0,0.3)';
        for (let i = 0; i <= w; i += s) {
          g.beginPath();
          g.moveTo(i, 0);
          g.lineTo(i, h);
          g.moveTo(0, i);
          g.lineTo(w, i);
          g.stroke();
        }
      }),
    ),
  /** Off-white subway tile walls with dirty grout. */
  wallTile: () =>
    cached('wall', () =>
      canvasTexture(64, 64, (g, w, h) => {
        g.fillStyle = '#5e5a4c';
        g.fillRect(0, 0, w, h);
        for (let row = 0; row < 8; row++) {
          const off = row % 2 ? 8 : 0;
          for (let x = -16; x < w; x += 16) {
            const r = rng(row * 31 + x)();
            g.fillStyle = `rgb(${200 + r * 20},${196 + r * 18},${176 + r * 10})`;
            g.fillRect(x + off + 1, row * 8 + 1, 14, 6);
          }
        }
        speckle(g, w, h, 90, 'rgba(70,50,20,0.3)', 11);
        const grad = g.createLinearGradient(0, h, 0, h * 0.6);
        grad.addColorStop(0, 'rgba(40,30,10,0.45)');
        grad.addColorStop(1, 'rgba(40,30,10,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, w, h);
      }),
    ),
  /** Brushed stainless steel. */
  steel: () =>
    cached('steel', () =>
      canvasTexture(32, 32, (g, w, h) => {
        const r = rng(5);
        for (let y = 0; y < h; y++) {
          const v = 150 + r() * 40;
          g.fillStyle = `rgb(${v},${v + 3},${v + 8})`;
          g.fillRect(0, y, w, 1);
        }
        speckle(g, w, h, 20, 'rgba(255,255,255,0.4)', 9);
        speckle(g, w, h, 14, 'rgba(40,30,20,0.35)', 13);
      }),
    ),
  /** Butcher-block wood. */
  wood: () =>
    cached('wood', () =>
      canvasTexture(32, 32, (g, w, h) => {
        const r = rng(21);
        for (let x = 0; x < w; x += 4) {
          const v = r() * 30;
          g.fillStyle = `rgb(${150 + v},${100 + v * 0.7},${55 + v * 0.4})`;
          g.fillRect(x, 0, 4, h);
        }
        g.strokeStyle = 'rgba(70,40,20,0.5)';
        for (let i = 0; i < 6; i++) {
          g.beginPath();
          const y = r() * h;
          g.moveTo(0, y);
          g.lineTo(w, y + (r() - 0.5) * 6);
          g.stroke();
        }
      }),
    ),
  /** Dark metal grate / stove top. */
  stoveTop: () =>
    cached('stove', () =>
      canvasTexture(32, 32, (g, w, h) => {
        g.fillStyle = '#1c1c1e';
        g.fillRect(0, 0, w, h);
        g.strokeStyle = '#444';
        g.lineWidth = 2;
        for (let i = 4; i < w; i += 8) {
          g.beginPath();
          g.moveTo(i, 0);
          g.lineTo(i, h);
          g.stroke();
        }
        speckle(g, w, h, 30, 'rgba(120,60,10,0.5)', 17);
      }),
    ),
  /** Stone for statues and petrification. */
  stone: () =>
    cached('stone', () =>
      canvasTexture(64, 64, (g, w, h) => {
        const r = rng(77);
        for (let y = 0; y < h; y += 2)
          for (let x = 0; x < w; x += 2) {
            const v = 120 + r() * 50;
            g.fillStyle = `rgb(${v},${v - 4},${v - 10})`;
            g.fillRect(x, y, 2, 2);
          }
        g.strokeStyle = 'rgba(30,25,20,0.8)';
        for (let i = 0; i < 7; i++) {
          g.beginPath();
          let x = r() * w;
          let y = r() * h;
          g.moveTo(x, y);
          for (let k = 0; k < 5; k++) {
            x += (r() - 0.5) * 18;
            y += (r() - 0.5) * 18;
            g.lineTo(x, y);
          }
          g.stroke();
        }
      }),
    ),
  /** Fluorescent ceiling panels. */
  ceiling: () =>
    cached('ceiling', () =>
      canvasTexture(32, 32, (g, w, h) => {
        g.fillStyle = '#3a3830';
        g.fillRect(0, 0, w, h);
        g.strokeStyle = '#24221d';
        g.strokeRect(0.5, 0.5, w - 1, h - 1);
        speckle(g, w, h, 40, 'rgba(90,70,30,0.4)', 23);
      }),
    ),
  /** Lettering on a sign. Not cached. */
  sign: (text: string, fg = '#ffd23a', bg = '#7a0c0c', w = 128, h = 32) =>
    canvasTexture(w, h, (g) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      g.fillStyle = fg;
      g.font = `bold ${Math.floor(h * 0.62)}px Georgia, serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, w / 2, h / 2 + 1);
      g.strokeStyle = fg;
      g.strokeRect(1.5, 1.5, w - 3, h - 3);
    }),
  /** Food surface noise: blotches of a darker shade over a base. */
  food: (base: string, blotch: string, seed: number) =>
    cached(`food-${base}-${blotch}-${seed}`, () =>
      canvasTexture(16, 16, (g, w, h) => {
        g.fillStyle = base;
        g.fillRect(0, 0, w, h);
        speckle(g, w, h, 26, blotch, seed);
        speckle(g, w, h, 6, 'rgba(255,255,255,0.25)', seed + 1);
      }),
    ),
};
