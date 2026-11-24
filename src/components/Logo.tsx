/** NOON set on a module grid; the two Os are finder patterns. */
const ROWS = [
  "1000100111111100111111100100010",
  "1100100100000100100000100110010",
  "1010100101110100101110100101010",
  "1001100101110100101110100100110",
  "1000100101110100101110100100010",
  "1000100100000100100000100100010",
  "1000100111111100111111100100010",
];

export function Logo({ className }: { className?: string }) {
  const width = ROWS[0].length - 1;
  let d = "";
  ROWS.forEach((row, y) => {
    [...row].forEach((v, x) => {
      if (v === "1") d += `M${x} ${y}h1v1h-1z`;
    });
  });
  return (
    <svg className={className} viewBox={`0 0 ${width} ${ROWS.length}`} role="img" aria-label="Noon" shapeRendering="crispEdges">
      <path d={d} fill="currentColor" />
    </svg>
  );
}
