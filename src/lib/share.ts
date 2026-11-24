import { DEFAULT_CONTENT, LEVELS, payload, type Content, type Level } from "./qr";
import { SHAPES, type ShapeId } from "./shapes";
import { THEMES } from "./themes";

export interface Design {
  content: Content;
  shape: ShapeId;
  theme: string;
  level: Level;
  seed: number;
}

export const DEFAULT_DESIGN: Design = {
  content: DEFAULT_CONTENT,
  shape: "tree",
  theme: "blossom",
  level: "M",
  seed: 1,
};

/** Drops "https://" where the app would put it straight back. */
function shortLink(content: Content): string {
  const full = payload(content);
  const short = full.replace(/^https:\/\//i, "");
  return payload({ ...content, link: short }) === full ? short : full;
}

/** Slashes and colons are legal in a query string, and far easier to read. */
const encodeValue = (v: string) => encodeURIComponent(v).replace(/%2F/g, "/").replace(/%3A/g, ":");

/** For example "?url=example.com&theme=midnight&shape=city". */
export function toQuery(d: Design): string {
  const pairs: [string, string][] = [];
  if (d.content.type === "text") pairs.push(["text", payload(d.content)]);
  else pairs.push(["url", shortLink(d.content)]);
  pairs.push(["theme", d.theme], ["shape", d.shape]);
  if (d.level !== DEFAULT_DESIGN.level)
    pairs.push(["redundancy", String(parseInt(LEVELS.find((l) => l.id === d.level)!.label, 10))]);
  if (d.seed !== DEFAULT_DESIGN.seed) pairs.push(["variant", String(d.seed)]);
  return `?${pairs
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeValue(v)}`)
    .join("&")}`;
}

/** Anything missing or unrecognised falls back to the default design. */
export function fromQuery(search: string): Design {
  const q = new URLSearchParams(search);
  const url = q.get("url");
  const text = q.get("text");
  let content = DEFAULT_CONTENT;
  if (url) content = { ...DEFAULT_CONTENT, link: url };
  else if (text) content = { type: "text", link: "", text };
  const variant = Number(q.get("variant"));
  return {
    content,
    shape: SHAPES.find((s) => s.id === q.get("shape"))?.id ?? DEFAULT_DESIGN.shape,
    theme: THEMES.find((t) => t.id === q.get("theme"))?.id ?? DEFAULT_DESIGN.theme,
    level: LEVELS.find((l) => parseInt(l.label, 10) === Number(q.get("redundancy")))?.id ?? DEFAULT_DESIGN.level,
    seed: Number.isSafeInteger(variant) && variant > 0 ? variant : DEFAULT_DESIGN.seed,
  };
}
