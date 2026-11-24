import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import {
  BLOCK_FRAGMENT_COLOR,
  BLOCK_FRAGMENT_HEAD,
  BLOCK_VERTEX_HEAD,
  PARTICLE_FRAGMENT,
  PARTICLE_VERTEX,
  SKY_FRAGMENT,
  SKY_VERTEX,
  SLAB_FRAGMENT_COLOR,
  SLAB_FRAGMENT_HEAD,
} from "./shaders";
import type { Sculpture } from "./shapes";
import type { Theme } from "./themes";
import { TIME_LIMIT } from "./stage-constants";

/** Quiet zone the QR spec asks for, in modules. */
const QUIET = 4;
const SLAB_THICKNESS = 1.6;
const SUN_SWING = (66 * Math.PI) / 180;
const PARTICLES = 170;
const DEFAULT_TIME = -0.56;
/** Seconds to line up from the default time. Slow enough to follow the blocks. */
const GLIDE = 3.2;

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface StageOptions {
  reducedMotion: boolean;
  /** `target` is where the sun is heading, which can be well ahead of `time`. */
  onTime?: (time: number, target: number) => void;
}

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Theme colours and levels that are eased between themes. */
interface Look {
  colors: Record<string, THREE.Color>;
  levels: { glow: number; sun: number; ambient: number; particles: number };
}

function lookOf(t: Theme): Look {
  const c = (hex: string) => new THREE.Color(hex);
  return {
    colors: {
      skyLow: c(t.sky[0]),
      skyHigh: c(t.sky[1]),
      slab: c(t.slab),
      slabSide: c(t.slabSide),
      top0: c(t.top[0]),
      top1: c(t.top[1]),
      top2: c(t.top[2]),
      side0: c(t.side[0]),
      side1: c(t.side[1]),
      wood: c(t.wood),
      accent: c(t.accent),
      sunLow: c(t.sunLow),
      sunHigh: c(t.sunHigh),
      ambientSky: c(t.ambientSky),
      ambientGround: c(t.ambientGround),
      shadow: c(t.shadow),
      second0: c(t.second[0]),
      second1: c(t.second[1]),
      scan0: c(t.scanDark[0]),
      scan1: c(t.scanDark[1]),
      scan2: c(t.scanDark[2]),
      scanSecond0: c(t.scanSecond[0]),
      scanSecond1: c(t.scanSecond[1]),
      scanLight0: c(t.scanLight[0]),
      scanLight1: c(t.scanLight[1]),
      scanLight2: c(t.scanLight[2]),
      particle: c(t.particleColor),
    },
    levels: { glow: t.glow, sun: t.sun, ambient: t.ambient, particles: t.particles === "none" ? 0 : 1 },
  };
}

function copyLook(to: Look, from: Look, t: number) {
  for (const key of Object.keys(to.colors)) to.colors[key].lerp(from.colors[key], t);
  for (const key of Object.keys(to.levels) as (keyof Look["levels"])[])
    to.levels[key] = mix(to.levels[key], from.levels[key], t);
}

const PARTICLE_INDEX: Record<Theme["particles"], number> = { petal: 0, snow: 1, firefly: 2, none: 0 };

