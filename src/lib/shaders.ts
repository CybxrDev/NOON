/** Shared by the colour and shadow passes so both agree on where blocks are. */
export const BLOCK_VERTEX_HEAD = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aDim;
attribute vec4 aRand;
attribute vec4 aMeta;
uniform float uTime;
uniform float uAlign;
uniform float uGrow;
uniform float uTop;
uniform float uN;
varying vec3 vLoc;
varying vec3 vDim;
varying vec3 vObjN;
varying vec4 vRand;
varying vec4 vMeta;
varying float vY;
varying vec2 vCell;
varying float vTone;

float growEase(float x) {
  x -= 1.0;
  return 1.0 + 2.15 * x * x * x + 1.15 * x * x;
}

void placeBlock(inout vec3 p, inout vec3 n) {
  float kind = aMeta.x;
  float loose = 1.0 - uAlign;
  float g = growEase(clamp(uGrow * 2.0 - aRand.z, 0.0, 1.0));
  vec3 dim = aDim;
  vec3 c = aPos;
  vTone = aMeta.y;
  vObjN = n;

  bool floating = kind < 0.5 ? aMeta.z > 0.0 : (kind > 4.5 && kind < 5.5);
  if (kind > 3.5 && kind < 4.5) {
    float w = sin(aPos.x * 0.34 * 29.0 / uN + uTime * 0.9) * 0.45
            + sin(aPos.z * 0.29 * 29.0 / uN - uTime * 0.7 + aPos.x * 0.12) * 0.4
            + sin((aPos.x + aPos.z) * 0.21 * 29.0 / uN + uTime * 1.3) * 0.15;
    dim.y *= 1.0 + 0.78 * w;
    c.y = dim.y * 0.5;
    vTone = clamp(0.5 + 0.55 * w, 0.0, 1.0);
  }

  // Filler never shows from above, so it can fold away as the piece flattens.
  float keep = aRand.w > 0.5 ? g : 1.0;
  dim.y = max(dim.y * (floating ? mix(0.12, 1.0, g) : g), 0.1 * keep);
  c.y = floating ? max(c.y * g, dim.y * 0.5) : (c.y - aDim.y * 0.5) * g + dim.y * 0.5;
  if (kind > 3.5 && kind < 4.5) c.y = dim.y * 0.5;
  dim.xz *= max(keep, 0.001);

  // Loose blocks vary in size. Lined-up blocks fill their module, with a hair
  // of overlap so no light shows through the seams between dark neighbours.
  float vary = floating ? 0.82 + aRand.x * 0.36 : (kind > 1.5 && aDim.x > 0.9 ? 0.94 : 1.0);
  float fill = aRand.w > 1.5 || aDim.x < 0.9 ? 1.0 : mix(1.0, 1.03, uAlign);
  dim.xz *= mix(fill, vary, loose * g);

  p = sign(p) * max(dim * 0.5 - (0.5 - abs(p)) * min(vec3(1.0), dim / 0.16), vec3(0.0));
  vLoc = p;
  vDim = dim;

  float spin = aMeta.w * loose * g;
  if (kind > 4.5 && kind < 5.5) spin += sin(uTime * 0.5 + aRand.x * 6.28) * 0.25 * aMeta.w * loose * g;
  float cs = cos(spin), sn = sin(spin);
  mat2 ry = mat2(cs, sn, -sn, cs);
  float tilt = spin * 0.45;
  float ct = cos(tilt), st = sin(tilt);
  mat2 rx = mat2(ct, st, -st, ct);
  p.yz = rx * p.yz;
  n.yz = rx * n.yz;
  p.xz = ry * p.xz;
  n.xz = ry * n.xz;

  float sway = aMeta.z * loose * g;
  c.x += sin(uTime * 1.1 + aPos.y * 0.25 + aPos.z * 0.12) * 0.16 * sway;
  c.z += cos(uTime * 0.9 + aPos.y * 0.2 + aPos.x * 0.15) * 0.12 * sway;
  if (kind > 4.5 && kind < 5.5) c.y += sin(uTime * 0.8 + aRand.y * 6.28) * 0.4 * sway;

  p += c;
  vY = p.y;
  vRand = aRand;
  vMeta = aMeta;
  vCell = aPos.xz;
}
`;

export const BLOCK_FRAGMENT_HEAD = /* glsl */ `
uniform float uTime;
uniform float uFlat;
uniform float uTop;
uniform float uGlow;
uniform float uN;
uniform vec3 uTop0;
uniform vec3 uTop1;
uniform vec3 uTop2;
uniform vec3 uSide0;
uniform vec3 uSide1;
uniform vec3 uWood;
uniform vec3 uAccent;
uniform vec3 uSecond0;
uniform vec3 uSecond1;
uniform vec3 uScan0;
uniform vec3 uScan1;
uniform vec3 uScan2;
uniform vec3 uScanSecond0;
uniform vec3 uScanSecond1;
uniform vec3 uScanLight0;
varying vec3 vLoc;
varying vec3 vDim;
varying vec3 vObjN;
varying vec4 vRand;
varying vec4 vMeta;
varying float vY;
varying vec2 vCell;
varying float vTone;

