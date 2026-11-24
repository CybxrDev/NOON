# Noon

A 3D QR code generator. Every dark module becomes a block in a sculpture. Seen from
straight above with parallel projection, height disappears and the blocks line up
into a working QR code.

```bash
npm install
npm run dev
```

## How it fits together

- `src/lib/qr.ts` builds the text payload (link or plain text) and the module grid.
- `src/lib/shapes.ts` turns the grid into blocks. Each block stays inside its module's
  footprint, which is what keeps every shape scannable.
- `src/lib/themes.ts` holds the palettes. `scanDark`, `scanSecond` and `scanLight` colour
  the lined-up view. When adding a theme, keep every dark tone under half the brightness
  (0.299 R + 0.587 G + 0.114 B) of every light tone.
- `src/lib/stage.ts` and `shaders.ts` render it. The time of day drives both the sun and
  the camera; at noon the camera is overhead and the perspective is flattened.
- `src/lib/read-image.ts` reads the code out of an imported image.
- `src/lib/share.ts` turns a design into a link and back. `url` or `text`, then `theme`
  and `shape`; `redundancy` and `variant` appear only when changed. For example
  `/?url=example.com&theme=midnight&shape=city`.
