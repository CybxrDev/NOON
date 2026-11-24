import { finderPart, type Matrix } from "./qr";

export type ShapeId = "tree" | "city" | "mesa" | "wave" | "spiral" | "scatter";

export const SHAPES: { id: ShapeId; name: string }[] = [
  { id: "tree", name: "Tree" },
  { id: "city", name: "City" },
  { id: "mesa", name: "Mesa" },
  { id: "wave", name: "Wave" },
  { id: "spiral", name: "Spiral" },
  { id: "scatter", name: "Scatter" },
];

/** Matches the branches in the block shader (see stage.ts). */
export const KIND = { leaf: 0, wood: 1, tower: 2, strata: 3, wave: 4, shard: 5, step: 6 } as const;

/**
 * second: wears the theme's second colour. filler: hidden beneath another block.
 * light: stands over a light module, so it must look light from above.
 */
export const LAYER = { second: -1, primary: 0, filler: 1, light: 2 } as const;

export interface Sculpture {
  count: number;
  size: number;
  /** Tallest point, used for framing and gradients. */
  top: number;
  pos: Float32Array;
  dim: Float32Array;
  /** random, random, grow delay, layer */
  rand: Float32Array;
  /** kind, tone, sway, spin */
  meta: Float32Array;
  /** Per-cell height of whatever stands on the ground, for contact shading. */
  ground: Float32Array;
}

type Rng = () => number;

function mulberry(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x: number, y: number, seed: number) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Smooth value noise, 0..1. */
function noise(x: number, y: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = smooth(x - xi);
  const v = smooth(y - yi);
  return mix(
    mix(hash2(xi, yi, seed), hash2(xi + 1, yi, seed), u),
    mix(hash2(xi, yi + 1, seed), hash2(xi + 1, yi + 1, seed), u),
    v,
  );
}

const fbm = (x: number, y: number, seed: number) =>
  noise(x, y, seed) * 0.6 + noise(x * 2.1, y * 2.1, seed + 7) * 0.28 + noise(x * 4.3, y * 4.3, seed + 19) * 0.12;

interface Piece {
  x: number;
  z: number;
  /** Underside. */
  y: number;
  w?: number;
  h: number;
  kind: number;
  tone: number;
  sway?: number;
  spin?: number;
  delay?: number;
  layer?: number;
}

class Builder {
  private pos: number[] = [];
  private dim: number[] = [];
  private rand: number[] = [];
  private meta: number[] = [];
  readonly ground: Float32Array;
  top = 1;

  constructor(
    readonly n: number,
    readonly rng: Rng,
  ) {
    this.ground = new Float32Array(n * n);
  }

  add(p: Piece) {
    const w = p.w ?? 1;
    this.pos.push(p.x, p.y + p.h / 2, p.z);
    this.dim.push(w, p.h, w);
    this.rand.push(this.rng(), this.rng(), clamp(p.delay ?? 0), p.layer ?? this.layerAt(p.x, p.z));
    this.meta.push(p.kind, clamp(p.tone), p.sway ?? 0, p.spin ?? 0);
    this.top = Math.max(this.top, p.y + p.h);
    if (p.y < 0.01) {
      const half = (this.n - 1) / 2;
      const i = Math.round(p.z + half) * this.n + Math.round(p.x + half);
      if (i >= 0 && i < this.ground.length) this.ground[i] = Math.max(this.ground[i], p.h);
    }
  }

  /** Finder patterns take the second colour in every shape. */
  private layerAt(x: number, z: number) {
    const half = (this.n - 1) / 2;
    return finderPart(this.n, z + half, x + half) ? LAYER.second : LAYER.primary;
  }

  done(): Sculpture {
    return {
      count: this.pos.length / 3,
      size: this.n,
      top: this.top,
      pos: Float32Array.from(this.pos),
      dim: Float32Array.from(this.dim),
      rand: Float32Array.from(this.rand),
      meta: Float32Array.from(this.meta),
      ground: this.ground,
    };
  }
}

interface Cell {
  r: number;
  c: number;
  x: number;
  z: number;
  /** Distance from the centre; 1 reaches the middle of an edge. */
  d: number;
  finder: "ring" | "core" | null;
}

