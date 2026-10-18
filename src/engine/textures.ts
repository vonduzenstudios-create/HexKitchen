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
  /** Dirty basement drywall: two 1.2 m sheets per tile, taped seams, water stains, scuffs. */
  drywall: () =>
    cached('drywall', () =>
      canvasTexture(64, 64, (g, w, h) => {
        const r = rng(41);
        g.fillStyle = '#a8a294';
        g.fillRect(0, 0, w, h);
        // Low-frequency blotchy paint.
        for (let i = 0; i < 60; i++) {
          const v = 150 + r() * 30;
          g.fillStyle = `rgba(${v},${v - 6},${v - 18},0.25)`;
          g.fillRect(Math.floor(r() * w), Math.floor(r() * h), 4 + Math.floor(r() * 10), 3 + Math.floor(r() * 8));
        }
        // Taped seams with screw dimples.
        g.fillStyle = 'rgba(200,196,182,0.6)';
        g.fillRect(31, 0, 3, h);
        g.fillStyle = 'rgba(60,50,35,0.35)';
        g.fillRect(32, 0, 1, h);
        g.fillStyle = 'rgba(70,60,45,0.5)';
        for (let y = 4; y < h; y += 10) {
          g.fillRect(2, y, 1, 1);
          g.fillRect(29, y + 3, 1, 1);
          g.fillRect(36, y, 1, 1);
          g.fillRect(61, y + 3, 1, 1);
        }
        // Water stains bleeding down from the top.
        for (let i = 0; i < 3; i++) {
          const x = Math.floor(r() * w);
          const len = 10 + r() * 30;
          const grad = g.createLinearGradient(0, 0, 0, len);
          grad.addColorStop(0, 'rgba(110,80,40,0.32)');
          grad.addColorStop(1, 'rgba(110,80,40,0)');
          g.fillStyle = grad;
          g.fillRect(x, 0, 3 + Math.floor(r() * 6), len);
        }
        // Grime and mildew along the floor line.
        const base = g.createLinearGradient(0, h, 0, h * 0.55);
        base.addColorStop(0, 'rgba(40,45,25,0.6)');
        base.addColorStop(1, 'rgba(40,45,25,0)');
        g.fillStyle = base;
        g.fillRect(0, 0, w, h);
        speckle(g, w, h, 70, 'rgba(50,40,25,0.35)', 43);
        // Scuffs and a dent.
        g.strokeStyle = 'rgba(40,35,30,0.4)';
        for (let i = 0; i < 4; i++) {
          const x = r() * w;
          const y = h * 0.5 + r() * h * 0.4;
          g.beginPath();
          g.moveTo(x, y);
          g.lineTo(x + 4 + r() * 6, y + (r() - 0.5) * 2);
          g.stroke();
        }
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
  /** Unfinished basement ceiling: subfloor boards between joists. */
  ceiling: () =>
    cached('ceiling', () =>
      canvasTexture(32, 32, (g, w, h) => {
        const r = rng(23);
        for (let x = 0; x < w; x += 8) {
          const v = 70 + r() * 20;
          g.fillStyle = `rgb(${v},${v * 0.8},${v * 0.55})`;
          g.fillRect(x, 0, 8, h);
          g.fillStyle = 'rgba(20,15,10,0.6)';
          g.fillRect(x, 0, 1, h);
        }
        speckle(g, w, h, 40, 'rgba(20,15,10,0.4)', 29);
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
