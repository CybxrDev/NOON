import type { ShapeId } from "@/lib/shapes";
import type { Theme } from "@/lib/themes";

interface Block {
  x: number;
  z: number;
  y: number;
  h: number;
  tone: number;
  wood?: boolean;
}

const C = Math.cos(Math.PI / 6);
/** Rounded so the server and browser print identical paths. */
const f = (v: number) => v.toFixed(2);

function Blocks({ blocks, theme, unit }: { blocks: Block[]; theme: Theme; unit: number }) {
  const p = (x: number, y: number, z: number) => `${f((x - z) * C * unit)},${f((x + z) * 0.5 * unit - y * unit)}`;
  const sorted = [...blocks].sort((a, b) => a.x + a.z - (b.x + b.z) || a.y - b.y);
  return sorted.map((b, i) => {
    const { x, z, y, h } = b;
    const t = y + h;
    const top = b.wood ? theme.wood : theme.top[Math.min(2, Math.floor(b.tone * 3))];
    return (
      <g key={i}>
        <polygon points={[p(x, t, z), p(x + 1, t, z), p(x + 1, t, z + 1), p(x, t, z + 1)].join(" ")} fill={top} />
        <polygon
          points={[p(x, t, z + 1), p(x + 1, t, z + 1), p(x + 1, y, z + 1), p(x, y, z + 1)].join(" ")}
          fill={b.wood ? theme.wood : theme.side[1]}
        />
        <polygon
          points={[p(x + 1, t, z), p(x + 1, t, z + 1), p(x + 1, y, z + 1), p(x + 1, y, z)].join(" ")}
          fill={b.wood ? theme.wood : theme.side[0]}
        />
      </g>
    );
  });
}

const grid = (fn: (x: number, z: number) => Block | null): Block[] =>
  Array.from({ length: 25 }, (_, i) => fn(i % 5, Math.floor(i / 5))).filter((b): b is Block => b !== null);

const GAPS = new Set([3, 6, 11, 18, 21, 14]);
const gap = (x: number, z: number) => GAPS.has(z * 5 + x);

const SHAPE_BLOCKS: Record<ShapeId, Block[]> = {
  tree: [
    { x: 2, z: 2, y: -1.2, h: 2.4, tone: 0, wood: true },
    ...grid((x, z) => (Math.max(Math.abs(x - 2), Math.abs(z - 2)) > 1 ? null : { x, z, y: 1.2, h: 1, tone: 0.2 })),
    ...grid((x, z) => (Math.abs(x - 2) + Math.abs(z - 2) > 1 ? null : { x, z, y: 2.2, h: 1, tone: 0.5 })),
    { x: 2, z: 2, y: 3.2, h: 1, tone: 0.9 },
  ],
  city: grid((x, z) => {
    if (gap(x, z)) return null;
    const h = [0.8, 2.2, 1.2, 3.2, 1.6, 4.4, 0.9, 2.8][(x * 3 + z * 5) % 8];
    return { x, z, y: 0, h, tone: h / 5 };
  }),
  mesa: grid((x, z) => {
    const d = Math.max(Math.abs(x - 1.6), Math.abs(z - 1.6));
    const h = d < 1 ? 3 : d < 2 ? 1.8 : 0.6;
    return { x, z, y: 0, h, tone: h / 3.2 };
  }),
  wave: grid((x, z) => {
    const h = 1.5 + Math.sin(x * 1.15 + z * 0.7) * 1.1;
    return { x, z, y: 0, h, tone: (h - 0.4) / 2.4 };
  }),
  spiral: grid((x, z) => {
    const ring = Math.max(Math.abs(x - 2), Math.abs(z - 2));
    const a = ((Math.atan2(z - 2, x - 2) + Math.PI * 2.75) % (Math.PI * 2)) / (Math.PI * 2);
    const h = ring === 0 ? 4.2 : (2 - ring) * 1.7 + a * 1.7 + 0.4;
    return { x, z, y: 0, h, tone: Math.min(0.99, h / 4.2) };
  }),
  scatter: grid((x, z) => {
    if ((x + z) % 2) return null;
    const y = [0.2, 2.6, 1.1, 3.4, 1.9, 0.6][(x * 2 + z * 3) % 6];
    return { x, z, y, h: 0.9, tone: y / 3.5 };
  }),
};

export function ShapeArt({ shape, theme }: { shape: ShapeId; theme: Theme }) {
  return (
    <svg viewBox="-34 -38 68 70" aria-hidden="true">
      <Blocks blocks={SHAPE_BLOCKS[shape]} theme={theme} unit={6.4} />
    </svg>
  );
}

const SWATCH: Block[] = [
  { x: 0, z: 0, y: 0, h: 2.2, tone: 0.9 },
  { x: 1, z: 0, y: 0, h: 1.2, tone: 0.5 },
  { x: 0, z: 1, y: 0, h: 1.5, tone: 0.5 },
  { x: 1, z: 1, y: 0, h: 0.6, tone: 0.1 },
];

export function ThemeArt({ theme }: { theme: Theme }) {
  const id = `sky-${theme.id}`;
  return (
    <svg viewBox="-34 -27 68 48" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor={theme.sky[0]} />
          <stop offset="1" stopColor={theme.sky[1]} />
        </linearGradient>
      </defs>
      <rect x="-60" y="-40" width="120" height="90" fill={`url(#${id})`} />
      <polygon points="0,-9 26,6 0,21 -26,6" fill={theme.slab} />
      <Blocks blocks={SWATCH} theme={theme} unit={9.5} />
    </svg>
  );
}
