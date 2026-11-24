import QRCode from "qrcode";

export type Level = "L" | "M" | "Q" | "H";

export interface Matrix {
  size: number;
  /** Row-major, 1 = dark module. */
  dark: Uint8Array;
  version: number;
  text: string;
}

/** Beyond this the modules get too small to scan comfortably off a screen. */
export const MAX_VERSION = 16;

export const LEVELS: { id: Level; label: string }[] = [
  { id: "L", label: "7%" },
  { id: "M", label: "15%" },
  { id: "Q", label: "25%" },
  { id: "H", label: "30%" },
];

export type ContentType = "link" | "text";

export interface Content {
  type: ContentType;
  link: string;
  text: string;
}

export const DEFAULT_CONTENT: Content = {
  type: "link",
  link: "https://example.com/noon",
  text: "",
};

/** "mailto:" and the like count as a scheme; the port in "host:8080" does not. */
const SCHEME = /^(?:tel|sms):|^[a-z][a-z0-9+.-]*:(?!\d{1,5}(?:[/?#]|$))/i;

/** The exact string stored in the code, or "" when the field is still empty. */
export function payload(c: Content): string {
  if (c.type === "text") return c.text.trim();
  const link = c.link.trim();
  if (!link) return "";
  return SCHEME.test(link) ? link : `https://${link}`;
}

export type EncodeResult = { ok: true; matrix: Matrix } | { ok: false; reason: "empty" | "too-long" };

export function encode(text: string, level: Level): EncodeResult {
  if (!text) return { ok: false, reason: "empty" };
  try {
    const qr = QRCode.create(text, { errorCorrectionLevel: level });
    if (qr.version > MAX_VERSION) return { ok: false, reason: "too-long" };
    return {
      ok: true,
      matrix: {
        size: qr.modules.size,
        dark: Uint8Array.from(qr.modules.data, (v) => (v ? 1 : 0)),
        version: qr.version,
        text,
      },
    };
  } catch {
    return { ok: false, reason: "too-long" };
  }
}

/** Which part of a finder pattern (the three corner squares) a module belongs to. */
export function finderPart(n: number, r: number, c: number): "ring" | "core" | null {
  const corners = [
    [0, 0],
    [0, n - 7],
    [n - 7, 0],
  ];
  for (const [r0, c0] of corners) {
    const y = r - r0;
    const x = c - c0;
    if (y < 0 || x < 0 || y > 6 || x > 6) continue;
    if (y >= 2 && y <= 4 && x >= 2 && x <= 4) return "core";
    return "ring";
  }
  return null;
}
