import jsQR from "jsqr";

/** Reads a QR code out of an image file the person already has. */
export async function readFile(file: Blob): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  for (const longest of [1000, 600, 1600]) {
    const k = Math.min(1, longest / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * k));
    canvas.height = Math.max(1, Math.round(bitmap.height * k));
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const hit = jsQR(data, canvas.width, canvas.height);
    if (hit) return hit.data;
  }
  return null;
}
