"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { encode, LEVELS, payload, type Content, type ContentType } from "@/lib/qr";
import { fromQuery, toQuery, type Design } from "@/lib/share";
import { sculpt, SHAPES } from "@/lib/shapes";
import type { Stage } from "@/lib/stage";
import { themeById, THEMES } from "@/lib/themes";
import { FlatCode } from "./FlatCode";
import { ShapeArt, ThemeArt } from "./IsoTile";
import { Logo } from "./Logo";
import { SunArc, type SunHandle } from "./SunArc";

const TYPES: { id: ContentType; label: string }[] = [
  { id: "link", label: "Link" },
  { id: "text", label: "Text" },
];

const initialDesign = (): Design => fromQuery(window.location.search);

const insetsFor = (w: number, h: number) =>
  w < 620
    ? { top: Math.min(88, h * 0.22), right: 14, bottom: 70, left: 14 }
    : { top: Math.min(128, h * 0.17), right: 36, bottom: 92, left: 36 };

export function Studio() {
  const [design, setDesign] = useState(initialDesign);
  const [draft, setDraft] = useState<Content>(design.content);
  const [scan, setScan] = useState(false);
  const [notice, setNotice] = useState("");
  const [noWebgl, setNoWebgl] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const sunRef = useRef<SunHandle | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage | null>(null);

  const theme = themeById(design.theme);
  const { shape, level, seed } = design;
  const text = payload(design.content);
  const result = useMemo(() => encode(text, level), [text, level]);
  const draftText = payload(draft);
  const draftResult = useMemo(() => encode(draftText, level), [draftText, level]);

  // Typing settles before the sculpture is rebuilt.
  useEffect(() => {
    if (draft === design.content) return;
    const id = setTimeout(() => setDesign((d) => ({ ...d, content: draft })), 450);
    return () => clearTimeout(id);
  }, [draft, design.content]);

  const initialTheme = useRef(theme);
  useEffect(() => {
    let cancelled = false;
    let created: Stage | null = null;
    let intro = 0;
    let observer: ResizeObserver | null = null;
    import("@/lib/stage").then(({ Stage }) => {
      const canvas = canvasRef.current;
      const view = viewRef.current;
      if (cancelled || !canvas || !view) return;
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      try {
        created = new Stage(canvas, initialTheme.current, {
          reducedMotion,
          onTime: (t, target) => {
            sunRef.current?.set(t);
            setScan(Math.abs(target) < 0.12);
          },
        });
      } catch {
        setNoWebgl(true);
        return;
      }
      const s = created;
      observer = new ResizeObserver(() => {
        const { clientWidth: w, clientHeight: h } = view;
        s.resize(w, h, insetsFor(w, h));
      });
      observer.observe(view);
      s.resize(view.clientWidth, view.clientHeight, insetsFor(view.clientWidth, view.clientHeight));
      setScan(true);
      // Open on the plain code, then let it rise.
      intro = window.setTimeout(() => s.setScan(false), reducedMotion ? 0 : 750);
      stageRef.current = s;
      setStage(s);
      if (process.env.NODE_ENV !== "production") (window as unknown as { __stage: Stage }).__stage = s;
    });
    return () => {
      cancelled = true;
      clearTimeout(intro);
      observer?.disconnect();
      created?.dispose();
      stageRef.current = null;
    };
  }, []);

  useEffect(() => {
    stage?.setTheme(theme);
  }, [stage, theme]);

  useEffect(() => {
    if (!stage || !result.ok) return;
    stage.setSculpture(sculpt(result.matrix, shape, seed));
  }, [stage, result, shape, seed]);

  const flash = useCallback((message: string) => setNotice(message), []);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 3200);
    return () => clearTimeout(id);
  }, [notice]);

  const set = <K extends keyof Design>(key: K, value: Design[K]) => setDesign((d) => ({ ...d, [key]: value }));
  const edit = (patch: Partial<Content>) => setDraft((d) => ({ ...d, ...patch }));
  const view = (on: boolean) => {
    setScan(on);
    stageRef.current?.setScan(on);
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const { readFile } = await import("@/lib/read-image");
      const found = await readFile(file);
      if (!found) return flash("No QR code found in that image.");
      edit(/^https?:/i.test(found) ? { type: "link", link: found } : { type: "text", text: found });
      flash("Rebuilt from your image.");
    } catch {
      flash("That file could not be opened as an image.");
    }
  };

  const save = async () => {
    const blob = await stageRef.current?.snapshot(scan);
    if (!blob) return flash("The image could not be saved.");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = scan ? `noon-${shape}-scan.png` : `noon-${shape}-3d.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const copyLink = async () => {
    const url = `${window.location.origin}${window.location.pathname}${toQuery({ ...design, content: draft })}`;
    try {
      await navigator.clipboard.writeText(url);
      flash("Link copied.");
    } catch {
      flash("Copying was blocked by the browser.");
    }
  };

  const vars = {
    "--panel": theme.panel,
    "--field": theme.field,
    "--ink": theme.ink,
    "--action": theme.action,
    "--on-action": theme.onAction,
    "--sky-low": theme.sky[0],
    "--sky-high": theme.sky[1],
  } as CSSProperties;

  const problem =
    draftResult.ok || draftResult.reason === "empty"
      ? ""
      : level === "L"
        ? "Too long to scan reliably. Shorten it."
        : "Too long at this redundancy. Shorten it or pick a lower one.";

  return (
    <main className="studio" style={vars}>
      <section className="panel" aria-label="Design">
        <header>
          <Logo className="logo" />
          <p>3D QR codes that line up when the sun is overhead.</p>
        </header>

        <div className="group">
          <div className="tabs" role="group" aria-label="What the code holds">
            {TYPES.map((t) => (
              <button key={t.id} type="button" aria-pressed={draft.type === t.id} onClick={() => edit({ type: t.id })}>
                {t.label}
              </button>
            ))}
          </div>

          {draft.type === "link" && (
            <label className="field">
              <span>Web address</span>
              <input
                type="text"
                inputMode="url"
                autoCapitalize="off"
                spellCheck={false}
                value={draft.link}
                placeholder="yourlink.com"
                onChange={(e) => edit({ link: e.target.value })}
              />
            </label>
          )}
          {draft.type === "text" && (
            <label className="field">
              <span>Message</span>
              <textarea
                rows={3}
                value={draft.text}
                placeholder="Anything you like"
                onChange={(e) => edit({ text: e.target.value })}
              />
            </label>
          )}

          <div className="under" aria-live="polite">
            <span className={problem ? "problem" : undefined}>
              {problem ||
                (draftResult.ok
                  ? `${draftResult.matrix.size} × ${draftResult.matrix.size} blocks`
                  : "Fill this in to build a code")}
            </span>
            <button type="button" className="text" onClick={() => fileRef.current?.click()}>
              Import a QR image
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                void importFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
        </div>

        <div className="group">
          <div className="head">
            <h2>Shape</h2>
            <button type="button" className="text" onClick={() => set("seed", seed + 1)}>
              Grow a new one
            </button>
          </div>
          <div className="shapes" role="group" aria-label="Shape">
            {SHAPES.map((s) => (
              <button key={s.id} type="button" aria-pressed={shape === s.id} onClick={() => set("shape", s.id)}>
                <ShapeArt shape={s.id} theme={theme} />
                <span>{s.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="group">
          <h2>Theme</h2>
          <div className="themes" role="group" aria-label="Theme">
            {THEMES.map((t) => (
              <button key={t.id} type="button" aria-pressed={theme.id === t.id} onClick={() => set("theme", t.id)}>
                <ThemeArt theme={t} />
                <span>{t.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="group">
          <h2>Redundancy</h2>
          <div className="tabs" role="group" aria-label="Redundancy">
            {LEVELS.map((l) => (
              <button key={l.id} type="button" aria-pressed={level === l.id} onClick={() => set("level", l.id)}>
                {l.label}
              </button>
            ))}
          </div>
          <p className="hint">How much of the code can be hidden or damaged and still scan.</p>
        </div>
      </section>

      <section className="view" ref={viewRef} aria-label="Preview">
        {noWebgl && result.ok ? (
          <FlatCode matrix={result.matrix} theme={theme} />
        ) : (
          <canvas ref={canvasRef} aria-label={`3D QR code of ${text || "nothing yet"}`} role="img" />
        )}

        {!noWebgl && <SunArc handleRef={sunRef} onChange={(t) => stageRef.current?.setTime(t)} />}

        <div className="dock">
          <p className={notice ? "notice show" : "notice"} role="status">
            {notice}
          </p>
          {!noWebgl && (
            <div className="switch" role="group" aria-label="View">
              <button type="button" aria-pressed={!scan} onClick={() => view(false)}>
                3D view
              </button>
              <button type="button" aria-pressed={scan} onClick={() => view(true)}>
                Scan view
              </button>
            </div>
          )}
          <div className="actions">
            <button type="button" onClick={copyLink}>
              Copy link
            </button>
            <button type="button" className="primary" onClick={save}>
              Save<span className="wide">{scan ? " QR image" : " 3D image"}</span>
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