float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
vec3 ramp(float t) {
  t = clamp(t, 0.0, 1.0);
  return t < 0.5 ? mix(uTop0, uTop1, t * 2.0) : mix(uTop1, uTop2, t * 2.0 - 1.0);
}
`;

/** Runs after <color_fragment>; leaves the window light in `blockGlow`. */
export const BLOCK_FRAGMENT_COLOR = /* glsl */ `
vec3 blockGlow = vec3(0.0);
{
  float kind = vMeta.x;
  float up = smoothstep(0.5, 0.9, vObjN.y);
  float hf = clamp(vY / uTop, 0.0, 1.0);
  float within = clamp(vLoc.y / max(vDim.y, 0.001) + 0.5, 0.0, 1.0);
  vec3 topC = ramp(vTone);
  vec3 sideC = mix(uSide0, uSide1, hf);
  bool grounded = kind > 1.5 && (kind < 4.5 || kind > 5.5);

  if (kind < 0.5) {
    sideC = mix(uSide0, ramp(vTone), 0.3 + 0.5 * within);
  } else if (kind < 1.5) {
    sideC = uWood * (0.75 + 0.5 * vRand.x);
    topC = uWood * 1.25;
  } else if (kind < 2.5) {
    sideC = mix(uSide0, uSide1, clamp(hf * 0.55 + vTone * 0.4, 0.0, 1.0));
    float u = abs(vObjN.x) > 0.5 ? vLoc.z : vLoc.x;
    vec2 grid = vec2((u + 0.5) * 2.0, vY * 1.15);
    vec2 id = floor(grid);
    vec2 f = fract(grid);
    vec2 aa = fwidth(grid) + 0.0001;
    vec2 edge = smoothstep(vec2(0.24) - aa, vec2(0.24) + aa, f) * (1.0 - smoothstep(vec2(0.76) - aa, vec2(0.76) + aa, f));
    float pane = mix(edge.x * edge.y, 0.36, smoothstep(0.5, 1.2, max(aa.x, aa.y)));
    float face = abs(vObjN.x) > 0.5 ? 3.0 + sign(vObjN.x) : 7.0 + sign(vObjN.z);
    float lit = hash31(vec3(id + vCell * 3.7, face + vRand.x * 40.0));
    float cut = mix(0.8, 0.5, clamp(uGlow, 0.0, 1.0));
    float on = smoothstep(cut, cut + 0.04, lit) * step(vY, uTop);
    float body = step(0.9, vDim.x) * (1.0 - smoothstep(0.3, 0.6, abs(vObjN.y))) * smoothstep(0.35, 0.5, vY);
    sideC = mix(sideC, mix(uSide0 * 0.7, uAccent, on), pane * body * mix(0.5, 0.9, on));
    blockGlow = uAccent * on * pane * body * uGlow * 0.55;
    topC = ramp(vTone * 0.8);
  } else if (kind < 3.5) {
    float warp = sin(vCell.x * 0.22) * 0.35 + sin(vCell.y * 0.19 + 1.7) * 0.35;
    float bandAt = (vY * 29.0 / uN + warp) * 1.1;
    float id = floor(bandAt);
    float pick = hash31(vec3(id, 4.0, 9.0));
    vec3 a = mix(uSide0, uSide1, pick);
    float next = hash31(vec3(id + 1.0, 4.0, 9.0));
    vec3 c = mix(uSide0, uSide1, next);
    float aa = fwidth(bandAt) + 0.02;
    sideC = mix(a, c, smoothstep(1.0 - aa, 1.0, fract(bandAt)));
    float seam = step(0.82, pick);
    sideC = mix(sideC, uAccent, seam * 0.55);
    sideC *= 0.9 + 0.2 * vRand.x;
  } else if (kind < 4.5) {
    sideC = mix(uSide0, uSide1, pow(within, 1.4));
    sideC = mix(sideC, uTop2, smoothstep(0.75, 1.0, within) * vTone * 0.6);
    topC = mix(ramp(vTone), uTop2, smoothstep(0.75, 1.0, vTone) * 0.5);
  } else if (kind > 5.5) {
    sideC = mix(uSide0, mix(uSide1, ramp(vTone), 0.45), pow(hf, 0.8));
    topC = ramp(vTone * 0.95 + 0.05);
  } else {
    sideC = mix(uSide0, uSide1, clamp(vTone * 0.75 + within * 0.25, 0.0, 1.0));
  }

  bool second = vRand.w < -0.5;
  if (second) {
    topC = mix(uSecond0, uSecond1, clamp(vTone * 0.6 + vRand.x * 0.4, 0.0, 1.0));
    if (kind < 1.5 || kind > 3.5) sideC = mix(uSecond0 * 0.7, uSecond1, within * 0.75);
  }

  vec3 scene = mix(sideC, topC, up);
  if (grounded) scene *= mix(0.62, 1.0, smoothstep(0.0, 0.09 * uN, vY));
  // Lined up, each block keeps its own shade, so the code reads as a mosaic.
  float shade = clamp(vTone * 0.55 + vRand.y * 0.6 - 0.08, 0.0, 1.0);
  vec3 scan = shade < 0.5 ? mix(uScan0, uScan1, shade * 2.0) : mix(uScan1, uScan2, shade * 2.0 - 1.0);
  if (second) scan = mix(uScanSecond0, uScanSecond1, vRand.y);
  if (vRand.w > 1.5) scan = uScanLight0;
  diffuseColor.rgb = mix(scene, scan, uFlat);
  blockGlow *= 1.0 - uFlat;
}
`;

export const SLAB_FRAGMENT_HEAD = /* glsl */ `
uniform float uFlat;
uniform float uGrow;
uniform float uN;
uniform float uHalf;
uniform vec3 uSlab;
uniform vec3 uSlabSide;
uniform vec3 uScanLight0;
uniform vec3 uScanLight1;
uniform vec3 uScanLight2;
uniform sampler2D uContact;
varying vec3 vSlabP;
varying vec3 vSlabN;
float slabHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
`;

export const SLAB_FRAGMENT_COLOR = /* glsl */ `
{
  float up = smoothstep(0.4, 0.8, vSlabN.y);
  vec2 cell = floor(vSlabP.xz + 0.5);
  float inside = step(max(abs(cell.x), abs(cell.y)), uN * 0.5);
  float tileTone = mix(0.0, slabHash(cell) - 0.5, inside);
  vec3 topC = uSlab * (1.0 + tileTone * 0.09);
  float contact = texture2D(uContact, vSlabP.xz / (uHalf * 2.0) + 0.5).r;
  topC *= 1.0 - contact * 0.42 * uGrow;
  vec3 scene = mix(uSlabSide, topC, up);
  float pick = slabHash(cell + 17.0);
  vec3 light = mix(uScanLight0, uScanLight1, smoothstep(0.35, 0.75, slabHash(cell + 5.0)));
  light = mix(light, uScanLight2, step(0.88, pick));
  light = mix(uScanLight0, light, inside);
  diffuseColor.rgb = mix(scene, mix(uSlabSide, light, up), uFlat);
}
`;

export const SKY_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

export const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uLow;
uniform vec3 uHigh;
uniform vec3 uSun;
uniform float uSide;
uniform float uLowSun;
varying vec2 vUv;
float dither(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))) - 0.5;
}
void main() {
  vec3 col = mix(uLow, uHigh, smoothstep(0.0, 1.0, vUv.y));
  float g = exp(-3.2 * length((vUv - vec2(0.5 + 0.5 * uSide, 0.62)) * vec2(1.2, 1.0)));
  col = mix(col, uSun, g * 0.34 * uLowSun);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  gl_FragColor.rgb += dither(gl_FragCoord.xy) / 255.0;
}
`;