function darkCells(m: Matrix): Cell[] {
  const n = m.size;
  const half = (n - 1) / 2;
  const out: Cell[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!m.dark[r * n + c]) continue;
      const x = c - half;
      const z = r - half;
      out.push({ r, c, x, z, d: Math.hypot(x, z) / (n / 2), finder: finderPart(n, r, c) });
    }
  }
  return out;
}

const radial = (cell: Cell, rng: Rng) => (cell.d / 1.42) * 0.75 + rng() * 0.25;

/* ---------------------------------------------------------------- shapes */

function tree(m: Matrix, b: Builder) {
  const { n, rng } = b;
  const half = (n - 1) / 2;
  const spin = rng() * Math.PI * 2;

  // Cloud-pruned: foliage sits in separate pads at different heights.
  const pads = [
    { a: 0, dist: 0.04, y: 0.72, r: 0.27 },
    { a: 0.3, dist: 0.31, y: 0.56, r: 0.25 },
    { a: 1.55, dist: 0.32, y: 0.46, r: 0.25 },
    { a: 2.9, dist: 0.31, y: 0.6, r: 0.24 },
    { a: 4.1, dist: 0.33, y: 0.42, r: 0.25 },
    { a: 5.25, dist: 0.31, y: 0.5, r: 0.23 },
  ].map((p) => {
    const a = p.a + spin + (rng() - 0.5) * 0.35;
    return {
      x: Math.cos(a) * p.dist * n,
      z: Math.sin(a) * p.dist * n,
      y: (p.y + (rng() - 0.5) * 0.04) * n,
      r: (p.r + (rng() - 0.5) * 0.02) * n,
    };
  });
  const thick = 0.095 * n;

  for (const cell of darkCells(m)) {
    if (cell.finder) {
      // Finder patterns become clipped hedges at the garden's corners.
      const h = cell.finder === "core" ? 0.1 * n : 0.05 * n;
      b.add({
        x: cell.x,
        z: cell.z,
        y: 0,
        h: h + rng() * 0.12,
        kind: KIND.leaf,
        tone: cell.finder === "core" ? 0.45 + rng() * 0.3 : 0.15 + rng() * 0.3,
        delay: rng() * 0.25,
      });
      continue;
    }

    let best = pads[0];
    let bestInfluence = -Infinity;
    for (const p of pads) {
      const influence = 1 - Math.hypot(cell.x - p.x, cell.z - p.z) / p.r;
      const weighted = influence + p.y / n / 4;
      if (weighted > bestInfluence) {
        bestInfluence = weighted;
        best = p;
      }
    }
    const dist = Math.hypot(cell.x - best.x, cell.z - best.z) / best.r;

    if (dist > 1.22) {
      const h = 0.35 + noise(cell.x * 0.35, cell.z * 0.35, 5) * 0.045 * n + rng() * 0.3;
      b.add({ x: cell.x, z: cell.z, y: 0, h, kind: KIND.leaf, tone: rng() * 0.6, delay: rng() * 0.3, layer: LAYER.second });
      continue;
    }

    const dome = Math.sqrt(Math.max(0, 1 - Math.min(1, dist) ** 2));
    const droop = Math.max(0, dist - 1) * best.r * 0.5;
    const lump = (noise(cell.x * 0.55 + 9, cell.z * 0.55, 3) - 0.5) * 0.06 * n;
    const upper = best.y + thick * 1.25 * dome - droop + lump;
    const lower = best.y - thick * (0.25 + 0.5 * dome) - droop;
    const delay = 0.35 + (best.y / n) * 0.35 + dist * 0.15 + rng() * 0.15;

    b.add({
      x: cell.x,
      z: cell.z,
      y: upper - 1,
      h: 1,
      kind: KIND.leaf,
      tone: 0.3 + dome * 0.35 + rng() * 0.35,
      sway: 0.4 + rng() * 0.6,
      spin: (rng() - 0.5) * 1.5,
      delay,
    });
    for (let y = upper - 2; y > lower - 0.5; y -= 1) {
      if (rng() < 0.16) continue;
      b.add({
        x: cell.x,
        z: cell.z,
        y: y + (rng() - 0.5) * 0.4,
        h: 1,
        kind: KIND.leaf,
        tone: rng() * 0.5,
        sway: 0.4 + rng() * 0.6,
        spin: (rng() - 0.5) * 1.8,
        delay,
        layer: LAYER.filler,
      });
    }
  }

  // Trunk and branches, rasterised to the module grid. A piece standing over a
  // light module is tagged so that its top face stays light when lined up.
  const seen = new Set<string>();
  const wood = (wx: number, wy: number, wz: number) => {
    const x = Math.round(wx);
    const y = Math.round(wy);
    const z = Math.round(wz);
    const c = x + half;
    const r = z + half;
    if (y < 0 || c < 0 || r < 0 || c >= n || r >= n) return;
    const key = `${x},${y},${z}`;
    if (seen.has(key)) return;
    seen.add(key);
    b.add({
      x,
      z,
      y,
      h: 1,
      kind: KIND.wood,
      tone: rng(),
      delay: (y / n) * 0.5,
      layer: m.dark[r * n + c] ? LAYER.filler : LAYER.light,
    });
  };

  const trunkTop = pads[0].y - thick;
  const trunkAt = (y: number) => {
    const t = clamp(y / trunkTop);
    const bend = Math.sin(t * Math.PI * 1.6) * 0.06 * n;
    return {
      x: pads[0].x * t + Math.cos(spin) * bend,
      z: pads[0].z * t + Math.sin(spin) * bend,
      rad: mix(0.07, 0.022, t) * n + Math.max(0, 1 - y / (0.05 * n)) * 0.04 * n,
    };
  };
  for (let y = 0; y <= trunkTop; y++) {
    const t = trunkAt(y);
    const reach = Math.ceil(t.rad);
    for (let dx = -reach; dx <= reach; dx++)
      for (let dz = -reach; dz <= reach; dz++)
        if (Math.hypot(dx, dz) <= t.rad * (0.85 + hash2(dx, dz, y) * 0.3)) wood(t.x + dx, y, t.z + dz);
  }
  for (const p of pads.slice(1)) {
    const from = trunkAt(p.y * 0.52);
    const y0 = p.y * 0.52;
    const y1 = p.y - thick * 0.4;
    const steps = Math.ceil(n * 1.5);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = mix(from.x, p.x, t);
      const z = mix(from.z, p.z, t);
      const y = mix(y0, y1, Math.pow(t, 0.8));
      wood(x, y, z);
      if (t < 0.55 && n > 24) {
        wood(x, y - 1, z);
        wood(x + 1, y, z);
      }
    }
  }
}

