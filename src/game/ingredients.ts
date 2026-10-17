import * as THREE from 'three';
import { mat } from '../engine/psx';
import { tex } from '../engine/textures';

export type IngredientKind = 'lettuce' | 'bread' | 'tomato' | 'potato' | 'pasta' | 'steak' | 'beef' | 'mushroom' | 'greens';

export interface IngredientDef {
  name: string;
  choppedName: string;
  raw: number;
  cooked: number;
  /** Builds the whole ingredient. Meshes flagged userData.tint get recoloured as it cooks. */
  whole: () => THREE.Group;
  chopped: () => THREE.Group;
}

function tinted(geo: THREE.BufferGeometry, color: number, map?: THREE.Texture): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat(color, { map }));
  m.userData.tint = true;
  return m;
}

function fixed(geo: THREE.BufferGeometry, color: number): THREE.Mesh {
  return new THREE.Mesh(geo, mat(color));
}

function scatter(n: number, make: (i: number) => THREE.Object3D, spread = 0.06, seed = 1): THREE.Group {
  const g = new THREE.Group();
  let s = seed;
  const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < n; i++) {
    const o = make(i);
    o.position.set((r() - 0.5) * spread * 2, o.position.y, (r() - 0.5) * spread * 2);
    o.rotation.y = r() * Math.PI;
    g.add(o);
  }
  return g;
}

