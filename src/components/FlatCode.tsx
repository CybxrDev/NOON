import type { Matrix } from "@/lib/qr";
import type { Theme } from "@/lib/themes";

/** Plain fallback for browsers without WebGL. */
export function FlatCode({ matrix, theme }: { matrix: Matrix; theme: Theme }) {
  const n = matrix.size;
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (matrix.dark[r * n + c]) d += `M${c + 4} ${r + 4}h1v1h-1z`;
  return (
    <svg className="flat" viewBox={`0 0 ${n + 8} ${n + 8}`} role="img" aria-label="QR code" shapeRendering="crispEdges">
      <rect width={n + 8} height={n + 8} fill={theme.scanLight[0]} />
      <path d={d} fill={theme.scanDark[0]} />
    </svg>
  );
}