function city(m: Matrix, b: Builder, seed: number) {
  const { n, rng } = b;
  const cx = (rng() - 0.5) * 0.24 * n;
  const cz = (rng() - 0.5) * 0.24 * n;
  const lot = 3.6;

  /** The lot a cell belongs to: nearest point of a jittered grid. */
  const lotOf = (x: number, z: number) => {
    const gx = Math.floor(x / lot);
    const gz = Math.floor(z / lot);
    let best = Infinity;
    let hit = { x: 0, z: 0, pick: 0 };
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const px = (gx + dx + 0.15 + 0.7 * hash2(gx + dx, gz + dz, seed)) * lot;
        const pz = (gz + dz + 0.15 + 0.7 * hash2(gx + dx, gz + dz, seed + 5)) * lot;
        const d = Math.max(Math.abs(px - x), Math.abs(pz - z));
        if (d < best) {
          best = d;
          hit = { x: px, z: pz, pick: hash2(gx + dx, gz + dz, seed + 11) };
        }
      }
    }
    return hit;
  };

  for (const cell of darkCells(m)) {
    let h: number;
    let pick = 0.5;
    if (cell.finder) {
      h = cell.finder === "core" ? 0.2 * n : 0.05 * n;
    } else {
      const site = lotOf(cell.x, cell.z);
      pick = site.pick;
      const d = Math.hypot(site.x - cx, site.z - cz) / (n / 2);
      const centre = Math.pow(clamp(1.05 - d * 0.85), 1.8);
      h = 0.045 * n + n * 0.62 * centre * (0.12 + 0.88 * pick * pick) + 0.05 * n * pick;
    }
    const tone = cell.finder ? (cell.finder === "core" ? 0.75 : 0.25) : 0.2 + pick * 0.6;
    const delay = radial(cell, rng);
    b.add({ x: cell.x, z: cell.z, y: 0, h, kind: KIND.tower, tone, delay });
    if (cell.finder) continue;
    if (h > 0.32 * n && rng() < 0.16) {
      b.add({ x: cell.x, z: cell.z, y: h, w: 0.2, h: 0.1 * n, kind: KIND.wood, tone: 0.5, delay, layer: LAYER.filler });
    } else if (rng() < 0.14) {
      b.add({ x: cell.x, z: cell.z, y: h, w: 0.55, h: 0.4, kind: KIND.wood, tone: rng(), delay, layer: LAYER.filler });
    }
  }
}