export class Stage {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(24, 1, 0.1, 1000);
  private sun = new THREE.DirectionalLight(0xffffff, 2.5);
  private fill = new THREE.DirectionalLight(0xffffff, 0.5);
  private hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1);
  private blocks: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.MeshStandardMaterial>;
  private blockBase = new RoundedBoxGeometry(1, 1, 1, 1, 0.075);
  private slab: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private floor: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial>;
  private sky: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private particles: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;

  private uniforms = {
    uTime: { value: 0 },
    uAlign: { value: 1 },
    uFlat: { value: 1 },
    uGrow: { value: 0 },
    uTop: { value: 10 },
    uN: { value: 25 },
    uHalf: { value: 16 },
    uGlow: { value: 1 },
    uContact: { value: null as THREE.DataTexture | null },
    uTop0: { value: new THREE.Color() },
    uTop1: { value: new THREE.Color() },
    uTop2: { value: new THREE.Color() },
    uSide0: { value: new THREE.Color() },
    uSide1: { value: new THREE.Color() },
    uWood: { value: new THREE.Color() },
    uAccent: { value: new THREE.Color() },
    uScan0: { value: new THREE.Color() },
    uScan1: { value: new THREE.Color() },
    uScan2: { value: new THREE.Color() },
    uSecond0: { value: new THREE.Color() },
    uSecond1: { value: new THREE.Color() },
    uScanSecond0: { value: new THREE.Color() },
    uScanSecond1: { value: new THREE.Color() },
    uScanLight0: { value: new THREE.Color() },
    uScanLight1: { value: new THREE.Color() },
    uScanLight2: { value: new THREE.Color() },
    uSlab: { value: new THREE.Color() },
    uSlabSide: { value: new THREE.Color() },
  };

  private look: Look;
  private targetLook: Look;
  private theme: Theme;

  private sculpture: Sculpture | null = null;
  private pending: Sculpture | null = null;

  private width = 1;
  private height = 1;
  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

  /** -1..1, 0 is noon. */
  private time = 0;
  private timeTarget = 0;
  private glide: { from: number; seconds: number; elapsed: number } | null = null;
  private lastLooseTime = DEFAULT_TIME;
  private theta = 0.62;
  private phi = 1.08;
  private thetaTarget = 0.62;
  private phiTarget = 1.08;
  private zoom = 1;
  private zoomTarget = 1;
  private frameN = 25;
  private frameTop = 12;
  private idle = true;

  private grow = 0;
  private growTarget = 0;
  private clock = 0;
  private last = 0;
  private raf = 0;
  private disposed = false;

  constructor(
    private canvas: HTMLCanvasElement,
    theme: Theme,
    private options: StageOptions,
  ) {
    this.theme = theme;
    this.look = lookOf(theme);
    this.targetLook = lookOf(theme);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    this.camera.rotation.order = "YXZ";

    this.sky = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
        uniforms: {
          uLow: { value: new THREE.Color() },
          uHigh: { value: new THREE.Color() },
          uSun: { value: new THREE.Color() },
          uSide: { value: 0 },
          uLowSun: { value: 0 },
        },
      }),
    );
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);

    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 600),
      new THREE.ShadowMaterial({ opacity: 0.3, transparent: true, depthWrite: false }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    // Slightly above the slab's rounded underside, so the shadow meets its edge.
    this.floor.position.y = -SLAB_THICKNESS + 0.24;
    this.floor.receiveShadow = true;
    this.floor.renderOrder = -5;
    this.scene.add(this.floor);

    const slabMaterial = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
    slabMaterial.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vSlabP;\nvarying vec3 vSlabN;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSlabP = position;\nvSlabN = normal;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${SLAB_FRAGMENT_HEAD}`)
        .replace("#include <color_fragment>", `#include <color_fragment>\n${SLAB_FRAGMENT_COLOR}`)
        .replace("#include <tonemapping_fragment>", FLAT_AFTER_TONEMAP);
    };
    this.slab = new THREE.Mesh(new THREE.BufferGeometry(), slabMaterial);
    this.slab.receiveShadow = true;
    this.slab.castShadow = true;
    this.slab.visible = false;
    this.scene.add(this.slab);

    const placeInDepth = (shader: { vertexShader: string; uniforms: Record<string, unknown> }) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${BLOCK_VERTEX_HEAD}`)
        .replace(
          "#include <begin_vertex>",
          "vec3 blockN = vec3(normal);\nvec3 transformed = vec3(position);\nplaceBlock(transformed, blockN);",
        );
    };

    const blockMaterial = new THREE.MeshStandardMaterial({ roughness: 0.72, metalness: 0 });
    blockMaterial.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${BLOCK_VERTEX_HEAD}`)
        .replace(
          "#include <beginnormal_vertex>",
          "vec3 objectNormal = vec3(normal);\nvec3 blockP = vec3(position);\nplaceBlock(blockP, objectNormal);",
        )
        .replace("#include <begin_vertex>", "vec3 transformed = blockP;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${BLOCK_FRAGMENT_HEAD}`)
        .replace("#include <color_fragment>", `#include <color_fragment>\n${BLOCK_FRAGMENT_COLOR}`)
        .replace(
          "#include <emissivemap_fragment>",
          "#include <emissivemap_fragment>\ntotalEmissiveRadiance += blockGlow;",
        )
        .replace("#include <tonemapping_fragment>", FLAT_AFTER_TONEMAP);
    };
    this.blocks = new THREE.Mesh(new THREE.InstancedBufferGeometry(), blockMaterial);
    const depth = new THREE.MeshDepthMaterial();
    depth.onBeforeCompile = placeInDepth;
    this.blocks.customDepthMaterial = depth;
    this.blocks.frustumCulled = false;
    this.blocks.castShadow = true;
    this.blocks.receiveShadow = true;
    this.blocks.visible = false;
    this.scene.add(this.blocks);

    const quad = new THREE.PlaneGeometry(1, 1);
    const pg = new THREE.InstancedBufferGeometry();
    pg.index = quad.index;
    pg.setAttribute("position", quad.getAttribute("position"));
    const seeds = new Float32Array(PARTICLES * 4).map(() => Math.random());
    pg.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
    pg.instanceCount = PARTICLES;
    this.particles = new THREE.Mesh(
      pg,
      new THREE.ShaderMaterial({
        vertexShader: PARTICLE_VERTEX,
        fragmentShader: PARTICLE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        uniforms: {
          uTime: this.uniforms.uTime,
          uKind: { value: PARTICLE_INDEX[theme.particles] },
          uColor: { value: new THREE.Color() },
          uOpacity: { value: 0 },
          uSpread: { value: 20 },
          uHeight: { value: 20 },
          uSize: { value: 0.6 },
        },
      }),
    );
    this.particles.frustumCulled = false;
    this.particles.renderOrder = 10;
    this.scene.add(this.particles);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.radius = 3;
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.sun, this.sun.target, this.fill, this.hemi);

    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });

    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  /* --------------------------------------------------------------- input */

  private pointers = new Map<number, { x: number; y: number }>();
  private pinch = 0;

  private onPointerDown = (e: PointerEvent) => {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.pinch = 0;
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
  };

  private onPointerMove = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    this.idle = false;

    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinch) this.zoomBy(this.pinch / dist);
      this.pinch = dist;
      return;
    }
    if (Math.abs(dx) + Math.abs(dy) < 1) return;
    // Turning the piece breaks the alignment, so the sun moves off noon too.
    if (Math.abs(this.timeTarget) < 0.3) this.setTime(this.lastLooseTime);
    this.thetaTarget -= dx * 0.0075;
    this.phiTarget = clamp(this.phiTarget - dy * 0.006, 0.28, 1.5);
  };

  private onPointerUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    this.pinch = 0;
    if (this.pointers.size) return;
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.zoomBy(Math.exp(clamp(e.deltaY, -60, 60) * 0.0025));
  };

  private zoomBy(k: number) {
    this.zoomTarget = clamp(this.zoomTarget * k, 0.5, 1.6);
  }

  /* ---------------------------------------------------------- public API */

  resize(width: number, height: number, insets: Insets) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.insets = insets;
    this.renderer.setSize(this.width, this.height, false);
  }

  setTime(time: number) {
    this.glide = null;
    this.timeTarget = clamp(time, -TIME_LIMIT, TIME_LIMIT);
    if (Math.abs(this.timeTarget) > 0.5) this.lastLooseTime = this.timeTarget;
    if (this.options.reducedMotion) this.time = this.timeTarget;
  }

  /** Moves the sun to noon (lined up) or back to where it last was. */
  setScan(on: boolean) {
    this.setTime(on ? 0 : this.lastLooseTime);
    if (on && !this.options.reducedMotion) {
      const seconds = GLIDE * clamp(Math.abs(this.time / DEFAULT_TIME), 0.25, 1.25);
      this.glide = { from: this.time, seconds, elapsed: 0 };
    }
  }

  setTheme(theme: Theme) {
    this.theme = theme;
    this.targetLook = lookOf(theme);
    if (theme.particles !== "none") this.particles.material.uniforms.uKind.value = PARTICLE_INDEX[theme.particles];
    if (this.options.reducedMotion) copyLook(this.look, this.targetLook, 1);
  }

  setSculpture(sculpture: Sculpture) {
    if (!this.sculpture || this.options.reducedMotion) {
      this.install(sculpture);
      this.pending = null;
      this.growTarget = 1;
      if (this.options.reducedMotion) this.grow = 1;
      return;
    }
    // Fold down to a flat code, swap, then rise again.
    this.pending = sculpture;
    this.growTarget = 0;
  }

  /** PNG of the current view, or of the lined-up view when `scan` is set. */
  async snapshot(scan: boolean, px = 2048): Promise<Blob | null> {
    const s = this.pending ?? this.sculpture;
    if (!s) return null;
    const out = document.createElement("canvas");
    out.width = out.height = px;
    const ctx = out.getContext("2d");
    if (!ctx) return null;
    const ratio = this.renderer.getPixelRatio();
    this.withState(s, () => {
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(px, px, false);
      const pad = px * (scan ? 0.04 : 0.1);
      const margin = { top: pad, right: pad, bottom: pad, left: pad };
      if (scan) {
        this.renderScan(px, px, margin);
      } else {
        this.frame(px, px, margin);
        this.renderer.render(this.scene, this.camera);
      }
      ctx.drawImage(this.canvas, 0, 0);
      this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(this.width, this.height, false);
    });
    return new Promise((resolve) => out.toBlob(resolve, "image/png"));
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    this.uniforms.uContact.value?.dispose();
    this.sun.shadow.map?.dispose();
    this.renderer.dispose();
  }

  /* ------------------------------------------------------------ building */

  private install(s: Sculpture) {
    this.sculpture = s;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute("position", this.blockBase.getAttribute("position"));
    g.setAttribute("normal", this.blockBase.getAttribute("normal"));
    g.setAttribute("aPos", new THREE.InstancedBufferAttribute(s.pos, 3));
    g.setAttribute("aDim", new THREE.InstancedBufferAttribute(s.dim, 3));
    g.setAttribute("aRand", new THREE.InstancedBufferAttribute(s.rand, 4));
    g.setAttribute("aMeta", new THREE.InstancedBufferAttribute(s.meta, 4));
    g.instanceCount = s.count;
    this.blocks.geometry.dispose();
    this.blocks.geometry = g;
    this.blocks.visible = true;

    const full = s.size + QUIET * 2;
    this.slab.geometry.dispose();
    const slab = new RoundedBoxGeometry(full, SLAB_THICKNESS, full, 3, 0.4);
    slab.translate(0, -SLAB_THICKNESS / 2, 0);
    this.slab.geometry = slab;
    this.slab.visible = true;

    this.uniforms.uN.value = s.size;
    this.uniforms.uTop.value = s.top;
    this.uniforms.uHalf.value = full / 2;
    this.uniforms.uContact.value?.dispose();
    this.uniforms.uContact.value = contactTexture(s, full);

    const p = this.particles.material.uniforms;
    p.uSpread.value = full * 0.72;
    p.uHeight.value = Math.max(s.top * 1.3, full * 0.55);
    p.uSize.value = full * 0.016;

    const reach = full * 0.95;
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -reach;
    cam.right = cam.top = reach;
    cam.near = 1;
    cam.far = full * 6;
    cam.updateProjectionMatrix();
    this.sun.shadow.normalBias = 0.0016 * full;

    if (this.frameTop === 12 && this.grow === 0) {
      this.frameN = full;
      this.frameTop = s.top;
    }
  }

  /** Runs `fn` with the final look in place, then puts the live state back. */
  private withState<T>(s: Sculpture, fn: () => T): T {
    const u = this.uniforms;
    const keep = {
      sculpture: this.sculpture,
      look: { colors: cloneColors(this.look.colors), levels: { ...this.look.levels } },
      align: u.uAlign.value,
      flat: u.uFlat.value,
      grow: u.uGrow.value,
      frameN: this.frameN,
      frameTop: this.frameTop,
    };
    if (s !== this.sculpture) this.install(s);
    this.frameN = s.size + QUIET * 2;
    this.frameTop = s.top;
    copyLook(this.look, this.targetLook, 1);
    u.uGrow.value = 1;
    this.applyLook();
    try {
      return fn();
    } finally {
      this.look = keep.look;
      if (keep.sculpture && keep.sculpture !== this.sculpture) this.install(keep.sculpture);
      this.frameN = keep.frameN;
      this.frameTop = keep.frameTop;
      u.uAlign.value = keep.align;
      u.uFlat.value = keep.flat;
      u.uGrow.value = keep.grow;
      this.render();
    }
  }

  private renderScan(w: number, h: number, insets: Insets) {
    const keep = { time: this.time, zoom: this.zoom };
    this.time = 0;
    this.zoom = 1;
    this.applyLook();
    this.frame(w, h, insets);
    this.renderer.render(this.scene, this.camera);
    this.time = keep.time;
    this.zoom = keep.zoom;
  }

  /* --------------------------------------------------------------- frame */

  /** 0 = free view, 1 = fully lined up. */
  private alignment() {
    return 1 - smoothstep(0.02, 0.56, Math.abs(this.time));
  }

  private applyLook() {
    const { colors: c, levels } = this.look;
    const u = this.uniforms;
    const k = this.alignment();
    const flat = smoothstep(0.6, 0.97, k);
    u.uAlign.value = k;
    u.uFlat.value = flat;
    u.uGlow.value = levels.glow;
    u.uTop0.value.copy(c.top0);
    u.uTop1.value.copy(c.top1);
    u.uTop2.value.copy(c.top2);
    u.uSide0.value.copy(c.side0);
    u.uSide1.value.copy(c.side1);
    u.uWood.value.copy(c.wood);
    u.uAccent.value.copy(c.accent);
    u.uScan0.value.copy(c.scan0);
    u.uScan1.value.copy(c.scan1);
    u.uScan2.value.copy(c.scan2);
    u.uSecond0.value.copy(c.second0);
    u.uSecond1.value.copy(c.second1);
    u.uScanSecond0.value.copy(c.scanSecond0);
    u.uScanSecond1.value.copy(c.scanSecond1);
    u.uScanLight0.value.copy(c.scanLight0);
    u.uScanLight1.value.copy(c.scanLight1);
    u.uScanLight2.value.copy(c.scanLight2);
    u.uSlab.value.copy(c.slab);
    u.uSlabSide.value.copy(c.slabSide);

    const a = this.time * SUN_SWING;
    const low = smoothstep(0.1, 0.85, Math.abs(this.time));
    const dir = new THREE.Vector3(Math.sin(a), Math.cos(a), 0.42 * Math.abs(Math.sin(a))).normalize();
    const full = this.uniforms.uHalf.value * 2;
    this.sun.position.copy(dir).multiplyScalar(full * 2.6);
    this.sun.color.copy(c.sunHigh).lerp(c.sunLow, low * 0.6);
    this.sun.intensity = levels.sun * 1.12;
    this.sun.shadow.intensity = 1 - flat;
    this.fill.position.set(-dir.x, 0.35, -0.8);
    this.fill.color.copy(c.ambientSky);
    this.fill.intensity = levels.ambient * 0.28;
    this.hemi.color.copy(c.ambientSky);
    this.hemi.groundColor.copy(c.ambientGround);
    this.hemi.intensity = levels.ambient;

    this.floor.material.color.copy(c.shadow);
    this.floor.material.opacity = 0.3 * (1 - flat);

    const s = this.sky.material.uniforms;
    s.uLow.value.copy(c.skyLow);
    s.uHigh.value.copy(c.skyHigh);
    s.uSun.value.copy(c.sunLow);
    s.uSide.value = Math.sin(a);
    s.uLowSun.value = low;

    const p = this.particles.material.uniforms;
    p.uColor.value.copy(c.particle);
    p.uOpacity.value = levels.particles * (1 - smoothstep(0.25, 0.7, k)) * this.uniforms.uGrow.value * 0.9;
    this.particles.visible = p.uOpacity.value > 0.01;
  }

  /** Points the camera. Lining up also collapses perspective to parallel. */
  private frame(w: number, h: number, insets: Insets) {
    const k = this.alignment();
    const cam = this.camera;

    const turn = Math.PI * 2;
    const upright = Math.round(this.theta / turn) * turn;
    const theta = mix(this.theta, upright, k);
    const phi = mix(this.phi, 0, k);

    const freeW = Math.max(40, w - insets.left - insets.right);
    const freeH = Math.max(40, h - insets.top - insets.bottom);
    const free = Math.min(freeW, freeH);

    // Half-extent that has to fit inside the free square.
    const spread = this.frameN * 0.66;
    const looseHalf = Math.max(spread, this.frameTop * 0.72) * 0.96 * this.zoom;
    const wide = clamp(freeW / freeH, 0.6, 1.25);
    const scanHalf = (this.frameN / 2) * SCAN_MARGIN;
    const half = mix(looseHalf / Math.min(1, wide * 0.95 + 0.05), scanHalf, k);
    const halfV = half * (h / free);

    const fov = Math.exp(mix(Math.log(26), Math.log(0.25), Math.pow(k, 0.8)));
    const dist = halfV / Math.tan((fov * Math.PI) / 360);
    const ty = mix(this.frameTop * 0.24, 0, k);

    cam.fov = fov;
    cam.aspect = w / h;
    cam.near = Math.max(0.5, dist - this.frameN * 4 - this.frameTop * 2);
    cam.far = dist + this.frameN * 8;
    cam.rotation.set(-(Math.PI / 2 - phi), theta, 0);
    cam.position.set(
      dist * Math.sin(phi) * Math.sin(theta),
      ty + dist * Math.cos(phi),
      dist * Math.sin(phi) * Math.cos(theta),
    );
    const ox = (insets.left - insets.right) / 2;
    const oy = (insets.top - insets.bottom) / 2;
    cam.setViewOffset(w, h, -ox, -oy, w, h);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  private render() {
    this.applyLook();
    this.frame(this.width, this.height, this.insets);
    this.renderer.render(this.scene, this.camera);
  }

  private tick = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const still = this.options.reducedMotion;
    if (!still) this.clock += dt;
    this.uniforms.uTime.value = this.clock;

    const ease = (rate: number) => (still ? 1 : 1 - Math.exp(-dt * rate));
    copyLook(this.look, this.targetLook, ease(4.5));

    const before = this.time;
    if (this.glide) {
      // Nearly even speed: alignment() already eases the camera in and out.
      const g = this.glide;
      g.elapsed += dt;
      const t = clamp(g.elapsed / g.seconds);
      this.time = mix(g.from, this.timeTarget, mix(t, smoothstep(0, 1, t), 0.2));
      if (t === 1) this.glide = null;
    } else {
      this.time += (this.timeTarget - this.time) * ease(3.4);
    }
    if (Math.abs(this.timeTarget - this.time) < 0.0005) this.time = this.timeTarget;
    if (before !== this.time) this.options.onTime?.(this.time, this.timeTarget);

    if (this.idle && !still && this.alignment() < 0.05) this.thetaTarget += dt * 0.07;
    this.theta += (this.thetaTarget - this.theta) * ease(9);
    this.phi += (this.phiTarget - this.phi) * ease(9);
    this.zoom += (this.zoomTarget - this.zoom) * ease(9);

    if (this.grow < this.growTarget) this.grow = Math.min(this.growTarget, this.grow + dt / 1.5);
    else if (this.grow > this.growTarget) this.grow = Math.max(this.growTarget, this.grow - dt / 0.5);
    if (this.grow === 0 && this.pending) {
      this.install(this.pending);
      this.pending = null;
      this.growTarget = 1;
    }
    this.uniforms.uGrow.value = this.grow;

    if (this.sculpture) {
      const s = this.pending ?? this.sculpture;
      this.frameN += (s.size + QUIET * 2 - this.frameN) * ease(4);
      this.frameTop += (s.top - this.frameTop) * ease(3);
      this.render();
    }
  };
}