export const PARTICLE_VERTEX = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform float uKind;
uniform float uSpread;
uniform float uHeight;
uniform float uSize;
varying vec2 vP;
varying float vFade;
void main() {
  vP = position.xy;
  float t = uTime;
  vec3 c;
  c.x = (aSeed.x * 2.0 - 1.0) * uSpread;
  c.z = (aSeed.y * 2.0 - 1.0) * uSpread;
  float speed = uKind < 0.5 ? 1.3 : (uKind < 1.5 ? 1.0 : 0.0);
  float fall = mod(aSeed.z * uHeight - t * speed * (0.6 + aSeed.w * 0.8), uHeight);
  c.y = fall;
  c.x += sin(t * 0.7 + aSeed.w * 30.0) * (uKind < 0.5 ? 2.2 : 0.9);
  c.z += cos(t * 0.6 + aSeed.z * 30.0) * (uKind < 0.5 ? 1.6 : 0.9);
  if (uKind > 1.5) {
    c.y = aSeed.z * uHeight * 0.8 + sin(t * 0.5 + aSeed.w * 20.0) * 1.6;
    vFade = pow(0.5 + 0.5 * sin(t * (0.8 + aSeed.w) + aSeed.x * 40.0), 2.0);
  } else {
    vFade = smoothstep(0.0, 0.12, fall / uHeight) * (1.0 - smoothstep(0.85, 1.0, fall / uHeight));
  }
  float s = uSize * (0.6 + aSeed.w * 0.7);
  vec3 p;
  if (uKind < 0.5) {
    float a = t * (0.8 + aSeed.w) + aSeed.x * 40.0;
    float b = t * 0.9 + aSeed.y * 40.0;
    p = vec3(position.x * cos(a), position.y * cos(b), position.x * sin(a) + position.y * sin(b)) * s;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(c + p, 1.0);
  } else {
    vec4 mv = modelViewMatrix * vec4(c, 1.0);
    mv.xy += position.xy * s;
    gl_Position = projectionMatrix * mv;
  }
}
`;

export const PARTICLE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uKind;
uniform float uOpacity;
varying vec2 vP;
varying float vFade;
void main() {
  float d = length(vP * 2.0);
  float a;
  if (uKind < 0.5) {
    a = 1.0 - smoothstep(0.82, 0.98, length(vP * vec2(2.0, 3.0)));
  } else if (uKind < 1.5) {
    a = 1.0 - smoothstep(0.5, 1.0, d);
  } else {
    a = exp(-d * d * 4.0) * (1.0 - smoothstep(0.8, 1.0, d));
  }
  a *= vFade * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;
