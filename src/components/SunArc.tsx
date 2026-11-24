"use client";

import { useCallback, useEffect, useRef, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { TIME_LIMIT } from "@/lib/stage-constants";

export interface SunHandle {
  set(time: number): void;
}

const W = 1000;
const H = 120;
const TOP = 26;
const SWING = 0.95;

/** Position along the arc for a time of -1..1, in viewBox units. */
const at = (t: number) => {
  const a = t * SWING;
  return { x: W / 2 + (Math.sin(a) / Math.sin(SWING)) * (W / 2 - 40), y: TOP + ((1 - Math.cos(a)) / (1 - Math.cos(SWING))) * (H - TOP - 18) };
};

const ARC = Array.from({ length: 49 }, (_, i) => {
  const p = at(-1 + (i / 48) * 2);
  return `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
}).join("");

const clockOf = (t: number) => {
  const minutes = Math.round((12 + t * 6) * 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
};

interface Props {
  handleRef: RefObject<SunHandle | null>;
  onChange: (time: number) => void;
}

export function SunArc({ handleRef, onChange }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const sun = useRef<HTMLDivElement>(null);
  const mark = useRef<SVGSVGElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const time = useRef(0);

  // Driven by the render loop, so it writes to the DOM instead of state.
  const place = useCallback((t: number) => {
    time.current = t;
    const p = at(t);
    const el = sun.current;
    if (!el) return;
    el.style.left = `${(p.x / W) * 100}%`;
    el.style.top = `${(p.y / H) * 100}%`;
    el.setAttribute("aria-valuenow", String(Math.round(t * 100)));
    el.setAttribute("aria-valuetext", Math.abs(t) < 0.02 ? "Noon, lined up for scanning" : clockOf(t));
    if (mark.current) mark.current.style.transform = `rotate(${(t * 90).toFixed(1)}deg)`;
    if (label.current) label.current.textContent = Math.abs(t) < 0.01 ? "Noon" : clockOf(t);
  }, []);

  useEffect(() => {
    handleRef.current = { set: place };
    place(time.current);
    return () => {
      handleRef.current = null;
    };
  }, [handleRef, place]);

  const fromPointer = (clientX: number) => {
    const box = root.current!.getBoundingClientRect();
    const u = (((clientX - box.left) / box.width) * W - W / 2) / (W / 2 - 40);
    const t = Math.asin(Math.min(1, Math.max(-1, u)) * Math.sin(SWING)) / SWING;
    return Math.min(TIME_LIMIT, Math.max(-TIME_LIMIT, t));
  };

  const move = (e: PointerEvent) => {
    const t = fromPointer(e.clientX);
    onChange(Math.abs(t) < 0.045 ? 0 : t);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    move(e);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const step = { ArrowLeft: -0.08, ArrowDown: -0.08, ArrowRight: 0.08, ArrowUp: 0.08 }[e.key];
    if (step) {
      e.preventDefault();
      const next = time.current + step;
      onChange(Math.abs(next) < 0.04 ? 0 : next);
    } else if (e.key === "Home") onChange(-TIME_LIMIT);
    else if (e.key === "End") onChange(TIME_LIMIT);
  };

  return (
    <div className="arc" ref={root}>
      <svg className="arc-line" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={ARC} vectorEffect="non-scaling-stroke" />
      </svg>
      {Array.from({ length: 11 }, (_, i) => {
        const p = at(((i - 5) / 6));
        return (
          <i
            key={i}
            className={i === 5 ? "arc-tick arc-noon" : "arc-tick"}
            style={{ left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%` }}
          />
        );
      })}
      <div
        ref={sun}
        className="sun"
        role="slider"
        tabIndex={0}
        aria-label="Time of day. Noon lines the code up for scanning."
        aria-valuemin={-TIME_LIMIT * 100}
        aria-valuemax={TIME_LIMIT * 100}
        aria-valuenow={0}
        onPointerDown={onPointerDown}
        onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && move(e)}
        onKeyDown={onKeyDown}
        style={{ left: "50%", top: `${(TOP / H) * 100}%` }}
      >
        <svg ref={mark} viewBox="0 0 7 7" aria-hidden="true">
          <path fillRule="evenodd" d="M0 0h7v7H0zM1 1v5h5V1z" />
          <rect x="2" y="2" width="3" height="3" />
        </svg>
        <span ref={label}>Noon</span>
      </div>
    </div>
  );
}