/** Lined-up colours skip lighting and tone mapping, so contrast is exact. */
const FLAT_AFTER_TONEMAP =
  "#include <tonemapping_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, diffuseColor.rgb, uFlat);";

/** How much of the free square the slab leaves around itself when lined up. */
const SCAN_MARGIN = 1.06;

const cloneColors = (c: Record<string, THREE.Color>) =>
  Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.clone()]));

/** Soft contact shading for the ground, baked from column heights. */
function contactTexture(s: Sculpture, full: number) {
  const n = s.size;
  const data = new Uint8Array(full * full);
  const reach = 3;
  for (let r = 0; r < full; r++) {
    for (let c = 0; c < full; c++) {
      let sum = 0;
      let weight = 0;
      for (let dr = -reach; dr <= reach; dr++) {
        for (let dc = -reach; dc <= reach; dc++) {
          const d = Math.hypot(dr, dc);
          if (d > reach) continue;
          const w = 1 / (1 + d);
          weight += w;
          const rr = r + dr - QUIET;
          const cc = c + dc - QUIET;
          if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
          sum += w * Math.min(1, s.ground[rr * n + cc] / (0.14 * n));
        }
      }
      data[r * full + c] = Math.round(clamp((sum / weight) * 1.6) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, full, full, THREE.RedFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}