function mesa(m: Matrix, b: Builder, seed: number) {
  const { n, rng } = b;
  const f = 2.6 / n;
  for (const cell of darkCells(m)) {
    let h: number;
    if (cell.finder) {
      h = cell.finder === "core" ? 0.2 * n : 0.09 * n;
    } else {
      const raw = fbm(cell.x * f + 40, cell.z * f + 11, seed);
      const ridge = 1 - Math.abs(raw * 2 - 1);
      const steps = 5;
      const level = Math.floor(clamp(ridge * 1.15 - 0.2) * steps) / (steps - 1);
      const fall = 1 - Math.pow(clamp(cell.d - 0.35), 1.4) * 0.8;
      h = 0.6 + n * 0.44 * level * fall;
    }
    b.add({
      x: cell.x,
      z: cell.z,
      y: 0,
      h,
      kind: KIND.strata,
      tone: clamp(h / (0.42 * n)) * 0.75 + rng() * 0.25,
      delay: radial(cell, rng),
    });
  }
}

function wave(m: Matrix, b: Builder) {
  const { n, rng } = b;
  for (const cell of darkCells(m)) {
    b.add({
      x: cell.x,
      z: cell.z,
      y: 0,
      h: 0.17 * n * (1 - 0.25 * clamp(cell.d)) + rng() * 0.3,
      kind: KIND.wave,
      tone: rng(),
      delay: radial(cell, rng),
    });
  }
  // The shader lifts crests past the resting height.
  b.top = 0.3 * n;
}

function spiral(m: Matrix, b: Builder) {
  const { n, rng } = b;
  const start = rng() * Math.PI * 2;
  const turns = Math.max(3, Math.round(n / 7));
  for (const cell of darkCells(m)) {
    const a = ((Math.atan2(cell.z, cell.x) + start + Math.PI * 4) % (Math.PI * 2)) / (Math.PI * 2);
    // A ramp that climbs as it winds inwards, one step down to the turn outside it.
    const inward = clamp(1 - cell.d / 1.15) * turns;
    const climb = clamp((Math.floor(inward - a) + a + 1) / (turns + 0.6));
    const h = n * (0.025 + 0.74 * Math.pow(climb, 1.15));
    b.add({
      x: cell.x,
      z: cell.z,
      y: 0,
      h,
      kind: KIND.step,
      tone: climb,
      delay: climb * 0.85 + rng() * 0.05,
    });
  }
}

function scatter(m: Matrix, b: Builder) {
  const { n, rng } = b;
  const R = 0.56 * n;
  const cy = 0.5 * n;
  for (const cell of darkCells(m)) {
    const dist = Math.hypot(cell.x, cell.z);
    let y: number;
    if (dist < R) {
      const reach = Math.sqrt(R * R - dist * dist) * 0.78;
      const u = rng() * 2 - 1;
      y = cy + Math.sign(u) * Math.pow(Math.abs(u), 0.55) * reach;
    } else {
      y = cy + (rng() - 0.5) * 0.16 * n;
    }
    b.add({
      x: cell.x,
      z: cell.z,
      y: Math.max(0.5, y),
      h: 1,
      kind: KIND.shard,
      tone: clamp(y / n) * 0.7 + rng() * 0.3,
      sway: 0.5 + rng() * 0.8,
      spin: (rng() - 0.5) * 5,
      delay: rng() * 0.9,
    });
  }
}

export function sculpt(m: Matrix, shape: ShapeId, seed: number): Sculpture {
  const b = new Builder(m.size, mulberry(seed * 7919 + 13));
  switch (shape) {
    case "tree":
      tree(m, b);
      break;
    case "city":
      city(m, b, seed);
      break;
    case "mesa":
      mesa(m, b, seed);
      break;
    case "wave":
      wave(m, b);
      break;
    case "spiral":
      spiral(m, b);
      break;
    case "scatter":
      scatter(m, b);
      break;
  }
  return b.done();
}