export const INGREDIENTS: Record<IngredientKind, IngredientDef> = {
  lettuce: {
    name: 'Lettuce',
    choppedName: 'Chopped Lettuce',
    raw: 0x6fbf3a,
    cooked: 0x4a7a24,
    whole: () => {
      const g = new THREE.Group();
      const head = tinted(new THREE.IcosahedronGeometry(0.085, 0), 0x6fbf3a, tex.food('#6fbf3a', '#4c9a2a', 3));
      head.scale.set(1, 0.8, 1);
      head.position.y = 0.068;
      g.add(head);
      return g;
    },
    chopped: () =>
      scatter(7, () => {
        const m = tinted(new THREE.BoxGeometry(0.06, 0.012, 0.045), 0x6fbf3a);
        m.position.y = 0.01;
        return m;
      }, 0.07, 4),
  },
  bread: {
    name: 'Bread',
    choppedName: 'Croutons',
    raw: 0xd9a75a,
    cooked: 0xa86a2a,
    whole: () => {
      const g = new THREE.Group();
      const loaf = tinted(new THREE.BoxGeometry(0.2, 0.08, 0.1), 0xd9a75a, tex.food('#d9a75a', '#b27a35', 5));
      loaf.position.y = 0.04;
      g.add(loaf);
      return g;
    },
    chopped: () =>
      scatter(8, () => {
        const m = tinted(new THREE.BoxGeometry(0.03, 0.03, 0.03), 0xd9a75a);
        m.position.y = 0.015;
        return m;
      }, 0.06, 6),
  },
  tomato: {
    name: 'Tomato',
    choppedName: 'Diced Tomato',
    raw: 0xd8281c,
    cooked: 0x9a1a10,
    whole: () => {
      const g = new THREE.Group();
      const t = tinted(new THREE.IcosahedronGeometry(0.055, 1), 0xd8281c);
      t.scale.set(1, 0.85, 1);
      t.position.y = 0.047;
      const stem = fixed(new THREE.ConeGeometry(0.02, 0.02, 5), 0x2c6a1a);
      stem.position.y = 0.095;
      g.add(t, stem);
      return g;
    },
    chopped: () =>
      scatter(6, () => {
        const m = tinted(new THREE.TetrahedronGeometry(0.025), 0xd8281c);
        m.position.y = 0.015;
        return m;
      }, 0.05, 7),
  },
  potato: {
    name: 'Potato',
    choppedName: 'Raw Fries',
    raw: 0xb08a50,
    cooked: 0xe0b040,
    whole: () => {
      const g = new THREE.Group();
      const p = tinted(new THREE.DodecahedronGeometry(0.06, 0), 0xb08a50, tex.food('#b08a50', '#7d6030', 9));
      p.scale.set(1.3, 0.8, 0.9);
      p.position.y = 0.048;
      g.add(p);
      return g;
    },
    chopped: () =>
      scatter(9, () => {
        const m = tinted(new THREE.BoxGeometry(0.014, 0.014, 0.09), 0xf0dc9a);
        m.position.y = 0.01;
        return m;
      }, 0.05, 8),
  },
  pasta: {
    name: 'Dry Spaghetti',
    choppedName: 'Snapped Spaghetti',
    raw: 0xf0d878,
    cooked: 0xf6e8b0,
    whole: () => {
      const g = new THREE.Group();
      for (let i = 0; i < 7; i++) {
        const s = tinted(new THREE.CylinderGeometry(0.004, 0.004, 0.26, 3), 0xf0d878);
        s.rotation.z = Math.PI / 2;
        s.position.set(0, 0.012 + (i % 3) * 0.008, (i - 3) * 0.008);
        g.add(s);
      }
      return g;
    },
    chopped: () =>
      scatter(10, () => {
        const s = tinted(new THREE.CylinderGeometry(0.004, 0.004, 0.08, 3), 0xf0d878);
        s.rotation.z = Math.PI / 2;
        s.position.y = 0.008;
        return s;
      }, 0.05, 9),
  },
  steak: {
    name: 'Steak',
    choppedName: 'Sliced Steak',
    raw: 0xc0303a,
    cooked: 0x6a3a1c,
    whole: () => {
      const g = new THREE.Group();
      const s = tinted(new THREE.CylinderGeometry(0.09, 0.085, 0.03, 8), 0xc0303a, tex.food('#c0303a', '#e8b0b0', 11));
      s.scale.set(1.25, 1, 0.9);
      s.position.y = 0.015;
      g.add(s);
      return g;
    },
    chopped: () =>
      scatter(5, () => {
        const m = tinted(new THREE.BoxGeometry(0.03, 0.03, 0.12), 0xc0303a);
        m.position.y = 0.015;
        return m;
      }, 0.05, 10),
  },
  beef: {
    name: 'Beef Fillet',
    choppedName: 'Beef Medallions',
    raw: 0xb8283a,
    cooked: 0x7a4020,
    whole: () => {
      const g = new THREE.Group();
      const s = tinted(new THREE.CylinderGeometry(0.055, 0.055, 0.2, 8), 0xb8283a, tex.food('#b8283a', '#d07070', 13));
      s.rotation.z = Math.PI / 2;
      s.position.y = 0.055;
      g.add(s);
      return g;
    },
    chopped: () =>
      scatter(5, () => {
        const m = tinted(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 7), 0xb8283a);
        m.position.y = 0.015;
        return m;
      }, 0.06, 11),
  },
  mushroom: {
    name: 'Mushroom',
    choppedName: 'Duxelles',
    raw: 0xc8b8a0,
    cooked: 0x6a5038,
    whole: () => {
      const g = new THREE.Group();
      const cap = tinted(new THREE.SphereGeometry(0.06, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2), 0x9a7a5a);
      cap.position.y = 0.05;
      const stem = tinted(new THREE.CylinderGeometry(0.022, 0.026, 0.055, 6), 0xd8ccb8);
      stem.position.y = 0.027;
      g.add(cap, stem);
      return g;
    },
    chopped: () =>
      scatter(9, () => {
        const m = tinted(new THREE.BoxGeometry(0.02, 0.012, 0.02), 0x8a6a4a);
        m.position.y = 0.008;
        return m;
      }, 0.05, 12),
  },
  greens: {
    name: 'Green Beans',
    choppedName: 'Snipped Beans',
    raw: 0x3a9a2a,
    cooked: 0x2f7f22,
    whole: () => {
      const g = new THREE.Group();
      for (let i = 0; i < 6; i++) {
        const b = tinted(new THREE.CylinderGeometry(0.008, 0.008, 0.13, 4), 0x3a9a2a);
        b.rotation.z = Math.PI / 2;
        b.rotation.y = (i - 2.5) * 0.12;
        b.position.set(0, 0.01 + (i % 2) * 0.012, (i - 2.5) * 0.012);
        g.add(b);
      }
      return g;
    },
    chopped: () =>
      scatter(10, () => {
        const b = tinted(new THREE.CylinderGeometry(0.008, 0.008, 0.04, 4), 0x3a9a2a);
        b.rotation.z = Math.PI / 2;
        b.position.y = 0.008;
        return b;
      }, 0.05, 13),
  },
};

export const ingredientMeshFactories = Object.fromEntries(
  (Object.keys(INGREDIENTS) as IngredientKind[]).map((k) => [k, () => INGREDIENTS[k].whole()]),
) as unknown as Record<IngredientKind, () => THREE.Object3D>;
